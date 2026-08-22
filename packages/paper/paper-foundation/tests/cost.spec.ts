import { describe, expect, it } from 'vitest'
import {
  backoffDelayMs,
  classifyFailure,
  computeCostUsd,
  evaluateBudget,
  resolveModelPrice,
  type PricingTable,
} from '../src/index.ts'

const pricing: PricingTable = {
  'deepseek-official': {
    'deepseek-v4-flash': { inputPer1k: 0.0002, outputPer1k: 0.0008 },
  },
}

describe('cost accounting', () => {
  it('prices only routes the table declares and rounds to six decimals', () => {
    const price = resolveModelPrice(pricing, 'deepseek-official', 'deepseek-v4-flash')
    expect(price).toEqual({ inputPer1k: 0.0002, outputPer1k: 0.0008 })
    expect(resolveModelPrice(pricing, 'deepseek-official', 'unknown-model')).toBeUndefined()
    expect(resolveModelPrice(pricing, 'unknown-provider', 'deepseek-v4-flash')).toBeUndefined()

    expect(computeCostUsd(price, { inputTokens: 10_000, outputTokens: 2_000 })).toBe(0.0036)
    expect(computeCostUsd(undefined, { inputTokens: 10_000, outputTokens: 2_000 })).toBe(0)
    expect(computeCostUsd(price, { inputTokens: 1, outputTokens: 1 })).toBe(0.000001)
  })

  it('raises warning then exhausted, and treats a non-positive ceiling as unbounded', () => {
    const policy = { dailyBudgetUsd: 10, warnFraction: 0.8, strictMultiplier: 1.5 }
    expect(evaluateBudget(1, policy, 'fast').state).toBe('ok')
    expect(evaluateBudget(8, policy, 'fast')).toMatchObject({ state: 'warning', limitUsd: 10 })
    expect(evaluateBudget(10, policy, 'fast')).toMatchObject({ state: 'exhausted', limitUsd: 10 })

    // Strict mode reviews more, so its ceiling is raised rather than shared.
    expect(evaluateBudget(10, policy, 'strict')).toMatchObject({ state: 'ok', limitUsd: 15 })
    expect(evaluateBudget(12, policy, 'strict').state).toBe('warning')
    expect(evaluateBudget(15, policy, 'strict').state).toBe('exhausted')

    const unbounded = { dailyBudgetUsd: 0, warnFraction: 0.8, strictMultiplier: 1.5 }
    expect(evaluateBudget(1_000_000, unbounded, 'strict')).toMatchObject({ state: 'ok', limitUsd: Infinity })
  })
})

describe('failure classification', () => {
  it('blocks configuration faults, revises content faults, and retries transport faults', () => {
    for (const code of ['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'NO_ADAPTER', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'ABORTED']) {
      expect(classifyFailure(code)).toBe('block')
    }
    expect(classifyFailure('TOOL_ARGS')).toBe('revise')
    expect(classifyFailure('GATE')).toBe('revise')
    for (const code of ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'UNKNOWN']) {
      expect(classifyFailure(code)).toBe('retry')
    }
  })

  it('routes HTTP-coded failures by status class', () => {
    expect(classifyFailure('HTTP_500')).toBe('retry')
    expect(classifyFailure('HTTP_503')).toBe('retry')
    expect(classifyFailure('HTTP_429')).toBe('retry')
    expect(classifyFailure('HTTP_408')).toBe('retry')
    expect(classifyFailure('HTTP_404')).toBe('block')
    expect(classifyFailure('HTTP_401')).toBe('block')
  })
})

describe('retry backoff', () => {
  const policy = { baseMs: 1000, capMs: 8000 }

  it('grows exponentially to the cap within the jitter band', () => {
    const noJitter = (): number => 0.5
    expect(backoffDelayMs(1, policy, undefined, noJitter)).toBe(1000)
    expect(backoffDelayMs(2, policy, undefined, noJitter)).toBe(2000)
    expect(backoffDelayMs(3, policy, undefined, noJitter)).toBe(4000)
    expect(backoffDelayMs(9, policy, undefined, noJitter)).toBe(8000)

    expect(backoffDelayMs(1, policy, undefined, () => 0)).toBe(800)
    expect(backoffDelayMs(1, policy, undefined, () => 0.999999)).toBeLessThanOrEqual(1200)
  })

  it('never returns less than a provider-requested delay', () => {
    expect(backoffDelayMs(1, policy, 5000, () => 0)).toBe(5000)
    expect(backoffDelayMs(3, policy, 1000, () => 0.5)).toBe(4000)
    expect(backoffDelayMs(1, { baseMs: 1, capMs: 1 }, undefined, () => 0)).toBeGreaterThanOrEqual(0)
  })
})
