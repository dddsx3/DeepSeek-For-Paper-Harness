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
import { evaluateDelivery } from '../../src/delivery/delivery-policy.ts'
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
