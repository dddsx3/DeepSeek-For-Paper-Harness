/**
 * W9（用户实测反馈）— 类别轴标签的**防挤压规划器**。
 *
 * 事故：54 个地块名（A1…E16）画在 580px 绘图区里，横排标签全部重叠成一坨。
 * 参考实现的做法（matplotlib `rotation=45, ha='right'` + 必要时抽稀）照搬为
 * **纯函数**：不测量、不猜测，从标签字符宽度估算 + 确定性抽稀步长推导。
 *
 * 字宽估算：CJK 字符（U+2E80 以上）≈ 1.0 × fontSize（全角）；
 * 其他（拉丁/数字/符号）≈ 0.62 × fontSize。
 *
 * 抽稀纪律（确定性，禁随机）：step = ceil(标签宽 / 槽位宽)（旋转后），
 * 只画下标 i % step === 0 的标签——首标签必画，采样均匀，同输入必同输出。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/figure/axis-labels
 */

/** One label's planned render geometry. */
export interface PlannedLabel {
  readonly index: number
  readonly label: string
  readonly rotate: boolean
}

/** The plan for one categorical axis. */
export interface CategoricalLabelPlan {
  readonly labels: ReadonlyArray<PlannedLabel>
  readonly rotate: boolean
  /** 1 = every label; >1 = the deterministic thinning step. */
  readonly step: number
}

/** Estimate the rendered pixel width of one label. */
export function estimateLabelPx(label: string, fontSize: number): number {
  let px = 0
  for (const ch of label) {
    const cp = ch.codePointAt(0)
    px += cp !== undefined && cp >= 0x2e80 ? fontSize : fontSize * 0.62
  }
  return px
}

/**
 * Plan the categorical axis labels.
 *
 * @param labels - every category label, in axis order.
 * @param slotPx - pixels available per category (plotWidth / count).
 * @param fontSize - the tick font size.
 */
export function planCategoricalLabels(
  labels: ReadonlyArray<string>,
  slotPx: number,
  fontSize: number,
): CategoricalLabelPlan {
  if (labels.length === 0) return { labels: [], rotate: false, step: 1 }
  const maxPx = Math.max(...labels.map(l => estimateLabelPx(l, fontSize)))
  // 横排放得下 → 全部横排
  if (maxPx <= slotPx * 0.92) {
    return { labels: labels.map((label, index) => ({ index, label, rotate: false })), rotate: false, step: 1 }
  }
  // 旋转 45°：水平投影 = 宽 × cos45，再加字号的下坠空间
  const rotatedFootprint = maxPx * 0.707 + fontSize * 0.9
  const step = Math.max(1, Math.ceil((rotatedFootprint * labels.length) / (slotPx * labels.length)))
  const plan: PlannedLabel[] = []
  labels.forEach((label, index) => {
    if (index % step === 0) plan.push({ index, label, rotate: true })
  })
  return { labels: plan, rotate: true, step }
}
