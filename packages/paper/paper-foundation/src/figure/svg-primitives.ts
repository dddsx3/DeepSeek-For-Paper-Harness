/**
 * SVG 渲染的**最小共用原语** —— 供 `renderer.ts`（原有四种图型）与
 * `chart-types.ts`（按参考决策表补入的图型）共用。
 *
 * 为什么抽出来：这几个函数原来只存在于 `renderer.ts` 里。新增图型若各自再写一份
 * `fmt`/`escapeXml`，迟早分叉——而分叉的后果是"同一个数在两种图里印成两种样子"。
 * 只放**无状态、无依赖**的东西；任何涉及布局或数据解析的逻辑都留在各自模块里。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure/svg-primitives
 */

/**
 * 承载**中文**的字体栈 —— 必须点名，不能写裸 `sans-serif`。
 *
 * 为什么这是硬要求而不是风格偏好：图最终要经 `cairosvg` 栅格化进 docx/PDF，
 * 而 `sans-serif` 在 cairosvg 的解析下会落到一个**不含中日韩字形**的默认字体上，
 * 于是每一个中文标签都渲染成豆腐块（`□□□□`）。浏览器里看不出问题
 * （浏览器会把 `sans-serif` 解析到系统中文字体），**只有栅格化那条路上才暴露**——
 * 也就是说，坏掉的正好是交付物。
 *
 * 内层名字用**单引号**：整个 font-family 值被双引号包着，里面再放双引号会写出畸形 SVG。
 */
export const CJK_FONT_STACK = "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"

/** 数字印在 SVG 里的统一写法（整数不带小数点，小数最多 6 位）。 */
export function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
}

/** 刻度标签：紧凑、确定性、不出现意外指数。 */
export function fmtTick(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return v.toExponential(1)
  if (Number.isInteger(v)) return String(v)
  return String(Math.round(v * 1000) / 1000)
}

/** XML 文本转义（标签内容与属性值都走它）。 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 是否含中日韩字形（决定用哪个字体栈、以及按几个 em 估宽）。 */
export function isCjk(ch: string): boolean {
  return /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(ch)
}

/**
 * 把字号缩到"这段文字在可用长度内放得下"（**有下限，不许缩成看不见**）。
 *
 * 中文按 1.0 em/字、拉丁数字按 0.6 em/字估算宽度——只用于**防裁切**，不追求排版精确。
 *
 * **下限是 9 而不是 8**：参考工作流同时要求"防裁切"与"最终字号 ≥9pt"，
 * 而这两条会打架——缩到 8 就违反了字号下限（实测：门禁 `figure_style_rules`
 * 报了 `font-size 8 < 9`）。两条都是硬要求时，**字号下限优先**，放不下要靠
 * **给它更多版面**解决（tornado / heatmap 的边距都是按最长标签反推的），
 * 而不是把字缩小到看不清。
 */
export function fitFontSize(text: string, available: number, want: number): number {
  const em = [...text].reduce((n, ch) => n + (isCjk(ch) ? 1.0 : 0.6), 0)
  if (em <= 0) return want
  return Math.max(9, Math.min(want, Math.round((available / em) * 10) / 10))
}

/**
 * 取"好看的"刻度（1/2/5 × 10^k）。
 *
 * 参考工作流明确要求刻度取在整数上（把关键阈值/上限/范围端点塞进刻度）；
 * 实测旧图纵轴是 `22.33 / 19.295 / 16.26` 这种非整数，读起来很业余。
 *
 * @param lo - 数据下界（已含留白）。
 * @param hi - 数据上界（已含留白）。
 * @param count - 期望的刻度段数。
 * @returns 取整后的下界、上界与步长（自洽：lo + n*step === hi）。
 */
export function niceScale(lo: number, hi: number, count: number): { lo: number; hi: number; step: number } {
  if (!(hi > lo) || count <= 0) return { lo, hi, step: hi - lo }
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const step = nice * mag
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step }
}

/** `#rrggbb` → `[r, g, b]`（解析失败返回 null，由调用方决定回退）。 */
export function hexToRgb(hex: string): readonly [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (m === null) return null
  const n = Number.parseInt(m[1] ?? '', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * 把颜色按比例调浅（`amount` 0 = 原色，1 = 纯白）——参考工作流的 `_lighten`。
 *
 * 用途是"按量级分深浅"：龙卷风图里偏差小的因子画淡、大的画深，
 * 于是**重要性直接看得见**，不必去读数值。这是参考配图里最关键的一招之一。
 */
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (rgb === null) return hex
  const k = Math.max(0, Math.min(1, amount))
  const mix = (c: number): number => Math.round(c + (255 - c) * k)
  return `#${[mix(rgb[0]), mix(rgb[1]), mix(rgb[2])].map(c => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 单元格明暗自适应文字色：深底用白字、浅底用黑字。
 *
 * 参考工作流的原话是热力图必须这样（"white on dark cells, black on light cells"），
 * 亮度公式也是它给的（`lum = 0.299r + 0.587g + 0.114b`，`<0.5` 用白字）。
 * 不这么做的话，深色格子里印黑字等于没印。
 */
export function readableInkOn(hex: string): string {
  const rgb = hexToRgb(hex)
  if (rgb === null) return '#222222'
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
  return lum < 0.5 ? '#FFFFFF' : '#222222'
}
