/**
 * TASK-Q2 — per-run usage/cost telemetry (expert plan §3.1 / NOT-NOW #10).
 *
 * Every real-model run must leave a machine-readable account of what it
 * spent: calls, input/output/cache/retry tokens, provider, model, and the
 * derived cost. "Unlimited quota" never exempts a call from telemetry —
 * the RUN_BUDGET_* hard ceilings (BLOCK, not silent retry) are computed
 * from exactly these numbers.
 *
 * Pricing is per-(provider, model): { inputPer1M, outputPer1M } in the
 * currency the caller quotes (CNY by convention in this repo's docs; the
 * module is currency-agnostic and never converts).
 *
 * Pure accounting: it never calls a provider, never reads a clock, never
 * mutates a registry. The executor's usage pipeline feeds it; the shell
 * and the probe export its report verbatim.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/probe/usage-telemetry
 */

/** One provider call's token accounting (as reported by the transport). */
export interface CallUsage {
  /** Input tokens charged this call (cache-miss; cache-hit is separate). */
  readonly inputTokens: number
  readonly outputTokens: number
  /** Input tokens served from provider cache (cheaper band, or free). */
  readonly cacheHitTokens: number
  /** Retry attempts' token cost — re-sent context on retryable failures. */
  readonly retryTokens: number
}

/** One recorded call. */
export interface TelemetryCall extends CallUsage {
  readonly provider: string
  readonly model: string
  /** Whether this call needed a transport retry (429/5xx backoff). */
  readonly retried: boolean
}

/** Pricing for one (provider, model): cost per 1M tokens. */
export interface ModelPricing {
  readonly inputPer1M: number
  readonly outputPer1M: number
}

/** Hard budget ceilings (expert plan §3.1): BLOCK, never silent-retry. */
export interface UsageBudget {
  readonly maxModelCalls: number
  readonly maxInputTokens: number
  readonly maxOutputTokens: number
  /** 0 = no monetary ceiling configured (token ceilings still apply). */
  readonly maxCost: number
}

/** The per-run telemetry report (exported verbatim by the shell). */
export interface UsageTelemetryReport {
  readonly model_calls: number
  readonly retried_calls: number
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_hit_tokens: number
  readonly retry_tokens: number
  readonly providers: ReadonlyArray<{ readonly provider: string; readonly model: string; readonly calls: number }>
  readonly estimated_cost: number
  readonly currency: string
  readonly budget: UsageTelemetryBudgetState
}

/** Budget accounting against the hard ceilings. */
export interface UsageTelemetryBudgetState {
  readonly configured: UsageBudget
  readonly exceeded: ReadonlyArray<'MODEL_CALLS' | 'INPUT_TOKENS' | 'OUTPUT_TOKENS' | 'COST'>
}

/** Accumulator for one run's calls; emits the exportable report. */
export class UsageTelemetry {
  readonly #calls: TelemetryCall[] = []
  readonly #pricing: ReadonlyMap<string, ModelPricing>
  readonly #currency: string
  readonly #budget: UsageBudget

  constructor(options: {
    /** Keyed by `${provider}/${model}`. */
    readonly pricing?: Readonly<Record<string, ModelPricing>>
    readonly currency?: string
    readonly budget?: Partial<UsageBudget>
  } = {}) {
    this.#pricing = new Map(Object.entries(options.pricing ?? {}).map(([key, value]) => [key, value]))
    this.#currency = options.currency ?? 'CNY'
    this.#budget = {
      maxModelCalls: options.budget?.maxModelCalls ?? Number.POSITIVE_INFINITY,
      maxInputTokens: options.budget?.maxInputTokens ?? Number.POSITIVE_INFINITY,
      maxOutputTokens: options.budget?.maxOutputTokens ?? Number.POSITIVE_INFINITY,
      maxCost: options.budget?.maxCost ?? 0,
    }
  }

  /** Record one completed provider call. */
  record(call: TelemetryCall): void {
    this.#calls.push(call)
  }

  /** The report for every recorded call so far. */
  report(): UsageTelemetryReport {
    const inputTokens = this.#calls.reduce((sum, c) => sum + c.inputTokens, 0)
    const outputTokens = this.#calls.reduce((sum, c) => sum + c.outputTokens, 0)
    const cacheHitTokens = this.#calls.reduce((sum, c) => sum + c.cacheHitTokens, 0)
    const retryTokens = this.#calls.reduce((sum, c) => sum + c.retryTokens, 0)
    const estimatedCost = this.#calls.reduce((sum, call) => sum + this.#costOf(call), 0)

    const byRoute = new Map<string, { provider: string; model: string; calls: number }>()
    for (const call of this.#calls) {
      const key = `${call.provider}/${call.model}`
      const entry = byRoute.get(key)
      if (entry === undefined) byRoute.set(key, { provider: call.provider, model: call.model, calls: 1 })
      else entry.calls += 1
    }

    const exceeded: Array<'MODEL_CALLS' | 'INPUT_TOKENS' | 'OUTPUT_TOKENS' | 'COST'> = []
    const n = this.#calls.length
    if (n > this.#budget.maxModelCalls) exceeded.push('MODEL_CALLS')
    if (inputTokens > this.#budget.maxInputTokens) exceeded.push('INPUT_TOKENS')
    if (outputTokens > this.#budget.maxOutputTokens) exceeded.push('OUTPUT_TOKENS')
    if (this.#budget.maxCost > 0 && estimatedCost > this.#budget.maxCost) exceeded.push('COST')

    return {
      model_calls: n,
      retried_calls: this.#calls.filter(c => c.retried).length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_hit_tokens: cacheHitTokens,
      retry_tokens: retryTokens,
      providers: [...byRoute.values()],
      estimated_cost: Number(estimatedCost.toFixed(6)),
      currency: this.#currency,
      budget: { configured: this.#budget, exceeded },
    }
  }

  /**
   * The budget ceiling verdict: any exceeded dimension means the run must
   * BLOCK (MODEL_BUDGET_EXHAUSTED semantics), never silently continue.
   */
  budgetExceeded(): boolean {
    return this.report().budget.exceeded.length > 0
  }

  #costOf(call: TelemetryCall): number {
    const price = this.#pricing.get(`${call.provider}/${call.model}`)
    if (price === undefined) return 0
    return (call.inputTokens / 1_000_000) * price.inputPer1M
      + (call.outputTokens / 1_000_000) * price.outputPer1M
  }
}
