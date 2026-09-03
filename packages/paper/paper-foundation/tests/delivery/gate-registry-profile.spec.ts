/**
 * TASK 5.0.11 / RG-08 — `runtimeProfileValid` is a real verdict.
 *
 * The delivery policy used to carry a hardcoded `runtimeProfileValid:
 * true`. That made `evaluateDelivery`'s `runtime_profile_invalid`
 * failure unreachable from production: a check that never runs but
 * always agrees. This file pins the replacement contract:
 *
 *   1. A policy built WITHOUT the guard's state is refused — omission
 *      is a refusal, not a pass (INV-3-O).
 *   2. A policy built with `runtimeProfileValid: true` carries no such
 *      failure.
 *   3. The guard's `isReady()` is the query the caller is expected to
 *      feed in, and it reflects the real readied state.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { buildDeliveryPolicy } from '../../src/delivery/gate-registry.ts'
import { DEFAULT_REPLAY_MAX_AGE_MS, evaluateDelivery } from '../../src/delivery/delivery-policy.ts'
import { ModelingIr } from '../../src/ir/index.ts'
import PaperRuntimeGuard from '../../src/runtime/runtime-guard.ts'
import { createFastProfile } from '../../src/runtime/profile.ts'

describe('TASK 5.0.11 — runtimeProfileValid is not a constant', () => {
  it('RG-08a: a policy built without the guard state is refused, not waved through', () => {
    const decision = evaluateDelivery(buildDeliveryPolicy({ mode: 'fast', ir: new ModelingIr() }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures).toContainEqual({
      kind: 'runtime_profile_invalid',
      reason: 'profile not valid',
    })
  })

  it('RG-08b: a policy built with an explicit true carries no profile failure', () => {
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: new ModelingIr(), runtimeProfileValid: true })
    expect(policy.runtimeProfileValid).toBe(true)
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.kind === 'runtime_profile_invalid')).toBe(false)
  })

  it('RG-08c: an explicit false is carried verbatim into the policy', () => {
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: new ModelingIr(), runtimeProfileValid: false })
    expect(policy.runtimeProfileValid).toBe(false)
    expect(evaluateDelivery(policy).allowed).toBe(false)
  })
})

describe('TASK 5.0.11 — PaperRuntimeGuard.isReady()', () => {
  it('RG-08d: isReady is false before markReady and true after', () => {
    const ctx = new Context()
    const guard = new PaperRuntimeGuard(ctx, { profile: createFastProfile() })
    expect(guard.isReady()).toBe(false)
    guard.markReady()
    expect(guard.isReady()).toBe(true)
  })

  it('RG-08e: isReady mirrors the same state assertRuntimeReady enforces', () => {
    const ctx = new Context()
    const guard = new PaperRuntimeGuard(ctx, { profile: createFastProfile() })
    expect(() => guard.assertRuntimeReady('fast')).toThrow()
    expect(guard.isReady()).toBe(false)
    guard.markReady()
    expect(() => guard.assertRuntimeReady('fast')).not.toThrow()
    expect(guard.isReady()).toBe(true)
  })
})

describe('TASK 5.0.8 — registry replay-evidence wiring', () => {
  it('a policy built without replay evidence carries NO replay obligation', () => {
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: new ModelingIr() })
    expect(policy.replayedAt).toBeNull()
    expect(policy.deliveryReplayMaxAgeMs).toBeNull()
    // Missing evidence is therefore not a failure — but only because the
    // policy declares no requirement. Nothing here invents evidence.
    expect(evaluateDelivery(policy).failures.some(f => f.kind === 'replay_stale')).toBe(false)
  })

  it('offering replay evidence without a window applies the 24h default (missing → blocked)', () => {
    const policy = buildDeliveryPolicy({
      mode: 'fast',
      ir: new ModelingIr(),
      runtimeProfileValid: true,
      replayEvidence: { replayedAt: null },
    })
    expect(policy.deliveryReplayMaxAgeMs).toBe(DEFAULT_REPLAY_MAX_AGE_MS)
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'replay_stale')).toBe(true)
  })

  it('fresh evidence under the default window delivers; stale evidence does not', () => {
    const now = Date.now()
    // EXPLORATORY so the only judgement under test is the replay rule:
    // the backbone-exempt mode reports every critical gate as
    // PASS-exempt, and profile validity is declared true.
    const fresh = buildDeliveryPolicy({
      mode: 'EXPLORATORY',
      ir: new ModelingIr(),
      runtimeProfileValid: true,
      replayEvidence: { replayedAt: new Date(now - 60_000).toISOString() },
    })
    expect(evaluateDelivery(fresh, now).allowed).toBe(true)

    const stale = buildDeliveryPolicy({
      mode: 'EXPLORATORY',
      ir: new ModelingIr(),
      runtimeProfileValid: true,
      replayEvidence: { replayedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() },
    })
    const staleDecision = evaluateDelivery(stale, now)
    expect(staleDecision.allowed).toBe(false)
    expect(staleDecision.failures.some(f => f.kind === 'replay_stale')).toBe(true)
  })

  it('an explicit null window waives the requirement even with evidence offered', () => {
    const policy = buildDeliveryPolicy({
      mode: 'EXPLORATORY',
      ir: new ModelingIr(),
      runtimeProfileValid: true,
      replayEvidence: { replayedAt: null },
      deliveryReplayMaxAgeMs: null,
    })
    expect(policy.deliveryReplayMaxAgeMs).toBeNull()
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(true)
    expect(decision.failures.some(f => f.kind === 'replay_stale')).toBe(false)
  })
})
