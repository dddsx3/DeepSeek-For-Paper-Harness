/**
 * 阶段执行器 —— 逐阶段门禁 + 通行证 + 失败语义。
 *
 * 用**假调用器**驱动完整条链（不花模型调用），但**确定性阶段用真执行体**
 * （`deterministicRunner()`）——否则"阶段 4/5/10/11 的执行体真的进了主线"这件事
 * 没有任何断言证明它，而那正是本项目反复吃过的亏（模块做好 ≠ 进了主线）。
 *
 * 夹具必须是**真实产物的样子**：第一版这三条用例被 `it.skip` 掉，原因写在当时的
 * 注释里——"不是断言写错，是夹具还满足不了真实门禁"。现在夹具长成了真实形态
 * （FIGURE_MANIFEST 段头式清单 + ARCH_DECLARATION 块 + 逐问代码文件 + ≥20 页正文 +
 * 带图链接的正文），三条用例就都跑通了。
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deterministicRunner } from '../../src/stages/deterministic.ts'
import { runCodeAndMintResults } from '../../src/stages/execute-and-mint.ts'
import { parseStageOutput, runStages, type StageRunContext } from '../../src/stages/runner.ts'
import { STAGES, stageDirName, stageOf, type StageSpec } from '../../src/stages/registry.ts'
import { readPassport } from '../../src/stages/handoff.ts'

const tmp = async (): Promise<string> => mkdtemp(join(tmpdir(), 'dsh-run-'))

/** 一份合规的图声明：投影 + 一条声明（refs 指向投影里的 id）。 */
// 阶段 4（figure-declare）的声明：只有结构；数在阶段 3 铸出的账本里。
function figureDeclarations(): string {
  return JSON.stringify({
    figures: [
      { figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A', 'RES-B'], caption: '两项指标对照', y_label: '占比 / %' },
    ],
  })
}

/** 阶段 1 的分析：锚点 + 段头式清单 + 架构结构声明，全部齐备。 */
function problemAnalysis(): string {
  const manifest = [
    '<!-- BEGIN FIGURE_MANIFEST -->',
    'DATA=1',
    'fig_a',
    'DRAWIO=1',
    'fig_roadmap',
    'TIKZ=1',
    'tikz_geom',
    'GPTIMG=0',
    'ALL=3',
    '<!-- END FIGURE_MANIFEST -->',
  ].join('\n')
  const arch = [
    '<!-- BEGIN ARCH_DECLARATION -->',
    JSON.stringify({
      fig_roadmap: {
        style_family: 'A',
        direction: 'vertical',
        layers: [
          { label: '问题1', nodes: [{ id: 'n1', label: '常物性温度场求解' }] },
          { label: '问题2', nodes: [{ id: 'n2', label: '变物性耦合求解' }] },
          { label: '问题3', nodes: [{ id: 'n3', label: '干燥完成时刻反解' }] },
          { label: '问题4', nodes: [{ id: 'n4', label: '移动边界归因分析' }] },
        ],
        edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
      },
    }),
    '<!-- END ARCH_DECLARATION -->',
  ].join('\n')
  return [
    '# 赛题分析',
    '',
    '[[ASSUMPTION: A-X]] 药材内部温度与含水率各向同性。',
    '[[REQUIREMENT: R-Q1]] 在 0-1800 s 内给出温度场与含水率分布。',
    '[[REQUIREMENT: R-Q2]] 用变物性模型贯通全过程。',
    '[[REQUIREMENT: R-Q3]] 反解干燥完成时刻。',
    '[[REQUIREMENT: R-Q4]] 分析移动边界与归因。',
    '',
    manifest,
    '',
    arch,
    '',
    '逐句表与硬约束的正文……'.repeat(80),
  ].join('\n')
}

/** 每阶段的**合规**假产出：够字节地板、形态正确。 */
function fakeDeliverable(spec: StageSpec, file: string): string {
  const floor = spec.produces.find(p => p.file === file)?.minBytes ?? 300
  if (file === 'PROBLEM_ANALYSIS.md') return problemAnalysis()
  if (file === 'FIGURE_DECLARATIONS.json') return figureDeclarations()
  if (file === 'RESULT_SOURCES.json') {
    return JSON.stringify({
      sources: [
        { result_id: 'RES-A', name: '指标A', locator: 'outputs.json', json_path: 'a', unit: '%' },
        { result_id: 'RES-B', name: '指标B', locator: 'outputs.json', json_path: 'b', unit: '%' },
      ],
    })
  }
  if (file === 'CAPABILITY_CHECKLIST.json') {
    return JSON.stringify({
      items: [
        { id: 'CAP-1', required_output: '温度场分布', machine_check: '问题1 给出 7 个时刻 × 21 个径向节点的温度表', source_sentence: '在 0-1800 s 内给出温度场' },
        { id: 'CAP-2', required_output: '干燥完成时刻', machine_check: '问题3 给出 t* 与收敛证据', source_sentence: '反解干燥完成时刻' },
      ],
    })
  }
  if (file === 'DELIVERABLES.json') {
    return JSON.stringify({
      deliverables: [
        { file: 'code/main.py', kind: 'other', min_bytes: 500, desc: '编排入口：依次跑问题1-4' },
        { file: 'RESULTS.md', kind: 'md', min_bytes: 1024, desc: '结果说明' },
      ],
    })
  }
  // 阶段 2 的 IR 声明：**逐条认领阶段 1 的能力项**（门禁 `modeling_coverage` 按 id 逐字核）。
  if (file === 'DECLARATION.json') {
    return JSON.stringify({
      symbols: [], assumptions: [], equations: [],
      models: [
        { id: 'MS-1', problem_refs: ['P1'], checklist_refs: ['CAP-1'] },
        { id: 'MS-3', problem_refs: ['P3'], checklist_refs: ['CAP-2'] },
      ],
      model_constants: [],
    })
  }
  if (file === 'COMP_REVIEW_VERDICT.json') return JSON.stringify({ findings: [], fatal_count: 0 })
  if (file === 'PAPER_IMPROVEMENT_STATE.json') {
    return JSON.stringify({ rounds: [{ defects: 3 }, { defects: 1 }, { defects: 0 }], termination: 'approved' })
  }
  if (file === '_text_profile.json') {
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
  }
  if (file === 'DOCX_FORMAT_CHECK_REPORT.md') return '五类检查：全部通过\n'.repeat(20)
  if (file === 'paper/main.md') {
    // 正文（附录之前）≥ 20 页；含图链接与一张三线表；无 LaTeX 结构、无占位符。
    const body = '中'.repeat(800 * 21)
    return [
      '# 药材干燥过程的数学建模与求解',
      '',
      '## 摘要',
      '',
      '本文建立耦合传热传质模型。'.repeat(10),
      '',
      '## 1 问题重述',
      '',
      body,
      '',
      '![图 1：两项指标对照](figures/fig_a.svg)',
      '',
      '**表 1：主要结果**',
      '',
      '| 指标 | 数值 | 单位 |',
      '| --- | --- | --- |',
      '| 指标A | 12.5 | % |',
      '| 指标B | 7.25 | % |',
      '',
      '## 8 模型评价与推广',
      '',
      '优点、局限、敏感性与推广各一段。'.repeat(20),
      '',
      '## 参考文献',
      '',
      '[1] Wald A. Sequential Analysis. Wiley. 1947.',
      '[2] 姜启源. 数学模型. 高等教育出版社. 2011.',
      '[3] Crank J. The Mathematics of Diffusion. Oxford. 1975.',
      '',
      '## 附录 A：代码',
      '',
      '```python',
      'import numpy as np',
      'print(np.pi)',
      '```',
      '',
    ].join('\n')
  }
  return `内容：${file}\n`.repeat(Math.ceil(floor / 10) + 5)
}

/** 假调用器：按阶段契约产出**合规**内容（多产出用 JSON 信封）。 */
function fakeCallModel(): StageRunContext['callModel'] {
  return async (spec) => {
    // 与 parseStageOutput 同一口径：harness 铸的产物不进模型回答；目录型算模型交付。
    const modelOwned = spec.produces.filter(p => p.harnessMinted !== true)
    if (modelOwned.length === 1) {
      const only = modelOwned[0]!
      return fakeDeliverable(spec, only.file)
    }
    const files: Record<string, string> = {}
    for (const p of spec.produces) {
      if (p.kind === 'dir') continue // 目录型产物在下面按阶段补
      if (p.harnessMinted === true) continue // results.json 由 afterModel 铸出，模型不见它
      files[p.file] = fakeDeliverable(spec, p.file)
    }
    if (spec.id === 'code') {
      // 逐问实现：`code_parity` 要 `code/problem*.py` ≥ 题面问数。
      for (let i = 1; i <= 4; i += 1) files[`code/problem${String(i)}.py`] = `# 问题${String(i)}\nprint(${String(i)})\n`
      // **真跑得起来**：afterModel 会执行 code/main.py，它必须写出 RESULT_SOURCES 声明的产物。
      files['code/main.py'] = [
        'import json',
        'json.dump({"a": 12.5, "b": 7.25}, open("outputs.json", "w"))',
        '',
      ].join('\n')
    }
    if (spec.id === 'improve') {
      files['paper/_improvement_rounds/round1.md'] = '# 第 1 轮\n\n改前稿。\n'
    }
    return JSON.stringify({ files })
  }
}

function ctxOf(root: string, over: Partial<StageRunContext> = {}): StageRunContext {
  return {
    stagesRoot: root,
    callModel: fakeCallModel(),
    runDeterministic: deterministicRunner(),
    afterModel: (spec, root) => spec.id === 'result-sources' ? runCodeAndMintResults(root) : Promise.resolve(),
    skillVersionOf: () => 'sk1',
    gateVersionOf: () => 'g1',
    ...over,
  } as StageRunContext
}

/**
 * 读 ZIP 条目（只为本测试服务）。
 *
 * 为什么值得写这 30 行：docx 是 zip，正文在 `word/document.xml` 里且是 deflate 过的，
 * 所以"图片有没有真嵌进去"只能解压了才看得见。第一版的断言只查了"文件存在 + 体量够"，
 * 而那两条对"图全是占位符"的产物**同样成立**。
 */
function zipEntries(buf: Buffer): Map<string, Buffer> {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66_000; i -= 1) {
    if (buf.readUInt32LE(i) === 0x0605_4b50) { eocd = i; break }
  }
  if (eocd === -1) throw new Error('zip: 找不到中央目录结尾（EOCD）')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x0201_4b50) throw new Error('zip: 中央目录条目签名不对')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8')
    const localNameLen = buf.readUInt16LE(localOff + 26)
    const localExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

describe('阶段产出映射 —— 一条明确的规则，不是猜', () => {
  it('**单产出取原文**（阶段 7 的散文不该被套信封——那会把 JSON 解析风险引回来）', () => {
    const out = parseStageOutput(stageOf('paper'), '# 标题\n正文')
    expect(out.get('paper/main.md')).toBe('# 标题\n正文')
  })

  it('**多产出取 JSON 信封**', () => {
    const spec = stageOf('modeling')
    const out = parseStageOutput(spec, JSON.stringify({ files: { 'DECLARATION.json': '{}', 'MODELING_REPORT.md': 'x' } }))
    expect(out.size).toBe(2)
  })

  it('信封**缺文件** → 抛错并点名缺哪个', () => {
    expect(() => parseStageOutput(stageOf('modeling'), JSON.stringify({ files: { 'DECLARATION.json': '{}' } })))
      .toThrow(/missing: MODELING_REPORT\.md/)
  })

  it('信封**多出契约外的文件** → 也抛错（静默接受会让阶段悄悄产出契约外的产物）', () => {
    expect(() => parseStageOutput(stageOf('modeling'), JSON.stringify({
      files: { 'DECLARATION.json': '{}', 'MODELING_REPORT.md': 'x', 'extra.md': 'y' },
    }))).toThrow(/unexpected: extra\.md/)
  })

  it('**目录型产出的子路径是契约内的**（阶段 3 的逐问代码文件必须有地方放）', () => {
    const out = parseStageOutput(stageOf('code'), JSON.stringify({
      files: {
        'code/main.py': 'print(1)',
        'code/problem1.py': 'print(1)',
        'RESULTS.md': 'x',
        'DELIVERABLES.json': '{}',
      },
    }))
    expect(out.get('code/problem1.py')).toBe('print(1)')
    // 目录前缀之外的仍然算"多出来"
    expect(() => parseStageOutput(stageOf('code'), JSON.stringify({
      files: { 'code/main.py': 'x', 'RESULTS.md': 'x', 'DELIVERABLES.json': '{}', 'notes/other.md': 'y' },
    }))).toThrow(/unexpected: notes\/other\.md/)
  })

  it('多产出阶段没有 JSON 对象 → 抛错（不猜哪份是哪份）', () => {
    expect(() => parseStageOutput(stageOf('modeling'), '我写了报告但忘了信封')).toThrow(/must be a JSON envelope/)
  })
})

describe('执行器 —— 顺利推进（确定性阶段用**真执行体**）', () => {
  it('11 个阶段跑完 → 每阶段都签发通行证；有未实现门禁的阶段标 `passed-unverified`', async () => {
    const root = await tmp()
    const outcomes = await runStages(ctxOf(root), { problemCount: 4 })
    console.log('PROBE ' + JSON.stringify(outcomes.map(o => [o.stage, o.status, o.reason.slice(0,200), o.gate.items.filter(i=>!i.ok).map(i=>i.detail.slice(0,160))])))
    expect(outcomes).toHaveLength(13)
    expect(outcomes.map(o => o.stage)).toEqual(STAGES.map(s => s.id))
    // **没有一个是 gate-failed** —— `2`（无法判定）不阻断阶段
    expect(outcomes.every(o => o.status === 'passed' || o.status === 'passed-unverified')).toBe(true)
    // 但"`2` 不等于通过"没丢：有未实现门禁的阶段必须标出来
    const unverified = outcomes.filter(o => o.status === 'passed-unverified')
    expect(unverified.length, '应当有阶段带未实现门禁').toBeGreaterThan(0)
    expect(unverified.map(o => o.stage)).toContain('prob-analysis')  // capability_check 未实现
    // 缺口**记在通行证上**，不是只活在内存里
    const passport = await readPassport(root, stageOf('prob-analysis'))
    expect(passport?.status).toBe('passed')
    expect(passport?.unverifiedGates).toContain('capability_check')
    // 最后一片的通行证也在
    expect((await readPassport(root, stageOf('docx-export')))?.status).toBe('passed')
  }, 120_000)

  it('**阶段 6 真的渲染出了图**（执行体不是"没挂上"）', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { problemCount: 4 })
    expect((await readPassport(root, stageOf('figure')))?.status).toBe('passed')
    // 判据落在**磁盘上的字节**上：第一版断言的是"门禁 detail 里出现了文件名"，
    // 而门禁的措辞是"计划 1 张数据图，全部渲染"——没有文件名。那是"我以为的"，
    // 不是被测对象的真实语义。
    const dir = join(root, stageDirName(stageOf('figure')))
    const svg = await readFile(join(dir, 'figures/fig_a.svg'), 'utf8').catch(() => null)
    expect(svg, 'figures/fig_a.svg 不在——阶段 4 的执行体没真的跑').not.toBeNull()
    expect(svg).toContain('<svg')
    const manifest = JSON.parse(await readFile(join(dir, 'figure-manifest.json'), 'utf8')) as {
      figures: ReadonlyArray<{ figure_id: string; file: string; data_refs: ReadonlyArray<string>; data_hash: string }>
    }
    expect(manifest.figures.map(f => f.figure_id)).toEqual(['fig_a'])
    expect(manifest.figures[0]?.data_refs).toEqual(['RES-A', 'RES-B'])
    expect(manifest.figures[0]?.data_hash.startsWith('sha256:')).toBe(true)
  }, 120_000)

  it('**阶段 7 的 TikZ 缺口如实标 `2`**（够不到就不许算通过）', async () => {
    const root = await tmp()
    const outcomes = await runStages(ctxOf(root), { problemCount: 4 })
    const diagram = outcomes.find(o => o.stage === 'diagram')
    expect(diagram?.status).toBe('passed-unverified')
    expect(diagram?.passport?.unverifiedGates).toContain('diagram_manifest_reconcile')
    const detail = diagram?.gate.items.find(i => i.id === 'diagram_manifest_reconcile')?.detail ?? ''
    expect(detail).toContain('tikz_geom')
    expect(detail).toContain('LaTeX')
  }, 120_000)

  it('**阶段 13 真的导出了 docx**（迁移进来的引擎跑得起来）', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { problemCount: 4 })
    const passport = await readPassport(root, stageOf('docx-export'))
    expect(passport?.status).toBe('passed')
    expect(Object.keys(passport?.artifacts ?? {})).toContain('paper/main.docx')

    const dir = join(root, stageDirName(stageOf('docx-export')))
    const docx = await readFile(join(dir, 'paper/main.docx'))
    expect(docx.byteLength, 'docx 是空壳').toBeGreaterThan(1000)
    expect(docx.subarray(0, 2).toString('latin1'), '不是 ZIP 容器（docx 是 zip）').toBe('PK')

    // **图真的嵌进去了吗**：docx 是 zip，正文在 word/document.xml（deflate）。
    // 只断言"文件存在且够大"是不够的——引擎只嵌位图，而本 harness 的图是 SVG；
    // 栅格化一旦没生效，产物里会是 "[unsupported image: …]" 占位符而**体量照样够**。
    const entries = zipEntries(docx)
    expect(entries.has('word/document.xml'), 'docx 里没有 word/document.xml').toBe(true)
    const media = [...entries.keys()].filter(k => k.startsWith('word/media/'))
    expect(media.length, `docx 里没有嵌任何图片（media 目录空）：${[...entries.keys()].join(', ')}`).toBeGreaterThan(0)
    const document = entries.get('word/document.xml')?.toString('utf8') ?? ''
    expect(document).not.toContain('unsupported image')
    expect(document).not.toContain('image missing')
    // 导出报告里记了逐张栅格化
    const exportReport = await readFile(join(dir, 'DOCX_EXPORT_REPORT.md'), 'utf8')
    expect(exportReport).toContain('figures/fig_a.png')
    expect(exportReport).toContain('300 DPI')
  }, 120_000)

  it('**阶段 12 就地修复后仍留下改动前的副本**（回滚证据）', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { problemCount: 4 })
    const before = await import('node:fs/promises').then(m => m.readFile(join(root, stageDirName(stageOf('format-check')), '_before/main.md'), 'utf8').catch(() => null))
    expect(before, '修复前的正文副本不见了——那是"改动前长什么样"的唯一证据').not.toBeNull()
    const report = await import('node:fs/promises').then(m => m.readFile(join(root, stageDirName(stageOf('format-check')), 'DOCX_FORMAT_CHECK_REPORT.md'), 'utf8'))
    expect(report).toContain('仍需人工处理的问题')
    expect(report).toContain('结论')
  }, 120_000)
})

describe('执行器 —— 失败语义', () => {
  it('上游没就绪 → `blocked` 并**点名是哪一环**，且**立即停**（不继续产出不一致的包）', async () => {
    const root = await tmp()
    const outcomes = await runStages(ctxOf(root), { only: ['code'], problemCount: 4 })
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.status).toBe('blocked')
    expect(outcomes[0]?.reason).toContain('prob-analysis')
  })

  it('门禁不过 → **不签发**、报告建议回滚目标、并把下游标 stale', async () => {
    const root = await tmp()
    // 先跑完整条链播种（只跑部分会让 modeling 因上游缺失而 blocked，那是另一条语义）
    await runStages(ctxOf(root), { problemCount: 4 })
    // 再让阶段 2 的产出不合规（报告太短）——模拟"某阶段被改坏了"
    const bad = ctxOf(root, {
      callModel: async (spec) => {
        if (spec.id === 'modeling') {
          return JSON.stringify({ files: { 'DECLARATION.json': '{}', 'MODELING_REPORT.md': '太短' } })
        }
        return fakeCallModel()(spec, '')
      },
    })
    const outcomes = await runStages(bad, { only: ['modeling'], problemCount: 4 })
    expect(outcomes[0]?.status).toBe('gate-failed')
    expect(outcomes[0]?.gate.code).toBe(1)
    // 不签发：通行证仍是上一次那份（未被覆盖成"通过"）
    expect(outcomes[0]?.passport).toBeUndefined()
    // 建议回滚目标是本阶段声明的 rollbackTo[0]
    expect(outcomes[0]?.suggestedRollbackTo).toBe('prob-analysis')
    // 下游被标 stale
    expect(outcomes[0]?.staledDownstream).toContain('code')
    expect((await readPassport(root, stageOf('code')))?.status).toBe('stale')
  }, 120_000)

  it('确定性阶段没有执行体 → 声明的产物不存在 → 门禁前置不成立（**没实现的不许静默通过**）', async () => {
    const root = await tmp()
    // 只播种阶段 1..4：**不能先跑完整条链**——那样阶段 5 的目录里已经有上一次
    // 跑出来的图与清单，删掉执行体也照样"通过"（那是 resume 语义，不是本条要测的）。
    await runStages(ctxOf(root), { only: ['prob-analysis', 'modeling', 'code', 'result-sources', 'figure-declare'], problemCount: 4 })
    const noDeterministic = ctxOf(root)
    delete (noDeterministic as { runDeterministic?: unknown }).runDeterministic
    const outcomes = await runStages(noDeterministic, { only: ['figure'], problemCount: 4 })
    expect(outcomes[0]?.status).toBe('gate-failed')
    expect(outcomes[0]?.gate.items[0]?.id).toBe('stage_deliverable_missing')
    expect(outcomes[0]?.reason).toContain('门禁')
    expect(outcomes[0]?.reason).toContain('figures/')
  }, 120_000)

  it('产出形态不合法 → 记 `stage_output` 失败并点名原因（不静默重试）', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })
    const outcomes = await runStages(ctxOf(root, {
      callModel: async () => '我忘了信封',
    }), { only: ['modeling'], problemCount: 4 })
    const last = outcomes[outcomes.length - 1]
    expect(last?.status).toBe('gate-failed')
    expect(last?.gate.items[0]?.id).toBe('stage_output')
    expect(last?.gate.items[0]?.detail).toContain('JSON envelope')
  })
})

describe('确定性执行体 —— 各自的具名失败', () => {
  it('阶段 4：声明文件不在 → 点名说清"渲染器没有输入"', async () => {
    const root = await tmp()
    await mkdir(join(root, stageDirName(stageOf('code'))), { recursive: true })
    const outcomes = await runStages(ctxOf(root), { only: ['figure'], problemCount: 4 })
    // 上游没就绪 → blocked（先撞上游通行证）；补一条只跑执行体本身的断言
    expect(['blocked', 'gate-failed']).toContain(outcomes[0]?.status)
    const { renderFigureStage } = await import('../../src/stages/figure-render.ts')
    await expect(renderFigureStage(root)).rejects.toThrow(/FIGURE_DECLARATIONS\.json/)
  })

  it('阶段 6：data_refs 悬空 → 点名说出找不到哪一个（不跳过那一张；数只来自铸出的账本）', async () => {
    const root = await tmp()
    const { renderFigureStage } = await import('../../src/stages/figure-render.ts')
    const declareDir = join(root, stageDirName(stageOf('figure-declare')))
    const ledgerDir = join(root, stageDirName(stageOf('result-sources')))
    await mkdir(declareDir, { recursive: true })
    await mkdir(ledgerDir, { recursive: true })
    await writeFile(join(declareDir, 'FIGURE_DECLARATIONS.json'), JSON.stringify({
      figures: [{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-GHOST'] }],
    }), 'utf8')
    // 账本是 harness 铸的（阶段 4）；这里直接落一份合法账本，专注测渲染器的取数守卫。
    await writeFile(join(ledgerDir, 'results.json'), JSON.stringify({
      results: [{ result_id: 'RES-A', name: 'A', value: 1, unit: '%', uncertainty: null }],
    }), 'utf8')
    await expect(renderFigureStage(root)).rejects.toThrow(/RES-GHOST/)
  })

  it('阶段 5：清单里有 DRAWIO 但分析里没有 ARCH_DECLARATION → 具名失败（不凭空造图）', async () => {
    const root = await tmp()
    const { renderDiagramStage } = await import('../../src/stages/diagram-render.ts')
    const analysisDir = join(root, stageDirName(stageOf('prob-analysis')))
    await mkdir(analysisDir, { recursive: true })
    await writeFile(join(analysisDir, 'PROBLEM_ANALYSIS.md'), [
      '<!-- BEGIN FIGURE_MANIFEST -->', 'DRAWIO=1', 'fig_roadmap', '<!-- END FIGURE_MANIFEST -->',
    ].join('\n'), 'utf8')
    await expect(renderDiagramStage(root)).rejects.toThrow(/ARCH_DECLARATION/)
  })

  it('阶段 10：正文不在 → 具名失败（那不是格式问题，是没有输入）', async () => {
    const root = await tmp()
    const { runFormatCheckStage } = await import('../../src/stages/format-check.ts')
    await expect(runFormatCheckStage(root)).rejects.toThrow(/paper\/main\.md/)
  })

  it('阶段 10：逐字比对**能抓住"修复动了目标之外"**（这是"自动修复不变成自动改坏"的机械保证）', async () => {
    const { assertVerbatim } = await import('../../src/stages/format-check.ts')
    // 只改了目标模式 → 通过
    expect(() => assertVerbatim('甲的（）乙', '甲的()乙', /（）/g, '()')).not.toThrow()
    // 目标之外也被动了 → 必须红（否则"自动修复"会静默改坏正文）
    expect(() => assertVerbatim('甲的（）乙', '甲的()丙', /（）/g, '()')).toThrow(/逐字比对失败/)
  })

  it('阶段 11：正文里有未填充占位 → **拒绝导出**（宁可交缺 docx 的包）', async () => {
    const root = await tmp()
    const { runDocxExportStage } = await import('../../src/stages/docx-export.ts')
    const paperDir = join(root, stageDirName(stageOf('paper')))
    await mkdir(join(paperDir, 'paper'), { recursive: true })
    await writeFile(join(paperDir, 'paper/main.md'), '# 标题\n\n这里还有一个 TODO 没填。\n', 'utf8')
    await expect(runDocxExportStage(root)).rejects.toThrow(/致命项/)
  }, 60_000)
})

/**
 * 重跑时，上一轮 `_audit.json` 的 findings 必须**真的进到简报里**。
 *
 * 单元测过 `stageBriefing` 的渲染，但"runner 有没有去磁盘上读"是另一件事——
 * 契约写得再好，线没接上就是零。这里用一个会捕获 prompt 的 `callModel` 把它钉住。
 */
describe('重跑接线 —— 上一轮审计的问题进简报', () => {
  it('磁盘上有 `_audit.json` → 本次 prompt 里出现那些问题', async () => {
    const root = await tmp()
    const dir = join(root, '02-modeling')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '_audit.json'), JSON.stringify({
      stage: 'modeling', verdict: 'pass', score: 0.8, structureOk: true,
      requirementCompliance: [], missing: [], model: 'auditor-x', at: 'T',
      findings: [{
        severity: 'major', where: 'DECLARATION.json EQ-MINN',
        issue: '情形二约束方向与情形一不对称', fix: '改成 P(X≤c|p_nom) ≤ β',
      }],
    }), 'utf8')
    // 先播种阶段 1——否则 modeling 因上游缺失直接 blocked（那是另一条语义，不是本条要测的）
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })

    let seen = ''
    await runStages(ctxOf(root, {
      callModel: async (spec, prompt) => {
        if (spec.id === 'modeling') seen = prompt
        return fakeCallModel()(spec, prompt)
      },
    }), { only: ['modeling'], problemCount: 4 })

    expect(seen).toContain('上一轮审计提出的问题')
    expect(seen).toContain('情形二约束方向与情形一不对称')
    expect(seen).toContain('改成 P(X≤c|p_nom) ≤ β')
  })

  it('`_audit.json` 坏了（坏 JSON）→ 不炸，只是没有那一段', async () => {
    const root = await tmp()
    const dir = join(root, '02-modeling')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '_audit.json'), '{ 这不是 JSON', 'utf8')
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })

    let seen = ''
    await runStages(ctxOf(root, {
      callModel: async (spec, prompt) => {
        if (spec.id === 'modeling') seen = prompt
        return fakeCallModel()(spec, prompt)
      },
    }), { only: ['modeling'], problemCount: 4 })

    expect(seen).toContain('建模求解')
    expect(seen).not.toContain('上一轮审计提出的问题')
  })
})

/**
 * 重跑 = **替换**，不是合并（阶段 3 实测换来的教训）。
 *
 * 阶段 3 重跑后交付了一个自相矛盾的目录：`code/problem*.py` 是新的，
 * 而上一轮**执行**留下的 `code/outputs*.json` 还是旧的——同一问两个 `n*`、
 * 同一策略两个利润。审计员判"账本与代码不是同一版本"（它是对的），
 * 但那个矛盾是 harness 自己造的，且执行者在阶段内修不了（阶段 3 不跑代码，
 * 账本由阶段 4 铸）。所以重跑必须把上一轮的残留清掉。
 */
describe('重跑 = 替换（清掉上一轮残留）', () => {
  it('上一轮多出来的文件（含子目录里的）在重跑后被清掉', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })
    await runStages(ctxOf(root), { only: ['modeling'], problemCount: 4 })

    // 伪造"上一轮执行留下的账本"（阶段 4 会写在这里）
    const dir = join(root, '02-modeling')
    await mkdir(join(dir, 'code'), { recursive: true })
    await writeFile(join(dir, 'code', 'outputs.json'), '{"stale": true}', 'utf8')
    await writeFile(join(dir, 'stale-extra.md'), '上一轮的残留', 'utf8')

    await runStages(ctxOf(root), { only: ['modeling'], problemCount: 4 })

    await expect(readFile(join(dir, 'code', 'outputs.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(dir, 'stale-extra.md'), 'utf8')).rejects.toThrow()
    // 本轮产出的还在
    expect(await readFile(join(dir, 'MODELING_REPORT.md'), 'utf8')).toContain('内容')
  }, 120_000)

  it('**harness 记账文件不能被当残留删掉**（通行证 / 门禁报告）', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })
    await runStages(ctxOf(root), { only: ['modeling'], problemCount: 4 })
    const dir = join(root, '02-modeling')
    expect(await readFile(join(dir, 'PASSED'), 'utf8')).toContain('passportVersion')
    expect(await readFile(join(dir, '_gate-report.json'), 'utf8')).toContain('items')

    await runStages(ctxOf(root), { only: ['modeling'], problemCount: 4 })

    expect(await readFile(join(dir, 'PASSED'), 'utf8')).toContain('passportVersion')
    expect(await readFile(join(dir, '_gate-report.json'), 'utf8')).toContain('items')
  }, 120_000)

  it('**解析失败时什么都不删**（不把上一轮产物白扔掉）', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })
    await runStages(ctxOf(root), { only: ['modeling'], problemCount: 4 })
    const dir = join(root, '02-modeling')
    const before = await readFile(join(dir, 'MODELING_REPORT.md'), 'utf8')

    await runStages(ctxOf(root, { callModel: async () => '我忘了信封' }),
      { only: ['modeling'], problemCount: 4 })

    expect(await readFile(join(dir, 'MODELING_REPORT.md'), 'utf8')).toBe(before)
  }, 120_000)
})

/**
 * **门禁硬失败也要进重跑简报**（原来只有审计 findings 有回路）。
 *
 * 实测代价：阶段 2 因为散文里的反例数字 `63` 未登记编外而门禁硬失败，
 * 但当时只有审计有回路，于是下一轮拿到**同一份简报**、又写了一遍同样的数
 * ——同一条门禁拦了两次。这与"审计回路"是同一条纪律：重跑不能是盲重试。
 */
describe('重跑接线 —— 门禁硬失败也进简报', () => {
  it('`_gate-report.json` 里有硬失败条目 → 本次 prompt 里出现它', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })
    const dir = join(root, '02-modeling')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '_gate-report.json'), JSON.stringify({
      code: 1,
      items: [{
        id: 'numbers_traced', ok: false, code: 1,
        detail: '有 1 个文件出现**没有出生证明**的数字 —— MODELING_REPORT.md：1 处（去重 1：63）',
      }],
    }), 'utf8')

    let seen = ''
    await runStages(ctxOf(root, {
      callModel: async (spec, prompt) => {
        if (spec.id === 'modeling') seen = prompt
        return fakeCallModel()(spec, prompt)
      },
    }), { only: ['modeling'], problemCount: 4 })

    expect(seen).toContain('上一轮审计提出的问题')
    expect(seen).toContain('numbers_traced')
    expect(seen).toContain('去重 1：63')
  })

  it('**只投 `1`（硬失败），不投 `2`（未实现/无法判定）**——后者执行者修不了', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })
    const dir = join(root, '02-modeling')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '_gate-report.json'), JSON.stringify({
      code: 1,
      items: [
        { id: 'numbers_traced', ok: false, code: 1, detail: '没有出生证明的数字：63' },
        { id: 'modeling_self_check', ok: false, code: 2, detail: '未实现：参考的 9 项自检……' },
      ],
    }), 'utf8')

    let seen = ''
    await runStages(ctxOf(root, {
      callModel: async (spec, prompt) => {
        if (spec.id === 'modeling') seen = prompt
        return fakeCallModel()(spec, prompt)
      },
    }), { only: ['modeling'], problemCount: 4 })

    expect(seen).toContain('numbers_traced')
    expect(seen).not.toContain('modeling_self_check')
  })

  it('上一轮**没硬失败**（聚合 code ≠ 1）→ 不投门禁条目', async () => {
    const root = await tmp()
    await runStages(ctxOf(root), { only: ['prob-analysis'], problemCount: 4 })
    const dir = join(root, '02-modeling')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '_gate-report.json'), JSON.stringify({
      code: 2,
      items: [{ id: 'modeling_self_check', ok: false, code: 2, detail: '未实现：……' }],
    }), 'utf8')

    let seen = ''
    await runStages(ctxOf(root, {
      callModel: async (spec, prompt) => {
        if (spec.id === 'modeling') seen = prompt
        return fakeCallModel()(spec, prompt)
      },
    }), { only: ['modeling'], problemCount: 4 })

    expect(seen).not.toContain('上一轮审计提出的问题')
  })
})
