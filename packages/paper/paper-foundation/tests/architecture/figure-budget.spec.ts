/**
 * **图表预算** —— "一篇论文该配多少张图"必须是可计算的数，而不是口号。
 *
 * 用户口径：*"只有四张图是绝对无法支撑一篇优秀论文的……比如 30 页正文的论文
 * 应该配多少张图，将其作为一个约束写好，允许上下浮动 3 张。"*
 *
 * 实测背景（2024B）：阶段 1 的 `FIGURE_MANIFEST` 规规矩矩写了 `DATA=14`
 * （完全落在参考的软区间内），但阶段 5 交付时**只剩 7 张**——11 条 `plan_deviations`
 * 里 7 条是"申报放弃"。每条理由都真实（账本确实没有那些数），申报机制也是对的，
 * **问题是没有东西去数"最后剩几张"**：契约允许逐张申报，却不设总量下限，
 * 于是"诚实地放弃"能一路放弃到图集撑不起论文。
 *
 * 本文件钉住三件事：目标怎么算、容差怎么用、底线怎么不被容差拉低。
 */

import { describe, expect, it } from 'vitest'
import {
  FIGURE_COUNT_HARD_FLOOR, FIGURE_COUNT_TOLERANCE,
  budgetSentence, figureBudget, targetBodyPages, targetDataFigures,
} from '../../src/stages/figure-budget.ts'
import { numericShapeOf } from '../../src/stages/execute-and-mint.ts'
import { figurePlanValid } from '../../src/stages/figure-script-gates.ts'
import { runGates } from '../../src/stages/gates.ts'

/** 造一个 GateInput。 */
function input(files: Readonly<Record<string, string>>, upstream: Readonly<Record<string, string>> = {}, problemCount = 4) {
  return {
    files: new Map(Object.entries(files)),
    upstream: new Map(Object.entries(upstream)),
    problemCount,
  }
}

describe('图表预算 —— 页数与张数的推导', () => {
  it('4 问 → 目标 30 页 → 数据图目标 15 张、区间 12–18（用户举例的那个数）', () => {
    const b = figureBudget(4)
    expect(b.pages).toBe(30)
    expect(b.target).toBe(15)
    expect(b.lo).toBe(12)
    expect(b.hi).toBe(18)
  })

  it('密度与参考的逐题范例对得上（国赛 B 题 13 张 / 25-30 页）', () => {
    // 参考范例：A/B/C 题（25-30 页）配 15/13/14 张数据图 → 密度 0.46–0.54
    for (const pages of [25, 28, 30]) {
      const density = targetDataFigures(3) / pages
      expect(density, `${String(pages)} 页下的密度`).toBeGreaterThan(0.35)
      expect(density).toBeLessThan(0.65)
    }
    // 3 问 → 24 页 → 12 张；参考的 B 题是 13 张，同一带内
    expect(figureBudget(3).target).toBe(12)
    expect(Math.abs(figureBudget(3).target - 13)).toBeLessThanOrEqual(FIGURE_COUNT_TOLERANCE)
  })

  it('页数地板 20 页不被问数拉低（1 问也是 20 页）', () => {
    expect(targetBodyPages(1)).toBe(20)
    expect(figureBudget(1).pages).toBe(20)
    expect(figureBudget(0).pages).toBe(20) // 问数数不出 → 按 1 问保守
  })

  it('容差恰好是 ±3（用户指定）', () => {
    const b = figureBudget(4)
    expect(b.target - b.lo).toBe(FIGURE_COUNT_TOLERANCE)
    expect(b.hi - b.target).toBe(FIGURE_COUNT_TOLERANCE)
  })

  it('**容差不得把绝对底线拉低**（参考 HARD_FLOOR=3 是硬线，不是软线）', () => {
    // 构造一个"目标很小"的极端：目标 3 张时，lo 只能是 3，不能是 0
    for (const n of [0, 1, 2, 3, 4, 10]) {
      expect(figureBudget(n).lo, `${String(n)} 问的下限`).toBeGreaterThanOrEqual(FIGURE_COUNT_HARD_FLOOR)
    }
    expect(FIGURE_COUNT_HARD_FLOOR).toBe(3)
  })

  it('预算句子里带着推导过程（人能核，而不是一个凭空的目标数）', () => {
    const s = budgetSentence(figureBudget(4), 4)
    expect(s).toContain('30 页')
    expect(s).toContain('15 张')
    expect(s).toContain('12–18')
    expect(s).toContain('底线 3 张')
  })
})

describe('`figure_manifest_count` —— 规划端卡预算（阶段 1）', () => {
  const manifest = (data: number, tikz = 0, drawio = 0): string => {
    const rows = [
      `DATA=${String(data)}`,
      ...Array.from({ length: data }, (_, i) => `fig_d${String(i)}`),
      `DRAWIO=${String(drawio)}`,
      ...Array.from({ length: drawio }, (_, i) => `fig_flow${String(i)}`),
      `TIKZ=${String(tikz)}`,
      ...Array.from({ length: tikz }, (_, i) => `tikz_t${String(i)}`),
      'GPTIMG=0',
      `ALL=${String(data + tikz + drawio)}`,
    ]
    return `<!-- BEGIN FIGURE_MANIFEST -->\n${rows.join('\n')}\n<!-- END FIGURE_MANIFEST -->\n`
  }
  const run = (data: number, tikz = 0, drawio = 0, problemCount = 4) =>
    runGates(['figure_manifest_count'], input({ 'PROBLEM_ANALYSIS.md': manifest(data, tikz, drawio) }, {}, problemCount))

  it('14 张（2024B 的实际规划）→ 落在 12–18 区间内，通过', () => {
    const v = run(14)
    expect(v.code, v.items[0]?.detail).toBe(0)
    expect(v.items[0]?.detail).toContain('12–18')
  })

  it('**低于绝对底线 3 张 → 硬失败**（参考："工作严重不完整"）', () => {
    const v = run(2)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('绝对底线')
  })

  it('低于容差下限（12 张）→ 失败，并指出差额可以补在 TikZ 上', () => {
    const v = run(9)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('12')
  })

  it('**推理密集型豁免**：数据图 9 张 + TikZ 4 张 → 合计 13 张，达下限，通过', () => {
    // 参考："数据图达底线即正常，推导构造图(TIKZ)才是重点，勿为凑数硬加数据曲线"
    const v = run(9, 4)
    expect(v.code, v.items[0]?.detail).toBe(0)
  })

  it('超过上限（19 张 > 18）→ 失败（"宁少勿凑"）', () => {
    const v = run(19)
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('超过上限')
  })

  it('3 问的题预算更小（24 页 → 12 张，区间 9–15）', () => {
    expect(run(12, 0, 0, 3).code).toBe(0)
    expect(run(7, 0, 0, 3).code).toBe(1)
  })
})

describe('`figure_plan_budget` —— 交付端卡总量（阶段 5）', () => {
  const plan = (n: number, dropped = 0): string => JSON.stringify({
    figures: Array.from({ length: n }, (_, i) => ({ figure_id: `fig_f${String(i)}`, chart_type: 'bar', data_refs: ['R-A'] })),
    plan_deviations: Array.from({ length: dropped }, (_, i) => ({ from: `fig_gone${String(i)}`, to: '', reason: '账本没有这种数' })),
  })
  const run = (n: number, dropped = 0, problemCount = 4) =>
    runGates(['figure_plan_budget'], input({ 'FIGURE_PLAN.json': plan(n, dropped) }, {}, problemCount))

  it('**2024B 的真实形态：14 张规划、7 张申报放弃、只剩 7 张 → 拦下**', () => {
    const v = run(7, 7)
    expect(v.code, v.items[0]?.detail).toBe(1)
    const detail = v.items[0]?.detail ?? ''
    expect(detail).toContain('低于下限 12 张')
    // 必须把"放弃了几张"说出来——检查人要能区分"产物偷懒"与"上游缺数"
    expect(detail).toContain('7 张是**申报放弃**')
    expect(detail).toContain('回滚阶段 3')
  })

  it('13 张 → 落在区间内，通过（放弃 1 张也在预算内，不拦）', () => {
    expect(run(13, 1).code).toBe(0)
  })

  it('**放弃在预算内照样放行**（少一张不是罪——申报机制不能被这条门禁废掉）', () => {
    const v = run(12, 2)
    expect(v.code, v.items[0]?.detail).toBe(0)
    expect(v.items[0]?.detail).toContain('申报放弃 2 张')
  })

  it('超过上限（19 张）→ 失败', () => {
    expect(run(19).code).toBe(1)
  })

  it('规划不在（没产物）→ 记 2，不当通过', () => {
    const v = runGates(['figure_plan_budget'], input({}, {}, 4))
    expect(v.code).toBe(2)
  })
})

describe('账本收得下数组 —— 这是"多画几张图"的前提', () => {
  it('标量 / 序列 / 矩阵 / 张量都合法', () => {
    expect(numericShapeOf(3.5)).toBe('scalar')
    expect(numericShapeOf([1, 2, 3])).toBe('series')
    expect(numericShapeOf([[1, 2], [3, 4]])).toBe('matrix')
    expect(numericShapeOf([[[1]], [[2]]])).toBe('tensor')
  })

  it('**元素坏了一律拒绝**（NaN/Infinity 画到图上是静默失败）', () => {
    expect(numericShapeOf(Number.NaN)).toBeNull()
    expect(numericShapeOf(Number.POSITIVE_INFINITY)).toBeNull()
    expect(numericShapeOf([1, Number.NaN, 3])).toBeNull()
    expect(numericShapeOf([[1, 2], [3, Number.POSITIVE_INFINITY]])).toBeNull()
  })

  it('空数组、字符串、对象、混合数组都拒绝', () => {
    expect(numericShapeOf([])).toBeNull()
    expect(numericShapeOf([[]])).toBeNull()
    expect(numericShapeOf('abc')).toBeNull()
    expect(numericShapeOf({ a: 1 })).toBeNull()
    expect(numericShapeOf([1, 'x'])).toBeNull()
    expect(numericShapeOf(null)).toBeNull()
  })
})

describe('`figure_plan_valid` 的形态判据 —— 标量画不出热力图', () => {
  const ledger = (rows: ReadonlyArray<{ id: string; value: unknown; kind?: string }>): string =>
    JSON.stringify({ results: rows.map(r => ({ result_id: r.id, name: r.id, value: r.value, unit: '元', uncertainty: null, ...(r.kind === undefined ? {} : { kind: r.kind }) })) })
  const planOf = (chartType: string, refs: ReadonlyArray<string>): string => JSON.stringify({
    figures: [{ figure_id: 'fig_a', chart_type: chartType, recipe: { category: 'basic', number: 1 }, data_refs: refs, caption: 'c', x_label: 'x', y_label: 'y' }],
  })

  it('热力图只挂标量 → 失败，并指向"回滚阶段 3 补矩阵"', () => {
    const v = figurePlanValid(input(
      { 'FIGURE_PLAN.json': planOf('heatmap', ['R-A', 'R-B']) },
      { 'results.json': ledger([{ id: 'R-A', value: 1 }, { id: 'R-B', value: 2 }]) },
    ))
    expect(v.code).toBe(1)
    const detail = v.items[0]?.detail ?? ''
    expect(detail).toContain('矩阵')
    expect(detail).toContain('回滚阶段 3')
  })

  it('热力图挂了矩阵 → 通过', () => {
    const v = figurePlanValid(input(
      { 'FIGURE_PLAN.json': planOf('heatmap', ['R-M']) },
      { 'results.json': ledger([{ id: 'R-M', value: [[1, 2], [3, 4]] }]) },
    ))
    expect(v.code, v.items[0]?.detail).toBe(0)
  })

  it('折线图只挂 2 个标量 → 失败（两点连不成曲线，硬连会虚构趋势）', () => {
    const v = figurePlanValid(input(
      { 'FIGURE_PLAN.json': planOf('line', ['R-A', 'R-B']) },
      { 'results.json': ledger([{ id: 'R-A', value: 1 }, { id: 'R-B', value: 2 }]) },
    ))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('序列')
  })

  it('折线图挂序列 → 通过；挂 ≥3 个标量也通过', () => {
    expect(figurePlanValid(input(
      { 'FIGURE_PLAN.json': planOf('line', ['R-S']) },
      { 'results.json': ledger([{ id: 'R-S', value: [1, 2, 3, 4] }]) },
    )).code).toBe(0)
    expect(figurePlanValid(input(
      { 'FIGURE_PLAN.json': planOf('line', ['R-A', 'R-B', 'R-C']) },
      { 'results.json': ledger([{ id: 'R-A', value: 1 }, { id: 'R-B', value: 2 }, { id: 'R-C', value: 3 }]) },
    )).code).toBe(0)
  })

  it('柱状图挂标量照旧通过（别把判据扩张到不需要序列的图型）', () => {
    expect(figurePlanValid(input(
      { 'FIGURE_PLAN.json': planOf('bar', ['R-A']) },
      { 'results.json': ledger([{ id: 'R-A', value: 1 }]) },
    )).code).toBe(0)
  })

  it('老账本没有 `kind` 字段时按值判形态（向后兼容，不让旧产物被判"缺结构"）', () => {
    expect(figurePlanValid(input(
      { 'FIGURE_PLAN.json': planOf('heatmap', ['R-M']) },
      { 'results.json': ledger([{ id: 'R-M', value: [[1, 2], [3, 4]] }]) }, // 无 kind
    )).code).toBe(0)
  })
})
