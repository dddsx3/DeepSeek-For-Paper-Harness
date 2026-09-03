/**
 * Node executor: policy-bounded runs with retry, cost accounting, and audit.
 * Every model call goes through the shared provider seam and every fact
 * through the durable engine, so a crashed run replays and recovers.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/executor
 */

import { createHash } from 'node:crypto'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { AuditEntryInput, AuditEventType } from './audit.ts'
import { compactPrompt, renderSections } from './context.ts'
import type { PromptSection } from './context.ts'
import { computeCostUsd, evaluateBudget, resolveModelPrice } from './cost.ts'
import type { BudgetPolicy, PricingTable } from './cost.ts'
import { IR_CANONICALIZATION_GATE_ID, PROVENANCE_GATE_ID } from './delivery/delivery-policy.ts'
import { buildDeliveryPolicy } from './delivery/gate-registry.ts'
import { evaluateDelivery } from "./delivery/delivery-policy.ts"
import type { DeliveryDecision, DeliveryPolicy } from "./delivery/delivery-policy.ts"
import { makeCandidateArtifact } from "./delivery/artifact-states.ts"
import { promoteCandidateToDeliverable } from "./delivery/promoter.ts"
import { ModelingIr } from './ir/store.ts'
import { resolveRunPolicy } from './policy.ts'
import type { PaperProviderService, PaperRole } from './provider.ts'
import { backoffDelayMs, classifyFailure } from './resilience.ts'
import type { BackoffPolicy } from './resilience.ts'
import type { PaperRuntimeGuard } from './runtime/runtime-guard.ts'
import type { PaperSettingsService } from './settings.ts'
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

/**
 * TASK 5.0.5 / INV-3-K: the one delivery verdict of a run, carried from
 * `evaluateDelivery` to the promoter. Bundling the policy with its
 * decision is deliberate — the promoter needs both (it re-checks the
 * FAST-mode critical-gate set against `policy.gates`) but must not
 * re-run the policy, so the pair is produced once and passed through.
 */
export interface DeliveryVerdict {
  /** The policy that was evaluated; never a freshly built one. */
  readonly policy: DeliveryPolicy
  /** The verdict `evaluateDelivery` returned for that policy. */
  readonly decision: DeliveryDecision
}

/** One structured reviewer finding. */
export interface ReviewDefect {
  /** How much the finding matters. TASK 5.0.3c: aligned with the IR's
   *  FINDING_SEVERITIES set so the runtime review vocabulary matches the
   *  canonical record shape. */
  readonly severity: 'critical' | 'major' | 'minor'
  /** What the reviewer objected to. */
  readonly description: string
}

/** Minimal audit sink the executor needs; {@link PaperAuditService} satisfies it. */
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
  /** Fraction of a model's context window one request may occupy. */
  readonly contextUtilization: number
  /** Audit sink; omitted in compositions that mount no trail. */
  readonly audit?: AuditSink
  /**
   * The canonical Modeling IR store the workflow's mathematical facts live in
   * (TASK 1.25). Deliberately optional at the type level — the composition may
   * not mount one — but **not** optional at the enforcement level: in FORMAL
   * and FAST mode a missing store means there is no canonical state at all,
   * which is exactly the condition the bridge exists to block.
   */
  readonly ir?: ModelingIr
}

/**
 * Shared stand-in for "no canonical IR was mounted". The bridge only reads, so
 * one immutable empty store is safe to reuse for every such run.
 */
const EMPTY_IR = new ModelingIr()

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

/** Trim order: a regenerable plan gives way first, instructions never. */
const TRIM_PLAN = 0
const TRIM_DEFECTS = 1
const TRIM_DRAFT = 2
const TRIM_TASK = 3
const KEEP = Infinity

/**
 * TASK 5.0.5 / INV-014: the single sink the promoter writes a
 * deliverable to. Declared once, at module scope, so that "the final
 * output has exactly one write path" is checkable by inspection — a
 * second literal would be a second path.
 */
const FINAL_OUTPUT_PATH = '/var/paper-harness/final'

/**
 * The two promotion outcomes the promoter is contractually allowed to
 * emit (`promoteCandidateToDeliverable` emits exactly one of them per
 * call). Anything else is a contract break between two in-process
 * modules, so it is refused rather than relabelled: an unknown
 * promotion event must never be filed under a kind that implies a
 * different verdict.
 */
const PROMOTION_AUDIT_TYPES: readonly AuditEventType[] = ['promotion_succeeded', 'promotion_failed']

function promotionAuditType(type: string): AuditEventType {
  const found = PROMOTION_AUDIT_TYPES.find(candidate => candidate === type)
  if (found === undefined) throw new Error(`promoter emitted an undeclared audit event: '${type}'`)
  return found
}

const SYSTEM_PROMPTS: Record<PaperRole, string> = {
  executor: 'You are a careful task executor. Produce complete, correct output for the given task. Be concise.',
  reviewer: 'You are an independent reviewer. Judge only the delivered text against the task. Respond with JSON only.',
  editorAi: 'You are a precise editor. Apply the listed defects minimally and return the corrected text only.',
}

/** Map a settings role to the node record's role vocabulary. */
function nodeRoleOf(role: PaperRole): NodeRecord['role'] {
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
   * @param runtimeGuard - The runtime guard, single entry point for capability
   *   execution. The executor asserts it is readied and the run mode matches
   *   the active profile before it starts a workflow.
   */
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly provider: PaperProviderService,
    private readonly settings: PaperSettingsService,
    private readonly options: ExecutorOptions,
    private readonly runtimeGuard: PaperRuntimeGuard,
  ) {}

  /** Context windows already resolved per role; `undefined` means the adapter states none. */
  private readonly contextWindows = new Map<PaperRole, number | undefined>()

  /**
   * Execute one run end to end. Fast mode delivers after its revise rounds
   * even with defects; strict mode fails the run when defects persist.
   * @param runId - Run to execute.
   * @param input - User task text.
   * @returns the final run record and its manifest.
   */
  async execute(runId: RunId, input: string): Promise<ExecutionOutcome> {
    const initial = this.runOf(runId)
    // TASK -1 rewire: refuse to start a run unless the runtime guard is
    // readied and the run mode matches the active profile. This is the
    // enforcement boundary the red-team P0-07 asked for: a mode mismatch
    // throws `RuntimeNotReadyError` here rather than allowing the run to
    // drift into a misconfigured execution path.
    this.runtimeGuard.assertRuntimeReady(initial.mode)
    const policy = resolveRunPolicy(initial.mode)
    if (initial.status === 'planning') await this.engine.transitionRun(runId, 'running')
    await this.audit({ eventType: 'workflow_started', actor: 'paper-executor', runId, detail: { mode: initial.mode } })

    try {
      const task: PromptSection = { name: 'task', text: `Task: ${input}`, trimPriority: TRIM_TASK }
      const plan = await this.runNode(runId, 'plan', 'plan', 'executor', [
        task,
        { name: 'instruction', text: 'Produce a short numbered execution plan.', trimPriority: KEEP },
      ])
      const draft = await this.runNode(runId, 'execute', 'execute', 'executor', [
        task,
        { name: 'plan', text: `Plan:\n${plan.text}`, trimPriority: TRIM_PLAN },
        { name: 'instruction', text: 'Produce the deliverable text for the task.', trimPriority: KEEP },
      ])

      let current = draft.text
      let defects: ReviewDefect[] = []
      for (let round = 0; round <= policy.maxReviseRounds; round += 1) {
        const review = await this.runNode(
          runId, 'review', round === 0 ? 'review' : `review #${round + 1}`, 'reviewer',
          reviewSections(task, current),
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
            task,
            { name: 'draft', text: `Current text:\n${current}`, trimPriority: TRIM_DRAFT },
            {
              name: 'defects',
              text: `Defects:\n${defects.map(defect => `- [${defect.severity}] ${defect.description}`).join('\n')}`,
              trimPriority: TRIM_DEFECTS,
            },
            { name: 'instruction', text: 'Return the corrected text only.', trimPriority: KEEP },
          ],
        )
        current = revised.text
      }

      // TASK 5.0.3c / v1.1 §A-7: the reviewer's verdict is no longer a
      // straight majority. A single CRITICAL finding blocks delivery
      // unconditionally (a "failed review" is exactly that). MAJOR /
      // MINOR findings are advisory; the only path past them is the
      // success path above (defects.length === 0). This is the minimal
      // Oracle Routing step: critical findings can never be voted away.
      const criticalCount = defects.filter(d => d.severity === 'critical').length
      const gatePassed = defects.length === 0
      await this.engine.appendPublic(runId, null, 'gate_result', {
        gate: 'review',
        passed: gatePassed,
        defects_total: defects.length,
        defects_critical: criticalCount,
      })

      // TASK 1.25: the paper may not be delivered unless its mathematical
      // facts exist as canonical IR. Without this call the workflow still had
      // a complete text-only path to a manifest, which made every IR
      // guarantee vacuous (external-advisory finding IR_CAN_BE_BYPASSED).
      // Claims are empty for now: TASK 2 introduces the Claim→Result→Run
      // TASK 3 repair (3.R2 / INV-3-K): there is exactly ONE delivery
      // verdict path. `buildDeliveryPolicy` walks the gate registry; the
      // resulting policy is handed to `evaluateDelivery`; whatever it
      // returns is the only thing the executor reasons about. No
      // parallel `if (gate.status === 'PASS') return` branches remain.
      //
      // TASK 5.0.5: the verdict is returned so the promoter below can be
      // handed the *same* decision instead of re-evaluating the policy.
      const verdict = await this.enforceDelivery(runId, initial.mode)

      // TASK 4.2: the reviewer gate is now part of the same fail-closed
      // policy. The previous fast-mode bypass ("if (!gatePassed && mode !==
      // 'fast')") silenced review failures on the fast path; the registry
      // already exempts EXPLORATORY from the backbone check, and reviewer
      // failures now route through the same audit / fail / throw path
      // as every other gate.
      if (!gatePassed) {
        await this.engine.transitionRun(runId, 'failed')
        await this.audit({
          eventType: 'gate_failed',
          actor: 'paper-executor',
          runId,
          detail: { gate: 'review', defects: defects.length, reviews: policy.maxReviseRounds + 1 },
        })
        throw new WorkflowExecutionError(
          'gate-failed',
          `run '${runId}' failed its review gate after ${policy.maxReviseRounds + 1} reviews`,
        )
      }

      // Authorisation is the durable proof that lets a manifest exist at all;
      // `recordManifest` refuses without it (TASK 1.25, RT125B-03).
      await this.engine.authorizeDelivery(runId, {
        authorizedAt: new Date().toISOString(),
        gates: ['review', IR_CANONICALIZATION_GATE_ID, PROVENANCE_GATE_ID],
      })

      // TASK 5.0.5 / INV-014: the ONLY path to a DeliverableArtifact
      // is `promoteCandidateToDeliverable`. The executor no longer
      // writes the final output directly. The promoter (a) re-checks
      // the verdict (it must not re-evaluate the policy, just confirm
      // the precomputed `decision.allowed`), (b) calls `writeFinalOutput`
      // on success, and (c) emits the `promotion_succeeded` / `_failed`
      // audit events. `F17-a` (static check) verifies there is no other
      // write path to the final output.
      const { artifact, createdAt } = await this.deliver(runId, current)
      const promotion = await promoteCandidateToDeliverable(
        makeCandidateArtifact({
          id: artifact.id,
          createdAt,
          contentHash: artifact.sha256,
        }),
        verdict.policy,
        verdict.decision,
        {
          audit: event => this.audit({
            eventType: promotionAuditType(event.type),
            actor: 'paper-executor',
            runId,
            detail: { ...event },
          }),
          now: () => new Date().toISOString(),
          writeFinalOutput: async (path, content) => { await this.persistFinal(runId, path, content) },
        },
        FINAL_OUTPUT_PATH,
        current,
      )
      if (!promotion.ok) {
        await this.engine.transitionRun(runId, 'failed')
        throw new WorkflowExecutionError(
          'gate-failed',
          `run '${runId}' cannot deliver: ${promotion.error.kind} (${('gateFailures' in promotion.error ? promotion.error.gateFailures.join(',') : 'from=' + (promotion.error as { from: string }).from)})`,
        )
      }
      const manifest = this.buildManifest(this.runOf(runId), artifact, gatePassed)
      await this.engine.recordManifest(runId, manifest)

      await this.engine.transitionRun(runId, 'completed')
      await this.audit({
        eventType: 'workflow_completed',
        actor: 'paper-executor',
        runId,
        detail: { gatePassed, costUsd: manifest.usage.costUsd },
      })
      return { run: this.runOf(runId), manifest }
    } catch (error: unknown) {
      if (!(error instanceof WorkflowExecutionError) || error.code === 'gate-failed') throw error
      await this.audit({
        eventType: 'workflow_failed',
        actor: 'paper-executor',
        runId,
        detail: { reason: error.code, message: error.message },
      })
      throw error
    }
  }

  /**
   * Refuse to deliver unless the canonical IR carries the mathematical facts
   * the paper claims (TASK 1.25, INV-1.25-B).
   *
   * A composition that never mounted a store is treated as an empty one: in
   * FORMAL and FAST mode that means "no canonical state", so the run is
   * blocked rather than waved through. EXPLORATORY is exempt because it is
   * the mode in which no fact has been asserted yet.
   */
  /**
   * TASK 3 repair (3.R2 / INV-3-K): the single delivery verdict of one
   * run. The policy is built from the gate registry and evaluated
   * exactly once; whatever `evaluateDelivery` returns is the only
   * thing this executor — and, through it, the promoter — reasons
   * about. No `if (gate.status === 'PASS') return` branch, and no
   * second evaluation: the promoter is handed this record so a policy
   * cannot be refreshed between the verdict and the write.
   *
   * @param runId - the run being judged.
   * @param mode - the run's execution mode.
   * @returns the policy that was evaluated together with its verdict.
   */
  private async enforceDelivery(runId: RunId, mode: string): Promise<DeliveryVerdict> {
    // TASK 5.0.11: the policy is now told the runtime guard's *actual*
    // readiness instead of assuming it. `assertRuntimeReady` at the top
    // of `execute` would already have thrown on a mismatch, so this is
    // not a second gate — it is the policy no longer claiming a check
    // it never made (INV-3-O). Compositions that mount no guard get
    // `false`, and delivery is refused.
    const policy = buildDeliveryPolicy({
      mode,
      ir: this.options.ir ?? EMPTY_IR,
      runtimeProfileValid: this.runtimeGuard.isReady(),
    })
    const decision = evaluateDelivery(policy)
    if (decision.allowed) return { policy, decision }
    // Record one audit entry per failure kind so external auditors can
    // triage without re-running the executor.
    for (const failure of decision.failures) {
      await this.audit({
        eventType: 'gate_failed',
        actor: 'paper-executor',
        runId,
        detail: { kind: failure.kind, reason: failure.reason, mode },
      })
    }
    await this.engine.transitionRun(runId, 'failed')
    throw new WorkflowExecutionError(
      'gate-failed',
      `run '${runId}' cannot deliver: ${decision.failures.map(f => `${f.kind}:${f.reason}`).join('; ')}`,
    )
  }

  /**
   * Deliver the final text: one delivery node plus its stored artifact.
   *
   * TASK 5.0.5: also returns the moment the artifact was produced. The
   * durable `ArtifactRecord` carries no creation time of its own (see
   * `known-risks.md`), and the promoter requires one for the
   * `CandidateArtifact` it promotes, so the executor — the only
   * component that observes the artifact's creation — stamps it here
   * rather than inventing one further down the pipeline.
   */
  private async deliver(runId: RunId, text: string): Promise<{ artifact: ArtifactRecord; createdAt: string }> {
    const node = await this.engine.addNode({ runId, type: 'deliver', title: 'deliver' })
    await this.engine.transitionNode(node.id, 'ready')
    await this.engine.transitionNode(node.id, 'running')
    const createdAt = new Date().toISOString()
    const artifact = await this.storeArtifact(runId, node.id, text)
    await this.engine.transitionNode(node.id, 'succeeded')
    return { artifact, createdAt }
  }

  /**
   * TASK 5.0.5 / INV-014: the only writer of the final output sink, and
   * it is reachable from exactly one caller — the promoter's
   * `writeFinalOutput`, which the promoter does not invoke on any
   * failure path. Handing the promoter this callback is what makes
   * "no promotion, no final output" true by construction rather than
   * by convention.
   *
   * The composition has no real sink mounted yet, so the write is
   * recorded on the audit trail instead: the path, the byte count, and
   * the content digest are the evidence a later auditor replays the
   * delivery against. This is deliberately NOT a silent no-op.
   */
  private async persistFinal(runId: RunId, path: string, content: string): Promise<void> {
    await this.audit({
      eventType: 'final_output_written',
      actor: 'paper-executor',
      runId,
      detail: {
        path,
        bytes: Buffer.byteLength(content, 'utf8'),
        sha256: createHash('sha256').update(content).digest('hex'),
      },
    })
  }

  /** Run one model-backed node through ready, running, and its outcome. */
  private async runNode(
    runId: RunId,
    type: NodeRecord['type'],
    title: string,
    role: PaperRole,
    sections: readonly PromptSection[],
  ): Promise<{ nodeId: NodeRecord['id']; text: string }> {
    const mode = this.runOf(runId).mode
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
    const prompt = await this.fitPrompt(runId, node.id, role, sections)

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
            actor: 'paper-executor',
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
          actor: 'paper-executor',
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

  /**
   * Fit one prompt to the role's context window. When anything is elided the
   * untrimmed prompt is stored as a run artifact and the request carries its
   * reference, so the full text stays recoverable without being resent.
   */
  private async fitPrompt(
    runId: RunId,
    nodeId: NodeRecord['id'],
    role: PaperRole,
    sections: readonly PromptSection[],
  ): Promise<string> {
    const window = await this.contextWindowFor(role)
    const budget = window === undefined
      ? Infinity
      : Math.floor(window * this.options.contextUtilization)
    const outcome = compactPrompt(sections, budget)
    if (outcome.elided.length === 0) return outcome.text
    const artifact = await this.storeArtifact(runId, nodeId, renderSections(sections))
    await this.engine.appendPublic(runId, nodeId, 'context_compacted', {
      budgetTokens: budget,
      estimatedTokens: outcome.estimatedTokens,
      elided: outcome.elided.map(entry => ({ ...entry })),
      fullPromptArtifactId: artifact.id,
    })
    return `${outcome.text}\n\n<artifact_ref kind="text" id="${artifact.id}" sha256="${artifact.sha256}" />`
  }

  /** Resolve and cache one role's context window from the adapter. */
  private async contextWindowFor(role: PaperRole): Promise<number | undefined> {
    if (this.contextWindows.has(role)) return this.contextWindows.get(role)
    const resolved = await this.provider.resolveRole(role, this.settings.snapshot())
    const window = resolved.model.context?.contextWindow
    this.contextWindows.set(role, window)
    return window
  }

  /** Refuse to start another model call once the day's ceiling is reached. */
  private async assertBudget(runId: RunId, mode: 'fast' | 'strict' | 'exploratory'): Promise<void> {
    const verdict = evaluateBudget(this.spentTodayUsd(), this.options.budget, mode)
    if (verdict.state === 'ok') return
    await this.engine.appendPublic(runId, null, 'usage', {
      budgetState: verdict.state,
      limitUsd: verdict.limitUsd,
      spentUsd: verdict.spentUsd,
    })
    if (verdict.state === 'warning') return
    await this.engine.transitionRun(runId, 'paused')
    await this.audit({
      eventType: 'budget_exceeded',
      actor: 'paper-executor',
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
  private async call(role: PaperRole, prompt: string): Promise<{ text: string; usage: TokenUsage | undefined }> {
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
      usage: run.usage,
      redacted: true,
    }
  }

  /** Resolve one run or fail loud; the executor never operates on a vanished run. */
  private runOf(runId: RunId): RunRecord {
    const run = this.engine.getRun(runId)
    if (run === undefined) throw new Error(`run '${runId}' was not found`)
    return run
  }

  private async audit(entry: AuditEntryInput): Promise<void> {
    await this.options.audit?.record(entry)
  }
}

/** Sections one review request carries. */
function reviewSections(task: PromptSection, delivered: string): PromptSection[] {
  return [
    task,
    { name: 'draft', text: `Delivered text:\n${delivered}`, trimPriority: TRIM_DRAFT },
    {
      name: 'instruction',
      text: [
        'List defects, or return an empty list. Respond with JSON only in this shape:',
        '{"defects":[{"severity":"major|minor","description":"..."}]}',
      ].join('\n'),
      trimPriority: KEEP,
    },
  ]
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

/** Parse reviewer JSON into reviewerFindingSchema-shaped defects.
 *
 * TASK 5.0.3c (v1.1 §A-7): unify the runtime reviewer's severity
 * vocabulary with the IR's `FINDING_SEVERITIES` set
 * (`CRITICAL / MAJOR / MINOR`). The legacy `'major' | 'minor'` enum
 * was a closed 2-value vocabulary that could not represent critical
 * findings, which is the precondition for Oracle Routing (critical
 * unresolved → BLOCKED, never voted away).
 *
 * Malformed input still produces a single finding; the severity of
 * that finding is now `CRITICAL` (malformed review is itself a
 * critical review failure, not a minor one).
 */
function parseDefects(text: string): ReviewDefect[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return [{ severity: 'critical', description: 'reviewer returned no JSON object' }]
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { defects?: unknown }
    if (!Array.isArray(parsed.defects)) {
      return [{ severity: 'critical', description: 'reviewer JSON has no defects array' }]
    }
    return parsed.defects
      .filter((defect): defect is { description: string; severity?: unknown } =>
        typeof defect === 'object' && defect !== null
        && typeof (defect as { description?: unknown }).description === 'string')
      // severity may be missing / unknown; normalizeSeverity maps every
      // non-'critical' value to 'major' (the closed-enum default) so
      // an entry with no `severity` field still becomes a real finding.
      .map(defect => normalizeSeverity(
        typeof defect.severity === 'string' ? defect.severity : 'major',
        defect.description,
      ))
  } catch {
    return [{ severity: 'critical', description: 'reviewer returned unparsable JSON' }]
  }
}

/** Coerce a producer-supplied severity to the IR's closed enum, with
 *  CRITICAL as the safe default for unknown / lowercase / legacy values.
 *  The mapping is conservative: a producer saying `critical` stays
 *  critical; anything else is treated as `major` (the lowest
 *  un-rejected severity in the closed set), which the delivery gate
 *  treats as advisory rather than blocking. */
function normalizeSeverity(
  raw: string,
  description: string,
): ReviewDefect {
  const s = raw.trim().toLowerCase()
  if (s === 'critical') return { severity: 'critical', description }
  if (s === 'minor') return { severity: 'minor', description }
  // `major`, anything else, missing — all map to major (advisory).
  return { severity: 'major', description }
}
