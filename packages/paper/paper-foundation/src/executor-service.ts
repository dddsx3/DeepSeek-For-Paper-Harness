/**
 * Cordis service exposing the workflow executor. Deployment-varying pricing,
 * budget, and backoff arrive as validated config rather than constants, so a
 * composition can change them from `cordis.yml` without a code change.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/executor-service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { ModelPrice, PricingTable } from './cost.ts'
import { WorkflowExecutor } from './executor.ts'
import type { ExecutorOptions } from './executor.ts'

/** Daily spend ceiling used when a composition names none. */
export const DEFAULT_DAILY_BUDGET_USD = 20
/** Warning fraction used when a composition names none. */
export const DEFAULT_BUDGET_WARN_FRACTION = 0.8
/** Strict-mode ceiling multiplier used when a composition names none. */
export const DEFAULT_STRICT_BUDGET_MULTIPLIER = 1.5
/** First retry delay used when a composition names none. */
export const DEFAULT_BACKOFF_BASE_MS = 1000
/** Retry delay ceiling used when a composition names none. */
export const DEFAULT_BACKOFF_CAP_MS = 30_000
/** Context-window fraction one request may occupy when a composition names none. */
export const DEFAULT_CONTEXT_UTILIZATION = 0.8

/**
 * Execution policy for one deployment. Every field is optional in yml: the
 * schema below supplies the default at load, and a hand-built composition
 * resolves the same value through the constructor.
 */
export interface ExecutorConfig {
  /** Daily spend ceiling in USD; zero or less means unbounded. */
  readonly dailyBudgetUsd?: number
  /** Fraction of the ceiling that raises a warning event. */
  readonly budgetWarnFraction?: number
  /** Multiplier applied to the ceiling for strict-mode runs. */
  readonly strictBudgetMultiplier?: number
  /** First retry delay in milliseconds. */
  readonly backoffBaseMs?: number
  /** Retry delay ceiling in milliseconds. */
  readonly backoffCapMs?: number
  /** Route prices keyed by provider then model. */
  readonly pricing?: PricingTable
  /** Fraction of a model's context window one request may occupy. */
  readonly contextUtilization?: number
  /** 5.0-R (R5): root under which promoted final outputs are really written. */
  readonly finalOutputRoot?: string
  /** P1-1: require and run the structured-output producer on EXECUTE. */
  readonly produceFromExecute?: boolean
  /** P2-1: deployment-owned code-run configuration (model can never choose
   *  the command); required for the EXECUTE production chain. */
  readonly produceRun?: {
    command: string[]
    entryFile: string
    environment: string
    timeoutMs: number
    allowExecutable?: string[]
  }
  /** TASK-PW W2: the guided-step protocol tier a producing run starts in.
   *  T1 = full declaration (default), T2 = guided steps, T3 = template
   *  fill. The executor degrades T1 → T2 → T3 on NONE exhaustion (W4). */
  readonly initialTier?: 'T1' | 'T2' | 'T3'
  /** P0-3 (PRD v2 §3.3): 'fail-soft' turns unpassed gates into MARKED
   *  annotations (content delivers with an honest appendix; only the
   *  three fatal conditions block). Default 'strict-tolerance' keeps the
   *  historical fail-closed behavior byte-for-byte. */
  readonly deliveryGradeMode?: 'strict-tolerance' | 'fail-soft'
  /** W8.6-P4: per-run OUTPUT-token ceiling (pricing-independent guard).
   *  Zero/absent = unbounded (historical). */
  readonly maxOutputTokensPerRun?: number
  /** W9-P2 / W8.9-A4: shard the EXECUTE declaration (three small outputs
   *  merged into the same container). **W8.9-A4: this is now the default**;
   *  pass `false` to restore the single-shot declaration, or set
   *  `disableShardDeclare: true` to opt out explicitly. */
  readonly shardDeclare?: boolean
  /** W8.9-A4: explicit opt-OUT of the sharded path (takes precedence over
   *  `shardDeclare`). Present so a composition can say "I know about
   *  sharding and I want it off" without relying on `false`'s meaning. */
  readonly disableShardDeclare?: boolean
  /** W8.9-B1: the E1/E2 receive layer (free analysis → independent
   *  normalization). **Default ON**; `false` restores the single-shot
   *  container path for A/B comparison. */
  readonly e1e2?: boolean
  /** W8.9-B1: explicit opt-out of the receive layer (takes precedence). */
  readonly disableE1E2?: boolean
  /** W8.9-B3/B4: refuse a container whose declarations are not verbatim
   *  anchored in the E1 analysis. Default true; `false` records the
   *  findings without refusing (first-real-run tolerance). */
  readonly enforceFidelity?: boolean
}

const modelPrice: s<ModelPrice> = s.object({
  inputPer1k: s.number().min(0).required(),
  outputPer1k: s.number().min(0).required(),
})

/**
 * Resolve one deployment's execution policy. The loader applies the schema
 * defaults before construction; this is the same resolution for a
 * hand-built composition, and the single place either path defaults.
 * @param config - the composition's declared policy, possibly partial.
 * @param audit - audit sink to attach, when the composition mounts one.
 * @returns the fully resolved executor options.
 */
export function resolveExecutorOptions(
  config: ExecutorConfig,
  audit?: ExecutorOptions['audit'],
  ir?: ExecutorOptions['ir'],
  artifactBodies?: ExecutorOptions['artifactBodies'],
): ExecutorOptions {
  return {
    pricing: config.pricing ?? {},
    budget: {
      dailyBudgetUsd: config.dailyBudgetUsd ?? DEFAULT_DAILY_BUDGET_USD,
      warnFraction: config.budgetWarnFraction ?? DEFAULT_BUDGET_WARN_FRACTION,
      strictMultiplier: config.strictBudgetMultiplier ?? DEFAULT_STRICT_BUDGET_MULTIPLIER,
    },
    backoff: {
      baseMs: config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
      capMs: config.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS,
    },
    contextUtilization: config.contextUtilization ?? DEFAULT_CONTEXT_UTILIZATION,
    // 5.0-R (R5): a real sink root makes promotion write bytes. The empty
    // string is the schema-level "not mounted" marker.
    ...(config.finalOutputRoot ? { finalOutputRoot: config.finalOutputRoot } : {}),
    // P1-1: opt-in structured-output producer on the EXECUTE node.
    ...(config.produceFromExecute ? { produceFromExecute: true } : {}),
    // P2-1: the deployment-owned runner; validated against the built-in
    // code-run allow-list when the chain executes.
    ...(config.produceRun === undefined ? {} : { produceRun: config.produceRun }),
    // TASK-PW W2: the tier a producing run starts at; `undefined` resolves
    // to T1 (initialTier()) inside the executor.
    ...(config.initialTier === undefined ? {} : { initialTier: config.initialTier }),
    // P0-3: the delivery grade threshold; omitted = strict-tolerance
    // (historical fail-closed behavior).
    ...(config.deliveryGradeMode === undefined ? {} : { deliveryGradeMode: config.deliveryGradeMode }),
    ...(config.maxOutputTokensPerRun === undefined ? {} : { maxOutputTokensPerRun: config.maxOutputTokensPerRun }),
    // W8.9-A4: forward BOTH halves of the switch — dropping the opt-out
    // here would silently ignore a composition's explicit request (the
    // defect this batch's own test caught: disableShardDeclare never
    // reached the executor, so "off" behaved as "default on").
    ...(config.shardDeclare === undefined ? {} : { shardDeclare: config.shardDeclare }),
    ...(config.disableShardDeclare === true ? { disableShardDeclare: true } : {}),
    // W8.9-B1: forward both halves of the receive-layer switch, same reason
    // as the shard switch above — a dropped opt-out silently runs the
    // default path while the caller believes it opted out.
    ...(config.e1e2 === undefined ? {} : { e1e2: config.e1e2 }),
    ...(config.disableE1E2 === true ? { disableE1E2: true } : {}),
    ...(config.enforceFidelity === undefined ? {} : { enforceFidelity: config.enforceFidelity }),
    // exactOptionalPropertyTypes: an explicit undefined would be a type
    // error on the optional fields, so omit rather than pass through.
    ...ir === undefined ? {} : { ir },
    ...audit === undefined ? {} : { audit },
    ...artifactBodies === undefined ? {} : { artifactBodies },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperExecutor: PaperExecutorService
  }
}

/** Lifecycle owner of the node executor over the durable engine. */
export class PaperExecutorService extends Service {
  static inject = ['paperWorkflow', 'paperProvider', 'paperSettings', 'paperRuntimeGuard']

  static Config: s<ExecutorConfig> = s.object({
    dailyBudgetUsd: s.number().min(0).default(DEFAULT_DAILY_BUDGET_USD),
    budgetWarnFraction: s.number().min(0).max(1).default(DEFAULT_BUDGET_WARN_FRACTION),
    strictBudgetMultiplier: s.number().min(1).default(DEFAULT_STRICT_BUDGET_MULTIPLIER),
    backoffBaseMs: s.number().step(1).min(1).default(DEFAULT_BACKOFF_BASE_MS),
    backoffCapMs: s.number().step(1).min(1).default(DEFAULT_BACKOFF_CAP_MS),
    pricing: s.dict(s.dict(modelPrice)).default({}),
    contextUtilization: s.number().min(0.1).max(1).default(DEFAULT_CONTEXT_UTILIZATION),
    finalOutputRoot: s.string().default(''),
    produceFromExecute: s.boolean().default(false),
    produceRun: s
      .object({
        command: s.array(s.string()).default([]),
        entryFile: s.string().default(''),
        environment: s.string().default(''),
        timeoutMs: s.number().step(1).min(1).default(30_000),
        allowExecutable: s.array(s.string()),
      }),
    // TASK-PW W2: T2 guided-step sessions opt in at the composition; the
    // executor's enforced tier still resolves from the W4 ledger.
    initialTier: s.union(['T1', 'T2', 'T3'] as const),
    // P0-3 (PRD v2 §3.3): fail-soft vs strict-tolerance delivery grading.
    deliveryGradeMode: s.union(['strict-tolerance', 'fail-soft'] as const).default('strict-tolerance'),
    // W8.6-P4: per-run output-token ceiling; 0 = unbounded.
    maxOutputTokensPerRun: s.number().step(1).min(0).default(0),
    // W9-P2 / W8.9-A4: shard declaration. No schema default is declared
    // here on purpose — `undefined` must reach the executor so its
    // `shardDeclareEnabled()` (the single reader) decides, rather than a
    // second default living in the schema layer.
    shardDeclare: s.boolean(),
    // W8.9-A4: explicit opt-out.
    disableShardDeclare: s.boolean().default(false),
    // W8.9-B1: receive layer. No schema default (undefined must reach the
    // executor, whose `e1e2Enabled()` is the single reader).
    e1e2: s.boolean(),
    disableE1E2: s.boolean().default(false),
    // W8.9-B3/B4: fidelity enforcement; absent = enforced (executor default).
    enforceFidelity: s.boolean(),
  })

  private executor: WorkflowExecutor | undefined

  /**
   * @param ctx - Context carrying the engine, provider, and settings services.
   * @param config - Validated budget, backoff, and pricing policy.
   */
  constructor(ctx: Context, private readonly config: ExecutorConfig = {}) {
    super(ctx, 'paperExecutor')
  }

  /** Build the executor from the composed services and validated policy. */
  protected [Service.init](): void {
    this.executor = new WorkflowExecutor(
      this.ctx.paperWorkflow.runs,
      this.ctx.paperProvider,
      this.ctx.paperSettings,
      resolveExecutorOptions(
        this.config,
        this.ctx.get('paperAudit'),
        // TASK 1.25: the canonical IR store, when the composition mounts one.
        // Absent, the executor treats it as an empty store and blocks FORMAL
        // and FAST delivery rather than delivering text-only.
        this.ctx.get('paperModelingIr'),
        // W8.11-B2: the artifact body store, when the composition mounts one.
        // Absent, receive-layer texts are not persisted — the pre-W8.11
        // behaviour, kept as the explicit fallback for compositions that do
        // not mount the store.
        this.ctx.get('paperArtifactBody'),
      ),
      this.ctx.paperRuntimeGuard,
    )
  }

  /**
   * Resolve the executor built during initialization.
   * @returns the initialized workflow executor.
   */
  get runs(): WorkflowExecutor {
    if (this.executor === undefined) throw new Error('paper executor is not initialized')
    return this.executor
  }
}

export default PaperExecutorService
