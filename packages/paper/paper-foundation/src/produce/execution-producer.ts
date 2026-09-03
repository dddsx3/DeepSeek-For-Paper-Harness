/**
 * P1-2 — execution-capture production wiring.
 *
 * Turns a P1-1 container's `code` payload into a REAL executed run: the
 * component declares the RunArtifact (the model can never mint hashes or
 * exit statuses — DISCIPLINE/P1-2 attack surface), runs the code through
 * the LocalProcessRunner seam, captures the ExecutionRecord and commits it
 * through `ingestCapturedRecord` (the only sanctioned door, INV-3-M).
 *
 * This is the FIRST production caller of the capture door (task book P1-2:
 * "capture.ts's ingestCapturedRecord obtains its first production caller").
 * Before P1-4 upgrades the `execution` gate, the acceptance here is: a real
 * node child runs, its record lands in canonical IR, and the provenance
 * gate reads it. The output bytes are returned so a later stage (P1-3) can
 * turn the run's result file into a canonical Result.
 *
 * v0 field notes (documented, not silent): with no external input data the
 * RunArtifact declares `input_data_refs: []` and a `sha256:'no-input-data'`
 * sentinel input_hash; `exit_status: 0` is the run's declared expectation
 * (a non-zero real exit makes the capture disagree -> STALE, per S-003
 * measurement-source semantics); the run's `output_hash` is derived from
 * `declaredOutputBytes` when the caller can predict the output (deterministic
 * code), else a zero-sha marker that P1-3's Result flow supersedes.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce
 */

import { ModelingIr } from '../ir/store.ts'
import { LocalProcessRunner } from '../execution/runner.ts'
import { captureExecution, ingestCapturedRecord } from '../execution/capture.ts'
import { sha256Hex, canonicalJson } from '../ir/index.ts'
import { executionRecordSchema } from '../ir/schema.ts'

export interface RunExecutionInput {
  readonly ir: ModelingIr
  /** id of the new RunArtifact (the composition/executor owns the namespace). */
  readonly runId: string
  /** the container's ModelSpec id this run is an instance of. */
  readonly modelRef: string
  readonly codeText: string
  /** declared execution environment, e.g. the runner's node version. */
  readonly environment: string
  readonly seed?: number | null
  readonly outputBasenames: ReadonlyArray<string>
  readonly outputLocators: ReadonlyArray<string>
  readonly runnerCommand: ReadonlyArray<string>
  readonly runnerEntryFile: string
  readonly timeoutMs: number
  readonly environmentFactsCommands?: ReadonlyArray<ReadonlyArray<string>>
  /** When the caller can predict the run's outputs (deterministic code),
   *  map locator -> bytes; the run declares the derived output_hash. */
  readonly declaredOutputBytes?: ReadonlyMap<string, string>
}

export type RunExecutionVerdict =
  | { ok: true; runArtifactId: string; executionId: string }
  | { ok: false; code: string; reason: string }

const NO_INPUT_HASH = sha256Hex('no-input-data')

/**
 * Declare + run + capture one real execution. Never throws on a hostile
 * container: every contradiction is a refusal verdict carrying a stable
 * code and a reason that names the offending field.
 */
export async function produceRunExecution(input: RunExecutionInput): Promise<RunExecutionVerdict> {
  const { ir, runId } = input
  const codeRef = `file:///runs/${runId}/${input.runnerEntryFile}`
  const codeHash = `sha256:${sha256Hex(input.codeText)}`

  // Declared output fingerprint, when predictable.
  let outputHash = `sha256:${'0'.repeat(64)}`
  if (input.declaredOutputBytes !== undefined) {
    const map: Record<string, string> = {}
    for (const [locator, bytes] of input.declaredOutputBytes) map[locator] = sha256Hex(bytes)
    outputHash = sha256Hex(canonicalJson(map))
  }

  const runArtifact = {
    run_id: runId,
    model_ref: input.modelRef,
    code_ref: codeRef,
    input_data_refs: [] as string[],
    environment: input.environment,
    seed: input.seed ?? null,
    exit_status: 0,
    stdout_ref: `file:///runs/${runId}/stdout.txt`,
    stderr_ref: `file:///runs/${runId}/stderr.txt`,
    output_refs: [...input.outputLocators],
    code_hash: codeHash,
    input_hash: NO_INPUT_HASH,
    output_hash: outputHash,
  }

  const admitted = ir.put('RunArtifact', runArtifact)
  if (!admitted.accepted) {
    const failure = admitted.failures[0]
    return {
      ok: false,
      code: 'run_declaration_refused',
      reason: failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused the RunArtifact declaration',
    }
  }

  const runner = new LocalProcessRunner({
    command: [...input.runnerCommand],
    entryFile: input.runnerEntryFile,
    outputBasenames: [...input.outputBasenames],
    outputLocators: [...input.outputLocators],
    timeoutMs: input.timeoutMs,
    ...(input.environmentFactsCommands === undefined
      ? {}
      : { environmentFactsCommands: input.environmentFactsCommands.map(c => [...c]) }),
  })

  const executionId = `EXEC-${input.runId}`
  const captured = await captureExecution({
    ir,
    runRef: runId,
    executionId,
    runner,
    loadCode: async () => input.codeText,
    timeoutMs: input.timeoutMs,
  })
  if (!captured.ok) {
    const failure = captured.failures[0]
    return {
      ok: false,
      code: failure?.kind ?? 'capture_failed',
      reason: failure !== undefined ? failure.reason : 'capture failed',
    }
  }
  if (executionRecordSchema.safeParse(captured.record).success !== true) {
    return { ok: false, code: 'RECORD_INVALID', reason: 'captured record failed its schema' }
  }
  const committed = ingestCapturedRecord(ir, captured.record)
  if (!committed.accepted) {
    const failure = committed.failures[0]
    return {
      ok: false,
      code: 'record_commit_refused',
      reason: failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused the captured record',
    }
  }
  return { ok: true, runArtifactId: runId, executionId }
}
