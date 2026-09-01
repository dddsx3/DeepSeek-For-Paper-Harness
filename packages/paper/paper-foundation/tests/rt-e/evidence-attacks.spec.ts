/**
 * TASK 2.1 — External attack suite RT-E1..RT-E4.
 *
 * Four roles from the task book, each targeting the freeze/audit layer:
 *
 *   RT-E1  Evidence Substitution — swap the Result (value, unit, or
 *          identity) behind a frozen claim. Expected: audit FAIL.
 *   RT-E2  Historical Replay — replay an old RunArtifact (old code hash
 *          / environment) under a new claim. Expected: audit FAIL.
 *   RT-E3  Partial Evidence — a chain with a member missing. Expected:
 *          refused by the store at ingest (closure), or caught by the
 *          audit when the *manifest* is the partial side.
 *   RT-E4  Agent Trust — the producer agent tries to be its own auditor:
 *          mutate the store after freeze, self-approve new evidence, or
 *          fabricate a self-consistent manifest. Expected: every route
 *          is detectable; the out-of-band manifest_hash anchor is the
 *          trust root (producer ≠ auditor).
 *
 * Every test asserts the observable verdict (audit status / failure
 * category / store refusal), never an implementation detail.
 */
import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  auditEvidenceFreeze,
  buildEvidenceFreeze,
  type EvidenceFreezeManifest,
  type IrObjectRecord,
} from '../../src/ir/index.ts'
import type { ModelingIr as ModelingIrInstance } from '../../src/ir/index.ts'
import {
  chainThrough,
  claim,
  result,
  runArtifact,
} from '../ir/fixtures.ts'

const NOW = () => '2026-09-01T00:00:00.000Z'

/** Closed store: full chain through Result, plus one CRITICAL NUMERIC claim. */
function buildStore(overrides: {
  claim?: Record<string, unknown>
  result?: Record<string, unknown>
  run?: Record<string, unknown>
} = {}): ModelingIrInstance {
  const ir = new ModelingIr({ now: NOW })
  for (const entry of chainThrough('Result')) {
    if (entry.kind === 'Result') {
      expect(ir.put('Result', result(overrides.result)).accepted).toBe(true)
    } else if (entry.kind === 'RunArtifact') {
      expect(ir.put('RunArtifact', runArtifact(overrides.run)).accepted).toBe(true)
    } else {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
  }
  expect(ir.put('Claim', claim(overrides.claim)).accepted).toBe(true)
  return ir
}

function snap(ir: ModelingIrInstance): ReadonlyMap<string, IrObjectRecord> {
  return ModelingIr.snapshot(ir) as ReadonlyMap<string, IrObjectRecord>
}

function freeze(ir: ModelingIrInstance): EvidenceFreezeManifest {
  return buildEvidenceFreeze(snap(ir), { now: NOW })
}

// ---------------------------------------------------------------------------
// RT-E1 — Evidence Substitution Attack
// ---------------------------------------------------------------------------

describe('RT-E1 — Evidence Substitution Attack', () => {
  it('E1-a: substituting the result VALUE behind a frozen claim is FAIL (RESULT_MISMATCH)', () => {
    const manifest = freeze(buildStore())
    const substituted = buildStore({ result: { value: 0.999 } })
    const report = auditEvidenceFreeze(snap(substituted), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'RESULT_MISMATCH' && f.severity === 'CRITICAL')).toBe(true)
    expect(report.failures.some(f => f.category === 'HASH_CHANGED')).toBe(true)
  })

  it('E1-b: substituting the result IDENTITY (same value/unit, different object) is FAIL', () => {
    const manifest = freeze(buildStore())
    // The substituted store binds the claim to RES-FAKE, a different
    // Result carrying the *same* value and unit. Identity is part of the
    // chain, so even a numerically identical substitution is caught.
    const ir = new ModelingIr({ now: NOW })
    for (const entry of chainThrough('RunArtifact')) {
      ir.put(entry.kind, entry.value)
    }
    expect(ir.put('Result', result({ result_id: 'RES-FAKE' })).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      evidence_refs: ['RES-FAKE'],
      result_refs: ['RES-FAKE'],
      numeric_binding: { result_ref: 'RES-FAKE', asserted_value: 0.731, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const report = auditEvidenceFreeze(snap(ir), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'MISSING_RESULT' && f.claim_id === 'C1')).toBe(true)
  })

  it('E1-c: substituting only the unit is FAIL (RESULT_MISMATCH)', () => {
    const manifest = freeze(buildStore())
    const substituted = buildStore({ result: { unit: 'cm' } })
    const report = auditEvidenceFreeze(snap(substituted), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'RESULT_MISMATCH')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// RT-E2 — Historical Replay Attack
// ---------------------------------------------------------------------------

describe('RT-E2 — Historical Replay Attack', () => {
  it('E2-a: replaying an OLD run (stale code_hash) under a new claim is FAIL (RUN_UNVERIFIED)', () => {
    const manifest = freeze(buildStore())
    const replayed = buildStore({ run: { code_hash: `sha256:${'b'.repeat(64)}` } })
    const report = auditEvidenceFreeze(snap(replayed), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'RUN_UNVERIFIED' && f.severity === 'HIGH')).toBe(true)
  })

  it('E2-b: replaying the old environment (seed drift) is FAIL (RUN_UNVERIFIED)', () => {
    const manifest = freeze(buildStore())
    const replayed = buildStore({ run: { seed: 20250101 } })
    const report = auditEvidenceFreeze(snap(replayed), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'RUN_UNVERIFIED')).toBe(true)
  })

  it('E2-c: a full replay of a divergent chain cannot pass the frozen manifest', () => {
    const manifest = freeze(buildStore())
    // Every layer replayed with divergent content.
    const replayed = buildStore({
      result: { value: 0.8 },
      run: { code_hash: `sha256:${'c'.repeat(64)}` },
      claim: { numeric_binding: { result_ref: 'RES1', asserted_value: 0.8, asserted_unit: 'm' } },
    })
    const report = auditEvidenceFreeze(snap(replayed), manifest)
    expect(report.status).toBe('FAIL')
    const categories = new Set(report.failures.map(f => f.category))
    expect(categories.has('RESULT_MISMATCH')).toBe(true)
    expect(categories.has('RUN_UNVERIFIED')).toBe(true)
    expect(categories.has('HASH_CHANGED')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// RT-E3 — Partial Evidence Attack
// ---------------------------------------------------------------------------

describe('RT-E3 — Partial Evidence Attack', () => {
  it('E3-a: the store itself refuses a Claim+Result chain with the Run missing', () => {
    // A Result cannot be ingested without its run_ref resolving (store
    // closure), so the partial chain dies at ingest — before any audit.
    const ir = new ModelingIr({ now: NOW })
    for (const entry of chainThrough('ModelSpec')) {
      ir.put(entry.kind, entry.value)
    }
    const verdict = ir.put('Result', result())
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'unresolved_reference' && f.path === 'run_ref')).toBe(true)
    }
  })

  it('E3-b: a manifest stripped of its run entries is detected as manifest tampering', () => {
    const manifest = freeze(buildStore())
    const stripped: EvidenceFreezeManifest = { ...manifest, runs: [] }
    const report = auditEvidenceFreeze(snap(buildStore()), stripped)
    expect(report.status).toBe('FAIL')
    expect(report.failures[0]).toMatchObject({ claim_id: '<manifest>', category: 'HASH_CHANGED', severity: 'CRITICAL' })
  })

  it('E3-c: a manifest stripped of its result entries is detected as manifest tampering', () => {
    const manifest = freeze(buildStore())
    const stripped: EvidenceFreezeManifest = { ...manifest, results: [] }
    const report = auditEvidenceFreeze(snap(buildStore()), stripped)
    expect(report.status).toBe('FAIL')
    expect(report.failures[0]).toMatchObject({ claim_id: '<manifest>', category: 'HASH_CHANGED' })
  })
})

// ---------------------------------------------------------------------------
// RT-E4 — Agent Trust Attack (producer ≠ auditor)
// ---------------------------------------------------------------------------

describe('RT-E4 — Agent Trust Attack', () => {
  it('E4-a: the audit is read-only — the producer agent cannot mutate via audit', () => {
    const ir = buildStore()
    const manifest = freeze(ir)
    const before = snap(ir)
    const sizeBefore = ir.size
    auditEvidenceFreeze(before, manifest)
    expect(ir.size).toBe(sizeBefore)
    expect(snap(ir)).toBe(before) // same live map, unmutated
  })

  it('E4-b: self-approved evidence (critical claim added after freeze) is FAIL', () => {
    const ir = buildStore()
    const manifest = freeze(ir)
    // The producer agent "approves its own" additional claim post-freeze.
    expect(ir.put('Claim', claim({ claim_id: 'C-SELF', text: 'self-approved' })).accepted).toBe(true)
    const report = auditEvidenceFreeze(snap(ir), manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f =>
      f.claim_id === 'C-SELF' && f.category === 'CHAIN_BROKEN' && f.severity === 'CRITICAL')).toBe(true)
  })

  it('E4-c: a fabricated self-consistent manifest has a different manifest_hash — the out-of-band anchor catches it', () => {
    // The producer re-freezes a TAMPERED store into a fresh, internally
    // consistent manifest and audits against it: the audit PASSes (it is
    // self-consistent), but the manifest_hash differs from the frozen
    // one. An external auditor comparing against the out-of-band hash
    // registry (freeze-hash-report.json) refuses the fabrication.
    const manifest = freeze(buildStore())
    const fabricated = freeze(buildStore({ result: { value: 0.999 } }))
    expect(auditEvidenceFreeze(snap(buildStore({ result: { value: 0.999 } })), fabricated).status).toBe('PASS')
    expect(fabricated.manifest_hash).not.toBe(manifest.manifest_hash)
  })

  it('E4-d: a manifest with a forged freeze_hash is refused before any per-claim verdict', () => {
    const manifest = freeze(buildStore())
    const forged: EvidenceFreezeManifest = { ...manifest, freeze_hash: '0'.repeat(64) }
    const report = auditEvidenceFreeze(snap(buildStore()), forged)
    expect(report.status).toBe('FAIL')
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]).toMatchObject({ claim_id: '<manifest>', category: 'HASH_CHANGED', severity: 'CRITICAL' })
  })
})