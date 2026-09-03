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

import { ModelingIr } from '../ir/store.ts'
import { IR_SCHEMAS } from '../ir/schema.ts'
import { readIrObjectId, type IrKind } from '../ir/index.ts'

/** Protocol marker + version of the model EXECUTE output container. */
export const MODEL_CONTAINER = '__dsh_paper'
export const MODEL_CONTAINER_VERSION = 'ir-container-v1'

/**
 * IR kinds the EXECUTE-stage model may declare. Everything else it claims
 * to be IR is refused with a stable code (see below).
 */
export const PRODUCIBLE_KINDS: ReadonlyArray<IrKind> = [
  'DataArtifact',
  'RequirementSpec',
  'SymbolSpec',
  'ProblemSpec',
  'ModelSpec',
]

/** Stable refusal codes a caller (the executor) routes on. */
export type ProduceFailureCode =
  | 'parse_failed'               // not JSON, or not a container object
  | 'schema_violation'           // any entry failed its closed IR schema
  | 'execution_record_forbidden' // model tried to smuggle an ExecutionRecord (INV-3-M)
  | 'kind_not_producible'        // RunArtifact/Result/Claim/… come from real stages, not the model
  | 'conflicting_id'             // duplicate of an id already in the store (append-only semantics)
  | 'store_refused'              // the store's own admission (incl. 1.5R closure) refused an entry

export type ProduceVerdict =
  | { ok: true; entries: ReadonlyArray<{ kind: IrKind; id: string }> }
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
  }
  return { ok: true, container: container as ValidatedContainer }
}

/**
 * Validate every entry against its closed IR schema (dry), then write the
 * whole container through the store's public put path. All-or-nothing: no
 * write happens unless every entry validates AND every put succeeds.
 *
 * @param ir - the canonical store to write into.
 * @param text - raw model EXECUTE output.
 * @param onEntry - called once per accepted write (kind, id) so the caller
 *        can audit the IR evolution entry by entry.
 */
export function produceContainerInto(
  ir: ModelingIr,
  text: string,
  onEntry?: (kind: IrKind, id: string) => void,
): ProduceVerdict {
  const parsed = parseModelContainer(text)
  if (!parsed.ok) return parsed
  const { container } = parsed

  // Pass 1 — kind whitelist + closed-schema dry validation (no writes yet).
  const validated: ModelEntry[] = []
  for (const entry of container.entries) {
    if (entry.kind === 'ExecutionRecord') {
      return {
        ok: false,
        code: 'execution_record_forbidden',
        reason: "an ExecutionRecord cannot ride in a model container: the only legal door is putExecutionRecord(record, CAPTURE_ATTESTATION) (INV-3-M)",
      }
    }
    if (!PRODUCIBLE_KINDS.includes(entry.kind as IrKind)) {
      return {
        ok: false,
        code: 'kind_not_producible',
        reason: `kind '${entry.kind}' is not producible by the EXECUTE model (P1-1 whitelist: ${PRODUCIBLE_KINDS.join(', ')}); it belongs to the execution-capture or downstream stages`,
      }
    }
    const kind = entry.kind as IrKind
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
  return { ok: true, entries: written }
}
