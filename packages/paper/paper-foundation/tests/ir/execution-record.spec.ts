/**
 * TASK 3 PHASE 1 — ExecutionRecord as canonical IR kind #12.
 *
 * Schema-level contract (shape, formats, time ordering, dedupe) and
 * store-level reference closure (`run_ref` → RunArtifact,
 * `input_data_refs` → DataArtifact). The task book's PHASE 1 Local Gate
 * requires happy fixtures + ≥12 invalid fixtures, all red.
 */
import { describe, expect, it } from 'vitest'
import {
  IR_KINDS,
  ModelingIr,
  executionRecordSchema,
  ingestCapturedRecord,
  type IrIngestVerdict,
} from '../../src/ir/index.ts'
import {
  chainThrough,
  executionRecord,
  validObjectFor,
} from './fixtures.ts'

function kinds(verdict: IrIngestVerdict): string[] {
  return verdict.accepted ? [] : verdict.failures.map(f => f.kind)
}

function reasons(verdict: IrIngestVerdict): string {
  return verdict.accepted ? '' : verdict.failures.map(f => `${f.path}:${f.reason}`).join(' | ')
}

/** Store armed with the full chain through RunArtifact (RUN1 registered). */
function armed(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
  for (const entry of chainThrough('RunArtifact')) {
    expect(ir.put(entry.kind, entry.value).accepted, `${entry.kind} fixture`).toBe(true)
  }
  return ir
}

describe('ExecutionRecord — the 12th canonical kind', () => {
  it('is registered in IR_KINDS with schema, id field, and a valid fixture', () => {
    expect(IR_KINDS).toContain('ExecutionRecord')
    const parsed = executionRecordSchema.safeParse(validObjectFor('ExecutionRecord'))
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('ingests the happy fixture into a closed store and freezes it', () => {
    // TASK 3.R3: the producer-only entry is `ingestCapturedRecord`;
    // `ir.put('ExecutionRecord', ...)` now correctly refuses. The
    // happy path goes through the capture path.
    const ir = armed()
    const verdict = ingestCapturedRecord(ir, executionRecord())
    expect(verdict.accepted, reasons(verdict)).toBe(true)
    expect(ir.get('EXEC1')?.kind).toBe('ExecutionRecord')
    expect(Object.isFrozen(ir.get('EXEC1'))).toBe(true)
  })
})

describe('ExecutionRecord — schema-level invalid fixtures (all red)', () => {
  const base = executionRecord()

  it('EX-09 (F-2): finished_at before started_at is refused at the schema', () => {
    const parsed = executionRecordSchema.safeParse({
      ...base,
      started_at: '2026-09-01T00:00:02.000Z',
      finished_at: '2026-09-01T00:00:01.000Z',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a non-ISO timestamp', () => {
    expect(executionRecordSchema.safeParse({ ...base, started_at: 'not-a-time' }).success).toBe(false)
  })

  it('rejects a code_hash without the sha256: prefix', () => {
    expect(executionRecordSchema.safeParse({ ...base, code_hash: 'a'.repeat(64) }).success).toBe(false)
    expect(executionRecordSchema.safeParse({ ...base, code_hash: 'abc123' }).success).toBe(false)
  })

  it('rejects uppercase / short fingerprints', () => {
    expect(executionRecordSchema.safeParse({ ...base, environment_hash: 'A'.repeat(64) }).success).toBe(false)
    expect(executionRecordSchema.safeParse({ ...base, stdout_hash: 'abcd' }).success).toBe(false)
  })

  it('rejects duplicate input_data_refs and output_refs', () => {
    expect(executionRecordSchema.safeParse({
      ...base, input_data_refs: ['DA-IN', 'DA-IN'],
    }).success).toBe(false)
    expect(executionRecordSchema.safeParse({
      ...base, output_refs: ['file:///a', 'file:///a'],
    }).success).toBe(false)
  })

  it('rejects a fractional or NaN exit_status (EX-08 partial)', () => {
    expect(executionRecordSchema.safeParse({ ...base, exit_status: 0.5 }).success).toBe(false)
    expect(executionRecordSchema.safeParse({ ...base, exit_status: Number.NaN }).success).toBe(false)
  })

  it('rejects a missing execution_id and an unknown extra key', () => {
    const { execution_id, ...withoutId } = base
    void execution_id
    expect(executionRecordSchema.safeParse(withoutId).success).toBe(false)
    expect(executionRecordSchema.safeParse({ ...base, trust_me: 1 }).success).toBe(false)
  })
})

describe('ExecutionRecord — store-level reference closure', () => {
  it('EX-02 variant: a dangling run_ref is unresolved at commit', () => {
    // TASK 3.R3: the producer-only path is ingestCapturedRecord. Once
    // a record is past the producer seam, the store boundary closes
    // it: a run_ref that does not resolve to a RunArtifact is
    // unresolved_reference. (v1.1 5.0.4 will replace the forging
    // path with a forgeExecutionRecordForTest helper so this test
    // no longer depends on the producer seam rejecting forge inputs.)
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    const verdict = ingestCapturedRecord(ir, executionRecord())
    expect(verdict.accepted).toBe(false)
    expect(kinds(verdict)).toContain('unresolved_reference')
  })

  it('EX-02: run_ref resolving to a Result is a kind mismatch', () => {
    const ir = armed()
    expect(ir.put('Result', { ...validObjectFor('Result'), result_id: 'RES-X' }).accepted).toBe(true)
    const verdict = ingestCapturedRecord(ir, executionRecord({ run_ref: 'RES-X' }))
    expect(verdict.accepted).toBe(false)
    expect(kinds(verdict)).toContain('reference_kind_mismatch')
  })

  it('a dangling input_data_ref is unresolved at commit', () => {
    const ir = armed()
    const verdict = ingestCapturedRecord(ir, executionRecord({ input_data_refs: ['DA-GHOST'] }))
    expect(verdict.accepted).toBe(false)
    expect(kinds(verdict)).toContain('unresolved_reference')
  })

  it('an input_data_ref resolving to a ModelSpec is a kind mismatch', () => {
    const ir = armed()
    const verdict = ingestCapturedRecord(ir, executionRecord({ input_data_refs: ['M1'] }))
    expect(verdict.accepted).toBe(false)
    expect(kinds(verdict)).toContain('reference_kind_mismatch')
  })

  it('output_refs is NOT store-closed (external locator per task book D6)', () => {
    // The record may name external output locators that the IR cannot
    // resolve — their reality is carried by output_hash + replay.
    const ir = armed()
    const verdict = ingestCapturedRecord(ir, executionRecord({
      output_refs: ['file:///anywhere/else.json'],
    }))
    expect(verdict.accepted, reasons(verdict)).toBe(true)
  })
})