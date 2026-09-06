/**
 * TASK-PW W4 — probe/executor failure classification.
 *
 * W-B (sign-off A) splits the old blob of "the model failed" into five
 * classes, each with its own retry semantics:
 *
 *   NONE      — the model produced no usable container at all (prose,
 *               empty, non-JSON). NONE ≠ 错: it is a guidance gap, so the
 *               harness retries with a *guided* prompt (layer options +
 *               the layer's minimal example) for a fixed budget.
 *   DRIFT     — the model produced container-shaped output that drifted
 *               from the declaration domain (schema, kinds, run block,
 *               locator closure, interpretation bindings). Retry with a
 *               field-level correction that names only the offending
 *               entry fields + the registered id table.
 *   ESCAPE    — the model tried to smuggle something the harness owns or
 *               cannot know (W1 impossible fields / input-asset domain /
 *               re-declared registered ids). Zero budget: any ESCAPE
 *               refusal fails the run on the first attempt — retrying an
 *               escape would be a second chance at the same prohibition
 *               (W4 attack 1).
 *   RUN       — the code run / capture environment failed after the
 *               container was admitted. Existing retry ceiling.
 *   TRANSPORT — provider/transport faults. Existing backoff retry.
 *
 * NONE exhaustion records a failure AND lowers the protocol tier (T1 →
 * T2 → T3): the harness stops expecting full declarations from a model
 * that never produces containers, and the tier ledger feeds W2/W3.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/probe
 */

/** The five W4 failure classes. */
export type FailureClass = 'NONE' | 'DRIFT' | 'ESCAPE' | 'RUN' | 'TRANSPORT'

/** NONE is not a refusal — it gets this many guided retries (W-B). */
export const NONE_RETRY_BUDGET = 2
/** ESCAPE is a hard refusal: no retry budget exists (W-B). */
export const ESCAPE_RETRY_BUDGET = 0

/** T1 full-declaration and the degradation chain it falls back through. */
export type Tier = 'T1' | 'T2' | 'T3'
export const TIER_ORDER: ReadonlyArray<Tier> = ['T1', 'T2', 'T3']

/** The registered asset ids the harness owns; the model references, never
 *  declares (the W1 reserved set, mirrored here for the guidance text). */
export const REGISTERED_ID_TABLE: ReadonlyArray<string> = [
  'DA-RAW · DataArtifact · the raw problem bytes (harness-registered)',
  'R-OUT · RequirementSpec · the REQUIRED_OUTPUT (harness-registered)',
  'P1 · ProblemSpec · the problem binding (harness-registered)',
]

/** W1 domain prohibitions: retrying them is impossible by construction. */
const ESCAPE_CODES: ReadonlySet<string> = new Set([
  'hash_field_forbidden',        // F-A: a hash of bytes that do not exist yet
  'input_asset_domain',          // W-C: ProblemSpec/RequirementSpec are harness assets
  'registered_id_redeclared',    // W-C: a harness-registered id is re-declared
])

/**
 * Declaration-domain violations: the model produced container-shaped JSON
 * whose structure drifted from the protocol (schema, kinds, run block,
 * locator closure, interpretation bindings). `parse_failed` is split at
 * runtime: non-JSON/prose is NONE, JSON-but-malformed is DRIFT.
 */
const DRIFT_CODES: ReadonlySet<string> = new Set([
  'parse_failed',
  'schema_violation',
  'execution_record_forbidden',
  'kind_not_producible',
  'conflicting_id',
  'store_refused',
  'PRODUCE_RUN_DECLARATION_INVALID',
  'PRODUCE_CHAIN_NO_MODEL',
  'OUTPUT_ARTIFACT_LOCATOR_INVALID',
  'INTERPRETATION_SOURCE_INVALID',
  'interpretation_invalid',
  'claim_binding_unknown',
  'result_source_invalid',
  'result_source_missing',
])

/** Code-run / capture-environment failures after container admission. */
const RUN_CODES: ReadonlySet<string> = new Set([
  'CODE_RUN_NOT_CONFIGURED',
  'RECORD_INVALID',
  'record_schema_violation',
  'record_commit_refused',
  'run_declaration_refused',
  'run_missing',
  'OUTPUT_ARTIFACT_REFUSED',
])

/** A prose/absent output is NONE; only a JSON object can be a DRIFT. */
function parsesToObject(text: string | undefined): boolean {
  if (text === undefined || text.length === 0) return false
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * Classify one failure into the five W4 classes.
 * @param code - the producer/executor/provider failure code.
 * @param text - the raw output that provoked the failure (only NONE vs
 *        DRIFT on `parse_failed` needs it; every other code is exact).
 */
export function failureClassOf(code: string, text?: string): FailureClass {
  if (ESCAPE_CODES.has(code)) return 'ESCAPE'
  if (DRIFT_CODES.has(code)) {
    // Not-JSON / not-an-object = the model did not attempt a container at
    // all (NONE); JSON-but-malformed = it did, and drifted (DRIFT).
    if (code === 'parse_failed' && !parsesToObject(text)) return 'NONE'
    return 'DRIFT'
  }
  if (RUN_CODES.has(code)) return 'RUN'
  return 'TRANSPORT'
}

/** The NONE retry budget, as a policy the executor can pass around. */
export function noneBudgetPolicy(): { readonly granted: number } {
  return { granted: NONE_RETRY_BUDGET }
}

/** Degrade one protocol tier to the next; the deepest tier stays put. */
export function degradeTier(tier: Tier): Tier {
  const index = TIER_ORDER.indexOf(tier)
  if (index < 0 || index >= TIER_ORDER.length - 1) return tier
  return TIER_ORDER[index + 1] as Tier
}

/** Every run starts at the full-declaration tier (T1). */
export function initialTier(): Tier {
  return 'T1'
}

/**
 * The guided segment appended on a NONE retry: the layer's options + its
 * minimal example. The model gets a working container to imitate, never a
 * demand to invent structure (W-B: NONE ≠ 错 — show, don't blame).
 */
export function noneGuide(): string {
  return [
    'RETRY GUIDANCE — your previous output was not an ir-container-v1. This is not a refusal: produce EXACTLY ONE ir-container-v1 JSON object and nothing else (no prose, no markdown fences).',
    'You may declare ONLY these kinds: SymbolSpec, ModelSpec, DataArtifact (the output-pointer form {"data_id","locator"}).',
    'Harness-registered ids you must REFERENCE, never declare: DA-RAW, R-OUT, P1.',
    'Minimal example that satisfies the protocol:',
    '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"SymbolSpec","value":{"symbol_id":"SYM-q","scope_ref":"P1","token":"q","meaning":"mean ice thickness","unit":"m","role":"VARIABLE"}},{"kind":"ModelSpec","value":{"model_id":"M1","problem_refs":["P1"],"assumptions":["homogeneous slab"],"variable_refs":["SYM-q"],"parameter_refs":[],"equations":["q = measured"],"constraints":[],"objective":"estimate mean ice thickness","dependencies":[]}}],"code":"const fs=require(\\"node:fs\\");const r={mean_thickness:0.731};fs.writeFileSync(\\"result.json\\",JSON.stringify(r));","run":{"outputBasenames":["result.json"],"seed":20260903},"interpretations":{"results":[{"result_id":"RES-OUT","name":"mean ice thickness","source":{"locator":"result.json","jsonPath":"mean_thickness"},"unit":"m"}],"claims":[{"claim_id":"C-OUT","text":"mean ice thickness is 0.731 m","claim_type":"NUMERIC","criticality":"CRITICAL","result_refs":["RES-OUT"],"model_refs":["M1"],"evidence_refs":["RES-OUT"]}]},"narrative":{"title":"Polar ice","conclusion":"Mean ice thickness is 0.731 m."}}',
  ].join('\n')
}

/**
 * The field-level correction appended on a DRIFT retry: name ONLY the
 * offending entry fields (the producer's reason carries the exact zod
 * path) plus the registered id table. The model fixes that field, not the
 * whole container.
 */
export function driftCorrection(reason: string): string {
  const offending = reason.split('\n')[0]?.slice(0, 280) ?? reason.slice(0, 280)
  return [
    'RETRY GUIDANCE — your container was close but drifted from the declaration domain.',
    `The refusal names exactly the offending part: ${offending}`,
    'Fix ONLY that field. Do not rewrite the rest of the container.',
    'Harness-registered ids you must REFERENCE, never declare: DA-RAW, R-OUT, P1.',
  ].join('\n')
}
