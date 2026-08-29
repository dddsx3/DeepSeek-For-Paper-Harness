/**
 * Paper candidate-to-deliverable promoter (TASK 0).
 *
 * The only function in the package that is allowed to mint a
 * `DeliverableArtifact`. Every other entry point either returns a
 * `Candidate` (LLM output) or a `Verified` (verification completed
 * successfully, but the artifact has not been promoted).
 *
 * Hard invariants enforced by `promoteCandidateToDeliverable`:
 *   - Source state MUST be CANDIDATE. Anything else is
 *     `wrong_source_state`.
 *   - The precomputed `DeliveryDecision.allowed` MUST be `true`. Anything
 *     else is `verification_not_passed`.
 *   - In FAST mode, every critical gate id from
 *     `policy.gates` MUST be present in the supplied gate set, otherwise
 *     `fast_mode_bypass_attempt`.
 *   - On any failure, `deps.writeFinalOutput` is NOT called and the
 *     returned artifact is NOT in DELIVERABLE state.
 *   - On success, the audit sink receives exactly one
 *     `promotion_succeeded` event. On failure, exactly one
 *     `promotion_failed` event.
 */

import {
  type Artifact,
  type CandidateArtifact,
  type DeliverableArtifact,
  type PromoteError,
  makeDeliverableArtifact,
} from './artifact-states.ts'
import {
  CRITICAL_GATE_IDS,
  type DeliveryDecision,
  type DeliveryPolicy,
  type GateRecord,
} from './delivery-policy.ts'

/** Subset of the audit event used by the runtime. We accept a wider shape
 *  so the existing audit service can be wired in without coupling the
 *  promoter to its full type. */
export interface PromoterAuditEvent {
  readonly type: string
  readonly at: string
  readonly [k: string]: unknown
}

export interface PromoterDeps {
  readonly audit: (event: PromoterAuditEvent) => void
  readonly now: () => string
  readonly writeFinalOutput: (path: string, content: string) => Promise<void>
}

export type PromotionResult =
  | { ok: true; artifact: DeliverableArtifact }
  | { ok: false; error: PromoteError }

export interface PromoteOptions {
  /** Verified timestamp; defaults to `deps.now()`. */
  readonly verifiedAt?: string
}

/**
 * Promote a candidate to a deliverable. Pure with respect to its inputs;
 * the only side effects go through `deps`.
 *
 * @param candidate    Must be a CANDIDATE artifact.
 * @param policy       The full delivery policy that was evaluated.
 * @param decision     Pre-computed decision from `evaluateDelivery(policy)`.
 * @param deps         Audit + clock + filesystem sink.
 * @param finalOutputPath  Where the deliverable will be written on success.
 * @param payload      The bytes to write. NOT consumed on failure.
 * @param options      Optional overrides.
 */
export async function promoteCandidateToDeliverable(
  candidate: Artifact,
  policy: DeliveryPolicy,
  decision: DeliveryDecision,
  deps: PromoterDeps,
  finalOutputPath: string,
  payload: string,
  options: PromoteOptions = {},
): Promise<PromotionResult> {
  // 1. Source-state check.
  if (candidate.state !== 'CANDIDATE') {
    const err: PromoteError = {
      kind: 'wrong_source_state',
      from: candidate.state,
      to: 'DELIVERABLE',
    }
    emitFailed(deps, err, candidate.id)
    return { ok: false, error: err }
  }

  // 2. Decision check. The precomputed `decision` is the single source of
  //    truth; the promoter must not re-evaluate the policy. This is
  //    deliberate: re-evaluation could allow a "refresh" of the policy
  //    between the verdict and the write.
  if (!decision.allowed) {
    const err: PromoteError = {
      kind: 'verification_not_passed',
      gateFailures: decision.failures.map(f => `${f.kind}:${f.reason}`),
    }
    emitFailed(deps, err, candidate.id)
    return { ok: false, error: err }
  }

  // 3. FAST mode bypass check. Even when `decision.allowed` is true, a
  //    FAST-mode policy that is missing ANY critical gate record is
  //    treated as a bypass attempt. The check is conservative: a missing
  //    record is "absent", not "PASS", and the only way to express PASS
  //    is to record it.
  if (policy.mode === 'FAST') {
    const presentGateIds = new Set<string>(policy.gates.map(g => g.id))
    for (const required of CRITICAL_GATE_IDS) {
      if (!presentGateIds.has(required)) {
        const err: PromoteError = { kind: 'fast_mode_bypass_attempt' }
        emitFailed(deps, err, candidate.id)
        return { ok: false, error: err }
      }
    }
  }

  // 4. All checks passed. Build the deliverable, write, audit.
  const now = options.verifiedAt ?? deps.now()
  const deliverable = makeDeliverableArtifact({
    id: candidate.id,
    createdAt: candidate.createdAt,
    contentHash: candidate.contentHash,
    verifiedAt: now,
    promotedAt: now,
    finalOutputPath,
  })
  await deps.writeFinalOutput(finalOutputPath, payload)
  deps.audit({
    type: 'promotion_succeeded',
    at: now,
    artifactId: deliverable.id,
    finalOutputPath: deliverable.finalOutputPath,
    mode: policy.mode,
  })
  return { ok: true, artifact: deliverable }
}

function emitFailed(deps: PromoterDeps, error: PromoteError, artifactId: string): void {
  deps.audit({
    type: 'promotion_failed',
    at: deps.now(),
    artifactId,
    error,
  })
}

/**
 * Helper used by callers that need a CandidateArtifact but only have the
 * raw fields. Re-exported so we have a single import surface.
 */
export function asCandidate(input: Artifact): CandidateArtifact {
  if (input.state !== 'CANDIDATE') {
    throw new Error(`not a CANDIDATE (state=${input.state})`)
  }
  return input
}

/** Re-export the critical-gate id list for convenience. */
export { CRITICAL_GATE_IDS }
export type { GateRecord }
