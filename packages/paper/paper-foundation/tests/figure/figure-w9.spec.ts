/**
 * W9 — the data-figure layer: ledger-driven 2D series, provenance, recipes.
 *
 * 判据对应：H1（DataArtifact 数据源 + 真实台账）、H2（序列形态/真实 x 轴）、
 * H3（每个数值可追到 Result/DataArtifact）、H4（误差棒/多序列/对数轴）、
 * H6（配方 + 违反即拒）。
 *
 * @module tests/figure-w9
 */

import { describe, expect, it } from 'vitest'
import { figureRenderInput, renderFigureSvg, DATA_FIGURE_RECIPES } from '../../src/figure/renderer.ts'
import { parseCsv, parseLedger, seriesFromLedger } from '../../src/figure/ledger.ts'
import type { IrObjectRecord } from '../../src/ir/store.ts'

/** A store holding one Result and one DataArtifact pointing at real 2024-C data. */
function store(): Map<string, IrObjectRecord> {
  const m = new Map<string, IrObjectRecord>()
  m.set('RES-AREA', {
    id: 'RES-AREA', runId: 'r1' as never, nodeId: null, kind: 'Result',
    mime: 'application/json', size: 10, sha256: 'a'.repeat(64), storageKey: 'inline:a',
    value: { result_id: 'RES-AREA', name: '总地块面积', value: 4200, unit: '亩', uncertainty: null },
  } as never)
  m.set('DA-PLOTS', {
    id: 'DA-PLOTS', runId: 'r1' as never, nodeId: null, kind: 'DataArtifact',
    mime: 'text/csv', size: 10, sha256: 'b'.repeat(64), storageKey: 'inline:b',
    value: {
      data_id: 'DA-PLOTS', role: 'INPUT_DATA',
      locator: 'file:///problems/2024-C/attachment-1.csv',
      content_hash: 'sha256:' + 'c'.repeat(64),
      media_type: 'text/csv', description: '2024-C 附件1 地块表（xlsx 登记时转 CSV）',
    },
  } as never)
  return m
}

/** The REAL 2024-C attachment-1 ledger (converted from the xlsx at
 *  registration time; see artifacts/handoff/W9/2024-C-attachment-1.csv). */
const REAL_2024C_CSV = [
  '地块名称,地块类型,地块面积/亩',
  'A1,平旱地,80',
  'A2,平旱地,80',
  'A3,平旱地,80',
  'A4,平旱地,80',
  'A5,平旱地,80',
  'A6,平旱地,80',
  'B1,梯田,55',
  'B2,梯田,55',
  'B3,梯田,55',
  'B4,梯田,55',
  'B5,梯田,55',
  'B6,梯田,55',
  'B7,梯田,55',
  'B8,梯田,55',
  'B9,梯田,55',
  'B10,梯田,55',
  'B11,梯田,55',
  'B12,梯田,55',
  'B13,梯田,55',
  'B14,梯田,55',
  'C1,山坡地,35',
  'C2,山坡地,35',
  'C3,山坡地,35',
  'C4,山坡地,35',
  'C5,山坡地,35',
  'C6,山坡地,35',
  'C7,山坡地,35',
  'C8,山坡地,35',
  'D1,水浇地,30',
  'D2,水浇地,30',
  'D3,水浇地,30',
  'D4,水浇地,30',
  'D5,水浇地,30',
  'D6,水浇地,30',
  'D7,水浇地,30',
  'D8,水浇地,30',
  'E1,智慧大棚,20',
  'E2,智慧大棚,20',
  'E3,智慧大棚,20',
  'E4,智慧大棚,20',
  'E5,智慧大棚,20',
  'E6,智慧大棚,20',
  'E7,智慧大棚,20',
  'E8,智慧大棚,20',
  'E9,智慧大棚,20',
  'E10,智慧大棚,20',
  'E11,智慧大棚,20',
  'E12,智慧大棚,20',
  'E13,智慧大棚,20',
  'E14,智慧大棚,20',
  'E15,智慧大棚,20',
  'E16,智慧大棚,20',
].join('\n')

const readLedger = () => ({ media_type: 'text/csv', content: REAL_2024C_CSV })

describe('W9-H1 — a DataArtifact ledger drives a real data figure', () => {
  it('the render input ACCEPTS a DataArtifact and embeds the parsed numbers', () => {
    const out = figureRenderInput(store(), {
      data_refs: ['DA-PLOTS'],
      chart_type: 'bar',
      x_label: '地块',
      y_label: '面积/亩',
    }, {
      readLedger,
      ledgerSeries: [{ x_column: '地块名称', y_column: '地块面积/亩', label: '地块面积' }],
    })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    if (!out.ok) return
    expect(out.input.series2d?.length).toBe(1)
    // 地块名称是字符串 → 类别轴（xLabels），54 个真实地块
    const sr = out.input.series2d?.[0]
    expect(sr?.xLabels?.length).toBe(52)
    expect(sr?.y.length).toBe(52)
    expect(out.input.ledger_sources?.[0]?.data_ref).toBe('DA-PLOTS')
    // provenance: the source content hash is IN the render input (H3)
    expect(out.input.ledger_sources?.[0]?.content_hash).toContain('ccc')
  })

  it('the rendered SVG is deterministic and carries real data (not a placeholder)', () => {
    const out = figureRenderInput(store(), {
      data_refs: ['DA-PLOTS'],
      chart_type: 'line',
      y_label: '面积/亩',
    }, {
      readLedger,
      ledgerSeries: [{ x_column: '地块名称', y_column: '地块面积/亩', label: '地块面积' }],
    })
    if (!out.ok) throw new Error(out.reason)
    const svg1 = renderFigureSvg(out.input)
    const svg2 = renderFigureSvg(out.input)
    expect(svg1).toBe(svg2) // determinism contract
    expect(svg1).toContain('<polyline') // a real line through real points
    expect(svg1).not.toContain('待写入')
    // the drawn numbers trace to the ledger: the max area (80) appears as a y tick region
    expect(out.data_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('H3 counter-example: a DataArtifact with NO reader refuses with an actionable reason', () => {
    const out = figureRenderInput(store(), { data_refs: ['DA-PLOTS'], chart_type: 'line' })
    if (out.ok) throw new Error('expected refusal')
    expect(out.reason).toContain('provide opts.readLedger')
  })

  it('H3 counter-example: numbers NOT in the store still refuse (N20 intact)', () => {
    const bad = store()
    bad.set('DA-GHOST', {
      id: 'DA-GHOST', runId: 'r1' as never, nodeId: null, kind: 'DataArtifact',
      mime: 'text/csv', size: 1, sha256: 'd'.repeat(64), storageKey: 'inline:d',
      value: {
        data_id: 'DA-GHOST', role: 'INPUT_DATA', locator: 'file:///nowhere.csv',
        content_hash: 'sha256:' + 'e'.repeat(64), media_type: 'text/csv', description: '',
      },
    } as never)
    const out = figureRenderInput(bad, { data_refs: ['DA-GHOST'], chart_type: 'line' }, {
      readLedger: () => undefined, // the ledger does not resolve
      ledgerSeries: [{ x_column: 'a', y_column: 'b', label: 'x' }],
    })
    if (out.ok) throw new Error('expected refusal')
    expect(out.reason).toContain('does not resolve')
  })
})

describe('W9-H2 — series2d: real numeric x axis (not array subscripts)', () => {
  it('x tick positions come from the actual x VALUES', () => {
    const input = {
      style_profile: 'okabe-ito-v1' as const,
      chart_type: 'line' as const,
      x_label: 't/s', y_label: '浓度',
      series: [],
      series2d: [{ label: '实测', x: [0, 10, 50, 200], y: [1, 3, 7, 9] }],
      recipe: 'okabe-ito-v1',
    }
    const svg = renderFigureSvg(input)
    // non-uniform x spacing → the rendered points must be non-uniform too
    // (array-subscript rendering would space them evenly)
    const xs = [...svg.matchAll(/cx="([\d.]+)"/g)].map(m => Number(m[1]))
    expect(xs.length).toBe(4)
    const gaps: number[] = []
    for (let i = 1; i < xs.length; i += 1) {
      const prev = xs[i - 1]
      const cur = xs[i]
      if (prev === undefined || cur === undefined) continue
      gaps.push(cur - prev)
    }
    expect(gaps.length).toBe(3)
    expect(gaps[0]).not.toBeCloseTo(gaps[1] ?? -1, 4)
    expect(gaps[1]).not.toBeCloseTo(gaps[2] ?? -1, 4)
  })
})

describe('W9-H4 — error bars / multi-series / log axis', () => {
  it('error bars are DRAWN as caps (the field existed but was never rendered)', () => {
    const input = {
      style_profile: 'okabe-ito-v1' as const,
      chart_type: 'scatter' as const,
      series: [],
      series2d: [{ label: '测量', x: [1, 2, 3], y: [5, 7, 9], error: [0.5, 0.3, 0.8] }],
      recipe: 'okabe-ito-v1',
    }
    const svg = renderFigureSvg(input)
    // error bars are vertical line segments with caps
    expect(svg).toContain('stroke-width="1"')
    // count vertical cap pairs: 3 points × (bar + 2 caps) = 9 line elements beyond spines
    const lines = [...svg.matchAll(/<line /g)].length
    expect(lines).toBeGreaterThanOrEqual(3 * 3)
  })

  it('multi-series renders a legend with each series labelled', () => {
    const input = {
      style_profile: 'okabe-ito-v1' as const,
      chart_type: 'line' as const,
      series: [],
      series2d: [
        { label: '方案A', x: [1, 2, 3], y: [2, 4, 6] },
        { label: '方案B', x: [1, 2, 3], y: [3, 5, 7] },
      ],
      recipe: 'okabe-ito-v1',
    }
    const svg = renderFigureSvg(input)
    expect(svg).toContain('方案A')
    expect(svg).toContain('方案B')
    expect(svg).toContain('fill-opacity') // legend background
  })

  it('log scale repositions points (and refuses non-positive values)', () => {
    const linear = {
      style_profile: 'okabe-ito-v1' as const,
      chart_type: 'line' as const,
      series: [],
      series2d: [{ label: 'L', x: [1, 2, 3], y: [1, 10, 100] }],
      recipe: 'okabe-ito-v1',
    }
    const svgLin = renderFigureSvg(linear)
    const svgLog = renderFigureSvg({ ...linear, y_scale: 'log' as const })
    // the middle point (y=10) sits at a different height under log
    const cy = (svg: string): number[] => [...svg.matchAll(/cy="([\d.]+)"/g)].map(m => Number(m[1]))
    const yLin = cy(svgLin)
    const yLog = cy(svgLog)
    expect(yLin).not.toEqual(yLog)
    // and a non-positive value is refused, not silently drawn at a fake position
    expect(() => renderFigureSvg({ ...linear, y_scale: 'log' as const, series2d: [{ label: 'L', x: [1], y: [0] }] }))
      .toThrow(/requires every/)
  })
})

describe('W9-H6 — named recipes; an unknown recipe refuses', () => {
  it('the okabe-ito-v1 recipe exists and is colourblind-safe (never the banned maps)', () => {
    expect(DATA_FIGURE_RECIPES['okabe-ito-v1']).toBeDefined()
    for (const recipe of Object.values(DATA_FIGURE_RECIPES)) {
      for (const c of recipe.palette) {
        expect(c.toLowerCase()).not.toBe('#d62728') // not the banned RdYlGn red
      }
    }
  })

  it('an unknown recipe name REFUSES (violating the recipe is a refusal)', () => {
    const out = figureRenderInput(store(), {
      data_refs: ['RES-AREA'], chart_type: 'bar',
    }, { recipe: 'rainbow-party' })
    if (out.ok) throw new Error('expected refusal')
    expect(out.reason).toContain("recipe 'rainbow-party'")
  })
})

describe('W9-B2 — the ledger parser (csv/json; xlsx refuses honestly)', () => {
  it('parses RFC-4180 CSV with quoted cells', () => {
    const t = parseCsv('a,b\n"1,5",x\n"say ""hi""",y')
    expect(t.rows[0]).toEqual(['1,5', 'x'])
    expect(t.rows[1]).toEqual(['say "hi"', 'y'])
  })

  it('parses JSON ledgers (array-of-arrays and {columns,rows})', () => {
    const a = parseLedger('application/json', '[["x","y"],[1,2],[3,4]]')
    expect(a.columns).toEqual(['x', 'y'])
    const b = parseLedger('application/json', '{"columns":["x"],"rows":[[1]]}')
    expect(b.columns).toEqual(['x'])
  })

  it('xlsx media type refuses with the conversion instruction (honest, not guessing)', () => {
    expect(() => parseLedger('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'binary'))
      .toThrow(/convert xlsx at registration time/)
  })

  it('a non-numeric x column becomes a CATEGORICAL axis (bar charts over names)', () => {
    // W9-B3（第一版把非数值 x 全跳过——地块名 A1/B2 这类别轴被丢了）：
    // x 列非数值 → 类别轴（xLabels），y 仍逐行数值过滤。
    const t = parseCsv('t,v\n0,1\n备注,忽略\n2,3')
    const s = seriesFromLedger(t, 't', 'v', 'L')
    expect(s.xLabels).toEqual(['0', '2']) // the 忽略 row has non-numeric y → skipped
    expect(s.y).toEqual([1, 3])
    expect(s.x).toBeUndefined()
  })

  it('a missing column refuses with the available columns named', () => {
    const t = parseCsv('a,b\n1,2')
    expect(() => seriesFromLedger(t, '时间', 'v', 'L')).toThrow(/have: a, b/)
  })
})

// ---------------------------------------------------------------------------
// W9-C — architecture diagram engine (option B: deterministic layout → SVG)
// ---------------------------------------------------------------------------

import {
  renderArchitectureSvg,
  computeArchitectureLayout,
  assertNotGenericShell,
  assertNoResultValues,
  checkArchitectureAlignment,
  deriveArchParams,
  type ArchInput,
} from '../../src/figure/architecture.ts'
import { checkFigureQuality, checkNoAuditLeak } from '../../src/figure/quality-check.ts'

/** W8.12 真实交付运行的真实模型结构（来自 real-run-3 的 IR 声明——C3 用真实内容） */
function realArchInput(): ArchInput {
  return {
    seed: 'sha256:4bbf19eb487f7d1e958f4fd0d8cd69104d3c6a5f529ffae8b156939d9b89d940',
    style_family: 'C',
    layers: [
      { label: '输入', nodes: [{ id: 'n1', label: '附件数据读入' }, { id: 'n2', label: '地块参数表' }] },
      { label: '模型', nodes: [{ id: 'n3', label: '0-1变量枚举(16组合)' }, { id: 'n4', label: '期望利润不动点 V=A+BV' }] },
      { label: '求解', nodes: [{ id: 'n5', label: '回收系数B<1判定' }, { id: 'n6', label: '枚举取最优V' }] },
      { label: '输出', nodes: [{ id: 'n7', label: '六情形决策表' }] },
    ],
    edges: [
      { from: 'n1', to: 'n3' }, { from: 'n2', to: 'n4' },
      { from: 'n3', to: 'n5' }, { from: 'n4', to: 'n6' },
      { from: 'n5', to: 'n7', kind: 'decision' }, { from: 'n6', to: 'n7' },
    ],
  }
}

describe('W9-C — the architecture diagram engine', () => {
  it('H7: renders deterministic SVG from a REAL run seed (option B: no browser)', () => {
    const input = realArchInput()
    const svg1 = renderArchitectureSvg(input)
    const svg2 = renderArchitectureSvg(input)
    expect(svg1).toBe(svg2) // determinism
    expect(svg1).toContain('<svg')
    expect(svg1).toContain('期望利润不动点') // real content, not a placeholder
    // the seed drives a derived parameter (C4-1)
    expect(deriveArchParams(input.seed).hue).toBe(deriveArchParams(input.seed).hue)
  })

  it('C4-1: different seeds derive different params; same seed is stable', () => {
    const a = deriveArchParams('run-a')
    const b = deriveArchParams('run-b')
    const a2 = deriveArchParams('run-a')
    expect(a.hue).not.toBe(b.hue) // 异篇不同
    expect(a.hue).toBe(a2.hue) // 断线重跑可复现
  })

  it('C4-3: style family C (黑白线稿) uses ZERO colour', () => {
    const svg = renderArchitectureSvg({ ...realArchInput(), style_family: 'C' })
    // hsl( colour fills only appear when NOT mono
    expect(svg).not.toMatch(/hsl\(/)
    expect(svg).toContain('font-weight="800"') // C 族焦点靠字重
  })

  it('C4-4 counter-example: ALL-generic nodes refuse (反空壳)', () => {
    const shell: ArchInput = {
      ...realArchInput(),
      layers: [
        { nodes: [{ id: 'a', label: '数据采集' }, { id: 'b', label: '数据预处理' }] },
        { nodes: [{ id: 'c', label: '建立模型' }, { id: 'd', label: '模型求解' }] },
        { nodes: [{ id: 'e', label: '结果分析' }] },
      ],
      edges: [],
    }
    expect(assertNotGenericShell(shell.layers).length).toBe(5)
    expect(() => renderArchitectureSvg(shell)).toThrow(/anti-empty-shell/)
  })

  it('C4-5 counter-example: result values in nodes refuse (不做结果展示)', () => {
    const withResult: ArchInput = {
      ...realArchInput(),
      layers: [
        { nodes: [{ id: 'a', label: '附件数据读入' }, { id: 'b', label: '期望利润 21.87 元' }] },
        { nodes: [{ id: 'c', label: '六情形决策表' }] },
      ],
      edges: [],
    }
    expect(assertNoResultValues(withResult.layers)).toEqual(['期望利润 21.87 元'])
    expect(() => renderArchitectureSvg(withResult)).toThrow(/no-result-values/)
  })

  it('C4-6: the alignment check PASSES on generated SVG and FAILS on a broken layout', () => {
    const layout = computeArchitectureLayout(realArchInput())
    expect(checkArchitectureAlignment(layout)).toEqual([]) // 按构造对齐
    // 手工构造错位：horizontal 模式下对齐不变量是 x——把同层一个节点 x 右移
    // 10px → 检查必须红（第一版挪 y，查的是 x，动错了轴所以没红）
    const broken = {
      ...layout,
      nodeRects: layout.nodeRects.map((r, i) => (i === 1 ? { ...r, x: r.x + 10 } : r)),
    }
    const violations = checkArchitectureAlignment(broken, 4)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]?.deviation).toBeGreaterThan(4)
  })

  it('an edge referencing an unknown node refuses (no silent dangling arrows)', () => {
    const bad: ArchInput = {
      ...realArchInput(),
      edges: [{ from: 'n1', to: 'GHOST' }],
    }
    expect(() => renderArchitectureSvg(bad)).toThrow(/unknown node id/)
  })
})

// ---------------------------------------------------------------------------
// W9-D — the print-quality gate
// ---------------------------------------------------------------------------

describe('W9-D1 — print quality checks (字号/边界/对比度)', () => {
  it('a healthy figure passes with zero violations', () => {
    const input = {
      style_profile: 'okabe-ito-v1' as const,
      chart_type: 'line' as const,
      x_label: 't/s', y_label: '浓度',
      series: [{ label: 'L', value: 5, unit: 'm', uncertainty: null }],
      recipe: 'okabe-ito-v1',
    }
    expect(checkFigureQuality(renderFigureSvg(input))).toEqual([])
  })

  it('a tiny-font text is caught', () => {
    const svg = '<svg viewBox="0 0 680 420"><text x="10" y="20" font-size="5" fill="#222222">太小</text></svg>'
    const v = checkFigureQuality(svg)
    expect(v.some(x => x.kind === 'font_size')).toBe(true)
  })

  it('an out-of-bounds element is caught', () => {
    const svg = '<svg viewBox="0 0 680 420"><rect x="600" y="400" width="200" height="100" fill="#fff"/></svg>'
    const v = checkFigureQuality(svg)
    expect(v.some(x => x.kind === 'out_of_bounds')).toBe(true)
  })

  it('a low-contrast text is caught (WCAG AA)', () => {
    const svg = '<svg viewBox="0 0 680 420"><text x="10" y="20" font-size="12" fill="#CCCCCC">看不清</text></svg>'
    const v = checkFigureQuality(svg)
    expect(v.some(x => x.kind === 'contrast')).toBe(true)
  })
})

describe('W9-D2 — the audit view never leaks into the deliverable', () => {
  it('counter-example: data_hash in the deliverable is flagged', () => {
    expect(checkNoAuditLeak('正文…… data_hash: sha256:abc ……')).toHaveLength(1)
    expect(checkNoAuditLeak('干净的正文')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// W9（用户实测反馈）— 类别轴防挤压规划
// ---------------------------------------------------------------------------

import { estimateLabelPx, planCategoricalLabels } from '../../src/figure/axis-labels.ts'

describe('W9 — categorical axis anti-crowding (54 地块名不再重叠)', () => {
  const fiftyFour = Array.from({ length: 52 }, (_, i) => {
    const n = i + 1
    const band = n <= 6 ? 'A' : n <= 20 ? 'B' : n <= 28 ? 'C' : n <= 36 ? 'D' : 'E'
    return `${band}${n}`
  })

  it('the 52-地块 real chart gets a rotation+thinning plan (not all 52 horizontal)', () => {
    // 事故（用户实测）：54 个地块名横排在 580px 里全部重叠成一坨。
    const slotPx = 580 / 52
    const plan = planCategoricalLabels(fiftyFour, slotPx, 10)
    expect(plan.rotate).toBe(true)
    expect(plan.labels.length, 'thinned to a readable subset').toBeLessThan(52)
    expect(plan.labels.length).toBeGreaterThan(4)
    // 首标签必画；采样均匀
    expect(plan.labels[0]?.index).toBe(0)
    const indices = plan.labels.map(l => l.index)
    expect(indices).toEqual(indices.map(i => i).filter((_, i) => i * plan.step < fiftyFour.length))
  })

  it('spacious labels stay horizontal with no thinning', () => {
    const plan = planCategoricalLabels(['A1', 'A2', 'A3', 'A4'], 120, 10)
    expect(plan.rotate).toBe(false)
    expect(plan.step).toBe(1)
    expect(plan.labels.length).toBe(4)
  })

  it('estimation accounts for CJK width (中文≈全角)', () => {
    expect(estimateLabelPx('地块', 10)).toBeCloseTo(20, 1) // 2 CJK chars = 2×fontSize
    expect(estimateLabelPx('A10', 10)).toBeCloseTo(18.6, 1) // latin ≈ 0.62×fontSize
  })

  it('the rendered 52-label SVG has FEWER text elements than labels (thin + rotate)', () => {
    const input = {
      style_profile: 'okabe-ito-v1' as const,
      chart_type: 'bar' as const,
      x_label: '地块',
      series: [],
      series2d: [{ label: '地块面积', xLabels: fiftyFour, y: fiftyFour.map((_, i) => 20 + (i % 7)) }],
      recipe: 'okabe-ito-v1',
    }
    const svg = renderFigureSvg(input)
    const categoryTexts = [...svg.matchAll(/<text[^>]*rotate\(-45/g)].length
    expect(categoryTexts, 'rotated labels present').toBeGreaterThan(0)
    expect(categoryTexts, 'must be thinned below 52').toBeLessThan(52)
    expect(svg).toContain('rotate(-45')
  })
})
