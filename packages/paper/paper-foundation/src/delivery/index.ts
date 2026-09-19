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
  DEFAULT_REPLAY_MAX_AGE_MS,
  GATE_STATUSES,
  IR_CANONICALIZATION_GATE_ID,
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

// P0-3 (PRD v2 §3.3, W2): fail-soft delivery grades.
export {
  DELIVERY_GRADES,
  EMPTY_CONTENT_CHARS,
  contentExists,
  gradeDelivery,
  renderDeliveryAppendix,
} from './delivery-grade.ts'
export type {
  DeliveryGrade,
  FatalConditions,
  GradeAnnotation,
  GradeDecision,
} from './delivery-grade.ts'

// M-QUAL (W10) — the quality-mechanism checks (all ride EXISTING critical
// gate ids; no new gate id, N4).
export { configConsistencyFindings } from './config-consistency.ts'
export type { ConfigConsistencyFinding } from './config-consistency.ts'
export { capabilityThresholdFindings } from './capability-thresholds.ts'
export type { CapabilityThresholdFinding } from './capability-thresholds.ts'
export {
  DELIVERY_FORM_COLUMN_TYPES,
  deliveryFormFindings,
} from './delivery-form.ts'
export type {
  DeliveryFormColumn,
  DeliveryFormColumnType,
  DeliveryFormContract,
  DeliveryFormFinding,
  DeliveryFormManifestEntry,
} from './delivery-form.ts'
export { renderBoundaryAppendix, RENDERABLE_BOUNDARY_CLASSES } from './boundary-render.ts'
