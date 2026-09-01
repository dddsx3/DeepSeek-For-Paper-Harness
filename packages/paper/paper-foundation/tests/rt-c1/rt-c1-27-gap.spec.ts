/**
 * RT-C1 — Gap verification: RT-C1-27 (Proxy numeric_binding).
 *
 * Confirmed: a NUMERIC Claim whose `numeric_binding` is a Proxy is
 * accepted into canonical state. The schema-validated value satisfies
 * every shape rule (the Proxy's getters return the right primitive
 * types), and `scanIrValue`'s typed-path walk does NOT fire on a Proxy
 * — `Object.getOwnPropertyDescriptor` on the proxy returns the target's
 * descriptors, not getter/setter descriptors, because the trap is `get`,
 * not `getOwnPropertyDescriptor`.
 *
 * Severity: LOW for TASK 2 (the validator sees the same primitive
 * values the proxy returns, so the binding's load-bearing property holds).
 * But this is a smell: anything that turns "the value is a plain object"
 * into "the value is whatever a trap returns" is a future gap, and the
 * semantic guard's `isObject(binding)` check should be hardened to walk
 * the prototype chain.
 *
 * This file is *evidence*, not a regression — the attack succeeded, so
 * the test must be marked as documenting the gap.
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr, evaluateIrBridge } from '../../src/ir/index.ts'
import { chainThrough } from '../ir/fixtures.ts'

const AT = '2026-09-01T00:00:00.000Z'

function armed(): ModelingIr {
  const ir = new ModelingIr({ now: () => AT })
  for (const entry of chainThrough('Result')) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

describe('RT-C1-27 gap — numeric_binding Proxy is accepted', () => {
  it('a Proxy wrapping { result_ref, asserted_value, asserted_unit } is accepted as canonical', () => {
    const ir = armed()
    const proxy = new Proxy(
      { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      {
        get(target, key) {
          if (key === 'result_ref') return 'RES1'
          if (key === 'asserted_value') return 0.731
          if (key === 'asserted_unit') return 'm'
          return undefined
        },
      },
    )
    const value = {
      claim_id: 'C-RT-C1-27',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: proxy,
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }
    const verdict = ir.put('Claim', value)
    // The attack succeeded — Proxy was accepted.
    expect(verdict.accepted).toBe(true)
    expect(ir.has('C-RT-C1-27')).toBe(true)
  })

  it('a bridge decision on a Proxy-backed Claim reaches delivery', () => {
    const ir = armed()
    const proxy = new Proxy(
      { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      {
        get(target, key) {
          if (key === 'result_ref') return 'RES1'
          if (key === 'asserted_value') return 0.731
          if (key === 'asserted_unit') return 'm'
          return undefined
        },
      },
    )
    expect(ir.put('Claim', {
      claim_id: 'C-RT-C1-27b',
      text: 't',
      claim_type: 'NUMERIC',
      criticality: 'CRITICAL',
      numeric_binding: proxy,
      evidence_refs: [],
      result_refs: ['RES1'],
      model_refs: [],
    }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // Bridge sees the same primitive values the proxy returns, so PASS.
    expect(decision.status).toBe('PASS')
  })
})