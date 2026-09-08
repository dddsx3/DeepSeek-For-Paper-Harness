/**
 * TASK-P1D — T3.5 expand-then-select tests (expert plan §4/§5/§13 P1-D).
 *
 * The acceptance condition (expert plan §13):
 *
 *   a test case the T3 static candidate space cannot solve, where
 *     T3   -> BLOCK / FAIL
 *     T3.5 -> expansion -> validate -> select -> PASS
 *   with T3.5 ESCAPE = 0.
 *
 * Plus the attack surface: digits anywhere (seed or generated) are ESCAPE;
 * invented moves refused; budgets hard-exhaust with a loud code; generation
 * never commits; duplicate expansions refused; candidate ids harness-minted.
 */

import { describe, expect, it } from 'vitest'
import {
  ExpandSelectSession,
  MAX_EXPANSIONS_PER_SLOT,
  admitTemplateFill,
  defaultTemplateCandidates,
  seedCandidates,
} from '../../src/index.ts'

/** The case T3 cannot hold: a problem whose json_path is not in the T3 set. */
const NOVEL_JSON_PATH = 'snow_depth'
const T3_FILL_NOVEL = JSON.stringify({ symbol_id: 'SYM-q', unit: 'm', output_file: 'result.json', json_path: NOVEL_JSON_PATH })

describe('P1-D acceptance — the case T3 cannot solve', () => {
  it('T3 refuses the novel json_path (the static pool cannot hold it)', () => {
    const fill = admitTemplateFill(T3_FILL_NOVEL, defaultTemplateCandidates())
    expect(fill.ok).toBe(false)
    if (!fill.ok) expect(fill.code).toBe('t3_free_choice')
  })

  it('T3.5 solves it: REQUEST_EXPANSION → atomic generation → SELECT → PASS, zero ESCAPE', () => {
    const session = new ExpandSelectSession()
    // The model sees the pool, finds no snow_depth, asks for an expansion.
    const request = session.admitMove(JSON.stringify({
      action: 'REQUEST_EXPANSION', slot: 'json_path', reason: 'NO_VALID_CANDIDATE',
    }))
    expect(request.ok).toBe(true)
    if (!request.ok) return
    expect(request.kind).toBe('expansion-request')

    // The harness (or a micro-generator behind deterministic validators)
    // proposes the atomic candidate; admission is generation ≠ commit.
    const generation = session.admitExpansion('json_path', NOVEL_JSON_PATH)
    expect(generation.ok).toBe(true)
    if (!generation.ok) return
    if (generation.kind !== 'expansion-granted') throw new Error('expected expansion-granted')
    expect(generation.candidate.origin).toBe('expansion')
    // The pool now holds it — but nothing is committed yet.
    expect(session.committed).toBe(false)

    // The model selects it in a later move; ONLY now is anything committed.
    const select = session.admitMove(JSON.stringify({ action: 'SELECT', candidate_id: generation.candidate.id }))
    expect(select.ok).toBe(true)
    if (!select.ok) return
    if (select.kind !== 'select') throw new Error('expected select')
    expect(select.candidate.value).toBe(NOVEL_JSON_PATH)
    expect(session.committed).toBe(true)

    // ESCAPE = 0 across the whole run: every move was one of the three.
    expect(session.pool().filter(c => c.origin === 'expansion')).toHaveLength(1)
  })

  it('the T3.5 pool is a strict superset of the T3 vocabulary (the tier, not a replacement)', () => {
    const pool = seedCandidates()
    // T3's json_path vocabulary is inside T3.5's seed pool.
    expect(pool.some(c => c.slot === 'json_path' && c.value === 'mean_thickness')).toBe(true)
    expect(pool.some(c => c.slot === 'unit' && c.value === 'm')).toBe(true)
  })
})

describe('T3.5 — the three moves are closed (invented moves are refusals)', () => {
  it('an invented fourth action is refused', () => {
    const session = new ExpandSelectSession()
    const verdict = session.admitMove(JSON.stringify({ action: 'DECLARE', json_path: 'whatever' }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('t35_move_forbidden')
  })

  it('a full IR container smuggled as a move is refused by the number scan itself', () => {
    const session = new ExpandSelectSession()
    // 'ir-container-v1' carries a version digit, so the unconditional
    // number scan refuses it BEFORE the move shape check — a smuggle that
    // cannot even name itself without a digit is dead on arrival.
    const verdict = session.admitMove(JSON.stringify({ __dsh_paper: 'ir-container-v1', entries: [] }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('t35_number_forbidden')
    // And a digit-free container shape still fails the closed move schema.
    const digitFree = session.admitMove(JSON.stringify({ __dsh_paper: 'ir-container', entries: [], run: {}, interpretations: {} }))
    expect(digitFree.ok).toBe(false)
    if (!digitFree.ok) expect(digitFree.code).toBe('t35_move_forbidden')
  })

  it('SELECT of an unknown candidate is a closed refusal, never a guess', () => {
    const session = new ExpandSelectSession()
    const verdict = session.admitMove(JSON.stringify({ action: 'SELECT', candidate_id: 'cand-from-nowhere' }))
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('t35_unknown_candidate')
  })

  it('ABSTAIN is a legal terminal answer (honesty move)', () => {
    const session = new ExpandSelectSession()
    const verdict = session.admitMove(JSON.stringify({ action: 'ABSTAIN', reason: 'NOT_ADDRESSABLE' }))
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.kind).toBe('abstain')
    expect(session.committed).toBe(false)
  })
})

describe('T3.5 — the zero number channel covers every tier surface', () => {
  it('a digit in the move text is an ESCAPE-family refusal', () => {
    const session = new ExpandSelectSession()
    const verdict = session.admitMove('{"action":"SELECT","candidate_id":"cand-1"}')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('t35_number_forbidden')
  })

  it('a digit in a GENERATED candidate value is refused too (expansion is not a number channel)', () => {
    const session = new ExpandSelectSession()
    session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'json_path', reason: 'NO_VALID_CANDIDATE' }))
    const verdict = session.admitExpansion('json_path', 'depth_in_1985')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('t35_number_forbidden')
  })
})

describe('T3.5 — budgets are hard and loud (expert §5.1)', () => {
  it('per-slot budget: exhaustion BLOCKs the slot with CANDIDATE_SPACE_EXHAUSTED', () => {
    const session = new ExpandSelectSession()
    for (let i = 0; i < MAX_EXPANSIONS_PER_SLOT; i += 1) {
      expect(session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'unit', reason: 'DOMAIN_NOT_COVERED' })).ok).toBe(true)
      expect(session.admitExpansion('unit', `newton${'x'.repeat(i)}`).ok).toBe(true)
    }
    const over = session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'unit', reason: 'DOMAIN_NOT_COVERED' }))
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.code).toBe('t35_budget_exhausted')
      expect(over.reason).toMatch(/CANDIDATE_SPACE_EXHAUSTED/)
    }
  })

  it('run budget: expansions across slots share one ceiling', () => {
    const session = new ExpandSelectSession()
    // Four legal per-slot values: two json_path, one unit, one assumption.
    const plan = [
      { slot: 'json_path', value: 'snow_depth' },
      { slot: 'json_path', value: 'albedo_peak' },
      { slot: 'unit', value: 'pascal' },
      { slot: 'assumption', value: 'isothermal column' },
    ] as const
    for (const step of plan) {
      expect(session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: step.slot, reason: 'SEMANTIC_MISMATCH' })).ok).toBe(true)
      expect(session.admitExpansion(step.slot, step.value).ok).toBe(true)
    }
    // 4 spent (the run ceiling); a fifth is refused even on a slot with
    // per-slot budget remaining (assumption has spent only one of two).
    const over = session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'assumption', reason: 'DOMAIN_NOT_COVERED' }))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.code).toBe('t35_budget_exhausted')
  })

  it('after commitment no further moves or expansions are accepted', () => {
    const session = new ExpandSelectSession()
    const select = session.admitMove(JSON.stringify({ action: 'SELECT', candidate_id: 'cand-jp-a' }))
    expect(select.ok).toBe(true)
    expect(session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'unit', reason: 'NO_VALID_CANDIDATE' })).ok).toBe(false)
    expect(session.admitExpansion('unit', 'pascal').ok).toBe(false)
    const again = session.admitMove(JSON.stringify({ action: 'SELECT', candidate_id: 'cand-u-a' }))
    expect(again.ok).toBe(false)
  })
})

describe('T3.5 — generation ≠ commit (the core safety property)', () => {
  it('an expansion-granted candidate only widens the pool; nothing is canonical until SELECT', () => {
    const session = new ExpandSelectSession()
    expect(session.committed).toBe(false)
    session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'assumption', reason: 'NO_VALID_CANDIDATE' }))
    const granted = session.admitExpansion('assumption', 'isothermal column')
    expect(granted.ok).toBe(true)
    // The pool grew — commitment did not happen.
    expect(session.committed).toBe(false)
    expect(session.pool().some(c => c.value === 'isothermal column')).toBe(true)
  })

  it('duplicate expansions are refused (expansion widens, never duplicates)', () => {
    const session = new ExpandSelectSession()
    session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'json_path', reason: 'NO_VALID_CANDIDATE' }))
    session.admitExpansion('json_path', 'snow_depth')
    const dup = session.admitExpansion('json_path', 'snow_depth')
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.reason).toMatch(/already exists/)
  })

  it('candidate ids are harness-minted (the model cannot forge identity)', () => {
    const session = new ExpandSelectSession()
    session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'json_path', reason: 'NO_VALID_CANDIDATE' }))
    const granted = session.admitExpansion('json_path', 'albedo')
    expect(granted.ok).toBe(true)
    // Digit-free ordinals: the id the model echoes in SELECT carries no
    // digit, so the unconditional number scan needs no exception clause.
    if (granted.ok && granted.kind === 'expansion-granted') {
      expect(granted.candidate.id).toMatch(/^cand-x-(one|two|three|four)$/)
    }
  })

  it('slot shapes are enforced deterministically (json_path/unit/assumption families)', () => {
    const session = new ExpandSelectSession()
    session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'json_path', reason: 'NO_VALID_CANDIDATE' }))
    // json_path must be a lowercase identifier family
    expect(session.admitExpansion('json_path', 'Not An Identifier').ok).toBe(false)
    expect(session.admitExpansion('json_path', 'valid_path').ok).toBe(true)
    // unit rejects spaces
    session.admitMove(JSON.stringify({ action: 'REQUEST_EXPANSION', slot: 'unit', reason: 'NO_VALID_CANDIDATE' }))
    expect(session.admitExpansion('unit', 'm s').ok).toBe(false)
  })
})
