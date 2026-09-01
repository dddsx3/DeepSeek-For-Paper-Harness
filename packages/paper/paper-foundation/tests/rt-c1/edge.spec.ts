/**
 * RT-C1 — Claim-shape attacker (Edge cases and discriminators).
 *
 * Aggressive probes: attacks that test the exact boundary of the
 * discriminated union. These are documented findings from the red team —
 * each one is an attempt to find a gap in the contract.
 */

import { describe, expect, it } from 'vitest'
import {
  CLAIM_TYPES,
  ModelingIr,
  claimSchema,
  evaluateIrBridge,
  validateClaimEvidence,
} from '../../src/ir/index.ts'
import { chainThrough, claim } from '../ir/fixtures.ts'

const AT = '2026-09-01T00:00:00.000Z'

function armed(): ModelingIr {
  const ir = new ModelingIr({ now: () => AT })
  for (const entry of chainThrough('Result')) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

describe('RT-C1-15 — boundary values for numeric_binding', () => {
  it('refuses numeric_binding: undefined (string-keyed absence)', () => {
    const parsed = claimSchema.safeParse({
      claim_id: 'C-RT-C1-15a',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: undefined,
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses numeric_binding: {} (empty object)', () => {
    const parsed = claimSchema.safeParse({
      claim_id: 'C-RT-C1-15b',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: {},
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses numeric_binding: 0 (zero, not null)', () => {
    // The MODEL and QUALITATIVE branches require numeric_binding: null.
    // A value of 0 is neither null nor the schema-shaped object.
    const parsed = claimSchema.safeParse({
      claim_id: 'C-RT-C1-15c',
      text: 't',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: 0,
      evidence_refs: [],
      result_refs: [],
      model_refs: ['M1'],
    })
    expect(parsed.success).toBe(false)
  })

  it('refuses numeric_binding: "" (empty string)', () => {
    const parsed = claimSchema.safeParse({
      claim_id: 'C-RT-C1-15d',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: '',
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    })
    expect(parsed.success).toBe(false)
  })
})

describe('RT-C1-16 — CLAIM_TYPES is a closed set', () => {
  it('declares exactly NUMERIC / MODEL / QUALITATIVE', () => {
    expect(CLAIM_TYPES).toEqual(['NUMERIC', 'MODEL', 'QUALITATIVE'])
  })

  it('refuses an unknown claim_type', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-16',
      text: 't',
      claim_type: 'VIBES',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }
    expect(ir.put('Claim', value).accepted).toBe(false)
  })
})

describe('RT-C1-17 — model_refs minimum on MODEL', () => {
  // The MODEL branch sets model_refs: array(refSchema).min(1). An attacker
  // with a non-empty numeric_binding-shaped value but model_refs: []
  // should be schema-rejected.
  it('refuses a MODEL Claim with model_refs: []', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-17',
      text: 't',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.kind).toBe('schema_invalid')
  })

  it('accepts a MODEL Claim with model_refs: [M1]', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-17b',
      text: 't',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: ['M1'],
    }
    expect(ir.put('Claim', value).accepted).toBe(true)
  })
})

describe('RT-C1-18 — synthetic direct-call to validateClaimEvidence with malformed binding', () => {
  // The validator defends in depth against synthetic / non-store inputs.
  // The discriminator field is read FIRST, but the validator must still
  // refuse values whose numeric_binding shape does not match the type.
  it('reports numeric_binding_missing for a NUMERIC value with no binding at all', () => {
    const value = {
      claim_id: 'C-RT-C1-18',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      // numeric_binding absent
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    } as Record<string, unknown>
    const failures = validateClaimEvidence(value, () => ({ kind: 'Result', value: 0.731, unit: 'm' }))
    expect(failures.some(f => f.kind === 'numeric_binding_missing')).toBe(true)
  })

  it('reports numeric_binding_missing for unknown claim_type', () => {
    const value = {
      claim_id: 'C-RT-C1-18b',
      text: 't',
      claim_type: 'VIBES',
      criticality: 'CRITICAL',
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    } as Record<string, unknown>
    const failures = validateClaimEvidence(value, () => undefined)
    // The validator emits a numeric_binding_missing verdict for unknown
    // claim_type so the audit is consistent.
    expect(failures.some(f => f.kind === 'numeric_binding_missing')).toBe(true)
  })
})

describe('RT-C1-19 — model_refs minimum on MODEL via semantic guard', () => {
  // Even if a non-store path skips the schema and hands the validator a
  // MODEL Claim with model_refs: [], the semantic guard
  // `model_claim_no_model_ref` must fire.
  it('reports model_claim_no_model_ref for a MODEL with model_refs: []', () => {
    const value = {
      claim_id: 'C-RT-C1-19',
      text: 't',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    } as Record<string, unknown>
    const failures = validateClaimEvidence(value, () => ({ kind: 'ModelSpec' }))
    expect(failures.some(f => f.kind === 'model_claim_no_model_ref')).toBe(true)
  })
})

describe('RT-C1-20 — bridge BLOCKS delivery when every CRITICAL Claim has a binding failure', () => {
  // A multi-Claim attack: two NUMERIC CRITICAL Claims, both pointing at
  // different Result values. Both must fail independently.
  it('two NUMERIC CRITICAL Claims with mismatched values both surface in evidenceFailures', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-20a',
      numeric_binding: { result_ref: 'RES1', asserted_value: 1.1, asserted_unit: 'm' },
    })).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-20b',
      text: 'different',
      numeric_binding: { result_ref: 'RES1', asserted_value: 2.2, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    const badPaths = decision.evidenceFailures.filter(f => f.kind === 'numeric_value_mismatch').map(f => f.path)
    expect(badPaths.some(p => p.includes('C-RT-C1-20a'))).toBe(true)
    expect(badPaths.some(p => p.includes('C-RT-C1-20b'))).toBe(true)
  })
})