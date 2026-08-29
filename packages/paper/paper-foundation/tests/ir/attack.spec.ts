/**
 * TASK 1 attack matrix: IR-001 … IR-010 from task book §7.
 *
 * Every test drives the real `ModelingIr` store in a realistic state (a legal
 * Problem → Model → Run chain already registered) and asserts the attack is
 * BLOCKED *and* that canonical state is unchanged.
 */

import { describe, expect, it } from 'vitest'
import * as irModule from '../../src/ir/index.ts'
import { ModelingIr } from '../../src/ir/index.ts'
import { claim, figureSpec, modelSpec, result, runArtifact, validChain } from './fixtures.ts'

/** Store holding Problem P1 → Model M1 → Run RUN1. */
function armed(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-08-28T00:00:00.000Z' })
  for (const entry of validChain().slice(0, 3)) {
    expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
  }
  return ir
}

function kinds(verdict: { accepted: boolean; failures?: ReadonlyArray<{ kind: string }> }): string[] {
  return verdict.accepted ? [] : (verdict.failures ?? []).map(f => f.kind)
}

describe('TASK 1 — IR-001..IR-010', () => {
  it('IR-001: invalid JSON never reaches canonical state', () => {
    const ir = armed()
    for (const text of [
      '{',
      '{"result_id": "RES1",}',
      "{'result_id': 'RES1'}",
      'Sure! ' + JSON.stringify(result()),
      '',
      'null',
      '42',
      '[]',
    ]) {
      const verdict = ir.ingestJson('Result', text)
      expect(verdict.accepted, `must reject: ${text}`).toBe(false)
    }
    expect(ir.size).toBe(3)
  })

  it('IR-002: duplicate id is refused, within a kind and across kinds', () => {
    const ir = armed()
    const first = ir.put('Result', result())
    expect(first.accepted).toBe(true)

    expect(kinds(ir.put('Result', result()))).toContain('duplicate_id')
    expect(kinds(ir.put('Claim', claim({ claim_id: 'RES1' })))).toContain('duplicate_id')
    expect(kinds(ir.put('RunArtifact', runArtifact({ run_id: 'RES1' })))).toContain('duplicate_id')
    expect(ir.size).toBe(4)
  })

  it('IR-003: a Claim naming a nonexistent Result is refused', () => {
    const ir = armed()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const verdict = ir.put('Claim', claim({ result_refs: ['RES-GHOST'] }))
    expect(kinds(verdict)).toContain('unresolved_reference')
    expect(ir.get('C1')).toBeUndefined()
  })

  it('IR-004: a Result naming a nonexistent RunArtifact is refused', () => {
    const ir = armed()
    const verdict = ir.put('Result', result({ run_ref: 'RUN-GHOST' }))
    expect(kinds(verdict)).toContain('unresolved_reference')
    expect(ir.get('RES1')).toBeUndefined()
  })

  it('IR-005: a ModelSpec naming a nonexistent ProblemSpec is refused', () => {
    const ir = armed()
    expect(kinds(ir.put('ModelSpec', modelSpec({ model_id: 'M9', problem_refs: ['P-GHOST'] }))))
      .toContain('unresolved_reference')
    expect(ir.get('M9')).toBeUndefined()

    // Same for a RunArtifact naming a nonexistent ModelSpec.
    expect(kinds(ir.put('RunArtifact', runArtifact({ run_id: 'RUN9', model_ref: 'M-GHOST' }))))
      .toContain('unresolved_reference')
    expect(ir.get('RUN9')).toBeUndefined()
  })

  it('IR-006: a Claim with no criticality is refused at the criticality field', () => {
    const ir = armed()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const { criticality, ...withoutCriticality } = claim()
    expect(criticality).toBe('CRITICAL')

    const verdict = ir.put('Claim', withoutCriticality)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      const failure = verdict.failures[0]!
      expect(failure.kind).toBe('schema_invalid')
      expect(failure.path).toBe('criticality')
      // A closed enum rejects an absent value as an invalid option, so the
      // message differs from a plain missing string; both are schema failures
      // at the same path, which is what the invariant actually requires.
      expect(failure.reason).toContain('CRITICAL')
    }
    expect(ir.get('C1')).toBeUndefined()
  })

  it('IR-007: a Figure whose data_ref does not exist is refused', () => {
    const ir = armed()
    expect(ir.put('Result', result()).accepted).toBe(true)
    const verdict = ir.put('FigureSpec', figureSpec({ data_refs: ['DATA-GHOST'] }))
    expect(kinds(verdict)).toContain('unresolved_reference')
    if (!verdict.accepted) expect(verdict.failures[0]!.path).toBe('data_refs')
    expect(ir.get('F1')).toBeUndefined()
  })

  it('IR-008: a Result with no unit is refused at the unit field', () => {
    const ir = armed()
    const { unit, ...withoutUnit } = result()
    expect(unit).toBe('m')

    const verdict = ir.put('Result', withoutUnit)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('schema_invalid')
      expect(verdict.failures[0]!.path).toBe('unit')
      // Pinned: this is the wording that marks a required field as *absent*
      // rather than wrongly typed. A zod upgrade that changes it must fail
      // this test rather than silently reclassify missing fields.
      expect(verdict.failures[0]!.reason).toContain('received undefined')
    }
    expect(ir.get('RES1')).toBeUndefined()
  })

  it('IR-009: a RunArtifact with no exit_status is refused at the exit_status field', () => {
    const ir = armed()
    const { exit_status, ...withoutExit } = runArtifact({ run_id: 'RUN2' })
    expect(exit_status).toBe(0)

    const verdict = ir.put('RunArtifact', withoutExit)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures[0]!.kind).toBe('schema_invalid')
      expect(verdict.failures[0]!.path).toBe('exit_status')
    }
    expect(ir.get('RUN2')).toBeUndefined()
  })

  it('IR-010: a malformed reviewer finding is refused, not absorbed', () => {
    const ir = armed()
    expect(ir.put('Result', result()).accepted).toBe(true)

    // Malformed at the JSON layer.
    expect(kinds(ir.ingestJson('ReviewerFinding', '{"finding_id": '))).toContain('parse_failed')

    // Well-formed JSON, wrong shape — including a reviewer that tries to
    // emit a verdict instead of a finding.
    const malformed: ReadonlyArray<unknown> = [
      { finding_id: 'RF1' },
      { finding_id: 'RF1', target_ref: 'RES1', attack_type: 'vibes' },
      { finding_id: 'RF1', target_ref: 'GHOST', attack_type: 'sensitivity', hypothesis: 'h', reason: 'r', evidence_refs: [], proposed_check: 'c', severity: 'CRITICAL' },
      { finding_id: 'RF1', target_ref: 'RES1', attack_type: 'sensitivity', hypothesis: 'h', reason: 'r', evidence_refs: [], proposed_check: 'c', severity: 'PASS' },
      { finding_id: 'RF1', target_ref: 'RES1', attack_type: 'sensitivity', hypothesis: 'h', reason: 'r', evidence_refs: [], proposed_check: 'c', severity: 'CRITICAL', paper_passed: true },
      'RF1 is fine',
      [],
    ]
    for (const bad of malformed) {
      const verdict = ir.put('ReviewerFinding', bad)
      expect(verdict.accepted, `must reject: ${JSON.stringify(bad).slice(0, 60)}`).toBe(false)
      // Whatever layer catches it, the reason must come from the closed set:
      // a malformed finding never becomes an accepted canonical object.
      for (const kind of kinds(verdict)) {
        expect(irModule.IR_FAILURE_KINDS).toContain(kind as irModule.IrFailureKind)
      }
      expect(kinds(verdict).length).toBeGreaterThan(0)
    }

    // A reviewer that emits no JSON at all is also refused.
    expect(kinds(ir.ingestJson('ReviewerFinding', 'Looks good to me!'))).toContain('parse_failed')
    expect(ir.get('RF1')).toBeUndefined()
  })

  it('an accepted object cannot be swapped out afterwards (no update path exists)', () => {
    const ir = armed()
    expect(ir.put('Result', result()).accepted).toBe(true)
    expect(ir.get('RES1')!.value).toMatchObject({ value: 0.731 })

    const replacement = ir.put('Result', result({ value: 0.781 }))
    expect(replacement.accepted).toBe(false)
    expect(ir.get('RES1')!.value).toMatchObject({ value: 0.731 })

    const methods = Object.getOwnPropertyNames(ModelingIr.prototype)
    expect(methods.filter(m => /^(update|replace|delete|remove|set|overwrite)/i.test(m))).toEqual([])
  })

  it('the IR module exposes no repair, coercion, or second-guess entry point', () => {
    const forbidden = /repair|heal|autofix|coerce|reinterpret|guess|bestEffort|lenient|fallback/i
    expect(Object.keys(irModule).filter(name => forbidden.test(name))).toEqual([])
    const methods = Object.getOwnPropertyNames(ModelingIr.prototype)
    expect(methods.filter(name => forbidden.test(name))).toEqual([])
    // The only two ingress doors are the strict parser and the validating put.
    expect(typeof irModule.parseStrictJson).toBe('function')
    expect(typeof irModule.ModelingIr).toBe('function')
  })
})
