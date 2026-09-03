/**
 * TASK 2 — direct unit tests for the Claim Evidence validator.
 *
 * The bridge suite (`tests/ir/bridge.spec.ts`) drives the validator
 * end-to-end through `evaluateIrBridge`, and the fault corpus
 * (`tests/ir/fault-corpus-d2.spec.ts`) runs every D-001..D-020
 * fixture. This file is the third tier of coverage: it calls
 * `validateClaimEvidence` directly so the validator's contract is
 * pinned without going through the store, the snapshot, or any
 * integration path. Per TASK 1.5R HANDOFF-AGENT-NOTES §6, mutations
 * that survive integration tests may still be reachable via a direct
 * unit test (and vice versa); the file is the place to land both
 * kinds of regression.
 */
import {  describe,  expect,  it  } from 'vitest'
import {
  CLAIM_EVIDENCE_FAILURE_KINDS,
  ModelingIr,
  numericValuesEqual,
  validateClaimEvidence,
  type ClaimEvidenceResolver,
} from '../../src/ir/index.ts'
import {
  backboneIr,
  claim,
  modelClaim,
  qualitativeClaim,
} from './fixtures.ts'

// ---------------------------------------------------------------------------
// Equality policy (D-017)
// ---------------------------------------------------------------------------

describe('numericValuesEqual — the frozen equality policy', () => {
  it('passes a plain identity match', () => {
    expect(numericValuesEqual(0.731, 0.731)).toBe(true)
  })

  it('collapses -0 to +0 (D-017 frozen policy)', () => {
    expect(numericValuesEqual(-0, 0)).toBe(true)
    expect(numericValuesEqual(0, -0)).toBe(true)
    expect(numericValuesEqual(-0, -0)).toBe(true)
  })

  it('rejects a non-equal value', () => {
    expect(numericValuesEqual(0.731, 0.732)).toBe(false)
  })

  it('never sees NaN: zod.number() rejects it before the validator runs', () => {
    // The validator is never handed NaN through the canonical store
    // (zod.number() refuses it), so this test only documents the
    // post-condition: NaN-as-input is unreachable from the validator's
    // normal entry point. The standalone function still happens to
    // return false for two NaNs — that matches ` ` in ECMAScript,
    // and is documented behaviour here.
    expect(numericValuesEqual(NaN, NaN)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Resolver helpers — small, manual maps for direct unit tests.
// ---------------------------------------------------------------------------

function resolverFromMap(entries: ReadonlyArray<readonly [string, { kind: 'Result'; value: number; unit: string } | { kind: 'ModelSpec' } | { kind: 'DataArtifact' }]>): ClaimEvidenceResolver {
  const map = new Map(entries)
  return (ref: string) => map.get(ref)
}

// ---------------------------------------------------------------------------
// NUMERIC claims
// ---------------------------------------------------------------------------

describe('validateClaimEvidence — NUMERIC binding shape', () => {
  const resolver = resolverFromMap([
    ['RES1', { kind: 'Result', value: 0.731, unit: 'm' }],
    ['M1', { kind: 'ModelSpec' }],
  ])

  it('passes a well-formed NUMERIC CRITICAL Claim', () => {
    const claimValue = claim()
    expect(validateClaimEvidence(claimValue, resolver)).toEqual([])
  })

  it('reports numeric_value_mismatch when asserted_value differs from Result.value (D-005)', () => {
    const claimValue = claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.732, asserted_unit: 'm' },
    })
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })

  it('reports numeric_unit_mismatch when asserted_unit differs from Result.unit (D-006)', () => {
    const claimValue = claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'cm' },
    })
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'numeric_unit_mismatch')).toBe(true)
  })

  it('reports numeric_binding_result_not_in_result_refs (D-004)', () => {
    const claimValue = claim({
      result_refs: ['RES1'],
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    })
    // Above is legal; force the bug by pointing the binding at M1
    // (which is not in result_refs).
    claimValue.result_refs = ['M1']
    claimValue.numeric_binding = { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' }
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'numeric_binding_result_not_in_result_refs')).toBe(true)
  })

  it('reports numeric_binding_result_unresolved when result_ref is missing (D-002)', () => {
    const sparse: ClaimEvidenceResolver = (ref: string) => ref === 'M1' ? { kind: 'ModelSpec' } : undefined
    const claimValue = claim()
    const failures = validateClaimEvidence(claimValue, sparse)
    expect(failures.some(f => f.kind === 'numeric_binding_result_unresolved')).toBe(true)
  })

  it('reports numeric_binding_result_unresolved when result_ref points at the wrong kind (D-003)', () => {
    // resolver returns M1 as a ModelSpec; binding says RES1; RES1 not
    // in resolver.
    const claimValue = claim({ result_refs: ['M1'], numeric_binding: { result_ref: 'M1', asserted_value: 0.731, asserted_unit: 'm' } })
    const failures = validateClaimEvidence(claimValue, resolver)
    // Schema shape is fine; the semantic guard catches it as "result_ref
    // resolves to ModelSpec, expected Result".
    expect(failures.some(f => f.kind === 'numeric_binding_result_unresolved')).toBe(true)
  })

  it('collapses -0 to +0 for asserted_value (D-017)', () => {
    const resolverWith0 = resolverFromMap([
      ['RES1', { kind: 'Result', value: 0, unit: 'm' }],
    ])
    const claimValue = claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: -0, asserted_unit: 'm' },
    })
    expect(validateClaimEvidence(claimValue, resolverWith0)).toEqual([])
  })

  it('rejects a tolerance / rounding disguise (D-007)', () => {
    const claimValue = claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.7309999, asserted_unit: 'm' },
    })
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MODEL claims
// ---------------------------------------------------------------------------

describe('validateClaimEvidence — MODEL claim shape', () => {
  it('passes a MODEL claim with a resolved ModelSpec ref', () => {
    const claimValue = modelClaim()
    const resolver = resolverFromMap([['M1', { kind: 'ModelSpec' }]])
    expect(validateClaimEvidence(claimValue, resolver)).toEqual([])
  })

  it('reports model_claim_no_model_ref when model_refs is empty (D-009)', () => {
    const claimValue = modelClaim({ model_refs: [] })
    const resolver = resolverFromMap([])
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'model_claim_no_model_ref')).toBe(true)
  })

  it('reports model_claim_no_model_ref when the only model_ref is unregistered', () => {
    const claimValue = modelClaim({ model_refs: ['M-GHOST'] })
    const resolver = resolverFromMap([['M1', { kind: 'ModelSpec' }]])
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'model_claim_no_model_ref')).toBe(true)
  })

  it('reports numeric_binding_present_on_non_numeric when a MODEL claim carries a binding (D-010)', () => {
    const claimValue = modelClaim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    })
    const resolver = resolverFromMap([
      ['M1', { kind: 'ModelSpec' }],
      ['RES1', { kind: 'Result', value: 0.731, unit: 'm' }],
    ])
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'numeric_binding_present_on_non_numeric')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// QUALITATIVE claims
// ---------------------------------------------------------------------------

describe('validateClaimEvidence — QUALITATIVE claim shape', () => {
  it('passes a CRITICAL QUALITATIVE with at least one evidence_ref', () => {
    const claimValue = qualitativeClaim()
    const resolver = resolverFromMap([
      ['RES1', { kind: 'Result', value: 0.731, unit: 'm' }],
    ])
    expect(validateClaimEvidence(claimValue, resolver)).toEqual([])
  })

  it('reports qualitative_critical_no_evidence for a CRITICAL QUALITATIVE with empty evidence_refs (D-011)', () => {
    const claimValue = qualitativeClaim({ evidence_refs: [] })
    const resolver = resolverFromMap([])
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'qualitative_critical_no_evidence')).toBe(true)
  })

  it('does NOT report qualitative_critical_no_evidence for a NON_CRITICAL QUALITATIVE with empty evidence_refs', () => {
    const claimValue = qualitativeClaim({ criticality: 'NON_CRITICAL', evidence_refs: [] })
    const resolver = resolverFromMap([])
    expect(validateClaimEvidence(claimValue, resolver)).toEqual([])
  })

  it('reports numeric_binding_present_on_non_numeric for a QUALITATIVE with binding (D-012)', () => {
    const claimValue = qualitativeClaim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    })
    const resolver = resolverFromMap([
      ['RES1', { kind: 'Result', value: 0.731, unit: 'm' }],
    ])
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'numeric_binding_present_on_non_numeric')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Snapshot walker (`inspectClaimEvidence`) — task book §7 row 4
// ---------------------------------------------------------------------------

describe('inspectClaimEvidence — every CRITICAL Claim in the snapshot', () => {
  it('returns no failures for a well-formed backbone IR', async () => {
    const { inspectClaimEvidence, ModelingIr: MIr } = await import('../../src/ir/index.ts')
    void MIr
    const ir = backboneIr()
    const snapshot = ModelingIr.snapshot(ir)
    expect(snapshot).not.toBeNull()
    expect(inspectClaimEvidence(snapshot ?? new Map())).toEqual([])
  })

  it('reports every CRITICAL NUMERIC Claim problem in one call (snapshot-driven, not artifact-subset)', async () => {
    const { inspectClaimEvidence } = await import('../../src/ir/index.ts')
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    // Build a closed chain (Result needs RUN1 which needs M1 which needs
    // P1 which needs DA-RAW). The simplest legal chain is the
    // `chainThrough('Result')` prefix from the fixture module.
    const { chainThrough } = await import('./fixtures.ts')
    for (const entry of chainThrough('Result')) {
      ir.put(entry.kind, entry.value)
    }
    // Two bad Claims: one with a value mismatch, one with a unit mismatch.
    ir.put('Claim', claim({
      claim_id: 'C-BAD-A',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.732, asserted_unit: 'm' },
    }))
    ir.put('Claim', claim({
      claim_id: 'C-BAD-B',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'cm' },
    }))
    const snapshot = ModelingIr.snapshot(ir)
    expect(snapshot).not.toBeNull()
    const failures = inspectClaimEvidence(snapshot ?? new Map())
    const kinds = new Set(failures.map(f => f.kind))
    expect(kinds.has('numeric_value_mismatch')).toBe(true)
    expect(kinds.has('numeric_unit_mismatch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Closed set guarantee
// ---------------------------------------------------------------------------

describe('CLAIM_EVIDENCE_FAILURE_KINDS — closed set', () => {
  it('contains the canonical kinds from the task book §7', () => {
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('numeric_binding_missing')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('numeric_binding_present_on_non_numeric')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('numeric_binding_result_unresolved')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('numeric_binding_result_not_in_result_refs')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('numeric_value_mismatch')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('numeric_unit_mismatch')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('model_claim_no_model_ref')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toContain('qualitative_critical_no_evidence')
    expect(CLAIM_EVIDENCE_FAILURE_KINDS).toHaveLength(8)
  })
})