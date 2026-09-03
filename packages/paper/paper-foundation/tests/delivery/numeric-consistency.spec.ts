/**
 * P1-3 — numeric_consistency gate v0.1 (positive + attack + regression).
 *
 * The gate walks every NUMERIC Claim and runs the claim-evidence semantic
 * guards (exact value + unit equality vs the bound Result, role binding).
 * A consistent chain passes the numeric gate; a Result value that drifts
 * while its Claim does not is BLOCKED with the gate prefix on the reason.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/numeric-consistency
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { numericConsistencyFindings } from '../../src/delivery/numeric-consistency.ts'
import { chainThrough } from '../ir/fixtures.ts'
import type { IrKind } from '../../src/ir/index.ts'

/** Load a chain up to (and including) Claim, applying per-kind overrides. */
function chainWith(overrides: Partial<Record<IrKind, Record<string, unknown>>> = {}): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of chainThrough('Claim')) {
    const value = { ...entry.value, ...(overrides[entry.kind] ?? {}) }
    if (entry.kind === 'ExecutionRecord') continue // chainThrough('Claim') stops before it
    const verdict = ir.put(entry.kind, value)
    if (!verdict.accepted) throw new Error(`chain load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  return ir
}

describe('P1-3 numeric_consistency — positive', () => {
  it('a consistent NUMERIC claim chain yields no findings', () => {
    const ir = chainWith()
    expect(numericConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })
})

describe('P1-3 numeric_consistency — attacks', () => {
  it('a Result value that drifts while its Claim does not is a finding', () => {
    const ir = chainWith({ Result: { value: 0.732 } }) // claim asserts 0.731
    const findings = numericConsistencyFindings(ModelingIr.snapshot(ir))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some(f => f.kind.includes('value'))).toBe(true)
  })

  it('a Result unit that drifts while its Claim does not is a finding', () => {
    const ir = chainWith({ Result: { unit: 'cm' } }) // claim asserts 'm'
    const findings = numericConsistencyFindings(ModelingIr.snapshot(ir))
    expect(findings.some(f => String(f.reason).toLowerCase().includes('unit'))).toBe(true)
  })
})

describe('P1-3 numeric_consistency — delivery gate', () => {
  it('BLOCKs delivery (numeric prefix) when a claim disagrees with its Result', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const ir = chainWith({ Result: { value: 0.732 } })
    const policy = buildDeliveryPolicy({ mode: 'fast', ir, runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f =>
      f.reason.startsWith('numeric_consistency:BLOCKED:') && f.reason.includes('numeric inconsistency'),
    )).toBe(true)
  })

  it('does NOT raise the numeric prefix when the chain is consistent', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const ir = chainWith()
    const policy = buildDeliveryPolicy({ mode: 'fast', ir, runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('numeric_consistency:BLOCKED:'))).toBe(false)
  })
})
