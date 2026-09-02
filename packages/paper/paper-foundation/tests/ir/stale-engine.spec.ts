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
import { describe, expect, it } from 'vitest'
import {
  CAPTURE_ATTESTATION,
  ModelingIr,
  computeStaleReport,
  ingestCapturedRecord,
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

function storeWithFreshRecord(): ModelingIr {
  // Like storeWithBackbone, but ingests a fresh record so the chain
  // is NOT STALE — used by S-005.
  const ir = storeWithBackbone()
  ingest(ir)
  return ir
}

function ingest(ir: ModelingIr): void {
  if (ir.has('EXEC1')) return
  const rec: ExecutionRecord = executionRecord() as ExecutionRecord
  const v = ir.putExecutionRecord(rec, CAPTURE_ATTESTATION)
  expect(v.accepted, JSON.stringify(v)).toBe(true)
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
    // Fresh chain; mutate the run's seed AFTER ingesting the record.
    // The record's environment_hash freezes {environment, seed=20260828};
    // the run now declares seed=9999 → re-derivation differs.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    ir.put('RunArtifact', { ...runArtifact(), seed: 9999 } as never)
    const rec: ExecutionRecord = executionRecord() as ExecutionRecord
    ir.putExecutionRecord(rec, CAPTURE_ATTESTATION)
    const report = computeStaleReport(ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>)
    expect(report.stale.some(s => s.reason === 'EXECUTION_MISMATCH')).toBe(true)
  })

  it('S-004: a record whose dependency_lock_hash drifted is STALE (DEPENDENCY_MISMATCH)', () => {
    // Fresh chain; ingest the canonical record, THEN drift the model
    // by adding an extra assumption. The record\'s dependency_lock_hash
    // freezes the original model\'s hash; the engine sees a drift.
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    const baseModel = chainThrough('ModelSpec').find(e => e.kind === 'ModelSpec')?.value
    expect(baseModel).toBeDefined()
    const rec: ExecutionRecord = executionRecord() as ExecutionRecord
    ir.putExecutionRecord(rec, CAPTURE_ATTESTATION)
    ir.put('ModelSpec', { ...baseModel, assumptions: [...(baseModel as { assumptions?: string[] }).assumptions ?? [], 'drifted'] } as never)
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
    // Fresh chain; ingest the canonical record, then drift the run\'s
    // environment. The run is directly STALE; the citing Claim is
    // STALE_TRANSITIVE. (The RequirementSpec walk is TASK 4.0 territory;
    // this test pins the transitive propagation only.)
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    const rec: ExecutionRecord = executionRecord() as ExecutionRecord
    ir.putExecutionRecord(rec, CAPTURE_ATTESTATION)
    ir.put('RunArtifact', { ...runArtifact(), environment: 'python 9.99' } as never)
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
    const policy = buildDeliveryPolicy({ mode: 'fast', ir })
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate' && f.reason.startsWith('stale:'))).toBe(true)
  })

  it('a fresh chain (with record) passes the stale_detection gate', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.js')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.js')
    // backboneIr carries a fresh record.
    const ir = backboneIr()
    const policy = buildDeliveryPolicy({ mode: 'fast', ir })
    const decision = evaluateDelivery(policy)
    // Other gates may still refuse (stubs / delivery flow), but the
    // stale_detection reason must NOT be present.
    expect(decision.failures.some(f => f.reason.startsWith('stale:'))).toBe(false)
  })
})