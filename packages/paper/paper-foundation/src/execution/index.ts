/**
 * Execution Provenance layer (TASK 3).
 *
 *   - `runner.ts`  — the only seam through which code executes.
 *   - `capture.ts` — the only producer of ExecutionRecord values.
 *   - `replay.ts`  — the re-execution verifier (byte-level truth).
 *   - `audit.ts`   — the structural audit + the `provenance` critical gate.
 *
 * Producer ≠ Auditor: capture and audit share no mutable state, and the
 * auditor re-derives every digest it compares.
 */

export {
  EXECUTION_CAPTURE_FAILURE_KINDS,
  captureExecution,
  ingestCapturedRecord,
} from './capture.ts'
export type {
  ExecutionCaptureFailure,
  ExecutionCaptureFailureKind,
  ExecutionCaptureResult,
  CaptureExecutionInput,
} from './capture.ts'

export {
  EXECUTION_AUDIT_CATEGORIES,
  extractResultValue,
  replayExecution,
} from './replay.ts'
export type {
  ExecutionAuditCategory,
  ReplayCheck,
  ReplayExecutionInput,
  ReplayFailure,
  ReplayVerdict,
} from './replay.ts'

export {
  EXECUTION_AUDIT_SEVERITIES,
  PROVENANCE_GATE_ID,
  auditExecutionProvenance,
  buildExecutionManifest,
  evaluateProvenanceGate,
  executionProvenanceGate,
  runIndependentExecutionAudit,
} from './audit.ts'
export type {
  ExecutionAuditFailure,
  ExecutionAuditReport,
  ExecutionAuditSeverity,
  ExecutionManifest,
  FrozenExecutionRecord,
  FrozenExecutionRun,
  IndependentExecutionAudit,
  IndependentExecutionAuditInput,
  ProvenanceGateDecision,
} from './audit.ts'

export { LocalProcessRunner } from './runner.ts'
export type {
  ExecutionOutcome,
  ExecutionOutputFile,
  ExecutionRequest,
  ExecutionRunner,
  LocalProcessRunnerConfig,
} from './runner.ts'