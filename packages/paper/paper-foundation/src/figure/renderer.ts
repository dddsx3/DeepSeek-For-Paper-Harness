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

/** The canonical render input the figure's bytes are derived from. */
export interface RenderInput {
  readonly style_profile: typeof FIGURE_STYLE_PROFILE
  readonly chart_type: FigureChartType
  readonly caption?: string
  readonly x_label?: string
  readonly y_label?: string
  readonly series: ReadonlyArray<RenderSeries>
}

export type RenderInputResult =
  | { ok: true; input: RenderInput; data_hash: string }
  | { ok: false; reason: string }

/** Derive the canonical render input from a figure's data_refs. A ref that
 *  is not a Result/DataArtifact in the store is a refusal — the figure can
 *  only draw what canonical data actually holds. */
export function figureRenderInput(
  store: ReadonlyMap<string, IrObjectRecord> | null,
  figure: {
    readonly data_refs: ReadonlyArray<string>
    readonly chart_type?: string
    readonly caption?: string
    readonly x_label?: string
    readonly y_label?: string
  },
): RenderInputResult {
  if (store === null) return { ok: false, reason: 'no canonical store' }
  const chart = figure.chart_type === undefined ? 'line' : figure.chart_type
  if (!FIGURE_CHART_TYPES.includes(chart as FigureChartType)) {
    return { ok: false, reason: `chart_type '${chart}' is outside the fixed renderer's whitelist [${FIGURE_CHART_TYPES.join(', ')}]` }
  }
  const series: RenderSeries[] = []
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
      // DataArtifacts carry no numeric value the fixed renderer can draw
      // in v1; refusing keeps the contract honest (figure numeric data is
      // Result-only until a data-table chart type exists).
      return { ok: false, reason: `data_ref '${ref}' is a DataArtifact; v1 renderer draws numeric Results only` }
    }
    return { ok: false, reason: `data_ref '${ref}' resolves to kind '${record.kind}', not Result/DataArtifact` }
  }
  if (series.length === 0) return { ok: false, reason: 'figure declares no numeric data_refs to render' }
  const input: RenderInput = {
    style_profile: FIGURE_STYLE_PROFILE,
    chart_type: chart as FigureChartType,
    ...(figure.caption === undefined ? {} : { caption: figure.caption }),
    ...(figure.x_label === undefined ? {} : { x_label: figure.x_label }),
    ...(figure.y_label === undefined ? {} : { y_label: figure.y_label }),
    series,
  }
  return { ok: true, input, data_hash: `sha256:${sha256Hex(canonicalJson(input))}` }
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
}

/** Render one canonical input to deterministic SVG bytes (no time/rand). */
export function renderFigureSvg(input: RenderInput): string {
  if (input.chart_type === 'table') return renderTableSvg(input)
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
  if (input.caption !== undefined) {
    parts.push(`<text x="${L}" y="${18}" font-family="sans-serif" font-size="13" font-weight="600" fill="${INK}">${escapeXml(input.caption)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('\n') + '\n'
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
