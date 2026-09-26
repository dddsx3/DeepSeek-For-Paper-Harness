/**
 * 按参考工作流的**图型决策表**补入的图型 —— 与 `renderer.ts` 的原四种并列。
 *
 * ## 为什么需要它们（用户实测："作图水平相当低"）
 *
 * 原来只有 `line / scatter / bar / table`。而参考工作流的决策表对本题的几类数据
 * 有明确指定，并且**明确否掉了柱状图**：
 *
 * | 数据形态 | 参考指定 | 参考明确避免 |
 * |---|---|---|
 * | 灵敏度（单参数扫描 / 驱动因子排序） | **Tornado**（barh 按 range 排序） | grouped bar（丢失排序） |
 * | 模块贡献 / 消融 | **Waterfall** | bar chart |
 * | 时间序列 / 带重复 | 折线 + **置信带** | 只画一条均值线 |
 * | 方法×指标矩阵 | **Heatmap**（带格内数值） | 无标注的深色热力图 |
 * | 统计对比 / 区间估计 | **Forest plot**（点估计 + CI + 参考线） | 分开的多张柱状图 |
 *
 * 而且参考有一条硬合同：*"规划写了什么图型，就必须画出那个图型——凭印象退化成
 * plot/bar/scatter 是最常见的质量塌方"*。只有四种图型时，那条合同根本无法履行。
 *
 * ## 数值来源不变
 *
 * 每个数仍然来自**铸出的账本**（`results.json`）：本模块只负责画，不负责取数。
 * 声明的 `data_refs` 由 `figureRenderInput` 解析成这里的 `tornado` / `waterfall` /
 * `heatmap` / `forest` 字段——模型从头到尾不持有数值这条约束没有被放松。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure/chart-types
 */

import {
  CJK_FONT_STACK, escapeXml, fmt, fmtTick, fitFontSize, isCjk, lighten, niceScale, readableInkOn,
} from './svg-primitives.ts'
import type { DataFigureRecipe, RenderInput } from './renderer.ts'

/** 画布与边距（与原渲染器同一套版式常量，保持篇内一致）。 */
export const FRAME = { W: 680, H: 420, L: 72, R: 24, T: 34, B: 48 } as const

/** 取配方里的第 i 个颜色（越界回落到墨色）。 */
export function colorOf(recipe: DataFigureRecipe, i: number): string {
  return recipe.palette[i % recipe.palette.length] ?? recipe.ink
}

/** SVG 头 + 白底（每张图都一样的两行）。 */
export function svgOpen(): ReadonlyArray<string> {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(FRAME.W)}" height="${String(FRAME.H)}" viewBox="0 0 ${String(FRAME.W)} ${String(FRAME.H)}" role="img">`,
    `<rect x="0" y="0" width="${String(FRAME.W)}" height="${String(FRAME.H)}" fill="#FFFFFF"/>`,
  ]
}

/**
 * 画**判据线 / 阈值线**（参考：有阈值/上限/约束/合格线时必画，虚线 + 线旁短标签）。
 *
 * @param input - 渲染输入（取 `ref_lines`）。
 * @param sx - 数据 x → 像素 x。
 * @param sy - 数据 y → 像素 y。
 * @param ink - 文字色。
 * @param font - 字号。
 * @returns SVG 片段（可能为空）。
 */
export function refLineParts(
  input: RenderInput, sx: (v: number) => number, sy: (v: number) => number,
  font: number,
): ReadonlyArray<string> {
  const out: string[] = []
  for (const r of input.ref_lines ?? []) {
    const label = r.label === undefined ? '' : escapeXml(r.label)
    if (r.axis === 'y') {
      const y = fmt(sy(r.value))
      out.push(`<line x1="${String(FRAME.L)}" y1="${y}" x2="${String(FRAME.W - FRAME.R)}" y2="${y}" stroke="#AAAAAA" stroke-width="1" stroke-dasharray="5 3"/>`)
      out.push(`<text x="${String(FRAME.W - FRAME.R - 4)}" y="${fmt(sy(r.value) - 4)}" text-anchor="end" font-family="${CJK_FONT_STACK}" font-size="${String(font - 1)}" fill="#888888">${label === '' ? fmtTick(r.value) : label}</text>`)
    } else {
      const x = fmt(sx(r.value))
      out.push(`<line x1="${x}" y1="${String(FRAME.T)}" x2="${x}" y2="${String(FRAME.T + (FRAME.H - FRAME.T - FRAME.B))}" stroke="#AAAAAA" stroke-width="1" stroke-dasharray="5 3"/>`)
      out.push(`<text x="${x}" y="${String(FRAME.T + 12)}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${String(font - 1)}" fill="#888888">${label === '' ? fmtTick(r.value) : label}</text>`)
    }
  }
  return out
}

/** 轴标题（放不下就缩字号，居中在绘图区内——不许被画布裁掉）。 */
function axisLabels(input: RenderInput, recipe: DataFigureRecipe, plotW: number, plotH: number): ReadonlyArray<string> {
  const out: string[] = []
  if (input.y_label !== undefined) {
    const fs = fitFontSize(input.y_label, plotH, recipe.font_size)
    const cy = FRAME.T + plotH / 2
    out.push(`<text x="${fmt(FRAME.T / 2)}" y="${fmt(cy)}" transform="rotate(-90 ${fmt(FRAME.T / 2)} ${fmt(cy)})" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${String(fs)}" fill="${recipe.ink}">${escapeXml(input.y_label)}</text>`)
  }
  if (input.x_label !== undefined) {
    const fs = fitFontSize(input.x_label, plotW, recipe.font_size)
    out.push(`<text x="${fmt(FRAME.L + plotW / 2)}" y="${String(FRAME.H - 10)}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${String(fs)}" fill="${recipe.ink}">${escapeXml(input.x_label)}</text>`)
  }
  return out
}

/**
 * **龙卷风图** —— 灵敏度驱动因子排序（参考决策表对"单参数扫描"的指定图型）。
 *
 * 参考把它列为优秀设计的几个理由，逐条落在这里：
 * - **正负双向条**从零线出发（方向一眼可见，柱状图做不到）；
 * - **按 range 排序**（重要性顺序即图的顺序）；
 * - **按量级调浅**（偏差小的因子画淡，重要性直接看得见，不必读数值）；
 * - **条端数值标注**；
 * - **刻度标签带扫描区间**（`传质系数（+20%~-20%）`——读者知道这个条是在什么扰动下得到的）；
 * - **隔行底纹** + **基准值标注**。
 */
export function renderTornadoSvg(input: RenderInput, recipe: DataFigureRecipe): string {
  const rows = [...(input.tornado ?? [])].sort(
    (a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low),
  )
  if (rows.length === 0) throw new Error('tornado 图需要 input.tornado（每个因子的 low/high）')
  const parts = [...svgOpen()]
  const { W, H, R, T, B } = FRAME
  // **左边距按最长的刻度标签反推**（实测缺陷：写死 L=72 时
  // `干燥阈值（0.175~0.225）` 这种长标签会被缩到字号下限还是放不下，
  // 于是 text-anchor=end 的文本往左跑出画布——因子名整块消失，只剩括号里的区间）。
  // 参考工作流的 tornado 生成器就是给标签留一整列（约占图宽 30%）。
  const labelOf = (r: { label: string; low_label?: string; high_label?: string }): string =>
    r.low_label !== undefined && r.high_label !== undefined
      ? `${r.label}（${r.low_label}~${r.high_label}）` : r.label
  const maxLabelEm = Math.max(...rows.map(r => [...labelOf(r)].reduce((n, ch) => n + (isCjk(ch) ? 1 : 0.6), 0)))
  const L = Math.max(FRAME.L, Math.min(Math.round(maxLabelEm * (recipe.font_size - 1)) + 16, Math.round(W * 0.46)))
  const plotW = W - L - R
  const plotH = H - T - B
  const n = rows.length

  const maxAbs = Math.max(...rows.flatMap(r => [Math.abs(r.low), Math.abs(r.high)]), 1)
  const maxRange = Math.max(...rows.map(r => Math.abs(r.high - r.low)), 1e-12)
  const lim = maxAbs * 1.32
  const sx = (v: number): number => L + ((v + lim) / (2 * lim)) * plotW
  const rowH = plotH / n
  const barH = Math.min(rowH * 0.52, 26)
  const cyOf = (i: number): number => T + rowH * (i + 0.5)

  // 隔行底纹（参考的 tornado 生成器用 axhspan，这里等价）
  for (let i = 0; i < n; i += 2) {
    parts.push(`<rect x="${String(L)}" y="${fmt(T + rowH * i)}" width="${String(plotW)}" height="${fmt(rowH)}" fill="#F7F7F7"/>`)
  }
  const pos = colorOf(recipe, 0)
  const neg = colorOf(recipe, 1)
  for (const [i, r] of rows.entries()) {
    const cy = cyOf(i)
    // 按量级调浅：range 越小越淡
    const lam = 0.48 * (1 - Math.abs(r.high - r.low) / maxRange)
    const cp = lighten(pos, lam)
    const cn = lighten(neg, lam)
    if (r.high > 0) {
      const x0 = sx(0)
      const x1 = sx(r.high)
      parts.push(`<rect x="${fmt(Math.min(x0, x1))}" y="${fmt(cy - barH / 2)}" width="${fmt(Math.abs(x1 - x0))}" height="${fmt(barH)}" fill="${lighten(cp, 0.32)}" stroke="${cp}" stroke-width="1.1"/>`)
      parts.push(`<text x="${fmt(x1 + 5)}" y="${fmt(cy + 4)}" font-family="monospace" font-size="${String(recipe.font_size - 2)}" fill="${cp}">+${fmtTick(r.high)}</text>`)
    }
    if (r.low < 0) {
      const x0 = sx(0)
      const x1 = sx(r.low)
      parts.push(`<rect x="${fmt(Math.min(x0, x1))}" y="${fmt(cy - barH / 2)}" width="${fmt(Math.abs(x1 - x0))}" height="${fmt(barH)}" fill="${lighten(cn, 0.32)}" stroke="${cn}" stroke-width="1.1"/>`)
      parts.push(`<text x="${fmt(x1 - 5)}" y="${fmt(cy + 4)}" text-anchor="end" font-family="monospace" font-size="${String(recipe.font_size - 2)}" fill="${cn}">${fmtTick(r.low)}</text>`)
    }
    // 刻度标签：因子名 + 扫描区间（参考的 tornado 就是这么写的）。
    // 与边距计算**同源**（都走 labelOf）——两处各拼一次迟早分叉。
    const lab = labelOf(r)
    const lfs = fitFontSize(lab, L - 10, recipe.font_size - 1)
    parts.push(`<text x="${String(L - 8)}" y="${fmt(cy + 4)}" text-anchor="end" font-family="${CJK_FONT_STACK}" font-size="${String(lfs)}" fill="${recipe.ink}">${escapeXml(lab)}</text>`)
  }
  // 零线 + 基线标注
  parts.push(`<line x1="${fmt(sx(0))}" y1="${String(T)}" x2="${fmt(sx(0))}" y2="${fmt(T + plotH)}" stroke="${recipe.ink}" stroke-width="0.9"/>`)
  parts.push(`<line x1="${String(L)}" y1="${fmt(T + plotH)}" x2="${String(W - R)}" y2="${fmt(T + plotH)}" stroke="${recipe.ink}" stroke-width="1"/>`)
  if (input.baseline !== undefined) {
    parts.push(`<text x="${fmt(L + 6)}" y="${fmt(T + plotH - 6)}" font-family="${CJK_FONT_STACK}" font-size="${String(recipe.font_size - 2)}" fill="#888888">基准 ${fmtTick(input.baseline)}</text>`)
  }
  // x 轴刻度（取整）
  const sc = niceScale(-lim, lim, 4)
  for (let v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
    const x = sx(v)
    parts.push(`<line x1="${fmt(x)}" y1="${fmt(T + plotH)}" x2="${fmt(x)}" y2="${fmt(T + plotH + 5)}" stroke="${recipe.ink}" stroke-width="1"/>`)
    parts.push(`<text x="${fmt(x)}" y="${fmt(T + plotH + 19)}" text-anchor="middle" font-family="monospace" font-size="${String(recipe.font_size - 1)}" fill="${recipe.ink}">${fmtTick(v)}</text>`)
  }
  parts.push(...refLineParts(input, sx, (v: number) => v, recipe.font_size))
  parts.push(...axisLabels(input, recipe, plotW, plotH))
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}

/**
 * **瀑布图** —— 模块贡献 / 成本构成（参考决策表：消融/贡献 → Waterfall，明确不要 bar chart）。
 *
 * `kind: 'delta'` 画成累积浮柱并连横线（贡献的增量），`kind: 'total'` 画成落地柱（总量）。
 * 横线是瀑布图的灵魂：没有它就看不出"从哪累到哪"。
 */
export function renderWaterfallSvg(input: RenderInput, recipe: DataFigureRecipe): string {
  const steps = input.waterfall ?? []
  if (steps.length === 0) throw new Error('waterfall 图需要 input.waterfall（台阶序列）')
  const parts = [...svgOpen()]
  const { W, L, R, T, B } = FRAME
  const plotW = W - L - R
  const plotH = FRAME.H - T - B

  // 累积轨迹
  const cum: number[] = []
  let acc = 0
  for (const st of steps) {
    if (st.kind === 'total') { cum.push(acc); continue }
    cum.push(acc)
    acc += st.value
  }
  const tops = steps.map((st, i) => st.kind === 'total' ? 0 : cum[i]! + st.value)
  const all = [...cum, ...tops, acc, 0]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const sc = niceScale(lo, hi, 4)
  const yMin = Math.min(sc.lo, 0)
  const yMax = sc.hi
  const sy = (v: number): number => T + plotH * (1 - (v - yMin) / (yMax - yMin || 1))
  const stepW = plotW / steps.length
  const barW = Math.min(stepW * 0.62, 64)

  // 网格 + y 刻度
  for (let v = yMin; v <= yMax + 1e-9; v += sc.step) {
    const y = sy(v)
    parts.push(`<line x1="${String(L)}" y1="${fmt(y)}" x2="${String(W - R)}" y2="${fmt(y)}" stroke="${recipe.grid_color}" stroke-width="1"/>`)
    parts.push(`<text x="${String(L - 8)}" y="${fmt(y + 4)}" text-anchor="end" font-family="monospace" font-size="${String(recipe.font_size - 1)}" fill="${recipe.ink}">${fmtTick(v)}</text>`)
  }
  const up = colorOf(recipe, 0)
  const down = colorOf(recipe, 1)
  const total = colorOf(recipe, 3)
  steps.forEach((st, i) => {
    const cx = L + stepW * (i + 0.5)
    const isTotal = st.kind === 'total'
    const from = isTotal ? 0 : cum[i]!
    const to = isTotal ? st.value : from + st.value
    const c = isTotal ? total : (st.value >= 0 ? up : down)
    const yTop = Math.min(sy(from), sy(to))
    const h = Math.max(1, Math.abs(sy(from) - sy(to)))
    parts.push(`<rect x="${fmt(cx - barW / 2)}" y="${fmt(yTop)}" width="${fmt(barW)}" height="${fmt(h)}" fill="${lighten(c, 0.42)}" stroke="${c}" stroke-width="1.2"/>`)
    parts.push(`<text x="${fmt(cx)}" y="${fmt(yTop - 4)}" text-anchor="middle" font-family="monospace" font-size="${String(recipe.font_size - 2)}" fill="${recipe.ink}">${isTotal ? fmtTick(st.value) : (st.value >= 0 ? `+${fmtTick(st.value)}` : fmtTick(st.value))}</text>`)
    // 连接横线：从本台阶的"到达高度"连到下一台阶起点
    if (i < steps.length - 1) {
      const yTo = sy(isTotal ? st.value : from + st.value)
      parts.push(`<line x1="${fmt(cx + barW / 2)}" y1="${fmt(yTo)}" x2="${fmt(L + stepW * (i + 1.5) - barW / 2)}" y2="${fmt(yTo)}" stroke="#AAAAAA" stroke-width="1" stroke-dasharray="4 3"/>`)
    }
    const lfs = fitFontSize(st.label, stepW - 4, recipe.font_size - 2)
    parts.push(`<text x="${fmt(cx)}" y="${fmt(T + plotH + 16)}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${String(lfs)}" fill="${recipe.ink}">${escapeXml(st.label)}</text>`)
  })
  parts.push(`<line x1="${String(L)}" y1="${fmt(sy(0))}" x2="${String(W - R)}" y2="${fmt(sy(0))}" stroke="${recipe.ink}" stroke-width="1"/>`)
  parts.push(`<line x1="${String(L)}" y1="${String(T)}" x2="${String(L)}" y2="${fmt(T + plotH)}" stroke="${recipe.ink}" stroke-width="1"/>`)
  parts.push(...refLineParts(input, (v: number) => v, sy, recipe.font_size))
  parts.push(...axisLabels(input, recipe, plotW, plotH))
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}

/**
 * **热力图** —— 方法×指标矩阵（参考要求：带格内数值；深底白字、浅底黑字；禁用 jet/RdBu_r）。
 *
 * 色阶由**当前配方**的调色板插值派生（不是另外硬编码一套色板）——这样热力图与
 * 同篇其它图配色统一，正是参考反复强调的"同篇统一"。
 */
export function renderHeatmapSvg(input: RenderInput, recipe: DataFigureRecipe): string {
  const hm = input.heatmap
  if (hm === undefined) throw new Error('heatmap 图需要 input.heatmap（rows/cols/values）')
  const { rows, cols, values } = hm
  if (rows.length === 0 || cols.length === 0) throw new Error('heatmap 的行列不能为空')
  if (values.length !== rows.length || values.some(r => r.length !== cols.length)) {
    throw new Error('heatmap 的 values 矩阵必须与 rows/cols 一一对应')
  }
  const parts = [...svgOpen()]
  const { W, H } = FRAME
  // 行名放**左侧**、色标放**右侧**。原来把行名画在右侧，于是与色标叠在一起
  // （实测：`零配件1检测` 压在色标上）。左侧边距按最长行名反推。
  const maxRowEm = Math.max(...rows.map(r => [...r].reduce((n, ch) => n + (isCjk(ch) ? 1 : 0.6), 0)))
  const L = Math.max(96, Math.min(Math.round(maxRowEm * (recipe.font_size - 1)) + 14, Math.round(W * 0.4)))
  const R = 76
  const T = 28
  const B = 64
  const plotW = W - L - R
  const plotH = H - T - B
  const flat = values.flat()
  const vMin = Math.min(...flat)
  const vMax = Math.max(...flat)
  const hi = colorOf(recipe, 0)
  const cw = plotW / cols.length
  const ch = plotH / rows.length

  for (const [ri, row] of values.entries()) {
    for (const [ci, v] of row.entries()) {
      const t = vMax === vMin ? 0.5 : (v - vMin) / (vMax - vMin)
      const fill = lighten(hi, 1 - t)
      const x = L + cw * ci
      const y = T + ch * ri
      parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(cw)}" height="${fmt(ch)}" fill="${fill}" stroke="#FFFFFF" stroke-width="1"/>`)
      // 格内数值：格子太小时不标（参考对热力图的口径："格子太小就不标数值"）
      if (cw >= 26 && ch >= 16) {
        const fs = Math.max(8, Math.min(recipe.font_size - 2, cw / 4, ch / 2.2))
        parts.push(`<text x="${fmt(x + cw / 2)}" y="${fmt(y + ch / 2 + 4)}" text-anchor="middle" font-family="monospace" font-size="${fmt(fs)}" fill="${readableInkOn(fill)}">${fmtTick(v)}</text>`)
      }
    }
  }
  // 行名（左侧，右对齐贴着网格）
  for (const [ri, row] of rows.entries()) {
    const lfs = fitFontSize(row, L - 10, recipe.font_size - 1)
    parts.push(`<text x="${String(L - 8)}" y="${fmt(T + ch * (ri + 0.5) + 4)}" text-anchor="end" font-family="${CJK_FONT_STACK}" font-size="${String(lfs)}" fill="${recipe.ink}">${escapeXml(row)}</text>`)
  }
  for (const [ci, col] of cols.entries()) {
    const lfs = fitFontSize(col, cw - 4, recipe.font_size - 2)
    parts.push(`<text x="${fmt(L + cw * (ci + 0.5))}" y="${fmt(T + plotH + 16)}" text-anchor="middle" font-family="${CJK_FONT_STACK}" font-size="${String(lfs)}" fill="${recipe.ink}">${escapeXml(col)}</text>`)
  }
  // 色标（参考：热力图必须有 colorbar）
  const cbH = plotH * 0.6
  const cbY = T + (plotH - cbH) / 2
  const cbX = W - 44
  const steps = 24
  for (let i = 0; i < steps; i += 1) {
    const t = 1 - i / (steps - 1)
    parts.push(`<rect x="${fmt(cbX)}" y="${fmt(cbY + (cbH / steps) * i)}" width="10" height="${fmt(cbH / steps + 1)}" fill="${lighten(hi, 1 - t)}"/>`)
  }
  parts.push(`<text x="${fmt(cbX + 5)}" y="${fmt(cbY - 4)}" text-anchor="middle" font-family="monospace" font-size="${String(recipe.font_size - 2)}" fill="${recipe.ink}">${fmtTick(vMax)}</text>`)
  parts.push(`<text x="${fmt(cbX + 5)}" y="${fmt(cbY + cbH + 12)}" text-anchor="middle" font-family="monospace" font-size="${String(recipe.font_size - 2)}" fill="${recipe.ink}">${fmtTick(vMin)}</text>`)
  parts.push(...axisLabels(input, recipe, plotW, plotH))
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}

/**
 * **森林图** —— 点估计 + 置信区间 + 参考线（临床/统计面板的标准形态）。
 *
 * 参考把它列为"方法一致性/区间估计"的指定图型，并要求带一条**虚线参考线**。
 */
export function renderForestSvg(input: RenderInput, recipe: DataFigureRecipe): string {
  const rows = input.forest ?? []
  if (rows.length === 0) throw new Error('forest 图需要 input.forest（每行的 estimate/low/high）')
  const parts = [...svgOpen()]
  const { W, H, L, R, T, B } = FRAME
  const plotW = W - L - R
  const plotH = H - T - B
  const n = rows.length
  const lo = Math.min(...rows.map(r => r.low))
  const hi = Math.max(...rows.map(r => r.high))
  const sc = niceScale(lo, hi, 4)
  const sx = (v: number): number => L + ((v - sc.lo) / (sc.hi - sc.lo || 1)) * plotW
  const rowH = plotH / n
  const c = colorOf(recipe, 0)

  for (let v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
    const x = sx(v)
    parts.push(`<line x1="${fmt(x)}" y1="${String(T)}" x2="${fmt(x)}" y2="${fmt(T + plotH)}" stroke="${recipe.grid_color}" stroke-width="1"/>`)
    parts.push(`<text x="${fmt(x)}" y="${fmt(T + plotH + 16)}" text-anchor="middle" font-family="monospace" font-size="${String(recipe.font_size - 1)}" fill="${recipe.ink}">${fmtTick(v)}</text>`)
  }
  const ref = input.ref_lines?.find(r => r.axis === 'x')
  if (ref !== undefined) {
    parts.push(`<line x1="${fmt(sx(ref.value))}" y1="${String(T)}" x2="${fmt(sx(ref.value))}" y2="${fmt(T + plotH)}" stroke="#AAAAAA" stroke-width="1" stroke-dasharray="5 3"/>`)
  }
  for (const [i, r] of rows.entries()) {
    const cy = T + rowH * (i + 0.5)
    parts.push(`<line x1="${fmt(sx(r.low))}" y1="${fmt(cy)}" x2="${fmt(sx(r.high))}" y2="${fmt(cy)}" stroke="${c}" stroke-width="1.6"/>`)
    parts.push(`<line x1="${fmt(sx(r.low))}" y1="${fmt(cy - 5)}" x2="${fmt(sx(r.low))}" y2="${fmt(cy + 5)}" stroke="${c}" stroke-width="1.6"/>`)
    parts.push(`<line x1="${fmt(sx(r.high))}" y1="${fmt(cy - 5)}" x2="${fmt(sx(r.high))}" y2="${fmt(cy + 5)}" stroke="${c}" stroke-width="1.6"/>`)
    parts.push(`<circle cx="${fmt(sx(r.estimate))}" cy="${fmt(cy)}" r="3.6" fill="${c}"/>`)
    parts.push(`<text x="${fmt(sx(r.high) + 6)}" y="${fmt(cy + 4)}" font-family="monospace" font-size="${String(recipe.font_size - 2)}" fill="${recipe.ink}">${fmtTick(r.estimate)} [${fmtTick(r.low)}, ${fmtTick(r.high)}]</text>`)
    const lfs = fitFontSize(r.label, L - 10, recipe.font_size - 1)
    parts.push(`<text x="${String(L - 8)}" y="${fmt(cy + 4)}" text-anchor="end" font-family="${CJK_FONT_STACK}" font-size="${String(lfs)}" fill="${recipe.ink}">${escapeXml(r.label)}</text>`)
  }
  parts.push(`<line x1="${String(L)}" y1="${String(T)}" x2="${String(L)}" y2="${fmt(T + plotH)}" stroke="${recipe.ink}" stroke-width="1"/>`)
  parts.push(`<line x1="${String(L)}" y1="${fmt(T + plotH)}" x2="${String(W - R)}" y2="${fmt(T + plotH)}" stroke="${recipe.ink}" stroke-width="1"/>`)
  parts.push(...axisLabels(input, recipe, plotW, plotH))
  parts.push('</svg>')
  return parts.join('\n') + '\n'
}
