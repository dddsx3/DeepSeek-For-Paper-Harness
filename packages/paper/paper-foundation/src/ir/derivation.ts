/**
 * Derived indexes over the canonical store (TASK-T1 Sprint 2, REF-001/005).
 *
 * Expert plan §1.1 froze the canonical rule: **a canonical object never
 * carries a back-reference the store can derive** (REF-001). EquationSpec
 * therefore has no `model_ref` — "which models use this equation" is a
 * *query over* `ModelSpec.equation_refs`, not a fact an object owns
 * (REF-005). This module is that query: reverse lookup built from a
 * canonical snapshot on every call.
 *
 * The three invariants that keep a derived index from becoming a second
 * source of truth:
 *
 *   1. **Derived, never stored.** No function here mutates or attaches to
 *      the store; the index is recomputed from the snapshot each call.
 *      Nothing derived ever enters an object hash, a freeze manifest, or
 *      the canonical `ModelingIr` state.
 *   2. **A pure function of canonical state.** Same store contents ⇒
 *      same index, byte for byte (acceptance test REF-A4).
 *   3. **No observable influence on canonical data.** Whether a caller has
 *      built the index or not cannot change any fingerprint (acceptance
 *      test REF-A5) — the freeze hashes objects, and objects cannot see
 *      this module.
 *
 * @module packages/paper/paper-foundation/src/ir/derivation
 */

import type { IrObjectRecord } from './store.ts'

/** Sorted-in-ingest-order id list of the models referencing `equationId`. */
export type EquationModelIndex = ReadonlyMap<string, ReadonlyArray<string>>

/**
 * `models_by_equation[equation_id] -> ModelSpec ids` (expert plan §1.1).
 *
 * Walks every `ModelSpec` in the snapshot and groups the models by each
 * equation they reference. The result is derived data: recomputed on every
 * call, never cached in canonical state, and never part of any object's
 * serialized bytes. An equation no model references simply has no entry —
 * absence is not a fact, it is a query result.
 *
 * Deterministic: value arrays follow snapshot iteration order (ingest
 * order), and the returned map is a plain snapshot of that walk. Total:
 * never throws on any `ReadonlyMap` of `IrObjectRecord`.
 */
export function modelsByEquation(store: ReadonlyMap<string, IrObjectRecord>): EquationModelIndex {
  const index = new Map<string, string[]>()
  for (const record of store.values()) {
    if (record.kind !== 'ModelSpec') continue
    const refs = (record.value as { equation_refs?: ReadonlyArray<string> }).equation_refs
    if (refs === undefined) continue
    for (const equationId of refs) {
      const bucket = index.get(equationId)
      if (bucket === undefined) {
        index.set(equationId, [record.id])
      } else {
        bucket.push(record.id)
      }
    }
  }
  return index
}
