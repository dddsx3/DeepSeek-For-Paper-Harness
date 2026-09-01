/**
 * RT-C1 — Claim-shape attacker (Discriminator poisoning).
 *
 * Goal: bypass the discriminated-union contract so a value reaches canonical
 * state with `claim_type === 'NUMERIC'` but without a load-bearing
 * `numeric_binding`, or with `numeric_binding` set to something the validator
 * will silently treat as equivalent to a non-binding.
 *
 * Each test in this file is an *attack fixture*: it documents an attempt to
 * smuggle a malformed Claim past the store boundary or the bridge. The tests
 * that pass (verdict.accepted === true) are real gaps; the tests that fail
 * (verdict.accepted === false) document that the existing coverage holds.
 *
 * Out of scope (per artifacts/handoff/TASK-2/known-risks.md):
 *   - Hash-by-bytes verification (TASK 3)
 *   - Tolerance / rounding (TASK 3)
 *   - Update / replace / STALE (TASK 3.5)
 *   - Reviewer authority (TASK 5)
 *   - Renderer / EquationSpec (TASK 7)
 */

import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  claimSchema,
  numericBindingSchema,
  validateClaimEvidence,
  evaluateIrBridge,
} from '../../src/ir/index.ts'
import { chainThrough, claim } from '../ir/fixtures.ts'

const AT = '2026-09-01T00:00:00.000Z'

function freshIr(): ModelingIr {
  return new ModelingIr({ now: () => AT })
}

function armed(): ModelingIr {
  const ir = freshIr()
  for (const entry of chainThrough('Result')) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

describe('RT-C1-01 — discriminator poisoning: extra keys on NUMERIC', () => {
  // The .strict() on the NUMERIC branch should refuse any extra key. An
  // attacker that adds `model_refs: []` and `evidence_refs: []` to look
  // "empty" must still be rejected for missing numeric_binding — and never
  // accepted into canonical state.
  it('refuses a NUMERIC-shaped Claim with extra keys and no numeric_binding', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-01',
      text: 'A naked numeric assertion.',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      // numeric_binding intentionally omitted
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
      surprise_field: 'extra',
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      // The failure set names every reason — at minimum the missing
      // numeric_binding and/or the surprise_field.
      expect(verdict.failures.length).toBeGreaterThan(0)
    }
    expect(ir.has('C-RT-C1-01')).toBe(false)
  })

  it('refuses a NUMERIC-shaped Claim with numeric_binding absent AND extra keys', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-01b',
      text: 'x',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
      ghost_key: 1,
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    expect(ir.has('C-RT-C1-01b')).toBe(false)
  })
})

describe('RT-C1-02 — discriminator misroute: pretend MODEL but assert a number', () => {
  // Can a value with claim_type === 'MODEL' but `numeric_binding` containing
  // a real object still reach canonical state? The schema branches set
  // `numeric_binding: zod.null()` on MODEL/QUALITATIVE; zod's
  // discriminatedUnion should pick the MODEL branch and refuse anything
  // other than `null` at that path. If the schema accepts the value, the
  // semantic guard `numeric_binding_present_on_non_numeric` should catch it
  // and the bridge should BLOCK.
  it('schema refuses a MODEL Claim with a non-null numeric_binding', () => {
    const value = {
      claim_id: 'C-RT-C1-02',
      text: 'I am a MODEL claim but I also carry a number.',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: [],
      model_refs: ['M1'],
    }
    const parsed = claimSchema.safeParse(value)
    expect(parsed.success).toBe(false)
  })

  it('bridge refuses a MODEL Claim with a non-null numeric_binding even if schema accepts', () => {
    // Defensive: simulate a non-store ingest path that handed the validator
    // a value with a non-null binding under MODEL. The validator's
    // `numeric_binding_present_on_non_numeric` verdict must fire.
    const value = {
      claim_id: 'C-RT-C1-02b',
      text: 'x',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: [],
      model_refs: ['M1'],
    } as Record<string, unknown>
    const failures = validateClaimEvidence(value, () => ({ kind: 'Result', value: 0.731, unit: 'm' }))
    expect(failures.some(f => f.kind === 'numeric_binding_present_on_non_numeric')).toBe(true)
  })
})

describe('RT-C1-03 — empty-array policy on NUMERIC result_refs', () => {
  // The schema sets `result_refs: zod.array(refSchema).min(1)` for NUMERIC,
  // so an empty result_refs should be schema-invalid. Test the exact
  // boundary.
  it('refuses a NUMERIC Claim with result_refs: []', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-03',
      text: 'Numeric but no results.',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'schema_invalid')).toBe(true)
    }
  })

  it('accepts a NUMERIC Claim with exactly one result_ref', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({ claim_id: 'C-RT-C1-03-ok', result_refs: ['RES1'] })).accepted).toBe(true)
  })

  it('does NOT silently treat a NUMERIC Claim with result_refs: [] as QUALITATIVE', () => {
    // Adversary tries to bypass the NUMERIC contract by claiming
    // claim_type: 'NUMERIC' but with zero result_refs. The schema's
    // `result_refs.min(1)` should refuse; even if it didn't, the binding
    // would still name 'RES1' but the claim would not list it.
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-03b',
      text: 'A claim.',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    expect(ir.has('C-RT-C1-03b')).toBe(false)
  })
})

describe('RT-C1-04 — typed-vs-JSON ingress drift on numeric_binding', () => {
  // TASK 1 caught RT-A-02 with the same shape. Re-probe: does `put()` apply
  // the same shape contract on the new numericBindingSchema as
  // `ingestJson()`?
  it('put() and ingestJson() agree on a malformed numeric_binding payload', () => {
    // asserted_value as string: schema should refuse both ingresses.
    const text = JSON.stringify({
      claim_id: 'C-RT-C1-04',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: '0.731', asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    })
    const viaText = new ModelingIr({ now: () => AT }).ingestJson('Claim', text)
    expect(viaText.accepted).toBe(false)

    const value = JSON.parse(text)
    const viaObject = new ModelingIr({ now: () => AT }).put('Claim', value)
    expect(viaObject.accepted).toBe(false)

    if (!viaText.accepted && !viaObject.accepted) {
      // Both must surface a schema_invalid on numeric_binding (or similar).
      // They do not have to share the exact failure set — but neither path
      // should smuggle the value through.
      expect(viaText.failures.length).toBeGreaterThan(0)
      expect(viaObject.failures.length).toBeGreaterThan(0)
    }
  })

  it('numericBindingSchema refuses asserted_value: "0.731" (string)', () => {
    const parsed = numericBindingSchema.safeParse({
      result_ref: 'RES1',
      asserted_value: '0.731',
      asserted_unit: 'm',
    })
    expect(parsed.success).toBe(false)
  })

  it('numericBindingSchema refuses asserted_value: NaN', () => {
    const parsed = numericBindingSchema.safeParse({
      result_ref: 'RES1',
      asserted_value: NaN,
      asserted_unit: 'm',
    })
    expect(parsed.success).toBe(false)
  })

  it('numericBindingSchema refuses asserted_value: Infinity', () => {
    const parsed = numericBindingSchema.safeParse({
      result_ref: 'RES1',
      asserted_value: Infinity,
      asserted_unit: 'm',
    })
    expect(parsed.success).toBe(false)
  })
})

describe('RT-C1-05 — discriminator poisoning with claim_type aliases', () => {
  // What if claim_type is uppercase / lowercase / has trailing whitespace?
  // The schema uses `zod.literal('NUMERIC')` etc., so any non-exact value
  // should be refused by the discriminated union. Test the boundary.
  for (const bad of ['numeric', ' Numeric ', 'Numeric', 'NUMERIC ', ' NUMERIC']) {
    it(`refuses claim_type: ${JSON.stringify(bad)} on NUMERIC-shaped Claim`, () => {
      const ir = armed()
      const value = {
        claim_id: `C-RT-C1-05-${bad.length}`,
        text: 't',
        claim_type: bad,
        criticality: 'CRITICAL',
        numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
        evidence_refs: [],
        result_refs: ['RES1'],
        model_refs: [],
      }
      const verdict = ir.put('Claim', value)
      expect(verdict.accepted).toBe(false)
    })
  }
})

describe('RT-C1-06 — bridge still BLOCKS on a non-canonical NUMERIC Claim', () => {
  // End-to-end check. Even if every per-step guard is bypassed
  // individually, the snapshot-driven walker must BLOCK delivery if a
  // CRITICAL NUMERIC Claim exists in the store with any evidence failure.
  it('blocks delivery when a CRITICAL NUMERIC Claim has zero result_refs (schema refuses)', () => {
    const ir = armed()
    expect(ir.put('Claim', {
      claim_id: 'C-RT-C1-06',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: [],
      model_refs: [],
    }).accepted).toBe(false)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // The store did not accept C-RT-C1-06, but the existing C1 must still
    // pass; the bridge verdict is then driven by missingCriticalClaim (no
    // CRITICAL claim ever landed) or by the rest of the contract. The point
    // is that the schema refused the malformed Claim.
    expect(ir.has('C-RT-C1-06')).toBe(false)
    // The decision itself: BACKBONE has no Claim now, so missingCriticalClaim
    // is true → BLOCKED. The contract walker must not surface a phantom
    // failure for C-RT-C1-06.
    expect(decision.evidenceFailures.some(f => f.path.includes('C-RT-C1-06'))).toBe(false)
  })

  it('blocks delivery on a Claim whose numeric_binding has a value mismatch', () => {
    // A fully-shape-valid Claim that the validator catches.
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-06b',
      numeric_binding: { result_ref: 'RES1', asserted_value: 9.999, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-RT-C1-06b'))).toBe(true)
  })
})

describe('RT-C1-07 — make numeric_binding non-load-bearing via prototype inheritance', () => {
  // The TASK 1.5 RT-A-02 family attacks prototype inheritance: can an
  // object with the right prototype pollute the schema's view? Re-probe
  // against numericBindingSchema: an inherited binding object that claims
  // the right shape but is `{}` underneath.
  it('refuses a NUMERIC Claim whose numeric_binding inherits all keys', () => {
    const ir = armed()
    const proto = {
      result_ref: 'RES1',
      asserted_value: 0.731,
      asserted_unit: 'm',
    }
    const value = {
      claim_id: 'C-RT-C1-07',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: Object.create(proto),
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      // scanIrValue refuses inherited keys → malformed_value.
      expect(verdict.failures[0]!.kind).toBe('malformed_value')
    }
  })
})

describe('RT-C1-08 — adversarial serialisation: deeply nested bindings', () => {
  // A graph bound that is 64+ layers deep inside the numeric_binding's
  // asserted_unit slot should be refused by `scanIrValue`'s depth cap, not
  // by the schema. The schema only checks shape; depth is the typed-path
  // guard.
  it('refuses a NUMERIC Claim whose asserted_unit nests depth > 64', () => {
    const ir = armed()
    let deep: unknown = 'm'
    for (let i = 0; i < 80; i += 1) deep = [deep]
    const value = {
      claim_id: 'C-RT-C1-08',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: deep },
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.reason === 'too_deep')).toBe(true)
    }
  })

  it('refuses a NUMERIC Claim whose asserted_value is a deeply nested array', () => {
    const ir = armed()
    let deep: unknown = 0.731
    for (let i = 0; i < 80; i += 1) deep = [deep]
    const value = {
      claim_id: 'C-RT-C1-08b',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: deep, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.reason === 'too_deep' || f.reason === 'too_large')).toBe(true)
    }
  })
})