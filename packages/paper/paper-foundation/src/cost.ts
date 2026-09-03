/**
 * Pricing table, per-call cost, and daily budget evaluation. Cost is derived
 * from token counts at the workflow boundary rather than trusted from a
 * provider response field, so an adapter that reports no cost still accounts.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/cost
 */

/** Price of one model route in USD per 1,000 tokens. */
export interface ModelPrice {
  /** USD per 1,000 uncached input tokens. */
  readonly inputPer1k: number
  /** USD per 1,000 output tokens. */
  readonly outputPer1k: number
}

/** Provider route id → model id → price. A route absent from the table costs nothing. */
export type PricingTable = Readonly<Record<string, Readonly<Record<string, ModelPrice>>>>

/** Budget bounds applied to one day's accumulated cost. */
export interface BudgetPolicy {
  /** Daily ceiling in USD; a value of zero or less means unbounded. */
  readonly dailyBudgetUsd: number
  /** Fraction of the ceiling that raises `warning` (for example 0.8). */
  readonly warnFraction: number
  /** Multiplier applied to the ceiling for strict-mode runs, which review more. */
  readonly strictMultiplier: number
}

/** Where accumulated spend sits against its ceiling. */
export type BudgetState = 'ok' | 'warning' | 'exhausted'

/** One budget evaluation against a resolved ceiling. */
export interface BudgetVerdict {
  /** Position of `spentUsd` against `limitUsd`. */
  readonly state: BudgetState
  /** Ceiling that applied to this evaluation; `Infinity` when unbounded. */
  readonly limitUsd: number
  /** Spend the evaluation judged. */
  readonly spentUsd: number
}

/**
 * Six decimals of USD. Costs accumulate across many calls, and rounding each
 * one keeps a run total from drifting on binary-float remainders.
 */
const USD_SCALE = 1e6

/**
 * Resolve the price of one exact provider/model route.
 * @param table - the deployment's pricing table.
 * @param provider - provider route id.
 * @param model - exact model id.
 * @returns the price, or `undefined` when the table does not price this route.
 */
export function resolveModelPrice(
  table: PricingTable,
  provider: string,
  model: string,
): ModelPrice | undefined {
  return table[provider]?.[model]
}

/**
 * Compute one call's cost from its token counts.
 * @param price - the route's price, or `undefined` for an unpriced route.
 * @param usage - input and output token counts for the call.
 * @returns the cost in USD rounded to six decimals; zero for an unpriced route.
 */
export function computeCostUsd(
  price: ModelPrice | undefined,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): number {
  if (price === undefined) return 0
  const cost = (usage.inputTokens / 1000) * price.inputPer1k
    + (usage.outputTokens / 1000) * price.outputPer1k
  return Math.round(cost * USD_SCALE) / USD_SCALE
}

/**
 * Judge accumulated spend against the mode-adjusted daily ceiling.
 * @param spentUsd - spend accumulated for the day.
 * @param policy - the deployment's budget policy.
 * @param mode - run mode; strict raises the ceiling by `strictMultiplier`.
 * @returns the verdict, whose `limitUsd` is `Infinity` when unbounded.
 */
export function evaluateBudget(
  spentUsd: number,
  policy: BudgetPolicy,
  mode: 'fast' | 'strict' | 'exploratory',
): BudgetVerdict {
  if (policy.dailyBudgetUsd <= 0) return { state: 'ok', limitUsd: Infinity, spentUsd }
  const limitUsd = policy.dailyBudgetUsd * (mode === 'strict' ? policy.strictMultiplier : 1)
  if (spentUsd >= limitUsd) return { state: 'exhausted', limitUsd, spentUsd }
  if (spentUsd >= limitUsd * policy.warnFraction) return { state: 'warning', limitUsd, spentUsd }
  return { state: 'ok', limitUsd, spentUsd }
}
