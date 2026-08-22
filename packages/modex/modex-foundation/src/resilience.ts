/**
 * Provider-failure classification and retry backoff. The adapter reports
 * provider-neutral failure codes; deciding whether a workflow retries, stops,
 * or hands the node to revision belongs here, not in the adapter.
 *
 * @module @deepseek-ai/dsh-harness-foundation/src/resilience
 */

/** What the workflow does with one provider failure. */
export type FailureAction = 'retry' | 'block' | 'revise'

/** Backoff bounds for retryable failures. */
export interface BackoffPolicy {
  /** First delay in milliseconds; each further attempt doubles it. */
  readonly baseMs: number
  /** Ceiling in milliseconds applied before jitter. */
  readonly capMs: number
}

/**
 * Codes a retry cannot fix: credentials, routing, request validity, request
 * size, and caller cancellation. Retrying any of these only spends budget.
 */
const BLOCKING_CODES: ReadonlySet<string> = new Set([
  'AUTH',
  'FORBIDDEN',
  'INVALID_CREDENTIAL',
  'MISSING_CREDENTIAL',
  'NO_ADAPTER',
  'NO_DISCOVERY',
  'INVALID_REQUEST',
  'INVALID_ADAPTER',
  'CONTEXT_WINDOW_EXCEEDED',
  'UNSUPPORTED_REASONING_EFFORT',
  'ABORTED',
])

/** Codes whose repair is an edit of the request content, not another attempt. */
const REVISE_CODES: ReadonlySet<string> = new Set(['TOOL_ARGS', 'GATE'])

/** Jitter fraction applied either side of the computed delay. */
const JITTER_FRACTION = 0.2

/**
 * Classify one provider failure code.
 * @param code - the adapter's provider-neutral failure code.
 * @returns the action the workflow takes; an unrecognized code retries,
 *   bounded by the node's attempt ceiling, because unknown transport faults
 *   are more often transient than permanent.
 */
export function classifyFailure(code: string): FailureAction {
  if (BLOCKING_CODES.has(code)) return 'block'
  if (REVISE_CODES.has(code)) return 'revise'
  const httpStatus = /^HTTP_(\d{3})$/u.exec(code)
  if (httpStatus !== null) {
    const status = Number(httpStatus[1])
    return status >= 500 || status === 408 || status === 429 ? 'retry' : 'block'
  }
  return 'retry'
}

/**
 * Delay before one retry attempt. A provider-requested delay always wins when
 * it is longer, so a rate limit is honored rather than merely backed off from.
 * @param attempt - 1 for the first retry, 2 for the second, and so on.
 * @param policy - backoff bounds from deployment config.
 * @param providerRetryAfterMs - delay the provider asked for, when it did.
 * @param random - randomness source for jitter, in `[0, 1)`.
 * @returns the delay in whole milliseconds, never negative.
 */
export function backoffDelayMs(
  attempt: number,
  policy: BackoffPolicy,
  providerRetryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1))
  const jittered = exponential * (1 + (random() * 2 - 1) * JITTER_FRACTION)
  const floor = providerRetryAfterMs === undefined ? 0 : providerRetryAfterMs
  return Math.max(0, Math.round(Math.max(jittered, floor)))
}
