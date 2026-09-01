/**
 * RT-C2 — Numeric-binding attacker (TASK 2).
 *
 * Goal: smuggle a NUMERIC Claim whose core number is decoupled from any
 * canonical Result, or trick the asserted_value/asserted_unit equality into
 * accepting a non-canonical match (tolerance / rounding / coercion).
 *
 * The developer-grade coverage for the seven known attacks (RT-C2-01..07,
 * D-004..D-007, D-016, D-017) lives in `tests/ir/claim-evidence.spec.ts`
 * and `tests/ir/bridge.spec.ts`. This file is the *next* round: the eight
 * attacks below probe every boundary the developers missed — the schema,
 * the store ref table, the JSON ingress path, and the result_refs[]
 * array. Each test is annotated with the expected verdict:
 *
 *   BLOCKED  — current behaviour already refuses the attack.
 *   SUCCEEDED — current behaviour lets the attack reach a state it
 *               shouldn't. Reported as a Finding in
 *               `artifacts/handoff/TASK-2/redteam-rt-c2.md`.
 *
 * Pure attack; no production source is edited.
 */

import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  evaluateIrBridge,
  numericValuesEqual,
  validateClaimEvidence,
  type ClaimEvidenceResolver,
} from '../../src/ir/index.ts'
import { chainThrough, claim } from '../ir/fixtures.ts'

const AT = '2026-09-01T00:00:00.000Z'

/** Seed a closed chain ending at Result, so the binding's result_ref resolves. */
function seedThroughResult(): ModelingIr {
  const ir = new ModelingIr({ now: () => AT })
  for (const entry of chainThrough('Result')) {
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) {
      throw new Error(`seed failed at ${entry.kind}: ${JSON.stringify(verdict.failures)}`)
    }
  }
  return ir
}

/** Resolve one id to a Result-shaped record; everything else is `undefined`. */
function singleResultResolver(): ClaimEvidenceResolver {
  return (ref) => ref === 'RES1'
    ? { kind: 'Result', value: 0.731, unit: 'm' }
    : undefined
}

// ---------------------------------------------------------------------------
// Attack 1 — Wrong result_ref: points at a non-Result (ModelSpec).
//
// Question: `numeric_binding.result_ref` is NOT in IR_REF_FIELDS.Claim
// (only evidence_refs/result_refs/model_refs are). The store therefore
// cannot catch a wrong-kind ref at commit time. Does the semantic guard
// catch it, or does a Claim with binding->M1 reach canonical state?
// ---------------------------------------------------------------------------

describe('RT-C2-08 — numeric_binding.result_ref pointing at a ModelSpec', () => {
  it('store catches the wrong-kind ref via Claim.result_refs target=Result', () => {
    // Build a chain ending at ModelSpec so M1 exists. The store refuses the
    // Claim because `result_refs: ['M1']` violates the kind target on the
    // claim's own `result_refs` field. So the store IS a line of defence for
    // this attack — by closing the door through the sibling field, not the
    // binding field itself.
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('ModelSpec')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    const verdict = ir.put('Claim', claim({
      result_refs: ['M1'],
      numeric_binding: { result_ref: 'M1', asserted_value: 0.731, asserted_unit: 'm' },
    }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      // The store refuses on the `result_refs` field, not the binding.
      expect(verdict.failures.some(f => f.path === 'result_refs' && f.kind === 'reference_kind_mismatch')).toBe(true)
    }
  })

  it('semantic guard (validateClaimEvidence) catches wrong-kind binding — BLOCKED', () => {
    const resolver: ClaimEvidenceResolver = (ref) => {
      if (ref === 'M1') return { kind: 'ModelSpec' }
      if (ref === 'RES1') return { kind: 'Result', value: 0.731, unit: 'm' }
      return undefined
    }
    const claimValue = claim({
      result_refs: ['M1'],
      numeric_binding: { result_ref: 'M1', asserted_value: 0.731, asserted_unit: 'm' },
    })
    const failures = validateClaimEvidence(claimValue, resolver)
    expect(failures.some(f => f.kind === 'numeric_binding_result_unresolved')).toBe(true)
  })

  it('bridge end-to-end: BLOCKED via store-level reference_kind_mismatch', () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('ModelSpec')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    // The Claim itself is refused by the store — `accepted === true` means
    // the put actually failed. Bridge never sees the Claim.
    expect(ir.put('Claim', claim({
      result_refs: ['M1'],
      numeric_binding: { result_ref: 'M1', asserted_value: 0.731, asserted_unit: 'm' },
    })).accepted).toBe(false)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // No CRITICAL NUMERIC Claim is registered → missingCriticalClaim.
    expect(decision.status).toBe('BLOCKED')
  })
})

// ---------------------------------------------------------------------------
// Attack 2 — result_ref does not exist ('RES-GHOST').
//
// Same code path as above: IR_REF_FIELDS.Claim omits numeric_binding.result_ref,
// so the store's existence check doesn't run. Does the semantic guard catch
// it? (Test the unit path: validateClaimEvidence + bridge.)
// ---------------------------------------------------------------------------

describe('RT-C2-09 — numeric_binding.result_ref pointing at a missing id', () => {
  it('store accepts: numeric_binding.result_ref is not in IR_REF_FIELDS', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES-GHOST', asserted_value: 0.731, asserted_unit: 'm' },
    }))
    expect(verdict.accepted).toBe(true)
  })

  it('semantic guard catches it — BLOCKED', () => {
    const failures = validateClaimEvidence(
      claim({ numeric_binding: { result_ref: 'RES-GHOST', asserted_value: 0.731, asserted_unit: 'm' } }),
      singleResultResolver(),
    )
    expect(failures.some(f => f.kind === 'numeric_binding_result_unresolved')).toBe(true)
  })

  it('bridge end-to-end BLOCKED', () => {
    const ir = seedThroughResult()
    expect(ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES-GHOST', asserted_value: 0.731, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_binding_result_unresolved')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 3 — Duplicate result_refs in the claim's own array.
//
// The schema refine only forbids duplicate refs on
// ProblemSpec.requirement_refs and ModelSpec.{variable_refs, parameter_refs}
// (per the comment in schema.ts). Claim.result_refs has no duplicate check,
// so `['RES1', 'RES1']` is schema-legal and store-legal. Does the semantic
// guard catch the duplicate (it should NOT — the validator only does
// `resultRefs.includes(resultRef)`), and is there any other downstream
// effect?
// ---------------------------------------------------------------------------

describe('RT-C2-10 — Claim.result_refs contains duplicate refs', () => {
  it('schema accepts duplicate refs (no refine on Claim.result_refs)', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      result_refs: ['RES1', 'RES1'],
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    }))
    expect(verdict.accepted).toBe(true)
  })

  it('semantic guard does NOT flag the duplicate (validator does `.includes` only)', () => {
    const failures = validateClaimEvidence(
      claim({
        result_refs: ['RES1', 'RES1'],
        numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      }),
      singleResultResolver(),
    )
    // The validator's design is "binding's result_ref must appear in claim's
    // result_refs". `includes` returns true for duplicates; no double-charge.
    expect(failures.filter(f => f.kind === 'numeric_binding_result_not_in_result_refs')).toEqual([])
  })

  it('bridge end-to-end: still PASS (duplicates do not break the binding contract)', () => {
    const ir = seedThroughResult()
    expect(ir.put('Claim', claim({
      result_refs: ['RES1', 'RES1'],
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // Note: still PASS. No schema validator catches this, no semantic guard
    // catches this. The duplicate is harmless because the binding check is
    // set-membership; the attack is *not* a real escape, just a code-smell
    // observation worth pinning.
    expect(decision.status).toBe('PASS')
  })
})

// ---------------------------------------------------------------------------
// Attack 4 — FP round-trip drift: 0.7310000001 vs Result.value=0.731.
//
// The equality is `a === b`. ECMAScript: 0.731 !== 0.7310000001. The
// expected verdict is BLOCKED (numeric_value_mismatch). This pins the
// "no FP slop" contract that TASK 3 will need to defend against.
// ---------------------------------------------------------------------------

describe('RT-C2-11 — FP round-trip drift disguised as a match', () => {
  it('numericValuesEqual rejects 0.7310000001 vs 0.731', () => {
    expect(numericValuesEqual(0.7310000001, 0.731)).toBe(false)
    // Sanity: the FP literals are not aliased.
    expect(0.731 === 0.7310000001).toBe(false)
  })

  it('semantic guard catches the drift — BLOCKED', () => {
    const failures = validateClaimEvidence(
      claim({
        numeric_binding: { result_ref: 'RES1', asserted_value: 0.7310000001, asserted_unit: 'm' },
      }),
      singleResultResolver(),
    )
    expect(failures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })

  it('bridge end-to-end BLOCKED', () => {
    const ir = seedThroughResult()
    expect(ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.7310000001, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 5 — Unit case difference: 'M' vs 'm'.
//
// ECMAScript: 'M' !== 'm'. The equality is direct === on strings. Expected
// BLOCKED with numeric_unit_mismatch — but worth pinning because a future
// refactor that calls `toLowerCase()` would silently accept 'M'.
// ---------------------------------------------------------------------------

describe('RT-C2-12 — case-different unit string', () => {
  it('schema accepts the unit (unitSchema: zod.string().min(1) — no charset rule)', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'M' },
    }))
    expect(verdict.accepted).toBe(true)
  })

  it('semantic guard catches case mismatch — BLOCKED', () => {
    const failures = validateClaimEvidence(
      claim({
        numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'M' },
      }),
      singleResultResolver(),
    )
    expect(failures.some(f => f.kind === 'numeric_unit_mismatch')).toBe(true)
  })

  it('bridge end-to-end BLOCKED', () => {
    const ir = seedThroughResult()
    expect(ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'M' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_unit_mismatch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 6 — Trailing whitespace in unit: 'm ' vs 'm'.
//
// Same shape as RT-C2-12 but with whitespace. The id charset already bans
// separator characters on the *id*, but unitSchema has no such rule — any
// non-empty string passes. The equality is direct ===; trailing whitespace
// does NOT normalize. Worth pinning because a future refactor that calls
// `trim()` would silently accept 'm '.
// ---------------------------------------------------------------------------

describe('RT-C2-13 — trailing whitespace in unit string', () => {
  it('schema accepts "m " (unitSchema is min(1), no charset rule)', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm ' },
    }))
    expect(verdict.accepted).toBe(true)
  })

  it('semantic guard catches whitespace mismatch — BLOCKED', () => {
    const failures = validateClaimEvidence(
      claim({
        numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm ' },
      }),
      singleResultResolver(),
    )
    expect(failures.some(f => f.kind === 'numeric_unit_mismatch')).toBe(true)
  })

  it('bridge end-to-end BLOCKED', () => {
    const ir = seedThroughResult()
    expect(ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm ' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.kind === 'numeric_unit_mismatch')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 7 — JSON ingress: asserted_value as a JSON string "0.731".
//
// The schema's `asserted_value: zod.number()` does not coerce. The JSON
// parser produces a JS string; zod 4.4.3 with no `.coerce()` rejects it.
// Verify.
// ---------------------------------------------------------------------------

describe('RT-C2-14 — JSON ingress: asserted_value as a string', () => {
  it('ingestJson refuses a string asserted_value (zod.number() does not coerce)', () => {
    const ir = seedThroughResult()
    const text = JSON.stringify({
      claim_id: 'C-STRING',
      text: 'string-typed value',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: '0.731', asserted_unit: 'm' },
      evidence_refs: ['RES1'],
      result_refs: ['RES1'],
      model_refs: ['M1'],
    })
    const verdict = ir.ingestJson('Claim', text)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.path.includes('asserted_value') && f.kind === 'schema_invalid')).toBe(true)
    }
  })

  it('put() also refuses a string asserted_value (typed path matches the JSON path)', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', {
      claim_id: 'C-STRING-2',
      text: 'string-typed value via put',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: '0.731', asserted_unit: 'm' },
      evidence_refs: ['RES1'],
      result_refs: ['RES1'],
      model_refs: ['M1'],
    })
    expect(verdict.accepted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Attack 8 — JSON ingress: result_ref as a JSON number 42.
//
// refSchema is `zod.string().min(1)`; a JSON number is not a string.
// Expected BLOCKED at the schema boundary.
// ---------------------------------------------------------------------------

describe('RT-C2-15 — JSON ingress: result_ref as a number', () => {
  it('ingestJson refuses a number result_ref (refSchema requires string)', () => {
    const ir = seedThroughResult()
    const text = JSON.stringify({
      claim_id: 'C-NUMREF',
      text: 'number-typed result_ref',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 42, asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: ['RES1'],
      result_refs: ['RES1'],
      model_refs: ['M1'],
    })
    const verdict = ir.ingestJson('Claim', text)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.path.includes('result_ref') && f.kind === 'schema_invalid')).toBe(true)
    }
  })

  it('put() also refuses a number result_ref', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', {
      claim_id: 'C-NUMREF-2',
      text: 'number-typed result_ref via put',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 42, asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: ['RES1'],
      result_refs: ['RES1'],
      model_refs: ['M1'],
    })
    expect(verdict.accepted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bonus — verify the "empty unit" attack fails at the schema boundary.
// unitSchema is zod.string().min(1), so "" is refused. This is the
// regression test for the unit-mismatch family when an attacker tries to
// smuggle an empty unit. (Not in the user's attack list explicitly, but
// mentioned under "Unit mismatch > asserted_unit = \"\"".)
// ---------------------------------------------------------------------------

describe('RT-C2-16 (bonus) — empty-string asserted_unit', () => {
  it('schema refuses empty unit at the boundary', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: '' },
    }))
    expect(verdict.accepted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bonus — verify that a NUMERIC Claim with binding pointing at a DataArtifact
// (not in IR_REF_FIELDS.Claim either) hits the same gap as RT-C2-08.
// ---------------------------------------------------------------------------

describe('RT-C2-17 (bonus) — numeric_binding.result_ref pointing at a DataArtifact', () => {
  it('store catches DA-RAW in result_refs (target=Result)', () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('DataArtifact')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    const verdict = ir.put('Claim', {
      claim_id: 'C-DAREF',
      text: 'binding points at DataArtifact',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'DA-RAW', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: ['DA-RAW'],
      model_refs: [],
    })
    // Store refuses — DA-RAW is a DataArtifact, result_refs target=Result.
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.path === 'result_refs' && f.kind === 'reference_kind_mismatch')).toBe(true)
    }
  })

  it('bridge end-to-end BLOCKED (Claim never registered → missing critical claim)', () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('DataArtifact')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', {
      claim_id: 'C-DAREF-2',
      text: 'binding points at DataArtifact',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'DA-RAW', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: ['DA-RAW'],
      model_refs: [],
    }).accepted).toBe(false)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // No CRITICAL NUMERIC Claim registered; semantic guard has nothing to
    // inspect on this object because the store refused it. FORMAL mode
    // requires a CRITICAL claim, so the decision is BLOCKED.
    expect(decision.status).toBe('BLOCKED')
    expect(decision.missingCriticalClaim).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 9 — JSON ingress: asserted_value = NaN.
//
// NaN is not legal JSON. JSON.parse rejects the literal `NaN` outright, so
// the strict text path refuses with parse_failed. The typed `put()` path
// rejects it via zod.number() (zod 4.4.3 number() rejects NaN). Both
// paths must close the door before the validator ever runs.
// ---------------------------------------------------------------------------

describe('RT-C2-18 — JSON ingress: NaN / Infinity / -Infinity as asserted_value', () => {
  it('ingestJson refuses "NaN" text (JSON.parse fails on the literal)', () => {
    const ir = seedThroughResult()
    const text = '{"claim_id":"C-NAN","text":"nan","claim_type":"NUMERIC","criticality":"CRITICAL","numeric_binding":{"result_ref":"RES1","asserted_value":NaN,"asserted_unit":"m"},"evidence_refs":["RES1"],"result_refs":["RES1"],"model_refs":["M1"]}'
    const verdict = ir.ingestJson('Claim', text)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'parse_failed')).toBe(true)
    }
  })

  it('ingestJson refuses Infinity text (JSON.parse fails)', () => {
    const ir = seedThroughResult()
    const text = '{"claim_id":"C-INF","text":"inf","claim_type":"NUMERIC","criticality":"CRITICAL","numeric_binding":{"result_ref":"RES1","asserted_value":Infinity,"asserted_unit":"m"},"evidence_refs":["RES1"],"result_refs":["RES1"],"model_refs":["M1"]}'
    const verdict = ir.ingestJson('Claim', text)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'parse_failed')).toBe(true)
    }
  })

  it('put() typed path refuses NaN via zod.number()', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: Number.NaN, asserted_unit: 'm' },
    }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      // Either malformed_value (scanIrValue scan refused it) or schema_invalid
      // (zod.number() refused it). Both are BLOCKED — the validator never
      // sees NaN.
      const blocked = verdict.failures.some(f =>
        f.kind === 'schema_invalid' && f.path.includes('asserted_value'),
      ) || verdict.failures.some(f => f.kind === 'malformed_value')
      expect(blocked).toBe(true)
    }
  })

  it('put() typed path refuses Infinity via zod.number()', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: Number.POSITIVE_INFINITY, asserted_unit: 'm' },
    }))
    expect(verdict.accepted).toBe(false)
  })

  it('put() typed path refuses -Infinity via zod.number()', () => {
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: Number.NEGATIVE_INFINITY, asserted_unit: 'm' },
    }))
    expect(verdict.accepted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Attack 10 — assert -0 vs Result.value=0 across the bridge.
//
// The unit-level test in claim-evidence.spec.ts covers the validator
// directly (D-017). This pins the bridge path: a NUMERIC CRITICAL Claim
// with asserted_value=-0 and Result.value=0 must reach PASS, not BLOCKED.
// ---------------------------------------------------------------------------

describe('RT-C2-19 — bridge end-to-end collapses -0 to +0 (D-017)', () => {
  it('bridge returns PASS for -0 vs 0', () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    // Override Result.value to exactly 0 via a separate chain re-using
    // RES1: the fixture's value is 0.731, so register RES0 with value=0.
    expect(ir.put('Result', {
      result_id: 'RES0',
      run_ref: 'RUN1',
      name: 'zero_thickness',
      value: 0,
      unit: 'm',
      uncertainty: 0,
      source_location: 'file:///runs/RUN1/result.json#zero',
    }).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-NEGZERO',
      result_refs: ['RES0'],
      numeric_binding: { result_ref: 'RES0', asserted_value: -0, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('PASS')
    expect(decision.evidenceFailures).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Attack 11 — Duplicate result_refs containing the binding's result_ref
// twice (already covered by RT-C2-10). Pin the negative: a Claim with
// duplicates does NOT escape the binding contract.
//
// This case is structurally identical to RT-C2-10 but reported here for
// the per-attack ledger the user asked for.
// ---------------------------------------------------------------------------

describe('RT-C2-20 — Claim.result_refs with duplicate binding.ref', () => {
  it('bridge PASS: duplicates are set-membership-equivalent to a single entry', () => {
    const ir = seedThroughResult()
    expect(ir.put('Claim', claim({
      result_refs: ['RES1', 'RES1'],
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('PASS')
  })

  it('no duplicate-refine on Claim.result_refs in the schema (gap observation)', () => {
    // Pin the gap, do not propose a fix. The schema refines
    // ProblemSpec.requirement_refs and ModelSpec.variable_refs /
    // parameter_refs against duplicates, but not Claim.result_refs.
    // Duplicates are harmless today (validator uses .includes) but it is a
    // code-smell worth documenting.
    const ir = seedThroughResult()
    const verdict = ir.put('Claim', claim({
      result_refs: ['RES1', 'RES1', 'RES1'],
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    }))
    expect(verdict.accepted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Attack 12 — Typed-vs-JSON ingress drift: extra unknown keys.
//
// `claimSchema` is `.strict()`. A model that smuggles in an extra key in
// either path must be BLOCKED with `unrecognized_keys`.
// ---------------------------------------------------------------------------

describe('RT-C2-21 — strict() catches extra keys on the typed path', () => {
  it('put() refuses an extra unknown key (defence-in-depth vs the JSON path)', () => {
    const ir = seedThroughResult()
    const value = claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    }) as Record<string, unknown>
    value['smuggled'] = 'value'
    const verdict = ir.put('Claim', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'schema_invalid')).toBe(true)
    }
  })

  it('ingestJson refuses an extra unknown key in the binding', () => {
    const ir = seedThroughResult()
    const text = JSON.stringify({
      claim_id: 'C-SMUGGLE',
      text: 'strict test',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm', bonus: true },
      evidence_refs: ['RES1'],
      result_refs: ['RES1'],
      model_refs: ['M1'],
    })
    const verdict = ir.ingestJson('Claim', text)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'schema_invalid')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Attack 13 — Result.value != 0 and asserted_value != -0.
//
// Asymmetry check: -0 must collapse to +0 ONLY when the Result value is
// 0. Otherwise the equality still fails on delta. The frozen D-017 policy
// is "negative-zero only collapses to +0; non-zero values still require
// identity."
// ---------------------------------------------------------------------------

describe('RT-C2-22 — -0 is collapsed only against Result.value=0 (D-017 asymmetry)', () => {
  it('numericValuesEqual(-0, 0.731) is false', () => {
    expect(numericValuesEqual(-0, 0.731)).toBe(false)
  })

  it('semantic guard flags -0 against Result.value=0.731 as numeric_value_mismatch', () => {
    const failures = validateClaimEvidence(
      claim({
        numeric_binding: { result_ref: 'RES1', asserted_value: -0, asserted_unit: 'm' },
      }),
      singleResultResolver(),
    )
    expect(failures.some(f => f.kind === 'numeric_value_mismatch')).toBe(true)
  })
})