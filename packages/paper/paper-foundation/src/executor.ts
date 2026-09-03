/**
 * Node executor: policy-bounded runs with retry, cost accounting, and audit.
 * Every model call goes through the shared provider seam and every fact
 * through the durable engine, so a crashed run replays and recovers.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/executor
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
import { parseModelContainer, produceContainerInto } from './produce/ir-producer.ts'
import { produceRunExecution } from './produce/execution-producer.ts'
import { produceInterpretation } from './produce/interpretation-producer.ts'
import { renderReportV2 } from './produce/report-renderer.ts'
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
  /** Stable id the review protocol carries across rounds (E4a): later
   *  verdicts reference this id in `resolved` — a defect with no id can
   *  never be resolved and never expires. */
  readonly id: string
  /** How much the finding matters. E4b: three-value vocabulary aligned
   *  with FINDING_SEVERITIES (critical | major | minor); an unknown
   *  severity is fail-closed (parsed as critical), never downgraded. */
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
  /**
   * 5.0-R (R5, author-delegated decision A): the root directory under which
   * a promoted final output is REALLY written, at
   * `<finalOutputRoot>/<runId>/final/<basename>`. When absent the executor
   * keeps the previous audit-only behaviour with the path labelled
   * "(no sink mounted)" — promotion no longer "to the void" once a
   * composition mounts a sink; every real deployment should.
   */
  readonly finalOutputRoot?: string
  /**
   * P2-1 (D7 obligation): the ONLY code-run configuration a composition may
   * inject. `command`/`entryFile` are deployment-owned — the model NEVER
   * chooses a runner command (task book P2 禁4). When produceFromExecute
   * meets a container with `code`, the executor requires this option; its
   * executable must be in the built-in allow-list (node/python by default).
   */
  readonly produceRun?: {
    readonly command: ReadonlyArray<string>
    readonly entryFile: string
    /** descriptive environment string recorded on the RunArtifact. */
    readonly environment: string
    readonly timeoutMs: number
    /** default allow-list when omitted: node, python, python3. */
    readonly allowExecutable?: ReadonlyArray<string>
  }
  /**
   * P1-1: when true, the EXECUTE node's output MUST be an ir-container-v1
   * typed-JSON (structured-output producer). The producer validates and
   * writes the model-declared kinds into `ir`; a refused container counts
   * as a failed EXECUTE attempt (retried up to the node ceiling, then the
   * run is BLOCKED with the producer's reason). Requires a mounted `ir`.
   * Default false keeps the pre-P1 free-prose EXECUTE protocol intact.
   */
  readonly produceFromExecute?: boolean
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
   * P2-1: code-bytes loaders per run, captured when the EXECUTE stage runs
   * the production chain, forwarded to the FORMAL delivery policy so S-007
   * checks the bytes that ACTUALLY executed (synchronous contract).
   */
  readonly #codeLoaders: Map<string, (ref: string) => string> = new Map()

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
      // E4a (P2, sign-off A): defects accumulate ACROSS rounds. A defect
      // leaves the set ONLY through an explicit `resolved` id in a later
      // review verdict; a clean-looking review that resolves nothing cannot
      // silently age a CRITICAL out — critical never expires without its
      // resolved record. Review rounds carry an unresolved-defect ledger and
      // ask the reviewer to adjudicate it (remaining/resolved) instead of
      // re-discovering defects from scratch each round.
      const unresolved = new Map<string, ReviewDefect>()
      let advisoryDefects: ReviewDefect[] = []
      let gatePassed = false
      for (let round = 0; round <= policy.maxReviseRounds; round += 1) {
        const review = await this.runNode(
          runId, 'review', round === 0 ? 'review' : `review #${round + 1}`, 'reviewer',
          reviewSections(task, current, [...unresolved.values()]),
        )
        const report = parseReviewReport(review.text, [...unresolved.keys()])
        for (const id of report.resolved) unresolved.delete(id)
        for (const defect of report.defects) {
          const prior = unresolved.get(defect.id)
          if (prior !== undefined && prior.severity === 'critical' && defect.severity !== 'critical') {
            // Fail-closed: a re-reported critical cannot be downgraded in
            // place — the only legal exit for a critical is `resolved`.
            unresolved.set(defect.id, { ...prior, description: defect.description })
          } else {
            unresolved.set(defect.id, defect)
          }
        }
        for (const defect of unresolved.values()) {
          await this.engine.appendPublic(runId, review.nodeId, 'defect', {
            severity: defect.severity,
            description: defect.description,
            defectId: defect.id,
          })
        }
        // E4a: a resolved record is the ONLY way a defect leaves the ledger.
        // When nothing is unresolved the paper is clean; otherwise the editor
        // gets the remaining rounds to fix it and the reviewer adjudicates
        // again — the gate below decides at the ceiling, and a CRITICAL with
        // no resolved record never expires.
        if (unresolved.size === 0) {
          gatePassed = true
          break
        }
        if (round === policy.maxReviseRounds) break
        const revised = await this.runNode(
          runId, 'revise', `revise #${round + 1}`, 'editorAi',
          [
            task,
            { name: 'draft', text: `Current text:\n${current}`, trimPriority: TRIM_DRAFT },
            {
              name: 'defects',
              text: `Defects:\n${[...unresolved.values()].map(defect => `- [${defect.id}] [${defect.severity}] ${defect.description}`).join('\n')}`,
              trimPriority: TRIM_DEFECTS,
            },
            { name: 'instruction', text: 'Return the corrected text only.', trimPriority: KEEP },
          ],
        )
        current = revised.text
      }

      // E4c (P2, sign-off A): fast mode may deliver with MINOR defects left
      // (advisory, audited); MAJOR/CRITICAL still block. strict / formal /
      // exploratory keep zero tolerance — any unresolved defect blocks.
      if (!gatePassed && initial.mode === 'fast') {
        const outstanding = [...unresolved.values()]
        if (outstanding.every(d => d.severity === 'minor')) {
          gatePassed = true
          advisoryDefects = outstanding
        }
      }
      if (!gatePassed && initial.mode !== 'fast') {
        gatePassed = unresolved.size === 0
      }
      const outstandingList = [...unresolved.values()]
      const criticalCount = outstandingList.filter(d => d.severity === 'critical').length
      await this.engine.appendPublic(runId, null, 'gate_result', {
        gate: 'review',
        passed: gatePassed,
        defects_total: outstandingList.length,
        defects_critical: criticalCount,
        advisory: advisoryDefects.length,
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
          detail: {
            gate: 'review',
            defects: outstandingList.length,
            reviews: policy.maxReviseRounds + 1,
          },
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
      const manifest = this.buildManifest(this.runOf(runId), artifact, gatePassed, advisoryDefects)
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
   * P2-1 (D7 obligation): run the FULL production chain inside the EXECUTE
   * stage when the model's container carries executable code.
   *
   * Sequence: container contract kinds are already in the store (P1-1);
   * here the code REALLY runs (produceRunExecution — the deployment-owned
   * runnerCommand is the ONLY possible command, the container may only
   * declare outputBasenames/seed), the ExecutionRecord is captured, the
   * model's dry-pass interpretation is minted against the REAL output
   * bytes (jsonPath must resolve to a finite number or the chain refuses
   * with zero partial Result writes), and the v1 template report becomes
   * the EXECUTE deliverable text.
   *
   * @returns the rendered report text plus a synchronous code loader the
   *          FORMAL delivery policy uses for S-007.
   */
  private async runProductionChain(
    runId: RunId,
    ir: ModelingIr,
    container: {
      readonly code?: string
      readonly run?: Record<string, unknown>
      readonly interpretations?: Record<string, unknown>
      readonly narrative?: Record<string, unknown>
      readonly entries: ReadonlyArray<{ kind: string; value: Record<string, unknown> }>
    },
  ): Promise<
    { ok: true; reportText: string; loadCode: (ref: string) => string }
    | { ok: false; code: string; reason: string }
  > {
    const runIdText = String(runId)
    const runDecl = container.run ?? {}
    const allowedRunKeys = new Set(['outputBasenames', 'seed'])
    for (const key of Object.keys(runDecl)) {
      if (!allowedRunKeys.has(key)) {
        return { ok: false, code: 'PRODUCE_RUN_DECLARATION_INVALID', reason: `container run block may only declare ${[...allowedRunKeys].join(', ')}; '${key}' is not deployment-negotiable (the model never chooses a runnerCommand — P2 禁4)` }
      }
    }
    const basenames = runDecl['outputBasenames']
    if (!Array.isArray(basenames) || basenames.length === 0 || basenames.some(b => typeof b !== 'string' || b.length === 0)) {
      return { ok: false, code: 'PRODUCE_RUN_DECLARATION_INVALID', reason: "container 'run.outputBasenames' must be a non-empty array of file basenames the code will write" }
    }
    const produceRun = this.options.produceRun
    if (produceRun === undefined) {
      return { ok: false, code: 'CODE_RUN_NOT_CONFIGURED', reason: 'EXECUTE code was declared but options.produceRun (deployment-owned runner) is not mounted' }
    }
    const executable = basename(String(produceRun.command[0] ?? ''))
    // A schema-coerced empty allow-list means "use the built-in defaults"
    // (an explicit empty list is not a valid policy).
    const allowSrc = produceRun.allowExecutable !== undefined && produceRun.allowExecutable.length > 0
      ? produceRun.allowExecutable
      : ['node', 'python', 'python3']
    const allow = new Set(allowSrc)
    if (!allow.has(executable)) {
      return { ok: false, code: 'CODE_RUN_NOT_CONFIGURED', reason: `deployment runner command '${produceRun.command.join(' ')}' executes '${executable}' which is outside the code-run allow-list [${[...allow].join(', ')}]` }
    }
    const modelRefEntry = [...container.entries].find(e => e.kind === 'ModelSpec')
    const modelRef = modelRefEntry === undefined
      ? undefined
      : String((modelRefEntry['value'] as { model_id?: unknown }).model_id ?? '')
    if (modelRefEntry === undefined || modelRef === undefined || modelRef.length === 0) {
      return { ok: false, code: 'PRODUCE_CHAIN_NO_MODEL', reason: 'a container with code must declare a ModelSpec with a model_id (the run is an instance of it)' }
    }
    const outputBasenames = basenames as string[]
    const outputLocators = outputBasenames.map(b => `file:///runs/${runIdText}/${b}`)
    const seedRaw = runDecl['seed']
    // INV-3-D: FORMAL critical runs need a non-null seed; only a numeric
    // integer is a reproducible declaration (a string seed would be a
    // "no seed recorded" statement in disguise).
    const seed = typeof seedRaw === 'number' && Number.isInteger(seedRaw) ? seedRaw : null

    const executed = await produceRunExecution({
      ir,
      runId: runIdText,
      modelRef,
      codeText: container.code ?? '',
      environment: produceRun.environment,
      seed,
      outputBasenames,
      outputLocators,
      runnerCommand: [...produceRun.command],
      runnerEntryFile: produceRun.entryFile,
      timeoutMs: produceRun.timeoutMs,
    })
    if (!executed.ok) {
      return { ok: false, code: executed.code, reason: `code run refused: ${executed.reason}` }
    }
    await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'RunArtifact', id: executed.runArtifactId, nodeId: 'execute', stage: 'code-run' } })
    await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'ExecutionRecord', id: executed.executionId, nodeId: 'execute', stage: 'code-run' } })

    let reportText: string
    let figureAssets: Array<{ figureId: string; data_hash: string; svg: string }> = []
    const interpretations = container.interpretations
    if (interpretations !== undefined) {
      // Interpretation sources may name the file basename; resolve them to
      // the run's canonical locators before the dry pass.
      const normalized = normalizeInterpretationLocators(interpretations, outputBasenames, outputLocators)
      if (!normalized.ok) {
        return { ok: false, code: normalized.code, reason: normalized.reason }
      }
      const minted = produceInterpretation({
        ir,
        runId: runIdText,
        interpretations: normalized.value,
        outputs: executed.outputs,
      })
      if (!minted.ok) {
        return { ok: false, code: minted.code, reason: `interpretation refused: ${minted.reason}` }
      }
      for (const id of minted.resultIds) {
        await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'Result', id, nodeId: 'execute', stage: 'interpretation' } })
      }
      for (const id of minted.claimIds) {
        await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'Claim', id, nodeId: 'execute', stage: 'interpretation' } })
      }
      for (const figure of minted.figures) {
        await this.audit({ eventType: 'ir_entry_written', actor: 'paper-executor', runId, detail: { kind: 'FigureSpec', id: figure.figureId, nodeId: 'execute', stage: 'interpretation' } })
        figureAssets.push(figure)
      }
    }

    // v2 template report (P2-4): result table injected from the IR, the
    // conclusion may be structured slots or guarded prose, and any minted
    // figure's REAL rendered bytes are embedded with provenance.
    const snapshot = ModelingIr.snapshot(ir)
    const results = snapshot === null
      ? []
      : [...snapshot.values()]
          .filter(r => r.kind === 'Result')
          .map(r => r.value)
    const figureDecls = (container.interpretations?.['figures'] as Array<{ figure_id: string; caption?: string; data_refs?: ReadonlyArray<string> }> | undefined) ?? []
    const rendered = renderReportV2({
      title: String((container.narrative?.['title'] as string | undefined) ?? 'Paper deliverable (executor production chain)'),
      results: results.map(r => ({
        result_id: r.result_id,
        name: r.name,
        value: r.value,
        unit: r.unit,
        uncertainty: r.uncertainty,
      })),
      narrative: container.narrative ?? {},
      figures: figureAssets.map((asset) => {
        const decl = figureDecls.find(d => d.figure_id === asset.figureId)
        return {
          figureId: asset.figureId,
          ...(decl?.caption === undefined ? {} : { caption: decl.caption }),
          svg: asset.svg,
          data_hash: asset.data_hash,
          resultRefs: decl?.data_refs ?? [],
          rendererVersion: 'okabe-ito-v1/svg',
        }
      }),
    })
    if (!rendered.ok) {
      return { ok: false, code: rendered.code, reason: `report render refused: ${rendered.reason}` }
    }
    reportText = rendered.text
    const codeText = container.code ?? ''
    return { ok: true, reportText, loadCode: () => codeText }
  }

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
      // P2-1: when the EXECUTE production chain captured the actual code
      // bytes, hand them to the delivery policy so S-007 runs (synchronous
      // loader contract); otherwise the IR-only checks stay.
      ...(this.#codeLoaders.has(String(runId))
        ? { loadCode: this.#codeLoaders.get(String(runId))! }
        : {}),
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
    const bytes = Buffer.byteLength(content, 'utf8')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const root = this.options.finalOutputRoot
    const resolvedPath = root === undefined
      ? null
      : join(root, runId, 'final', basename(path))
    if (resolvedPath !== null) {
      try {
        await mkdir(dirname(resolvedPath), { recursive: true })
        await writeFile(resolvedPath, content, 'utf8')
      } catch (error) {
        // A failed real write is a failed promotion: the promoter's
        // contract says a DELIVERABLE artifact means the file exists.
        await this.audit({
          eventType: 'promotion_failed',
          actor: 'paper-executor',
          runId,
          detail: { kind: 'final_output_write_failed', path: resolvedPath, message: String(error) },
        })
        await this.engine.transitionRun(runId, 'failed')
        throw new WorkflowExecutionError(
          'gate-failed',
          `run '${runId}' final output write failed at ${resolvedPath}: ${String(error).split('\n')[0]}`,
        )
      }
    }
    await this.audit({
      eventType: 'final_output_written',
      actor: 'paper-executor',
      runId,
      detail: {
        path: resolvedPath ?? `${path} (no sink mounted: set finalOutputRoot)`,
        bytes,
        sha256,
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
        // P1-1: on the produce-from-EXECUTE path the node output must be an
        // ir-container-v1; the structured-output producer writes the model's
        // declared kinds into the canonical store. A refused container is a
        // failed attempt (retried by the loop below like any other failure);
        // once the ceiling is spent the run is BLOCKED (see the exhaust
        // branch). Every written entry is audited so the trail reconstructs
        // the run's IR evolution.
        if (type === 'execute' && this.options.produceFromExecute === true) {
          const ir = this.options.ir
          if (ir === undefined) {
            const err = new Error('produceFromExecute requires a mounted ModelingIr (options.ir)')
            ;(err as { code?: string }).code = 'IR_PRODUCER_NOT_CONFIGURED'
            throw err
          }
          const verdict = produceContainerInto(ir, text)
          if (!verdict.ok) {
            const err = new Error(`EXECUTE output refused by the IR producer: ${verdict.reason}`)
            ;(err as { code?: string }).code = 'IR_PRODUCER_REFUSED'
            throw err
          }
          for (const entry of verdict.entries) {
            await this.audit({
              eventType: 'ir_entry_written',
              actor: 'paper-executor',
              runId,
              detail: { kind: entry.kind, id: entry.id, nodeId: node.id },
            })
          }
          // P2-1 (D7 obligation): when the container carries executable code
          // the EXECUTE stage runs the FULL production chain — code-run
          // (deployment-owned runnerCommand, model can never choose one),
          // capture, dry-pass interpretation, Result/Claim minting — and
          // returns the rendered v1 report as the deliverable text. This is
          // the executor-authoritative path; `demo/run-p1-demo.mjs` is no
          // longer the only way to a FORMAL delivery.
          const container = parseModelContainer(text)
          if (container.ok && (container.container.code?.length ?? 0) > 0) {
            const chain = await this.runProductionChain(runId, ir, container.container)
            if (!chain.ok) {
              const err = new Error(`EXECUTE production chain refused: ${chain.reason}`)
              ;(err as { code?: string }).code = chain.code
              throw err
            }
            this.#codeLoaders.set(String(runId), chain.loadCode)
            await this.engine.transitionNode(node.id, 'succeeded')
            return { nodeId: node.id, text: chain.reportText }
          }
        }
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

    // Attempts are spent and the failure was retryable. On the P1-1
    // produce-from-EXECUTE path the retries existed to let the model emit a
    // schema-valid container; once the ceiling is spent the run is BLOCKED
    // (a persistent producer refusal is not a resumable transport pause).
    // Otherwise pause for review so a resumed run continues from this node.
    if (this.options.produceFromExecute === true && type === 'execute') {
      // The node already sits in 'failed' (set by the catch path on its
      // last attempt); only the RUN transitions here.
      await this.engine.transitionRun(runId, 'failed')
      await this.audit({
        eventType: 'gate_failed',
        actor: 'paper-executor',
        runId,
        detail: { gate: 'ir_producer', reason: `EXECUTE output refused ${policy.maxNodeAttempts} times` },
      })
      throw new WorkflowExecutionError(
        'gate-failed',
        `node '${node.id}' exhausted ${policy.maxNodeAttempts} attempts: EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)`,
      )
    }
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

  private buildManifest(
    run: RunRecord,
    artifact: ArtifactRecord,
    gatePassed: boolean,
    advisoryDefects: ReadonlyArray<ReviewDefect> = [],
  ): Manifest {
    return {
      schemaVersion: 1,
      runId: run.id,
      harnessVersion: run.harnessVersion,
      mode: run.mode,
      // 5.0-R (R1-4): an EXPLORATORY deliverable is informal — it must
      // never be consumed as a formal result.
      informal: run.mode === 'exploratory',
      finalArtifactId: artifact.id,
      gates: { review: gatePassed },
      // E4c: fast deliveries with advisory MINOR defects record them so the
      // manifest never hides a review finding (exactOptionalPropertyTypes:
      // omit rather than pass an explicit empty array).
      ...(advisoryDefects.length === 0 ? {} : { advisory_defects: advisoryDefects.map(d => ({ id: d.id, severity: d.severity, description: d.description })) }),
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

/**
 * Resolve interpretation `source.locator`s that name a file basename to the
 * run's canonical locators before the interpretation dry pass. A basename
 * that is not one of the run's declared outputs is a refusal — the model
 * can only read what the code actually produced.
 */
function normalizeInterpretationLocators(
  block: Record<string, unknown>,
  basenames: ReadonlyArray<string>,
  locators: ReadonlyArray<string>,
): { ok: true; value: Record<string, unknown> } | { ok: false; code: string; reason: string } {
  const copy = structuredClone(block) as { results?: Array<{ source?: { locator?: unknown } }> }
  const results = copy.results
  if (!Array.isArray(results)) return { ok: true, value: copy as Record<string, unknown> }
  for (const result of results) {
    const loc = result.source?.locator
    if (typeof loc !== 'string' || loc.startsWith('file://')) continue
    const index = basenames.indexOf(loc)
    if (index < 0) {
      return { ok: false, code: 'INTERPRETATION_SOURCE_INVALID', reason: `result reads '${loc}' which is not one of the run's declared outputs [${basenames.join(', ')}]` }
    }
    result.source!.locator = locators[index]!
  }
  return { ok: true, value: copy as Record<string, unknown> }
}

/** Sections one review request carries. E4b: the reviewer prompt teaches
 *  the three-value severity vocabulary (critical | major | minor) with its
 *  definitions; E4a: from round 1 the reviewer is handed the unresolved
 *  ledger and asked to adjudicate it (remaining / resolved), instead of
 *  re-discovering defects with no memory. */
function reviewSections(
  task: PromptSection,
  delivered: string,
  priorUnresolved: ReadonlyArray<ReviewDefect> = [],
): PromptSection[] {
  const firstRound = priorUnresolved.length === 0
  const severityGuide = [
    'severity is one of: "critical" (delivery-blocking: data integrity,',
    'numeric escape, provenance), "major" (structural deviation), "minor"',
    '(wording/presentation).',
  ].join(' ')
  const shape = firstRound
    ? '{"defects":[{"id":"D1","severity":"critical|major|minor","description":"..."}]}'
    : '{"defects":[{"id":"D1","severity":"critical|major|minor","description":"..."}],"resolved":["D1"]}'
  const instruction = [
    'Review the delivered text for defects.',
    severityGuide,
    firstRound
      ? 'Return JSON only: ' + shape + '. An empty defects array means the text is clean.'
      : [
          'Previously reported defects (adjudicate each one):',
          priorUnresolved.map(d => `- ${d.id} [${d.severity}] ${d.description}`).join('\n'),
          'Return JSON only: ' + shape + '.',
          '  "defects": defects STILL present in the current text (reuse the original',
          '    id; a defect no longer present must NOT be listed here),',
          '  "resolved": ids from the list above that the editor has genuinely fixed.',
          'A defect that is absent from BOTH lists is treated as still unresolved.',
        ].join('\n'),
  ].join('\n')
  return [
    task,
    { name: 'draft', text: `Delivered text:\n${delivered}`, trimPriority: TRIM_DRAFT },
    { name: 'instruction', text: instruction, trimPriority: KEEP },
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

/** A review round's parsed verdict (E4a): what remains + what is resolved. */
export interface ReviewReport {
  /** Defects the reviewer reports as STILL PRESENT (auto-id when absent). */
  readonly defects: ReadonlyArray<ReviewDefect>
  /** ids from the prior ledger the reviewer confirms the editor fixed. */
  readonly resolved: ReadonlyArray<string>
}

function criticalDefect(description: string): ReviewDefect {
  return { id: 'MALFORMED', severity: 'critical', description }
}

/** Parse a review verdict. E4b: an unknown severity is fail-closed — the
 *  entry becomes a CRITICAL finding (never silently downgraded to major);
 *  a defect with no id gets a deterministic local id (D<k>), which means a
 *  legacy-format reviewer can never *resolve* it later — only report it.
 *  Malformed output is itself a single critical review failure. */
function parseReviewReport(
  text: string,
  knownIds: ReadonlyArray<string>,
): ReviewReport {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { defects: [criticalDefect('reviewer returned no JSON object')], resolved: [] }
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { defects?: unknown; resolved?: unknown }
    if (!Array.isArray(parsed.defects)) {
      return { defects: [criticalDefect('reviewer JSON has no defects array')], resolved: [] }
    }
    const resolved = Array.isArray(parsed.resolved)
      ? parsed.resolved.filter((id): id is string => typeof id === 'string')
      : []
    const seen = new Set(knownIds)
    const defects: ReviewDefect[] = []
    let autoIndex = 1
    for (const entry of parsed.defects) {
      if (typeof entry !== 'object' || entry === null) continue
      const raw = entry as { description?: unknown; severity?: unknown; id?: unknown }
      if (typeof raw.description !== 'string') continue
      // A listed id reuses its history; a fresh entry gets a local id.
      const rawId = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
      if (rawId !== null && !seen.has(rawId)) seen.add(rawId)
      const id = rawId ?? `D${autoIndex}`
      autoIndex += 1
      defects.push(normalizeSeverity(
        typeof raw.severity === 'string' ? raw.severity : '',
        raw.description,
        id,
      ))
    }
    return { defects, resolved }
  } catch {
    return { defects: [criticalDefect('reviewer returned unparsable JSON')], resolved: [] }
  }
}

/** Map a producer-supplied severity onto the closed three-value enum.
 *  E4b: fail-closed — anything that is not exactly one of the three values
 *  is CRITICAL (an unclassifiable review entry blocks, it is never
 *  downgraded to major/minor). */
function normalizeSeverity(
  raw: string,
  description: string,
  id: string,
): ReviewDefect {
  const s = raw.trim().toLowerCase()
  if (s === 'critical') return { id, severity: 'critical', description }
  if (s === 'major') return { id, severity: 'major', description }
  if (s === 'minor') return { id, severity: 'minor', description }
  // E4b fail-closed: an unclassifiable severity is a CRITICAL finding that
  // keeps its original description — the review is untrustworthy, never
  // silently downgraded.
  return { id, severity: 'critical', description }
}
