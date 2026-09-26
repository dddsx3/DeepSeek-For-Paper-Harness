/**
 * 按参考工作流**图型决策表**补入的图型 —— 龙卷风 / 瀑布 / 热力 / 森林 / 置信带折线。
 *
 * 用户实测"作图水平相当低"，根因是**图型只有四种**：参考的决策表对本题几类数据
 * 有明确指定（灵敏度排序→Tornado、贡献构成→Waterfall、区间估计→Forest、
 * 矩阵→Heatmap、带重复的趋势→CI 带），而且明确否掉了柱状图。更关键的是参考有一条
 * 硬合同：*"规划写了什么图型，就必须画出那个图型——凭印象退化成 plot/bar/scatter
 * 是最常见的质量塌方"*；只有四种图型时那条合同根本无法履行。
 *
 * 这些夹具钉的是**参考点名过的设计特征**，不是"能出图就行"：
 * 龙卷风的正负双向条/按量级调浅/条端数值/刻度带扫描区间/基线标注；
 * 瀑布的累积浮柱与连接线；热力图的格内数值与明暗自适应文字；森林的 CI 与参考线。
 */
import { describe, expect, it } from 'vitest'
import {
  FIGURE_STYLE_PROFILE, renderFigureSvg, type RenderInput,
} from '../../src/figure/renderer.ts'

const base = {
  style_profile: FIGURE_STYLE_PROFILE,
  series: [],
  recipe: 'okabe-ito-v1',
} as const

const svgOf = (over: Partial<RenderInput>): string =>
  renderFigureSvg({ ...base, ...over } as RenderInput)

describe('龙卷风图 —— 参考决策表对「灵敏度排序」的指定图型', () => {
  const svg = svgOf({
    chart_type: 'tornado',
    x_label: '干燥时间相对变化 / %',
    baseline: 57.4,
    tornado: [
      { label: '空气温度', low: -6.2, high: 6.8, low_label: '-2K', high_label: '+2K' },
      { label: '干燥阈值', low: -29.4, high: 66.5, low_label: '0.175', high_label: '0.225' },
      { label: '网格数', low: -0.3, high: 0.2, low_label: '50', high_label: '200' },
    ],
  })

  it('**按 range 降序排**（重要性顺序即图的顺序；柱状图做不到）', () => {
    const at = (name: string): number => svg.indexOf(name)
    expect(at('干燥阈值')).toBeLessThan(at('空气温度'))
    expect(at('空气温度')).toBeLessThan(at('网格数'))
  })

  it('**刻度标签带扫描区间**（读者要知道这个条是在什么扰动下得到的）', () => {
    expect(svg).toContain('空气温度（-2K~+2K）')
    expect(svg).toContain('干燥阈值（0.175~0.225）')
  })

  it('**正负双向条 + 条端数值标注**（方向与量级一眼可见）', () => {
    expect(svg).toContain('>+66.5<')
    expect(svg).toContain('>-29.4<')
    // 零线
    expect(svg).toMatch(/stroke-width="0\.9"/)
  })

  it('**按量级调浅**：不同 range 的条用不同深浅（不是同一个色块复制）', () => {
    const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map(m => m[1])
    expect(new Set(fills).size).toBeGreaterThan(3)
  })

  it('**基线标注**在图上（57.4 h）', () => {
    expect(svg).toContain('基准 57.4')
  })

  it('**长标签不被裁**：左边距按最长标签反推（实测缺陷：写死边距时因子名整块消失）', () => {
    const long = svgOf({
      chart_type: 'tornado',
      tornado: [{ label: '一个非常非常长的驱动因子名称用于测试边距', low: -1, high: 2 }],
    })
    const xs = [...long.matchAll(/<text x="(\d+(?:\.\d+)?)"[^>]*text-anchor="end"/g)].map(m => Number(m[1]))
    expect(Math.min(...xs)).toBeGreaterThan(60) // 有足够的标签列，不会被推到画布外
  })

  it('没有数据 → **具名报错**（不画一张空图）', () => {
    expect(() => svgOf({ chart_type: 'tornado' })).toThrow(/tornado/)
  })
})

describe('瀑布图 —— 参考决策表对「贡献/构成」的指定图型（明确不要 bar chart）', () => {
  const svg = svgOf({
    chart_type: 'waterfall',
    y_label: '金额（元）',
    waterfall: [
      { label: '采购', value: 22 },
      { label: '检测', value: 5 },
      { label: '调换损失', value: 8 },
      { label: '合计', value: 35, kind: 'total' },
    ],
  })

  it('每个台阶都有数值标注', () => {
    expect(svg).toContain('>+22<')
    expect(svg).toContain('>+5<')
    expect(svg).toContain('>+8<')
    expect(svg).toContain('>35<')
  })

  it('**连接横线**在（瀑布图的灵魂：没有它就看不出从哪累到哪）', () => {
    expect(svg).toContain('stroke-dasharray="4 3"')
  })

  it('**合计画成落地柱**（从 0 起，与 delta 的浮柱区分）', () => {
    expect(svg).toContain('合计')
  })

  it('刻度取整（不是 22.33/19.295 那种非整数）', () => {
    const ticks = [...svg.matchAll(/<text[^>]*font-family="monospace"[^>]*>(-?\d+(?:\.\d+)?)</g)].map(m => m[1])
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.every(t => Math.abs(Number(t) * 100 - Math.round(Number(t) * 100)) < 1e-6)).toBe(true)
  })

  it('没有数据 → 具名报错', () => {
    expect(() => svgOf({ chart_type: 'waterfall' })).toThrow(/waterfall/)
  })
})

describe('热力图 —— 参考要求带格内数值、深底白字', () => {
  const svg = svgOf({
    chart_type: 'heatmap',
    heatmap: {
      rows: ['零配件1检测', '成品检测'],
      cols: ['情况1', '情况2'],
      values: [[1, 0], [0, 1]],
    },
  })

  it('格内有数值', () => {
    expect(svg).toContain('>1<')
    expect(svg).toContain('>0<')
  })

  it('**明暗自适应文字色**（深底白字、浅底黑字——否则深格里印黑字等于没印）', () => {
    expect(svg).toContain('#FFFFFF')
    expect(svg).toContain('#222222')
  })

  it('有 colorbar（参考：热力图必须有）', () => {
    expect(svg).toContain('width="10"') // 色标条
  })

  it('**行名在左侧、不压色标**（实测缺陷：行名画在右侧与色标叠字）', () => {
    const rowX = [...svg.matchAll(/<text x="(\d+(?:\.\d+)?)"[^>]*text-anchor="end"[^>]*>零配件1检测</g)].map(m => Number(m[1]))
    expect(rowX.length).toBe(1)
    expect(rowX[0]).toBeLessThan(200) // 在左侧
  })

  it('矩阵与行列不匹配 → 具名报错（不画一张错位的图）', () => {
    expect(() => svgOf({
      chart_type: 'heatmap',
      heatmap: { rows: ['a', 'b'], cols: ['x'], values: [[1, 2]] },
    })).toThrow(/一一对应/)
  })
})

describe('森林图 —— 参考对「区间估计」的指定图型', () => {
  const svg = svgOf({
    chart_type: 'forest',
    x_label: '期望利润（元）',
    ref_lines: [{ axis: 'x', value: 0, label: '盈亏平衡' }],
    forest: [
      { label: '情况 1', estimate: 21.68, low: 20.1, high: 23.4 },
      { label: '情况 2', estimate: 19.8, low: 17.2, high: 22.6 },
    ],
  })

  it('每行有**点估计 + 置信区间**（不只是点）', () => {
    expect(svg).toContain('21.68 [20.1, 23.4]')
    expect(svg).toContain('19.8 [17.2, 22.6]')
    // 区间端点的短竖线（caps）
    const caps = [...svg.matchAll(/stroke-width="1\.6"/g)]
    expect(caps.length).toBeGreaterThan(3)
  })

  it('**虚线参考线**在（参考明确要求 forest 带一条）', () => {
    expect(svg).toContain('stroke-dasharray="5 3"')
  })

  it('没有数据 → 具名报错', () => {
    expect(() => svgOf({ chart_type: 'forest' })).toThrow(/forest/)
  })
})

describe('判据线 —— 参考：有阈值/上限/约束时必画', () => {
  it('y 向判据线（虚线 + 线旁短标签）', () => {
    const svg = svgOf({
      chart_type: 'bar',
      y_label: '利润（元）',
      ref_lines: [{ axis: 'y', value: 0, label: '盈亏平衡' }],
      series2d: [{ label: '利润', xLabels: ['情况1', '情况2'], y: [12, -4] }],
    })
    expect(svg).toContain('盈亏平衡')
    expect(svg).toContain('stroke-dasharray="5 3"')
  })
})
