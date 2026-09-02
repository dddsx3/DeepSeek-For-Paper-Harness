/**
 * TASK 3 repair (3.R3 / INV-3-M): the producer-required refusal is
 * enforced in mechanism form, not by convention. Tests here are the
 * forge* companions to the capture suite: every test exercises a
 * distinct bypass attempt and asserts the store boundary refuses it
 * with reason `producer_required`.
 *
 * The capture suite lives in `tests/execution/capture-replay.spec.ts`
 * and only ingests records through `ingestCapturedRecord`, the
 * sole producer-only entry. This file covers the negative side.
 */
import { describe, expect, it } from 'vitest'
import {
  CAPTURE_ATTESTATION,
  ModelingIr,
  type ExecutionRecord,
} from '../../src/ir/index.ts'
import {
  chainThrough,
  executionRecord,
  result,
} from '../ir/fixtures.ts'

function storeWithBackbone(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
  for (const entry of chainThrough('RunArtifact')) {
    ir.put(entry.kind, entry.value)
  }
  ir.put('Result', result())
  return ir
}

describe('forge — direct put of ExecutionRecord is refused at the store boundary', () => {
  it('EX-21: ir.put("ExecutionRecord", schemaValidRecord) is BLOCKED with producer_required', () => {
    const ir = storeWithBackbone()
    const forged = executionRecord() as Record<string, unknown>
    const verdict = ir.put('ExecutionRecord', forged)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('producer_required')
      expect(verdict.failures[0]!.path).toBe('$')
    }
    expect(ir.has('EXEC1')).toBe(false)
  })

  it('EX-22: a hand-rolled "attestation" object is REFUSED (the symbol is unique)', () => {
    const ir = storeWithBackbone()
    const forged = executionRecord()
    // Caller hand-rolls an object that "looks like" the attestation
    // but is not the captured symbol. Equality must fail.
    const fakeAttestation = { type: 'attestation' }
    const verdict = ir.putExecutionRecord(forged, fakeAttestation as never)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('producer_required')
    }
    expect(ir.has('EXEC1')).toBe(false)
  })

  it('EX-23: a duplicate execution_id cannot be smuggled via putExecutionRecord', () => {
    // The producer-only entry must not allow overwriting a record that
    // was previously committed by the same attestation. The store is
    // append-only (INV-3-M / duplicate_id refusal), and the capture
    // contract adds the producer layer on top.
    const ir = storeWithBackbone()
    const first = ir.putExecutionRecord(executionRecord(), CAPTURE_ATTESTATION)
    expect(first.accepted).toBe(true)
    const second = ir.putExecutionRecord(executionRecord(), CAPTURE_ATTESTATION)
    expect(second.accepted).toBe(false)
    if (!second.accepted) {
      expect(second.failures[0]!.kind).toBe('duplicate_id')
    }
  })

  it('EX-24: capture.ts has no public path that bypasses CAPTURE_ATTESTATION', async () => {
    // Static check: the capture module does not export a way to mint
    // records without going through the producer gate. A direct
    // assignment to a "force put" field must not exist.
    const captureModule = await import('../../src/execution/index.ts') as Record<string, unknown>
    const forbidden = [
      'forcePutExecutionRecord',
      'bypassAttestation',
      'putExecutionRecordWithoutAttestation',
      'forgeExecutionRecord',
    ]
    for (const name of forbidden) {
      expect(captureModule, `forbidden export: ${name}`).not.toHaveProperty(name)
    }
  })

  it('the attestation symbol is identical across imports (Symbol.for contract)', () => {
    // Multiple imports resolve to the same symbol because we use
    // `Symbol.for('paper.capture-attestation')`. This is what makes
    // a forged `Symbol(...)` fail the equality check.
    expect(CAPTURE_ATTESTATION).toBe(Symbol.for('paper.capture-attestation'))
    const forged = Symbol('paper.capture-attestation')
    expect(forged).not.toBe(CAPTURE_ATTESTATION)
  })

  it('a real capture outcome can be ingested via the producer entry', async () => {
    // Positive companion: a record produced by the capture seam is
    // accepted by `putExecutionRecord` (and only by it). This pins
    // that the producer-only entry is *usable*, not just *blocking*.
    const ir = storeWithBackbone()
    const record: ExecutionRecord = executionRecord() as ExecutionRecord
    const verdict = ir.putExecutionRecord(record, CAPTURE_ATTESTATION)
    expect(verdict.accepted).toBe(true)
    expect(ir.has('EXEC1')).toBe(true)
  })
})