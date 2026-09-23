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
import { IR_SCHEMAS, executionRecordSchema } from '../ir/schema.ts'
import { validateRefFields } from '../ir/refs.ts'
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

/**
 * 成功产出的形态。`configGaps` 非空表示 `numeric_config.json` 里有键锚不到任何
 * 已声明的 SymbolSpec（模型用了某个量却没声明它）——**部分准入**，缺口如实上报。
 */
export interface RunExecutionOutput {
  readonly runArtifactId: string
  readonly executionId: string
  readonly outputs: ReadonlyArray<{ readonly locator: string; readonly bytes: string }>
  readonly configGaps?: ReadonlyArray<string>
}

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
    /**
     * `numeric_config.json` 里锚不到已声明 SymbolSpec 的键（**部分准入**的缺口）。
     * 非空表示模型的符号表不全——如实上报，进 L6 的已知缺陷表，**不是**链的失败。
     */
    configGaps?: ReadonlyArray<string>
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

  // W11.5 baseline-6 (首次真实产出实测): the declaration is pre-validated but
  // NOT committed here. Committing it up front made a failed run permanent:
  // attempt 1 of the sixth real run declared this RunArtifact, its code then
  // crashed (runner exited -1, produced no output), and the store was left
  // holding a RunArtifact that claims a successful execution with two outputs
  // that do not exist. Two consequences, both real: the retry's re-declaration
  // was refused as `duplicate_id` (a false failure — the refused attempt's
  // state is not authoritative), and `stale_detection` read the phantom as a
  // permanent `EXECUTION_MISMATCH` ("no ExecutionRecord for this run"), so the
  // run could never be graded CLEAN again. The order is now: validate the
  // declaration, run, and only then declare + commit the record.
  const preFlight = preValidateRunDeclaration(ir, runArtifact)
  if (preFlight !== null) {
    return { ok: false, code: 'run_declaration_refused', reason: preFlight }
  }

  // The runner's phase trace (spawned? entry file written? killed?) is the
  // only evidence that separates "the child never started" from "the child
  // ran and died" — keep the tail of it and attach it to a refusal, so the
  // next real run is diagnosable from the audit instead of inferred.
  const runnerTrace: string[] = []
  const runner = new LocalProcessRunner({
    command: [...input.runnerCommand],
    entryFile: input.runnerEntryFile,
    outputBasenames: [...input.outputBasenames],
    outputLocators: [...input.outputLocators],
    timeoutMs: input.timeoutMs,
    trace: (message: string) => { runnerTrace.push(message) },
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
    runDeclaration: {
      code_ref: codeRef,
      code_hash: codeHash,
      model_ref: input.modelRef,
      input_data_refs: [],
      output_refs: [...input.outputLocators],
      seed: input.seed ?? null,
      environment: input.environment,
    },
  })
  if (!captured.ok) {
    const failure = captured.failures[0]
    return {
      ok: false,
      code: failure?.kind ?? 'capture_failed',
      reason: `${failure !== undefined ? failure.reason : 'capture failed'}${traceTail(runnerTrace)}`,
    }
  }
  if (executionRecordSchema.safeParse(captured.record).success !== true) {
    return { ok: false, code: 'RECORD_INVALID', reason: 'captured record failed its schema' }
  }

  // The run really happened — only now does the declaration become a
  // statement about the world, and only now is it written. Its `output_hash`
  // is the record's measured one unless the caller predicted the bytes (a
  // deterministic code's forecast, which then stands as declared).
  const declared = input.declaredOutputBytes === undefined
    ? { ...runArtifact, output_hash: captured.record.output_hash }
    : runArtifact
  const admitted = ir.put('RunArtifact', declared)
  if (!admitted.accepted) {
    const failure = admitted.failures[0]
    return {
      ok: false,
      code: 'run_declaration_refused',
      reason: failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused the RunArtifact declaration',
    }
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
  // 配置缺口：声明在块外，因为它在返回里要带出去（块内只是赋值）。
  let unresolvedKeys: ReadonlyArray<string> = []
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
    // 部分准入（四轮实测的修法）：能锚定的键照常准入，锚不了的作为**缺口**返回，
    // 由调用方记成 finding —— 不再整条链拒掉。
    //
    // 原来的判据是 `!built.ok → configRefusal(...)`，理由是"不得静默降级"。那条
    // 理由仍然成立，所以缺口**必须被记录**；但代价不该是"这一轮的全部产出"——
    // 而 `numeric_config.json` 在宪法里本来就写着 **SHOULD**，把它当 MUST 硬拒，
    // 本身就是优先级错配。
    if (!built.ok) {
      if (built.ok === false) {
        const failure = built.failures[0]
        return configRefusal('CONFIG_EMISSION_INVALID', failure !== undefined ? failure.reason : 'the config emission could not be materialized')
      }
    }
    const configAdmitted = ir.put('NumericConfig', built.config)
    if (!configAdmitted.accepted) {
      const failure = configAdmitted.failures[0]
      return configRefusal('CONFIG_EMISSION_REFUSED', failure !== undefined ? `${failure.kind}: ${failure.reason}` : 'store refused the captured NumericConfig')
    }
    // 缺口如实上报：这些键锚不到任何已声明的 SymbolSpec，说明**符号表不全**
    // （模型用了某个量却没声明它）。它进 L6 的已知缺陷表。
    unresolvedKeys = built.ok === 'partial' ? built.failures.map(f => f.reason) : []
  }
  return {
    ok: true,
    runArtifactId: runId,
    executionId,
    outputs: captured.outputs.map(o => ({ locator: o.locator, bytes: o.bytes })),
    // 配置缺口（可能为空）。调用方把它记成 finding，进 L6 的已知缺陷表——
    // **缺口被记录**，而不是"整条链归零"。见上面 `unresolvedKeys` 的注释。
    ...(unresolvedKeys.length === 0 ? {} : { configGaps: unresolvedKeys }),
  }
}

/**
 * The last few runner phase lines, formatted for a refusal reason.
 *
 * Bounded on purpose: the refusal travels to the model AND to the audit, and
 * the audit already keeps a 400-character excerpt of the reason.
 */
function traceTail(trace: ReadonlyArray<string>): string {
  if (trace.length === 0) return ''
  return ` [runner: ${trace.slice(-4).join(' / ').slice(0, 300)}]`
}

/**
 * Validate the RunArtifact declaration WITHOUT committing it, so a
 * declaration the store would refuse is refused before any code runs.
 *
 * Why this exists at all: `produceRunExecution` no longer commits the
 * declaration up front (W11.5 baseline-6 — see the call site), but the
 * "nothing runs for a declaration that cannot be admitted" property must
 * survive the reordering. The checks are the store's own: the closed schema
 * plus the declared reference fields (a `model_ref` that resolves to no
 * ModelSpec is the case the acceptance test pins). They are re-run by the
 * store at commit time, so a rule added there and missed here can only make
 * the chain run code it then refuses — fail-closed, never fail-open.
 *
 * @returns a `<kind>: <reason>` string in the store's refusal shape, or
 *          `null` when the declaration is admissible.
 */
function preValidateRunDeclaration(ir: ModelingIr, declaration: Record<string, unknown>): string | null {
  const parsed = IR_SCHEMAS.RunArtifact.safeParse(declaration)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const at = issue !== undefined && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    return `schema_violation: ${at}${issue?.message ?? 'invalid'}`
  }
  const id = String(declaration['run_id'] ?? '')
  if (ir.kindOf(id) !== undefined) {
    // With the declaration moved after the run, an id already in the store
    // means an EARLIER attempt of this run got as far as executing: its
    // declaration is committed and the store is append-only, so this
    // attempt's declaration cannot land. Refuse here rather than after
    // spending another execution on it.
    return `duplicate_id: id '${id}' is already registered as ${String(ir.kindOf(id))} — an earlier attempt of this run already executed and its declaration is committed (the store is append-only; a run id names one execution)`
  }
  const problems = validateRefFields('RunArtifact', parsed.data, ref => ir.kindOf(ref))
  const first = problems[0]
  if (first !== undefined) {
    const expected = first.target === 'ANY' ? 'any registered object' : String(first.target)
    return first.resolution === 'missing'
      ? `unresolved_reference: ${first.path}: '${first.ref}' is not registered (expected ${expected})`
      : `reference_kind_mismatch: ${first.path}: '${first.ref}' resolves to ${String(first.actual)}, expected ${expected}`
  }
  return null
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
