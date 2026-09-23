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

describe('未实现的判据给 2，**绝不给 0**', () => {
  it('每个未实现的门禁都写明"需要什么才算实现"', () => {
    const unimplemented = ['capability_check', 'modeling_coverage', 'modeling_self_check',
      'delivery_audit', 'figure_manifest_reconcile', 'figure_declaration_complete',
      'diagram_manifest_reconcile', 'diagram_geometry', 'paper_claim_check', 'docx_precheck']
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
