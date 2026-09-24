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
import { parseLedger, seriesFromLedger, type LedgerTable } from './ledger.ts'
import { planCategoricalLabels } from './axis-labels.ts'
import type { IrObjectRecord } from '../ir/store.ts'

export const FIGURE_STYLE_PROFILE = 'okabe-ito-v1'
export const FIGURE_CHART_TYPES = ['line', 'scatter', 'bar', 'table'] as const
export type FigureChartType = (typeof FIGURE_CHART_TYPES)[number]

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
}

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
  }
  return { ok: true, input, data_hash: `sha256:${sha256Hex(canonicalJson(input))}` }
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
}

/** Render one canonical input to deterministic SVG bytes (no time/rand).
 *  W9-B4 — 图内噪声硬规则：数据图**不写 plt.title()**（题注只在交付物的题注
 *  行，由 report-renderer 输出），图内文字只留轴标签与数据锚点短标签。
 *  本渲染器因此从不输出 caption 到 SVG 内部——caption 字段仅供审计对账。 */
export function renderFigureSvg(input: RenderInput): string {
  if (input.chart_type === 'table') return renderTableSvg(input)
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
    if (input.chart_type === 'bar') {
      parts.push(`<rect x="${px - 10}" y="${py}" width="20" height="${Math.max(0, T + plotH - py)}" fill="${color(i)}"/>`)
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
    parts.push(`<text x="${T / 2}" y="${L - 46}" transform="rotate(-90 ${T / 2} ${L - 46})" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${INK}">${escapeXml(input.y_label)}</text>`)
  }
  if (input.x_label !== undefined) {
    parts.push(`<text x="${L + plotW / 2}" y="${H - 12}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${INK}">${escapeXml(input.x_label)}</text>`)
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
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad

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

  // grid + ticks (4 divisions)
  const gridRows = 4
  for (let row = 0; row <= gridRows; row += 1) {
    const gy = T + (plotH / gridRows) * row
    parts.push(`<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="${recipe.grid_color}" stroke-width="1"/>`)
    const gv = yMax - ((yMax - yMin) / gridRows) * row
    parts.push(`<text x="${L - 8}" y="${gy + 4}" text-anchor="end" font-family="monospace" font-size="${recipe.font_size - 1}" fill="${recipe.ink}">${fmtTick(gv)}</text>`)
  }
  const gridCols = 5
  for (let col = 0; col <= gridCols; col += 1) {
    const gx = L + (plotW / gridCols) * col
    const gv = xMin + ((xMax - xMin) / gridCols) * col
    parts.push(`<line x1="${gx}" y1="${T}" x2="${gx}" y2="${T + plotH}" stroke="${recipe.grid_color}" stroke-width="1"/>`)
    parts.push(`<text x="${gx}" y="${T + plotH + 16}" text-anchor="middle" font-family="monospace" font-size="${recipe.font_size - 1}" fill="${recipe.ink}">${fmtTick(gv)}</text>`)
  }
  // axes spines
  parts.push(`<line x1="${L}" y1="${T}" x2="${L}" y2="${T + plotH}" stroke="${recipe.ink}" stroke-width="1"/>`)
  parts.push(`<line x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${T + plotH}" stroke="${recipe.ink}" stroke-width="1"/>`)

  const color = (i: number): string => recipe.palette[i % recipe.palette.length] ?? recipe.ink

  // category labels under the axis — planned (rotate + thin when crowded).
  // 事故（用户实测）：54 个地块名横排在 580px 里全部重叠。照搬 matplotlib
  // 的 rotation=45/ha='right' + 确定性抽稀（首标签必画）。
  if (categorical && catPlan !== undefined) {
    const tickFont = recipe.font_size - 2
    for (const p of catPlan.labels) {
      const gx = sx(p.index + 1)
      if (!p.rotate) {
        parts.push(`<text x="${fmt(gx)}" y="${T + plotH + 16}" text-anchor="middle" font-family="sans-serif" font-size="${tickFont}" fill="${recipe.ink}">${escapeXml(p.label)}</text>`)
      } else {
        parts.push(`<text x="${fmt(gx)}" y="${T + plotH + 12}" text-anchor="end" font-family="sans-serif" font-size="${tickFont}" fill="${recipe.ink}" transform="rotate(-45 ${fmt(gx)} ${T + plotH + 12})">${escapeXml(p.label)}</text>`)
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
      xs.forEach((xv, i) => {
        const yv = sr.y[i] ?? 0
        const bx = sx(xv) - (series2d.length / 2 - si) * bw
        parts.push(`<rect x="${fmt(bx - bw / 2)}" y="${fmt(sy(yv))}" width="${fmt(bw)}" height="${fmt(Math.max(0, T + plotH - sy(yv)))}" fill="${c}" fill-opacity="0.85"/>`)
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
      parts.push(`<text x="${fmt(lx + 32)}" y="${fmt(ry + recipe.font_size)}" font-family="sans-serif" font-size="${recipe.font_size}" fill="${recipe.ink}">${escapeXml(sr.label)}</text>`)
    })
  }

  if (input.y_label !== undefined) {
    parts.push(`<text x="${T / 2}" y="${L - 50}" transform="rotate(-90 ${T / 2} ${L - 50})" text-anchor="middle" font-family="sans-serif" font-size="${recipe.font_size}" fill="${recipe.ink}">${escapeXml(input.y_label)}</text>`)
  }
  if (input.x_label !== undefined) {
    parts.push(`<text x="${L + plotW / 2}" y="${H - 10}" text-anchor="middle" font-family="sans-serif" font-size="${recipe.font_size}" fill="${recipe.ink}">${escapeXml(input.x_label)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}

/** Tick formatter: compact, deterministic, no exponent surprises. */
function fmtTick(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return v.toExponential(1)
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 1000) / 1000)
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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
    parts.push(`<text x="${cols[i]}" y="20" text-anchor="start" font-family="sans-serif" font-size="12" font-weight="600" fill="${INK}">${escapeXml(label)}</text>`)
  })
  parts.push(`<line x1="8" y1="${headerH - 4}" x2="${W - 8}" y2="${headerH - 4}" stroke="${INK}" stroke-width="1"/>`)
  input.series.forEach((s, row) => {
    const y = headerH + row * rowH + 18
    const uncertainty = s.uncertainty === null ? '—' : `±${fmt(s.uncertainty)}`
    const cells = [s.label, fmt(s.value), s.unit, uncertainty]
    cells.forEach((cell, i) => {
      const mono = i === 1 || i === 3
      parts.push(`<text x="${cols[i]}" y="${y}" text-anchor="start" font-family="${mono ? 'monospace' : 'sans-serif'}" font-size="12" fill="${INK}">${escapeXml(cell)}</text>`)
    })
    if (row > 0) {
      parts.push(`<line x1="8" y1="${headerH + row * rowH + 4}" x2="${W - 8}" y2="${headerH + row * rowH + 4}" stroke="${GRID}" stroke-width="1"/>`)
    }
  })
  if (input.caption !== undefined) {
    parts.push(`<text x="8" y="${H - 2}" text-anchor="start" font-family="sans-serif" font-size="11" fill="${INK}">${escapeXml(input.caption)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}
