/**
 * TASK-Q2 — statistical qualification gate tests (expert plan §6).
 *
 * The LCB math is pinned against known Clopper–Pearson bounds; the stop
 * rule against the expert plan's own numbers (14 → p>0.80, 29 → p>0.90);
 * and the registry's upgrade verdict against the plan's central example —
 * 8/10 and 80/100 must NOT earn the same qualification.
 */

import { describe, expect, it } from 'vitest'
import {
  STOP_RULE_P80_ZERO_FAIL_N,
  STOP_RULE_P90_ZERO_FAIL_N,
  evaluateQualification,
  exactLowerConfidenceBound,
  stopRuleTarget,
  upgradeVerdict,
} from '../../src/index.ts'

describe('exact one-sided lower confidence bound (Clopper–Pearson)', () => {
  it('zero failures: the closed form is alpha^(1/n), not 1-alpha', () => {
    // 18/18 licenses p ≥ 0.8467 — NOT "p ≥ 0.95" and never "p = 1".
    expect(exactLowerConfidenceBound(18, 18)).toBeCloseTo(0.8467, 3)
    expect(exactLowerConfidenceBound(100, 100)).toBeCloseTo(Math.pow(0.05, 1 / 100), 6)
  })

  it('matches exact Clopper–Pearson lower bounds (binomial-tail verified)', () => {
    // Reference values verified against the defining equation
    // P(X >= k | LCB) = alpha at 95% one-sided:
    //   8/10  → 0.4928 (P(X>=8 | 0.4928) = 0.0495)
    //   80/100 → 0.7226 (P(X>=80 | 0.7226) = 0.0496)
    // The expert plan quotes "~0.71" for 80/100 (an approximation); the
    // exact bound is what this module computes and what the gate uses.
    expect(exactLowerConfidenceBound(8, 10)).toBeCloseTo(0.4928, 3)
    expect(exactLowerConfidenceBound(80, 100)).toBeCloseTo(0.7226, 3)
    // The expert plan's headline: 18/18 licenses "p > 0.8" but not 0.9.
    expect(exactLowerConfidenceBound(18, 18)).toBeGreaterThan(0.8)
    expect(exactLowerConfidenceBound(18, 18)).toBeLessThan(0.9)
    // And 29/29 is the first zero-failure n whose bound clears 0.9.
    expect(exactLowerConfidenceBound(28, 28)).toBeLessThan(0.9)
    expect(exactLowerConfidenceBound(29, 29)).toBeGreaterThan(0.9)
  })

  it('edge cases: empty sample, all failures, out-of-range inputs', () => {
    expect(exactLowerConfidenceBound(0, 0)).toBe(0)
    expect(exactLowerConfidenceBound(0, 10)).toBe(0)
    // Clamped to k=n: the zero-failure closed form.
    expect(exactLowerConfidenceBound(15, 10)).toBeCloseTo(Math.pow(0.05, 1 / 10), 6)
    expect(exactLowerConfidenceBound(10, -3)).toBe(0) // n<=0 treated as empty
  })

  it('is monotone: more successes at fixed n never lower the bound', () => {
    let previous = -1
    for (let k = 0; k <= 30; k += 1) {
      const bound = exactLowerConfidenceBound(k, 30)
      expect(bound).toBeGreaterThanOrEqual(previous)
      previous = bound
    }
  })
})

describe('stop rule (expert plan §6.2)', () => {
  it('the plan\'s numbers: 14 all-success licenses p>0.80, 29 licenses p>0.90', () => {
    expect(STOP_RULE_P80_ZERO_FAIL_N).toBe(14)
    expect(STOP_RULE_P90_ZERO_FAIL_N).toBe(29)
    // Verify the plan's arithmetic with the exact bound, not an approximation.
    expect(exactLowerConfidenceBound(14, 14)).toBeGreaterThan(0.8)
    expect(exactLowerConfidenceBound(13, 13)).toBeLessThan(0.8)
    expect(exactLowerConfidenceBound(29, 29)).toBeGreaterThan(0.9)
    expect(exactLowerConfidenceBound(28, 28)).toBeLessThan(0.9)
  })

  it('stopRuleTarget maps p_min floors to their zero-failure n', () => {
    expect(stopRuleTarget(0.8)).toBe(14)
    expect(stopRuleTarget(0.9)).toBe(29)
  })
})

describe('evaluateQualification (the statistical gate)', () => {
  const base = { escapeCount: 0, retryBudgetUsed: 0 }

  it('18/18 qualifies at p_min 0.80 (the M1 evidence, honestly stated)', () => {
    const verdict = evaluateQualification({ ...base, outcomes: Array.from({ length: 18 }, () => 'SUCCESS' as const) })
    expect(verdict.qualified).toBe(true)
    expect(verdict.lcb95).toBeGreaterThan(0.8)
  })

  it('18/18 does NOT qualify at p_min 0.90 (the honesty rule)', () => {
    const verdict = evaluateQualification({ ...base, outcomes: Array.from({ length: 18 }, () => 'SUCCESS' as const) }, 0.9)
    expect(verdict.qualified).toBe(false)
    expect(verdict.reasons[0]).toMatch(/LCB/)
  })

  it('8/10 and 80/100 are NOT the same qualification', () => {
    // Point estimates both "0.8"; the exact bounds differ — and 80/100's
    // 0.7226 is BELOW the 0.8 floor, so neither qualifies, but for
    // different evidential reasons. The registry verdict names it.
    const a = evaluateQualification({ ...base, outcomes: [...Array(8).fill('SUCCESS'), ...Array(2).fill('NONE')] })
    const b = evaluateQualification({ ...base, outcomes: [...Array(80).fill('SUCCESS'), ...Array(20).fill('NONE')] })
    expect(a.lcb95).toBeCloseTo(0.4928, 3)
    expect(b.lcb95).toBeCloseTo(0.7226, 3)
    expect(a.qualified).toBe(false)
    expect(b.qualified).toBe(false)
    expect(a.lcb95).not.toBeCloseTo(b.lcb95, 3)
  })

  it('80/100 qualifies only when the bound clears the floor: 96/100 does', () => {
    const verdict = evaluateQualification({ ...base, outcomes: [...Array(96).fill('SUCCESS'), ...Array(4).fill('TRANSPORT')] })
    expect(verdict.lcb95).toBeGreaterThan(0.8)
    expect(verdict.qualified).toBe(true)
  })

  it('one ESCAPE disqualifies regardless of adherence', () => {
    const verdict = evaluateQualification({
      ...base,
      outcomes: [...Array(99).fill('SUCCESS'), 'ESCAPE'],
    })
    expect(verdict.qualified).toBe(false)
    expect(verdict.reasons.some(r => r.includes('ESCAPE'))).toBe(true)
    expect(verdict.failuresByClass.ESCAPE).toBe(1)
  })

  it('spent retry budget disqualifies (禁 5 stays)', () => {
    const verdict = evaluateQualification({
      escapeCount: 0,
      retryBudgetUsed: 2,
      outcomes: Array.from({ length: 18 }, () => 'SUCCESS' as const),
    })
    expect(verdict.qualified).toBe(false)
    expect(verdict.reasons.some(r => r.includes('retry'))).toBe(true)
  })

  it('failure classes are recorded for the report, not just the verdict', () => {
    const verdict = evaluateQualification({
      ...base,
      outcomes: [
        ...Array(13).fill('SUCCESS'),
        'NONE', 'NONE', 'DRIFT', 'RUN', 'TRANSPORT', 'ESCAPE',
      ],
    })
    expect(verdict.failuresByClass).toEqual({ NONE: 2, DRIFT: 1, ESCAPE: 1, RUN: 1, TRANSPORT: 1 })
    expect(verdict.n).toBe(19)
    expect(verdict.successes).toBe(13)
  })
})

describe('upgradeVerdict with per-attempt data (registry integration)', () => {
  const record = (over: Partial<Parameters<typeof upgradeVerdict>[0]> = {}) => ({
    provider: 'openai-compatible-relay',
    model: 'z-ai/glm-5.3-free',
    endpoint: 'https://api.tokenrouter.com/v1',
    tier: 'T3' as const,
    date: '2026-09-08',
    structuralAdherence: 1,
    firstTrySuccess: 1,
    retryBudgetUsed: 0,
    attempts: 18,
    successes: 18,
    escapeCount: 0,
    ...over,
  })

  it('18/18 first-try success with clean budget upgrades at T3', () => {
    expect(upgradeVerdict(record())).toEqual({ ok: true, to: 'T3' })
  })

  it('8/10 does not upgrade even with a 0.8 point estimate', () => {
    const verdict = upgradeVerdict(record({
      attempts: 10, successes: 8, structuralAdherence: 0.8, firstTrySuccess: 0.8,
    }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/LCB₉₅/)
  })

  it('80/100 does not upgrade: point 0.8 but bound ~0.723 < 0.8', () => {
    const verdict = upgradeVerdict(record({
      attempts: 100, successes: 80, structuralAdherence: 0.8, firstTrySuccess: 0.8,
    }))
    expect(verdict.ok).toBe(false)
  })

  it('one ESCAPE refuses the upgrade outright', () => {
    const verdict = upgradeVerdict(record({ escapeCount: 1 }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/ESCAPE/)
  })

  it('legacy records without per-attempt data keep the point-estimate reading', () => {
    const full = record()
    const { successes: _s, escapeCount: _e, ...legacy } = full
    const verdict = upgradeVerdict(legacy)
    // 1.0/1.0 point estimate, zero budget → ok (historical archive shape).
    expect(verdict.ok).toBe(true)
  })
})
