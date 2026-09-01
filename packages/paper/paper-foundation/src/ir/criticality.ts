/**
 * Deterministic criticality classifier (TASK 3 repair 3.R1 / INV-3-I/J).
 *
 * The classifier holds the *final* verdict on a Claim's criticality;
 * a producer-declared value can be MORE STRICT than the classifier's
 * call (CRITICAL > NON_CRITICAL), but never LESS. The store boundary
 * enforces this — see `IR_KIND_INVARIANT_KIND_OVERRIDE` in `store.ts`.
 *
 * Why deterministic (rule-based, no model capability):
 *   - INV-3-J: a model-supplied classifier would re-introduce the same
 *     "frontier defined by the constrained party" escape we are closing.
 *   - The task book v1.1 boundary is explicit: classifier = "reduces
 *     escape freedom"; model = "increases capability". The v1.1 review
 *     of this design rejected a semantic model in favor of two hard
 *     rules. More rules belong in their own v1.2 proposal.
 *
 * Hard rules (v1.1):
 *   R1. A Claim carrying a `numeric_binding` is CRITICAL.
 *   R2. A Claim is CRITICAL if any RequirementSpec references it through
 *      an explicit `result_ref` AND the RequirementSpec's own
 *      `requirement_type` is `REQUIRED_OUTPUT`. This is the closed
 *      "fulfilment" chain: a required output that any claim cites makes
 *      that claim the answer to a real demand.
 *   Otherwise: defer to the producer's declaration (the producer may
 *   mark a QUALITATIVE draft as NON_CRITICAL; the rules above only
 *   force CRITICAL for numeric/required chains).
 */

import type { Claim, RequirementSpec } from './schema.ts'
import type { IrObjectRecord } from './store.ts'

export const CRITICALITY_REASON_R1_NUMERIC_BINDING = 'R1:claim_carries_numeric_binding'
export const CRITICALITY_REASON_R2_REQUIRED_OUTPUT = 'R2:claim_cites_required_output_requirement'
export const CRITICALITY_REASON_PRODUCER_DECLARATION = 'PRODUCER_DECLARATION'

export type CriticalityVerdict = {
  /** The classifier's call: never less strict than the producer's claim. */
  readonly criticality: 'CRITICAL' | 'NON_CRITICAL'
  /** Why the classifier settled on this call (audit attribution). */
  readonly reason: string
}

/**
 * Classify a Claim against the canonical snapshot. Read-only.
 * `producerCriticality` is the Claim's declared value; the returned
 * `criticality` is at least as strict.
 */
export function classifyClaimCriticality(
  claim: Claim,
  store: ReadonlyMap<string, IrObjectRecord>,
  producerCriticality: 'CRITICAL' | 'NON_CRITICAL',
): CriticalityVerdict {
  // R1: any numeric binding forces CRITICAL (INV-3-I, no escape).
  if (claim.claim_type === 'NUMERIC' && claim.numeric_binding !== null) {
    return {
      criticality: 'CRITICAL',
      reason: CRITICALITY_REASON_R1_NUMERIC_BINDING,
    }
  }

  // R2: the claim cites a REQUIRED_OUTPUT requirement — it is the answer
  // to a real demand, so its criticality is non-negotiable.
  const citedRequiredOutputs = (claim.result_refs ?? []).filter(ref => {
    const record = store.get(ref)
    if (record === undefined || record.kind !== 'RequirementSpec') return false
    const requirement = record.value as RequirementSpec
    return requirement.requirement_type === 'REQUIRED_OUTPUT'
  })
  if (citedRequiredOutputs.length > 0) {
    return {
      criticality: 'CRITICAL',
      reason: CRITICALITY_REASON_R2_REQUIRED_OUTPUT,
    }
  }

  // Defer: the producer may mark QUALITATIVE drafts NON_CRITICAL. Any
  // CRITICAL declaration is honoured (it is the more strict value).
  return {
    criticality: producerCriticality,
    reason: CRITICALITY_REASON_PRODUCER_DECLARATION,
  }
}

/**
 * Convenience: returns the most-strict criticality given producer
 * declaration and the classifier's call. CRITICAL > NON_CRITICAL.
 */
export function mergeCriticality(
  producer: 'CRITICAL' | 'NON_CRITICAL',
  classifier: 'CRITICAL' | 'NON_CRITICAL',
): 'CRITICAL' | 'NON_CRITICAL' {
  return producer === 'CRITICAL' || classifier === 'CRITICAL' ? 'CRITICAL' : 'NON_CRITICAL'
}