/**
 * Strict value ingress for the Modeling IR (TASK 1).
 *
 * This module is the *only* bridge from model text to typed IR, and it
 * deliberately has no repair path. Task book §7 forbids the sequence
 *
 *     model emits invalid JSON → call another LLM to guess the intent →
 *     auto-fix it → treat the repaired value as canonical
 *
 * so there is exactly one outcome for unparseable text: `ok: false`. The
 * caller may ask the model to *regenerate* and hand the new text back through
 * this same function. Regeneration is a new input; repair is a mutation of a
 * rejected one, and only the former is reachable here.
 *
 * `scanIrValue` is exported separately because the typed `put()` path needs the
 * same guarantees: without it, identical bytes would be refused via
 * `ingestJson()` and accepted via `put()`, which is a fail-open by
 * inconsistency (red team RT2-03 / RT3-05).
 */

/** Keys that must never appear in IR data. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Maximum object-graph depth accepted. Anything deeper is rejected: it is not
 * a legal IR value (every IR schema is shallow) and bounding the walk keeps a
 * hostile payload from driving the recursion.
 */
export const MAX_IR_JSON_DEPTH = 64

/**
 * Maximum ingress size in characters, enforced *before* `JSON.parse`.
 *
 * Without this the depth cap is decorative: `JSON.parse` runs first, so a
 * multi-megabyte deeply-nested payload is fully materialised before anything
 * can refuse it, and the process dies of heap exhaustion instead of returning
 * a verdict (red team RT1-02). The cap also bounds the cost of every
 * subsequent pass to O(n) in a known-small n.
 */
export const MAX_IR_JSON_CHARS = 1_048_576

export type StrictJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: StrictJsonFailureReason }

export type StrictJsonFailureReason =
  | 'input_not_a_string'
  | 'empty_or_blank_input'
  | 'input_too_large'
  | 'json_parse_error'

/**
 * Parse `input` as JSON without repairing it.
 *
 * @returns the parsed value, or a closed failure reason. Never throws.
 */
export function parseStrictJson(input: unknown): StrictJsonResult {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'input_not_a_string' }
  }
  if (input.trim().length === 0) {
    return { ok: false, reason: 'empty_or_blank_input' }
  }
  if (input.length > MAX_IR_JSON_CHARS) {
    return { ok: false, reason: 'input_too_large' }
  }

  let value: unknown
  try {
    value = JSON.parse(input) as unknown
  } catch {
    return { ok: false, reason: 'json_parse_error' }
  }

  return { ok: true, value }
}

/**
 * Why a parsed value is unsafe to admit, even if a schema would accept it.
 *
 * `inherited_key` matters because zod v4's `.strict()` walks the prototype
 * chain in both directions: a polluted `Object.prototype` makes *every* ingest
 * fail with "unrecognized key", and an object inheriting all of a schema's
 * required fields passes that schema while being literally `{}` (red team
 * RT3-03). `symbol_key` matters because `Object.keys` never sees symbol keys,
 * so a value can validate, then silently lose data on the way into the store.
 */
export type ScanVerdict =
  | 'clean'
  | 'forbidden_key'
  | 'too_deep'
  | 'inherited_key'
  | 'symbol_key'
  | 'accessor_key'

/**
 * Reject a value that is structurally unsafe for canonical state.
 *
 * Runs on already-parsed data, so it guards the typed `put()` path as well as
 * the text path. Never throws.
 */
export function scanIrValue(value: unknown, depth = 0): ScanVerdict {
  if (depth > MAX_IR_JSON_DEPTH) return 'too_deep'

  if (Array.isArray(value)) {
    for (const key in value) {
      if (!Object.hasOwn(value, key)) return 'inherited_key'
    }
    for (const item of value) {
      const verdict = scanIrValue(item, depth + 1)
      if (verdict !== 'clean') return verdict
    }
    return 'clean'
  }

  if (value === null || typeof value !== 'object') return 'clean'

  const record = value as Record<string, unknown>
  if (Object.getOwnPropertySymbols(record).length > 0) return 'symbol_key'
  for (const key in record) {
    if (!Object.hasOwn(record, key)) return 'inherited_key'
  }
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key)) return 'forbidden_key'
    // Reading `record[key]` invokes a getter. Refuse accessors outright:
    // JSON cannot produce them, so one here is either a TOCTOU probe or a
    // throw-on-read payload, and refusing keeps `scanIrValue` total.
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (descriptor?.get !== undefined || descriptor?.set !== undefined) return 'accessor_key'
    const verdict = scanIrValue(record[key], depth + 1)
    if (verdict !== 'clean') return verdict
  }
  return 'clean'
}
