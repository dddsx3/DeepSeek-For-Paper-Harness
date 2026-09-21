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

export interface CaptureOutputFile {
  readonly locator: string
  readonly bytes: string
}

export type ExecutionCaptureResult =
  | {
    readonly ok: true
    readonly record: ExecutionRecord
    /** P1-3: the REAL produced output bytes, so a downstream stage can
       *  turn the run's result file into a canonical Result. */
    readonly outputs: ReadonlyArray<CaptureOutputFile>
  }
  | { readonly ok: false; readonly failures: ReadonlyArray<ExecutionCaptureFailure> }

/**
 * The declaration fields capture attests a run against.
 *
 * W11.5 baseline-6 (首次真实产出实测): capture originally read these off the
 * RunArtifact already in the store, which forced the caller to commit the
 * declaration BEFORE the code ran. A run that then failed left that
 * declaration behind as a phantom — `RunArtifact` with no `ExecutionRecord`
 * — and `deriveDirectStale` reads exactly that as a permanent
 * `EXECUTION_MISMATCH` ("no ExecutionRecord for this run"), so the next
 * attempt could neither re-declare the id (duplicate_id) nor clear the stale
 * gate. The declaration is now an INPUT: the caller builds it, capture
 * attests against it, and the store is written only once the run really
 * happened.
 */
export interface RunDeclaration {
  readonly code_ref: string
  readonly code_hash: string
  readonly model_ref: string
  readonly input_data_refs: ReadonlyArray<string>
  readonly output_refs: ReadonlyArray<string>
  readonly seed: string | number | null
  /**
   * Fingerprinted into the record's `environment_hash` and re-derived from the
   * store by the stale engine — it must be the exact value the committed
   * RunArtifact carries, or `deriveDirectStale` reads a different fingerprint
   * and flags EXECUTION_MISMATCH on a run that was in fact fine.
   */
  readonly environment: string
}

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
  /**
   * Attest against this declaration instead of the store's RunArtifact.
   *
   * The checks are IDENTICAL — code bytes must hash to `code_hash`, the
   * produced output set must equal `output_refs`, the model must resolve —
   * only their source moves. Nothing is weakened: the model never supplies
   * any of these fields (the producer builds them from the deployment-owned
   * runner command and the container's declared basenames), and a fabricated
   * record still cannot enter the store except through
   * `ingestCapturedRecord`'s producer-only door.
   */
  readonly runDeclaration?: RunDeclaration
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

  // The declaration comes from the caller when it has not committed the
  // RunArtifact yet (the production chain's normal path: declare AFTER the
  // run), and from the store otherwise (every pre-existing caller, and the
  // RUN_MISSING attack).
  let run: RunDeclaration
  if (input.runDeclaration !== undefined) {
    run = input.runDeclaration
  } else {
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
    run = runRecord.value as RunDeclaration
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
    // W11.5 baseline-2 (首次真实产出实测): the mismatch alone hid the real
    // cause — the model's code had a SYNTAX ERROR (a bare `S-P1:` object key)
    // and died at parse time, producing nothing. A non-zero exit is the fact
    // that tells the next attempt what to fix, so it travels WITH the
    // mismatch (模型可见 ⟺ 已记录): exit code + the stderr tail.
    //
    // W11.5 baseline-6 (首次真实产出实测): the same reasoning cut the other
    // way — the message then blamed "语法/运行错误" for a child that was
    // KILLED (exit -1, empty stderr, no output files: the sixth real run's
    // attempt 1). A terminated child and a crashing child are different
    // diagnoses and lead to different corrections, so the signal decides
    // which one is reported.
    const stderrTail = outcome.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300)
    // `typeof === 'string'` rather than `!== null`: a runner that omits the
    // field (an untyped implementation) must read as "exited on its own", the
    // pre-signal behaviour, never as a kill by an unnamed signal.
    const killedBy = typeof outcome.signal === 'string' ? outcome.signal : null
    const crash = killedBy !== null
      ? `；runner KILLED the child with ${killedBy} after ${elapsedMs(outcome)}ms (no exit code) — the production runner's only termination path is its wall-clock budget (${input.timeoutMs}ms), so the code did not finish in time. Make the computation cheaper (fewer samples/steps, smaller grids) and write the output file EARLY, before the expensive part（超时被杀，不是语法错误）`
      : outcome.exitStatus !== 0
        ? `；runner exited ${outcome.exitStatus}${stderrTail === '' ? '' : ` — stderr: ${stderrTail}`}（代码很可能有语法/运行错误：先修代码，再核对声明输出）`
        : ''
    failures.push({
      kind: 'OUTPUT_SET_MISMATCH',
      reason: `runner produced [${produced.join(',')}] but RunArtifact.output_refs declares [${run.output_refs.join(',')}]${crash}`,
    })
    return { ok: false, failures }
  }

  const modelRecord = store.get(run.model_ref)
  const model = modelRecord !== undefined && modelRecord.kind === 'ModelSpec'
    ? modelRecord.value as Record<string, unknown>
    : undefined
  // The fingerprint helpers read the declaration's own fields, so they take it
  // as an open record; `RunDeclaration` is a closed interface and needs the
  // widening here (it has no index signature by design).
  const runFields = { ...run } as Record<string, unknown>

  const outputHashMap: Record<string, string> = {}
  for (const file of outcome.outputFiles) {
    outputHashMap[file.locator] = sha256Hex(file.bytes)
  }

  const record = {
    execution_id: input.executionId,
    run_ref: input.runRef,
    code_hash: run.code_hash,
    environment_hash: declaredEnvironmentFingerprint(runFields),
    runtime_fingerprint_hash: sha256Hex(canonicalJson(outcome.runtimeFacts)),
    dependency_lock_hash: declaredDependencyLockFingerprint(runFields, model),
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

  return {
    ok: true,
    record: parsed.value,
    outputs: outcome.outputFiles.map(f => ({ locator: f.locator, bytes: f.bytes })),
  }
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

/** Measured wall-clock of one outcome, rounded to whole milliseconds. */
function elapsedMs(outcome: { startedAt: string; finishedAt: string }): number {
  const started = Date.parse(outcome.startedAt)
  const finished = Date.parse(outcome.finishedAt)
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return 0
  return Math.max(0, Math.round(finished - started))
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
  // Loose by design (mirrors `putExecutionRecord`): the seam
  // schema-validates whatever crosses it, and forged / partial /
  // overridden record shapes must be expressible to prove the runtime
  // refusal paths (RT-X1..RT-X3). The real producer's output satisfies
  // the closed schema, so this widening costs nothing on the happy path.
  record: Record<string, unknown>,
): ReturnType<ModelingIr['putExecutionRecord']> {
  return ir.putExecutionRecord(record, CAPTURE_ATTESTATION)
}
