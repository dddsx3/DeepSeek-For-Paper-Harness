/**
 * TASK-Q2 — usage/cost telemetry tests (expert plan §3.1 / NOT-NOW #10).
 *
 * Every real-model run leaves a machine-readable account: calls, tokens
 * (input / output / cache / retry), provider+model routes, derived cost,
 * and the hard-budget verdict (BLOCK on exceed, never silent continue).
 */

import { describe, expect, it } from 'vitest'
import { UsageTelemetry } from '../../src/index.ts'

const CALL = (over: Partial<Parameters<UsageTelemetry['record']>[0]> = {}) => ({
  provider: 'openai-compatible-relay',
  model: 'z-ai/glm-5.3-free',
  inputTokens: 1_000,
  outputTokens: 200,
  cacheHitTokens: 500,
  retryTokens: 0,
  retried: false,
  ...over,
})

describe('UsageTelemetry — accounting', () => {
  it('aggregates calls, tokens, retries, and routes', () => {
    const t = new UsageTelemetry()
    t.record(CALL())
    t.record(CALL({ retried: true, retryTokens: 300 }))
    t.record(CALL({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
    const report = t.report()
    expect(report.model_calls).toBe(3)
    expect(report.retried_calls).toBe(1)
    expect(report.input_tokens).toBe(3_000)
    expect(report.output_tokens).toBe(600)
    expect(report.cache_hit_tokens).toBe(1_500)
    expect(report.retry_tokens).toBe(300)
    expect(report.providers).toHaveLength(2)
    expect(report.providers.find(p => p.model === 'z-ai/glm-5.3-free')!.calls).toBe(2)
    expect(report.providers.find(p => p.model === 'deepseek-v4-flash')!.calls).toBe(1)
  })

  it('derives cost from per-route pricing (per-1M, currency-agnostic)', () => {
    const t = new UsageTelemetry({
      pricing: {
        'openai-compatible-relay/z-ai/glm-5.3-free': { inputPer1M: 1.5, outputPer1M: 4.5 },
      },
      currency: 'CNY',
    })
    t.record(CALL()) // 1000 in + 200 out
    const report = t.report()
    expect(report.estimated_cost).toBeCloseTo(0.0015 + 0.0009, 6)
    expect(report.currency).toBe('CNY')
    // Unpriced routes cost 0 — never a guess.
    t.record(CALL({ provider: 'unknown', model: 'unknown' }))
    expect(t.report().estimated_cost).toBeCloseTo(0.0015 + 0.0009, 6)
  })
})

describe('UsageTelemetry — hard budgets (BLOCK, never silent)', () => {
  it('exceeded dimensions are named, and budgetExceeded flips true', () => {
    const t = new UsageTelemetry({ budget: { maxModelCalls: 2, maxInputTokens: 1_500, maxOutputTokens: 10_000, maxCost: 0 } })
    t.record(CALL())
    t.record(CALL())
    expect(t.budgetExceeded()).toBe(true) // input 2000 > 1500 already
    t.record(CALL())
    const report = t.report()
    expect(report.budget.exceeded).toContain('MODEL_CALLS') // 3 > 2
    expect(report.budget.exceeded).toContain('INPUT_TOKENS') // 3000 > 1500
    expect(report.budget.exceeded).not.toContain('OUTPUT_TOKENS')
    expect(t.budgetExceeded()).toBe(true)
  })

  it('a cost ceiling triggers COST when pricing is configured', () => {
    const t = new UsageTelemetry({
      pricing: { 'openai-compatible-relay/z-ai/glm-5.3-free': { inputPer1M: 2_000, outputPer1M: 0 } },
      budget: { maxCost: 0.001 },
    })
    t.record(CALL()) // 1000 tokens × 2000/1M = 2.0 → way over 0.001
    expect(t.report().budget.exceeded).toContain('COST')
  })

  it('no configured ceiling (maxCost 0) never triggers COST', () => {
    const t = new UsageTelemetry({ budget: { maxCost: 0 } })
    t.record(CALL({ inputTokens: 10_000_000 }))
    expect(t.report().budget.exceeded).not.toContain('COST')
  })
})
