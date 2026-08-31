/**
 * Regressions for the escape paths found by the TASK 1 red team.
 *
 * Every test here corresponds to a finding that was *exploited*, not merely
 * theorised: each one failed against the first implementation and passes
 * against the current one. They are kept in a dedicated file so the next
 * red team can see exactly which doors were tried and how they were nailed
 * shut.
 */

import { describe, expect, it } from 'vitest'
import {
  ID_FIELD_BY_KIND,
  IR_KINDS,
  IR_REF_FIELDS,
  IR_SCHEMAS,
  ModelingIr,
} from '../../src/ir/index.ts'
import type { IrAuditEvent } from '../../src/ir/index.ts'
import { chainThrough, claim, dataArtifact, problemSpec, result } from './fixtures.ts'

function armed(events: IrAuditEvent[] = []): ModelingIr {
  const ir = new ModelingIr({ audit: e => events.push(e), now: () => '2026-08-28T00:00:00.000Z' })
  for (const entry of chainThrough('RunArtifact')) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

describe('RT1-01 / RT2-01 — canonical state is not reachable from outside', () => {
  it('exposes no enumerable state at all', () => {
    const ir = armed()
    expect(Object.keys(ir)).toEqual([])
    // The old implementation used TypeScript `private`, which erases at
    // compile time and left the backing Map writable.
    expect((ir as unknown as { objects?: unknown }).objects).toBeUndefined()
    expect((ir as unknown as { seq?: unknown }).seq).toBeUndefined()
    expect((ir as unknown as { audit?: unknown }).audit).toBeUndefined()
    expect((ir as unknown as { now?: unknown }).now).toBeUndefined()
  })

  it('treats a decoy property as inert: canonical state is unreachable', () => {
    const ir = armed()
    const before = ir.size
    const target = ir as unknown as Record<string, unknown>
    for (const key of ['objects', 'seq', 'audit', 'now', '_objects']) {
      expect(target[key]).toBeUndefined()
    }
    // Writing a decoy own property is allowed (the instance is not frozen,
    // only its prototype is) but harmless: the internals are `#private`, so
    // nothing reads it. The invariant is that canonical state never moves.
    target['objects'] = new Map<string, unknown>([['GHOST', { kind: 'Result' }]])
    target['seq'] = 0
    expect(ir.size).toBe(before)
    expect(ir.has('GHOST')).toBe(false)
    expect(ir.get('GHOST')).toBeUndefined()
    // And validation still runs, so the decoy cannot launder an ingest.
    expect(ir.put('Result', result({ run_ref: 'NOPE' })).accepted).toBe(false)
    expect(ir.put('Result', result()).accepted).toBe(true)
    expect(ir.list().at(-1)!.seq).toBe(chainThrough('RunArtifact').length)
  })

  it('returns a frozen record, so record.kind cannot be spoofed', () => {
    const ir = armed()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const record = ir.get('RES1') as unknown as { kind: string }
    expect(Object.isFrozen(record)).toBe(true)
    expect(() => {
      record.kind = 'RunArtifact'
    }).toThrow(TypeError)

    // The spoof this prevents: rewriting a stored kind so that the next
    // ingest's reference-kind check reads the wrong kind.
    expect(ir.kindOf('RES1')).toBe('Result')
    const spoofed = ir.put('Result', result({ result_id: 'RES2', run_ref: 'RES1' }))
    expect(spoofed.accepted).toBe(false)
    if (!spoofed.accepted) expect(spoofed.failures[0]!.kind).toBe('reference_kind_mismatch')
  })

  it('list() hands out a defensive copy, not the live collection', () => {
    const ir = armed()
    const first = ir.list()
    const before = first.length
    ;(first as unknown as Array<unknown>).push('bogus')
    // The copy is writable; what matters is that the store is not.
    expect(first.length).toBe(before + 1)
    expect(ir.list()).not.toBe(first)
    expect(ir.list().length).toBe(before)
    expect(ir.size).toBe(before)
    for (const record of ir.list()) {
      expect(Object.isFrozen(record)).toBe(true)
    }
  })
})

describe('RT2-02 / RT3-01 — the policy tables are immutable', () => {
  it('freezes every exported table deeply', () => {
    expect(Object.isFrozen(IR_KINDS)).toBe(true)
    expect(Object.isFrozen(IR_SCHEMAS)).toBe(true)
    expect(Object.isFrozen(IR_REF_FIELDS)).toBe(true)
    expect(Object.isFrozen(ID_FIELD_BY_KIND)).toBe(true)
    expect(Object.isFrozen(IR_REF_FIELDS.Result)).toBe(true)
    expect(Object.isFrozen(IR_REF_FIELDS.Result![0])).toBe(true)
  })

  it('refuses to let a table be rewritten to disable reference validation', () => {
    const table = IR_REF_FIELDS as unknown as Record<string, unknown>
    expect(() => {
      table['Result'] = []
    }).toThrow()
    expect(IR_REF_FIELDS.Result).toHaveLength(1)
  })

  it('refuses to let an id field mapping be rewritten', () => {
    const map = ID_FIELD_BY_KIND as unknown as Record<string, unknown>
    expect(() => {
      map['Result'] = 'claim_id'
    }).toThrow()
    expect(ID_FIELD_BY_KIND.Result).toBe('result_id')
  })

  it('keeps validating after a failed table rewrite on a fresh store', () => {
    try {
      (IR_REF_FIELDS as unknown as Record<string, unknown>)['Result'] = []
    } catch { /* expected: the write must fail */ }
    const ir = new ModelingIr()
    expect(ir.put('Result', result({ run_ref: 'DOES_NOT_EXIST' })).accepted).toBe(false)
  })
})

describe('RT3-02 — the store class itself is frozen', () => {
  it('cannot have put() replaced on the prototype', () => {
    expect(Object.isFrozen(ModelingIr)).toBe(true)
    expect(Object.isFrozen(ModelingIr.prototype)).toBe(true)
    expect(() => {
      (ModelingIr.prototype as unknown as Record<string, unknown>)['put'] = () => ({ accepted: true })
    }).toThrow()
  })

  it('still ingests correctly after a failed prototype hijack', () => {
    try {
      (ModelingIr.prototype as unknown as Record<string, unknown>)['put'] = () => ({ accepted: true })
    } catch { /* expected */ }
    const ir = armed()
    expect(ir.put('Result', result({ run_ref: 'NOPE' })).accepted).toBe(false)
    expect(ir.put('Result', result()).accepted).toBe(true)
  })

  it('fails closed when the method is detached from its instance', () => {
    const ir = armed()
    const detached = ir.put
    expect(() => detached('Result', result())).toThrow(TypeError)
    expect(ir.size).toBe(chainThrough('RunArtifact').length)
  })
})

describe('RT3-03 — inherited and symbol keys cannot satisfy or poison a schema', () => {
  it('refuses an empty object that inherits all required fields', () => {
    const ir = armed()
    const proto = {
      problem_id: 'GHOST',
      raw_problem_ref: 'ghost-ref',
      subproblems: [],
      required_outputs: [],
      constraints: [],
    }
    const verdict = ir.put('ProblemSpec', Object.create(proto))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.kind).toBe('malformed_value')
    expect(ir.has('GHOST')).toBe(false)
  })

  it('refuses a value carrying own symbol keys', () => {
    const ir = armed()
    const value = { ...result(), [Symbol('secret')]: 'hidden' }
    const verdict = ir.put('Result', value)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.reason).toBe('symbol_key')
  })
})

describe('RT2-03 / RT3-05 — both ingress doors apply the same rules', () => {
  it('put() refuses the same bytes ingestJson() refuses', () => {
    const text = '{"result_id":"PP","run_ref":"RUN1","name":"n","value":1,"unit":"m","uncertainty":null,"source_location":"s","__proto__":{"polluted":true}}'
    const ir = armed()
    const viaText = ir.ingestJson('Result', text)
    expect(viaText.accepted).toBe(false)
    if (!viaText.accepted) expect(viaText.failures[0]!.kind).toBe('malformed_value')

    const viaObject = ir.put('Result', JSON.parse(text) as unknown)
    expect(viaObject.accepted).toBe(false)
    if (!viaObject.accepted) expect(viaObject.failures[0]!.kind).toBe('malformed_value')
  })

  it('put() refuses an over-deep graph that ingestJson() would also refuse', () => {
    const ir = armed()
    let deep: unknown = 1
    for (let i = 0; i < 80; i += 1) deep = [deep]
    const verdict = ir.put('Result', { ...result(), source_location: deep })
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.reason).toBe('too_deep')
  })
})

describe('RT1-03 / RT2-06 — put() is total and audits before committing', () => {
  it('refuses instead of throwing when the audit sink throws', () => {
    const ir = new ModelingIr({
      audit: () => {
        throw new Error('audit sink down')
      },
      now: () => '2026-08-28T00:00:00.000Z',
    })
    // DataArtifact is self-closed (no refs), so it clears the reference gate
    // and reaches the audit phase — exactly where the sink throws.
    const verdict = ir.put('DataArtifact', dataArtifact())
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.kind).toBe('internal_error')
    // Nothing was committed: an accepted object with no audit record is
    // exactly the state INV-IR-09 forbids.
    expect(ir.size).toBe(0)
  })

  it('refuses instead of throwing when the clock throws', () => {
    const ir = new ModelingIr({
      now: () => {
        throw new Error('clock down')
      },
    })
    const verdict = ir.put('DataArtifact', dataArtifact())
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.kind).toBe('internal_error')
  })

  it('refuses instead of throwing when the kind has a hostile toString', () => {
    const ir = new ModelingIr()
    const hostile = { toString(): string { throw new Error('nope') } }
    const verdict = ir.put(hostile as unknown as 'Result', {})
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('unknown_kind')
      expect(verdict.failures[0]!.reason).toBe('unknown IR kind: <object>')
    }
  })

  it('refuses instead of throwing on a non-Error throwable', () => {
    const ir = new ModelingIr({
      now: () => {
        throw { toString(): string { throw new Error('also hostile') } }
      },
    })
    const verdict = ir.put('DataArtifact', dataArtifact())
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.reason).toBe('non-Error throw')
  })

  it('still refuses when a refusal audit itself throws', () => {
    const ir = new ModelingIr({
      audit: () => {
        throw new Error('audit sink down')
      },
    })
    const verdict = ir.put('Result', { not: 'a result' })
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.kind).toBe('schema_invalid')
  })
})

describe('RT2-07 — refusals carry the best-effort id', () => {
  it('names the object in a schema-level refusal', () => {
    const events: IrAuditEvent[] = []
    const ir = armed(events)
    const verdict = ir.put('Result', result({ unit: 5 }))
    expect(verdict.accepted).toBe(false)
    const blocked = events.filter(e => e.type === 'ir_ingest_blocked')
    expect(blocked.at(-1)!.id).toBe('RES1')
  })

  it('falls back to null when the id is unreadable or absent', () => {
    const events: IrAuditEvent[] = []
    const ir = armed(events)
    ir.put('Result', { unit: 5 })
    ir.ingestJson('Result', 'nonsense')
    const ids = events.filter(e => e.type === 'ir_ingest_blocked').map(e => e.id)
    expect(ids[0]).toBeNull()
    expect(ids[1]).toBeNull()
  })

  it('stays null for an unknown kind, string or not', () => {
    const events: IrAuditEvent[] = []
    const ir = new ModelingIr({ audit: e => events.push(e) })
    ir.put('Bogus-Kind' as unknown as 'Result', { result_id: 'R1' })
    ir.put(42 as unknown as 'Result', { result_id: 'R1' })
    const blocked = events.filter(e => e.type === 'ir_ingest_blocked')
    expect(blocked).toHaveLength(2)
    for (const event of blocked) {
      expect(event.id).toBeNull()
      expect(event.failures[0]!.kind).toBe('unknown_kind')
    }
    // The audit kind is a safe rendering of the caller's argument, and never
    // calls user code (a hostile toString is the whole point of the check).
    expect(blocked[1]!.kind).toBe('<number>')
  })
})

describe('RT2-04 — a CRITICAL claim with no references is refused', () => {
  it('refuses evidence-free critical claims, and accepts them once referenced', () => {
    const ir = armed()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const empty = ir.put('Claim', claim({
      evidence_refs: [], result_refs: [], model_refs: [],
    }))
    expect(empty.accepted).toBe(false)
    if (!empty.accepted) expect(empty.failures[0]!.kind).toBe('schema_invalid')
    expect(ir.has('C1')).toBe(false)

    expect(ir.put('Claim', claim({ result_refs: ['RES1'] })).accepted).toBe(true)
  })

  it('still allows a NON_CRITICAL claim with no references', () => {
    const ir = armed()
    const verdict = ir.put('Claim', claim({
      criticality: 'NON_CRITICAL',
      evidence_refs: [], result_refs: [], model_refs: [],
    }))
    expect(verdict.accepted).toBe(true)
  })
})

describe('RT1-04 — id charset and normalisation', () => {
  // Built from code points rather than string literals: a raw control or
  // surrogate character in a source file is invisible in review and is exactly
  // the thing this guard exists to reject.
  const NUL = String.fromCodePoint(0x00)
  const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
  const LINE_SEPARATOR = String.fromCodePoint(0x2028)
  const LONE_SURROGATE = String.fromCodePoint(0xd800)
  const COMBINING_ACUTE = String.fromCodePoint(0x0301)
  const E_ACUTE = String.fromCodePoint(0x00e9)
  const NFD_ID = `cafe${COMBINING_ACUTE}`
  const NFC_ID = `caf${E_ACUTE}`

  it('rejects ids containing control, format, surrogate or separator characters', () => {
    const ir = armed()
    const bad = [
      NUL,
      `a${NUL}b`,
      ZERO_WIDTH_SPACE,
      `a${ZERO_WIDTH_SPACE}b`,
      LONE_SURROGATE,
      LINE_SEPARATOR,
      `a${LINE_SEPARATOR}b`,
    ]
    for (const id of bad) {
      const verdict = ir.put('Result', result({ result_id: id }))
      expect(verdict.accepted, `must reject id ${JSON.stringify(id)}`).toBe(false)
    }
  })

  it('rejects an id that is not in NFC form', () => {
    const ir = armed()
    expect(NFD_ID.normalize('NFC')).toBe(NFC_ID)
    const verdict = ir.put('Result', result({ result_id: NFD_ID }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.reason).toContain('NFC')
  })

  it('accepts the precomposed form, and keeps it distinct from the NFD spelling', () => {
    const ir = armed()
    expect(ir.put('Result', result({ result_id: NFC_ID })).accepted).toBe(true)
    expect(ir.has(NFC_ID)).toBe(true)
    expect(ir.has(NFD_ID)).toBe(false)
  })
})

describe('RT1-02 — oversized ingress is refused, not absorbed', () => {
  it('refuses an over-long prose field', () => {
    const ir = armed()
    const verdict = ir.put('Result', result({ name: 'x'.repeat(65_537) }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.path).toBe('name')
  })

  it('accepts a prose field at the limit', () => {
    const ir = armed()
    expect(ir.put('Result', result({ name: 'x'.repeat(65_536) })).accepted).toBe(true)
  })

  it('refuses multi-megabyte text before parsing it', () => {
    const ir = armed()
    const huge = `{"result_id":"R","run_ref":"RUN1","name":"${'x'.repeat(2_000_000)}"}`
    const verdict = ir.ingestJson('Result', huge)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.failures[0]!.reason).toBe('input_too_large')
  })
})

describe('RT4-01 — the reference table covers every reference-bearing field', () => {
  it('declares exactly the reference fields the schemas define', () => {
    // The previous version of this test only asserted that three known
    // external locators were absent, which stays green even when a real
    // reference field is deleted from the table.
    const expected: Record<string, ReadonlyArray<string>> = {
      // TASK 1.5R: `raw_problem_ref` / `requirement_refs` are now IR-internal
      // references closed on the store boundary (Canonical Reference Closure).
      ProblemSpec: ['raw_problem_ref', 'requirement_refs'],
      ModelSpec: ['problem_refs', 'dependencies', 'variable_refs', 'parameter_refs'],
      RunArtifact: ['model_ref', 'input_data_refs'],
      Result: ['run_ref'],
      Claim: ['evidence_refs', 'result_refs', 'model_refs'],
      VerificationResult: ['target_ref', 'evidence_refs'],
      FigureSpec: ['data_refs', 'claim_refs'],
      ReviewerFinding: ['target_ref', 'evidence_refs'],
      DataArtifact: [],
      RequirementSpec: ['source_data_ref'],
      SymbolSpec: ['scope_ref'],
    }
    for (const kind of IR_KINDS) {
      expect(IR_REF_FIELDS[kind].map(f => f.path), `${kind} ref fields`).toEqual(expected[kind])
    }
  })

  it('omits every external locator from the table', () => {
    // TASK 1.5R: `raw_problem_ref` is no longer an external locator — it is
    // an IR-internal reference to a canonical DataArtifact. The remaining
    // externals are file/URI locators the IR has no filesystem for.
    const externals = [
      'code_ref', 'stdout_ref', 'stderr_ref',
      'input_refs', 'output_refs', 'source_location',
    ]
    for (const kind of IR_KINDS) {
      for (const field of IR_REF_FIELDS[kind]) {
        expect(externals, `${kind}.${field.path}`).not.toContain(field.path)
      }
    }
  })
})
