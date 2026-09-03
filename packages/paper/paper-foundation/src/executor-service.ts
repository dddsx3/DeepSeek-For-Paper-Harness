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
    // exactOptionalPropertyTypes: an explicit undefined would be a type
    // error on the optional fields, so omit rather than pass through.
    ...ir === undefined ? {} : { ir },
    ...audit === undefined ? {} : { audit },
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
