/**
 * Minimal Modeling IR (TASK 1).
 *
 * Four concerns, four modules:
 *   - `schema.ts` — closed zod schemas for the eight IR object kinds.
 *   - `parse.ts`  — strict JSON ingress with no repair path.
 *   - `refs.ts`   — the closed table of which fields are IR references and
 *                   what each one is allowed to point at.
 *   - `store.ts`  — the append-only canonical store; `put()` is the only way
 *                   anything becomes canonical state.
 *
 * Nothing here reads the filesystem, calls a model, or inspects the runtime
 * clock by itself: `ModelingIr` takes `now` and `audit` as injected options so
 * an ingest verdict stays a pure function of its inputs.
 */

export {
  ATTACK_TYPES,
  CLAIM_CRITICALITIES,
  CLAIM_TYPES,
  FINDING_SEVERITIES,
  ID_FIELD_BY_KIND,
  IR_KINDS,
  IR_SCHEMAS,
  claimSchema,
  dataArtifactSchema,
  figureSpecSchema,
  modelSpecSchema,
  numericBindingSchema,
  problemSpecSchema,
  readIrObjectId,
  requirementSpecSchema,
  resultSchema,
  reviewerFindingSchema,
  runArtifactSchema,
  symbolSpecSchema,
  verificationResultSchema,
  // Closed-enum constants used by callers building fixtures or guards.
  DATA_ARTIFACT_ROLES,
  REQUIREMENT_TYPES,
  SYMBOL_ROLES,
} from './schema.ts'
export type {
  AttackType,
  Claim,
  ClaimCriticality,
  ClaimType,
  DataArtifact,
  DataArtifactRole,
  FigureSpec,
  FindingSeverity,
  IrKind,
  IrObjectMap,
  ModelSpec,
  NumericClaimBinding,
  ProblemSpec,
  RequirementSpec,
  RequirementType,
  Result,
  ReviewerFinding,
  RunArtifact,
  SymbolRole,
  SymbolSpec,
  VerificationResult,
} from './schema.ts'

export {
  MAX_IR_JSON_CHARS,
  MAX_IR_JSON_DEPTH,
  MAX_IR_VALUE_NODES,
  parseStrictJson,
  scanIrValue,
} from './parse.ts'
export type { ScanVerdict, StrictJsonFailureReason, StrictJsonResult } from './parse.ts'

export { deepFreeze } from './freeze.ts'

export { IR_REF_FIELDS, validateRefFields } from './refs.ts'
export type { IrRefFieldSpec, IrRefProblem, IrRefResolution, IrRefTarget, IrRefResolver } from './refs.ts'

export {
  PROBLEM_CONTRACT_FAILURE_KINDS,
  EMPTY_MINIMUM_PROBLEM_CONTRACT,
  findDuplicateSymbolTokens,
  minimumProblemContractSatisfied,
  validateModelSpecSymbols,
  validateProblemContract,
} from './problem-contract.ts'
export type {
  MinimumProblemContract,
  ProblemContractFailureKind,
  ProblemContractProblem,
  ProblemContractResolver,
} from './problem-contract.ts'

export {
  CLAIM_EVIDENCE_FAILURE_KINDS,
  inspectClaimEvidence,
  numericValuesEqual,
  validateClaimEvidence,
} from './claim-evidence.ts'
export type {
  ClaimEvidenceFailure,
  ClaimEvidenceFailureKind,
  ClaimEvidenceResolver,
} from './claim-evidence.ts'

export {
  EVIDENCE_AUDIT_CATEGORIES,
  EVIDENCE_AUDIT_SEVERITIES,
  auditEvidenceFreeze,
  buildEvidenceFreeze,
  canonicalJson,
  sha256Hex,
} from './evidence-freeze.ts'
export type {
  EvidenceAuditCategory,
  EvidenceAuditFailure,
  EvidenceAuditReport,
  EvidenceAuditSeverity,
  EvidenceFreezeManifest,
  EvidenceFreezeOptions,
  FrozenClaim,
  FrozenResult,
  FrozenRun,
} from './evidence-freeze.ts'

export {
  IR_BACKBONE_KINDS,
  IR_BACKBONE_EXEMPT_MODES,
  IR_CLAIM_REJECTIONS,
  evaluateIrBridge,
  irBridgeGate,
  requiresIrBackbone,
  irClaimSchema,
} from './bridge.ts'
export type {
  ContractFailure,
  IrBackboneKind,
  IrBackboneExemptMode,
  IrBridgeDecision,
  IrClaim,
  IrClaimProblem,
  IrClaimRejection,
} from './bridge.ts'

export { IR_FAILURE_KINDS, ModelingIr } from './store.ts'
export type {
  IrAuditEvent,
  IrAuditEventType,
  IrFailure,
  IrFailureKind,
  IrIngestVerdict,
  IrObjectRecord,
  ModelingIrOptions,
} from './store.ts'
