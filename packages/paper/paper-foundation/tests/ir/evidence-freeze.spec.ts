/**
 * TASK 2.1 — Evidence Chain Freeze & Independent Audit: unit suite.
 *
 * Covers the three properties the task book assigns to this layer:
 *   - PHASE 0: the freeze manifest is deterministic and complete.
 *   - PHASE 2 (INV-2.1-A): `evidence_chain_hash` flips when ANY member
 *     of the chain changes — claim binding, result value/unit, run
 *     fingerprints, evidence refs.
 *   - PHASE 1: the audit is read-only, total, and fail-closed with the
 *     closed failure taxonomy (MISSING_RESULT / RESULT_MISMATCH /
 *     RUN_UNVERIFIED / HASH_CHANGED / CHAIN_BROKEN).
 *
 * The RT-E attack suite lives in `tests/rt-e/`; this file pins the
 * contract directly, one guard at a time, so mutation survivors have a
 * direct single-test home (TASK 1.5R M-14 lesson).
 */
import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_AUDIT_CATEGORIES,
  EVIDENCE_AUDIT_SEVERITIES,
  ModelingIr,
  auditEvidenceFreeze,
  buildEvidenceFreeze,
  canonicalJson,
  sha256Hex,
  type EvidenceFreezeManifest,
  type IrObjectRecord,
} from '../../src/ir/index.ts'
import type { ModelingIr as ModelingIrInstance } from '../../src/ir/index.ts'
import {
  chainThrough,
  claim,
  result,
  runArtifact,
} from './fixtures.ts'

const NOW = () => '2026-09-01T00:00:00.000Z'

/** Build a closed store: full chain through Result, plus one Claim. */
function buildStore(overrides: {
  claim?: Record<string, unknown>
  result?: Record<string, unknown>
  run?: Record<string, unknown>
} = {}): ModelingIrInstance {
  const ir = new ModelingIr({ now: NOW })
  for (const entry of chainThrough('Result')) {
    if (entry.kind === 'Result') {
      expect(ir.put('Result', result(overrides.result)).accepted, 'Result fixture must ingest').toBe(true)
    } else if (entry.kind === 'RunArtifact') {
      expect(ir.put('RunArtifact', runArtifact(overrides.run)).accepted, 'RunArtifact fixture must ingest').toBe(true)
    } else {
      expect(ir.put(entry.kind, entry.value).accepted, `${entry.kind} fixture must ingest`).toBe(true)
    }
  }
  expect(ir.put('Claim', claim(overrides.claim)).accepted, 'Claim fixture must ingest').toBe(true)
  return ir
}

function snapshotOf(ir: ModelingIrInstance): ReadonlyMap<string, IrObjectRecord> {
  return ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>
}

// ---------------------------------------------------------------------------
// canonicalJson / sha256Hex — the determinism substrate
// ---------------------------------------------------------------------------

describe('canonicalJson — deterministic serialisation', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  it('sorts keys recursively and preserves array order', () => {
    const a = { z: { y: 1, x: 2 }, arr: [3, 1, 2] }
    const b = { arr: [3, 1, 2], z: { x: 2, y: 1 } }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(canonicalJson(a)).toContain('"arr":[3,1,2]')
  })

  it('serialises -0 as 0 (JSON has no negative zero)', () => {
    expect(canonicalJson(-0)).toBe(canonicalJson(0))
    expect(canonicalJson({ v: -0 })).toBe('{"v":0}')
  })

  it('sha256Hex is the sha256 of the UTF-8 bytes', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toHaveLength(64)
  })
})

// ---------------------------------------------------------------------------
// PHASE 0 — buildEvidenceFreeze determinism + completeness
// ---------------------------------------------------------------------------

describe('buildEvidenceFreeze — deterministic freeze snapshot', () => {
  it('produces identical freeze_hash and manifest_hash across two builds with different clocks', () => {
    const ir = buildStore()
    const a = buildEvidenceFreeze(snapshotOf(ir), { now: () => '2026-09-01T00:00:00.000Z' })
    const b = buildEvidenceFreeze(snapshotOf(ir), { now: () => '2027-01-01T00:00:00.000Z' })
    expect(a.freeze_hash).toBe(b.freeze_hash)
    expect(a.manifest_hash).toBe(b.manifest_hash)
    expect(a.generated_at).not.toBe(b.generated_at)
  })

  it('freezes every layer: claim (with binding), result (producer/timestamp), run (fingerprints)', () => {
    const ir = buildStore()
    const manifest = buildEvidenceFreeze(snapshotOf(ir), { now: NOW })

    expect(manifest.manifest_version).toBe(1)
    expect(manifest.claims).toHaveLength(1)
    expect(manifest.results).toHaveLength(1)
    expect(manifest.runs).toHaveLength(1)

    const frozenClaim = manifest.claims[0]!
    expect(frozenClaim.claim_id).toBe('C1')
    expect(frozenClaim.critical).toBe(true)
    expect(frozenClaim.numeric_binding).toEqual({ result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' })
    expect(frozenClaim.evidence_chain_hash).toMatch(/^[0-9a-f]{64}$/)

    const frozenResult = manifest.results[0]!
    expect(frozenResult.result_id).toBe('RES1')
    expect(frozenResult.value).toBe(0.731)
    expect(frozenResult.unit).toBe('m')
    expect(frozenResult.producer).toBe('RUN1')
    expect(frozenResult.timestamp).toBe('2026-09-01T00:00:00.000Z')

    const frozenRun = manifest.runs[0]!
    expect(frozenRun.run_id).toBe('RUN1')
    expect(frozenRun.code_hash).toMatch(/^[0-9a-f]{64}$|^sha256:/)
    expect(frozenRun.environment_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(frozenRun.dependency_lock_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// PHASE 2 — INV-2.1-A: the chain hash is load-bearing
// ---------------------------------------------------------------------------

describe('INV-2.1-A — evidence_chain_hash flips on any chain change', () => {
  const baseline = buildEvidenceFreeze(snapshotOf(buildStore()), { now: NOW }).claims[0]!.evidence_chain_hash

  it('flips when the numeric binding asserted_value changes', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore({
      claim: { numeric_binding: { result_ref: 'RES1', asserted_value: 0.999, asserted_unit: 'm' } },
    })), { now: NOW })
    expect(manifest.claims[0]!.evidence_chain_hash).not.toBe(baseline)
  })

  it('flips when the result value changes', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore({
      result: { value: 0.999 },
    })), { now: NOW })
    expect(manifest.claims[0]!.evidence_chain_hash).not.toBe(baseline)
  })

  it('flips when the result unit changes', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore({
      result: { unit: 'cm' },
      claim: { numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'cm' } },
    })), { now: NOW })
    expect(manifest.claims[0]!.evidence_chain_hash).not.toBe(baseline)
  })

  it('flips when the run code_hash changes', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore({
      run: { code_hash: `sha256:${'b'.repeat(64)}` },
    })), { now: NOW })
    expect(manifest.claims[0]!.evidence_chain_hash).not.toBe(baseline)
  })

  it('flips when the run environment (seed) changes', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore({
      run: { seed: 42 },
    })), { now: NOW })
    expect(manifest.claims[0]!.evidence_chain_hash).not.toBe(baseline)
  })

  it('flips when evidence_refs change', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore({
      claim: { evidence_refs: [] },
    })), { now: NOW })
    expect(manifest.claims[0]!.evidence_chain_hash).not.toBe(baseline)
  })

  it('is stable when nothing in the chain changes', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore()), { now: NOW })
    expect(manifest.claims[0]!.evidence_chain_hash).toBe(baseline)
  })
})

// ---------------------------------------------------------------------------
// PHASE 1 — audit semantics: PASS, closed categories, read-only, verdict
// ---------------------------------------------------------------------------

describe('auditEvidenceFreeze — PASS path and determinism', () => {
  it('returns PASS with 100% of critical claims audited on an unchanged store', () => {
    const ir = buildStore()
    const manifest = buildEvidenceFreeze(snapshotOf(ir), { now: NOW })
    const report = auditEvidenceFreeze(snapshotOf(ir), manifest)
    expect(report.status).toBe('PASS')
    expect(report.claims_checked).toBe(1)
    expect(report.failures).toEqual([])
    expect(report.manifest_hash).toBe(manifest.manifest_hash)
  })

  it('is deterministic: same inputs → same audit_id and verdict', () => {
    const ir = buildStore()
    const manifest = buildEvidenceFreeze(snapshotOf(ir), { now: NOW })
    const a = auditEvidenceFreeze(snapshotOf(ir), manifest)
    const b = auditEvidenceFreeze(snapshotOf(ir), manifest)
    expect(a.audit_id).toBe(b.audit_id)
    expect(a.status).toBe(b.status)
  })
})

describe('auditEvidenceFreeze — closed failure taxonomy', () => {
  it('declares the closed category and severity sets', () => {
    expect(EVIDENCE_AUDIT_CATEGORIES).toEqual([
      'MISSING_RESULT', 'RESULT_MISMATCH', 'RUN_UNVERIFIED', 'HASH_CHANGED', 'CHAIN_BROKEN',
    ])
    expect(EVIDENCE_AUDIT_SEVERITIES).toEqual(['CRITICAL', 'HIGH', 'MEDIUM'])
  })

  it('RESULT_MISMATCH (CRITICAL): live result value drifted from the frozen manifest', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore()), { now: NOW })
    const tampered = buildStore({ result: { value: 0.999 } })
    const report = auditEvidenceFreeze(snapshotOf(tampered), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'RESULT_MISMATCH' && f.severity === 'CRITICAL')).toBe(true)
  })

  it('RESULT_MISMATCH (CRITICAL): live result unit drifted', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore()), { now: NOW })
    const tampered = buildStore({ result: { unit: 'cm' } })
    const report = auditEvidenceFreeze(snapshotOf(tampered), manifest)
    expect(report.failures.some(f => f.category === 'RESULT_MISMATCH')).toBe(true)
  })

  it('RUN_UNVERIFIED (HIGH): the producing run\'s code fingerprint drifted', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore()), { now: NOW })
    const tampered = buildStore({ run: { code_hash: `sha256:${'b'.repeat(64)}` } })
    const report = auditEvidenceFreeze(snapshotOf(tampered), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'RUN_UNVERIFIED' && f.severity === 'HIGH')).toBe(true)
  })

  it('RUN_UNVERIFIED (HIGH): the run environment drifted (seed change)', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore()), { now: NOW })
    const tampered = buildStore({ run: { seed: 42 } })
    const report = auditEvidenceFreeze(snapshotOf(tampered), manifest)
    expect(report.failures.some(f => f.category === 'RUN_UNVERIFIED')).toBe(true)
  })

  it('HASH_CHANGED (HIGH): claim content drifted while results and runs stayed put', () => {
    const manifest = buildEvidenceFreeze(snapshotOf(buildStore()), { now: NOW })
    const tampered = buildStore({ claim: { evidence_refs: [] } })
    const report = auditEvidenceFreeze(snapshotOf(tampered), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'HASH_CHANGED' && f.severity === 'HIGH')).toBe(true)
  })

  it('MISSING_RESULT (CRITICAL): a frozen result ref is absent from the live store', () => {
    // Store A's claim references RES1 + RES2; store B's claim references
    // only RES1. Auditing B against A's manifest must flag RES2 missing.
    const irA = new ModelingIr({ now: NOW })
    for (const entry of chainThrough('Result')) {
      irA.put(entry.kind === 'Result' ? 'Result' : entry.kind,
        entry.kind === 'Result' ? result() : entry.value)
    }
    expect(irA.put('Result', result({ result_id: 'RES2', name: 'max_thickness', value: 0.95 })).accepted).toBe(true)
    expect(irA.put('Claim', claim({ result_refs: ['RES1', 'RES2'] })).accepted).toBe(true)
    const manifest = buildEvidenceFreeze(snapshotOf(irA), { now: NOW })

    const irB = new ModelingIr({ now: NOW })
    for (const entry of chainThrough('Result')) {
      irB.put(entry.kind, entry.value)
    }
    expect(irB.put('Claim', claim()).accepted).toBe(true)
    const report = auditEvidenceFreeze(snapshotOf(irB), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'MISSING_RESULT' && f.severity === 'CRITICAL')).toBe(true)
  })

  it('CHAIN_BROKEN (CRITICAL): a critical claim exists only in the live store (unfrozen evidence)', () => {
    const ir = buildStore()
    const manifest = buildEvidenceFreeze(snapshotOf(ir), { now: NOW })
    expect(ir.put('Claim', claim({ claim_id: 'C2', text: 'Self-approved second claim.' })).accepted).toBe(true)
    const report = auditEvidenceFreeze(snapshotOf(ir), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.claim_id === 'C2' && f.category === 'CHAIN_BROKEN' && f.severity === 'CRITICAL')).toBe(true)
  })

  it('CHAIN_BROKEN (CRITICAL): a frozen critical claim is absent from the live store', () => {
    const ir = buildStore()
    const manifest = buildEvidenceFreeze(snapshotOf(ir), { now: NOW })
    // An empty store cannot literally "lose" a claim (append-only), so the
    // vanishing-claim branch is exercised with a store that never had it.
    const empty = new ModelingIr({ now: NOW })
    const report = auditEvidenceFreeze(snapshotOf(empty), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.claim_id === 'C1' && f.category === 'CHAIN_BROKEN')).toBe(true)
  })

  it('MEDIUM: non-critical claim drift is recorded but never flips the verdict', () => {
    const ir = buildStore({ claim: { criticality: 'NON_CRITICAL' } })
    const manifest = buildEvidenceFreeze(snapshotOf(ir), { now: NOW })
    expect(manifest.claims[0]!.critical).toBe(false)
    const tampered = buildStore({ claim: { criticality: 'NON_CRITICAL', evidence_refs: [] } })
    const report = auditEvidenceFreeze(snapshotOf(tampered), manifest)
    expect(report.claims_checked).toBe(0)
    expect(report.failures.every(f => f.severity === 'MEDIUM')).toBe(true)
    expect(report.status).toBe('PASS')
  })
})

describe('auditEvidenceFreeze — manifest integrity (RT-E4 anchor)', () => {
  it('FAILs with a <manifest> HASH_CHANGED when the frozen manifest is tampered', () => {
    const ir = buildStore()
    const manifest: EvidenceFreezeManifest = {
      ...buildEvidenceFreeze(snapshotOf(ir), { now: NOW }),
    }
    const tampered: EvidenceFreezeManifest = {
      ...manifest,
      claims: manifest.claims.map(c => c.claim_id === 'C1'
        ? { ...c, criticality: 'NON_CRITICAL', critical: false }
        : c),
      // manifest_hash deliberately NOT recomputed — that is the tamper.
    }
    const report = auditEvidenceFreeze(snapshotOf(ir), tampered)
    expect(report.status).toBe('FAIL')
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]).toMatchObject({ claim_id: '<manifest>', category: 'HASH_CHANGED', severity: 'CRITICAL' })
    expect(report.claims_checked).toBe(0)
  })
})

describe('auditEvidenceFreeze — read-only guarantee (RT-E4)', () => {
  it('never mutates the store: size, ids, and frozen envelopes are untouched', () => {
    const ir = buildStore()
    const manifest = buildEvidenceFreeze(snapshotOf(ir), { now: NOW })
    const before = ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>
    const sizeBefore = ir.size
    const keysBefore = [...before.keys()].sort()

    auditEvidenceFreeze(before, manifest)

    expect(ir.size).toBe(sizeBefore)
    const after = ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>
    expect([...after.keys()].sort()).toEqual(keysBefore)
    for (const key of keysBefore) {
      expect(Object.isFrozen(after.get(key))).toBe(true)
      expect(after.get(key)).toBe(before.get(key))
    }
  })
})