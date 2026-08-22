/**
 * Node executor: policy-bounded runs with retry, cost accounting, and audit.
 * Every model call goes through the shared provider seam and every fact
 * through the durable engine, so a crashed run replays and recovers.
 *
 * @module @deepseek-ai/dsh-harness-foundation/src/executor
 */

import { createHash } from 'node:crypto'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { AuditEntryInput } from './audit.ts'
import { computeCostUsd, evaluateBudget, resolveModelPrice } from './cost.ts'
import type { BudgetPolicy, PricingTable } from './cost.ts'
import { resolveRunPolicy } from './policy.ts'
import type { HarnessProviderService, HarnessRole } from './provider.ts'
import { backoffDelayMs, classifyFailure } from './resilience.ts'
import type { BackoffPolicy } from './resilience.ts'
import type { HarnessSettingsService } from './settings.ts'
import type { ArtifactRecord, Manifest, NodeRecord, RunId, RunRecord } from './spec.ts'
import { newArtifactId } from './spec.ts'
import type { WorkflowEngine } from './workflow.ts'

/** Result of one completed run execution. */
export interface ExecutionOutcome {
  /** Final run record. */
  readonly run: RunRecord
  /** Manifest recorded at delivery. */
  readonly manifest: Manifest
}

/** One structured reviewer finding. */
export interface ReviewDefect {
  /** How much the finding matters. */
  readonly severity: 'major' | 'minor'
  /** What the reviewer objected to. */
  readonly description: string
}

/** Minimal audit sink the executor needs; {@link HarnessAuditService} satisfies it. */
export interface AuditSink {
  /**
   * Append one audit entry.
   * @param entry - the operation to record.
   * @returns resolution after the entry is durable.
   */
  record(entry: AuditEntryInput): Promise<unknown>
}

/** Deployment-varying execution knobs resolved by the owning service. */
export interface ExecutorOptions {
  /** Route prices used to turn token counts into cost. */
  readonly pricing: PricingTable
  /** Daily spend ceiling and warning fraction. */
  readonly budget: BudgetPolicy
  /** Retry backoff bounds. */
  readonly backoff: BackoffPolicy
  /** Audit sink; omitted in compositions that mount no trail. */
  readonly audit?: AuditSink
}

/** Stable reasons the executor refuses to finish a run. */
export type ExecutionFailureCode =
  | 'budget-exhausted'
  | 'provider-blocked'
  | 'provider-unavailable'
  | 'gate-failed'

/** A run the executor stopped, carrying the reason a caller routes on. */
export class WorkflowExecutionError extends Error {
  /**
   * @param code - stable reason the run stopped.
   * @param message - human-readable summary without credential material.
   */
  constructor(readonly code: ExecutionFailureCode, message: string) {
    super(message)
    this.name = 'WorkflowExecutionError'
  }
}

/** One model call that ended in a provider or transport failure. */
class ModelCallFailure extends Error {
  /**
   * @param failure - the adapter's provider-neutral failure facts.
   */
  constructor(readonly failure: LlmFailure) {
    super(failure.message)
    this.name = 'ModelCallFailure'
  }
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
 * Drives one run's nodes through the durable engine: plan, execute, the
 * mode-bounded review loop, and delivery with a manifest.
 */
export class WorkflowExecutor {
  /**
   * @param engine - Durable workflow engine owning all run writes.
   * @param provider - Shared LLM seam for the three roles.
   * @param settings - Role settings snapshots.
   * @param options - Pricing, budget, backoff, and the optional audit sink.
   */
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly provider: HarnessProviderService,
    private readonly settings: HarnessSettingsService,
    private readonly options: ExecutorOptions,
  ) {}

  /**
   * Execute one run end to end. Fast mode delivers after its revise rounds
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
    await this.audit({ eventType: 'workflow_started', actor: 'harness-executor', runId, detail: { mode: initial.mode } })

    try {
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
      const artifact = await this.deliver(runId, current)
      const manifest = this.buildManifest(this.engine.getRun(runId) ?? initial, artifact, gatePassed)
      await this.engine.recordManifest(runId, manifest)

      if (!gatePassed && initial.mode !== 'fast') {
        await this.engine.transitionRun(runId, 'failed')
        await this.audit({
          eventType: 'gate_failed',
          actor: 'harness-executor',
          runId,
          detail: { gate: 'review', defects: defects.length, reviews: policy.maxReviseRounds + 1 },
        })
        throw new WorkflowExecutionError(
          'gate-failed',
          `run '${runId}' failed its review gate after ${policy.maxReviseRounds + 1} reviews`,
        )
      }
      await this.engine.transitionRun(runId, 'completed')
      await this.audit({
        eventType: 'workflow_completed',
        actor: 'harness-executor',
        runId,
        detail: { gatePassed, costUsd: manifest.usage.costUsd },
      })
      return { run: this.engine.getRun(runId) ?? initial, manifest }
    } catch (error: unknown) {
      if (!(error instanceof WorkflowExecutionError) || error.code === 'gate-failed') throw error
      await this.audit({
        eventType: 'workflow_failed',
        actor: 'harness-executor',
        runId,
        detail: { reason: error.code, message: error.message },
      })
      throw error
    }
  }

  /** Deliver the final text: one delivery node plus its stored artifact. */
  private async deliver(runId: RunId, text: string): Promise<ArtifactRecord> {
    const node = await this.engine.addNode({ runId, type: 'deliver', title: 'deliver' })
    await this.engine.transitionNode(node.id, 'ready')
    await this.engine.transitionNode(node.id, 'running')
    const artifact = await this.storeArtifact(runId, node.id, text)
    await this.engine.transitionNode(node.id, 'succeeded')
    return artifact
  }

  /** Run one model-backed node through ready, running, and its outcome. */
  private async runNode(
    runId: RunId,
    type: NodeRecord['type'],
    title: string,
    role: HarnessRole,
    prompt: string,
  ): Promise<{ nodeId: NodeRecord['id']; text: string }> {
    const run = this.engine.getRun(runId)
    const mode = run?.mode ?? 'fast'
    const policy = resolveRunPolicy(mode)
    await this.assertBudget(runId, mode)

    const node = await this.engine.addNode({
      runId,
      type,
      title,
      role: nodeRoleOf(role),
      maxAttempts: policy.maxNodeAttempts,
      idempotent: true,
    })
    await this.engine.transitionNode(node.id, 'ready')
    const route = this.settings.snapshot()[role]

    for (let attempt = 1; attempt <= policy.maxNodeAttempts; attempt += 1) {
      await this.engine.transitionNode(node.id, 'running')
      await this.engine.appendPublic(runId, node.id, 'request_started', {
        provider: route.provider,
        model: route.model,
        attempt,
      })
      try {
        const { text, usage } = await this.call(role, prompt)
        await this.recordUsage(runId, route.provider, route.model, usage)
        await this.engine.transitionNode(node.id, 'succeeded')
        return { nodeId: node.id, text }
      } catch (error: unknown) {
        const failure = failureOf(error)
        const action = classifyFailure(failure.code)
        await this.engine.transitionNode(node.id, 'failed')
        if (action === 'block' || action === 'revise') {
          await this.engine.transitionRun(runId, 'failed')
          await this.audit({
            eventType: 'provider_blocked',
            actor: 'harness-executor',
            runId,
            detail: { code: failure.code, role, action },
          })
          throw new WorkflowExecutionError(
            'provider-blocked',
            `node '${node.id}' cannot proceed: provider reported ${failure.code}`,
          )
        }
        if (attempt === policy.maxNodeAttempts) break
        await this.audit({
          eventType: 'provider_retry',
          actor: 'harness-executor',
          runId,
          detail: { code: failure.code, role, attempt },
        })
        await this.engine.transitionNode(node.id, 'ready')
        await delay(backoffDelayMs(attempt, this.options.backoff, failure.providerRetryAfterMs))
      }
    }

    // Attempts are spent and the failure was retryable: pause for review
    // rather than fail, so a resumed run continues from this node.
    await this.engine.transitionNode(node.id, 'paused')
    await this.engine.transitionRun(runId, 'paused')
    throw new WorkflowExecutionError(
      'provider-unavailable',
      `node '${node.id}' exhausted ${policy.maxNodeAttempts} attempts and is paused for review`,
    )
  }

  /** Refuse to start another model call once the day's ceiling is reached. */
  private async assertBudget(runId: RunId, mode: 'fast' | 'strict'): Promise<void> {
    const verdict = evaluateBudget(this.spentTodayUsd(), this.options.budget, mode)
    if (verdict.state === 'ok') return
    await this.engine.appendPublic(runId, null, 'usage', {
      budgetState: verdict.state,
      limitUsd: Number.isFinite(verdict.limitUsd) ? verdict.limitUsd : null,
      spentUsd: verdict.spentUsd,
    })
    if (verdict.state === 'warning') return
    await this.engine.transitionRun(runId, 'paused')
    await this.audit({
      eventType: 'budget_exceeded',
      actor: 'harness-executor',
      runId,
      detail: { limitUsd: verdict.limitUsd, spentUsd: verdict.spentUsd, mode },
    })
    throw new WorkflowExecutionError(
      'budget-exhausted',
      `run '${runId}' is paused: the daily budget of ${verdict.limitUsd} USD is spent`,
    )
  }

  /** Accumulate one call's tokens and derived cost onto the run. */
  private async recordUsage(
    runId: RunId,
    provider: string,
    model: string,
    usage: TokenUsage | undefined,
  ): Promise<void> {
    if (usage === undefined) return
    const price = resolveModelPrice(this.options.pricing, provider, model)
    await this.engine.applyUsage(runId, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: computeCostUsd(price, usage),
    })
  }

  /** Cost recorded for runs created today, the budget's spend basis. */
  private spentTodayUsd(): number {
    const today = new Date().toISOString().slice(0, 10)
    return this.engine.listRuns()
      .filter(run => run.createdAt.startsWith(today))
      .reduce((total, run) => total + run.usage.costUsd, 0)
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
    if (finish.kind === 'error' || finish.kind === 'aborted') throw new ModelCallFailure(finish.failure)
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

  private async audit(entry: AuditEntryInput): Promise<void> {
    await this.options.audit?.record(entry)
  }
}

/** Await one backoff delay. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Project any thrown value onto provider-neutral failure facts. */
function failureOf(error: unknown): LlmFailure {
  if (error instanceof ModelCallFailure) return error.failure
  const code = (error as { code?: unknown } | null)?.code
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typeof code === 'string' && code.length > 0 ? code : 'UNKNOWN',
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
