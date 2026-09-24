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
  const decls = (figures: ReadonlyArray<unknown>, results: ReadonlyArray<unknown> = [{ result_id: 'RES-A', name: 'A', value: 1, unit: '%', uncertainty: null }]): string =>
    JSON.stringify({ results, figures })

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

  it('`data_refs` 悬空 → 硬失败并点名**哪一个 ref 找不到**', () => {
    const up = { 'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-GHOST'] }]) }
    const v = run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('RES-GHOST')
  })

  it('声明了但没渲染 → 硬失败；全部解析且渲染 → 0', () => {
    const good = { 'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A'] }]) }
    expect(run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, good)).code).toBe(0)
    const v = run('figure_declaration_complete', input({}, good))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('没渲染')
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
    JSON.stringify({ results: [], figures: [{ figure_id: 'fig_a', chart_type: 'line', data_refs: ['RES-A'], caption }] })
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
    const unimplemented = ['capability_check', 'modeling_coverage', 'modeling_self_check',
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
