import { describe, expect, it } from 'vitest'
import {
  CRITICAL_GATE_IDS,
  evaluateDelivery,
  type DeliveryPolicy,
  type GateRecord,
} from '../../src/delivery/index.ts'

/** Build a fully-passing critical-gate set. Tests can mutate one entry to
 *  introduce a single failure for a specific attack. */
function allPassingGates(observedAt = '2026-08-28T00:00:00.000Z'): GateRecord[] {
  return CRITICAL_GATE_IDS.map(id => ({
    id,
    status: 'PASS',
    critical: true,
    observedAt,
  }))
}

function emptyPolicy(overrides: Partial<DeliveryPolicy> = {}): DeliveryPolicy {
  return {
    mode: 'FORMAL',
    gates: allPassingGates(),
    staleArtifactIds: [],
    unresolvedReferenceIds: [],
    requiredOutputs: [],
    runtimeProfileValid: true,
    ...overrides,
  }
}

describe('DeliveryPolicy — D-001..D-008 attack matrix', () => {
  it('D-001: critical gate FAIL even when reviewer data shows PASS → delivery BLOCKED', () => {
    // The reviewer LLM emits a "pass" verdict, but the deterministic
    // reference_validation gate is FAIL. The decision must ignore the
    // reviewer signal.
    const gates = allPassingGates()
    const refIdx = gates.findIndex(g => g.id === 'reference_validation')
    gates[refIdx] = { ...gates[refIdx]!, status: 'FAIL', reason: 'missing Result[3]' }
    const decision = evaluateDelivery(emptyPolicy({ gates }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate' && f.reason.startsWith('reference_validation'))).toBe(true)
  })

  it('D-002: stale artifact id present → delivery BLOCKED with kind=stale', () => {
    const decision = evaluateDelivery(emptyPolicy({
      staleArtifactIds: ['art-7'],
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'stale' && f.reason === 'art-7')).toBe(true)
  })

  it('D-003: unresolved Result reference id present → delivery BLOCKED with kind=unresolved_ref', () => {
    const decision = evaluateDelivery(emptyPolicy({
      unresolvedReferenceIds: ['Result[3]'],
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'unresolved_ref' && f.reason === 'Result[3]')).toBe(true)
  })

  it('D-004: critical Claim with no evidence (provenance gate FAIL) → delivery BLOCKED', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'provenance')
    gates[idx] = { ...gates[idx]!, status: 'FAIL', reason: 'claim C-1 has no evidence' }
    const decision = evaluateDelivery(emptyPolicy({ gates }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate' && f.reason.startsWith('provenance'))).toBe(true)
  })

  it('D-005: FAST mode cannot bypass a critical FAIL — must still BLOCK', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'numeric_consistency')
    gates[idx] = { ...gates[idx]!, status: 'FAIL' }
    const decision = evaluateDelivery(emptyPolicy({ mode: 'FAST', gates }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate' && f.reason.startsWith('numeric_consistency'))).toBe(true)
  })

  it('D-006: execution gate FAIL → delivery BLOCKED', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'execution')
    gates[idx] = { ...gates[idx]!, status: 'FAIL', reason: 'solver exit 2' }
    const decision = evaluateDelivery(emptyPolicy({ gates }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate' && f.reason.startsWith('execution'))).toBe(true)
  })

  it('D-007: required output uncovered → decision.allowed=false (precondition for direct promote() rejection)', () => {
    // The actual direct-promote rejection is asserted in promoter.spec.ts;
    // here we prove the precomputed decision would refuse.
    const decision = evaluateDelivery(emptyPolicy({
      requiredOutputs: [{ id: 'paper.pdf', covered: false }],
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'required_output_missing' && f.reason === 'paper.pdf')).toBe(true)
  })

  it('D-008: reviewer malformed output — provenance gate BLOCKED → delivery BLOCKED', () => {
    // A reviewer that returns malformed JSON cannot be promoted to PASS;
    // the gate producer records BLOCKED, which evaluateDelivery treats as
    // a non-PASS critical status.
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'provenance')
    gates[idx] = { ...gates[idx]!, status: 'BLOCKED', reason: 'reviewer output unparseable' }
    const decision = evaluateDelivery(emptyPolicy({ gates }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'critical_gate' && f.reason.startsWith('provenance:BLOCKED'))).toBe(true)
  })

  it('All critical PASS + no stale + no unresolved + all covered + profile valid → allowed', () => {
    const decision = evaluateDelivery(emptyPolicy({
      requiredOutputs: [
        { id: 'paper.pdf', covered: true },
        { id: 'manifest.json', covered: true },
      ],
    }))
    expect(decision.allowed).toBe(true)
    expect(decision.failures).toEqual([])
  })

  it('FAST mode: non-critical gate FAIL does NOT block delivery (only critical blocks)', () => {
    const gates: GateRecord[] = [
      ...allPassingGates(),
      { id: 'gate.style-polish', status: 'FAIL', critical: false, observedAt: '2026-08-28T00:00:00.000Z', reason: 'prose nit' },
    ]
    const decision = evaluateDelivery(emptyPolicy({ mode: 'FAST', gates }))
    // Critical set is still all PASS, no stale, etc. → allowed.
    expect(decision.allowed).toBe(true)
  })

  it('FORMAL mode: non-critical gate FAIL does NOT block delivery either', () => {
    const gates: GateRecord[] = [
      ...allPassingGates(),
      { id: 'gate.style-polish', status: 'FAIL', critical: false, observedAt: '2026-08-28T00:00:00.000Z' },
    ]
    const decision = evaluateDelivery(emptyPolicy({ mode: 'FORMAL', gates }))
    expect(decision.allowed).toBe(true)
  })

  it('runtime profile invalid → BLOCKED with kind=runtime_profile_invalid', () => {
    const decision = evaluateDelivery(emptyPolicy({ runtimeProfileValid: false }))
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f => f.kind === 'runtime_profile_invalid')).toBe(true)
  })
})
