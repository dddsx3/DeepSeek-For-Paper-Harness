/**
 * P1-3 — numeric_consistency gate v0.1.
 *
 * The claim-evidence semantic guards (value/unit equality, role binding,
 * D-001..D-013) are the single source of numeric truth. This module walks
 * the canonical store's NUMERIC Claims and runs those guards with the store
 * as resolver; any finding is an inconsistency the delivery gate must block
 * on. R1-3 (frozen in 5.0-R): comparison is EXACT — no tolerance layer and
 * no unit registry yet (4.4 territory, P3). `numericValuesEqual` is
 * `a === b`; the guard re-checks it against the resolved Result.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery
 */

import type { IrObjectRecord } from '../ir/store.ts'
import { resolverFromStore, validateClaimEvidence } from '../ir/claim-evidence.ts'

export interface NumericConsistencyFinding {
  readonly claimId: string
  readonly kind: string
  readonly path: string
  readonly reason: string
}

/** Every NUMERIC claim is checked; a claim with no problems contributes
 *  nothing. A store without claims (pre-P1 data) yields an empty list —
 *  vacuously consistent, which is the honest reading of "no claim to
 *  check". */
export function numericConsistencyFindings(
  store: ReadonlyMap<string, IrObjectRecord>,
): ReadonlyArray<NumericConsistencyFinding> {
  const resolve = resolverFromStore(store)
  const findings: NumericConsistencyFinding[] = []
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as { claim_type?: string; claim_id?: string }
    if (claim.claim_type !== 'NUMERIC') continue
    for (const failure of validateClaimEvidence(record.value as Record<string, unknown>, resolve)) {
      findings.push({
        claimId: String(claim.claim_id ?? '?'),
        kind: failure.kind,
        path: failure.path,
        reason: failure.reason,
      })
    }
  }
  return findings
}
