/**
 * P1-1 — structured-output producer (typed-JSON -> IR, the ONLY production
 * writer of the model-declared kinds).
 *
 * The EXECUTE-stage model output is a typed-JSON *container*: canonical IR
 * records the model is allowed to declare plus two non-IR payload fields
 * (code text, narrative). The producer validates everything with the SAME
 * closed zod schemas the store admits with (IR_SCHEMAS — one schema, one
 * meaning, INV-1.5-F), then writes through the store's public put paths.
 *
 * What the model may NEVER produce here:
 *   - ExecutionRecord  — producer_required (INV-3-M); only the capture
 *                        module's `putExecutionRecord(…, CAPTURE_ATTESTATION)`
 *                        door admits one.
 *   - RunArtifact / Result / Claim / VerificationResult / FigureSpec /
 *     ReviewerFinding — produced by the execution-capture and downstream
 *     stages (P1-2/P1-3 and the reviewer), never invented by the model.
 *     FigureSpec stays closed until P2.
 *
 * Failure is all-or-nothing: every entry is validated (dry) before the
 * first write, so a rejected container cannot leave half a chain in the
 * store (no partial trees — DISCIPLINE D12). Schema errors carry the zod
 * path, never a swallowed reason.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce
 */

import { z as zod } from 'zod'
import { ModelingIr } from '../ir/store.ts'
import { IR_SCHEMAS } from '../ir/schema.ts'
import { readIrObjectId, type IrKind } from '../ir/index.ts'

/** Protocol marker + version of the model EXECUTE output container. */
export const MODEL_CONTAINER = '__dsh_paper'
export const MODEL_CONTAINER_VERSION = 'ir-container-v1'

/**
 * IR kinds the EXECUTE-stage model may declare. Everything else it claims
 * to be IR is refused with a stable code (see below).
 *
 * TASK-PW W1 (W-C sign-off A, input-asset externalization): the problem-side
 * kinds moved OUT of the model's declaration domain —
 *   - `ProblemSpec`, `RequirementSpec`: harness-registered before the
 *     container is applied (the harness owns the problem statement and the
 *     requirement; the model references them by id);
 *   - `DataArtifact`: stays declarable but ONLY in its output-pointer form
 *     `{ data_id, locator }` — no `content_hash` (the harness computes every
 *     hash over real bytes after the run — the impossible-field rule, audit
 *     finding F-A), no `role`/`media_type`/`description` (harness-assigned).
 * Re-declaring a harness-registered id is a declaration refusal, not an
 * append-only conflict (the teaching makes the domain unreachable up front).
 */
export const MODEL_FACE_KINDS: ReadonlyArray<IrKind> = [
  'SymbolSpec',
  'ModelSpec',
  'DataArtifact',
] as const

/** Kinds the harness registers itself; the model face refuses them. */
export const HARNESS_REGISTERED_KINDS: ReadonlyArray<IrKind> = [
  'DataArtifact',
  'RequirementSpec',
  'ProblemSpec',
]

/**
 * The model-face DataArtifact shape: an output pointer and nothing else.
 * Deliberately NOT the full IR DataArtifact schema — `content_hash` (the
 * sha256 of bytes that do not exist until the run) is the impossible field
 * this schema exists to keep out of the model's declaration domain.
 */
export const modelOutputArtifactSchema = zod
  .object({
    data_id: zod.string().min(1),
    /** Run output basename the harness will hash after the run. */
    locator: zod.string().min(1),
  })
  .strict()

/** Stable refusal codes a caller (the executor) routes on. */
export type ProduceFailureCode =
  | 'parse_failed'               // not JSON, or not a container object
  | 'schema_violation'           // any entry failed its closed IR schema
  | 'execution_record_forbidden' // model tried to smuggle an ExecutionRecord (INV-3-M)
  | 'kind_not_producible'        // RunArtifact/Result/Claim/… come from real stages, not the model
  | 'input_asset_domain'         // W1: ProblemSpec/RequirementSpec are harness-registered, not model-declarable
  | 'hash_field_forbidden'       // W1: content_hash is the impossible field (F-A) — never model-writable
  | 'registered_id_redeclared'   // W1: the model re-declared a harness-registered id
  | 'conflicting_id'             // duplicate of an id already in the store (append-only semantics)
  | 'store_refused'              // the store's own admission (incl. 1.5R closure) refused an entry

export type ProduceVerdict =
  | {
    ok: true
    entries: ReadonlyArray<{ kind: IrKind; id: string }>
    /**
       * W1: model-declared output artifacts, carried out of admission
       * UNWRITTEN — the harness mints their full IR records after the run,
       * with sha256 computed over the real captured bytes (the impossible
       * field never passes through the model's hands).
       */
    pendingOutputArtifacts: ReadonlyArray<{ data_id: string; locator: string }>
  }
  | { ok: false; code: ProduceFailureCode; reason: string }

interface ModelEntry {
  readonly kind: string
  readonly value: Record<string, unknown>
}

/** The model-side container: marker + canonical entries + payloads. */
export interface ModelContainer {
  readonly __dsh_paper: typeof MODEL_CONTAINER_VERSION
  readonly entries: ReadonlyArray<ModelEntry>
  /** Executable code text for the run the model is proposing (P1-2 consumes). */
  readonly code?: string
  /** Free-prose narration bound for the v1 template report (P1-3 renders). */
  readonly narrative?: Record<string, unknown>
  /**
   * P1-3 — how to turn the run's REAL outputs into canonical Result/Claim
   * records. The model declares *structure* (which file+json path carries a
   * quantity, what unit it is) but never the numbers themselves — values are
   * read from the executed output bytes, so the digits only ever flow IR →
   * Result → Claim (INV-2-A/B). Raw passthrough; shape is the producer's
   * `interpretationSchema`.
   */
  readonly interpretations?: Record<string, unknown>
  /**
   * P1-2 — the run the model's code proposes: output file basenames the
   * runner must collect and their canonical locators (same order). Raw
   * passthrough; consumed by the execution-capture composition.
   */
  readonly run?: Record<string, unknown>
}

/** A container with every entry's schema already checked (dry pass). */
type ValidatedContainer = ModelContainer & { entries: ReadonlyArray<ModelEntry & { kind: IrKind }> }

/** Parse raw model text into a container, refusing non-container shapes. */
export function parseModelContainer(text: string): { ok: true; container: ValidatedContainer } | { ok: false; code: 'parse_failed'; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, code: 'parse_failed', reason: `model output is not JSON: ${String(error).split('\n')[0]}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'parse_failed', reason: 'model output is not a JSON object' }
  }
  const raw = parsed as Record<string, unknown>
  if (raw[MODEL_CONTAINER] !== MODEL_CONTAINER_VERSION) {
    return {
      ok: false,
      code: 'parse_failed',
      reason: `model output is not an ${MODEL_CONTAINER_VERSION} container (missing '${MODEL_CONTAINER}': '${MODEL_CONTAINER_VERSION}')`,
    }
  }
  const entriesRaw = raw['entries']
  if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
    return { ok: false, code: 'parse_failed', reason: "container 'entries' must be a non-empty array of { kind, value }" }
  }
  const entries: ModelEntry[] = []
  for (const item of entriesRaw) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, code: 'parse_failed', reason: 'an entry is not an object' }
    }
    const entry = item as Record<string, unknown>
    if (typeof entry['kind'] !== 'string' || typeof entry['value'] !== 'object' || entry['value'] === null) {
      return { ok: false, code: 'parse_failed', reason: "an entry lacks 'kind' (string) or 'value' (object)" }
    }
    entries.push({ kind: entry['kind'] as string, value: entry['value'] as Record<string, unknown> })
  }
  const container: ModelContainer = {
    __dsh_paper: MODEL_CONTAINER_VERSION,
    entries,
    ...(typeof raw['code'] === 'string' ? { code: raw['code'] as string } : {}),
    ...(typeof raw['narrative'] === 'object' && raw['narrative'] !== null ? { narrative: raw['narrative'] as Record<string, unknown> } : {}),
    ...(typeof raw['interpretations'] === 'object' && raw['interpretations'] !== null ? { interpretations: raw['interpretations'] as Record<string, unknown> } : {}),
    ...(typeof raw['run'] === 'object' && raw['run'] !== null ? { run: raw['run'] as Record<string, unknown> } : {}),
  }
  return { ok: true, container: container as ValidatedContainer }
}

/**
 * Validate every entry against the model face (dry), then write the
 * writable entries through the store's public put path. All-or-nothing: no
 * write happens unless every entry validates AND every put succeeds.
 *
 * W1 domain rules (W-C sign-off A):
 *   - `ProblemSpec` / `RequirementSpec` entries are refused outright — the
 *     harness registers the problem assets; the model only references ids.
 *   - `DataArtifact` entries carry the output-pointer shape only; they are
 *     validated and returned as `pendingOutputArtifacts` (never written at
 *     admission — the hash does not exist yet).
 *   - Any entry whose id is in `opts.reservedIds` (the harness-registered
 *     id set) is a re-declaration of a harness asset → refusal.
 *
 * @param ir - the canonical store to write into.
 * @param text - raw model EXECUTE output.
 * @param onEntry - called once per accepted write (kind, id) so the caller
 *        can audit the IR evolution entry by entry.
 * @param opts - W1 domain controls: `reservedIds` is the set of
 *        harness-registered ids the model must reference, never re-declare.
 */
export function produceContainerInto(
  ir: ModelingIr,
  text: string,
  onEntry?: (kind: IrKind, id: string) => void,
  opts?: { reservedIds?: ReadonlySet<string> },
): ProduceVerdict {
  const parsed = parseModelContainer(text)
  if (!parsed.ok) return parsed
  const { container } = parsed
  const reserved = opts?.reservedIds

  // Pass 1 — kind whitelist + model-face validation (no writes yet).
  const validated: ModelEntry[] = []
  const pendingOutputArtifacts: Array<{ data_id: string; locator: string }> = []
  for (const entry of container.entries) {
    if (entry.kind === 'ExecutionRecord') {
      return {
        ok: false,
        code: 'execution_record_forbidden',
        reason: 'an ExecutionRecord cannot ride in a model container: the only legal door is putExecutionRecord(record, CAPTURE_ATTESTATION) (INV-3-M)',
      }
    }
    if (entry.kind === 'ProblemSpec' || entry.kind === 'RequirementSpec') {
      return {
        ok: false,
        code: 'input_asset_domain',
        reason: `kind '${entry.kind}' is harness-registered (TASK-PW W1 input-asset domain): the problem statement and requirement are the harness's assets — reference them by id (${[...HARNESS_REGISTERED_KINDS].length > 0 ? 'e.g. the registered ProblemSpec/RequirementSpec ids' : ''}); declaring them is a domain violation, not a schema error`,
      }
    }
    if (!MODEL_FACE_KINDS.includes(entry.kind as IrKind)) {
      return {
        ok: false,
        code: 'kind_not_producible',
        reason: `kind '${entry.kind}' is not producible by the EXECUTE model (model-face whitelist: ${MODEL_FACE_KINDS.join(', ')}); it belongs to the harness, the execution-capture, or downstream stages`,
      }
    }
    const kind = entry.kind as IrKind
    const valueId = typeof entry.value['data_id'] === 'string'
      ? entry.value['data_id']
      : typeof entry.value['symbol_id'] === 'string'
        ? entry.value['symbol_id']
        : typeof entry.value['model_id'] === 'string'
          ? entry.value['model_id']
          : undefined
    if (reserved !== undefined && valueId !== undefined && reserved.has(valueId)) {
      return {
        ok: false,
        code: 'registered_id_redeclared',
        reason: `entry '${kind}' re-declares '${valueId}', a harness-registered asset id (TASK-PW W1): registered assets are referenced by id, never re-declared`,
      }
    }
    if (kind === 'DataArtifact') {
      // W1 impossible-field rule: content_hash must never appear in the
      // model's declaration domain — a dedicated refusal (not a generic
      // schema error) so the correction message can name the rule.
      if (entry.value['content_hash'] !== undefined) {
        return {
          ok: false,
          code: 'hash_field_forbidden',
          reason: "a model-declared DataArtifact cannot carry 'content_hash' — the sha256 of bytes that do not exist until the run is computed by the harness over the real captured output (impossible-field rule, audit finding F-A); declare { data_id, locator } only",
        }
      }
      const faceCheck = modelOutputArtifactSchema.safeParse(entry.value)
      if (!faceCheck.success) {
        const first = faceCheck.error.issues[0]
        const at = first !== undefined
          ? first.path.length > 0 ? `${first.path.join('.')}: ` : ''
          : ''
        return {
          ok: false,
          code: 'schema_violation',
          reason: `entry 'DataArtifact' violates the model-face output-pointer schema ({ data_id, locator }) — ${at}${first?.message ?? 'invalid'}`,
        }
      }
      pendingOutputArtifacts.push({ data_id: faceCheck.data.data_id, locator: faceCheck.data.locator })
      continue
    }
    const schemaCheck = IR_SCHEMAS[kind].safeParse(entry.value)
    if (!schemaCheck.success) {
      const first = schemaCheck.error.issues[0]
      const at = first !== undefined
        ? first.path.length > 0 ? `${first.path.join('.')}: ` : ''
        : ''
      return {
        ok: false,
        code: 'schema_violation',
        reason: `entry '${kind}' violates its closed IR schema — ${at}${first?.message ?? 'invalid'}`,
      }
    }
    validated.push(entry)
  }

  // Pass 2 — write every validated entry (store admission re-checks schema
  // and the 1.5R reference closure; a refusal aborts the container).
  const written: { kind: IrKind; id: string }[] = []
  for (const entry of validated) {
    const kind = entry.kind as IrKind
    const verdict = ir.put(kind, entry.value)
    if (!verdict.accepted) {
      const failure = verdict.failures[0]
      const detail = failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused'
      const isConflict = failure?.kind === 'duplicate_id'
      return {
        ok: false,
        code: isConflict ? 'conflicting_id' : 'store_refused',
        reason: `entry '${kind}' could not be admitted: ${detail} (append-only store; a duplicate id is a conflict, not an update)`,
      }
    }
    const id = readIrObjectId(kind, entry.value)
    written.push({ kind, id })
    onEntry?.(kind, id)
  }
  return { ok: true, entries: written, pendingOutputArtifacts }
}
