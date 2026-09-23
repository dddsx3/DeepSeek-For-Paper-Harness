/**
 * 上限解放架构 — **主线接线**验收。
 *
 * 这个文件回答一个具体问题：**各层是真的进了主线，还是只是躺在模块里？**
 * 每条测试都从"运行可观测的产物"取证（节点标题、prompt 内容、审计事件），
 * 而不是直接调模块——直接调模块只能证明模块本身能跑。
 *
 * harness 走**产出路径**（`produceFromExecute` + `produceRun` + 完整容器），
 * 因为探索/择优与符号通道都挂在这条链上；用非产出 harness 测它们只会得到
 * "没触发"，那不能说明任何事。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/architecture/wired-into-mainline
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PaperRuntimeGuard from '../../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  type PaperSettings,
} from '../../src/index.ts'
import { ModelingIr } from '../../src/ir/store.ts'
import { FAKE_DRAFT_TEXT } from '../fixtures/fake-draft.ts'

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}
const settings: PaperSettings = { ...routes, defaultMode: 'strict' }

/**
 * A complete, deliverable container: one declared equation whose free symbols are
 * all declared (so the L3 structural check passes), one Result read from code,
 * one figure, and the eight prose chapters.
 */
function polarContainer(): string {
  const value = 0.731
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean ice thickness', unit: 'm', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
      { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-1', scope_ref: 'P1', statement: 'homogeneous slab', source_type: 'MODELING_CHOICE', justification_refs: ['R-OUT'], risk_level: 'MEDIUM', testable: false, sensitivity_refs: [], status: 'ACTIVE' } },
      { kind: 'EquationSpec', value: { equation_id: 'EQ-1', scope_ref: 'P1', expression: 'q', representation: 'SYMPY', lhs_symbols: ['SYM-q'], rhs_symbols: [], equation_type: 'DEFINITION', unit: 'm', depends_on: [], source: 'container' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['ASM-1'], variable_refs: ['SYM-q'], parameter_refs: [], equation_refs: ['EQ-1'], constraints: [], objective: 'estimate thickness', dependencies: [] } },
    ],
    code: 'const fs = require("node:fs");\nfs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));\n',
    run: { outputBasenames: ['result.json'], seed: 1 },
    interpretations: {
      results: [{ result_id: 'RES-OUT', name: 'mean ice thickness', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm', uncertainty: null }],
      claims: [{ claim_id: 'C-OUT', text: `mean ice thickness is ${String(value)} m`, claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] }],
      figures: [{ figure_id: 'F-OUT', chart_type: 'table', data_refs: ['RES-OUT'], caption: 'mean thickness table' }],
    },
    narrative: {
      title: 'Polar ice',
      conclusion: 'Mean ice thickness is 0.731 m.',
      methods: 'The regression is fitted by least squares and the mean is read from the fit.',
      restatement: 'The problem asks for the mean ice thickness along the survey line.',
      analysis: 'A linear regression on sonar returns estimates the mean thickness.',
      evaluation: 'Advantages: the least-squares fit is simple and robust under subsampling. Limitations: it assumes a homogeneous slab and ignores lateral variation. Sensitivity: a 20% perturbation of the returns moves the estimate by under 3%. Generalization: the same regression transfers to other survey lines.',
      references: '[1] Wald A. Sequential Analysis. 1947. [2] Polar Survey Group. Sonar returns along line A. 2024. [3] Mao S. Probability and Statistics. 2011.',
      code: 'The code fits the regression and writes the mean thickness to result.json.',
    },
  })
}

async function* stream(text: string) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

async function harness(options: {
  readonly mode: 'fast' | 'strict' | 'exploratory'
  readonly reviewerOutputs?: ReadonlyArray<string>
  readonly executorConfig?: Record<string, unknown>
  /** 覆盖 select 节点的输出，用于负对照（"没比较"的记录）。 */
  readonly selectOutput?: string
}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  const prompts: string[] = []
  let reviewCalls = 0
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({
      route: { role: 'executor', ...routes.executor },
      model: { provider: 'fake', id: 'fake-model', name: 'fake-model' },
    }),
    stream: (request: { system?: string; messages?: Array<{ content?: unknown }> }) => {
      const system = String(request.system ?? '')
      const joined = (request.messages ?? []).map((m) => {
        const c = m.content
        if (typeof c === 'string') return c
        if (Array.isArray(c)) return c.map((p: { type?: string; text?: string }) => (p?.type === 'text' ? p.text ?? '' : '')).join('')
        return ''
      }).join(' ')
      prompts.push(`${system}\n${joined}`)
      if (system.includes('reviewer')) {
        const text = options.reviewerOutputs?.[reviewCalls] ?? '{"defects":[]}'
        reviewCalls += 1
        return stream(text)
      }
      if (system.includes('editor')) return stream(FAKE_DRAFT_TEXT)
      if (joined.includes('numbered execution plan')) return stream('1. draft')
      if (joined.includes('EXPLORE BEFORE YOU BUILD')) return stream('## P1\nC1: regression. C2: interpolation. C3: kriging.')
      if (joined.includes('SELECT among the sketches')) {
        // 默认返回一份**合格**的择优记录（候选数 / 选择标记 / 落选理由齐全），
        // 负对照由 `selectOutput` 覆盖。
        return stream(options.selectOutput ?? [
          '## P1',
          '候选 C1：回归。',
          '候选 C2：插值。',
          '选定 C1 —— 它直接回答"平均厚度是多少"。',
          '落选 C2：没有误差模型，无法给不确定度。',
        ].join(String.fromCharCode(10)))
      }
      if (joined.includes('ir-container-v1')) return stream(polarContainer())
      return stream(FAKE_DRAFT_TEXT)
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { ...settings, defaultMode: options.mode })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  // 一个**空** store：这样 L3 的符号一致性检查只看容器自己声明的方程。
  // 用现成的 backbone 夹具会让检查同时看到夹具里的方程，而夹具的符号表未必与
  // 其方程自洽——那测到的是夹具，不是本次运行的声明。
  ctx.provide('paperModelingIr', new ModelingIr())
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node test', timeoutMs: 30_000 },
    disableShardDeclare: true,
    disableE1E2: true,
    backoffBaseMs: 1,
    backoffCapMs: 2,
    ...options.executorConfig ?? {},
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: options.mode, harnessVersion: 'test', configHash: 'sha256:wire' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'solve this modelling problem')
    .then(() => ({ status: 'resolved' as const }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: (error as Error).message }))
  return { ctx, engine, runId: run.id, outcome, prompts }
}

describe('L5 三视角评审 — 真的进了主线', () => {
  it('strict 档：一轮评审产生 3 个评审节点，标题带各自视角短码', async () => {
    const { engine, runId, prompts } = await harness({ mode: 'strict' })
    const titles = engine.listNodes(RunId(runId)).map(n => n.title)
    expect(titles.filter(t => t.startsWith('review ')).length).toBeGreaterThanOrEqual(3)
    for (const short of ['math', 'app', 'pres']) expect(titles.some(t => t.includes(short))).toBe(true)
    const reviewPrompts = prompts.filter(p => p.includes('reviewing from ONE perspective'))
    expect(reviewPrompts.length).toBeGreaterThanOrEqual(3)
    for (const name of ['数学严格性', '应用相关性', '写作与呈现']) {
      expect(reviewPrompts.some(p => p.includes(name))).toBe(true)
    }
  }, 60_000)

  it('fast 档：一轮评审只产生 1 个评审节点（成本随档位走）', async () => {
    const { engine, runId, prompts } = await harness({ mode: 'fast' })
    const titles = engine.listNodes(RunId(runId)).map(n => n.title)
    expect(titles.filter(t => t.startsWith('review')).length).toBe(1)
    expect(prompts.some(p => p.includes('reviewing from ONE perspective'))).toBe(false)
  }, 60_000)

  it('并行评审的缺陷 id 由 harness 加前缀，因此三条缺陷**不会互相覆盖**', async () => {
    // 三个视角**故意**都返回 id "D1"——前缀若是 prompt 约定，这里就会静默丢两条。
    const { engine, runId } = await harness({
      mode: 'strict',
      reviewerOutputs: [
        '{"defects":[{"id":"D1","severity":"major","description":"推导与方程不一致"}]}',
        '{"defects":[{"id":"D1","severity":"major","description":"没有回答题目第二问"}]}',
        '{"defects":[{"id":"D1","severity":"minor","description":"段首以图作主语"}]}',
      ],
    })
    const defects = engine.listEvents(RunId(runId)).filter(e => e.type === 'defect')
    const descriptions = defects.map(d => String(d.data.description))
    expect(descriptions).toContain('推导与方程不一致')
    expect(descriptions).toContain('没有回答题目第二问')
    expect(descriptions).toContain('段首以图作主语')
    const ids = defects.map(d => String(d.data.defectId))
    for (const short of ['math-', 'app-', 'pres-']) expect(ids.some(i => i.startsWith(short))).toBe(true)
  }, 60_000)
})

describe('L2 探索—择优 — 真的进了主线', () => {
  it('strict 档：EXECUTE 之前有 explore 与 select 两个 plan 节点，顺序正确', async () => {
    const { engine, runId } = await harness({ mode: 'strict' })
    const titles = engine.listNodes(RunId(runId)).map(n => n.title)
    expect(titles).toContain('explore')
    expect(titles).toContain('select')
    expect(titles.indexOf('explore')).toBeLessThan(titles.indexOf('select'))
    expect(titles.indexOf('select')).toBeLessThan(titles.indexOf('execute'))
  }, 60_000)

  it('explore 的 prompt 要求"动笔之前先比较"，且明说方法选择自由', async () => {
    const { prompts } = await harness({ mode: 'strict' })
    const explore = prompts.find(p => p.includes('EXPLORE BEFORE YOU BUILD'))
    expect(explore).toBeDefined()
    expect(explore).toContain('2–3 candidate approaches')
    expect(explore).toContain('Method choice is entirely yours')
  }, 60_000)

  it('select 的 prompt 要求四维打分 + 选择理由 + 落选理由', async () => {
    const { prompts } = await harness({ mode: 'strict' })
    const select = prompts.find(p => p.includes('SELECT among the sketches'))
    expect(select).toBeDefined()
    expect(select).toContain('correctness risk')
    expect(select).toContain('why each rejected candidate lost')
  }, 60_000)

  it('择优结论被注入 EXECUTE 的 prompt（不是只在节点里跑完就丢）', async () => {
    const { prompts } = await harness({ mode: 'strict' })
    const execute = prompts.find(p => p.includes('Method decision record'))
    expect(execute, 'EXECUTE 没有拿到决策记录——择优的产物被丢掉了').toBeDefined()
    expect(execute).toContain('选定 C1')
  }, 60_000)

  it('fast 档不跑探索（成本随档位走），EXECUTE 里也没有决策记录', async () => {
    const { engine, runId, prompts } = await harness({ mode: 'fast' })
    const titles = engine.listNodes(RunId(runId)).map(n => n.title)
    expect(titles).not.toContain('explore')
    expect(prompts.some(p => p.includes('Method decision record'))).toBe(false)
  }, 60_000)

  it('显式关闭时也不跑（选项可覆盖档位默认）', async () => {
    const { engine, runId } = await harness({ mode: 'strict', executorConfig: { exploreDeepen: false } })
    expect(engine.listNodes(RunId(runId)).map(n => n.title)).not.toContain('explore')
  }, 60_000)
})

describe('L3 符号证据通道 — 真的进了主线', () => {
  it('交付链跑完后审计里有 symbolic_channel_run，级别是 structural_check', async () => {
    const { ctx, runId, outcome } = await harness({ mode: 'fast' })
    expect(outcome.status, (outcome as { message?: string }).message).toBe('resolved')
    const event = ctx.paperAudit.list(RunId(runId)).find(e => e.eventType === 'symbolic_channel_run')
    expect(event, '符号通道没有跑——它挂在交付链上，链跑通就必须有这条审计').toBeDefined()
    expect(event?.detail?.level).toBe('structural_check')
    expect(Number(event?.detail?.claims ?? 0)).toBeGreaterThan(0)
    expect(Number(event?.detail?.passed ?? 0)).toBeGreaterThan(0)
  }, 60_000)
})

describe('L4 结构指纹 — 真的进了主线', () => {
  it('交付链审计了模型的结构指纹（换方法/增删方程/调假设看得见）', async () => {
    const { ctx, runId, outcome } = await harness({ mode: 'fast' })
    expect(outcome.status, (outcome as { message?: string }).message).toBe('resolved')
    const event = ctx.paperAudit.list(RunId(runId)).find(e => e.eventType === 'structure_fingerprint')
    expect(event, '结构指纹没有落审计——L4 的语义类复验就没有"修复前"这一端').toBeDefined()
    expect(String(event?.detail?.struct_hash ?? '').length).toBeGreaterThan(8)
    expect(Number(event?.detail?.equations ?? 0)).toBeGreaterThan(0)
  }, 60_000)
})

describe('L2 择优记录的机械检查 — 真的进了主线', () => {
  it('择优记录不合格时，explore_deepen 门禁记违规并注入微教学', async () => {
    // select 节点返回一份**没有比较**的记录（只有一个候选、没有落选理由）。
    const { ctx, runId } = await harness({ mode: 'strict', selectOutput: '选定 C1，它更好。' })
    const event = ctx.paperAudit.list(RunId(runId)).find(e => e.eventType === 'explore_select_completed')
    expect(event).toBeDefined()
    const defects = event?.detail?.defects
    expect(Array.isArray(defects)).toBe(true)
    expect((defects as ReadonlyArray<string>).some(d => d.startsWith('EX-'))).toBe(true)
    const transitions = ctx.paperAudit.list(RunId(runId))
      .filter(e => e.eventType === 'gate_state_changed' && e.detail?.gate === 'explore_deepen')
    expect(transitions.length).toBeGreaterThan(0)
  }, 60_000)

  it('择优记录合格时零缺陷（不误报）', async () => {
    const { ctx, runId } = await harness({ mode: 'strict' })
    const event = ctx.paperAudit.list(RunId(runId)).find(e => e.eventType === 'explore_select_completed')
    expect((event?.detail?.defects as ReadonlyArray<string>) ?? []).toEqual([])
  }, 60_000)
})

describe('L6 门禁状态机 — 真的进了主线', () => {
  it('评审缺陷被记进状态机，首次违规注入微教学并审计', async () => {
    const { ctx, runId } = await harness({
      mode: 'exploratory',
      reviewerOutputs: ['{"defects":[{"id":"D1","severity":"major","description":"模型评价章节篇幅不足"}]}'],
      executorConfig: { reviewPersonas: 1 },
    })
    const transitions = ctx.paperAudit.list(RunId(runId)).filter(e => e.eventType === 'gate_state_changed')
    const taught = transitions.filter(e => e.detail?.taught === true)
    expect(taught.length).toBeGreaterThan(0)
    expect(String(taught[0]?.detail?.gate)).toBe('prose_contract')
  }, 60_000)

  it('微教学真的进了修订轮的 prompt（不是只记了个审计事件）', async () => {
    const { prompts } = await harness({
      mode: 'exploratory',
      reviewerOutputs: [
        '{"defects":[{"id":"D1","severity":"major","description":"模型评价章节篇幅不足"}]}',
        '{"defects":[]}',
      ],
      executorConfig: { reviewPersonas: 1 },
    })
    const revise = prompts.find(p => p.includes('Targeted corrections'))
    expect(revise, '修订轮没拿到针对性微教学——状态机只记了账没接线').toBeDefined()
    expect(revise).toContain('writing-norms.md')
  }, 60_000)

  it('运行收口时状态机快照落审计（"这次被收紧到什么程度"可回答）', async () => {
    const { ctx, runId } = await harness({ mode: 'exploratory' })
    const snapshot = ctx.paperAudit.list(RunId(runId))
      .filter(e => e.eventType === 'gate_state_changed')
      .find(e => e.detail?.modes !== undefined)
    expect(snapshot).toBeDefined()
    expect(snapshot?.detail?.tier).toBeDefined()
  }, 60_000)
})
