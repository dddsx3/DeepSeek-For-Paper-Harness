/**
 * RT-C1 — Claim-shape attacker (Bridge & semantic binding).
 *
 * Goal: find ways to reach delivery with a NUMERIC Claim whose
 * `numeric_binding` is *non-load-bearing* — i.e. the binding is present in
 * the schema but ignored by the validator, the bridge, or the snapshot
 * walker.
 *
 * Each test is an attack fixture. Passing tests (`verdict.accepted === true`
 * or `decision.status === 'PASS'`) are real gaps; failing tests document
 * the existing coverage.
 */

import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  evaluateIrBridge,
  inspectClaimEvidence,
  numericValuesEqual,
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

describe('RT-C1-09 — same Result but two bindings with different values', () => {
  // An attacker might try to register one Claim and then mutate the
  // binding's asserted_value after the fact. The store is append-only
  // and frozen, so re-ingesting with the same id must be refused
  // (duplicate_id), not overwrite the original.
  it('refuses to overwrite a Claim with the same id but a different binding value', () => {
    const ir = armed()
    expect(ir.put('Claim', claim()).accepted).toBe(true)
    const again = ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 9.999, asserted_unit: 'm' },
    }))
    expect(again.accepted).toBe(false)
    if (!again.accepted) expect(again.failures[0]!.kind).toBe('duplicate_id')
  })

  it('original Claim value is preserved after a refused duplicate', () => {
    const ir = armed()
    expect(ir.put('Claim', claim()).accepted).toBe(true)
    ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 9.999, asserted_unit: 'm' },
    }))
    const record = ir.get('C1')!
    expect((record.value as { numeric_binding: { asserted_value: number } }).numeric_binding.asserted_value).toBe(0.731)
  })
})

describe('RT-C1-10 — non-load-bearing binding via reference closure gap', () => {
  // What if `result_refs: ['RES1']` is registered but
  // `numeric_binding.result_ref` names a Result that does NOT exist in
  // the store? The store refuses nothing at the structural level — the
  // binding's `result_ref` is **not declared in IR_REF_FIELDS.Claim** —
  // so the store does NOT close it. The semantic validator is the only
  // thing that catches it.
  it('bridge blocks delivery when numeric_binding.result_ref is unregistered', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-10',
      numeric_binding: { result_ref: 'RES-GHOST', asserted_value: 0.731, asserted_unit: 'm' },
      result_refs: ['RES1'],
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f =>
      f.kind === 'numeric_binding_result_unresolved'
        && f.path.includes('C-RT-C1-10'))).toBe(true)
  })

  it('inspectClaimEvidence reports numeric_binding_result_unresolved for missing target', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-10b',
      numeric_binding: { result_ref: 'RES-GHOST', asserted_value: 0.731, asserted_unit: 'm' },
      result_refs: ['RES1'],
    })).accepted).toBe(true)
    const snapshot = ModelingIr.snapshot(ir)!
    const failures = inspectClaimEvidence(snapshot)
    expect(failures.some(f => f.kind === 'numeric_binding_result_unresolved')).toBe(true)
  })
})

describe('RT-C1-11 — binding.result_ref points at a registered Result not listed in result_refs', () => {
  // Register two Results; the binding names the second but result_refs
  // only lists the first. The schema accepts (both refs are
  // schema-valid); the semantic guard must catch (D-004).
  it('blocks when binding.result_ref is NOT in claim.result_refs', () => {
    const ir = armed()
    const second = {
      result_id: 'RES2',
      run_ref: 'RUN1',
      name: 'alt',
      value: 0.731,
      unit: 'm',
      uncertainty: null,
      source_location: 's',
    }
    expect(ir.put('Result', second).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-11',
      result_refs: ['RES1'],
      numeric_binding: { result_ref: 'RES2', asserted_value: 0.731, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f =>
      f.kind === 'numeric_binding_result_not_in_result_refs'
        && f.path.includes('C-RT-C1-11'))).toBe(true)
  })
})

describe('RT-C1-12 — coerce -0 to +0: invariant on the equality contract', () => {
  // The contract is "D-017: -0 collapses to +0". A binding's
  // asserted_value is -0; the Result's value is 0;
  // numericValuesEqual must return true. An attacker who tries to fool
  // the validator by writing -0.0 vs 0 must see PASS.
  it('treats -0 and +0 as equal (D-017)', () => {
    expect(numericValuesEqual(-0, 0)).toBe(true)
    expect(numericValuesEqual(0, -0)).toBe(true)
  })

  it('accepts a binding with asserted_value: -0 against a Result with value: 0', () => {
    const ir = armed()
    expect(ir.put('Result', {
      result_id: 'RES-Z',
      run_ref: 'RUN1',
      name: 'zero',
      value: 0,
      unit: 'm',
      uncertainty: null,
      source_location: 's',
    }).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-12',
      result_refs: ['RES-Z'],
      numeric_binding: { result_ref: 'RES-Z', asserted_value: -0, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // The contract: -0 vs +0 must not BLOCK delivery.
    expect(decision.evidenceFailures.some(f => f.path.includes('C-RT-C1-12'))).toBe(false)
  })
})

describe('RT-C1-13 — two CRITICAL Claims against the same Result are both checked', () => {
  // First Claim: legal. Second Claim: same Result, value mismatch.
  // Both must surface (D-013): the snapshot walker is exhaustive.
  it('two CRITICAL NUMERIC Claims both checked; one bad blocks delivery', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({ claim_id: 'C-A' })).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      claim_id: 'C-B',
      numeric_binding: { result_ref: 'RES1', asserted_value: 9.999, asserted_unit: 'm' },
      text: 'different value',
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-B'))).toBe(true)
  })
})

describe('RT-C1-14 — every CRITICAL NUMERIC Claim is walked even when ir_claims is empty', () => {
  // D-014: snapshot-driven, not artifact-subset. An invalid CRITICAL
  // Claim already in the store must surface even if ir_claims is empty.
  it('blocks delivery with empty ir_claims when an invalid CRITICAL NUMERIC is in store', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-14',
      numeric_binding: { result_ref: 'RES1', asserted_value: 9.999, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(decision.evidenceFailures.some(f => f.path.includes('C-RT-C1-14'))).toBe(true)
  })
})