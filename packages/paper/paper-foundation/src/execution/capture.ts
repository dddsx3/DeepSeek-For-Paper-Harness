/**
 * Execution capture (TASK 3 PHASE 2, task book D3/§5).
 *
 * The ONLY producer of `ExecutionRecord` values. Every hash is computed
 * here from runner-measured bytes; `exit_status` and the timestamps come
 * straight from the {@link ExecutionOutcome}. There is no public path
 * that fabricates a field by hand — a record exists because a runner
 * ran (INV-3-B).
 *
 * Capture refuses (fail-closed) when reality contradicts the declared
 * RunArtifact: the code bytes do not hash to `code_hash`, the produced
 * outputs do not match `output_refs`, or the referenced run is missing.
 * Refusal is a verdict, never an exception.
 */

import {
  CAPTURE_ATTESTATION,
  ModelingIr,
  canonicalJson,
  declaredDependencyLockFingerprint,
  declaredEnvironmentFingerprint,
  executionRecordSchema,
  sha256Hex,
  type ExecutionRecord,
} from '../ir/index.ts'
import type { ExecutionRunner } from './runner.ts'

/** Closed set of reasons capture refuses to produce a record. */
export const EXECUTION_CAPTURE_FAILURE_KINDS = [
  'RUN_MISSING',
  'NOT_CANONICAL_STORE',
  'CODE_MISMATCH',
  'OUTPUT_SET_MISMATCH',
  'RECORD_INVALID',
] as const
export type ExecutionCaptureFailureKind = (typeof EXECUTION_CAPTURE_FAILURE_KINDS)[number]

export interface ExecutionCaptureFailure {
  readonly kind: ExecutionCaptureFailureKind
  readonly reason: string
}

export type ExecutionCaptureResult =
  | { readonly ok: true; readonly record: ExecutionRecord }
  | { readonly ok: false; readonly failures: ReadonlyArray<ExecutionCaptureFailure> }

export interface CaptureExecutionInput {
  readonly ir: ModelingIr
  /** The RunArtifact whose code should run. */
  readonly runRef: string
  readonly executionId: string
  readonly runner: ExecutionRunner
  /** Resolves `RunArtifact.code_ref` to the code text. The store has no
   *  filesystem; the composition owns the loader (tests inject a stub). */
  readonly loadCode: (codeRef: string) => Promise<string>
  readonly timeoutMs: number
}

/**
 * Run the code once and distil the outcome into a canonical
 * ExecutionRecord. Total: never throws on hostile input; every
 * contradiction becomes a failure verdict.
 */
export async function captureExecution(input: CaptureExecutionInput): Promise<ExecutionCaptureResult> {
  const failures: ExecutionCaptureFailure[] = []
  const store = ModelingIr.snapshot(input.ir)
  if (store === null) {
    return {
      ok: false,
      failures: [{ kind: 'NOT_CANONICAL_STORE', reason: 'capture requires a canonical ModelingIr store' }],
    }
  }

  const runRecord = store.get(input.runRef)
  if (runRecord === undefined || runRecord.kind !== 'RunArtifact') {
    return {
      ok: false,
      failures: [{
        kind: 'RUN_MISSING',
        reason: `run '${input.runRef}' is not a registered RunArtifact`,
      }],
    }
  }
  const run = runRecord.value as {
    code_ref: string
    code_hash: string
    model_ref: string
    input_data_refs: string[]
    output_refs: string[]
    seed: string | number | null
  }

  const code = await input.loadCode(run.code_ref)
  if (`sha256:${sha256Hex(code)}` !== run.code_hash) {
    failures.push({
      kind: 'CODE_MISMATCH',
      reason: `code bytes at '${run.code_ref}' hash to sha256:${sha256Hex(code)}, but RunArtifact declares ${run.code_hash}`,
    })
    return { ok: false, failures }
  }

  const outcome = await input.runner.run({
    code,
    seed: run.seed,
    timeoutMs: input.timeoutMs,
  })

  // Output set must match the run's declared locators, position-free.
  const produced = outcome.outputFiles.map(f => f.locator)
  if (!sameSet(produced, run.output_refs)) {
    failures.push({
      kind: 'OUTPUT_SET_MISMATCH',
      reason: `runner produced [${produced.join(',')}] but RunArtifact.output_refs declares [${run.output_refs.join(',')}]`,
    })
    return { ok: false, failures }
  }

  const modelRecord = store.get(run.model_ref)
  const model = modelRecord !== undefined && modelRecord.kind === 'ModelSpec'
    ? modelRecord.value as Record<string, unknown>
    : undefined

  const outputHashMap: Record<string, string> = {}
  for (const file of outcome.outputFiles) {
    outputHashMap[file.locator] = sha256Hex(file.bytes)
  }

  const record = {
    execution_id: input.executionId,
    run_ref: input.runRef,
    code_hash: run.code_hash,
    environment_hash: declaredEnvironmentFingerprint(run),
    runtime_fingerprint_hash: sha256Hex(canonicalJson(outcome.runtimeFacts)),
    dependency_lock_hash: declaredDependencyLockFingerprint(run, model),
    input_data_refs: [...run.input_data_refs],
    output_refs: [...run.output_refs],
    output_hash: sha256Hex(canonicalJson(outputHashMap)),
    stdout_hash: sha256Hex(outcome.stdout),
    stderr_hash: sha256Hex(outcome.stderr),
    exit_status: outcome.exitStatus,
    seed: run.seed,
    started_at: outcome.startedAt,
    finished_at: outcome.finishedAt,
  }

  // Internal sanity: the pipeline must emit schema-valid records. A miss
  // is a programming error, but the verdict stays a refusal.
  const parsed = safeParseRecord(record)
  if (!parsed.ok) {
    return {
      ok: false,
      failures: [{ kind: 'RECORD_INVALID', reason: `captured record failed schema: ${parsed.reason}` }],
    }
  }

  return { ok: true, record: parsed.value }
}

function safeParseRecord(record: unknown): { ok: true; value: ExecutionRecord } | { ok: false; reason: string } {
  const parsed = executionRecordSchema.safeParse(record)
  if (parsed.success) return { ok: true, value: parsed.data as ExecutionRecord }
  return { ok: false, reason: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }
}

function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, i) => value === sortedB[i])
}

/**
 * TASK 3 repair (3.R3 / INV-3-M): the only legal path for a captured
 * ExecutionRecord to enter the canonical store is through
 * `ModelingIr.putExecutionRecord`, which requires the
 * `CAPTURE_ATTESTATION` symbol. This module is the sole importer of
 * that symbol; an external caller cannot forge it.
 *
 *   1. `captureExecution` runs the code through the runner seam and
 *      returns a record (it does NOT touch the store — the composition
 *      decides when to commit).
 *   2. `ingestCapturedRecord(ir, record)` commits the record through
 *      the producer-only entry. This is the only sanctioned write path.
 *   3. Tests that want to simulate a forged record use a `forge*`
 *      prefix in their file name and exercise `ir.put` directly to
 *      assert the producer_required refusal (the new contract).
 */
export function ingestCapturedRecord(
  ir: ModelingIr,
  record: ExecutionRecord,
): ReturnType<ModelingIr['putExecutionRecord']> {
  return ir.putExecutionRecord(record, CAPTURE_ATTESTATION)
}