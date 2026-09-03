import { describe, expect, it } from 'vitest'
import { CAPTURE_ATTESTATION, ModelingIr } from '../../src/ir/index.ts'
import type { IrAuditEvent, IrObjectRecord } from '../../src/ir/index.ts'
import { chainThrough, claim, figureSpec, modelSpec, problemSpec, result, runArtifact, validChain, verificationResult } from './fixtures.ts'

/** A store pre-loaded with the legal Problem → Model → Run chain. */
function seeded(events: IrAuditEvent[] = []): ModelingIr {
  const ir = new ModelingIr({ audit: e => events.push(e), now: () => '2026-08-28T00:00:00.000Z' })
  for (const entry of chainThrough('RunArtifact')) {
    expect(ir.put(entry.kind, entry.value).accepted, `${entry.kind} must ingest`).toBe(true)
  }
  return ir
}

describe('ModelingIr — canonical state', () => {
  it('ingests the full legal chain and exposes it in ingest order', () => {
    const ir = new ModelingIr()
    for (const entry of validChain()) {
      // TASK 3 (3.R3 / INV-3-M): ExecutionRecord enters canonical state
      // only through the producer-only door — `put` refuses it by
      // design, so the chain's final entry carries the capture
      // attestation, exactly as the `backboneIr()` fixture does.
      const verdict = entry.kind === 'ExecutionRecord'
        ? ir.putExecutionRecord(entry.value, CAPTURE_ATTESTATION)
        : ir.put(entry.kind, entry.value)
      expect(verdict.accepted, `${entry.kind} must ingest`).toBe(true)
    }
    // Derived, not literal: TASK 1.5 inserted four kinds ahead of
    // ProblemSpec, and a hardcoded length would rot on the next ontology change.
    expect(ir.size).toBe(validChain().length)
    expect(ir.list().map(r => r.kind)).toEqual(validChain().map(e => e.kind))
    expect(ir.list().map(r => r.seq)).toEqual(validChain().map((_, i) => i))
  })

  it('exposes id, kind, and record lookups', () => {
    const ir = seeded()
    expect(ir.has('P1')).toBe(true)
    expect(ir.has('nope')).toBe(false)
    expect(ir.kindOf('P1')).toBe('ProblemSpec')
    expect(ir.kindOf('nope')).toBeUndefined()
    expect(ir.get('P1')?.id).toBe('P1')
    expect(ir.get('nope')).toBeUndefined()
  })

  it('stamps the injected clock and the ingest order', () => {
    const ir = seeded()
    const record = ir.get('P1')!
    expect(record.ingestedAt).toBe('2026-08-28T00:00:00.000Z')
    expect(record.seq).toBe(chainThrough('RunArtifact').findIndex(e => e.kind === 'ProblemSpec'))
  })

  it('works with no options at all (default audit and clock)', () => {
    const ir = new ModelingIr()
    // TASK 1.5R: `ProblemSpec.raw_problem_ref` / `requirement_refs` are closed
    // against the canonical store, so the referenced DataArtifact and
    // RequirementSpecs must be registered first.
    for (const entry of chainThrough('ProblemSpec')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    const record = ir.get('P1')!
    expect(record.kind).toBe('ProblemSpec')
    expect(record.ingestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('ingestJson accepts valid text and is equivalent to put', () => {
    const ir = seeded()
    const verdict = ir.ingestJson('Result', JSON.stringify(result()))
    expect(verdict.accepted).toBe(true)
    if (verdict.accepted) {
      expect(verdict.record.id).toBe('RES1')
      expect(verdict.record.value.value).toBe(0.731)
    }
  })

  it('refuses an unknown kind rather than treating it as a no-op', () => {
    const ir = new ModelingIr()
    const verdict = ir.put('Bogus' as unknown as 'Result', {})
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]).toMatchObject({ kind: 'unknown_kind', path: '$' })
      expect(verdict.failures[0]!.reason).toContain('Bogus')
    }
    expect(ir.size).toBe(0)
  })

  it('refuses unparseable text before touching the schema', () => {
    const ir = new ModelingIr()
    const verdict = ir.ingestJson('Result', '{"result_id":')
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.kind).toBe('parse_failed')
  })

  it('reports the offending path for a schema failure', () => {
    const ir = seeded()
    const verdict = ir.put('Result', result({ unit: 5 }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('schema_invalid')
      expect(verdict.failures[0]!.path).toBe('unit')
    }
  })

  it('reports a whole-document path for an unrecognised top-level key', () => {
    const ir = new ModelingIr()
    const verdict = ir.put('ProblemSpec', { ...problemSpec(), extra: true })
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.path).toBe('$')
  })

  it('refuses a duplicate id of the same kind', () => {
    const ir = seeded()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const verdict = ir.put('Result', result())
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('duplicate_id')
      expect(verdict.failures[0]!.reason).toContain('already registered as Result')
    }
    expect(ir.size).toBe(chainThrough('RunArtifact').length + 1)
  })

  it('refuses a duplicate id across different kinds (ids are globally unique)', () => {
    const ir = seeded()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const collision = ir.put('Claim', claim({ claim_id: 'RES1' }))
    expect(collision.accepted).toBe(false)
    if (!collision.accepted) expect(collision.failures[0]!.kind).toBe('duplicate_id')
  })

  it('collects duplicate-id and reference failures in one verdict', () => {
    const ir = seeded()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const verdict = ir.put('Claim', claim({ claim_id: 'RES1', result_refs: ['RES-NOPE'] }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.map(f => f.kind)).toEqual(['duplicate_id', 'unresolved_reference'])
    }
  })

  it('refuses a reference that resolves to the wrong kind', () => {
    const ir = seeded()
    const verdict = ir.put('Result', result({ run_ref: 'M1' }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('reference_kind_mismatch')
      expect(verdict.failures[0]!.reason).toContain('resolves to ModelSpec, expected RunArtifact')
    }
  })

  it('requires the referenced object to exist BEFORE the referencing one', () => {
    const ir = seeded()
    // RUN1 is present, so the Result is legal; a Result naming a run that has
    // not been registered yet is not, and registering it afterwards cannot
    // retroactively admit the rejected object.
    expect(ir.put('Result', result({ run_ref: 'RUN-FUTURE' })).accepted).toBe(false)
    expect(ir.put('RunArtifact', runArtifact({ run_id: 'RUN-FUTURE' })).accepted).toBe(true)
    expect(ir.get('RUN-FUTURE')).toBeDefined()
    expect(ir.size).toBe(chainThrough('RunArtifact').length + 1)
  })

  it('stores a deep-frozen snapshot, so later mutation of the input is inert', () => {
    const ir = seeded()
    const input = result()
    expect(ir.put('Result', input).accepted).toBe(true)
    ;(input as { value: number }).value = 999
    expect(ir.get('RES1')!.value).toMatchObject({ value: 0.731 })
  })

  it('refuses direct mutation of canonical state', () => {
    const ir = seeded()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const stored = ir.get('RES1')!.value as { value: number }
    expect(Object.isFrozen(stored)).toBe(true)
    expect(() => {
      stored.value = 999
    }).toThrow(TypeError)
    expect(ir.get('RES1')!.value).toMatchObject({ value: 0.731 })
  })

  it('freezes nested structures, not just the top level', () => {
    // ModelSpec rather than ProblemSpec: `parameter_refs` is an array of
    // objects, which is the nesting this test needs, and ProblemSpec no
    // longer carries nested sub-objects at all (INV-1.5-A).
    const ir = seeded()
    expect(ir.put('ModelSpec', modelSpec({ model_id: 'M2' })).accepted).toBe(true)
    const stored = ir.get('M2')!.value as {
      parameter_refs: Array<{ symbol_ref: string; value: number }>
      equations: string[]
    }
    expect(Object.isFrozen(stored.parameter_refs)).toBe(true)
    expect(Object.isFrozen(stored.parameter_refs[0])).toBe(true)
    expect(Object.isFrozen(stored.equations)).toBe(true)
    expect(() => {
      stored.parameter_refs[0]!.symbol_ref = 'mutated'
    }).toThrow(TypeError)
  })

  it('emits one audit event on acceptance and one on refusal', () => {
    const events: IrAuditEvent[] = []
    const ir = seeded(events)
    events.length = 0

    ir.put('Result', result())
    ir.put('Result', result())
    ir.ingestJson('Claim', 'not json at all')

    expect(events.map(e => e.type)).toEqual([
      'ir_ingest_accepted',
      'ir_ingest_blocked',
      'ir_ingest_blocked',
    ])
    expect(events[0]!.id).toBe('RES1')
    expect(events[0]!.failures).toEqual([])
    expect(events[2]!.id).toBeNull()
    expect(events[2]!.failures[0]!.kind).toBe('parse_failed')
    expect(events.every(e => e.at === '2026-08-28T00:00:00.000Z')).toBe(true)
  })

  it('keeps the refused payload out of canonical state', () => {
    const ir = seeded()
    const before = ir.size
    ir.put('Result', result({ value: 42, unit: 'm' , result_id: 'RES-BAD' , run_ref: 'NOPE' }))
    expect(ir.size).toBe(before)
    expect(ir.get('RES-BAD')).toBeUndefined()
  })

  it('types the accepted record to its kind', () => {
    const ir = seeded()
    const verdict = ir.put('Result', result())
    expect(verdict.accepted).toBe(true)
    if (verdict.accepted) {
      const record: IrObjectRecord<'Result'> = verdict.record
      expect(record.value.unit).toBe('m')
      expect(record.kind).toBe('Result')
      expect(ir.list().at(-1)!.id).toBe('RES1')
    }
  })

  it('ingests a VerificationResult and a FigureSpec on top of the chain', () => {
    const ir = seeded()
    expect(ir.put('Result', result()).accepted).toBe(true)
    expect(ir.put('VerificationResult', verificationResult()).accepted).toBe(true)
    // A figure may only reference claims that are already canonical.
    expect(ir.put('FigureSpec', figureSpec()).accepted).toBe(false)
    expect(ir.put('Claim', claim()).accepted).toBe(true)
    expect(ir.put('FigureSpec', figureSpec()).accepted).toBe(true)
    // seeded prefix + Result + VerificationResult + Claim + FigureSpec.
    expect(ir.size).toBe(chainThrough('RunArtifact').length + 4)
  })
})
