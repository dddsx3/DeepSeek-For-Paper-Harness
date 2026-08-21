/** Node executor: drives runs through plan, execute, review, revise, deliver. */

import { createHash } from 'node:crypto'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { HarnessRole, HarnessProviderService } from './provider.ts'
import type { HarnessSettingsService } from './settings.ts'
import { resolveRunPolicy } from './policy.ts'
import type {
  ArtifactRecord,
  Manifest,
  NodeRecord,
  RunId,
  RunRecord,
} from './spec.ts'
import { newArtifactId } from './spec.ts'
import type { WorkflowEngine } from './workflow.ts'

/** Result of one completed run execution. */
export interface ExecutionOutcome {
  readonly run: RunRecord
  readonly manifest: Manifest
}

/** One structured reviewer finding. */
export interface ReviewDefect {
  readonly severity: 'major' | 'minor'
  readonly description: string
}

const SYSTEM_PROMPTS: Record<HarnessRole, string> = {
  executor: 'You are a careful task executor. Produce complete, correct output for the given task. Be concise.',
  reviewer: 'You are an independent reviewer. Judge only the delivered text against the task. Respond with JSON only.',
  editorAi: 'You are a precise editor. Apply the listed defects minimally and return the corrected text only.',
}

/** Map a settings role to the node record's role vocabulary. */
function nodeRoleOf(role: HarnessRole): NodeRecord['role'] {
  return role === 'editorAi' ? 'editor_ai' : role
}

/**
 * Drives one run's nodes through the durable engine. Every model call goes
 * through the shared provider seam; every state change, event, and artifact
 * is persisted, so a crashed run replays and recovers through the engine.
 */
export class WorkflowExecutor {
  /**
   * @param engine - Durable workflow engine owning all run writes.
   * @param provider - Shared LLM seam for the three roles.
   * @param settings - Role settings snapshots.
   */
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly provider: HarnessProviderService,
    private readonly settings: HarnessSettingsService,
  ) {}

  /**
   * Execute one run end to end: plan, execute, the mode-bounded review loop,
   * and delivery with a manifest. Fast mode delivers after its revise rounds
   * even with defects; strict mode fails the run when defects persist.
   * @param runId - Run to execute.
   * @param input - User task text.
   * @returns the final run record and its manifest.
   */
  async execute(runId: RunId, input: string): Promise<ExecutionOutcome> {
    const initial = this.engine.getRun(runId)
    if (initial === undefined) throw new Error(`run '${runId}' was not found`)
    const policy = resolveRunPolicy(initial.mode)
    if (initial.status === 'planning') await this.engine.transitionRun(runId, 'running')

    const plan = await this.runNode(runId, 'plan', 'plan', 'executor', [
      `Task: ${input}`,
      'Produce a short numbered execution plan.',
    ].join('\n'))
    const draft = await this.runNode(runId, 'execute', 'execute', 'executor', [
      `Task: ${input}`,
      `Plan:\n${plan.text}`,
      'Produce the deliverable text for the task.',
    ].join('\n\n'))

    let current = draft.text
    let defects: ReviewDefect[] = []
    for (let round = 0; round <= policy.maxReviseRounds; round += 1) {
      const review = await this.runNode(
        runId, 'review', round === 0 ? 'review' : `review #${round + 1}`, 'reviewer',
        this.reviewPrompt(input, current),
      )
      defects = parseDefects(review.text)
      for (const defect of defects) {
        await this.engine.appendPublic(runId, review.nodeId, 'defect', {
          severity: defect.severity,
          description: defect.description,
        })
      }
      if (defects.length === 0 || round === policy.maxReviseRounds) break
      const revised = await this.runNode(
        runId, 'revise', `revise #${round + 1}`, 'editorAi',
        [
          `Task: ${input}`,
          `Current text:\n${current}`,
          `Defects:\n${defects.map(defect => `- [${defect.severity}] ${defect.description}`).join('\n')}`,
          'Return the corrected text only.',
        ].join('\n\n'),
      )
      current = revised.text
    }

    const gatePassed = defects.length === 0
    await this.engine.appendPublic(runId, null, 'gate_result', { gate: 'review', passed: gatePassed })
    const deliverNode = await this.engine.addNode({ runId, type: 'deliver', title: 'deliver' })
    await this.engine.transitionNode(deliverNode.id, 'ready')
    await this.engine.transitionNode(deliverNode.id, 'running')
    const finalArtifact = await this.storeArtifact(runId, deliverNode.id, current)
    await this.engine.transitionNode(deliverNode.id, 'succeeded')

    const beforeOutcome = this.engine.getRun(runId) ?? initial
    const manifest = this.buildManifest(beforeOutcome, finalArtifact, gatePassed)
    await this.engine.recordManifest(runId, manifest)
    await this.engine.transitionRun(runId, gatePassed || initial.mode === 'fast' ? 'completed' : 'failed')
    if (!gatePassed && initial.mode !== 'fast') {
      throw new Error(`run '${runId}' failed its review gate after ${policy.maxReviseRounds + 1} reviews`)
    }
    return { run: this.engine.getRun(runId) ?? initial, manifest }
  }

  /** Run one model-backed node through ready → running → succeeded with events. */
  private async runNode(
    runId: RunId,
    type: NodeRecord['type'],
    title: string,
    role: HarnessRole,
    prompt: string,
  ): Promise<{ nodeId: NodeRecord['id']; text: string }> {
    const policy = resolveRunPolicy(this.engine.getRun(runId)?.mode ?? 'fast')
    const node = await this.engine.addNode({
      runId,
      type,
      title,
      role: nodeRoleOf(role),
      maxAttempts: policy.maxNodeAttempts,
      idempotent: true,
    })
    await this.engine.transitionNode(node.id, 'ready')
    await this.engine.transitionNode(node.id, 'running')
    const route = this.settings.snapshot()[role]
    await this.engine.appendPublic(runId, node.id, 'request_started', {
      provider: route.provider,
      model: route.model,
    })
    try {
      const { text, usage } = await this.call(role, prompt)
      if (usage !== undefined) {
        await this.engine.applyUsage(runId, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: 0,
        })
      }
      await this.engine.transitionNode(node.id, 'succeeded')
      return { nodeId: node.id, text }
    } catch (error: unknown) {
      await this.engine.transitionNode(node.id, 'failed')
      await this.engine.transitionRun(runId, 'failed')
      throw error
    }
  }

  /** One provider-neutral model call assembling the streamed text. */
  private async call(role: HarnessRole, prompt: string): Promise<{ text: string; usage: TokenUsage | undefined }> {
    const route = this.settings.snapshot()[role]
    const assembler = new BlockAssembler()
    for await (const chunk of this.provider.stream({
      provider: route.provider,
      model: route.model,
      system: SYSTEM_PROMPTS[role],
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })],
    })) {
      assembler.push(chunk)
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(`model call for role '${role}' ended with ${finish.kind}: ${finish.failure.message}`)
    }
    return {
      text: assembler.blocks()
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n'),
      usage: assembler.usage,
    }
  }

  private reviewPrompt(input: string, text: string): string {
    return [
      `Task: ${input}`,
      `Delivered text:\n${text}`,
      'List defects, or return an empty list. Respond with JSON only in this shape:',
      '{"defects":[{"severity":"major|minor","description":"..."}]}',
    ].join('\n\n')
  }

  private async storeArtifact(runId: RunId, nodeId: NodeRecord['id'], text: string): Promise<ArtifactRecord> {
    const digest = createHash('sha256').update(text).digest('hex')
    const record: ArtifactRecord = {
      id: newArtifactId(),
      runId,
      nodeId,
      kind: 'text',
      mime: 'text/plain',
      size: Buffer.byteLength(text, 'utf8'),
      sha256: digest,
      storageKey: `inline:${digest}`,
    }
    await this.engine.putArtifact(record)
    return record
  }

  private buildManifest(run: RunRecord, artifact: ArtifactRecord, gatePassed: boolean): Manifest {
    return {
      schemaVersion: 1,
      runId: run.id,
      harnessVersion: run.harnessVersion,
      mode: run.mode,
      finalArtifactId: artifact.id,
      gates: { review: gatePassed },
      usage: this.engine.getRun(run.id)?.usage ?? run.usage,
      redacted: true,
    }
  }
}

/** Parse reviewer JSON into defects; malformed output becomes one major defect. */
function parseDefects(text: string): ReviewDefect[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return [{ severity: 'major', description: 'reviewer returned no JSON object' }]
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { defects?: unknown }
    if (!Array.isArray(parsed.defects)) {
      return [{ severity: 'major', description: 'reviewer JSON has no defects array' }]
    }
    return parsed.defects
      .filter((defect): defect is { severity: string; description: string } =>
        typeof defect === 'object' && defect !== null
        && typeof (defect as { description?: unknown }).description === 'string')
      .map(defect => ({
        severity: defect.severity === 'major' ? 'major' as const : 'minor' as const,
        description: defect.description,
      }))
  } catch {
    return [{ severity: 'major', description: 'reviewer returned unparsable JSON' }]
  }
}
