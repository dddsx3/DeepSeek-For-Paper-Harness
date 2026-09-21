/**
 * P2-1 — executor-authoritative FORMAL delivery (D7 obligation).
 *
 * The executor (not demo/run-p1-demo.mjs) is now the ONLY entry to a
 * FORMAL delivery when produceFromExecute + produceRun are mounted: the
 * EXECUTE stage runs the full production chain — deployment-owned code-run,
 * capture, dry-pass interpretation over the REAL output bytes, Result/Claim
 * minting, v1 report render — and the report text flows through the normal
 * review → FORMAL nine-gate delivery → promotion path.
 *
 * Attacks (each must be red and leave no partial Result):
 *   1. model smuggles a runnerCommand into the container run block → refused
 *      (PRODUCE_RUN_DECLARATION_INVALID; the model never chooses a command).
 *   2. interpretation reads a jsonPath that does not resolve → refused
 *      (result_source_invalid), zero partial Result writes.
 *   3. code that never produces the declared output file → capture refuses
 *      (OUTPUT_SET_MISMATCH) — nothing can claim DELIVER on an empty run.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-authoritative
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/store.ts'


/** The POLAR-ICE container, assembled the way the EXECUTE model would emit
 *  it (only structure; the numeric value lives in the code it writes). */
function polarContainer(overrides: {
  runBlock?: Record<string, unknown>
  jsonPath?: string
  code?: string
  conclusion?: string
  figures?: ReadonlyArray<Record<string, unknown>>
} = {}): string {
  const value = 0.731
  const code = overrides.code ?? [
    'const fs = require("node:fs");',
    `fs.writeFileSync("result.json", ${JSON.stringify(JSON.stringify({ mean_thickness: value }))});`,
    'console.log("run ok");',
  ].join('\n')
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      // TASK-PW W1: DA-RAW / R-OUT / P1 are harness-registered before this
      // container is applied — the model face carries only modeling-side kinds.
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean ice thickness', unit: 'm', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
      { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: 'homogeneous slab', source_type: 'MODELING_CHOICE', justification_refs: [], risk_level: 'MEDIUM', testable: false, sensitivity_refs: [], status: 'ACTIVE' } },
      { kind: 'EquationSpec', value: { equation_id: 'EQ-1', scope_ref: 'P1', expression: 'q = measured', representation: 'SYMPY', lhs_symbols: ['SYM-q'], rhs_symbols: [], equation_type: 'DEFINITION', unit: 'm', depends_on: [], source: 't1-container' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['ASM-1'], variable_refs: ['SYM-q'], parameter_refs: [], equation_refs: ['EQ-1'], constraints: [], objective: 'estimate thickness', dependencies: [] } },
    ],
    code,
    run: {
      outputBasenames: ['result.json'],
      seed: 20260903,
      ...overrides.runBlock,
    },
    interpretations: {
      results: [
        { result_id: 'RES-OUT', name: 'mean ice thickness', source: { locator: 'result.json', jsonPath: overrides.jsonPath ?? 'mean_thickness' }, unit: 'm', uncertainty: null },
      ],
      claims: [
        { claim_id: 'C-OUT', text: `mean ice thickness is ${value} m`, claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] },
      ],
      ...(overrides.figures === undefined ? {} : { figures: [...overrides.figures] }),
    },
    narrative: {
      conclusion: overrides.conclusion ?? 'Mean ice thickness is 0.731 m.',
      title: 'Polar ice',
      // W11.5 baseline-10: the production chain refuses a paper whose chapter is
      // still an unfilled placeholder (the docx pre-export gate refuses it one
      // step later), so a fixture that expects a DELIVERED paper must carry the
      // prose chapters a real container carries.
      methods: 'The regression is fitted by least squares and the mean is read from the fit.', restatement: 'The problem asks for the mean ice thickness along the survey line.',
      analysis: 'A linear regression on sonar returns estimates the mean thickness.',
      evaluation: 'The estimate is stable under subsampling; the model transfers to similar shelves.',
      references: '[1] Polar Survey Group. Sonar returns along line A. 2024.',
      code: 'The code fits the regression and writes the mean thickness to result.json.',
    },
  })
}

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}

async function* stream(text: string) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

async function harness(executeText: string | ReadonlyArray<string>) {
  // W11.5 baseline-7: an array scripts one container per EXECUTE attempt, so a
  // test can drive the retry loop (attempt 1 refused, attempt 2 fixed).
  const attempts = typeof executeText === 'string' ? [executeText] : [...executeText]
  let executeCalls = 0
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request: { system?: string; messages?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) => {
      const system = String(request.system ?? '')
      if (system.includes('reviewer')) return stream('{"defects":[]}')
      if (system.includes('editor')) return stream('revised text')
      const joined = (request.messages ?? [])
        .map((m) => {
          const c = (m as { content?: unknown }).content
          if (typeof c === 'string') return c
          if (Array.isArray(c)) {
            return c.map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text ?? '' : '')).join('')
          }
          return ''
        })
        .join(' ')
      if (joined.includes('numbered execution plan')) return stream('1. measure along the survey line')
      // P3-3: on the producing path the EXECUTE instruction carries the
      // ir-container-v1 protocol teaching segment — route on it (the old
      // plain 'Produce the deliverable' text is the non-producing path).
      if (joined.includes('Produce the deliverable') || joined.includes('ir-container-v1')) {
        const text = attempts[Math.min(executeCalls, attempts.length - 1)] ?? ''
        executeCalls += 1
        return stream(text)
      }
      return stream('revised text')
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-auth-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    // W8.9-B1: this suite pins the SINGLE-SHOT container path (its
    // tier / retry / producer / circuit-breaker semantics are defined there).
    // The E1/E2 receive layer is now the default for producing EXECUTE, so
    // the path under test must be named explicitly — omitting it would
    // silently exercise a different path than the assertions describe.
    disableE1E2: true,
    // W8.9-A4: this suite pins the SINGLE-SHOT declaration path (its tier /
    // retry / circuit-breaker semantics are defined on that path). Sharding
    // is now the default, so the path under test must be named explicitly —
    // omitting it would silently test a different path than the one the
    // assertions describe.
    disableShardDeclare: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic test', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:p21' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const }))
    .catch((error: unknown) => ({ status: 'rejected' as const, code: (error as { code?: string }).code, message: (error as { message: string }).message }))
  return { ctx, ir, engine, runId: run.id, finalRoot, outcome }
}

describe('P2-1 executor-authoritative FORMAL chain', () => {
  it('delivers POLAR-ICE end to end with Result/Claim/record in the store and a 0.731 report on disk', async () => {
    const { produceContainerInto } = await import('../src/produce/ir-producer.ts')
    // TASK-PW W1: mirror the executor's input-asset registration — the
    // model-face container references P1, which the harness registers first.
    const probeIr = new ModelingIr()
    for (const [kind, value] of [
      ['DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problems/run/task.md', content_hash: 'sha256:' + 'c'.repeat(64), media_type: 'text/markdown', description: 'Estimate mean sea-ice thickness.' }],
      ['RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'Estimate mean sea-ice thickness.' }],
      ['ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] }],
    ] as const) {
      const admitted = probeIr.put(kind, value as Record<string, unknown>)
      if (!admitted.accepted) throw new Error('registration refused: ' + String(admitted.failures[0]?.reason))
    }
    const probe = produceContainerInto(probeIr, polarContainer())
    if (!probe.ok) throw new Error(`container refused: ${probe.code}: ${probe.reason}`)
    const { ir, engine, runId, finalRoot, outcome } = await harness(polarContainer())
    expect(outcome.status, JSON.stringify(outcome)).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).toContain('RunArtifact')
    expect(kinds).toContain('ExecutionRecord')
    expect(kinds).toContain('Result')
    expect(kinds).toContain('Claim')
    // The promoted final output really landed with the machine number.
    const finalDir = join(finalRoot, String(runId), 'final')
    const files = await readdir(finalDir)
    expect(files.length).toBeGreaterThan(0)
    // W11.5 baseline-13: the executed output files now ship next to the
    // report (final/data/), so the promoted report is the first
    // NON-directory entry.
    const reportName = files.find(f => f !== 'data' && f !== 'figures')
    expect(reportName, `a report file should sit next to data/ (have: ${files.join(',')})`).toBeDefined()
    const text = await readFile(join(finalDir, reportName!), 'utf8')
    expect(text).toContain('0.731')
    const manifest = engine.getManifest(RunId(runId))
    expect(manifest).toBeDefined()
    expect(manifest!.informal).toBe(false)
    expect(manifest!.gates['review']).toBe(true)
  })

  it('attack 1: a model-injected runnerCommand is refused and the run is blocked with no Result', async () => {
    const { ir, engine, runId, outcome } = await harness(polarContainer({
      runBlock: { runnerCommand: ['python', '-c', 'x'] },
    }))
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).not.toContain('Result')
  })

  it('attack 2: an unresolvable interpretation jsonPath refuses with zero partial Result writes', async () => {
    const { ir, engine, runId, outcome } = await harness(polarContainer({ jsonPath: 'no.such.path' }))
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).not.toContain('Result')
  })

  it('attack 3: code that never produces the declared output cannot claim DELIVER', async () => {
    const { ir, engine, runId, outcome } = await harness(polarContainer({
      code: 'console.log("no output file written");',
    }))
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    expect(ir.list().filter(r => r.kind === 'Result')).toHaveLength(0)
  })

  it('W11.5 baseline-7 — a retry after a real execution converges instead of dying on its own run id', async () => {
    // 这条是第七次真实运行缺的那一步：attempt 1 真的跑了代码、铸了 Result，
    // 然后在渲染处被拒；attempt 2 必须能**再执行一次**。此前 store 的
    // RunArtifact 用同一个 run id，重试的声明直接撞 duplicate_id —— 于是
    // 「跑通了但结论写错」这种情况永远无法纠正，只能退到 E1 直通。
    const { ir, engine, runId, finalRoot, outcome } = await harness([
      polarContainer({ conclusion: 'Mean ice thickness is 0.999 m.' }),
      polarContainer(),
    ])
    expect(outcome.status, JSON.stringify(outcome)).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
    // 两次真实执行，各自一份 RunArtifact + ExecutionRecord（append-only 记录
    // 真实发生过的事），而交付文本来自第二次。
    expect(ir.list().filter(r => r.kind === 'RunArtifact')).toHaveLength(2)
    expect(ir.list().filter(r => r.kind === 'ExecutionRecord')).toHaveLength(2)
    const finalDir = join(finalRoot, String(runId), 'final')
    const files = await readdir(finalDir)
    const reportName = files.find(f => f !== 'data' && f !== 'figures')
    expect(reportName).toBeDefined()
    const text = await readFile(join(finalDir, reportName!), 'utf8')
    expect(text).toContain('0.731')
    // 尝试后缀是 store 内部的事，绝不进论文（结果表的 id 用模型自己写的名字）
    expect(text).not.toContain('-a2')
  })

  it('W11.5 baseline-7 — a conclusion number the run did not produce is refused, and the terminal reason names it', async () => {
    // 第七次真实运行：attempt 3 通过了全部保真检查、真的跑通了生产链、铸出 4 个
    // Result 和 4 条 CRITICAL Claim，随后在报告渲染处被拒——结论里写的数字
    // （29/6/76/12）不是运行算出来的（2/2/15/1）。D4 数字闭环正确拒绝，但终结
    // 理由只记了 "refused 3 times"，真正的原因（哪个 Result、哪个值）永久丢失，
    // 而且这条内容类拒绝没被归类为 DRIFT（落到 TRANSPORT），模型既拿不到针对性
    // 纠错、也没有预算。这条测试钉住：拒绝码是 conflicting_conclusion_number，
    // 且终结理由带渲染器原文（含那个不该出现的数字）。
    const { ctx, engine, runId, outcome } = await harness(polarContainer({
      conclusion: 'Mean ice thickness is 0.999 m.',
    }))
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    // `outcome` is a union: only the rejected branch carries the message.
    const refusedMessage = 'message' in outcome ? outcome.message : ''
    expect(refusedMessage).toContain('conflicting_conclusion_number')
    expect(refusedMessage).toContain('0.999')
    const terminal = ctx.paperAudit.list(runId).filter(
      (e: { eventType: string }) => e.eventType === 'gate_failed',
    )
    expect(terminal.length).toBeGreaterThan(0)
    expect(String(terminal[terminal.length - 1]?.detail?.reason)).toContain('0.999')
  })

  it('W11.5 baseline-7 — the chain refusal is classified DRIFT, so the model gets the renderer correction', async () => {
    // 同一次拒绝的**分类**侧：内容类拒绝必须是 DRIFT（容器形状正确、内容与 IR
    // 矛盾），否则它落进 TRANSPORT —— 既没有纠错提示也没有预算，模型永远听不到
    // "哪个数字不对"。审计的 provider_retry 事件是这条分类的可核证据。
    const { ctx, runId, outcome } = await harness(polarContainer({
      conclusion: 'Mean ice thickness is 0.999 m.',
    }))
    expect(outcome.status).toBe('rejected')
    const retries = ctx.paperAudit.list(runId).filter(
      (e: { eventType: string }) => e.eventType === 'provider_retry',
    )
    expect(retries.length).toBeGreaterThan(0)
    expect(String(retries[0]?.detail?.code)).toBe('conflicting_conclusion_number')
    expect(String(retries[0]?.detail?.w4Class)).toBe('DRIFT')
    // 模型可见 ⟺ 已记录：理由原文（含那个数字）在审计里
    expect(String(retries[0]?.detail?.reason)).toContain('0.999')
  })

  it('R1① — a declared figure is persisted as figures/<id>.svg next to the final output and its link resolves on disk', async () => {
    const { engine, runId, finalRoot, outcome } = await harness(polarContainer({
      figures: [
        { figure_id: 'F-OUT', chart_type: 'table', data_refs: ['RES-OUT'], caption: 'mean thickness table' },
      ],
    }))
    expect(outcome.status, JSON.stringify(outcome)).toBe('resolved')
    const finalDir = join(finalRoot, String(runId), 'final')
    const figureDir = join(finalDir, 'figures')
    const figurePath = join(figureDir, 'F-OUT.svg')
    const stat = await readFile(figurePath, 'utf8').then(() => true, () => false)
    expect(stat, 'figures/F-OUT.svg must be persisted next to the final output').toBe(true)
    const files = await readdir(finalDir)
    const reportFile = files.find(f => f !== 'figures' && f !== 'data')
    expect(reportFile, `a report file should sit next to figures/ (have: ${files.join(',')})`).toBeDefined()
    const report = await readFile(join(finalDir, reportFile!), 'utf8')
    // The rendered reference and the on-disk file agree (link resolvable).
    expect(report).toContain('figures/F-OUT.svg')
    // R1① negative control: a reference the runner did not write must not pass.
    const { brokenFigureLinks } = await import('../src/delivery/figure-links.ts')
    expect(brokenFigureLinks(report, new Set(['figures/F-OUT.svg']))).toEqual([])
    expect(brokenFigureLinks(report, new Set(['figures/OTHER.svg']))).toEqual(['figures/F-OUT.svg'])
    expect(engine.getManifest(RunId(runId))?.informal).toBe(false)
  })
})
