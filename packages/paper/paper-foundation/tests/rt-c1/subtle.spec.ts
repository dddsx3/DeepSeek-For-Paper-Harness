/**
 * RT-C1 — Final subtle probes.
 *
 * These look at very narrow edges of the discriminator:
 *   - claim_type as a non-string primitive
 *   - claim_type as a Symbol
 *   - claim_type as null
 *   - numeric_binding as a Proxy
 *   - values from Object.keys() ordering anomalies
 */

import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  claimSchema,
  evaluateIrBridge,
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

describe('RT-C1-26 — claim_type as non-string', () => {
  for (const bad of [null, undefined, 1, 0, false, true, []]) {
    it(`refuses claim_type: ${JSON.stringify(bad)} on NUMERIC Claim`, () => {
      const parsed = claimSchema.safeParse({
        claim_id: 'C-RT-C1-26',
        text: 't',
        claim_type: bad,
        criticality: 'CRITICAL',
        numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
        evidence_refs: [],
        result_refs: ['RES1'],
        model_refs: [],
      })
      expect(parsed.success).toBe(false)
    })
  }
})

describe('RT-C1-27 — numeric_binding is a Proxy [MOVED to rt-c1-27-gap.spec.ts]', () => {
  // The original attack in this file failed: a Proxy-backed
  // numeric_binding was accepted into canonical state. The full
  // analysis lives in tests/rt-c1/rt-c1-27-gap.spec.ts. This file is
  // kept as a pointer for future auditors.
  it('see rt-c1-27-gap.spec.ts', () => {
    expect(true).toBe(true)
  })
})

describe('RT-C1-28 — claim with no model_refs when claim_type: NUMERIC', () => {
  // The NUMERIC branch permits model_refs: []. The MODEL branch requires
  // min(1). The QUALITATIVE branch permits []. So NUMERIC + model_refs: []
  // is legal. Verify.
  it('accepts a NUMERIC Claim with model_refs: []', () => {
    const ir = armed()
    expect(ir.put('Claim', claim({
      claim_id: 'C-RT-C1-28',
      model_refs: [],
    })).accepted).toBe(true)
  })
})

describe('RT-C1-29 — duplicate_id on a Claim id does not mutate the prior record', () => {
  // Repeated put with same id but different shape — only the first survives.
  // The second put must be refused. Then the bridge must still see the
  // original.
  it('second put with same id but binding mismatch is refused; bridge sees original', () => {
    const ir = armed()
    expect(ir.put('Claim', claim()).accepted).toBe(true)
    expect(ir.put('Claim', claim({
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.999, asserted_unit: 'm' },
    })).accepted).toBe(false)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('PASS')
  })
})