/**
 * Execution provenance audit + delivery gate (TASK 3 PHASE 4, D8/D9).
 *
 * Two consumers, one evaluator:
 *
 *   - The **delivery gate** (`executionProvenanceGate`) runs inside the
 *     WorkflowExecutor before `authorizeDelivery`. It checks structural
 *     consistency between every critical-chain run and its
 *     ExecutionRecord — the cheap, byte-free check. It walks the
 *     canonical snapshot exhaustively, so one valid run can never mask
 *     an invalid one (INV-3-G).
 *
 *   - The **independent auditor** (`auditExecutionProvenance`) works
 *     against a frozen {@link ExecutionManifest} whose `manifest_hash`
 *     is anchored out-of-band (the TASK 2.1 trust pattern): a
 *     self-consistent manifest fabricated from forged records carries a
 *     different hash and is refused. Byte-level truth comes from
 *     {@link replayExecution}, which the auditor invokes through the
 *     runner seam — Producer ≠ Auditor (INV-3-F).
 *
 * Failure taxonomy (closed, task book D9): CODE_MISMATCH /
 * ENVIRONMENT_MISMATCH / OUTPUT_MISMATCH / NON_ZERO_EXIT /
 * MISSING_EXECUTION. `status = FAIL` iff any failure has
 * `severity !== 'MEDIUM'`.
 */

import {
  ModelingIr,
  canonicalJson,
  declaredDependencyLockFingerprint,
  declaredEnvironmentFingerprint,
  sha256Hex,
  type ExecutionRecord,
} from '../ir/index.ts'
import type { GateRecord } from '../delivery/delivery-policy.ts'
import { PROVENANCE_GATE_ID } from '../delivery/delivery-policy.ts'
import { EXECUTION_AUDIT_CATEGORIES, replayExecution, type ExecutionAuditCategory } from './replay.ts'
import type { ExecutionRunner } from './runner.ts'

export { PROVENANCE_GATE_ID }
export { EXECUTION_AUDIT_CATEGORIES }
export type { ExecutionAuditCategory }

export const EXECUTION_AUDIT_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM'] as const
export type ExecutionAuditSeverity = (typeof EXECUTION_AUDIT_SEVERITIES)[number]

export interface ExecutionAuditFailure {
  readonly run_id: string
  readonly execution_id: string | null
  readonly category: ExecutionAuditCategory
  readonly severity: ExecutionAuditSeverity
  readonly reason: string
}

export interface ExecutionAuditReport {
  /** Deterministic: 'EAUD-' + sha256(manifest_hash | store digest). */
  readonly audit_id: string
  readonly status: 'PASS' | 'FAIL'
  /** Critical-chain runs examined (the C5/C9 coverage measure). */
  readonly execution_checked: number
  readonly failures: ReadonlyArray<ExecutionAuditFailure>
  readonly manifest_hash: string
  /**
   * TASK 3.6 / INV-3.6: the freshest replay report the auditor has
   * consumed, with the time at which it was produced. `null` when
   * the critical chain carries no execution records (or the auditor
   * ran without replay). The delivery gate uses `now - replayed_at`
   * to bound the capture-vs-delivery staleness window.
   */
  readonly replayed_at: string | null
  /** sha256 of the auditor's merged report; out-of-band anchor. */
  readonly replay_report_hash: string
}

/** The frozen run layer of the execution evidence. */
export interface FrozenExecutionRun {
  readonly run_id: string
  readonly code_hash: string
  readonly environment_hash: string
  readonly dependency_lock_hash: string
  readonly input_data_refs: ReadonlyArray<string>
  readonly output_refs: ReadonlyArray<string>
  readonly seed: string | number | null
  /** Whether the run is reachable from a CRITICAL Claim's chain. */
  readonly critical: boolean
}

/** The frozen record layer, verbatim. */
export type FrozenExecutionRecord = ExecutionRecord

/**
 * The execution-side freeze manifest (the out-of-band anchor of the
 * TASK 2.1 pattern). Deterministic: `freeze_hash` / `manifest_hash`
 * exclude `generated_at`, so two freezes of the same store agree.
 */
export interface ExecutionManifest {
  readonly manifest_version: 1
  readonly generated_at: string
  readonly freeze_hash: string
  readonly manifest_hash: string
  readonly records: ReadonlyArray<FrozenExecutionRecord>
  readonly runs: ReadonlyArray<FrozenExecutionRun>
}

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

export function buildExecutionManifest(
  store: ReadonlyMap<string, import('../ir/store.ts').IrObjectRecord>,
  options: { readonly now?: () => string } = {},
): ExecutionManifest {
  const runs: FrozenExecutionRun[] = []
  const records: FrozenExecutionRecord[] = []
  const criticalRunIds = criticalChainRunIds(store)

  for (const record of store.values()) {
    if (record.kind === 'ExecutionRecord') {
      records.push(record.value as ExecutionRecord)
    } else if (record.kind === 'RunArtifact') {
      const run = record.value as {
        run_id: string
        model_ref: string
        code_hash: string
        input_data_refs: string[]
        output_refs: string[]
        seed: string | number | null
      }
      runs.push({
        run_id: run.run_id,
        code_hash: run.code_hash,
        environment_hash: declaredEnvironmentFingerprint(run),
        dependency_lock_hash: declaredDependencyLockFingerprint(
          run,
          modelValueOf(store, run.model_ref),
        ),
        input_data_refs: [...run.input_data_refs],
        output_refs: [...run.output_refs],
        seed: run.seed,
        critical: criticalRunIds.has(run.run_id),
      })
    }
  }

  runs.sort((a, b) => a.run_id.localeCompare(b.run_id))
  records.sort((a, b) => a.execution_id.localeCompare(b.execution_id))

  const freeze_hash = sha256Hex(canonicalJson({ records, runs }))
  const manifest_hash = sha256Hex(canonicalJson({ manifest_version: 1, freeze_hash, records, runs }))
  return {
    manifest_version: 1,
    generated_at: (options.now ?? (() => new Date().toISOString()))(),
    freeze_hash,
    manifest_hash,
    records,
    runs,
  }
}

// ---------------------------------------------------------------------------
// Structural audit
// ---------------------------------------------------------------------------

/**
 * Audit the live snapshot against the frozen execution manifest.
 * Read-only and total. Byte-level truth is replay's job; this pass
 * proves structural consistency (record ↔ run ↔ manifest).
 */
export function auditExecutionProvenance(
  store: ReadonlyMap<string, import('../ir/store.ts').IrObjectRecord>,
  manifest: ExecutionManifest,
): ExecutionAuditReport {
  const failures: ExecutionAuditFailure[] = []
  const push = (f: ExecutionAuditFailure) => failures.push(f)

  // Manifest integrity first: a tampered manifest invalidates every
  // per-run verdict (RT-X1 / task book RT-E4 pattern).
  const recomputed = sha256Hex(canonicalJson({
    manifest_version: manifest.manifest_version,
    freeze_hash: manifest.freeze_hash,
    records: manifest.records,
    runs: manifest.runs,
  }))
  if (recomputed !== manifest.manifest_hash) {
    push({
      run_id: '<manifest>',
      execution_id: null,
      category: 'MISSING_EXECUTION',
      severity: 'CRITICAL',
      reason: `execution manifest_hash mismatch: frozen '${manifest.manifest_hash}' vs recomputed '${recomputed}'`,
    })
    return report(store, manifest, failures, 0, null)
  }

  const criticalRunIds = criticalChainRunIds(store)
  const checked = [...criticalRunIds].sort()
  const recordsByRun = recordsForRuns(store, checked)

  for (const runId of checked) {
    const runRecord = store.get(runId)
    if (runRecord === undefined || runRecord.kind !== 'RunArtifact') {
      push({
        run_id: runId,
        execution_id: null,
        category: 'MISSING_EXECUTION',
        severity: 'CRITICAL',
        reason: `critical-chain run '${runId}' is not a registered RunArtifact`,
      })
      continue
    }
    const run = runRecord.value as {
      code_hash: string
      model_ref: string
      input_data_refs: string[]
      output_refs: string[]
      seed: string | number | null
    }
    const model = modelValueOf(store, run.model_ref)
    const records = recordsByRun.get(runId) ?? []

    if (records.length === 0) {
      push({
        run_id: runId,
        execution_id: null,
        category: 'MISSING_EXECUTION',
        severity: 'CRITICAL',
        reason: `critical-chain run '${runId}' has no ExecutionRecord`,
      })
      continue
    }

    // Conflicting records for one run — evidence cannot disagree with
    // itself (EX-10).
    for (let i = 1; i < records.length; i += 1) {
      if (canonicalJson(records[i]!) !== canonicalJson(records[0]!)) {
        push({
          run_id: runId,
          execution_id: records[i]!.execution_id,
          category: 'CODE_MISMATCH',
          severity: 'CRITICAL',
          reason: `run '${runId}' carries conflicting execution records '${records[0]!.execution_id}' and '${records[i]!.execution_id}'`,
        })
      }
    }

    for (const record of records) {
      // Code reality at the structural layer: the record must freeze the
      // run's declared code digest (byte truth = replay, EX-03).
      if (record.code_hash !== run.code_hash) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'CODE_MISMATCH',
          severity: 'CRITICAL',
          reason: `record freezes code '${record.code_hash}' but the run declares '${run.code_hash}'`,
        })
      }
      // Declared environment fingerprint (P-04 anchor).
      if (declaredEnvironmentFingerprint(run) !== record.environment_hash) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'ENVIRONMENT_MISMATCH',
          severity: 'HIGH',
          reason: `record freezes environment '${record.environment_hash.slice(0, 12)}…' but the run re-derives '${declaredEnvironmentFingerprint(run).slice(0, 12)}…'`,
        })
      }
      // Dependency-lock fingerprint (P-08 anchor).
      if (declaredDependencyLockFingerprint(run, model) !== record.dependency_lock_hash) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'ENVIRONMENT_MISMATCH',
          severity: 'HIGH',
          reason: `record freezes dependency lock '${record.dependency_lock_hash.slice(0, 12)}…' but the run re-derives '${declaredDependencyLockFingerprint(run, model).slice(0, 12)}…'`,
        })
      }
      // Seed binding (P-07 anchor, EX-07): seed is part of the declared
      // environment; a drifting seed is an environment mismatch.
      if (record.seed !== run.seed) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'ENVIRONMENT_MISMATCH',
          severity: 'HIGH',
          reason: `record freezes seed ${JSON.stringify(record.seed)} but the run declares ${JSON.stringify(run.seed)}`,
        })
      }
      // Input/output binding (INV-3-A / C4).
      if (!sameSet(record.input_data_refs, run.input_data_refs)) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'ENVIRONMENT_MISMATCH',
          severity: 'HIGH',
          reason: `record inputs [${record.input_data_refs.join(',')}] differ from the run's [${run.input_data_refs.join(',')}]`,
        })
      }
      if (!sameSet(record.output_refs, run.output_refs)) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'OUTPUT_MISMATCH',
          severity: 'CRITICAL',
          reason: `record outputs [${record.output_refs.join(',')}] differ from the run's [${run.output_refs.join(',')}]`,
        })
      }
      // Exit status + seed presence (INV-3-D, EX-05 structural half).
      if (record.exit_status !== 0) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'NON_ZERO_EXIT',
          severity: 'CRITICAL',
          reason: `record freezes exit_status ${record.exit_status}`,
        })
      }
      if (record.seed === null) {
        push({
          run_id: runId,
          execution_id: record.execution_id,
          category: 'ENVIRONMENT_MISMATCH',
          severity: 'HIGH',
          reason: 'critical-chain execution has seed null (INV-3-D)',
        })
      }
    }
  }

  return report(store, manifest, failures, checked.length, null)
}

// ---------------------------------------------------------------------------
// Delivery gate (D8)
// ---------------------------------------------------------------------------

export interface ProvenanceGateDecision {
  readonly status: 'PASS' | 'BLOCKED'
  readonly report: ExecutionAuditReport
}

/**
 * Structural provenance verdict for one delivery attempt. Total: never
 * throws, never mutates. A store that cannot prove its identity blocks
 * everything. With no critical claims the gate is vacuously PASS — the
 * executor runs the canonical-IR gate first, which refuses a backbone-
 * less store long before this is consulted.
 */
export function evaluateProvenanceGate(ir: ModelingIr): ProvenanceGateDecision {
  try {
    const store = ModelingIr.snapshot(ir)
    if (store === null) {
      const report: ExecutionAuditReport = {
        audit_id: 'EAUD-unavailable',
        status: 'FAIL',
        execution_checked: 0,
        failures: [{
          run_id: '$store',
          execution_id: null,
          category: 'MISSING_EXECUTION',
          severity: 'CRITICAL',
          reason: 'provenance gate requires a canonical ModelingIr store',
        }],
        manifest_hash: 'unavailable',
        replayed_at: null,
        replay_report_hash: 'unavailable',
      }
      return { status: 'BLOCKED', report }
    }
    const manifest = buildExecutionManifest(store)
    const report = auditExecutionProvenance(store, manifest)
    return { status: report.status === 'PASS' ? 'PASS' : 'BLOCKED', report }
  } catch (error) {
    const report: ExecutionAuditReport = {
      audit_id: 'EAUD-faulted',
      status: 'FAIL',
      execution_checked: 0,
      failures: [{
        run_id: '$gate',
        execution_id: null,
        category: 'MISSING_EXECUTION',
        severity: 'CRITICAL',
        reason: `provenance gate faulted: ${error instanceof Error ? error.message : 'non-Error throw'}`,
      }],
      manifest_hash: 'unavailable',
      replayed_at: null,
      replay_report_hash: 'unavailable',
    }
    return { status: 'BLOCKED', report }
  }
}

/** Render the decision as the TASK 0 critical-gate record. */
export function executionProvenanceGate(ir: ModelingIr, observedAt: string): GateRecord {
  const decision = evaluateProvenanceGate(ir)
  const failing = decision.report.failures
    .map(f => `${f.run_id}:${f.category}`)
    .slice(0, 8)
    .join(',')
  return {
    id: PROVENANCE_GATE_ID,
    status: decision.status,
    critical: true,
    reason: decision.status === 'PASS'
      ? 'execution provenance satisfied (structural)'
      : `execution provenance blocked: ${decision.report.failures.length} failure(s) [${failing}]`,
    observedAt,
  }
}

// ---------------------------------------------------------------------------
// Independent execution auditor (task book §9, INV-3-F)
// ---------------------------------------------------------------------------

export interface IndependentExecutionAuditInput {
  readonly ir: ModelingIr
  readonly runner: ExecutionRunner
  readonly loadCode: (codeRef: string) => Promise<string>
  readonly timeoutMs: number
}

export interface IndependentExecutionAudit {
  /** Structural verdict + replay findings merged, re-judged fail-closed. */
  readonly report: ExecutionAuditReport
  /** One replay verdict per frozen record, in manifest order. */
  readonly replays: ReadonlyArray<import('./replay.ts').ReplayVerdict>
}

/**
 * The full independent audit: structural consistency PLUS a real replay
 * of every frozen record through the runner seam. The auditor re-derives
 * every digest itself — nothing from the capture side is trusted. This
 * is the C5/C9 evidence path.
 */
export async function runIndependentExecutionAudit(
  input: IndependentExecutionAuditInput,
): Promise<IndependentExecutionAudit> {
  const store = ModelingIr.snapshot(input.ir)
  if (store === null) {
    return {
      report: evaluateProvenanceGate(input.ir).report,
      replays: [],
    }
  }
  const manifest = buildExecutionManifest(store)
  const report = auditExecutionProvenance(store, manifest)

  const replays: import('./replay.ts').ReplayVerdict[] = []
  const merged = [...report.failures]
  for (const record of manifest.records) { // P-05 anchor: skipping the loop = replay never runs
    let verdict: import('./replay.ts').ReplayVerdict
    try {
      verdict = await replayExecution({
        ir: input.ir,
        executionId: record.execution_id,
        runner: input.runner,
        loadCode: input.loadCode,
        timeoutMs: input.timeoutMs,
      })
    } catch (error) {
      // A crashed replay produces no verdict — the honest reading is "no
      // reproducible execution evidence", never a PASS (INV-3-H).
      merged.push({
        run_id: record.run_ref,
        execution_id: record.execution_id,
        category: 'MISSING_EXECUTION',
        severity: 'CRITICAL',
        reason: `replay faulted: ${error instanceof Error ? error.message : 'non-Error throw'}`,
      })
      continue
    }
    replays.push(verdict)
    for (const failure of verdict.failures) {
      merged.push({
        run_id: record.run_ref,
        execution_id: record.execution_id,
        category: failure.category,
        // Replay findings are byte-level truth: any replay failure on a
        // record is CRITICAL regardless of category (the record claims a
        // reality that does not reproduce).
        severity: 'CRITICAL',
        reason: `replay: ${failure.reason}`,
      })
    }
  }

  const status: 'PASS' | 'FAIL' = merged.some(f => f.severity !== 'MEDIUM') ? 'FAIL' : 'PASS'
  // TASK 3.6: replayed_at records the moment the auditor consumed the
  // freshest replay. `null` only when no critical-chain run carried a
  // record (the structural audit alone informs the report; the delivery
  // gate will then fall back to the default staleness policy).
  const replayedAt = replays.length > 0 ? new Date().toISOString() : null
  return {
    report: { ...report, status, failures: merged, replayed_at: replayedAt },
    replays,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function report(
  store: ReadonlyMap<string, import('../ir/store.ts').IrObjectRecord>,
  manifest: ExecutionManifest,
  failures: ExecutionAuditFailure[],
  executionChecked: number,
  replayedAt: string | null = null,
): ExecutionAuditReport {
  const status: 'PASS' | 'FAIL' = failures.some(f => f.severity !== 'MEDIUM') ? 'FAIL' : 'PASS'
  const digest = sha256Hex(canonicalJson([...store.keys()].sort()))
  const replayReportHash = sha256Hex(canonicalJson({
    manifest_hash: manifest.manifest_hash,
    store_digest: digest,
    failures: failures.map(f => ({ category: f.category, severity: f.severity })),
    status,
  }))
  return {
    audit_id: `EAUD-${sha256Hex(`${manifest.manifest_hash}|${digest}`).slice(0, 16)}`,
    status,
    execution_checked: executionChecked,
    failures,
    manifest_hash: manifest.manifest_hash,
    replayed_at: replayedAt,
    replay_report_hash: replayReportHash,
  }
}

/** Runs reachable from a CRITICAL Claim: Claim → results → run. */
function criticalChainRunIds(
  store: ReadonlyMap<string, import('../ir/store.ts').IrObjectRecord>,
): Set<string> {
  const runIds = new Set<string>()
  for (const record of store.values()) {
    if (record.kind !== 'Claim') continue
    const claim = record.value as { criticality?: string; result_refs?: string[] }
    if (claim.criticality !== 'CRITICAL') continue
    for (const ref of claim.result_refs ?? []) {
      const result = store.get(ref)
      if (result === undefined || result.kind !== 'Result') continue
      const value = result.value as { run_ref?: string }
      if (typeof value.run_ref === 'string') runIds.add(value.run_ref)
    }
  }
  return runIds
}

function recordsForRuns(
  store: ReadonlyMap<string, import('../ir/store.ts').IrObjectRecord>,
  runIds: ReadonlyArray<string>,
): Map<string, ExecutionRecord[]> {
  const byRun = new Map<string, ExecutionRecord[]>()
  for (const record of store.values()) {
    if (record.kind !== 'ExecutionRecord') continue
    const value = record.value as ExecutionRecord
    if (!runIds.includes(value.run_ref)) continue
    const list = byRun.get(value.run_ref) ?? []
    list.push(value)
    byRun.set(value.run_ref, list)
  }
  return byRun
}

function modelValueOf(
  store: ReadonlyMap<string, import('../ir/store.ts').IrObjectRecord>,
  modelRef: string | undefined,
): Record<string, unknown> | undefined {
  if (modelRef === undefined) return undefined
  const record = store.get(modelRef)
  return record !== undefined && record.kind === 'ModelSpec'
    ? record.value as Record<string, unknown>
    : undefined
}

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, i) => value === sortedB[i])
}