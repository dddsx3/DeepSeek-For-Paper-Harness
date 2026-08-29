/**
 * Canonical Modeling IR store (TASK 1).
 *
 * The only object in the package that is allowed to hold canonical IR state.
 * Everything it stores arrived through `put()` (or `ingestJson()`, which is a
 * thin wrapper around `put()`), and `put()` applies the full pipeline the task
 * book mandates:
 *
 *     text ─▶ Parser ─▶ Typed Object ─▶ Schema Validation ─▶
 *             Reference Validation ─▶ Gate ─▶ canonical state
 *
 * Properties that make "illegal object in canonical state" unreachable:
 *
 *   - **Append-only.** There is no `delete`, no `replace`, and no `update`.
 *     A reference that resolved at ingest time can therefore never dangle
 *     later, which is why this TASK needs no staleness machinery of its own
 *     (TASK 3.5 owns mutation-driven staleness).
 *   - **Deep-frozen snapshots, frozen envelopes.** `put()` stores a
 *     recursively frozen copy inside a frozen record, so neither the input
 *     handle nor the returned record can be used to rewrite canonical state
 *     after acceptance — the classic "validate, then edit" bypass, and the
 *     "mutate `record.kind` to spoof the next kind check" bypass.
 *   - **Global ID uniqueness.** One index spans every kind: a `Result` and a
 *     `Claim` cannot both be `R1`.
 *   - **Totality.** `put()` returns a verdict for *every* input, including
 *     inputs that make an injected dependency throw. An exception escaping
 *     `put()` would be a fail-open for any caller that only inspects
 *     `accepted`.
 *   - **Fail-closed verdict.** Anything unrecognised (kind, JSON, field,
 *     reference) yields `accepted: false` plus an audit event. Nothing is
 *     coerced, defaulted, or partially inserted.
 *
 * The store's internals are ECMAScript `#private` fields, not TypeScript
 * `private`: the latter erases at compile time and leaves the backing `Map`
 * as an ordinary writable property, which is a direct injection vector
 * (red team RT2-01).
 */

import { z as zod } from 'zod'
import { parseStrictJson, scanIrValue } from './parse.ts'
import { validateRefFields, type IrRefProblem } from './refs.ts'
import {
  ID_FIELD_BY_KIND,
  IR_KINDS,
  IR_SCHEMAS,
  readIrObjectId,
  type IrKind,
  type IrObjectMap,
} from './schema.ts'

/** Closed set of reasons an ingest is refused. */
export const IR_FAILURE_KINDS = [
  'unknown_kind',
  'parse_failed',
  'malformed_value',
  'schema_invalid',
  'duplicate_id',
  'unresolved_reference',
  'reference_kind_mismatch',
  'internal_error',
] as const

export type IrFailureKind = (typeof IR_FAILURE_KINDS)[number]

export interface IrFailure {
  readonly kind: IrFailureKind
  /** Dot-path to the offending location; `'$'` for the whole document. */
  readonly path: string
  readonly reason: string
}

/** A canonical, immutable IR object together with its frozen envelope. */
export type IrObjectRecord<K extends IrKind = IrKind> = {
  readonly [P in K]: {
    /** Monotonic ingest order. */
    readonly seq: number
    readonly kind: P
    readonly id: string
    readonly value: IrObjectMap[P]
    readonly ingestedAt: string
  }
}[K]

export type IrIngestVerdict<K extends IrKind = IrKind> =
  | { readonly accepted: true; readonly record: IrObjectRecord<K> }
  | { readonly accepted: false; readonly failures: ReadonlyArray<IrFailure> }

export type IrAuditEventType = 'ir_ingest_accepted' | 'ir_ingest_blocked'

export interface IrAuditEvent {
  readonly type: IrAuditEventType
  readonly at: string
  readonly kind: string
  /** `null` when the object never got far enough to have a readable ID. */
  readonly id: string | null
  readonly failures: ReadonlyArray<IrFailure>
}

export interface ModelingIrOptions {
  /** Receives one event per ingest attempt, accepted or blocked. */
  readonly audit?: (event: IrAuditEvent) => void
  readonly now?: () => string
}

export class ModelingIr {
  // ECMAScript private fields: genuinely unreachable from outside, unlike
  // TypeScript's `private` (red team RT2-01).
  #objects = new Map<string, IrObjectRecord>()
  #seq = 0
  #audit: (event: IrAuditEvent) => void
  #now: () => string

  constructor(options: ModelingIrOptions = {}) {
    this.#audit = options.audit ?? (() => {})
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  /** Number of canonical objects. */
  get size(): number {
    return this.#objects.size
  }

  /** Whether `id` is registered. */
  has(id: string): boolean {
    return this.#objects.has(id)
  }

  /** The kind `id` was registered as, or `undefined`. */
  kindOf(id: string): IrKind | undefined {
    return this.#objects.get(id)?.kind
  }

  /** The canonical record for `id`. Both the record and its `value` are
   *  deep-frozen, so the caller cannot rewrite canonical state. */
  get(id: string): IrObjectRecord | undefined {
    return this.#objects.get(id)
  }

  /** Every canonical record, in ingest order. */
  list(): ReadonlyArray<IrObjectRecord> {
    return [...this.#objects.values()]
  }

  /**
   * Ingest model-generated JSON text. Strict parse first; a parse failure is
   * terminal. Asking the model to regenerate and passing the *new* text back
   * through this method is the supported recovery — repairing the rejected
   * text is not, and no code path here does it.
   */
  ingestJson<K extends IrKind>(kind: K, text: unknown): IrIngestVerdict<K> {
    const parsed = parseStrictJson(text)
    if (!parsed.ok) {
      return this.#refuse(kind, null, [
        { kind: 'parse_failed', path: '$', reason: parsed.reason },
      ])
    }
    return this.put(kind, parsed.value)
  }

  /**
   * The single mutation entry point. Validates, then either commits one
   * frozen record or refuses with every failure it found.
   *
   * Total: never throws. Any internal fault (a hostile `kind` whose
   * `toString` throws, a throwing clock, a throwing audit sink) is reported
   * as `internal_error` rather than escaping as an exception.
   */
  put<K extends IrKind>(kind: K, value: unknown): IrIngestVerdict<K> {
    try {
      return this.#admit(kind, value)
    } catch (error) {
      return this.#refuse(kind, bestEffortId(kind, value), [
        { kind: 'internal_error', path: '$', reason: describeError(error) },
      ])
    }
  }

  #admit<K extends IrKind>(kind: K, value: unknown): IrIngestVerdict<K> {
    if (!IR_KINDS.includes(kind)) {
      return this.#refuse(kind, bestEffortId(kind, value), [
        { kind: 'unknown_kind', path: '$', reason: `unknown IR kind: ${describeKind(kind)}` },
      ])
    }

    // The typed path needs the same structural hardening as the text path:
    // without it, identical bytes are refused by `ingestJson` and accepted by
    // `put`, which is a fail-open by inconsistency (RT2-03 / RT3-05).
    const scan = scanIrValue(value)
    if (scan !== 'clean') {
      return this.#refuse(kind, null, [
        { kind: 'malformed_value', path: '$', reason: scan },
      ])
    }

    const parsed = IR_SCHEMAS[kind].safeParse(value)
    if (!parsed.success) {
      return this.#refuse(
        kind,
        bestEffortId(kind, value),
        parsed.error.issues.map(issue => toSchemaFailure(issue)),
      )
    }

    const id = readIrObjectId(kind, parsed.data)
    const failures: IrFailure[] = []

    const existing = this.#objects.get(id)
    if (existing !== undefined) {
      failures.push({
        kind: 'duplicate_id',
        // The schema of `kind` always declares an id field (asserted by the
        // schema tests), so the field name is guaranteed present.
        path: ID_FIELD_BY_KIND[kind] as string,
        reason: `id '${id}' is already registered as ${existing.kind}`,
      })
    }

    for (const problem of validateRefFields(kind, parsed.data, ref => this.#objects.get(ref)?.kind)) {
      failures.push(toRefFailure(problem))
    }

    if (failures.length > 0) {
      return this.#refuse(kind, id, failures)
    }

    const at = this.#now()
    const record = Object.freeze({
      seq: this.#seq,
      kind,
      id,
      value: freezeSnapshot(parsed.data) as IrObjectMap[K],
      ingestedAt: at,
    }) as IrObjectRecord<K>

    // Audit BEFORE commit: an audit sink that throws must not leave an
    // accepted object in canonical state with no record that it arrived.
    this.#audit({ type: 'ir_ingest_accepted', at, kind, id, failures: [] })
    // `IrObjectRecord<K>` for a generic K is not seen by TS as assignable to
    // the stored union type, though structurally it is one of its members;
    // the cast is the point where the union widens.
    this.#objects.set(id, record as IrObjectRecord)
    this.#seq += 1
    return { accepted: true, record }
  }

  #refuse<K extends IrKind>(
    kind: K,
    id: string | null,
    failures: ReadonlyArray<IrFailure>,
  ): IrIngestVerdict<K> {
    try {
      this.#audit({
        type: 'ir_ingest_blocked',
        at: this.#now(),
        kind: describeKind(kind),
        id,
        failures,
      })
    } catch {
      // A throwing audit sink cannot turn a refusal into an acceptance. The
      // object is refused either way; losing the event is the lesser failure.
    }
    return { accepted: false, failures }
  }
}

// Freeze the class and its prototype. Otherwise `ModelingIr.prototype.put`
// can be reassigned once and every instance — present and future — silently
// routes through the attacker's function while `get`/`list`/`has` keep
// answering truthfully (red team RT3-02).
Object.freeze(ModelingIr)
Object.freeze(ModelingIr.prototype)

/**
 * A missing required field surfaces as zod `invalid_type` whose message ends
 * in `received undefined`; `path` is then exactly the absent field. That is
 * what IR-006 / IR-008 / IR-009 assert on, so the message text is load-bearing
 * and `ir.spec.ts` pins the exact string this classification depends on.
 */
function toSchemaFailure(issue: zod.core.$ZodIssue): IrFailure {
  const path = issue.path.length === 0 ? '$' : issue.path.map(String).join('.')
  return { kind: 'schema_invalid', path, reason: `${issue.code}: ${issue.message}` }
}

function toRefFailure(problem: IrRefProblem): IrFailure {
  const expected = problem.target === 'ANY' ? 'any registered object' : problem.target
  return {
    kind: problem.resolution === 'missing' ? 'unresolved_reference' : 'reference_kind_mismatch',
    path: problem.path,
    reason: problem.resolution === 'missing'
      ? `'${problem.ref}' is not registered (expected ${expected})`
      : `'${problem.ref}' resolves to ${problem.actual}, expected ${expected}`,
  }
}

/**
 * Render `kind` for an audit message without ever calling user code.
 * `String(kind)` would invoke an attacker-supplied `toString`.
 */
function describeKind(kind: unknown): string {
  return typeof kind === 'string' ? kind : `<${typeof kind}>`
}

/** `String(error)` can itself throw on a hostile throwable; don't. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'non-Error throw'
}

/**
 * Best-effort ID for a refusal that happened before validation succeeded, so
 * repeated bad emissions of the same object can be correlated in the audit
 * trail instead of all reporting `id: null` (red team RT2-07).
 */
function bestEffortId(kind: unknown, value: unknown): string | null {
  if (typeof kind !== 'string') return null
  const field = ID_FIELD_BY_KIND[kind as IrKind]
  if (field === undefined) return null
  if (value === null || typeof value !== 'object') return null
  const id = (value as Record<string, unknown>)[field]
  return typeof id === 'string' ? id : null
}

/**
 * Deep-copy and deep-freeze a validated IR value.
 *
 * Hand-rolled instead of `structuredClone` so it cannot throw on a value the
 * schema already accepted, and so the result is frozen at every level —
 * `Object.freeze` alone would leave nested arrays and objects writable.
 */
function freezeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => freezeSnapshot(item)))
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    copy[key] = freezeSnapshot(source[key])
  }
  return Object.freeze(copy)
}
