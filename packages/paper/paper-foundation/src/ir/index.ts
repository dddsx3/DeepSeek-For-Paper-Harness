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
  figureSpecSchema,
  modelParameterSchema,
  modelSpecSchema,
  modelVariableSchema,
  problemSpecSchema,
  readIrObjectId,
  requiredOutputSchema,
  resultSchema,
  reviewerFindingSchema,
  runArtifactSchema,
  subproblemSchema,
  verificationResultSchema,
} from './schema.ts'
export type {
  AttackType,
  Claim,
  ClaimCriticality,
  ClaimType,
  FigureSpec,
  FindingSeverity,
  IrKind,
  IrObjectMap,
  ModelParameter,
  ModelSpec,
  ModelVariable,
  ProblemSpec,
  Result,
  ReviewerFinding,
  RunArtifact,
  Subproblem,
  VerificationResult,
} from './schema.ts'

export {
  MAX_IR_JSON_CHARS,
  MAX_IR_JSON_DEPTH,
  parseStrictJson,
  scanIrValue,
} from './parse.ts'
export type { ScanVerdict, StrictJsonFailureReason, StrictJsonResult } from './parse.ts'

export { deepFreeze } from './freeze.ts'

export { IR_REF_FIELDS, validateRefFields } from './refs.ts'
export type { IrRefFieldSpec, IrRefProblem, IrRefResolution, IrRefTarget, IrRefResolver } from './refs.ts'

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
