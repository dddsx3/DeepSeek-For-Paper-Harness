/**
 * Cordis service exposing the workflow executor. Deployment-varying pricing,
 * budget, and backoff arrive as validated config rather than constants, so a
 * composition can change them from `cordis.yml` without a code change.
 *
 * @module @deepseek-ai/dsh-harness-foundation/src/executor-service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { ModelPrice, PricingTable } from './cost.ts'
import { WorkflowExecutor } from './executor.ts'

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
}

const modelPrice: s<ModelPrice> = s.object({
  inputPer1k: s.number().min(0).required(),
  outputPer1k: s.number().min(0).required(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessExecutor: HarnessExecutorService
  }
}

/** Lifecycle owner of the node executor over the durable engine. */
export class HarnessExecutorService extends Service {
  static inject = ['harnessWorkflow', 'harnessProvider', 'harnessSettings']

  static Config: s<ExecutorConfig> = s.object({
    dailyBudgetUsd: s.number().min(0).default(DEFAULT_DAILY_BUDGET_USD),
    budgetWarnFraction: s.number().min(0).max(1).default(DEFAULT_BUDGET_WARN_FRACTION),
    strictBudgetMultiplier: s.number().min(1).default(DEFAULT_STRICT_BUDGET_MULTIPLIER),
    backoffBaseMs: s.number().step(1).min(1).default(DEFAULT_BACKOFF_BASE_MS),
    backoffCapMs: s.number().step(1).min(1).default(DEFAULT_BACKOFF_CAP_MS),
    pricing: s.dict(s.dict(modelPrice)).default({}),
  })

  private executor: WorkflowExecutor | undefined

  /**
   * @param ctx - Context carrying the engine, provider, and settings services.
   * @param config - Validated budget, backoff, and pricing policy.
   */
  constructor(ctx: Context, private readonly config: ExecutorConfig = {}) {
    super(ctx, 'harnessExecutor')
  }

  /** Build the executor from the composed services and validated policy. */
  protected [Service.init](): void {
    const audit = this.ctx.get('harnessAudit')
    this.executor = new WorkflowExecutor(
      this.ctx.harnessWorkflow.runs,
      this.ctx.harnessProvider,
      this.ctx.harnessSettings,
      {
        pricing: this.config.pricing ?? {},
        budget: {
          dailyBudgetUsd: this.config.dailyBudgetUsd ?? DEFAULT_DAILY_BUDGET_USD,
          warnFraction: this.config.budgetWarnFraction ?? DEFAULT_BUDGET_WARN_FRACTION,
          strictMultiplier: this.config.strictBudgetMultiplier ?? DEFAULT_STRICT_BUDGET_MULTIPLIER,
        },
        backoff: {
          baseMs: this.config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
          capMs: this.config.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS,
        },
        ...audit === undefined ? {} : { audit },
      },
    )
  }

  /** @returns the initialized workflow executor. */
  get runs(): WorkflowExecutor {
    if (this.executor === undefined) throw new Error('harness executor is not initialized')
    return this.executor
  }
}

export default HarnessExecutorService
