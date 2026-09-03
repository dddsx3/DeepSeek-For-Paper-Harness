/**
 * P1-4 — reference_validation + execution gates (positive + attack + regression).
 *
 * reference_validation: an independent re-walk of IR_REF_FIELDS; a canonical
 * store has none by construction, a synthetic map with a dangling ref does.
 * execution: every CRITICAL claim's evidence chain must reach a run with a
 * committed, non-STALE ExecutionRecord.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/gate-v014
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { referenceValidationFindings } from '../../src/delivery/reference-validation.ts'
import { executionGateFindings } from '../../src/delivery/execution-gate.ts'
import { chainThrough, backboneIr } from '../ir/fixtures.ts'
import type { IrObjectRecord } from '../../src/ir/store.ts'
import type { IrKind } from '../../src/ir/index.ts'

function chainStore(overrides: Partial<Record<IrKind, Record<string, unknown>>> = {}): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of chainThrough('Claim')) {
    const value = { ...entry.value, ...(overrides[entry.kind] ?? {}) }
    if (entry.kind === 'ExecutionRecord') continue
    const verdict = ir.put(entry.kind, value)
    if (!verdict.accepted) throw new Error(`chain load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  return ir
}

describe('P1-4 reference_validation', () => {
  it('a canonical store has no findings (the store closes refs at admission)', () => {
    expect(referenceValidationFindings(ModelingIr.snapshot(chainStore()))).toHaveLength(0)
  })

  it('a synthetic map with a dangling ref surfaces a finding (defence in depth)', () => {
    const map = new Map<string, IrObjectRecord>([
      ['P1', { kind: 'ProblemSpec', value: { problem_id: 'P1', raw_problem_ref: 'DA-MISSING', requirement_refs: [] } }],
    ])
    const findings = referenceValidationFindings(map)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some(f => f.path.includes('raw_problem_ref'))).toBe(true)
  })
})

describe('P1-4 execution gate', () => {
  it('a CRITICAL claim whose run has no ExecutionRecord is a finding', () => {
    const ir = chainStore()
    const findings = executionGateFindings(ModelingIr.snapshot(ir))
    expect(findings.some(f => f.kind === 'no_record_for_run')).toBe(true)
  })

  it('the canonical backbone (run with a captured record) has no execution findings', () => {
    expect(executionGateFindings(ModelingIr.snapshot(backboneIr()))).toHaveLength(0)
  })
})

describe('P1-4 gates in the delivery policy', () => {
  it('fast delivery without a record is BLOCKED by the execution gate prefix', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: chainStore(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('execution:BLOCKED:'))).toBe(true)
  })

  it('the canonical backbone does not raise the execution or reference prefixes', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: backboneIr(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('execution:BLOCKED:'))).toBe(false)
    expect(decision.failures.some(f => f.reason.startsWith('reference_validation:BLOCKED:'))).toBe(false)
  })
})
