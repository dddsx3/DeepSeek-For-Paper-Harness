/**
 * TASK-P1D — T3.5 "Expand-Then-Select" (expert plan §4/§5).
 *
 * The tier above T3. T3's static closed set answers the SAME question every
 * time — when the candidate space cannot hold a new task's answer, T3 has
 * no move. T3.5's answer is NOT a return to free generation: the model gets
 * exactly three moves, ever,
 *
 *     SELECT(candidate_id)
 *     REQUEST_EXPANSION(slot, reason_code)
 *     ABSTAIN(reason_code)
 *
 * and the loop is a bounded state machine, close kin to CEGIS with one
 * decisive difference: **the LLM never carries the correctness oracle —
 * the deterministic verifier does.** The model can only widen the candidate
 * pool through an ATOMIC micro-generation (one candidate per expansion,
 * itself validated by closed deterministic rules); GENERATION ≠ COMMIT —
 * what expansion produces is a candidate for SELECT, never canonical state
 * by itself.
 *
 * Budgets are hard (expert plan §5.1): MAX_EXPANSIONS_PER_SLOT / PER_RUN;
 * exhaustion BLOCKs with `CANDIDATE_SPACE_EXHAUSTED` — auditable, unlike
 * "please try again". ESCAPE prohibitions stay zero-budget (any digit in
 * the model text, container-shaped payloads, free IR objects).
 *
 * The module is deliberately engine-free (like template-fill): admission
 * is a pure function of (text, state). The executor/demo wires prompts.
 *
 * @module packages/paper/paper-foundation/src/produce/expand-select
 */

import { z as zod } from 'zod'

// ---------------------------------------------------------------------------
// Slots and candidates
// ---------------------------------------------------------------------------

/** The T3 slot vocabulary T3.5 inherits; expansion widens ONE slot. */
export type ExpandSlot = 'json_path' | 'unit' | 'assumption'

/** One deterministic candidate: id is the harness's, meaning is auditable. */
export interface Candidate {
  readonly id: string
  readonly slot: ExpandSlot
  /** The value the candidate carries (e.g. 'snow_depth' as a json_path). */
  readonly value: string
  /** Where the candidate came from: 'seed' (harness-grown) or 'expansion'. */
  readonly origin: 'seed' | 'expansion'
}

/** Closed seed sets per slot (the T3 set + a research-problem seed). */
export function seedCandidates(): ReadonlyArray<Candidate> {
  return [
    { id: 'cand-jp-a', slot: 'json_path', value: 'mean_thickness', origin: 'seed' },
    { id: 'cand-jp-b', slot: 'json_path', value: 'melt_fraction', origin: 'seed' },
    { id: 'cand-u-a', slot: 'unit', value: 'm', origin: 'seed' },
    { id: 'cand-u-b', slot: 'unit', value: 'kg', origin: 'seed' },
    { id: 'cand-a-a', slot: 'assumption', value: 'homogeneous slab', origin: 'seed' },
    { id: 'cand-a-b', slot: 'assumption', value: 'steady state', origin: 'seed' },
  ]
}

// ---------------------------------------------------------------------------
// The three moves (closed schemas — an invented move is an ESCAPE)
// ---------------------------------------------------------------------------

/**
 * TASK-P2-B: the CANONICAL T3.5 teaching face. The study manifest hashes
 * this builder's output (with the seed pool), so "the frozen teaching" is
 * a content address, not a promise — any wording drift flips the manifest
 * hash and verify refuses (Batch B). Probe scripts may render richer
 * variants; the frozen contract is this string.
 */
export function expandSelectTeaching(pool: ReadonlyArray<Candidate>, slots: ReadonlyArray<ExpandSlot>): string {
  return [
    'You are answering a modelling question through a CLOSED choice machine. Reply with exactly ONE JSON object and nothing else — no prose, no markdown fences.',
    'The ONLY legal moves (any other reply is a violation):',
    '  {"action":"SELECT","candidate_id":"<one of the listed ids>"} — choose one candidate from the pool.',
    '  {"action":"REQUEST_EXPANSION","slot":"json_path|unit|assumption","reason":"NO_VALID_CANDIDATE|SEMANTIC_MISMATCH|DOMAIN_NOT_COVERED"} — the pool cannot answer the question.',
    '  {"action":"ABSTAIN","reason":"NOT_ADDRESSABLE|INSUFFICIENT_INFORMATION"} — decline honestly.',
    'HARD RULES: never write a digit anywhere in your reply; never invent a candidate id or a fourth action; ids are copied verbatim from the pool.',
    'DECISION RULE: SELECT only when a listed candidate ACTUALLY answers the question. If the question asks for something the pool does not contain, you MUST REQUEST_EXPANSION for that slot (reason NO_VALID_CANDIDATE) — choosing a near-miss candidate is a wrong answer.',
    `You are resolving these slots for the problem: ${slots.join(' and ')}.`,
    `The candidate pool: ${pool.map(c => `${c.id} (${c.slot} = ${c.value})`).join('; ')}.`,
  ].join('\n')
}

/** Closed reason codes the model may cite (invented codes are refused). */
export const EXPANSION_REASONS = [
  'NO_VALID_CANDIDATE',
  'SEMANTIC_MISMATCH',
  'DOMAIN_NOT_COVERED',
] as const
export type ExpansionReason = (typeof EXPANSION_REASONS)[number]

const moveSelect = zod.object({
  action: zod.literal('SELECT'),
  candidate_id: zod.string().min(1),
}).strict()

const moveExpansion = zod.object({
  action: zod.literal('REQUEST_EXPANSION'),
  slot: zod.enum(['json_path', 'unit', 'assumption'] as const),
  reason: zod.enum(EXPANSION_REASONS),
}).strict()

const moveAbstain = zod.object({
  action: zod.literal('ABSTAIN'),
  reason: zod.enum(['NOT_ADDRESSABLE', 'INSUFFICIENT_INFORMATION'] as const),
}).strict()

const MOVE_SCHEMA = zod.union([moveSelect, moveExpansion, moveAbstain])

/** Closed refusal codes for a T3.5 move. */
export type ExpandSelectRefusalCode =
  | 't35_move_forbidden'      // not one of the three moves (invented shape)
  | 't35_number_forbidden'    // 攻击1: a digit appears in the model text
  | 't35_unknown_candidate'   // SELECT names something not in the pool
  | 't35_budget_exhausted'    // expansion beyond the hard ceiling
  | 't35_abstain_only_left'   // budget gone: ABSTAIN/SELECT, never expansion

/** Any digit in the raw move text is a refusal (数字零通道 — T3.5 inherits it). */
const NUMBER_RE = /\d/u

/**
 * Ordinal words for harness-minted candidate ids — the ids the model must
 * echo back in SELECT stay digit-free, so the unconditional number scan
 * never needs an exception clause: no surface of this tier carries a
 * digit, model-written or harness-minted. The budget ceiling (4/run)
 * bounds the vocabulary.
 */
const ORDINALS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'] as const
function ordinal(n: number): string {
  const word = ORDINALS[n - 1]
  if (word === undefined) throw new Error(`ordinal(${n}) is outside the minted id vocabulary`)
  return word
}

// ---------------------------------------------------------------------------
// State (the bounded machine)
// ---------------------------------------------------------------------------

/** Hard budgets (expert plan §5.1). */
export const MAX_EXPANSIONS_PER_SLOT = 2
export const MAX_EXPANSIONS_PER_RUN = 4

/** The T3.5 state machine over one run. */
export class ExpandSelectSession {
  readonly #candidates = new Map<string, Candidate>()
  /** Expansions spent per slot, and in total. */
  #perSlot: Record<ExpandSlot, number> = { json_path: 0, unit: 0, assumption: 0 }
  #total = 0
  #done = false

  constructor(seed: ReadonlyArray<Candidate> = seedCandidates()) {
    for (const candidate of seed) this.#candidates.set(candidate.id, candidate)
  }

  /** The candidate pool, stable order (seeds first, then expansions). */
  pool(): ReadonlyArray<Candidate> {
    return [...this.#candidates.values()]
  }

  /** How many expansions remain (per-slot and run budgets). */
  budget(): { total: number; perSlot: Readonly<Record<ExpandSlot, number>> } {
    return {
      total: MAX_EXPANSIONS_PER_RUN - this.#total,
      perSlot: {
        json_path: MAX_EXPANSIONS_PER_SLOT - this.#perSlot.json_path,
        unit: MAX_EXPANSIONS_PER_SLOT - this.#perSlot.unit,
        assumption: MAX_EXPANSIONS_PER_SLOT - this.#perSlot.assumption,
      },
    }
  }

  /** Whether the run committed a selection (terminal for the happy path). */
  get committed(): boolean {
    return this.#done
  }

  /**
   * Admit one model move. Deterministic, total, closed refusals:
   *
   *   - text with a digit → `t35_number_forbidden` (ESCAPE family: zero
   *     budget, the number channel stays harness-owned on T3.5 too);
   *   - SELECT must name a pooled candidate id (seeds or expansions);
   *   - REQUEST_EXPANSION must carry budget, else `t35_budget_exhausted`;
   *   - any other shape → `t35_move_forbidden` (an invented move IS the
   *     escape this tier exists to refuse).
   *
   * A successful SELECT commits and closes the session; expansion requests
   * do NOT commit anything — they only entitle the caller to ONE atomic
   * micro-generation (see `admitExpansion`), whose output re-enters as a
   * candidate the model must then SELECT.
   */
  admitMove(text: string): ExpandSelectMoveVerdict {
    if (this.#done) {
      return { ok: false, code: 't35_move_forbidden', reason: 'the session already committed a selection; no further moves' }
    }
    if (NUMBER_RE.test(text)) {
      return {
        ok: false,
        code: 't35_number_forbidden',
        reason: 'a digit appears in the move text — T3.5 inherits the zero number channel (数字零通道); values are harness-owned',
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      return { ok: false, code: 't35_move_forbidden', reason: `move is not JSON: ${String(error).split('\n')[0]}` }
    }
    const move = MOVE_SCHEMA.safeParse(parsed)
    if (!move.success) {
      const first = move.error.issues[0]
      return {
        ok: false,
        code: 't35_move_forbidden',
        reason: `not one of the three moves (SELECT / REQUEST_EXPANSION / ABSTAIN): ${first?.message ?? 'invalid'}`,
      }
    }
    const data = move.data
    if (data.action === 'SELECT') {
      const candidate = this.#candidates.get(data.candidate_id)
      if (candidate === undefined) {
        return {
          ok: false,
          code: 't35_unknown_candidate',
          reason: `SELECT names '${data.candidate_id}' which is not in the candidate pool [${[...this.#candidates.keys()].join(', ')}]`,
        }
      }
      this.#done = true
      return { ok: true, kind: 'select', candidate }
    }
    if (data.action === 'ABSTAIN') {
      return { ok: true, kind: 'abstain', reason: data.reason }
    }
    // REQUEST_EXPANSION: budget check first, loud refusal when spent.
    if (this.#total >= MAX_EXPANSIONS_PER_RUN) {
      return { ok: false, code: 't35_budget_exhausted', reason: `run expansion budget (${MAX_EXPANSIONS_PER_RUN}) is spent — CANDIDATE_SPACE_EXHAUSTED; SELECT from the pool or ABSTAIN` }
    }
    if (this.#perSlot[data.slot] >= MAX_EXPANSIONS_PER_SLOT) {
      return { ok: false, code: 't35_budget_exhausted', reason: `slot '${data.slot}' expansion budget (${MAX_EXPANSIONS_PER_SLOT}) is spent — CANDIDATE_SPACE_EXHAUSTED for this slot` }
    }
    return { ok: true, kind: 'expansion-request', slot: data.slot, reason: data.reason }
  }

  /**
   * Admit the harness's ATOMIC micro-generation for a granted expansion:
   * the generator (deterministic validators here, a constrained model call
   * in the wired tier) proposes ONE new candidate for the slot; this
   * admission is the deterministic check that what was proposed is a legal
   * candidate (shape, non-duplicate, slot-consistent). GENERATION ≠ COMMIT:
   * the accepted candidate enters the POOL only — the model still has to
   * SELECT it in a later move.
   *
   * The candidate id is HARNESS-minted (cand-x-<ordinal>, never model-chosen), so
   * the model cannot forge identity, only content — and content passes
   * through these closed rules.
   */
  admitExpansion(slot: ExpandSlot, value: string): ExpandSelectMoveVerdict {
    if (this.#done) {
      return { ok: false, code: 't35_move_forbidden', reason: 'the session already committed a selection; no further expansions' }
    }
    if (this.#total >= MAX_EXPANSIONS_PER_RUN) {
      return { ok: false, code: 't35_budget_exhausted', reason: `run expansion budget (${MAX_EXPANSIONS_PER_RUN}) is spent` }
    }
    if (this.#perSlot[slot] >= MAX_EXPANSIONS_PER_SLOT) {
      return { ok: false, code: 't35_budget_exhausted', reason: `slot '${slot}' expansion budget (${MAX_EXPANSIONS_PER_SLOT}) is spent` }
    }
    // Deterministic content rules per slot: identifier-shape for json_path,
    // token-shape for unit, sentence-shape for assumption. No digits ANYWHERE
    // (the zero number channel covers generated content too).
    if (NUMBER_RE.test(value)) {
      return { ok: false, code: 't35_number_forbidden', reason: 'the proposed candidate value contains a digit — numbers never enter through expansion either (数字零通道)' }
    }
    const shape = slot === 'json_path'
      ? /^[a-z][a-z_]*$/u
      : slot === 'unit'
        ? /^[a-z^/]+$/u
        : /^[\p{L}\p{Z}.,;'()\-]+$/u
    if (!shape.test(value)) {
      return { ok: false, code: 't35_move_forbidden', reason: `the proposed '${slot}' value '${value}' fails the slot's closed shape rule` }
    }
    const duplicate = [...this.#candidates.values()].some(c => c.slot === slot && c.value === value)
    if (duplicate) {
      return { ok: false, code: 't35_move_forbidden', reason: `the proposed '${slot}' value '${value}' already exists in the pool — expansion must widen, not duplicate` }
    }
    const id = `cand-x-${ordinal(this.#total + 1)}`
    const candidate: Candidate = { id, slot, value, origin: 'expansion' }
    this.#candidates.set(id, candidate)
    this.#perSlot[slot] += 1
    this.#total += 1
    return { ok: true, kind: 'expansion-granted', candidate }
  }
}

/** Verdict of one admitted move (closed). */
export type ExpandSelectMoveVerdict =
  | { ok: true; kind: 'select'; candidate: Candidate }
  | { ok: true; kind: 'abstain'; reason: string }
  | { ok: true; kind: 'expansion-request'; slot: ExpandSlot; reason: ExpansionReason }
  | { ok: true; kind: 'expansion-granted'; candidate: Candidate }
  | { ok: false; code: ExpandSelectRefusalCode; reason: string }
