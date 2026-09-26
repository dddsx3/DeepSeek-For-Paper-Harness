/**
 * W9-D1 — the print-quality gate for figure SVGs (参考实现 M3 的机械落点).
 *
 * 参考实现把"作图很难看"拆成了可检查项（印刷字号/边界/对比度）。本模块对
 * 交付链产出的 SVG 做同样的机械检查：
 *   - **字号**：所有 text 元素的 font-size ≥ 阈值（缩放后不可读 = 违规）
 *   - **边界**：所有可见元素在 viewBox 内（越界 = 违规）
 *   - **对比度**：文本 fill 与其最近白/深背景的对比度 ≥ WCAG AA (4.5:1)
 *
 * 判定是**对 SVG 字节本身**（不重跑渲染），因此它既是构建期检查，也是
 * 交付前的最后一道门。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure/quality-check
 */

/** One violation found in the SVG. */
export interface QualityViolation {
  readonly kind: 'font_size' | 'out_of_bounds' | 'contrast'
  readonly detail: string
  /** The offending element's text content or attribute (for locating). */
  readonly evidence: string
}

const MIN_FONT_PX = 9
const MIN_CONTRAST = 4.5

/** Luminance (WCAG relative luminance, sRGB). */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (m === null || m[1] === undefined) return 1 // unparsable → treat as white
  const raw = m[1]
  const rgb = [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16) / 255)
  const lin = rgb.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const [r = 0, g = 0, b = 0] = lin
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Run the print-quality gate over one figure's SVG bytes.
 *
 * @param svg - the SVG bytes.
 * @returns every violation (empty = pass); the caller decides pass/fail.
 */
export function checkFigureQuality(svg: string): ReadonlyArray<QualityViolation> {
  const violations: QualityViolation[] = []

  // --- font sizes (text elements) ---
  for (const m of svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
    const size = Number(m[1])
    const text = m[2] ?? ''
    if (size < MIN_FONT_PX) {
      violations.push({
        kind: 'font_size',
        detail: `font-size ${size} < ${MIN_FONT_PX}`,
        evidence: text.slice(0, 40),
      })
    }
  }

  // --- bounds: shapes/text must stay inside the viewBox ---
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)
  if (vb !== null) {
    const w = Number(vb[1])
    const h = Number(vb[2])
    for (const m of svg.matchAll(/<rect[^>]*x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      const x = Number(m[1])
      const y = Number(m[2])
      const rw = Number(m[3])
      const rh = Number(m[4])
      if (x < -0.5 || y < -0.5 || x + rw > w + 0.5 || y + rh > h + 0.5) {
        violations.push({
          kind: 'out_of_bounds',
          detail: `rect (${x},${y} ${rw}×${rh}) exceeds viewBox ${w}×${h}`,
          evidence: 'rect',
        })
      }
    }
    for (const m of svg.matchAll(/<circle[^>]*cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
      const cx = Number(m[1])
      const cy = Number(m[2])
      const r = Number(m[3])
      if (cx - r < -0.5 || cy - r < -0.5 || cx + r > w + 0.5 || cy + r > h + 0.5) {
        violations.push({
          kind: 'out_of_bounds',
          detail: `circle (${cx},${cy} r=${r}) exceeds viewBox ${w}×${h}`,
          evidence: 'circle',
        })
      }
    }
  }

  // --- contrast: text fill vs the white background (figures have white bg) ---
  //
  // **例外：自带底色自适应的文字**（`data-bg-adaptive="1"`）。热力图的格内数值
  // 是参考明确要求的"深底白字、浅底黑字"（亮度公式 `0.299r+0.587g+0.114b`，
  // `<0.5` 用白字），它的**有效背景是那个格子**，不是白底。拿白底去量它，
  // 白字必然判成"对比度 1.00"——那是**检查的假设错了**，不是图错了。
  // 豁免是显式标记而不是"看到热力图就跳过"：标记由渲染器打在那些文字上，
  // 别处（真正的白底文字）照旧受检。
  for (const m of svg.matchAll(/<text[^>]*fill="([^"]+)"[^>]*>([^<]*)<\/text>/g)) {
    const tag = m[0]
    if (tag.includes('data-bg-adaptive="1"')) continue
    const fill = m[1] ?? ''
    const text = m[2] ?? ''
    if (text.trim().length === 0) continue
    const c = contrast(fill, '#FFFFFF')
    if (c < MIN_CONTRAST) {
      violations.push({
        kind: 'contrast',
        detail: `contrast ${c.toFixed(2)} < ${MIN_CONTRAST} (fill ${fill} on white)`,
        evidence: text.slice(0, 40),
      })
    }
  }

  return violations
}

/**
 * W9-D2 — the audit view must not leak into the deliverable. `data_hash` /
 * sha256 溯源信息属于审计轨迹，不是论文正文。
 *
 * @param deliverableText - the rendered report/deliverable markdown.
 * @returns the offending matches (empty = pass).
 */
export function checkNoAuditLeak(deliverableText: string): ReadonlyArray<string> {
  const offenders: string[] = []
  for (const m of deliverableText.matchAll(/data_hash|storageKey|content_hash/g)) {
    offenders.push(m[0])
  }
  return offenders
}
