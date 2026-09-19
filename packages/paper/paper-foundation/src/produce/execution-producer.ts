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
// M-QUAL (W10) DP-4: the execution-time config capture. The code emits
// `numeric_config.json` among its declared outputs; after capture verifies
// the output set, the emission's bytes (already covered by the record's
// output_hash) are materialized into a canonical NumericConfig whose
// run_ref closes the ownership edge (append-only topology).
import {
  NUMERIC_CONFIG_EMISSION_BASENAME,
  numericConfigEmissionSchema,
  numericConfigFromEmission,
} from '../ir/numeric-config.ts'

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
  | {
    ok: true
    runArtifactId: string
    executionId: string
    /** P1-3: the REAL produced output bytes for interpretation. */
    outputs: ReadonlyArray<import('./interpretation-producer.ts').OutputBytes>
  }
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
  // M-QUAL (W10) DP-4 — execution-time config capture (N19: config objects
  // enter through "code emit"). When the run declares and produces
  // `numeric_config.json`, its bytes (covered by the record's output_hash)
  // are materialized into a canonical NumericConfig. A DECLARED emission
  // that fails to parse/resolve refuses the chain (the model retries) —
  // "I said I emit a config" must never silently degrade to "no config".
  // A run that never declares the emission simply leaves the config
  // contract inactive (config-consistency.ts documents the phase-in).
  const emissionFile = captured.outputs.find(o => o.locator.endsWith(NUMERIC_CONFIG_EMISSION_BASENAME))
  if (emissionFile !== undefined) {
    const configRefusal = (code: string, reason: string) => ({ ok: false as const, code, reason })
    let emissionJson: unknown
    try {
      emissionJson = JSON.parse(emissionFile.bytes)
    } catch {
      return configRefusal('CONFIG_EMISSION_INVALID', `${NUMERIC_CONFIG_EMISSION_BASENAME} is not valid JSON — a declared config emission must be machine-readable, not prose`)
    }
    const emission = numericConfigEmissionSchema.safeParse(emissionJson)
    if (!emission.success) {
      return configRefusal('CONFIG_EMISSION_INVALID', `${NUMERIC_CONFIG_EMISSION_BASENAME} failed its closed schema: ${emission.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
    }
    const scopeRefs = modelProblemScopes(ir, input.modelRef)
    const symbols = declaredSymbols(ir, scopeRefs)
    const built = numericConfigFromEmission({
      configId: `NC-${input.runId}`,
      runRef: input.runId,
      scopeRefs,
      emission: emission.data,
      symbols,
    })
    if (!built.ok) {
      const failure = built.failures[0]
      return configRefusal('CONFIG_EMISSION_TOKEN_UNRESOLVED', failure !== undefined ? failure.reason : 'the config emission could not be materialized')
    }
    const configAdmitted = ir.put('NumericConfig', built.config)
    if (!configAdmitted.accepted) {
      const failure = configAdmitted.failures[0]
      return configRefusal('CONFIG_EMISSION_REFUSED', failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused the captured NumericConfig')
    }
  }
  return {
    ok: true,
    runArtifactId: runId,
    executionId,
    outputs: captured.outputs.map(o => ({ locator: o.locator, bytes: o.bytes })),
  }
}

/** The problem ids the named model belongs to (the token-resolution scope). */
function modelProblemScopes(ir: ModelingIr, modelRef: string): ReadonlyArray<string> {
  const snapshot = ModelingIr.snapshot(ir)
  if (snapshot === null) return []
  const model = snapshot.get(modelRef)
  if (model === undefined || model.kind !== 'ModelSpec') return []
  return [...(model.value as { problem_refs: ReadonlyArray<string> }).problem_refs]
}

/** Declared symbols scoped to any of `scopeRefs` (token -> SymbolSpec id). */
function declaredSymbols(ir: ModelingIr, scopeRefs: ReadonlyArray<string>): ReadonlyArray<{
  symbol_id: string
  token: string
  scope_ref: string
}> {
  const out: Array<{ symbol_id: string; token: string; scope_ref: string }> = []
  if (scopeRefs.length === 0) return out
  const scopes = new Set(scopeRefs)
  const snapshot = ModelingIr.snapshot(ir)
  if (snapshot === null) return out
  for (const record of snapshot.values()) {
    if (record.kind !== 'SymbolSpec') continue
    const symbol = record.value as { symbol_id: string; token: string; scope_ref: string }
    if (scopes.has(symbol.scope_ref)) {
      out.push({ symbol_id: symbol.symbol_id, token: symbol.token, scope_ref: symbol.scope_ref })
    }
  }
  return out
}
