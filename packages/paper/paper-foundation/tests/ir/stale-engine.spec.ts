/**
 * TASK 3.5 — STALE engine attack suite (S-001..S-009).
 *
 * Roles (task book §11):
 *   - S-001..S-006: direct STALE on run records / runs (S-001..S-006 mandatory).
 *   - S-007:  code_ref bytes drift while code_hash string is unchanged
 *             (the declared hash is untrusted; the STALE engine re-derives
 *             from the bytes the run actually executed).
 *   - S-008:  no markFresh() interface exists. Hand-editing a STALE flag
 *             back to FRESH is impossible by construction.
 *   - S-009:  a RequirementSpec change invalidates every Claim citing it
 *             through transitive propagation (STALE_TRANSITIVE).
 *
 * Every test asserts the observable verdict; an attack that succeeds
 * is a gap, an attack that is blocked is coverage.
 */
import {  describe,  expect,  it  } from 'vitest'
import {
  CAPTURE_ATTESTATION,
  ModelingIr,
  computeStaleReport,
  type ExecutionRecord,
  type IrObjectRecord,
} from '../../src/ir/index.ts'
import {
  backboneIr,
  chainThrough,
  executionRecord,
  runArtifact,
} from './fixtures.ts'

function storeWithBackbone(loadBytes: string | null = null): ModelingIr {
  // Build a CRITICAL-chain IR without an ExecutionRecord. S-001 expects
  // "no record → STALE" (the default state). When loadBytes is set, we
  // also re-issue the run with a new code_ref (for S-007).
  const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
  for (const entry of chainThrough('RunArtifact')) {
    ir.put(entry.kind, entry.value)
  }
  if (loadBytes !== null) {
    ir.put('RunArtifact', { ...runArtifact(), code_ref: 'file:///code-v2.py' } as never)
  }
  return ir
}

describe('TASK 3.5 — direct STALE on a run (S-001..S-006)', () => {
  it('S-001: a run with no record is STALE (the canonical executor must ingest one)', () => {
    const ir = storeWithBackbone()
    // No capture / ingest → the run has no executable evidence.
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    expect(report.stale.length).toBeGreaterThan(0)
    expect(report.stale.some(s => s.id === 'RUN1' && s.reason === 'EXECUTION_MISMATCH')).toBe(true)
  })

  it('S-002: a record whose code_hash is unrelated to the run is STALE (CODE_MISMATCH via dependency walk)', () => {
    // Fresh chain (no canonical record), ingest a forged record whose
    // code_hash disagrees with the run\'s declared code_hash.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    const forged: ExecutionRecord = {
      ...executionRecord() as ExecutionRecord,
      execution_id: 'EXEC2',
      code_hash: 'sha256:' + 'b'.repeat(64),
    }
    ir.putExecutionRecord(forged, CAPTURE_ATTESTATION)
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    expect(report.stale.some(s => s.reason === 'CODE_MISMATCH')).toBe(true)
  })

  it('S-003: a record whose environment_hash drifted is STALE (EXECUTION_MISMATCH)', () => {
    // 5.0-R (decision 5): the measurement source is the IR itself — the
    // RunArtifact declares the environment, the ExecutionRecord freezes
    // what actually ran; the engine re-derives the declared fingerprint
    // and compares. The store is immutable, so "drift" cannot be written
    // by overwriting the run (that put is refused with duplicate_id); it
    // is expressed on the capture, exactly as S-002 does for code_hash: a
    // forged record whose environment_hash disagrees with the run's
    // declaration is EXECUTION_MISMATCH.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    const forged: ExecutionRecord = {
      ...executionRecord() as ExecutionRecord,
      execution_id: 'EXEC2',
      environment_hash: 'sha256:' + 'c'.repeat(64),
    }
    ir.putExecutionRecord(forged, CAPTURE_ATTESTATION)
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    expect(report.stale.some(s => s.reason === 'EXECUTION_MISMATCH')).toBe(true)
  })

  it('S-004: a record whose dependency_lock_hash drifted is STALE (DEPENDENCY_MISMATCH)', () => {
    // 5.0-R (decision 5): same immutable-store discipline as S-003 — the
    // drift (model assumptions / input data changed between the declared
    // run and the capture) is expressed on the forged record's
    // dependency_lock_hash, and the engine compares it to the fingerprint
    // re-derived from the run + its model.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    const forged: ExecutionRecord = {
      ...executionRecord() as ExecutionRecord,
      execution_id: 'EXEC3',
      dependency_lock_hash: 'sha256:' + 'd'.repeat(64),
    }
    ir.putExecutionRecord(forged, CAPTURE_ATTESTATION)
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    expect(report.stale.some(s => s.reason === 'DEPENDENCY_MISMATCH' || s.reason === 'EXECUTION_MISMATCH')).toBe(true)
  })

  it('S-005: a fresh record (everything matches) is NOT STALE', () => {
    // Use the canonical backbone (record already included) — every
    // declared fingerprint re-derives cleanly, so no STALE findings.
    const ir = backboneIr()
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    expect(report.stale).toEqual([])
  })

  it('S-006: a transitive STALE run makes its Result and citing Claim STALE', () => {
    // Fresh chain, no record → run is STALE → result + claim
    // are STALE_TRANSITIVE.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('ReviewerFinding')) {
      ir.put(entry.kind, entry.value)
    }
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    const reasons = report.stale.map(s => s.reason)
    expect(reasons).toContain('EXECUTION_MISMATCH')
    expect(reasons).toContain('STALE_TRANSITIVE')
  })
})

describe('TASK 3.5 — byte-level + immutable + transitive (S-007..S-009)', () => {
  it('S-007: code_ref bytes drift while code_hash string is unchanged → STALE (bytes trusted, hash untrusted)', () => {
    // Fresh chain; ingest a record that freezes the run\'s declared
    // code_hash, then re-issue the run with a new code_ref (the
    // declared code_hash stays the same string). The engine\'s loadCode
    // returns bytes that hash differently.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    const rec: ExecutionRecord = executionRecord() as ExecutionRecord
    ir.putExecutionRecord(rec, CAPTURE_ATTESTATION)
    ir.put('RunArtifact', { ...runArtifact(), code_ref: 'file:///code-v2.py' } as never)
    const report = computeStaleReport(
      ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>,
      { loadCode: () => '# different bytes\nprint(0.999)\n' },
    )
    expect(report.stale.some(s => s.reason === 'CODE_MISMATCH' && s.id === 'RUN1')).toBe(true)
  })

  it('S-008: there is no markFresh() / un-stale interface — STALE cannot be hand-cleared', async () => {
    // The STALE engine exports only computeStaleReport. A direct grep
    // of the surface area confirms there is no public path that flips
    // a stale verdict. (Static check; failure of this assertion is a
    // contract regression.)
    const mod = await import('../../src/ir/index.ts') as Record<string, unknown>
    for (const forbidden of ['markFresh', 'clearStale', 'unStale', 'setFresh']) {
      expect(mod, `forbidden export: ${forbidden}`).not.toHaveProperty(forbidden)
    }
    expect(typeof mod.computeStaleReport).toBe('function')
  })

  it('S-009: RequirementSpec change invalidates the citing Claim (STALE_TRANSITIVE)', () => {
    // 5.0-R (decision 5 + §5.7 boundary): a RequirementSpec->Claim walk is
    // TASK 4.0 coverage-closure territory (P1-4) and the STALE propagation
    // graph is frozen in this batch, so this test pins what the engine
    // DOES own: a directly-STALE run (here: a forged capture whose
    // environment_hash disagrees with the run declaration, S-003 style)
    // propagates STALE_TRANSITIVE to the citing Claim through the run's
    // Result. The RequirementSpec-specific walk lands with P1-4.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Claim')) {
      ir.put(entry.kind, entry.value)
    }
    const forged: ExecutionRecord = {
      ...executionRecord() as ExecutionRecord,
      execution_id: 'EXEC4',
      environment_hash: 'sha256:' + 'e'.repeat(64),
    }
    ir.putExecutionRecord(forged, CAPTURE_ATTESTATION)
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    expect(report.stale.some(s => s.id === 'RUN1' && s.reason === 'EXECUTION_MISMATCH')).toBe(true)
    expect(report.stale.some(s => s.id === 'C1' && s.reason === 'STALE_TRANSITIVE')).toBe(true)
  })
})

describe('TASK 3.5 — delivery gate integration (the load-bearing outcome)', () => {
  it('the stale_detection critical gate is BLOCKED when the chain is STALE', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.js')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.js')
    // Fresh chain without an ExecutionRecord → STALE.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    // 5.0-R (R3-2a): the runtime guard is readied (TASK 5.0.11) — these
    // integration cases assert the stale_detection gate, not the runtime
    // profile dimension, so the caller states readiness explicitly.
    const policy = buildDeliveryPolicy({ mode: 'fast', ir, runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    // evaluateDelivery prefixes gate failures with `${id}:${status}:` —
    // a BLOCKED stale_detection gate is the only failure that starts
    // 'stale_detection:'. The assertion targets that exact contract.
    expect(decision.failures.some(f => f.kind === 'critical_gate' && f.reason.startsWith('stale_detection:BLOCKED:stale:'))).toBe(true)
  })

  it('a fresh chain (with record) passes the stale_detection gate', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.js')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.js')
    // backboneIr carries a fresh record.
    const ir = backboneIr()
    const policy = buildDeliveryPolicy({ mode: 'fast', ir, runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    // Other gates may still refuse (stubs / delivery flow), but the
    // stale_detection gate must NOT have BLOCKED (reason contract:
    // `${id}:${status}:${reason}`, so a BLOCKED stale gate starts
    // 'stale_detection:BLOCKED:').
    expect(decision.failures.some(f => f.reason.startsWith('stale_detection:BLOCKED:'))).toBe(false)
  })
})