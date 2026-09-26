/**
 * 门禁（TS 重写）—— 0 通过 / 1 硬失败 / **2 无法判定**。
 *
 * 三条纪律各有一组用例：移植意图不移植字面比较、未实现给 2 不放行、判据只读文本。
 */

import { describe, expect, it } from 'vitest'
import { GATES, runGates, type GateInput } from '../../src/stages/gates.ts'
import { STAGES } from '../../src/stages/registry.ts'

function input(files: Record<string, string>, upstream: Record<string, string> = {}, problemCount = 4): GateInput {
  return { files: new Map(Object.entries(files)), upstream: new Map(Object.entries(upstream)), problemCount }
}
const run = (id: string, i: GateInput) => runGates([id], i)

describe('门禁登记表 —— 与阶段表一致（防漂移）', () => {
  it('**阶段表里的每个门禁 id 都已登记**', () => {
    const declared = new Set(STAGES.flatMap(s => s.gates))
    const missing = [...declared].filter(id => !GATES.has(id))
    expect(missing, `阶段表声明了但登记表没有：${missing.join('、')}`).toEqual([])
  })

  it('登记表里只有一个孤儿：`anchor_presence`（阶段 1 的 E1 锚点契约，S5 接线时并入）', () => {
    const declared = new Set(STAGES.flatMap(s => s.gates))
    expect([...GATES.keys()].filter(id => !declared.has(id))).toEqual(['anchor_presence'])
  })
})

describe('字节地板 —— 参考用 wc -c，这里是 UTF-8 字节数', () => {
  it('达标 0 / 不达标 1 / 文件不存在 1（**不是 2**）', () => {
    expect(run('prob_analysis_floor', input({ 'PROBLEM_ANALYSIS.md': 'x'.repeat(1500) })).code).toBe(0)
    expect(run('prob_analysis_floor', input({ 'PROBLEM_ANALYSIS.md': 'x'.repeat(1499) })).code).toBe(1)
    expect(run('prob_analysis_floor', input({})).code).toBe(1)
  })

  it('中文按 UTF-8 字节算（一个汉字 3 字节）—— 按字符数算会误判', () => {
    expect(run('prob_analysis_floor', input({ 'PROBLEM_ANALYSIS.md': '中'.repeat(600) })).code).toBe(0)
  })
})

describe('移植**意图**，不移植字面比较', () => {
  it('leakage_audit：参考写 `≠1 算过`（RC=2 也放行）—— 这里不沿用', () => {
    const bad = run('leakage_audit', input({ 'RESULTS.md': '分类准确率 0.995' }))
    expect(bad.code).toBe(1)
    expect(bad.items[0]?.detail).toContain('去泄漏')
    expect(run('leakage_audit', input({ 'RESULTS.md': '准确率 0.995，已做 train/test 划分' })).code).toBe(0)
    expect(run('leakage_audit', input({ 'RESULTS.md': '准确率 0.87' })).code).toBe(0)
  })

  it('no_render：阶段 3 不得产出图像字节（渲染归阶段 4）', () => {
    expect(run('no_render', input({ 'code/main.py': 'print(1)' })).code).toBe(0)
    const bad = run('no_render', input({ 'figures/fig_a.png': 'x' }))
    expect(bad.code).toBe(1)
    expect(bad.items[0]?.detail).toContain('只声明')
  })

  it('review_fatal_count：fatal>0 → 硬失败并说清该回滚；缺失 → **2**', () => {
    const bad = run('review_fatal_count', input({ 'COMP_REVIEW_VERDICT.json': JSON.stringify({ fatal_count: 2 }) }))
    expect(bad.code).toBe(1)
    expect(bad.items[0]?.detail).toContain('回滚')
    expect(run('review_fatal_count', input({ 'COMP_REVIEW_VERDICT.json': JSON.stringify({ fatal_count: 0 }) })).code).toBe(0)
    expect(run('review_fatal_count', input({ 'COMP_REVIEW_VERDICT.json': '{}' })).code).toBe(2)
  })
})

describe('阶段 7 的 LaTeX 残留与页数地板', () => {
  it('LaTeX 残留 → 硬失败并点名命令；产出 .tex 也硬失败', () => {
    const bad = run('no_latex_residue', input({ 'paper/main.md': '正文\n\\cite{ref1}\n' }))
    expect(bad.code).toBe(1)
    expect(bad.items[0]?.detail).toContain('\\cite{')
    expect(run('no_latex_residue', input({ 'paper/main.md': '干净', 'paper/main.tex': 'x' })).code).toBe(1)
  })

  it('页数地板：正文（附录之前）/ 800 ≥ 20，附录不计入', () => {
    expect(run('paper_page_floor', input({ 'paper/main.md': '中'.repeat(800 * 20) })).code).toBe(0)
    const withAppendix = '中'.repeat(800 * 19) + '\n## 附录 A\n' + '中'.repeat(800 * 10)
    expect(run('paper_page_floor', input({ 'paper/main.md': withAppendix })).code).toBe(1)
  })
})

describe('阶段 1 的 FIGURE_MANIFEST 锚点', () => {
  const wrap = (items: string): string => `<!-- BEGIN FIGURE_MANIFEST -->\n${items}\n<!-- END FIGURE_MANIFEST -->\n`

  it('裸名（image2）→ 硬失败；锚点不完整 → 硬失败；全 fig_/tikz_ → 通过', () => {
    const bad = run('figure_manifest_anchors', input({ 'PROBLEM_ANALYSIS.md': wrap('- image2\n- fig_ok') }))
    expect(bad.code).toBe(1)
    expect(bad.items[0]?.detail).toContain('image2')
    expect(run('figure_manifest_anchors', input({ 'PROBLEM_ANALYSIS.md': '没有锚点' })).code).toBe(1)
    expect(run('figure_manifest_anchors', input({ 'PROBLEM_ANALYSIS.md': wrap('- fig_a\n- tikz_b') })).code).toBe(0)
  })

  it('anchor_presence：假设/需求锚点各至少一条（保真门 B3/B4 的锚）', () => {
    const both = '[[ASSUMPTION: A-X]] 甲\n[[REQUIREMENT: R-OUT]] 乙'
    expect(run('anchor_presence', input({ 'PROBLEM_ANALYSIS.md': both })).code).toBe(0)
    expect(run('anchor_presence', input({ 'PROBLEM_ANALYSIS.md': '[[ASSUMPTION: A-X]] 甲' })).code).toBe(1)
  })
})

describe('阶段 3 逐问奇偶校验 / 阶段 9 严格单文件', () => {
  it('代码文件数 ≥ 题面问数；题面问数未知 → **2**', () => {
    expect(run('code_parity', input({ 'code/problem1.py': 'a', 'code/problem2.py': 'b' }, {}, 2)).code).toBe(0)
    expect(run('code_parity', input({ 'code/problem1.py': 'a' }, {}, 2)).code).toBe(1)
    expect(run('code_parity', input({ 'code/problem1.py': 'a' }, {}, 0)).code).toBe(2)
  })

  it('多出一个文件 → 硬失败；坏 JSON → 硬失败', () => {
    expect(run('profile_single_file', input({ '_text_profile.json': '{}', 'notes.md': 'x' })).code).toBe(1)
    expect(run('profile_valid_json', input({ '_text_profile.json': JSON.stringify({ a: '中'.repeat(150) }) })).code).toBe(0)
    expect(run('profile_valid_json', input({ '_text_profile.json': '{ 坏的' })).code).toBe(1)
  })
})

describe('阶段 8 终止条件（round-5 的两条）', () => {
  const state = (rounds: number[], termination: string): string =>
    JSON.stringify({ rounds: rounds.map(d => ({ defects: d })), termination })

  it('批准即收口 / 三轮无进展即停', () => {
    expect(run('improve_terminated', input({ 'PAPER_IMPROVEMENT_STATE.json': state([9, 4, 0], 'approved') })).code).toBe(0)
    expect(run('improve_terminated', input({ 'PAPER_IMPROVEMENT_STATE.json': state([9, 5, 5, 5], 'no-progress') })).code).toBe(0)
  })

  it('**没有 termination → 硬失败**（不许自行宣布定稿）；原因不在允许集 → 硬失败', () => {
    const noTerm = run('improve_terminated', input({ 'PAPER_IMPROVEMENT_STATE.json': JSON.stringify({ rounds: [{ defects: 1 }] }) }))
    expect(noTerm.code).toBe(1)
    expect(noTerm.items[0]?.detail).toContain('termination')
    expect(run('improve_terminated', input({ 'PAPER_IMPROVEMENT_STATE.json': state([9, 4, 1], 'timeout') })).code).toBe(1)
  })
})

describe('阶段 4/5 的对账 —— 计划与产物**双向**对齐', () => {
  const analysisWith = (block: string): string => `# 分析\n\n${block}\n`
  const manifest = (lines: ReadonlyArray<string>): string =>
    ['<!-- BEGIN FIGURE_MANIFEST -->', ...lines, '<!-- END FIGURE_MANIFEST -->'].join('\n')
  // 声明文件只带 figures；数在阶段 3 由 harness 铸出的账本（results.json）里。
  const decls = (figures: ReadonlyArray<unknown>): string => JSON.stringify({ figures })
  const ledger = (ids: ReadonlyArray<string>): string =>
    JSON.stringify({ results: ids.map(id => ({ result_id: id, name: id, value: 1, unit: '%', uncertainty: null })) })

  it('计划里的数据图**没渲染出来** → 硬失败并点名', () => {
    const up = { 'PROBLEM_ANALYSIS.md': analysisWith(manifest(['DATA=2', 'fig_a', 'fig_b'])) }
    const v = run('figure_manifest_reconcile', input({ 'figures/fig_a.svg': '<svg/>' }, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('fig_b')
  })

  it('渲染了**清单外**的图 → 也硬失败（多出来的图会被下游当成真产物引用）', () => {
    const up = { 'PROBLEM_ANALYSIS.md': analysisWith(manifest(['DATA=1', 'fig_a'])) }
    const v = run('figure_manifest_reconcile', input({ 'figures/fig_a.svg': '<svg/>', 'figures/fig_ghost.svg': '<svg/>' }, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('fig_ghost')
  })

  it('对齐 → 0；**清单里没有数据图段 → 2**（阶段 1 那一环没做，不是"对账通过"）', () => {
    const up = { 'PROBLEM_ANALYSIS.md': analysisWith(manifest(['DATA=1', 'fig_a'])) }
    expect(run('figure_manifest_reconcile', input({ 'figures/fig_a.svg': '<svg/>' }, up)).code).toBe(0)
    const noData = { 'PROBLEM_ANALYSIS.md': analysisWith(manifest(['DRAWIO=1', 'fig_roadmap'])) }
    const v = run('figure_manifest_reconcile', input({ 'figures/fig_roadmap.svg': '<svg/>' }, noData))
    expect(v.code).toBe(2)
    expect(v.items[0]?.detail).toContain('没有任何数据图条目')
    // 没有清单块 → 2（不是 0）
    expect(run('figure_manifest_reconcile', input({}, { 'PROBLEM_ANALYSIS.md': '没有清单' })).code).toBe(2)
  })

  it('`data_refs` 悬空 → 硬失败并点名**哪一个 ref 找不到**（数的来源是铸出的账本）', () => {
    const up = {
      'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-GHOST'] }]),
      'results.json': ledger(['RES-A']),
    }
    const v = run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('RES-GHOST')
  })

  it('只管**引用解析**（渲染齐没齐归阶段 5 的对账）；全部解析 → 0；**账本不在 → 2**（数不由模型持有）', () => {
    const good = {
      'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A'] }]),
      'results.json': ledger(['RES-A']),
    }
    // 阶段 4 产出声明时图还不存在——所以这条门禁**只**判引用与重复，
    // "声明了但没渲染"由阶段 5 的对账核对（它同时拿计划与声明两份清单）。
    expect(run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, good)).code).toBe(0)
    expect(run('figure_declaration_complete', input({}, good)).code).toBe(0)
    const noLedger = run('figure_declaration_complete', input({}, { 'FIGURE_DECLARATIONS.json': decls([]) }))
    expect(noLedger.code).toBe(2)
    expect(noLedger.items[0]?.detail).toContain('results.json')
  })

  it('TikZ 段够不到 → **2**（既没产出也没被判定，不许算通过）', () => {
    const up = { 'PROBLEM_ANALYSIS.md': analysisWith(manifest(['DRAWIO=1', 'fig_roadmap', 'TIKZ=1', 'tikz_geom'])) }
    const v = run('diagram_manifest_reconcile', input({ 'figures/fig_roadmap.svg': '<svg/>' }, up))
    expect(v.code).toBe(2)
    expect(v.items[0]?.detail).toContain('tikz_geom')
    expect(v.items[0]?.detail).toContain('LaTeX')
    // 没有 TIKZ 段时是干净的 0
    const noTikz = { 'PROBLEM_ANALYSIS.md': analysisWith(manifest(['DRAWIO=1', 'fig_roadmap'])) }
    expect(run('diagram_manifest_reconcile', input({ 'figures/fig_roadmap.svg': '<svg/>' }, noTikz)).code).toBe(0)
  })
})

describe('阶段 4 的风格门禁 —— `setup_style` 规范的可核形态', () => {
  const decls = (caption: string): string =>
    JSON.stringify({ figures: [{ figure_id: 'fig_a', chart_type: 'line', data_refs: ['RES-A'], caption }] })
  const svg = (text: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">\n`
    + `<rect x="0" y="0" width="200" height="100" fill="#FFFFFF"/>\n${text}\n</svg>\n`

  it('健康图 → 0（字号/边界/对比度 + 配色 + 无图内标题）', () => {
    const ok = svg('<text x="100" y="50" text-anchor="middle" font-family="serif" font-size="12" fill="#222222">占比</text>')
    expect(run('figure_style_rules', input({ 'figures/fig_a.svg': ok }, { 'FIGURE_DECLARATIONS.json': decls('两项指标对照') })).code).toBe(0)
  })

  it('字号过小 → 硬失败（复用 `checkFigureQuality`，不另写一份判据）', () => {
    const tiny = svg('<text x="100" y="50" font-size="5" fill="#222222">太小</text>')
    const v = run('figure_style_rules', input({ 'figures/fig_a.svg': tiny }, { 'FIGURE_DECLARATIONS.json': decls('对照') }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('font_size')
  })

  it('CSS 颜色名 / 被禁色板 → 硬失败（灰度打印后不可区分）', () => {
    const named = svg('<rect x="10" y="10" width="20" height="20" fill="red"/>')
    expect(run('figure_style_rules', input({ 'figures/fig_a.svg': named }, { 'FIGURE_DECLARATIONS.json': decls('对照') })).code).toBe(1)
    const banned = svg('<rect x="10" y="10" width="20" height="20" fill="#0072B2"/><desc>tab10</desc>')
    const v = run('figure_style_rules', input({ 'figures/fig_a.svg': banned }, { 'FIGURE_DECLARATIONS.json': decls('对照') }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('tab10')
  })

  it('**题注出现在图内** → 硬失败（`plt.title` 的等价物）', () => {
    const withTitle = svg('<text x="100" y="20" font-size="13" fill="#222222">两项指标对照</text>')
    const v = run('figure_style_rules', input({ 'figures/fig_a.svg': withTitle }, { 'FIGURE_DECLARATIONS.json': decls('两项指标对照') }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('题注出现在图内')
  })

  it('没有图可核 → **2**（不是"风格通过"）', () => {
    expect(run('figure_style_rules', input({}, {})).code).toBe(2)
  })
})

describe('阶段 5 的几何门禁 —— 只读 SVG 字节', () => {
  const rect = (row: number, x: number, y: number): string =>
    `<rect data-mh-row="${String(row)}" x="${String(x)}" y="${String(y)}" width="220" height="52" fill="#F5F5F3" stroke="#777777" stroke-width="1"/>`
  const label = (x: number, y: number, text = '常物性求解'): string =>
    `<text x="${String(x)}" y="${String(y)}" text-anchor="middle" font-family="serif" font-size="12" fill="#000000">${text}</text>`
  const wrap = (body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">\n`
    + `<rect x="0" y="0" width="400" height="240" fill="#FFFFFF"/>\n${body}\n</svg>\n`

  it('按构造对齐 → 0', () => {
    const svg = wrap(`${rect(0, 90, 40)}\n${label(200, 70)}\n${rect(1, 90, 140)}\n${label(200, 170)}`)
    expect(run('diagram_geometry', input({ 'figures/fig_roadmap.svg': svg })).code).toBe(0)
  })

  it('同层中轴漂移 >4px → 硬失败（层号从 `data-mh-row` 复原）', () => {
    // 纵向展开（同层节点**共享 y**）时，对齐不变量是 y。所以"漂移"必须是**同层
    // 两节点的 y 中轴不一致**：两个节点横排（x 不同 → 判为纵向），但一个低了 20px。
    // 第一版把漂移写在 x 上——那是横向展开的不变量，于是门禁（正确地）给了 0，
    // 是**测试写错了**，不是门禁漏判。
    const svg = wrap(`${rect(0, 20, 40)}\n${label(130, 70)}\n${rect(0, 160, 60)}\n${label(270, 90)}`)
    const v = run('diagram_geometry', input({ 'figures/fig_roadmap.svg': svg }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('中轴漂移')
  })

  it('文字宽过节点 → 硬失败（会被裁切）', () => {
    const long = '常物性温度场与含水率耦合求解全过程说明文字'
    const svg = wrap(`${rect(0, 90, 40)}\n${label(200, 70, long)}`)
    const v = run('diagram_geometry', input({ 'figures/fig_roadmap.svg': svg }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('超出节点宽')
  })

  it('元素越出画布 → 硬失败（复用 `checkFigureQuality` 的边界判据）', () => {
    const svg = wrap('<rect x="380" y="220" width="120" height="60" fill="#FFFFFF"/>')
    const v = run('diagram_geometry', input({ 'figures/fig_roadmap.svg': svg }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('out_of_bounds')
  })

  it('没有图可核 → **2**', () => {
    expect(run('diagram_geometry', input({}, {})).code).toBe(2)
  })
})

describe('阶段 11 的导出前校核', () => {
  const md = '# 标题\n\n正文。\n\n![图 1](figures/fig_a.svg)\n'
  const manifest = JSON.stringify({ figures: [{ figure_id: 'fig_a', file: 'figures/fig_a.svg' }] })
  const profile = JSON.stringify({ _matched_items: ['正文：小四号'], body: { font_size_pt: 12 } })

  it('链接闭合、画像合法 → 0，并说明画像来源', () => {
    const up = { 'paper/main.md': md, '_text_profile.json': profile, 'figure-manifest.json': manifest }
    const v = run('docx_precheck', input({}, up))
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('explicit')
  })

  it('图片链接指向不存在的文件 → 硬失败（占位符同理）', () => {
    const up = { 'paper/main.md': md, '_text_profile.json': profile, 'figure-manifest.json': JSON.stringify({ figures: [] }) }
    const v = run('docx_precheck', input({}, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('致命项')
  })

  it('**画像在但不是合法 JSON → 1**（那是"要求没被解析出来"，不是"用户没提要求"）', () => {
    const up = { 'paper/main.md': md, '_text_profile.json': '{ 坏的', 'figure-manifest.json': manifest }
    const v = run('docx_precheck', input({}, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('没被解析出来')
  })

  it('画像缺失 → 不阻断（回退是设计好的行为，且写在报告里）；正文不在 → 2', () => {
    const up = { 'paper/main.md': md, 'figure-manifest.json': manifest }
    const v = run('docx_precheck', input({}, up))
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('default')
    expect(run('docx_precheck', input({}, {})).code).toBe(2)
  })
})

describe('未实现的判据给 2，**绝不给 0**', () => {
  it('每个未实现的门禁都写明"需要什么才算实现"', () => {
    // 这份清单是**断言**：实现一条就删一条。于是"哪些判据其实没跑"永远可回答——
    // 它不会随着时间悄悄变成"都实现了"。
    // S5b 删掉了 5 条：figure_manifest_reconcile / figure_declaration_complete /
    // diagram_manifest_reconcile / diagram_geometry / docx_precheck（它们要的输入
    // ——机器可读的清单、声明、SVG 字节——现在都由阶段 4/5/11 真的产出了）。
    // S6 删掉了 `modeling_coverage`：它要的输入（能力项 id 的引用）现在由阶段 2 的
    // `ModelSpec.checklist_refs` 真的产出，判据落在"id 逐字命中"上——不再是"待定义形态"。
    const unimplemented = ['capability_check', 'modeling_self_check',
      'delivery_audit', 'paper_claim_check']
    for (const id of unimplemented) {
      const v = run(id, input({}))
      expect(v.code, `${id} 应当是 2（无法判定）`).toBe(2)
      expect(v.items[0]?.detail, `${id} 没写明缺什么`).toContain('未实现')
      expect(v.items[0]?.detail.length, `${id} 的说明太短`).toBeGreaterThan(30)
    }
  })

  it('**聚合顺序：硬失败优先于无法判定**（明确的失败比未知更该被看见）', () => {
    expect(runGates(['capability_check', 'prob_analysis_floor'], input({})).code).toBe(1)
    expect(runGates(['capability_check'], input({})).code).toBe(2)
  })

  it('未登记的门禁 id → 2 并说明', () => {
    const v = runGates(['nobody_registered_this'], input({}))
    expect(v.code).toBe(2)
    expect(v.items[0]?.detail).toContain('未登记')
  })
})

/**
 * `numbers_traced` 的白名单来源必须**真的取得到**（第十处真实误报）。
 *
 * 2024B 实测：阶段 2 在 `DECLARATION.json` 里声明了备择次品率 `0.15`，正文引用它，
 * 门禁却判它"没有出生证明"。原因是白名单只从 `upstream` 取 `DECLARATION.json`，
 * 而 `upstream` 只装 `consumes` 的东西——`DECLARATION.json` 是阶段 2 **自己**的产物，
 * 永远不在 `consumes` 里。**文档写的来源取不到，门禁就在惩罚守约的模型。**
 * 所以声明文件必须在本阶段目录（`files`）里也找一遍。
 */
describe('numbers_traced —— 声明常数取自本阶段目录（不只上游）', () => {
  const facts = JSON.stringify({ facts: [{ id: 'F-NOMINAL', value: '10%' }] })
  const decl = JSON.stringify({
    model_constants: [
      { name: '标称次品率', value: 0.1, unit: '' },
      { name: '判别力约束的备择次品率', value: 0.15, unit: '' },
      { name: '样本量搜索上界', value: 200, unit: '件' },
    ],
  })

  it('**本阶段产出的 DECLARATION.json 里的常数，正文引用它 → 通过**', () => {
    const v = run('numbers_traced', input(
      {
        'MODELING_REPORT.md': '在备择次品率声明常数 0.15 处，第二类错误不超过 0.10。标称值 0.1。',
        'DECLARATION.json': decl, // ← 本阶段**自己**的产物，`consumes` 里没有它
      },
      { 'PROBLEM_FACTS.json': facts },
    ))
    expect(v.code).toBe(0)
  })

  it('声明文件在上游时同样通过（两条路都要通，不能只顾一头）', () => {
    const v = run('numbers_traced', input(
      { 'MODELING_REPORT.md': '备择次品率常数 0.15。' },
      { 'PROBLEM_FACTS.json': facts, 'DECLARATION.json': decl },
    ))
    expect(v.code).toBe(0)
  })

  it('**判别力**：没声明过的数照样抓（别把这条修成"什么都放行"）', () => {
    const v = run('numbers_traced', input(
      {
        'MODELING_REPORT.md': '备择次品率常数 0.15，最优样本量 137，期望利润 104.32。',
        'DECLARATION.json': decl, // 0.15 有出生证明；137 / 104.32 没有
      },
      { 'PROBLEM_FACTS.json': facts },
    ))
    expect(v.code).toBe(1)
    const detail = v.items[0]?.detail ?? ''
    // 判据落在**去重清单**上：回显的上下文句里本来就有 0.15，不能拿整段做否定断言。
    expect(detail).toContain('去重 2：137、104.32')
  })

  it('两份来源都取不到 → 2（无法判定），不是 0', () => {
    const v = run('numbers_traced', input({ 'MODELING_REPORT.md': '随便 42。' }, {}))
    expect(v.code).toBe(2)
    expect(v.items[0]?.detail).toContain('出生证明来源')
  })
})

/**
 * `modeling_coverage` —— 阶段 1 立的能力项，阶段 2 必须逐条认领。
 *
 * 这条门禁长期挂在"未实现 → 2"，因为"落地"的机器可读形态没定义。现在定义了：
 * 能力项 id 的**逐字引用**（阶段 2 的 `ModelSpec.checklist_refs` 挂 `C-*`）。
 * 2024B 实测这一版模型 20/20 全部认领，所以判据不是凭空发明的要求。
 */
describe('modeling_coverage —— 能力项逐条认领', () => {
  const checklist = JSON.stringify({
    stage: '01-prob-analysis',
    capabilities: [
      { id: 'C-Q1-PLAN', required_output: '抽样检测方案' },
      { id: 'C-Q2-EXCHANGE', required_output: '调换损失入账' },
      { id: 'C-Q4-REDO', required_output: '问题 4 重做' },
    ],
  })

  it('全部认领 → 0', () => {
    const v = run('modeling_coverage', input(
      { 'DECLARATION.json': '{"models":[{"checklist_refs":["C-Q1-PLAN","C-Q2-EXCHANGE","C-Q4-REDO"]}]}' },
      { 'CAPABILITY_CHECKLIST.json': checklist },
    ))
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('3 条能力项全部被认领')
  })

  it('**缺一条 → 硬失败并点名是哪一条**（"报告很长但某问没建模"正是要抓的）', () => {
    const v = run('modeling_coverage', input(
      { 'DECLARATION.json': '{"models":[{"checklist_refs":["C-Q1-PLAN","C-Q4-REDO"]}]}' },
      { 'CAPABILITY_CHECKLIST.json': checklist },
    ))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('C-Q2-EXCHANGE')
    expect(v.items[0]?.detail).not.toContain('C-Q1-PLAN')
  })

  it('**换个说法不算认领**（id 必须逐字出现）', () => {
    const v = run('modeling_coverage', input(
      { 'MODELING_REPORT.md': '问题 1 给出了抽样检测方案，问题 2 计入了调换损失，问题 4 已重做。' },
      { 'CAPABILITY_CHECKLIST.json': checklist },
    ))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('3/3 条能力项**没有被认领**')
  })

  it('写在哪一份产物里都可以（不把形态规定死）', () => {
    const v = run('modeling_coverage', input(
      { 'MODELING_REPORT.md': '认领：C-Q1-PLAN、C-Q2-EXCHANGE、C-Q4-REDO。' },
      { 'CAPABILITY_CHECKLIST.json': checklist },
    ))
    expect(v.code).toBe(0)
  })

  it('上游没有对照表 → 2（不是 0）；对照表为空 → 硬失败', () => {
    expect(run('modeling_coverage', input({ 'DECLARATION.json': '{}' })).code).toBe(2)
    const empty = run('modeling_coverage', input(
      { 'DECLARATION.json': '{}' },
      { 'CAPABILITY_CHECKLIST.json': JSON.stringify({ capabilities: [] }) },
    ))
    expect(empty.code).toBe(1)
  })

  it('对照表坏 JSON / 没有 capabilities → 硬失败并说清', () => {
    expect(run('modeling_coverage', input(
      { 'DECLARATION.json': '{}' }, { 'CAPABILITY_CHECKLIST.json': '{ 坏' },
    )).items[0]?.detail).toContain('不是合法 JSON')
    expect(run('modeling_coverage', input(
      { 'DECLARATION.json': '{}' }, { 'CAPABILITY_CHECKLIST.json': '{"stage":"x"}' },
    )).items[0]?.detail).toContain('capabilities')
  })
})

/**
 * 第十二处真实误报：`leakage_audit` 把**任何** ≥0.99 的数当成分类指标。
 *
 * 2024B 阶段 3 被拦，但本题根本没有分类指标（抽样方案 + 装配决策 + 期望利润）。
 * 被命中的两处完全无关：
 * - 灵敏度扫描的置信水平格点 `[0.9, 0.95, 0.99]`；
 * - OC 曲线上的接收概率轴值 `0.99 / 0.995`（这些数越接近 1 越正常）。
 *
 * 判据必须锚在"分类指标"上：该行要有 ≥0.99 的数**且**邻近有指标词。
 */
describe('leakage_audit —— 只看分类指标，不把大数一律当指标', () => {
  it('**置信水平格点与 OC 轴值不误报**（真实形态逐字固化）', () => {
    const v = run('leakage_audit', input({
      'common.py': '"灵敏度扫描置信水平": [0.9, 0.95, 0.99],\n"接收概率": [0.9, 0.95, 0.99, 0.995],',
      'outputs_q1.json': '[\n  0.99,\n  0.995,\n]',
    }))
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('置信水平')
  })

  it('**判别力**：真的出现 ≥0.99 的分类指标且无去泄漏证据 → 硬失败', () => {
    const v = run('leakage_audit', input({ 'RESULTS.md': '| 准确率 | 0.995 |' }))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('准确率')
  })

  it('有分类指标 + 有去泄漏说明 → 通过（不因噎废食）', () => {
    const v = run('leakage_audit', input({
      'RESULTS.md': '| 准确率 | 0.995 |\n\n数据划分：按时间切分 train/test，无泄漏。',
    }))
    expect(v.code).toBe(0)
  })

  it('分类指标词与数值分两行（markdown 表头）也能抓到', () => {
    const v = run('leakage_audit', input({ 'RESULTS.md': '| 指标 | 值 |\n| F1 | 0.99 |' }))
    expect(v.code).toBe(1)
  })

  it('没到 0.99 的分类指标不报（阈值就是阈值）', () => {
    expect(run('leakage_audit', input({ 'RESULTS.md': '| 准确率 | 0.97 |' })).code).toBe(0)
  })
})

/**
 * **编外登记簿**（`illustrative_numbers`）—— 用户口径的落点：
 *
 * > 每个数字都要有出生证明，不能某一数字凭空出现而没有任何可溯源痕迹；
 * > 如果是反例或模型有其他可解释的原因，可以统一管理放到编外，但不能不可追溯。
 *
 * 所以编外**不是豁免，是换一种记账**：它必须留下"数 → 出处"的痕迹
 * （出现在哪句话里 + 为什么它不是常数也不是结果）。三条缺任一条就是"凭空出现"。
 */
describe('编外登记簿 —— 可以有编外，但不能不可追溯', () => {
  const facts = JSON.stringify({ facts: [{ id: 'F-NOMINAL', value: '10%' }] })
  /** 反例里那个数：既不是题面给定值，也不是声明的常数——实测撞过的真实形态。 */
  const report = '**为什么不用连续模型。** 决策量是二值的，连续松弛会给出"检测 63% 的成品"这类无法实施的解。'

  it('**登记齐备 → 通过**（quote + reason 都有）', () => {
    const decl = JSON.stringify({
      illustrative_numbers: [{
        value: 63,
        quote: '连续松弛会给出"检测 63% 的成品"这类无法实施的解',
        reason: '反例示意：说明连续松弛的解得形态，非计算结果也非模型常数',
      }],
    })
    const v = run('numbers_traced', input(
      { 'MODELING_REPORT.md': report, 'DECLARATION.json': decl },
      { 'PROBLEM_FACTS.json': facts },
    ))
    expect(v.code).toBe(0)
    expect(v.items[0]?.detail).toContain('编外登记 1 条')
  })

  it('**没登记 → 照样判无出生证明**（编外不等于免登记）', () => {
    const v = run('numbers_traced', input(
      { 'MODELING_REPORT.md': report, 'DECLARATION.json': '{}' },
      { 'PROBLEM_FACTS.json': facts },
    ))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('63')
    expect(v.items[0]?.detail).toContain('illustrative_numbers')
  })

  it('**缺 reason → 硬失败**（"示意"两个字不算理由）', () => {
    const decl = JSON.stringify({ illustrative_numbers: [{ value: 63, quote: '检测 63% 的成品' }] })
    const v = run('numbers_traced', input(
      { 'MODELING_REPORT.md': report, 'DECLARATION.json': decl },
      { 'PROBLEM_FACTS.json': facts },
    ))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('reason')
  })

  it('**缺 quote → 硬失败**（无法回原文核，就是不可追溯）', () => {
    const decl = JSON.stringify({
      illustrative_numbers: [{ value: 63, reason: '反例示意：说明连续松弛的解得形态' }],
    })
    const v = run('numbers_traced', input(
      { 'MODELING_REPORT.md': report, 'DECLARATION.json': decl },
      { 'PROBLEM_FACTS.json': facts },
    ))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('quote')
  })

  it('**`value` 不是有限数 → 硬失败**；登记簿不是数组 → 硬失败并说清形态', () => {
    const bad1 = JSON.stringify({
      illustrative_numbers: [{ value: '63', quote: 'x', reason: '反例示意：说明解得形态' }],
    })
    expect(run('numbers_traced', input(
      { 'MODELING_REPORT.md': report, 'DECLARATION.json': bad1 },
      { 'PROBLEM_FACTS.json': facts },
    )).items[0]?.detail).toContain('有限数')

    const bad2 = JSON.stringify({ illustrative_numbers: { '63': '反例' } })
    expect(run('numbers_traced', input(
      { 'MODELING_REPORT.md': report, 'DECLARATION.json': bad2 },
      { 'PROBLEM_FACTS.json': facts },
    )).items[0]?.detail).toContain('必须是数组')
  })

  it('**判别力**：登记了编外的数，别的没登记的数照样抓', () => {
    const decl = JSON.stringify({
      illustrative_numbers: [{
        value: 63, quote: '检测 63% 的成品', reason: '反例示意：说明连续松弛的解得形态',
      }],
    })
    const v = run('numbers_traced', input(
      { 'MODELING_REPORT.md': `${report} 最优样本量为 137。`, 'DECLARATION.json': decl },
      { 'PROBLEM_FACTS.json': facts },
    ))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('137')
  })
})
