/**
 * RT-C1 — Final probes.
 *
 * These attacks push on the exact contract boundary:
 *   - frozen numeric_binding objects
 *   - numeric_binding whose values are boxed objects (Number wrapper)
 *   - claim_type case variants
 *   - model_refs containing the same ref twice
 *   - claim text equal to binding value (presentation vs canonical)
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr, evaluateIrBridge } from '../../src/ir/index.ts'
import { chainThrough, claim } from '../ir/fixtures.ts'

const AT = '2026-09-01T00:00:00.000Z'

function armed(): ModelingIr {
  const ir = new ModelingIr({ now: () => AT })
  for (const entry of chainThrough('Result')) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

describe('RT-C1-21 — frozen numeric_binding cannot smuggle', () => {
  it('a pre-frozen numeric_binding still validates the same way', () => {
    const binding = Object.freeze({
      result_ref: 'RES1',
      asserted_value: 0.731,
      asserted_unit: 'm',
    })
    const value = {
      claim_id: 'C-RT-C1-21',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: binding,
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }
    const ir = armed()
    expect(ir.put('Claim', value).accepted).toBe(true)
  })
})

describe('RT-C1-22 — boxed Number objects are not equal to primitives', () => {
  it('refuses asserted_value: new Number(0.731) — boxed Number', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-22',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: new Number(0.731) as unknown as number, asserted_unit: 'm' },
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }
    // scanIrValue's typed-path scan does not necessarily reject the boxed
    // Number (it is an object); what matters is whether zod's `number()`
    // accepts it. It does not — boxed numbers have typeof 'object', and
    // zod.number() requires typeof 'number'.
    expect(ir.put('Claim', value).accepted).toBe(false)
  })
})

describe('RT-C1-23 — duplicate result_refs must be checked', () => {
  // The claim schema does not enforce dedup on result_refs. Is this a
  // gap? A duplicate ref means the same Result is named twice, which
  // does not load-bear the binding; the validator's binding check
  // (`includes(resultRef)`) returns true trivially.
  it('accepts a NUMERIC Claim with duplicate result_refs (schema does not dedup)', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-23',
      result_refs: ['RES1', 'RES1'],
    })).accepted).toBe(true)
  })
})

describe('RT-C1-24 — model_refs min(1) for MODEL is structural', () => {
  it('schema refuses a MODEL Claim with one blank-whitespace model_ref', () => {
    const ir = armed()
    const value = {
      claim_id: 'C-RT-C1-24',
      text: 't',
      claim_type: 'MODEL',
      criticality: 'CRITICAL',
      numeric_binding: null,
      evidence_refs: [],
      result_refs: [],
      model_refs: [' '],
    }
    // The idSchema disallows whitespace — refSchema is `string().min(1)`.
    expect(ir.put('Claim', value).accepted).toBe(false)
  })
})

describe('RT-C1-25 — text containing the binding number is purely presentational', () => {
  // The schema allows text and asserted_value to disagree; the validator
  // never reads text. Document the contract.
  it('does not block delivery when text and asserted_value disagree', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-25',
      text: 'The result is 9.999 m.',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    })).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // The validator only compares asserted_value to Result.value, not text.
    // text is purely presentational per task book §2 / known-risks.md §7.
    expect(decision.status).toBe('PASS')
  })
})