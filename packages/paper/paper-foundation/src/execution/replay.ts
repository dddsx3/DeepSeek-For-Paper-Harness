/**
 * Replay verification (TASK 3 PHASE 3, task book §6).
 *
 * Re-executes the code a frozen ExecutionRecord names and re-derives
 * every hash from the fresh outcome. PASS requires ALL of:
 *
 *   1. the loaded code bytes hash to the record's `code_hash`   (CODE_MISMATCH)
 *   2. the declared environment fingerprint matches              (ENVIRONMENT_MISMATCH)
 *   3. the measured runtime fingerprint matches                  (ENVIRONMENT_MISMATCH)
 *   4. the declared dependency-lock fingerprint matches          (ENVIRONMENT_MISMATCH)
 *   5. the replayed process exits 0                              (NON_ZERO_EXIT)
 *   6. the replayed output bytes hash to `output_hash`           (OUTPUT_MISMATCH)
 *   7. the replayed stdout/stderr hash to the record's digests   (OUTPUT_MISMATCH)
 *   8. every Result on the run extracts its declared value from
 *      the replayed output document, exactly                     (OUTPUT_MISMATCH)
 *
 * The verifier trusts nothing from the capture side: every digest it
 * compares was recomputed here (task book §9, INV-3-F). It is total and
 * read-only — a replay never mutates canonical state.
 */

import {
  ModelingIr,
  canonicalJson,
  declaredDependencyLockFingerprint,
  declaredEnvironmentFingerprint,
  sha256Hex,
} from '../ir/index.ts'
import type { ExecutionRunner } from './runner.ts'

/** Closed failure categories, shared with the provenance audit (D9). */
export const EXECUTION_AUDIT_CATEGORIES = [
  'CODE_MISMATCH',
  'ENVIRONMENT_MISMATCH',
  'OUTPUT_MISMATCH',
  'NON_ZERO_EXIT',
  'MISSING_EXECUTION',
] as const
export type ExecutionAuditCategory = (typeof EXECUTION_AUDIT_CATEGORIES)[number]

export interface ReplayFailure {
  readonly category: ExecutionAuditCategory
  readonly reason: string
}

export interface ReplayCheck {
  readonly condition: string
  readonly ok: boolean
  readonly detail?: string
}

export interface ReplayVerdict {
  readonly ok: boolean
  readonly executionId: string | null
  readonly failures: ReadonlyArray<ReplayFailure>
  readonly checks: ReadonlyArray<ReplayCheck>
}

export interface ReplayExecutionInput {
  readonly ir: ModelingIr
  readonly executionId: string
  readonly runner: ExecutionRunner
  readonly loadCode: (codeRef: string) => Promise<string>
  readonly timeoutMs: number
}

/**
 * Re-run the recorded execution and compare reality against the record.
 * Total: never throws; every contradiction lands in `failures`.
 */
export async function replayExecution(input: ReplayExecutionInput): Promise<ReplayVerdict> {
  const store = ModelingIr.snapshot(input.ir)
  if (store === null) {
    return verdict(null, [], [{ category: 'MISSING_EXECUTION', reason: 'replay requires a canonical ModelingIr store' }])
  }

  const recordRecord = store.get(input.executionId)
  if (recordRecord === undefined || recordRecord.kind !== 'ExecutionRecord') {
    return verdict(input.executionId, [], [{
      category: 'MISSING_EXECUTION',
      reason: `execution '${input.executionId}' is not a registered ExecutionRecord`,
    }])
  }
  const record = recordRecord.value as {
    run_ref: string
    code_hash: string
    environment_hash: string
    runtime_fingerprint_hash: string
    dependency_lock_hash: string
    output_refs: string[]
    output_hash: string
    stdout_hash: string
    stderr_hash: string
    exit_status: number
    seed: string | number | null
  }

  const runRecord = store.get(record.run_ref)
  if (runRecord === undefined || runRecord.kind !== 'RunArtifact') {
    return verdict(input.executionId, [], [{
      category: 'MISSING_EXECUTION',
      reason: `record's run '${record.run_ref}' is not a registered RunArtifact`,
    }])
  }
  const run = runRecord.value as {
    code_ref: string
    model_ref: string
    seed: string | number | null
  }
  const modelRecord = store.get(run.model_ref)
  const model = modelRecord !== undefined && modelRecord.kind === 'ModelSpec'
    ? modelRecord.value as Record<string, unknown>
    : undefined

  const checks: ReplayCheck[] = []
  const failures: ReplayFailure[] = []
  const fail = (category: ReplayFailure['category'], condition: string, reason: string) => {
    checks.push({ condition, ok: false, detail: reason })
    failures.push({ category, reason })
  }

  // (1) code bytes — the loaded text must hash to the frozen digest.
  const code = await input.loadCode(run.code_ref)
  const loadedCodeHash = `sha256:${sha256Hex(code)}`
  if (loadedCodeHash !== record.code_hash) { // P-01 replay-side twin of the audit check
    fail('CODE_MISMATCH', 'code_hash matches executed bytes',
      `replayed code hashes to ${loadedCodeHash}, record freezes ${record.code_hash}`)
  } else {
    checks.push({ condition: 'code_hash matches executed bytes', ok: true })
  }

  // (2) declared environment fingerprint, re-derived from the run.
  const declaredEnv = declaredEnvironmentFingerprint(run)
  // (3) measured runtime fingerprint, from the replayed outcome.
  const outcome = await input.runner.run({
    code,
    seed: record.seed,
    timeoutMs: input.timeoutMs,
  })
  const runtimeHash = sha256Hex(canonicalJson(outcome.runtimeFacts))
  if (declaredEnv !== record.environment_hash || runtimeHash !== record.runtime_fingerprint_hash) { // P-04 replay-side
    fail('ENVIRONMENT_MISMATCH', 'declared + measured environment fingerprints match',
      `declared ${record.environment_hash.slice(0, 12)}… vs ${declaredEnv.slice(0, 12)}…; runtime ${record.runtime_fingerprint_hash.slice(0, 12)}… vs ${runtimeHash.slice(0, 12)}…`)
  } else {
    checks.push({ condition: 'declared + measured environment fingerprints match', ok: true })
  }

  // (4) declared dependency-lock fingerprint.
  const declaredDepLock = declaredDependencyLockFingerprint(run, model)
  if (declaredDepLock !== record.dependency_lock_hash) {
    fail('ENVIRONMENT_MISMATCH', 'dependency-lock fingerprint matches',
      `declared ${record.dependency_lock_hash.slice(0, 12)}… vs replayed ${declaredDepLock.slice(0, 12)}…`)
  } else {
    checks.push({ condition: 'dependency-lock fingerprint matches', ok: true })
  }

  // (5) the replayed process itself must succeed.
  if (outcome.exitStatus !== 0) { // P-03 replay-side
    fail('NON_ZERO_EXIT', 'replayed process exits 0', `replay exited ${outcome.exitStatus}`)
  } else {
    checks.push({ condition: 'replayed process exits 0', ok: true })
  }

  // (6) output bytes hash, recomputed from the replayed artifacts.
  const outputHashMap: Record<string, string> = {}
  for (const file of outcome.outputFiles) {
    outputHashMap[file.locator] = sha256Hex(file.bytes)
  }
  const computedOutputHash = sha256Hex(canonicalJson(outputHashMap))
  if (computedOutputHash !== record.output_hash) { // P-02
    fail('OUTPUT_MISMATCH', 'output bytes hash matches',
      `replayed outputs hash to ${computedOutputHash.slice(0, 12)}…, record freezes ${record.output_hash.slice(0, 12)}…`)
  } else {
    checks.push({ condition: 'output bytes hash matches', ok: true })
  }

  // (7) captured streams, recomputed.
  const stdoutHash = sha256Hex(outcome.stdout)
  const stderrHash = sha256Hex(outcome.stderr)
  if (stdoutHash !== record.stdout_hash || stderrHash !== record.stderr_hash) {
    fail('OUTPUT_MISMATCH', 'stdout/stderr digests match',
      `stdout ${record.stdout_hash.slice(0, 12)}… vs ${stdoutHash.slice(0, 12)}…; stderr ${record.stderr_hash.slice(0, 12)}… vs ${stderrHash.slice(0, 12)}…`)
  } else {
    checks.push({ condition: 'stdout/stderr digests match', ok: true })
  }

  // (8) every Result on this run re-derives its declared value from the
  // replayed output document (task book D7, C6).
  const results = resultsForRun(store, record.run_ref)
  for (const result of results) {
    const extracted = extractResultValue(outcome.outputFiles, result)
    if (!extracted.ok) {
      fail('OUTPUT_MISMATCH', `Result '${result.result_id}' value re-derived from output`,
        extracted.reason)
      continue
    }
    if (!(extracted.value === result.value)) {
      fail('OUTPUT_MISMATCH', `Result '${result.result_id}' value re-derived from output`,
        `output document yields ${extracted.value}, canonical Result freezes ${result.value}`)
      continue
    }
    checks.push({ condition: `Result '${result.result_id}' value re-derived from output`, ok: true })
  }

  return verdict(input.executionId, checks, failures)
}

/**
 * D7 extraction: the output document at `Result.source_location`'s
 * locator must be JSON; the `#fragment` (or the Result's `name` when no
 * fragment is present) is the key; its value must be a finite number.
 */
export function extractResultValue(
  outputFiles: ReadonlyArray<{ locator: string; bytes: string }>,
  result: { result_id: string; name: string; value: number; source_location: string },
): { ok: true; value: number } | { ok: false; reason: string } {
  const hashIndex = result.source_location.indexOf('#')
  const locator = hashIndex === -1 ? result.source_location : result.source_location.slice(0, hashIndex)
  const key = hashIndex === -1 ? result.name : result.source_location.slice(hashIndex + 1)

  const file = outputFiles.find(f => f.locator === locator)
  if (file === undefined) {
    return { ok: false, reason: `output document '${locator}' is missing from the replayed artifacts` }
  }
  let document: unknown
  try {
    document = JSON.parse(file.bytes)
  } catch {
    return { ok: false, reason: `output document '${locator}' is not valid JSON` }
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return { ok: false, reason: `output document '${locator}' is not a JSON object` }
  }
  const value = (document as Record<string, unknown>)[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: `output document '${locator}' has no finite number at key '${key}'` }
  }
  return { ok: true, value }
}

function resultsForRun(
  store: ReadonlyMap<string, import('../ir/store.ts').IrObjectRecord>,
  runRef: string,
): Array<{ result_id: string; name: string; value: number; source_location: string }> {
  const out: Array<{ result_id: string; name: string; value: number; source_location: string }> = []
  for (const record of store.values()) {
    if (record.kind !== 'Result') continue
    const value = record.value as { result_id: string; name: string; value: number; source_location: string; run_ref: string }
    if (value.run_ref === runRef) out.push(value)
  }
  return out
}

function verdict(
  executionId: string | null,
  checks: ReplayCheck[],
  failures: ReplayFailure[],
): ReplayVerdict {
  return { ok: failures.length === 0, executionId, failures, checks }
}