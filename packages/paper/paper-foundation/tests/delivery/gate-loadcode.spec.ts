/**
 * P1-4 — stale S-007 byte-check wiring (loadCode injection) + sync-hack
 * removal.
 *
 * Before P1-4 the STALE engine's `loadCode` accepted a Promise and blocked
 * on it with a microtask-flush hack (`requirePromise`) that crashed unless
 * the promise happened to be settled already. P1-4 removes the hack:
 * `loadCode` is strictly synchronous, and the delivery composition injects
 * it through `buildDeliveryPolicy({ loadCode })` → GateContext → the
 * stale-consuming producers (execution / stale_detection).
 *
 * These tests pin the wiring end to end and the no-crash contract when an
 * async function is handed in anyway (JS callers can break the type): the
 * engine must NOT throw 'requires synchronous loadCode' — it treats the
 * object as bytes and reports CODE_MISMATCH like any other drift.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/gate-loadcode
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { computeStaleReport } from '../../src/ir/stale.js'
import { backboneIr } from '../ir/fixtures.ts'

describe('P1-4 stale loadCode wiring (S-007 through the delivery policy)', () => {
  it('a loadCode that returns forged bytes BLOCKs execution + stale_detection on a fresh backbone', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const policy = buildDeliveryPolicy({
      mode: 'fast',
      ir: backboneIr(),
      runtimeProfileValid: true,
      // The real code bytes on disk differ from the declared code_hash,
      // so the run's own evidence is stale (S-007: bytes trusted, hash
      // untrusted) even though the store is internally consistent.
      loadCode: () => '# forged bytes that hash differently\nprint(0)',
    })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('execution:BLOCKED:'))).toBe(true)
    expect(decision.failures.some(f => f.reason.startsWith('stale_detection:BLOCKED:'))).toBe(true)
  })

  it('the same backbone without loadCode keeps PASS (byte check skipped, no false block)', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: backboneIr(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('execution:BLOCKED:'))).toBe(false)
    expect(decision.failures.some(f => f.reason.startsWith('stale_detection:BLOCKED:'))).toBe(false)
  })

  it('the execution findings API forwards loadCode too', async () => {
    const snapshot = ModelingIr.snapshot(backboneIr())
    const { executionGateFindings } = await import('../../src/delivery/execution-gate.ts')
    const findings = snapshot === null ? [] : executionGateFindings(snapshot, {
      loadCode: () => '# forged bytes that hash differently\nprint(0)',
    })
    expect(findings.some(f => f.kind === 'record_stale')).toBe(true)
  })
})

describe('P1-4 sync-hack removal contract', () => {
  it('an async loadCode (JS caller) does not crash the engine with the old hack message', () => {
    // TypeScript forbids a Promise-returning loadCode now; a JS caller can
    // still smuggle one in. The engine must NOT throw the removed
    // 'requires synchronous loadCode' error — the async loader's returned
    // Promise object hashes like any other bytes, so the run is a
    // CODE_MISMATCH finding (or unreadable -> CODE_MISMATCH), never a hang.
    const snapshot = ModelingIr.snapshot(backboneIr())
    let thrown: unknown = undefined
    let report: { stale: ReadonlyArray<{ reason: string }> } | undefined
    try {
      report = computeStaleReport(
        snapshot as never,
        // Deliberate type violation: JS callers are not type-checked.
        { loadCode: (async (ref: string) => `bytes-of-${ref}`) as never },
      ) as never
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeUndefined()
    expect(report).toBeDefined()
    expect(report!.stale.some(f => f.reason === 'CODE_MISMATCH')).toBe(true)
  })
})
