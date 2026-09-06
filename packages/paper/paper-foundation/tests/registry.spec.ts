/**
 * TASK-PW W5 — combination registry red tests.
 *
 * The registry records one dated probe observation per (provider, model,
 * endpoint, tier) and the single upgrade gate (禁 5) demands both adherence
 * metrics ≥ 0.8 AND zero retry budget on first attempts. Red-team leaves:
 *
 *   1. 结构遵从率 < 0.8 → no upgrade (even when first-try success is high).
 *   2. 层内首次成功率 < 0.8 → no upgrade.
 *   3. retryBudgetUsed > 0 → no upgrade: guidance got the pass, so the tier
 *      is not FORMAL (禁 5 升级纪律).
 *   4. Append-only: latest record per combination wins; no silent mutation.
 *   5. Happy: a clean pass with both metrics ≥ 0.8 and zero budget upgrades.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/registry
 */

import { describe, expect, it } from 'vitest'
import {
  CombinationRegistry,
  upgradeVerdict,
  type CombinationRecord,
} from '../src/index.ts'

function record(overrides: Partial<CombinationRecord> = {}): CombinationRecord {
  return {
    provider: 'fake',
    model: 'm',
    endpoint: 'https://fake.invalid',
    tier: 'T1',
    date: '2026-09-06',
    structuralAdherence: 1,
    firstTrySuccess: 1,
    retryBudgetUsed: 0,
    attempts: 20,
    ...overrides,
  }
}

describe('W5 combination registry — upgrade gate (禁 5)', () => {
  it('happy: clean first attempts with both metrics ≥ 0.8 upgrade', () => {
    const verdict = upgradeVerdict(record())
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.to).toBe('T1')
  })

  it('attack 1: structural adherence below 0.8 refuses the upgrade', () => {
    const verdict = upgradeVerdict(record({ structuralAdherence: 0.79, firstTrySuccess: 0.95 }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('structural')
  })

  it('attack 2: first-try success below 0.8 refuses the upgrade', () => {
    const verdict = upgradeVerdict(record({ structuralAdherence: 0.9, firstTrySuccess: 0.75 }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('first-try')
  })

  it('attack 3: any spent retry budget refuses the upgrade (禁 5 升级纪律)', () => {
    const verdict = upgradeVerdict(record({ structuralAdherence: 0.9, firstTrySuccess: 0.9, retryBudgetUsed: 1 }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('retry budget')
  })

  it('attack 4: zero measured attempts refuses the upgrade', () => {
    const verdict = upgradeVerdict(record({ attempts: 0 }))
    expect(verdict.ok).toBe(false)
  })

  it('registry is append-only and latest-per-combination wins', () => {
    const registry = new CombinationRegistry()
    const first = registry.observe(record({ date: '2026-09-05', firstTrySuccess: 0.5 }))
    const second = registry.observe(record({ date: '2026-09-06', firstTrySuccess: 0.9 }))
    expect(registry.all()).toHaveLength(2)
    const latest = registry.latest({ provider: 'fake', model: 'm', endpoint: 'https://fake.invalid', tier: 'T1' })
    expect(latest).toBe(second)
    expect(latest?.firstTrySuccess).toBe(0.9)
    void first
  })

  it('a different tier or endpoint is a different combination', () => {
    const registry = new CombinationRegistry()
    registry.observe(record({ tier: 'T1' }))
    const t2 = registry.observe(record({ tier: 'T2' }))
    expect(registry.latest({ provider: 'fake', model: 'm', endpoint: 'https://fake.invalid', tier: 'T1' })?.tier).toBe('T1')
    expect(registry.latest({ provider: 'fake', model: 'm', endpoint: 'https://fake.invalid', tier: 'T2' })).toBe(t2)
    expect(registry.latest({ provider: 'fake', model: 'm', endpoint: 'https://other.invalid', tier: 'T1' })).toBeUndefined()
  })
})
