/**
 * Paper delivery public surface (TASK 0).
 *
 * Re-exports every public type and function for the three-state
 * Candidate / Verified / Deliverable pipeline, the deterministic
 * DeliveryPolicy, and the promoter.
 */

export {
  ARTIFACT_STATES,
  artifactSchema,
  candidateArtifactSchema,
  deliverableArtifactSchema,
  makeCandidateArtifact,
  makeDeliverableArtifact,
  makeVerifiedArtifact,
  parseArtifact,
  safeParseArtifact,
  verifiedArtifactSchema,
  artifactStateSchema,
} from './artifact-states.ts'
export type {
  Artifact,
  ArtifactState,
  CandidateArtifact,
  DeliverableArtifact,
  PromoteError,
  VerifiedArtifact,
} from './artifact-states.ts'

export {
  CRITICAL_GATE_IDS,
  GATE_STATUSES,
  evaluateDelivery,
  isNonCriticalGateSkippableInMode,
} from './delivery-policy.ts'
export type {
  CriticalGateId,
  DeliveryDecision,
  DeliveryFailure,
  DeliveryPolicy,
  GateRecord,
  GateStatus,
  RequiredOutput,
} from './delivery-policy.ts'

export {
  CRITICAL_GATE_IDS as DELIVERY_CRITICAL_GATE_IDS,
  asCandidate,
  promoteCandidateToDeliverable,
} from './promoter.ts'
export type {
  PromoterAuditEvent,
  PromotionResult,
  PromoterDeps,
  PromoteOptions,
} from './promoter.ts'
