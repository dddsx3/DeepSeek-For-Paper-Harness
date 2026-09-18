/**
 * W8.10-C1 — DP-4 spike probe (READ-ONLY).
 *
 * Question: at RUNTIME, can the harness CAPTURE numeric configuration
 * (`dt` / `N` / `solver_config`) rather than parse it out of model prose?
 *
 * Method: drive the real production chain — a real node child writes the
 * config numbers into a declared output file; the harness reads them back
 * through the ONE existing numeric channel (`code -> jsonPath -> Result`).
 * Four sections:
 *
 *   A  capture scalars (dt / N / solver_config.method / solver_config.rtol)
 *   B  attack: jsonPath aimed at the WHOLE solver_config object
 *   C  attack: a `dt` key in the container's `run` block
 *   D  delivery: does the declared `seed` actually reach the child process?
 *
 * Nothing under packages/ or apps/ is written. All state is in-process.
 */

const ROOT = '../../../packages/paper/paper-foundation'
const { ModelingIr } = await import(`${ROOT}/src/ir/store.ts`)
const { produceRunExecution } = await import(`${ROOT}/src/produce/execution-producer.ts`)
const { produceInterpretation, resolveJsonPath } = await import(`${ROOT}/src/produce/interpretation-producer.ts`)
const { parseModelContainer } = await import(`${ROOT}/src/produce/ir-producer.ts`)
const fx = await import(`${ROOT}/tests/ir/fixtures.ts`)

const RUN_ID = 'RUN-DP4'
const LOCATOR = `file:///runs/${RUN_ID}/result.json`

// The code the model declares. It is the SOLE writer of the config numbers.
// Note: the literal numbers below live inside `code` (the executable fragment),
// which is exactly what the zero-number channel permits.
const CODE = [
  'const fs = require("node:fs");',
  'const config = { dt: 0.25, N: 200, solver_config: { method: "RK4", rtol: 1e-6, atol: 1e-9 } };',
  'fs.writeFileSync("result.json", JSON.stringify({ config, mean_thickness: 0.731 }));',
  'console.log("run ok");',
].join('\n')

/** Seed the contract chain the run needs (harness-registered side + model face). */
function seedContract(ir: InstanceType<typeof ModelingIr>): void {
  ir.put('DataArtifact', fx.dataArtifact())
  ir.put('RequirementSpec', fx.requirementSpec())
  ir.put('RequirementSpec', fx.requiredOutput())
  ir.put('RequirementSpec', fx.constraintRequirement())
  ir.put('ProblemSpec', fx.problemSpec())
  const container = JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    code: CODE,
    entries: [
      { kind: 'SymbolSpec', value: fx.variableSymbol() },
      { kind: 'SymbolSpec', value: fx.parameterSymbol() },
      { kind: 'AssumptionSpec', value: fx.assumptionSpec() },
      { kind: 'EquationSpec', value: fx.equationSpec() },
      { kind: 'ModelSpec', value: fx.modelSpec() },
    ],
  })
  const parsed = parseModelContainer(container)
  if (!parsed.ok) throw new Error(`container parse failed: ${parsed.reason}`)
  for (const entry of parsed.container.entries) {
    const put = ir.put(entry.kind as never, entry.value)
    if (!put.accepted) throw new Error(`seed failed ${entry.kind}: ${JSON.stringify(put.failures)}`)
  }
}

function newIr(): InstanceType<typeof ModelingIr> {
  const ir = new ModelingIr({ now: () => '2026-09-18T00:00:00.000Z' })
  seedContract(ir)
  return ir
}

async function runOnce(ir: InstanceType<typeof ModelingIr>, seed: number | null = 20260903) {
  return produceRunExecution({
    ir,
    runId: RUN_ID,
    modelRef: 'M1',
    codeText: CODE,
    environment: 'node',
    seed,
    outputBasenames: ['result.json'],
    outputLocators: [LOCATOR],
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
    environmentFactsCommands: [['node', '-p', 'process.version']],
  })
}

const line = (s: string) => console.log(s)

// ===========================================================================
line('=== SECTION A: capture dt / N / solver_config.* via jsonPath ===')
{
  const ir = newIr()
  const executed = await runOnce(ir)
  if (!executed.ok) {
    line(`A: RUN REFUSED ${executed.code}: ${executed.reason}`)
  } else {
    line(`A: real node child ran; run=${executed.runArtifactId} exec=${executed.executionId}`)
    const raw = executed.outputs.find(o => o.locator === LOCATOR)?.bytes ?? ''
    line(`A: real output bytes = ${raw}`)

    const declaredPaths: Array<[string, string]> = [
      ['RES-DT', 'config.dt'],
      ['RES-N', 'config.N'],
      ['RES-RTOL', 'config.solver_config.rtol'],
      ['RES-ATOL', 'config.solver_config.atol'],
    ]
    const minted = produceInterpretation({
      ir,
      runId: RUN_ID,
      interpretations: {
        results: declaredPaths.map(([id, p]) => ({
          result_id: id,
          name: p,
          source: { locator: LOCATOR, jsonPath: p },
          unit: 'dimensionless',
        })),
      },
      outputs: executed.outputs,
    })
    if (!minted.ok) {
      line(`A: INTERPRETATION REFUSED ${minted.code}: ${minted.reason}`)
    } else {
      line(`A: minted result ids = [${minted.resultIds.join(', ')}]`)
      const wanted = new Map(declaredPaths)
      for (const record of ir.list()) {
        if (record.kind !== 'Result') continue
        const v = record.value as { result_id: string; name: string; value: number; unit: string; source_location: string }
        const declaredPath = wanted.get(v.result_id)
        const fromBytes = resolveJsonPath(JSON.parse(raw), declaredPath ?? '')
        const agrees = fromBytes === v.value
        line(`A:   ${v.result_id.padEnd(12)} name=${v.name.padEnd(26)} value=${String(v.value).padEnd(8)} canonical_agrees_with_bytes=${agrees} src=${v.source_location}`)
      }
      line(`A: VERDICT — ${declaredPaths.length} scalar config numbers captured from executed bytes, model prose never consulted`)
    }
  }
}

// ===========================================================================
line('')
line('=== SECTION A2: string-valued config (solver_config.method) — is it capturable? ===')
{
  const ir = newIr()
  const executed = await runOnce(ir)
  if (!executed.ok) {
    line(`A2: RUN REFUSED ${executed.code}: ${executed.reason}`)
  } else {
    const minted = produceInterpretation({
      ir,
      runId: RUN_ID,
      interpretations: {
        results: [{
          result_id: 'RES-METHOD',
          name: 'config.solver_config.method',
          source: { locator: LOCATOR, jsonPath: 'config.solver_config.method' },
          unit: 'dimensionless',
        }],
      },
      outputs: executed.outputs,
    })
    line(minted.ok
      ? `A2: ACCEPTED — ${JSON.stringify(minted)}`
      : `A2: REFUSED ${minted.code}: ${minted.reason}`)
    line('A2: VERDICT — a non-numeric config value has NO Result-shaped carrier in the current IR')
  }
}

// ===========================================================================
line('')
line('=== SECTION A3: does the whole solver_config object survive as ONE Result? ===')
{
  const ir = newIr()
  const executed = await runOnce(ir)
  if (!executed.ok) {
    line(`A3: RUN REFUSED ${executed.code}: ${executed.reason}`)
  } else {
    const raw = executed.outputs.find(o => o.locator === LOCATOR)?.bytes ?? ''
    const doc = JSON.parse(raw) as Record<string, unknown>
    const cfg = (doc['config'] as Record<string, unknown>)['solver_config']
    line(`A3: the executed bytes DO carry the object verbatim: ${JSON.stringify(cfg)}`)
    line('A3: it is reachable by resolveJsonPath but has no typed carrier (Result.value is zod.number())')
    const hashed = await import(`${ROOT}/src/ir/index.ts`)
    line(`A3: sha256 of the config subtree = sha256:${hashed.sha256Hex(JSON.stringify(cfg))} (hashable -> could be fingerprinted)`)
  }
}

// ===========================================================================
line('')
line('=== SECTION A4: boundary — config the code did NOT write cannot be captured ===')
{
  const ir = newIr()
  const executed = await runOnce(ir)
  if (!executed.ok) {
    line(`A4: RUN REFUSED ${executed.code}: ${executed.reason}`)
  } else {
    const minted = produceInterpretation({
      ir,
      runId: RUN_ID,
      interpretations: {
        results: [{
          result_id: 'RES-NEVER-WRITTEN',
          name: 'config.dx',
          source: { locator: LOCATOR, jsonPath: 'config.dx' },
          unit: 'm',
        }],
      },
      outputs: executed.outputs,
    })
    line(minted.ok
      ? `A4: ACCEPTED (unexpected) ${JSON.stringify(minted)}`
      : `A4: REFUSED ${minted.code}: ${minted.reason}`)
    line('A4: VERDICT — capture is CONDITIONAL on the code emitting the number; there is no side channel')
  }
}

// ===========================================================================
line('')
line('=== SECTION A5: M5-shaped design — code writes config.json as its own output ===')
{
  const cfgCode = [
    'const fs = require("node:fs");',
    '// config is chosen INSIDE the executable fragment (the zero-number channel',
    '// permits literals here and nowhere else).',
    'const dt = 0.25, N = 200, solver_config = { method: "RK4", rtol: 1e-6 };',
    'fs.writeFileSync("config.json", JSON.stringify({ dt, N, solver_config }));',
    'fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
    'console.log("run ok");',
  ].join('\n')
  const ir = new ModelingIr({ now: () => '2026-09-18T00:00:00.000Z' })
  ir.put('DataArtifact', fx.dataArtifact())
  ir.put('RequirementSpec', fx.requirementSpec())
  ir.put('RequirementSpec', fx.requiredOutput())
  ir.put('RequirementSpec', fx.constraintRequirement())
  ir.put('ProblemSpec', fx.problemSpec())
  for (const [kind, value] of [
    ['SymbolSpec', fx.variableSymbol()],
    ['SymbolSpec', fx.parameterSymbol()],
    ['AssumptionSpec', fx.assumptionSpec()],
    ['EquationSpec', fx.equationSpec()],
    ['ModelSpec', fx.modelSpec()],
  ] as Array<[string, Record<string, unknown>]>) {
    ir.put(kind as never, value)
  }
  const CFG_LOC = 'file:///runs/RUN-DP4-CFG/config.json'
  const RES_LOC = 'file:///runs/RUN-DP4-CFG/result.json'
  const executed = await produceRunExecution({
    ir,
    runId: 'RUN-DP4-CFG',
    modelRef: 'M1',
    codeText: cfgCode,
    environment: 'node',
    seed: 20260903,
    outputBasenames: ['config.json', 'result.json'],
    outputLocators: [CFG_LOC, RES_LOC],
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
  })
  if (!executed.ok) {
    line(`A5: RUN REFUSED ${executed.code}: ${executed.reason}`)
  } else {
    line(`A5: two declared outputs produced: [${executed.outputs.map(o => o.locator).join(', ')}]`)
    line('A5: NOTE — produceInterpretation requires CANONICAL locators; the basename')
    line('A5:        form is resolved by normalizeInterpretationLocators in the executor')
    line('A5:        (executor.ts). Calling the producer directly must pass canonical form.')
    const minted = produceInterpretation({
      ir,
      runId: 'RUN-DP4-CFG',
      interpretations: {
        results: [
          { result_id: 'RES-CFG-DT', name: 'dt', source: { locator: CFG_LOC, jsonPath: 'dt' }, unit: 's' },
          { result_id: 'RES-CFG-N', name: 'N', source: { locator: CFG_LOC, jsonPath: 'N' }, unit: 'dimensionless' },
          { result_id: 'RES-CFG-RTOL', name: 'solver_config.rtol', source: { locator: CFG_LOC, jsonPath: 'solver_config.rtol' }, unit: 'dimensionless' },
        ],
      },
      outputs: executed.outputs,
    })
    if (!minted.ok) {
      line(`A5: INTERPRETATION REFUSED ${minted.code}: ${minted.reason}`)
    } else {
      for (const record of ir.list()) {
        if (record.kind !== 'Result') continue
        const v = record.value as { result_id: string; name: string; value: number; unit: string; source_location: string }
        line(`A5:   ${v.result_id.padEnd(14)} ${v.name.padEnd(18)} = ${String(v.value).padEnd(9)} ${v.unit.padEnd(14)} ${v.source_location}`)
      }
      const runRec = ir.get('RUN-DP4-CFG')?.value as { code_hash: string } | undefined
      line(`A5: VERDICT — the M5 shape WORKS: config is a first-class run output,`)
      line(`A5:           captured by jsonPath, pinned by RunArtifact.code_hash = ${String(runRec?.code_hash).slice(0, 20)}…`)
    }
  }
}

// ===========================================================================
line('')
line('=== SECTION B: attack — jsonPath aimed at the WHOLE solver_config object ===')
{
  const ir = newIr()
  const executed = await runOnce(ir)
  if (!executed.ok) {
    line(`B: RUN REFUSED ${executed.code}: ${executed.reason}`)
  } else {
    const minted = produceInterpretation({
      ir,
      runId: RUN_ID,
      interpretations: {
        results: [{
          result_id: 'RES-CFG-OBJECT',
          name: 'solver_config (whole object)',
          source: { locator: LOCATOR, jsonPath: 'config.solver_config' },
          unit: 'dimensionless',
        }],
      },
      outputs: executed.outputs,
    })
    line(minted.ok
      ? `B: ACCEPTED — object captured as a Result: ${JSON.stringify(minted)}`
      : `B: REFUSED ${minted.code}: ${minted.reason}`)
    const written = ir.list().filter(r => r.kind === 'Result').length
    line(`B: Results written to canonical store = ${written} (0 means the refusal is atomic)`)
  }
}

// ===========================================================================
line('')
line('=== SECTION C: attack — a `dt` key inside the container run block ===')
{
  const container = JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    code: CODE,
    run: { outputBasenames: ['result.json'], seed: 20260903, dt: 0.25 },
    entries: [{ kind: 'SymbolSpec', value: fx.variableSymbol() }],
  })
  const parsed = parseModelContainer(container)
  line(`C: parseModelContainer accepted = ${parsed.ok} (run block is schema-open at parse time)`)
  if (parsed.ok) {
    line(`C: run block seen by the parser = ${JSON.stringify(parsed.container.run)}`)
  }
  line('C: the closure check lives in executor.ts runProductionChain (allowedRunKeys) — see file:line in the report')
}

// ===========================================================================
line('')
line('=== SECTION D: delivery — does the declared seed reach the child process? ===')
{
  const probeCode = [
    'const fs = require("node:fs");',
    'const seedEnv = Object.keys(process.env).filter(k => /seed/i.test(k)).map(k => k + "=" + process.env[k]);',
    'fs.writeFileSync("result.json", JSON.stringify({',
    '  seed_env: seedEnv,',
    '  argv: process.argv.slice(2),',
    '  all_env_keys: Object.keys(process.env).sort(),',
    '}));',
    'console.log("probe ok");',
  ].join('\n')
  const ir = new ModelingIr({ now: () => '2026-09-18T00:00:00.000Z' })
  ir.put('DataArtifact', fx.dataArtifact())
  ir.put('RequirementSpec', fx.requirementSpec())
  ir.put('RequirementSpec', fx.requiredOutput())
  ir.put('RequirementSpec', fx.constraintRequirement())
  ir.put('ProblemSpec', fx.problemSpec())
  for (const entry of [fx.variableSymbol(), fx.parameterSymbol(), fx.assumptionSpec(), fx.equationSpec(), fx.modelSpec()] as Array<Record<string, unknown>>) {
    const kind = 'symbol_id' in entry ? 'SymbolSpec' : 'assumption_id' in entry ? 'AssumptionSpec' : 'equation_id' in entry ? 'EquationSpec' : 'ModelSpec'
    const put = ir.put(kind as never, entry)
    if (!put.accepted) line(`D: seed warn ${kind}: ${JSON.stringify(put.failures)}`)
  }
  const executed = await produceRunExecution({
    ir,
    runId: 'RUN-DP4-SEED',
    modelRef: 'M1',
    codeText: probeCode,
    environment: 'node',
    seed: 20260903,
    outputBasenames: ['result.json'],
    outputLocators: ['file:///runs/RUN-DP4-SEED/result.json'],
    runnerCommand: ['node', 'main.js'],
    runnerEntryFile: 'main.js',
    timeoutMs: 30_000,
  })
  if (!executed.ok) {
    line(`D: RUN REFUSED ${executed.code}: ${executed.reason}`)
  } else {
    const bytes = executed.outputs[0]?.bytes ?? ''
    line(`D: child-visible seed material = ${bytes}`)
    const declared = ir.get('RUN-DP4-SEED')?.value as { seed?: unknown } | undefined
    line(`D: RunArtifact.seed (declared, canonical) = ${JSON.stringify(declared?.seed)}`)
    const rec = ir.list().find(r => r.kind === 'ExecutionRecord')?.value as { seed?: unknown } | undefined
    line(`D: ExecutionRecord.seed (captured)      = ${JSON.stringify(rec?.seed)}`)
  }
}

line('')
line('=== SECTION E: real executor — a container whose run block carries dt ===')
{
  const { Context } = await import('@deepseek-ai/cordis')
  const Storage = (await import('@deepseek-ai/dsh-storage')).default
  const { MemoryMediaPool, MemoryStorageBackend } = await import(`${ROOT}/../../storage/storage-domain/tests/helpers/memory-backend.ts`)
  const { DomainFacility } = await import('@deepseek-ai/dsh-storage-domain')
  const PaperRuntimeGuard = (await import(`${ROOT}/src/runtime/runtime-guard.ts`)).default
  const { createExploratoryProfile } = await import(`${ROOT}/src/runtime/profile.ts`)
  const svc = await import(`${ROOT}/src/index.ts`)
  const { mkdtemp } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')

  // The container the model would emit if it tried to DECLARE its config.
  const container = JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean ice thickness', unit: 'm', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
      { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: 'homogeneous slab', source_type: 'MODELING_CHOICE', justification_refs: [], risk_level: 'MEDIUM', testable: false, sensitivity_refs: [], status: 'ACTIVE' } },
      { kind: 'EquationSpec', value: { equation_id: 'EQ-1', scope_ref: 'P1', expression: 'q = measured', representation: 'SYMPY', lhs_symbols: ['SYM-q'], rhs_symbols: [], equation_type: 'DEFINITION', unit: 'm', depends_on: [], source: 'dp4' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['ASM-1'], variable_refs: ['SYM-q'], parameter_refs: [], equation_refs: ['EQ-1'], constraints: [], objective: 'estimate thickness', dependencies: [] } },
    ],
    code: 'const fs=require("node:fs");fs.writeFileSync("result.json",JSON.stringify({mean_thickness:0.731}));console.log("run ok");',
    run: { outputBasenames: ['result.json'], seed: 20260903, dt: 0.25 },
    interpretations: {
      results: [{ result_id: 'RES-OUT', name: 'mean ice thickness', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm' }],
      claims: [{ claim_id: 'C-OUT', text: 'mean ice thickness is 0.731 m', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] }],
    },
    narrative: { title: 'DP4', conclusion: 'Mean ice thickness is 0.731 m.' },
  })

  async function* stream(text: string) {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
  }
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(svc.PaperFoundationService)
  await ctx.plugin(svc.WorkflowEngineService)
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request: { system?: string; messages?: Array<{ content?: unknown }> }) => {
      const system = String(request.system ?? '')
      if (system.includes('reviewer')) return stream('{"defects":[]}')
      if (system.includes('editor')) return stream('revised text')
      const joined = (request.messages ?? []).map((m) => {
        const c = (m as { content?: unknown }).content
        if (typeof c === 'string') return c
        if (Array.isArray(c)) return c.map((p: { type?: string; text?: string }) => (p?.type === 'text' ? p.text ?? '' : '')).join('')
        return ''
      }).join(' ')
      if (joined.includes('numbered execution plan')) return stream('1. measure along the survey line')
      if (joined.includes('ir-container-v1') || joined.includes('Produce the deliverable')) return stream(container)
      return stream('revised text')
    },
  })
  await ctx.plugin(svc.PaperSettingsService, {
    executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
    reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
    editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
    defaultMode: 'strict',
  })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  ctx.provide('paperModelingIr', new ModelingIr())
  await ctx.plugin(svc.PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-dp4-'))
  await ctx.plugin(svc.PaperExecutorService, {
    produceFromExecute: true,
    disableE1E2: true,
    disableShardDeclare: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 dp4', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:wtier' })
  try {
    await ctx.paperExecutor.runs.execute(svc.RunId(run.id), 'estimate ice thickness')
    line('E: executor RESOLVED (run-block dt was accepted — unexpected)')
  } catch (error) {
    const e = error as { code?: string; message?: string }
    line(`E: executor REJECTED code=${e.code ?? '(none)'}`)
    line(`E: message = ${String(e.message).split('\n')[0].slice(0, 400)}`)
  }
}

line('')
line('=== SECTION F: is there a DECLARED-number channel (model pen -> canonical store)? ===')
{
  const ir = new ModelingIr({ now: () => '2026-09-18T00:00:00.000Z' })
  // Fresh store: M1 must not already exist (seedContract registers one).
  for (const [kind, value] of [
    ['DataArtifact', fx.dataArtifact()],
    ['RequirementSpec', fx.requirementSpec()],
    ['RequirementSpec', fx.requiredOutput()],
    ['RequirementSpec', fx.constraintRequirement()],
    ['ProblemSpec', fx.problemSpec()],
    ['SymbolSpec', fx.variableSymbol()],
    ['SymbolSpec', fx.parameterSymbol({ token: 'dt', meaning: 'time step', unit: 's' })],
    ['AssumptionSpec', fx.assumptionSpec()],
    ['EquationSpec', fx.equationSpec()],
  ] as Array<[string, Record<string, unknown>]>) {
    const r = ir.put(kind as never, value)
    if (!r.accepted) line(`F: seed ${kind} REFUSED = ${JSON.stringify(r.failures)}`)
  }
  // SymbolSpecs are registered above; ModelSpec can now reference them.
  const declared = ir.put('ModelSpec', fx.modelSpec({
    variable_refs: ['SYM-x'],
    parameter_refs: [{ symbol_ref: 'SYM-rho', value: 0.25 }],
  }))
  line(`F: ModelSpec.parameter_refs[].value = 0.25 accepted = ${declared.accepted}`)
  if (declared.accepted) {
    const stored = ir.get('M1')?.value as { parameter_refs?: Array<{ symbol_ref: string; value: number }> }
    line(`F: stored in canonical store = ${JSON.stringify(stored.parameter_refs)}`)
  } else {
    line(`F: failures = ${JSON.stringify(declared.failures)}`)
  }
  line('F: NOTE — this number came from the MODEL PEN, not from a run. It is a')
  line('F:        DECLARATION channel, not a CAPTURE channel. It is also not')
  line('F:        bound to any RunArtifact (no field links it to the executed config).')
}

line('')
line('=== probe done ===')
