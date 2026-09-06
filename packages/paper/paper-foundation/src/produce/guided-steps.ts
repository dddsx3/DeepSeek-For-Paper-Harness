/**
 * TASK-PW W2 — T2 guided-step protocol (W-A sign-off A).
 *
 * Where T1 asks the model for a FULL ir-container-v1 in one shot, T2 walks
 * the model through three tiny declarations (each payload ≤4 fields) and
 * the HARNESS assembles the container along the existing path — the same
 * ir-producer, the same gate set, the same trust chain. The model's
 * invention space is zero: ids, units, and file names are candidates the
 * harness generates from the store, and the payload may only reference
 * them.
 *
 *   Step 1 — run 声明:  { code, outputBasenames, seed? }        (3 fields)
 *   Step 2 — Result 声明: { results: [{ data_id, locator, jsonPath, unit }] }
 *   Step 3 — claims 引用: { claims: [{ claim_id, text, result_refs, criticality }] }
 *
 * The step state machine lives in executor memory (never in a container):
 * step N is not admitted before step N-1, and every ledger write is
 * append-only. All parsers are deterministic (JSON.parse + closed zod, no
 * lenient cleanup) and every refusal carries a stable code.
 *
 * Refusals (each is a red-team leaf):
 *   step_out_of_order     — 步 N 在 N-1 准入前到达
 *   step_foreign_key      — 攻击1: 步 2 载荷混入步 1 的键 (code/outputBasenames/seed)
 *   free_id               — 攻击2a: data_id/claim_id 不在 harness 候选集
 *   free_structure        — 攻击2b: unit/criticality 不在闭集 / 载荷自由结构
 *   unledgered_reference  — 攻击3: locator/result_refs 引用未入账的 id/文件
 *   bypass_container      — 攻击4: 绕过向导直接提交完整容器 (__dsh_paper/entries)
 *
 * After step 3 the harness assembles the container (SymbolSpec/ModelSpec
 * minted from the ledger + store; code/run/interpretations verbatim) and
 * the executor feeds it through the W1 model face — T2 fake 三步走完 →
 * 与 T1 等价交付（同 report、同 sha256）.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/guided-steps
 */

import { z as zod } from 'zod'

export type GuidedStepId = 1 | 2 | 3

/** Stable refusal codes for one guided step. */
export type GuidedRefusalCode =
  | 'step_out_of_order'
  | 'step_foreign_key'
  | 'free_id'
  | 'free_structure'
  | 'unledgered_reference'
  | 'bypass_container'
  | 'schema_violation'

/** The harness-generated candidate set (ids/units/files — 模型零发明空间). */
export interface GuidedCandidates {
  readonly candidateOutputBasenames: ReadonlyArray<string>
  readonly candidateResultIds: ReadonlyArray<string>
  readonly candidateClaimIds: ReadonlyArray<string>
  readonly candidateUnits: ReadonlyArray<string>
  readonly criticalities: ReadonlyArray<string>
}

/** The step ledger — append-only; grows only through admission. */
export interface GuidedLedger {
  /** Step 1 admission: the run declaration. */
  run: { code: string; outputBasenames: ReadonlyArray<string>; seed: number | null } | null
  /** Step 2 admissions: declared Results. */
  results: ReadonlyArray<{ data_id: string; locator: string; jsonPath: string; unit: string }>
  /** Step 3 admissions: declared Claims. */
  claims: ReadonlyArray<{ claim_id: string; text: string; result_refs: ReadonlyArray<string>; criticality: string }>
}

export interface GuidedSession {
  readonly candidates: GuidedCandidates
  readonly ledger: GuidedLedger
  readonly step: GuidedStepId | 'done'
}

export type GuidedStepVerdict =
  | { ok: true; session: GuidedSession }
  | { ok: false; code: GuidedRefusalCode; reason: string }

// ---------------------------------------------------------------------------
// Deterministic closed schemas. `.strict()` makes any foreign key a refusal
// (攻击1: a step-2 payload carrying step-1 keys fails here).
// ---------------------------------------------------------------------------

const STEP1_SCHEMA = zod.object({
  code: zod.string().min(1),
  outputBasenames: zod.array(zod.string().min(1)).min(1),
  seed: zod.number().int().optional(),
}).strict()

const RESULT_ENTRY = zod.object({
  data_id: zod.string().min(1),
  locator: zod.string().min(1),
  jsonPath: zod.string().min(1),
  unit: zod.string().min(1),
}).strict()

const STEP2_SCHEMA = zod.object({
  results: zod.array(RESULT_ENTRY).min(1),
}).strict()

const CLAIM_ENTRY = zod.object({
  claim_id: zod.string().min(1),
  text: zod.string().min(1),
  result_refs: zod.array(zod.string().min(1)).min(1),
  criticality: zod.string().min(1),
}).strict()

const STEP3_SCHEMA = zod.object({
  claims: zod.array(CLAIM_ENTRY).min(1),
}).strict()

/** The harness's canonical closed unit table (derived from the store). */
export function defaultCandidates(): GuidedCandidates {
  return {
    candidateOutputBasenames: ['result.json'],
    candidateResultIds: ['RES-OUT'],
    candidateClaimIds: ['C-OUT'],
    candidateUnits: ['m', '1', 'km^-1', 's', 'kg', 'm/s', '%'],
    criticalities: ['CRITICAL', 'MAJOR', 'MINOR', 'NON_CRITICAL'],
  }
}

/** A fresh session; the state machine never leaves the harness's hands. */
export function startGuidedSession(candidates: GuidedCandidates = defaultCandidates()): GuidedSession {
  return { candidates, ledger: { run: null, results: [], claims: [] }, step: 1 }
}

/** Deterministic parse of one step payload (no lenient cleanup). */
function parseStepPayload(step: GuidedStepId, text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `step ${step} output is not JSON: ${String(error).split('\n')[0]}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `step ${step} output is not a JSON object` }
  }
  return { ok: true, value: parsed }
}

/**
 * Admit one guided step's payload into the ledger.
 *
 * - Step ordering is enforced first (步 1 未准入不进入步 2).
 * - A full-container shape (__dsh_paper / entries) is a bypass refusal
 *   (攻击4) no matter which step is asked for.
 * - Every foreign top-level key (攻击1) and every out-of-candidate id /
 *   unit / criticality (攻击2) and every cross-step reference to an
 *   unledgered id or file (攻击3) is a refusal. No partial writes: the
 *   ledger is appended only after the whole payload validates.
 */
export function admitGuidedStep(session: GuidedSession, step: GuidedStepId, text: string): GuidedStepVerdict {
  if (session.step !== step) {
    return {
      ok: false,
      code: 'step_out_of_order',
      reason: `step ${step} arrived while the session expects step ${session.step} (步 N 未准入不进入步 N+1)`,
    }
  }

  const parsed = parseStepPayload(step, text)
  if (!parsed.ok) return { ok: false, code: 'schema_violation', reason: parsed.reason }
  const raw = parsed.value as Record<string, unknown>

  // 攻击4: bypassing the wizard with a full container is refused outright.
  if (raw['__dsh_paper'] !== undefined || raw['entries'] !== undefined) {
    return {
      ok: false,
      code: 'bypass_container',
      reason: 'the payload is a full ir-container shape — the T2 wizard is the only entry; submit the step you were asked for',
    }
  }

  if (step === 1) {
    const check = STEP1_SCHEMA.safeParse(raw)
    if (!check.success) {
      const first = check.error.issues[0]
      return {
        ok: false,
        code: first?.code === 'unrecognized_keys' ? 'step_foreign_key' : 'schema_violation',
        reason: `step 1 (run 声明) refused: ${first?.message ?? 'invalid'}`,
      }
    }
    const run = check.data
    for (const basename of run.outputBasenames) {
      if (!session.candidates.candidateOutputBasenames.includes(basename)) {
        return {
          ok: false,
          code: 'free_id',
          reason: `output basename '${basename}' is not a harness candidate (files are harness-generated — 模型零发明空间)`,
        }
      }
    }
    return {
      ok: true,
      session: {
        candidates: session.candidates,
        ledger: {
          run: { code: run.code, outputBasenames: run.outputBasenames, seed: run.seed ?? null },
          results: [],
          claims: [],
        },
        step: 2,
      },
    }
  }

  if (step === 2) {
    const check = STEP2_SCHEMA.safeParse(raw)
    if (!check.success) {
      const first = check.error.issues[0]
      return {
        ok: false,
        code: first?.code === 'unrecognized_keys' ? 'step_foreign_key' : 'schema_violation',
        reason: `step 2 (Result 声明) refused: ${first?.message ?? 'invalid'}`,
      }
    }
    const run = session.ledger.run
    if (run === null) return { ok: false, code: 'step_out_of_order', reason: 'no run declaration admitted yet' }
    for (const result of check.data.results) {
      if (!session.candidates.candidateResultIds.includes(result.data_id)) {
        return {
          ok: false,
          code: 'free_id',
          reason: `data_id '${result.data_id}' is not a harness candidate result id — ids are harness-generated`,
        }
      }
      if (!session.candidates.candidateUnits.includes(result.unit)) {
        return {
          ok: false,
          code: 'free_structure',
          reason: `unit '${result.unit}' is not in the harness unit table [${session.candidates.candidateUnits.join(', ')}]`,
        }
      }
      if (!run.outputBasenames.includes(result.locator)) {
        return {
          ok: false,
          code: 'unledgered_reference',
          reason: `locator '${result.locator}' is not one of the step-1 declared outputs [${run.outputBasenames.join(', ')}] — cross-step references must be on the ledger`,
        }
      }
    }
    return {
      ok: true,
      session: {
        candidates: session.candidates,
        ledger: { ...session.ledger, results: check.data.results },
        step: 3,
      },
    }
  }

  const check = STEP3_SCHEMA.safeParse(raw)
  if (!check.success) {
    const first = check.error.issues[0]
    return {
      ok: false,
      code: first?.code === 'unrecognized_keys' ? 'step_foreign_key' : 'schema_violation',
      reason: `step 3 (claims 引用) refused: ${first?.message ?? 'invalid'}`,
    }
  }
  const booked = new Set(session.ledger.results.map(r => r.data_id))
  for (const claim of check.data.claims) {
    if (!session.candidates.candidateClaimIds.includes(claim.claim_id)) {
      return {
        ok: false,
        code: 'free_id',
        reason: `claim_id '${claim.claim_id}' is not a harness candidate claim id — ids are harness-generated`,
      }
    }
    if (!session.candidates.criticalities.includes(claim.criticality)) {
      return {
        ok: false,
        code: 'free_structure',
        reason: `criticality '${claim.criticality}' is not in the closed set [${session.candidates.criticalities.join(', ')}]`,
      }
    }
    for (const ref of claim.result_refs) {
      if (!booked.has(ref)) {
        return {
          ok: false,
          code: 'unledgered_reference',
          reason: `claim '${claim.claim_id}' references result '${ref}' which was never admitted in step 2 — cross-step references must be on the ledger`,
        }
      }
    }
  }
  return {
    ok: true,
    session: {
      candidates: session.candidates,
      ledger: { ...session.ledger, claims: check.data.claims },
      step: 'done',
    },
  }
}

/**
 * Assemble the ir-container-v1 after step 3. The model face stays W1
 * (SymbolSpec + ModelSpec only); the run/interpretations come from the
 * ledger verbatim; the narrative title/conclusion mirror the first claim.
 */
export function assembleGuidedContainer(session: GuidedSession, taskText: string): string {
  const run = session.ledger.run
  if (run === null || session.step !== 'done') {
    throw new Error('assembleGuidedContainer requires a completed three-step session')
  }
  const firstResult = session.ledger.results[0]
  const meaning = firstResult === undefined ? 'the quantity' : firstResult.data_id
  const unit = firstResult?.unit ?? '1'
  const container = {
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning, unit, role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: `estimate ${meaning}`, dependencies: [] } },
    ],
    code: run.code,
    run: {
      outputBasenames: run.outputBasenames,
      ...(run.seed === null ? {} : { seed: run.seed }),
    },
    interpretations: {
      results: session.ledger.results.map(r => ({
        result_id: r.data_id,
        name: r.data_id,
        source: { locator: r.locator, jsonPath: r.jsonPath },
        unit: r.unit,
      })),
      claims: session.ledger.claims.map(c => ({
        claim_id: c.claim_id,
        text: c.text,
        claim_type: 'NUMERIC',
        criticality: c.criticality,
        result_refs: c.result_refs,
        model_refs: ['M1'],
        evidence_refs: c.result_refs,
      })),
    },
    narrative: {
      title: taskText.slice(0, 80),
      conclusion: session.ledger.claims[0]?.text ?? '',
    },
  }
  return JSON.stringify(container)
}

/** One step's instruction text (deterministic; names the candidate sets). */
export function guidedStepPrompt(step: GuidedStepId, candidates: GuidedCandidates): string {
  if (step === 1) {
    return [
      'T2 guided step 1 of 3 — run 声明. Reply with EXACTLY ONE JSON object and nothing else:',
      '{"code": <Node JavaScript that writes the measured numbers to the declared output file>, "outputBasenames": [<files from the candidate list>], "seed": <integer, optional>}',
      `Allowed output files: ${candidates.candidateOutputBasenames.join(', ')}`,
      'No other top-level keys are accepted.',
    ].join('\n')
  }
  if (step === 2) {
    return [
      'T2 guided step 2 of 3 — Result 声明. Reply with EXACTLY ONE JSON object and nothing else:',
      '{"results": [{"data_id": <candidate id>, "locator": <one of the step-1 output files>, "jsonPath": <dotted path to the number inside that file>, "unit": <candidate unit>}]}',
      `Candidate result ids: ${candidates.candidateResultIds.join(', ')}`,
      `Candidate units: ${candidates.candidateUnits.join(', ')}`,
      'No other top-level keys and no other fields are accepted.',
    ].join('\n')
  }
  return [
    'T2 guided step 3 of 3 — claims 引用. Reply with EXACTLY ONE JSON object and nothing else:',
    '{"claims": [{"claim_id": <candidate id>, "text": <claim prose>, "result_refs": [<result ids admitted in step 2>], "criticality": <candidate criticality>}]}',
    `Candidate claim ids: ${candidates.candidateClaimIds.join(', ')}`,
    `Allowed criticalities: ${candidates.criticalities.join(', ')}`,
    'Every result_ref must have been admitted in step 2.',
  ].join('\n')
}
