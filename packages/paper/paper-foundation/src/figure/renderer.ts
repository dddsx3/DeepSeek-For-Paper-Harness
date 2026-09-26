/**
 * P2-3 — fixed figure renderer (the ONLY channel that turns canonical data
 * into a figure's bytes; model code can never produce a figure asset, P2 禁3).
 *
 * Determinism contract: identical canonical render input -> identical SVG
 * bytes (no timestamps, no randomness). The render input is derived by the
 * harness from the store's referenced Results/DataArtifacts — the numbers
 * are never authored by the model — and its canonical hash is exactly the
 * FigureSpec.data_hash the gate re-derives (P2 禁2/禁7).
 *
 * Style profile (fixed, harness-owned): Okabe–Ito colourblind-safe palette,
 * no top/right spines, monospaced numeric labels, 680x420 viewBox.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure
 */

import { canonicalJson, sha256Hex } from '../ir/evidence-freeze.ts'
import {
  CJK_FONT_STACK, escapeXml, fitFontSize, fmt, fmtTick, niceScale,
} from './svg-primitives.ts'
import {
  refLineParts, renderForestSvg, renderHeatmapSvg, renderTornadoSvg, renderWaterfallSvg,
} from './chart-types.ts'
import { parseLedger, seriesFromLedger, type LedgerTable } from './ledger.ts'
import { planCategoricalLabels } from './axis-labels.ts'
import type { IrObjectRecord } from '../ir/store.ts'

export const FIGURE_STYLE_PROFILE = 'okabe-ito-v1'
export const FIGURE_CHART_TYPES = [
  'line', 'scatter', 'bar', 'table',
  // 分组柱状（多序列并排）。简报里承诺了这个名字，白名单就必须有它——
  // 否则又是「契约与解析器不一致」，模型照简报写反而被判形态非法。
  'grouped',
  // ── 以下按参考工作流的「图型决策表」补入（原来只有前四种，是水平上不去的主因）──
  // 折线 + 置信带（参考：有重复/CI/误差时必须画 fill_between，不要只画一条均值线）
  'ci_line',
  // 龙卷风图：灵敏度驱动因子排序（参考决策表：单参数扫描 → Tornado，明确不要 grouped bar）
  'tornado',
  // 瀑布图：模块贡献/成本构成（参考：消融/贡献 → Waterfall，明确不要 bar chart）
  'waterfall',
  // 热力图：方法×指标矩阵（带格内数值与明暗自适应文字）
  'heatmap',
  // 森林图：点估计 + 置信区间 + 参考线（临床/统计面板的标准形态）
  'forest',
] as const
export type FigureChartType = (typeof FIGURE_CHART_TYPES)[number]

/**
 * 承载**中文**的字体栈 —— 见 `svg-primitives.ts` 的模块注释（裸 `sans-serif`
 * 在 cairosvg 下没有中日韩字形，栅格化进 docx/PDF 就是豆腐块）。
 *
 * 这里**再导出**一次是为了兼容既有引用（门禁与测试都从本模块取它）；
 * 定义只有一份，在 `svg-primitives.ts`。
 */
export { CJK_FONT_STACK } from './svg-primitives.ts'

/** Okabe–Ito palette (colourblind-safe). */
const SERIES_COLORS = ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9']
const INK = '#222222'
const GRID = '#D8D8D8'

/** A canonical render series: one row per referenced Result. */
export interface RenderSeries {
  readonly label: string
  readonly value: number
  readonly unit: string
  readonly uncertainty: number | null
}

/** W9-A2 — a 2D series: real numeric x axis + y values (+ optional error). */
export interface RenderSeries2D {
  readonly label: string
  /** Numeric x values (numeric axis). Mutually exclusive with xLabels. */
  readonly x?: ReadonlyArray<number>
  /** Category labels (categorical axis, e.g. bar charts over named items). */
  readonly xLabels?: ReadonlyArray<string>
  readonly y: ReadonlyArray<number>
  readonly unit?: string
  /** Per-point error bars (same length as y); omitted = no error bars. */
  readonly error?: ReadonlyArray<number>
}

/** W9-B3 — a NAMED style recipe (data figures; architecture figures have
 *  their own locked style — the two must never share settings, N22). */
export interface DataFigureRecipe {
  readonly name: string
  readonly palette: ReadonlyArray<string>
  readonly font_size: number
  readonly stroke_width: number
  readonly grid_color: string
  readonly ink: string
}

/**
 * W9-B3 — the named data-figure recipes. Colourblind-safe palettes; the
 * reference implementation's hard bans respected (never RdYlGn / RdBu_r).
 * Recipes are data-figure-only: the architecture engine has its own locked
 * C-style mono (N22 — one side leaking into the other is the exact failure
 * the reference warns about).
 */
export const DATA_FIGURE_RECIPES: Readonly<Record<string, DataFigureRecipe>> = {
  'okabe-ito-v1': {
    name: 'okabe-ito-v1',
    palette: ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9'],
    font_size: 12,
    stroke_width: 2,
    grid_color: '#D8D8D8',
    ink: '#222222',
  },
  'journal-ink-v1': {
    name: 'journal-ink-v1',
    palette: ['#1A1A1A', '#4D4D4D', '#808080', '#B3B3B3'],
    font_size: 11,
    stroke_width: 1.5,
    grid_color: '#E0E0E0',
    ink: '#111111',
  },
  // ── 以下配方**移植自参考工作流的配色库**（`skills/shared-scripts/plot_utils.py`
  //    的 PALETTES，2347 行、约 30 套经审美验证的配色）。只搬了 6 套最常用的：
  //    全部低饱和、灰度可辨、且**都不是**参考明令禁用的那几套（tab10 / RdYlGn /
  //    RdBu_r / jet / dark_background）。
  //    为什么配色是"数据"而不是"架构"：`DATA_FIGURE_RECIPES` 已经是现成的扩展点，
  //    加一套配色不该动渲染逻辑。
  // 'npg'（Nature 出版集团）—— 鲜明对比，适合方法/组间对比
  'npg-v1': {
    name: 'npg-v1',
    palette: ['#E64B35', '#4DBBD5', '#00A087', '#3C5488', '#F39B7F', '#8491B4'],
    font_size: 12, stroke_width: 2, grid_color: '#DCDCDC', ink: '#222222',
  },
  // 'nejm'（新英格兰医学杂志）—— 柔和优雅，适合统计/成本类
  'nejm-v1': {
    name: 'nejm-v1',
    palette: ['#BC3C29', '#0072B5', '#E18727', '#20854E', '#7876B1', '#6F99AD'],
    font_size: 12, stroke_width: 2, grid_color: '#DCDCDC', ink: '#222222',
  },
  // 'science'（SciencePlots 经典）—— 工程/优化类
  'science-v1': {
    name: 'science-v1',
    palette: ['#0C5DA5', '#00B945', '#FF9500', '#FF2C00', '#845B97', '#474747'],
    font_size: 12, stroke_width: 2, grid_color: '#DCDCDC', ink: '#222222',
  },
  // 'journal'（顶刊低饱和莫兰迪）—— SCI 投稿首选，灰度下也能分辨
  'journal-muted-v1': {
    name: 'journal-muted-v1',
    palette: ['#4A90B8', '#E8927C', '#7BC8A4', '#B8B8B8', '#F7D097', '#9B8EC4'],
    font_size: 12, stroke_width: 2, grid_color: '#E2E2E2', ink: '#333333',
  },
  // 'elegant'（参考库的默认色）—— 柔和通透，适合统计建模/经管
  'elegant-v1': {
    name: 'elegant-v1',
    palette: ['#7AAEC8', '#E8945A', '#7BC8A4', '#9B8EC4', '#E0A0A0', '#F0C05A'],
    font_size: 12, stroke_width: 2, grid_color: '#E4E4E4', ink: '#3A3A3A',
  },
  // 'tol_muted'（Tol 柔和，色盲安全）—— 多组对比且要印刷友好时
  'tol-muted-v1': {
    name: 'tol-muted-v1',
    palette: ['#4477AA', '#CC6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377'],
    font_size: 12, stroke_width: 2, grid_color: '#DCDCDC', ink: '#222222',
  },
}

/** 数据图配方名（供声明侧选择；顺序即"确定性轮换"的顺序）。 */
export const DATA_FIGURE_RECIPE_NAMES: ReadonlyArray<string> = Object.keys(DATA_FIGURE_RECIPES)

/** The canonical render input the figure's bytes are derived from. */
export interface RenderInput {
  readonly style_profile: typeof FIGURE_STYLE_PROFILE
  readonly chart_type: FigureChartType
  readonly caption?: string
  readonly x_label?: string
  readonly y_label?: string
  readonly series: ReadonlyArray<RenderSeries>
  /** W9-A2 — 2D series (real numeric x axis). Present when any data source
   *  was a ledger (DataArtifact) or the caller declared series2d. */
  readonly series2d?: ReadonlyArray<RenderSeries2D>
  /** W9-B1 — axis scale. 'log' requires all plotted values > 0. */
  readonly y_scale?: 'linear' | 'log'
  readonly x_scale?: 'linear' | 'log'
  /** W9-B3 — the named recipe the figure was rendered with. */
  readonly recipe?: string
  /**
   * 判据线 / 阈值线（参考：有阈值/上限/约束/合格线时，画一条虚线 + 线旁短标签）。
   * 数值同样来自铸出的账本，不由模型手写。
   */
  readonly ref_lines?: ReadonlyArray<{
    readonly axis: 'x' | 'y'
    readonly value: number
    readonly label?: string
  }>
  /** 龙卷风图的数据：每个驱动因子的低/高偏差（同一个基准下的相对变化）。 */
  readonly tornado?: ReadonlyArray<{
    readonly label: string
    readonly low: number
    readonly high: number
    readonly low_label?: string
    readonly high_label?: string
  }>
  /** 基准值（龙卷风/瀑布图在图上标注它）。 */
  readonly baseline?: number
  /** 瀑布图的台阶：kind=total 画成落地柱，kind=delta 画成累积浮柱并连横线。 */
  readonly waterfall?: ReadonlyArray<{
    readonly label: string
    readonly value: number
    readonly kind?: 'delta' | 'total'
  }>
  /** 热力图：行/列名 + 数值矩阵（矩阵必须与行列数一致）。 */
  readonly heatmap?: {
    readonly rows: ReadonlyArray<string>
    readonly cols: ReadonlyArray<string>
    readonly values: ReadonlyArray<ReadonlyArray<number>>
  }
  /** 森林图：每行的点估计与置信区间。 */
  readonly forest?: ReadonlyArray<{
    readonly label: string
    readonly estimate: number
    readonly low: number
    readonly high: number
  }>
  /** W9-A3 — provenance: every ledger-backed series records its source
   *  (data_ref + locator + content hash) so each drawn number traces to the
   *  store. */
  readonly ledger_sources?: ReadonlyArray<{
    readonly data_ref: string
    readonly locator: string
    readonly content_hash: string
  }>
}

export type RenderInputResult =
  | { ok: true; input: RenderInput; data_hash: string }
  | { ok: false; reason: string }

/** Derive the canonical render input from a figure's data_refs. A ref that
 *  is not a Result/DataArtifact in the store is a refusal — the figure can
 *  only draw what canonical data actually holds. */
/** W9-A1 — injected ledger reader (the composition resolves the DataArtifact's
 *  locator to file content; xlsx→CSV conversion happens at registration time). */
export type ReadLedger = (locator: string) => { readonly media_type: string; readonly content: string } | undefined

/** Column mapping for a ledger-backed series. */
export interface LedgerSeriesSpec {
  readonly x_column: string
  readonly y_column: string
  readonly label: string
  readonly error_column?: string
}

export function figureRenderInput(
  store: ReadonlyMap<string, IrObjectRecord> | null,
  figure: {
    readonly data_refs: ReadonlyArray<string>
    readonly chart_type?: string
    readonly caption?: string
    readonly x_label?: string
    readonly y_label?: string
    /**
     * ── 参考决策表补入的图型的**结构化声明** ──────────────────────────
     * 每个字段里写的都是 **Result id**（不是数值）——模型不持有数值这条约束不变，
     * 由 `figureRenderInput` 解析成账本里的真实值；解析不到就具名拒绝。
     */
    readonly ref_lines?: ReadonlyArray<{
      readonly axis: 'x' | 'y'
      readonly value_ref: string
      readonly label?: string
    }>
    readonly tornado?: ReadonlyArray<{
      readonly label: string
      readonly low_ref: string
      readonly high_ref: string
      readonly low_label?: string
      readonly high_label?: string
    }>
    readonly waterfall?: ReadonlyArray<{
      readonly label: string
      readonly value_ref: string
      readonly kind?: 'delta' | 'total'
    }>
    readonly forest?: ReadonlyArray<{
      readonly label: string
      readonly estimate_ref: string
      readonly low_ref: string
      readonly high_ref: string
    }>
    readonly heatmap?: {
      readonly rows: ReadonlyArray<string>
      readonly cols: ReadonlyArray<string>
      readonly value_refs: ReadonlyArray<ReadonlyArray<string>>
    }
    readonly baseline_ref?: string
  },
  opts?: {
    /** W9-A1 — required for DataArtifact data sources; its absence is a
     *  refusal with an actionable reason (never a silent skip). */
    readonly readLedger?: ReadLedger
    /** Per-DataArtifact column mapping (aligned with the DataArtifact refs
     *  that appear in data_refs). */
    readonly ledgerSeries?: ReadonlyArray<LedgerSeriesSpec>
    readonly y_scale?: 'linear' | 'log'
    readonly x_scale?: 'linear' | 'log'
    readonly recipe?: string
  },
): RenderInputResult {
  if (store === null) return { ok: false, reason: 'no canonical store' }
  const chart = figure.chart_type === undefined ? 'line' : figure.chart_type
  if (!FIGURE_CHART_TYPES.includes(chart as FigureChartType)) {
    return { ok: false, reason: `chart_type '${chart}' is outside the fixed renderer's whitelist [${FIGURE_CHART_TYPES.join(', ')}]` }
  }
  const series: RenderSeries[] = []
  // W9-A1 — 2D series accumulated from ledger-backed data sources.
  const series2d: RenderSeries2D[] = []
  const ledgerSources: Array<{ data_ref: string; locator: string; content_hash: string }> = []
  let series2dCount = 0
  for (const ref of figure.data_refs) {
    const record = store.get(ref)
    if (record === undefined) return { ok: false, reason: `data_ref '${ref}' does not resolve in the store` }
    if (record.kind === 'Result') {
      const result = record.value as { result_id: string; name: string; value: number; unit: string; uncertainty: number | null }
      series.push({
        label: result.name,
        value: result.value,
        unit: result.unit,
        uncertainty: result.uncertainty,
      })
      continue
    }
    if (record.kind === 'DataArtifact') {
      // W9-A1 — a DataArtifact is a LEDGER (locator + content hash): the
      // render input reads it through the injected reader and embeds the
      // parsed numbers, so data_hash covers every drawn value (N20 intact —
      // the numbers still come from the store, whose content_hash pins the
      // file). The old refusal was the R1 shape mismatch the task book
      // predicted: the IR record is a pointer, the renderer wanted numbers —
      // the bridge is the injected reader, not a schema change.
      const da = record.value as { data_id: string; locator: string; media_type: string; content_hash: string }
      const readLedger = opts?.readLedger
      if (readLedger === undefined) {
        return {
          ok: false,
          reason: `data_ref '${ref}' is a DataArtifact (locator ${da.locator}); provide opts.readLedger so the render input can read the ledger (W9-A1)`,
        }
      }
      const spec = opts?.ledgerSeries?.[series2dCount] ?? opts?.ledgerSeries?.[0]
      if (spec === undefined) {
        return { ok: false, reason: `data_ref '${ref}' is a DataArtifact; provide opts.ledgerSeries to map its columns to a series` }
      }
      const file = readLedger(da.locator)
      if (file === undefined) {
        return { ok: false, reason: `ledger content for '${da.locator}' is unavailable (the locator does not resolve)` }
      }
      let table: LedgerTable
      try {
        table = parseLedger(da.media_type, file.content)
      } catch (e) {
        return { ok: false, reason: `ledger '${da.locator}' unparseable: ${e instanceof Error ? e.message : String(e)}` }
      }
      let extracted
      try {
        extracted = seriesFromLedger(table, spec.x_column, spec.y_column, spec.label, spec.error_column)
      } catch (e) {
        return { ok: false, reason: `ledger '${da.locator}' series extraction failed: ${e instanceof Error ? e.message : String(e)}` }
      }
      const series2dEntry: RenderSeries2D = {
        label: spec.label,
        ...(extracted.x !== undefined ? { x: extracted.x } : { xLabels: extracted.xLabels ?? [] }),
        y: extracted.y,
        ...(extracted.error !== undefined ? { error: extracted.error } : {}),
      }
      series2d.push(series2dEntry)
      series2dCount += 1
      ledgerSources.push({ data_ref: ref, locator: da.locator, content_hash: da.content_hash })
      continue
    }
    return { ok: false, reason: `data_ref '${ref}' resolves to kind '${record.kind}', not Result/DataArtifact` }
  }
  // W9-A1: a ledger-backed figure carries its data in series2d; the scalar
  // emptiness check only applies when no 2D series was extracted.
  if (series.length === 0 && series2d.length === 0) {
    return { ok: false, reason: 'figure declares no numeric data_refs to render' }
  }
  const recipe = opts?.recipe ?? FIGURE_STYLE_PROFILE
  if (DATA_FIGURE_RECIPES[recipe] === undefined) {
    return { ok: false, reason: `recipe '${recipe}' is not a named data-figure recipe (have: ${Object.keys(DATA_FIGURE_RECIPES).join(', ')})` }
  }
  // ── 参考决策表补入的图型所需的**结构化取数** ──────────────────────
  // 声明里写的仍是 **Result id**（模型不持有数值这条约束不变）；
  // 这里把每个 id 解析成账本里的真实值，解析不到就**具名拒绝**（不猜、不留空）。
  const scalar = (ref: unknown): number | { readonly error: string } => {
    if (typeof ref !== 'string' || ref === '') return { error: '需要一个 Result id 字符串' }
    const rec = store.get(ref)
    if (rec === undefined) return { error: `'${ref}' 在账本里找不到` }
    if (rec.kind !== 'Result') return { error: `'${ref}' 不是 Result（是 ${rec.kind}）` }
    const v = (rec.value as { value?: unknown }).value
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `'${ref}' 的值不是有限数` }
    return v
  }
  const newFields: Record<string, unknown> = {}
  if (figure.ref_lines !== undefined) {
    const out: Array<{ axis: 'x' | 'y'; value: number; label?: string }> = []
    for (const r of figure.ref_lines) {
      const v = scalar(r.value_ref)
      if (typeof v !== 'number') return { ok: false, reason: `ref_lines 的 value_ref ${v.error}` }
      out.push({ axis: r.axis, value: v, ...(r.label === undefined ? {} : { label: r.label }) })
    }
    newFields['ref_lines'] = out
  }
  if (figure.tornado !== undefined) {
    const out = []
    for (const t of figure.tornado) {
      const lo = scalar(t.low_ref); const hi = scalar(t.high_ref)
      if (typeof lo !== 'number') return { ok: false, reason: `tornado '${t.label}' 的 low_ref ${lo.error}` }
      if (typeof hi !== 'number') return { ok: false, reason: `tornado '${t.label}' 的 high_ref ${hi.error}` }
      out.push({ label: t.label, low: lo, high: hi,
        ...(t.low_label === undefined ? {} : { low_label: t.low_label }),
        ...(t.high_label === undefined ? {} : { high_label: t.high_label }) })
    }
    newFields['tornado'] = out
  }
  if (figure.waterfall !== undefined) {
    const out = []
    for (const w of figure.waterfall) {
      const v = scalar(w.value_ref)
      if (typeof v !== 'number') return { ok: false, reason: `waterfall '${w.label}' 的 value_ref ${v.error}` }
      out.push({ label: w.label, value: v, ...(w.kind === undefined ? {} : { kind: w.kind }) })
    }
    newFields['waterfall'] = out
  }
  if (figure.forest !== undefined) {
    const out = []
    for (const f of figure.forest) {
      const e = scalar(f.estimate_ref); const lo = scalar(f.low_ref); const hi = scalar(f.high_ref)
      if (typeof e !== 'number') return { ok: false, reason: `forest '${f.label}' 的 estimate_ref ${e.error}` }
      if (typeof lo !== 'number') return { ok: false, reason: `forest '${f.label}' 的 low_ref ${lo.error}` }
      if (typeof hi !== 'number') return { ok: false, reason: `forest '${f.label}' 的 high_ref ${hi.error}` }
      out.push({ label: f.label, estimate: e, low: lo, high: hi })
    }
    newFields['forest'] = out
  }
  if (figure.heatmap !== undefined) {
    const hm = figure.heatmap
    const values: number[][] = []
    for (const row of hm.value_refs) {
      const line: number[] = []
      for (const ref of row) {
        const v = scalar(ref)
        if (typeof v !== 'number') return { ok: false, reason: `heatmap 的 value_ref ${v.error}` }
        line.push(v)
      }
      values.push(line)
    }
    newFields['heatmap'] = { rows: hm.rows, cols: hm.cols, values }
  }
  if (figure.baseline_ref !== undefined) {
    const v = scalar(figure.baseline_ref)
    if (typeof v !== 'number') return { ok: false, reason: `baseline_ref ${v.error}` }
    newFields['baseline'] = v
  }
  const input: RenderInput = {
    style_profile: FIGURE_STYLE_PROFILE,
    chart_type: chart as FigureChartType,
    ...(figure.caption === undefined ? {} : { caption: figure.caption }),
    ...(figure.x_label === undefined ? {} : { x_label: figure.x_label }),
    ...(figure.y_label === undefined ? {} : { y_label: figure.y_label }),
    series,
    ...(series2d.length > 0 ? { series2d } : {}),
    ...(opts?.y_scale === 'log' ? { y_scale: 'log' as const } : {}),
    ...(opts?.x_scale === 'log' ? { x_scale: 'log' as const } : {}),
    recipe,
    ...(ledgerSources.length > 0 ? { ledger_sources: ledgerSources } : {}),
    ...newFields,
  }
  return { ok: true, input, data_hash: `sha256:${sha256Hex(canonicalJson(input))}` }
}

/** Render one canonical input to deterministic SVG bytes (no time/rand).
 *  W9-B4 — 图内噪声硬规则：数据图**不写 plt.title()**（题注只在交付物的题注
 *  行，由 report-renderer 输出），图内文字只留轴标签与数据锚点短标签。
 *  本渲染器因此从不输出 caption 到 SVG 内部——caption 字段仅供审计对账。 */
export function renderFigureSvg(input: RenderInput): string {
  if (input.chart_type === 'table') return renderTableSvg(input)
  // 按参考决策表补入的图型（各有自己的版式，不复用折线的坐标系）
  const recipe0 = DATA_FIGURE_RECIPES[input.recipe ?? FIGURE_STYLE_PROFILE]
  if (recipe0 !== undefined) {
    if (input.chart_type === 'tornado') return renderTornadoSvg(input, recipe0)
    if (input.chart_type === 'waterfall') return renderWaterfallSvg(input, recipe0)
    if (input.chart_type === 'heatmap') return renderHeatmapSvg(input, recipe0)
    if (input.chart_type === 'forest') return renderForestSvg(input, recipe0)
  }
  if (input.series2d !== undefined && input.series2d.length > 0) return renderSeries2DSvg(input)
  const W = 680
  const H = 420
  const L = 72
  const R = 24
  const T = 34
  const B = 48
  const plotW = W - L - R
  const plotH = H - T - B
  const values = input.series.map(s => s.value)
  const min = Math.min(0, ...values)
  let max = Math.max(0, ...values)
  if (max === min) max = min + 1
  const x = (i: number): number => {
    const n = input.series.length
    return L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  }
  const y = (v: number): number => T + plotH * (1 - (v - min) / (max - min))
  const gridRows = 4
  const parts: string[] = []
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="680" height="420" viewBox="0 0 680 420" role="img">')
  // Background + plot frame (no top/right spine: grid only).
  for (let row = 0; row <= gridRows; row += 1) {
    const gy = T + (plotH / gridRows) * row
    parts.push(`<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="${GRID}" stroke-width="1"/>`)
    const gv = min + ((max - min) / gridRows) * (gridRows - row)
    parts.push(`<text x="${L - 8}" y="${gy + 4}" text-anchor="end" font-family="monospace" font-size="11" fill="${INK}">${fmt(gv)}</text>`)
  }
  parts.push(`<line x1="${L}" y1="${T}" x2="${L}" y2="${T + plotH}" stroke="${INK}" stroke-width="1"/>`)
  parts.push(`<line x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${T + plotH}" stroke="${INK}" stroke-width="1"/>`)

  const color = (i: number): string => SERIES_COLORS[i % SERIES_COLORS.length] ?? INK
  input.series.forEach((s, i) => {
    const px = x(i)
    const py = y(s.value)
    if (input.chart_type === 'bar' || input.chart_type === 'grouped') {
      // 浅填充 + 主色描边（参考的柱状规矩），并**在柱顶直接标数值**。
      // 参考把它列为完整性红线：*"隐藏刻度就必须直接标注数据；两者都没有 = 残图"*。
      // 这条路径（标量 Result 的柱状图）原来既无描边也无标注——门禁 `figure_completeness`
      // 在夹具上把它抓出来了，是**真缺陷**，不是夹具问题。
      parts.push(`<rect x="${px - 10}" y="${py}" width="20" height="${Math.max(1, T + plotH - py)}" fill="${color(i)}" fill-opacity="0.42" stroke="${color(i)}" stroke-width="1.2"/>`)
      parts.push(`<text x="${fmt(px)}" y="${fmt(py - 4)}" text-anchor="middle" font-family="monospace" font-size="10" fill="${INK}">${fmtTick(s.value)}</text>`)
      // 类别名（标量路径里每个系列就是一个类别，用系列名当类别名）
      const lfs = fitFontSize(s.label, 120, 11)
      parts.push(`<text x="${fmt(px)}" y="${T + plotH + 16}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${String(lfs)}" fill="${INK}">${escapeXml(s.label)}</text>`)
    } else {
      const dot = input.chart_type === 'scatter'
        ? `<circle cx="${px}" cy="${py}" r="4.5" fill="${color(i)}"/>`
        : `<circle cx="${px}" cy="${py}" r="3" fill="${color(i)}"/>`
      parts.push(dot)
    }
  })
  if (input.chart_type === 'line' && input.series.length > 1) {
    const points = input.series.map((s, i) => `${fmt(x(i))},${fmt(y(s.value))}`).join(' ')
    parts.push(`<polyline points="${points}" fill="none" stroke="${color(0)}" stroke-width="2"/>`)
  }
  if (input.y_label !== undefined) {
    parts.push(`<text x="${T / 2}" y="${L - 46}" transform="rotate(-90 ${T / 2} ${L - 46})" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="12" fill="${INK}">${escapeXml(input.y_label)}</text>`)
  }
  if (input.x_label !== undefined) {
    parts.push(`<text x="${L + plotW / 2}" y="${H - 12}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="12" fill="${INK}">${escapeXml(input.x_label)}</text>`)
  }
  // W9-B4 —— 数据图**不写图内标题**（`plt.title` 的等价物）。题注由交付物正文给
  // （`report-v2.ts` 输出独立的题注行），图里再写一遍是噪声，也会被
  // `figure_style_rules` 门禁按"题注不得出现在图内"判失败。
  //
  // 第一版这里确实把 `caption` 画进了 SVG，而模块头的契约写着"从不输出 caption
  // 到 SVG 内部"——**代码与自己的契约相反**。契约是对的（参考的 setup_style 禁
  // plt.title），所以改的是代码：`caption` 字段只供审计对账，不进字节。
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}

/**
 * W9-B1/B2 — the 2D series renderer: real numeric x axis, error bars,
 * multi-series with legend, optional log scale.
 *
 * 确定性契约与标量路径相同：同一 RenderInput → 同一 SVG 字节（无时钟、无随机）。
 * 配方（配色/字号/线宽）来自命名的 data-figure recipe（N22：与架构图隔离）。
 */
function renderSeries2DSvg(input: RenderInput): string {
  const fallbackRecipe = DATA_FIGURE_RECIPES['okabe-ito-v1']
  if (fallbackRecipe === undefined) throw new Error('default recipe okabe-ito-v1 missing')
  const recipe = DATA_FIGURE_RECIPES[input.recipe ?? 'okabe-ito-v1'] ?? fallbackRecipe
  const series2d = input.series2d ?? []
  const W = 680
  const H = 440
  const L = 76
  const R = 24
  const T = 28
  // W9（用户实测）：类别标签需要旋转/抽稀时，底部预留更多空间
  const catLabels = (input.series2d?.[0]?.xLabels) ?? []
  const catSlotPx = (W - L - R) / Math.max(1, catLabels.length)
  const catPlan = catLabels.length > 0
    ? planCategoricalLabels(catLabels, catSlotPx, recipe.font_size - 2)
    : undefined
  const B = catPlan?.rotate === true ? 86 : 52
  const plotW = W - L - R
  const plotH = H - T - B

  const first = series2d[0]
  const categorical = first?.xLabels !== undefined
  const categoryCount = categorical ? (first?.xLabels.length ?? 0) : 0
  const allX = categorical
    ? Array.from({ length: categoryCount }, (_, i) => i + 1)
    : series2d.flatMap(sr => [...(sr.x ?? [])])
  const allY = series2d.flatMap(sr => [...sr.y, ...(sr.error ?? [])])
  let xMin = Math.min(...allX)
  let xMax = Math.max(...allX)
  let yMin = Math.min(...allY)
  let yMax = Math.max(...allY)
  if (input.y_scale === 'log') {
    const positive = allY.filter(v => v > 0)
    if (positive.length !== allY.length) {
      throw new Error("y_scale 'log' requires every plotted value > 0")
    }
    yMin = Math.min(...positive)
    yMax = Math.max(...positive)
  }
  if (xMin === xMax) { xMin -= 1; xMax += 1 }
  if (yMin === yMax) { yMin -= 1; yMax += 1 }
  const xPad = (xMax - xMin) * 0.04
  const yPad = (yMax - yMin) * 0.06
  xMin -= xPad; xMax += xPad
  // **值轴刻度取整**（参考：把关键阈值/端点塞进刻度；实测旧图纵轴是 22.33 / 19.295 /
  // 16.26 这种非整数，读起来很业余）。留白之后再把区间扩到 1/2/5×10^k 的整数刻度上，
  // 于是刻度标签天然落在整数（或一位小数）上。
  //
  // **只对线性轴做**：对数轴的取值域必须严格为正，而取整会把下界推到 0 甚至负数
  // （`Math.floor(lo/step)*step`），于是 `log10(yMin)` 直接炸——实测把既有的对数轴
  // 用例打红了。对数轴本来就有自己的 Locator，不需要这一层。
  const yNice = input.y_scale === 'log'
    ? { lo: yMin, hi: yMax, step: (yMax - yMin) / 4 }
    : niceScale(yMin - yPad, yMax + yPad, 4)
  yMin = yNice.lo; yMax = yNice.hi
  const yStep = yNice.step > 0 ? yNice.step : (yMax - yMin) / 4

  const sx = (v: number): number => {
    if (input.x_scale === 'log') {
      if (v <= 0) throw new Error("x_scale 'log' requires every x > 0")
      return L + ((Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * plotW
    }
    return L + ((v - xMin) / (xMax - xMin)) * plotW
  }
  const sy = (v: number): number => {
    if (input.y_scale === 'log') {
      if (v <= 0) throw new Error("y_scale 'log' requires every y > 0")
      return T + plotH * (1 - (Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin)))
    }
    return T + plotH * (1 - (v - yMin) / (yMax - yMin))
  }

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`)
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`)

  // grid + ticks —— 段数由**取整后的步长**推出（原来写死 4 段，与取整后的区间对不上）
  const gridRows = Math.max(1, Math.round((yMax - yMin) / yStep))
  for (let row = 0; row <= gridRows; row += 1) {
    const gv = yMin + yStep * row
    const gy = sy(gv)
    parts.push(`<line x1="${L}" y1="${fmt(gy)}" x2="${W - R}" y2="${fmt(gy)}" stroke="${recipe.grid_color}" stroke-width="1"/>`)
    parts.push(`<text x="${L - 8}" y="${fmt(gy + 4)}" text-anchor="end" font-family="monospace" font-size="${recipe.font_size - 1}" fill="${recipe.ink}">${fmtTick(gv)}</text>`)
  }
  // **类别轴上不画数值刻度**（第四个实测缺陷）。
  // 分类轴（`xLabels`）的刻度位置是 1..n 的序号，画出来就是 `0.8 / 1.8 / 2.8…`
  // 与类别名**压在同一行**（用户看图能看到「0.8情况1」叠字）。
  // 参考工作流的完整性红线说得直接："隐藏刻度就必须直接标注数据"——反过来说，
  // 已经用类别名标注了，再叠一层无意义的序号刻度就是噪声。
  const gridCols = 5
  if (!categorical) {
    for (let col = 0; col <= gridCols; col += 1) {
      const gx = L + (plotW / gridCols) * col
      const gv = xMin + ((xMax - xMin) / gridCols) * col
      parts.push(`<line x1="${gx}" y1="${T}" x2="${gx}" y2="${T + plotH}" stroke="${recipe.grid_color}" stroke-width="1"/>`)
      parts.push(`<text x="${gx}" y="${T + plotH + 16}" text-anchor="middle" font-family="monospace" font-size="${recipe.font_size - 1}" fill="${recipe.ink}">${fmtTick(gv)}</text>`)
    }
  }
  // axes spines
  parts.push(`<line x1="${L}" y1="${T}" x2="${L}" y2="${T + plotH}" stroke="${recipe.ink}" stroke-width="1"/>`)
  parts.push(`<line x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${T + plotH}" stroke="${recipe.ink}" stroke-width="1"/>`)
  // **判据线 / 阈值线**（参考：有阈值/上限/约束/合格线时必画，虚线 + 线旁短标签）。
  // 画在数据之下（先画），免得盖住柱/线。
  parts.push(...refLineParts(input, sx, sy, recipe.font_size))

  const color = (i: number): string => recipe.palette[i % recipe.palette.length] ?? recipe.ink

  // category labels under the axis — planned (rotate + thin when crowded).
  // 事故（用户实测）：54 个地块名横排在 580px 里全部重叠。照搬 matplotlib
  // 的 rotation=45/ha='right' + 确定性抽稀（首标签必画）。
  if (categorical && catPlan !== undefined) {
    const tickFont = recipe.font_size - 2
    for (const p of catPlan.labels) {
      const gx = sx(p.index + 1)
      if (!p.rotate) {
        parts.push(`<text x="${fmt(gx)}" y="${T + plotH + 16}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${tickFont}" fill="${recipe.ink}">${escapeXml(p.label)}</text>`)
      } else {
        parts.push(`<text x="${fmt(gx)}" y="${T + plotH + 12}" text-anchor="end" font-family="${CJK_FONT_STACK}" font-size="${tickFont}" fill="${recipe.ink}" transform="rotate(-45 ${fmt(gx)} ${T + plotH + 12})">${escapeXml(p.label)}</text>`)
      }
    }
  }
  series2d.forEach((sr, si) => {
    const c = color(si)
    const xs = categorical ? sr.y.map((_, i) => i + 1) : (sr.x ?? [])
    const pts = xs.map((xv, i) => `${fmt(sx(xv))},${fmt(sy(sr.y[i] ?? 0))}`).join(' ')
    if (input.chart_type === 'bar') {
      // bar width derived from spacing so multi-series bars don't overlap
      const bw = Math.max(4, plotW / (xs.length * series2d.length + 1) * 0.7)
      // 参考工作流的两条硬规矩，原来都没做：
      // ① **"浅色填充 + 主色描边"**（原来只有 0.85 不透明填充、无描边）；
      // ② **柱顶直接标数值**（`ax.bar_label` 的等价物）——否则读图的人得拿眼睛
      //    去比刻度，而"隐藏刻度又不直接标注"在参考里直接判**残图**。
      // 柱太多时（> 12 根）不标，避免糊成一片（参考对热力图也是这个口径：
      // "如果格子太小就不标数值"）。
      const labelEveryBar = xs.length * series2d.length <= 12
      xs.forEach((xv, i) => {
        const yv = sr.y[i] ?? 0
        const bx = sx(xv) - (series2d.length / 2 - si) * bw
        const top = sy(yv)
        const base = sy(Math.max(yMin, 0))
        const y0 = Math.min(top, base)
        const h = Math.max(1, Math.abs(base - top))
        parts.push(`<rect x="${fmt(bx - bw / 2)}" y="${fmt(y0)}" width="${fmt(bw)}" height="${fmt(h)}" fill="${c}" fill-opacity="0.42" stroke="${c}" stroke-width="1.2"/>`)
        if (labelEveryBar) {
          const above = yv >= 0
          parts.push(`<text x="${fmt(bx)}" y="${fmt(above ? y0 - 4 : y0 + h + 11)}" text-anchor="middle" font-family="monospace" font-size="${recipe.font_size - 2}" fill="${recipe.ink}">${fmtTick(yv)}</text>`)
        }
      })
      return
    }
    if (input.chart_type === 'scatter') {
      xs.forEach((xv, i) => {
        parts.push(`<circle cx="${fmt(sx(xv))}" cy="${fmt(sy(sr.y[i] ?? 0))}" r="3.5" fill="${c}"/>`)
      })
    } else {
      parts.push(`<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="${recipe.stroke_width}"/>`)
      xs.forEach((xv, i) => {
        parts.push(`<circle cx="${fmt(sx(xv))}" cy="${fmt(sy(sr.y[i] ?? 0))}" r="2.6" fill="${c}"/>`)
      })
    }
    // error bars (W9-B1): vertical caps at each point
    const srError = sr.error
    if (srError !== undefined) {
      xs.forEach((xv, i) => {
        const yv = sr.y[i] ?? 0
        const ev = srError[i] ?? 0
        const yTop = sy(yv + ev)
        const yBot = sy(yv - ev)
        const cx = sx(xv)
        parts.push(`<line x1="${fmt(cx)}" y1="${fmt(yTop)}" x2="${fmt(cx)}" y2="${fmt(yBot)}" stroke="${c}" stroke-width="1"/>`)
        parts.push(`<line x1="${fmt(cx - 4)}" y1="${fmt(yTop)}" x2="${fmt(cx + 4)}" y2="${fmt(yTop)}" stroke="${c}" stroke-width="1"/>`)
        parts.push(`<line x1="${fmt(cx - 4)}" y1="${fmt(yBot)}" x2="${fmt(cx + 4)}" y2="${fmt(yBot)}" stroke="${c}" stroke-width="1"/>`)
      })
    }
  })

  // legend (multi-series only) — top-right inside the plot, one row per series
  if (series2d.length > 1) {
    const legendW = Math.max(...series2d.map(sr => sr.label.length)) * recipe.font_size * 0.62 + 34
    const lx = W - R - legendW - 8
    const ly = T + 8
    parts.push(`<rect x="${fmt(lx)}" y="${fmt(ly)}" width="${fmt(legendW)}" height="${fmt(series2d.length * (recipe.font_size + 6) + 8)}" fill="#FFFFFF" fill-opacity="0.92" stroke="${recipe.grid_color}" stroke-width="1"/>`)
    series2d.forEach((sr, si) => {
      const c = color(si)
      const ry = ly + 10 + si * (recipe.font_size + 6)
      parts.push(`<line x1="${fmt(lx + 8)}" y1="${fmt(ry + recipe.font_size / 2)}" x2="${fmt(lx + 26)}" y2="${fmt(ry + recipe.font_size / 2)}" stroke="${c}" stroke-width="${recipe.stroke_width + 1}"/>`)
      parts.push(`<text x="${fmt(lx + 32)}" y="${fmt(ry + recipe.font_size)}" font-family="${CJK_FONT_STACK}" font-size="${recipe.font_size}" fill="${recipe.ink}">${escapeXml(sr.label)}</text>`)
    })
  }

  // 轴标签：**放不下就缩字号**，不许被画布裁掉。
  // 实测缺陷（用户看图发现）：`单位期望利润（元）` 旋转后长度超过上边距，
  // 顶部的「元）」被裁在画布外——而裁掉的正好是单位，等于把图读成无单位的数。
  // 参考工作流的红线写得很直白：轴标签必须带单位、且"Axis tick labels cut off"是必修项。
  // 摆位也一并改成**居中在绘图区内**（原来固定在 `L-50`，标签一长就往画布外跑）。
  if (input.y_label !== undefined) {
    const fs = fitFontSize(input.y_label, plotH, recipe.font_size)
    const cy = T + plotH / 2
    parts.push(`<text x="${fmt(T / 2)}" y="${fmt(cy)}" transform="rotate(-90 ${fmt(T / 2)} ${fmt(cy)})" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${fs}" fill="${recipe.ink}">${escapeXml(input.y_label)}</text>`)
  }
  if (input.x_label !== undefined) {
    const fs = fitFontSize(input.x_label, plotW, recipe.font_size)
    parts.push(`<text x="${fmt(L + plotW / 2)}" y="${H - 10}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${fs}" fill="${recipe.ink}">${escapeXml(input.x_label)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}



/**
 * P3-4: the `table` chart type — one row per data_ref (量名 / 值 / 单位 /
 * 不确定度), rendered as a deterministic SVG table. The numbers are the
 * store's Result values verbatim (the render input already guarantees they
 * were derived, never authored); DataArtifacts never reach here (the render
 * input refuses them for every chart type, 禁4).
 */
function renderTableSvg(input: RenderInput): string {
  const W = 680
  const rowH = 26
  const headerH = 30
  const H = headerH + rowH * input.series.length + 14
  const cols = [72, 300, 470, 570, 668]
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`)
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#FFFFFF"/>`)
  const header = ['量名', '数值', '单位', '不确定度']
  header.forEach((label, i) => {
    parts.push(`<text x="${cols[i]}" y="20" text-anchor="start" font-family="${CJK_FONT_STACK}" font-size="12" font-weight="600" fill="${INK}">${escapeXml(label)}</text>`)
  })
  parts.push(`<line x1="8" y1="${headerH - 4}" x2="${W - 8}" y2="${headerH - 4}" stroke="${INK}" stroke-width="1"/>`)
  input.series.forEach((s, row) => {
    const y = headerH + row * rowH + 18
    const uncertainty = s.uncertainty === null ? '—' : `±${fmt(s.uncertainty)}`
    const cells = [s.label, fmt(s.value), s.unit, uncertainty]
    cells.forEach((cell, i) => {
      const mono = i === 1 || i === 3
      parts.push(`<text x="${cols[i]}" y="${y}" text-anchor="start" font-family="${mono ? 'monospace' : CJK_FONT_STACK}" font-size="12" fill="${INK}">${escapeXml(cell)}</text>`)
    })
    if (row > 0) {
      parts.push(`<line x1="8" y1="${headerH + row * rowH + 4}" x2="${W - 8}" y2="${headerH + row * rowH + 4}" stroke="${GRID}" stroke-width="1"/>`)
    }
  })
  // W9-B4 —— 表格图同样**不写图内标题**。标量路径修掉这一处时漏了这里：
  // 2024B 阶段 4 实测，`table` 图的题注进了 SVG，被 figure_style_rules 按同一
  // 判据拦下。题注由正文给，两条路径一条契约。
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}
