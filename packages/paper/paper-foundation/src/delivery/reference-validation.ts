/**
 * P1-4 — reference_validation gate v0.1 (real).
 *
 * Walks EVERY IR object's declared reference fields (IR_REF_FIELDS, the same
 * table the store boundary enforces) and verifies each ref resolves to an
 * object of the declared target kind. A canonical ModelingIr can never hold
 * a dangling ref (the store closes references at admission, TASK 1.5R) — the
 * gate is the independent re-walk that would catch a non-canonical synthetic
 * store if one ever reached a delivery policy, and it makes the invariant
 * auditable per delivery instead of relying on admission alone.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery
 */

import type { IrObjectRecord } from '../ir/store.ts'
import { validateRefFields, type IrRefResolver } from '../ir/refs.ts'

export interface ReferenceValidationFinding {
  readonly path: string
  readonly kind: string
  readonly reason: string
}

export function referenceValidationFindings(
  store: ReadonlyMap<string, IrObjectRecord>,
): ReadonlyArray<ReferenceValidationFinding> {
  const resolve: IrRefResolver = (ref: string) => store.get(ref)?.kind
  const findings: ReferenceValidationFinding[] = []
  for (const record of store.values()) {
    for (const problem of validateRefFields(record.kind, record.value, resolve)) {
      findings.push({
        path: problem.path,
        kind: problem.resolution,
        reason: `ref '${problem.ref}' ${problem.resolution === 'missing' ? 'does not exist' : `resolves to ${problem.actual ?? 'nothing'} (expected a ${problem.target})`}`,
      })
    }
  }
  return findings
}
