/**
 * 阶段链的服务层 —— **真的接进 provider 缝了吗**（S6 的验收）。
 *
 * `runner.ts` 刻意不碰 provider，所以"模块做好"和"进了主线"之间隔着一层。
 * 这个文件证明那层真的接上了：
 * - `callModel` 走 `paperProvider.stream`（**同一条**被审计、被预算约束的缝）；
 * - 确定性阶段走真执行体（不是假夹具）；
 * - 暂停 = 跑到指定阶段就停；续跑 = 从第一份缺失/已作废的通行证继续；
 * - `skillDocs: true` 在这条路径上**拒绝启动**（没有工具回路，挂了开关等于
 *   点名一份取不到的语料——round-5 的原缺陷）。
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { PaperFoundationService, PaperProviderService, PaperSettingsService, STAGE_CHAIN_SYSTEM, countProblems } from '../../src/index.ts'
// `resumePointOf` **不能**从 index 拿：`runtime/stage-checkpoint.ts` 也导出一个同名函数
// （交付链的 5 阶段切片续跑点），两同名导出撞在一起，`import { resumePointOf }` 拿到的是
// 哪个就成了碰运气——这条用例第一版因此拿到的永远是 null（切片根里没有切片）。
import { PaperStageChainService, resumePointOf } from '../../src/stages/stage-service.ts'
import { readPassport } from '../../src/stages/handoff.ts'
import { STAGES, stageOf } from '../../src/stages/registry.ts'

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}

/** 每个阶段一段**合规**的回答（单产出取原文，多产出取 JSON 信封）。 */
function answerFor(stage: string): string {
  const envelope = (files: Record<string, string>): string => JSON.stringify({ files })
  const analysis = [
    '# 赛题分析',
    '[[ASSUMPTION: A-X]] 假设一。',
    '[[REQUIREMENT: R-Q1]] 问题一要求给出结果。',
    '[[REQUIREMENT: R-Q2]] 问题二要求给出结果。',
    '<!-- BEGIN FIGURE_MANIFEST -->',
    'DATA=1',
    'fig_a',
    'DRAWIO=1',
    'fig_roadmap',
    '<!-- END FIGURE_MANIFEST -->',
    '<!-- BEGIN ARCH_DECLARATION -->',
    JSON.stringify({
      fig_roadmap: {
        style_family: 'A',
        direction: 'vertical',
        layers: [{ label: '问题1', nodes: [{ id: 'n1', label: '常物性场求解' }] }, { label: '问题2', nodes: [{ id: 'n2', label: '变物性耦合' }] }],
        edges: [{ from: 'n1', to: 'n2' }],
      },
    }),
    '<!-- END ARCH_DECLARATION -->',
    '正文……'.repeat(120),
  ].join('\n')
  switch (stage) {
    case 'prob-analysis':
      return envelope({
        'PROBLEM_ANALYSIS.md': analysis,
        'CAPABILITY_CHECKLIST.json': JSON.stringify({ items: [{ id: 'CAP-1', required_output: '结果', machine_check: '问题1 给出结果表', source_sentence: '问题一要求给出结果' }] }),
        'PROBLEM_FACTS.json': JSON.stringify({ facts: [{ name: '参数', value: 1, unit: 'm', raw_quote: '参数为 1 m' }] }),
        'DATA_PROFILE.json': JSON.stringify({ rows: 10, columns: 3, numeric_columns: 2 }),
      })
    case 'modeling':
      return envelope({
        // 逐条认领阶段 1 的能力项（门禁 `modeling_coverage` 按 id 逐字核）
        'DECLARATION.json': JSON.stringify({ entries: [], models: [{ id: 'MS-1', checklist_refs: ['CAP-1'] }] }),
        'MODELING_REPORT.md': '建模报告……'.repeat(200),
      })
    case 'code':
      // 数不由模型持有：模型只声明数在哪（RESULT_SOURCES），main.py 写出产物，
      // harness 真跑它并从产物字节里铸出账本。
      return envelope({
        'code/main.py': [
          'import json',
          'json.dump({"a": 3.5, "b": 9.25}, open("outputs.json", "w"))',
          '',
        ].join('\n'),
        'code/problem1.py': 'print(1)\n',
        'code/problem2.py': 'print(2)\n',
        'RESULTS.md': '结果说明……'.repeat(90),
        'DELIVERABLES.json': JSON.stringify({ deliverables: [{ file: 'code/main.py', kind: 'other', min_bytes: 500, desc: '编排入口' }] }),
      })
    case 'result-sources':
      // 单产出 → 原文。只声明"数在哪"，不写数值。
      return JSON.stringify({
        sources: [
          { result_id: 'RES-A', name: '指标A', locator: 'outputs.json', json_path: 'a', unit: '%' },
          { result_id: 'RES-B', name: '指标B', locator: 'outputs.json', json_path: 'b', unit: '%' },
        ],
      })
    case 'figure-declare':
      // 单产出 → 原文。只声明结构；数在阶段 3 铸出的账本里。
      return JSON.stringify({
        figures: [
          { figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A', 'RES-B'], caption: '指标对照', y_label: '占比 / %' },
        ],
      })
    case 'review':
      return envelope({
        'COMP_REVIEW.md': '复核……'.repeat(40),
        'COMP_REVIEW_VERDICT.json': JSON.stringify({ findings: [], fatal_count: 0 }),
      })
    case 'paper':
      return ['# 论文', '## 摘要', '本文……'.repeat(20), '## 1 问题重述', '中'.repeat(800 * 21), '## 8 模型评价与推广', '优点……'.repeat(30), '## 参考文献', '[1] Wald A. Sequential Analysis. 1947.', '[2] 姜启源. 数学模型. 2011.', '[3] Crank J. The Mathematics of Diffusion. 1975.'].join('\n')
    case 'improve':
      return envelope({
        'PAPER_IMPROVEMENT_STATE.json': JSON.stringify({ rounds: [{ defects: 0 }], termination: 'approved' }),
        'paper/_improvement_rounds/round1.md': '# 第 1 轮\n',
      })
    case 'format-profile':
      // ≥300 字节且是合法 JSON 对象（阶段 9 的判据）——太薄会被 `profile_valid_json` 拒。
      return JSON.stringify({
        profile_name: '用户文字要求派生样式',
        _derived_from: 'text-description',
        _matched_items: ['正文内容：小四号(12pt)宋体，单倍行距(1.0)', '正文一级标题：四号(14pt)黑体，居中'],
        page: { size: 'A4', margin_top_cm: 2.5, margin_bottom_cm: 2.5, margin_left_cm: 2.5, margin_right_cm: 2.5 },
        fonts: { chinese_heading: 'SimHei', chinese_body: 'SimSun', latin: 'Times New Roman', monospace: 'Consolas' },
        headings: { level1_pt: 14, level2_pt: 12, level3_pt: 12, bold: true, level1_alignment: 'center' },
        body: { font_size_pt: 12, line_spacing: 1.0, first_line_indent_chars: 2 },
        table: { font_size_pt: 10.5, header_bold: true, top_border_pt: 1.5 },
        references: { hanging_indent_cm: 0.74, font_size_pt: 10.5 },
        image: { max_width_cm: 14, alignment: 'center' },
        code_block: { font_size_pt: 9, line_spacing: 1.0 },
      })
    default:
      throw new Error(`fixture has no answer for stage '${stage}'`)
  }
}

async function harness(options: { readonly pauseAfter?: ReadonlyArray<string>; readonly skillDocs?: boolean; readonly problemCount?: number } = {}) {
  const stagesRoot = await mkdtemp(join(tmpdir(), 'dsh-stage-svc-'))
  const ctx = new Context()
  const prompts: string[] = []
  let auditCalls = 0
  ctx.provide('paperProvider', {
    stream: (request: { system?: string; messages?: ReadonlyArray<{ content?: unknown }> }) => {
      const prompt = (request.messages ?? []).map((m) => {
        const c = m.content
        if (typeof c === 'string') return c
        return Array.isArray(c) ? c.map((p: { text?: string }) => p?.text ?? '').join('') : ''
      }).join('\n')
      prompts.push(`${String(request.system ?? '')}\n${prompt}`)
      // **逐节点审计**的提示词与执行者的简报形态完全不同（它是独立审计员视角，
      // 只给契约与产物）——夹具必须分别作答，否则审计会因拿不到合法 JSON 而记 `2`。
      if (prompt.includes('你是**独立审计员**')) {
        auditCalls += 1
        const auditText = JSON.stringify({
          verdict: 'pass', score: 0.85, structure_ok: true,
          requirement_compliance: [{ item: '产出契约', done: true, note: '产物齐备且非空' }],
          findings: [], missing: [],
        })
        return (async function* () {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: auditText }
          yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
        })()
      }
      const m = /stages\/(\d\d)-([a-z-]+)\//.exec(prompt)
      const stage = m?.[2] ?? ''
      const text = answerFor(stage)
      return (async function* () {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'text-delta', index: 0, text: '' }
        yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
      })()
    },
  } as never)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(PaperProviderService)
  await ctx.plugin(PaperSettingsService, { ...routes, defaultMode: 'strict' })
  await ctx.plugin(PaperStageChainService, {
    stagesRoot,
    ...(options.pauseAfter === undefined ? {} : { pauseAfter: options.pauseAfter as never }),
    ...(options.skillDocs === undefined ? {} : { skillDocs: options.skillDocs }),
    // 阶段 3 分片：问数 2 → 入口 1 + 逐问 2 + 收尾 1 = 4 次调用（都走 provider 缝）
    ...(options.problemCount === undefined ? {} : { problemCount: options.problemCount }),
  })
  return { ctx, stagesRoot, prompts, auditCalls: () => auditCalls }
}

describe('阶段链服务 —— 真的接进了 provider 缝', () => {
  it('11 个阶段跑完；模型调用走的是 provider 缝（简报真的发出去了）；确定性阶段真的产出了图', async () => {
    const { ctx, stagesRoot, prompts, auditCalls } = await harness({ problemCount: 2 })
    const outcomes = await ctx.paperStageChain.run()
    expect(outcomes).toHaveLength(13)
    expect(outcomes.every(o => o.status === 'passed' || o.status === 'passed-unverified')).toBe(true)

    // **缝的证据**：每个模型阶段的简报都经 `paperProvider.stream` 发出，
    // 且带的是阶段链的系统提示词（不是别的角色的）。
    const modelStages = STAGES.filter(s => s.kind === 'model')
    expect(modelStages.length).toBe(9)
    // **逐节点审计真的进了主线**（用户新增约束）：每个模型阶段一次独立审计调用
    expect(auditCalls(), '逐节点审计没有被调用——模块做好不等于进了主线').toBe(9)
    // 审计结论落在通行证上（可事后追"这一轮是谁审的、判了多少分"）
    const modelingPassport = await readPassport(stagesRoot, stageOf('modeling'))
    expect(modelingPassport?.audit?.score).toBeCloseTo(0.85, 5)
    expect(modelingPassport?.audit?.verdict).toBe('pass')
    // 阶段 3 分片：问数 2 → 4 次调用（入口 + problem1 + problem2 + 收尾信封）
    const codeCalls = prompts.filter(p => p.includes('stages/03-code/'))
    expect(codeCalls.length).toBe(4)
    expect(codeCalls.filter(p => p.includes('只产出 `code/problem1.py`')).length).toBe(1)
    // 简报调用 = 模型阶段数 − 1（阶段 3 分片成 4 次）+ 3 次额外分片；审计调用另算
    const briefCalls = prompts.filter(p => !p.includes('你是**独立审计员**'))
    expect(briefCalls.length).toBe(modelStages.length - 1 + 4)
    for (const p of prompts) expect(p).toContain(STAGE_CHAIN_SYSTEM)
    for (const s of modelStages) expect(prompts.some(p => p.includes(`stages/${String(s.index).padStart(2, '0')}-${s.id}/`))).toBe(true)

    // 确定性阶段不是"没挂上"：图真的在磁盘上（阶段 5 渲染、阶段 6 架构图）。
    const figureDir = join(stagesRoot, '06-figure', 'figures')
    await expect(readFile(join(figureDir, 'fig_a.svg'), 'utf8')).resolves.toContain('<svg')
    await expect(readFile(join(stagesRoot, '07-diagram', 'figures', 'fig_roadmap.svg'), 'utf8')).resolves.toContain('<svg')
    // 账本是 harness 铸的（真跑了 python main.py），不是模型文本里抄来的。
    const ledger = JSON.parse(await readFile(join(stagesRoot, '04-result-sources', 'results.json'), 'utf8')) as {
      results: ReadonlyArray<{ result_id: string; value: number }>
    }
    expect(ledger.results.map(r => r.result_id)).toEqual(['RES-A', 'RES-B'])
    expect(ledger.results.every(r => Number.isFinite(r.value))).toBe(true)
  }, 120_000)

  it('暂停 = 跑到指定阶段就停（之后的阶段不跑、不签发）', async () => {
    const { ctx, stagesRoot, prompts, auditCalls } = await harness({ pauseAfter: ['code'] })
    const outcomes = await ctx.paperStageChain.runUntilPause()
    expect(outcomes.map(o => o.stage)).toEqual(['prob-analysis', 'modeling', 'code'])
    // 阶段 4 的模型阶段数 = 3（prob-analysis/modeling/code），之后的一个都没发。
    // 计数只算**简报**调用：每个模型阶段还会额外发一次逐节点审计（那是设计要求的）。
    const briefs = prompts.filter(p => !p.includes('你是**独立审计员**'))
    expect(briefs.length).toBe(3)
    expect(auditCalls()).toBe(3)  // 三个模型阶段各审计一次
    expect(prompts.some(p => p.includes('08-review'))).toBe(false)
    // 没跑的阶段没有产物
    await expect(readFile(join(stagesRoot, '06-figure', 'figure-manifest.json'), 'utf8')).rejects.toThrow()
  }, 120_000)

  it('续跑 = 从第一份缺失的通行证继续，并把剩下的跑完', async () => {
    const { ctx, stagesRoot, prompts } = await harness({ pauseAfter: ['code'] })
    await ctx.paperStageChain.runUntilPause()
    expect(prompts.filter(p => !p.includes('你是**独立审计员**')).length).toBe(3)
    expect(await resumePointOf(stagesRoot)).toBe('result-sources')

    const resumed = await ctx.paperStageChain.resume()
    expect(resumed.from).toBe('result-sources')
    expect(resumed.outcomes.map(o => o.stage)).toEqual(STAGES.filter(s => s.index >= 4).map(s => s.id))
    expect(resumed.outcomes.every(o => o.status === 'passed' || o.status === 'passed-unverified')).toBe(true)
    // 全部就绪 → 没有续跑点
    expect(await resumePointOf(stagesRoot)).toBeNull()
  }, 180_000)

  it('题面问数从 00-input/problem.txt 数出来（不是猜的）', async () => {
    const { ctx } = await harness()
    expect(countProblems('## 问题1\n…\n## 问题2\n…\n## 问题3\n…')).toBe(3)
    expect(countProblems('第 2 问要求…')).toBe(2)
    expect(countProblems('没有任何编号')).toBe(0)
    // 链真的跑起来时，problemCount 来自服务读到的题面（这条夹具没有 00-input → 0）
    const outcomes = await ctx.paperStageChain.run()
    const code = outcomes.find(o => o.stage === 'code')
    expect(code?.gate.items.find(i => i.id === 'code_parity')?.detail).toContain('题面问数未知')
  }, 180_000)

  it('skillDocs=true → **拒绝启动**并说明原因（没有工具回路，挂了开关等于点名取不到的语料）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-stage-svc-'))
    const ctx = new Context()
    await ctx.plugin(PaperFoundationService)
    await ctx.plugin(PaperProviderService)
    await ctx.plugin(PaperSettingsService, { ...routes, defaultMode: 'strict' })
    expect(() => new PaperStageChainService(ctx, { stagesRoot: root, skillDocs: true })).toThrow(/工具回路/)
  })

  it('缺 stagesRoot → 拒绝挂载（产物与通行证必须落盘，否则暂停/续跑无从谈起）', async () => {
    const ctx = new Context()
    await ctx.plugin(PaperFoundationService)
    await ctx.plugin(PaperProviderService)
    await ctx.plugin(PaperSettingsService, { ...routes, defaultMode: 'strict' })
    expect(() => new PaperStageChainService(ctx, { stagesRoot: '' })).toThrow(/stagesRoot/)
  })

  it('阶段 id 的取值域与注册表一致（防两处各写一份）', () => {
    expect(stageOf('prob-analysis').id).toBe('prob-analysis')
    expect(STAGES).toHaveLength(13)
  })
})
