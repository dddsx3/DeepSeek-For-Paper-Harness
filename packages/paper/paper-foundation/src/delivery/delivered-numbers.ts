/**
 * W11.5 baseline-18 — the delivered paper's numbers must still close over the IR.
 *
 * 审计 A-2（守卫"拒了但没拦住"）的根因：D4 守卫在**渲染时**跑（摘要/结论槽），
 * 之后 review/revise 轮会**重写正文**——改稿从不重新核对数字。于是被拒的内容可以
 * 以改稿的形式回到稿子里，带着没有任何守卫看过的数字。第十七次基线的评审台账
 * 三处点名了这件事（"摘要被 D4 守卫拒绝，但正文仍包含被拒绝的摘要内容，且该内容
 * 引用了 Result 中的数字"）。
 *
 * 本模块把那条守卫挪到**交付文本**上：摘要与结论两节里的每个数字串都必须是
 * 某个 Result 的值/不确定度，或是题面自己给出的数字（harness 注册的输入数据）。
 * 纯函数、零外部依赖，因此可以放进评审台账——机械缺陷与评审员的缺陷同一条账，
 * 改稿轮必须处理它们。
 *
 * 边界（如实声明）：只查**摘要与结论**两节。正文散章里的数字不做闭环要求——
 * 那里的量在符号说明与推导里出现，硬查会大量误报（形如"第 3 步"、"16 种组合"），
 * 而这两节是论文对外声明的结论面。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/delivered-numbers
 */

import { numericLiterals } from '../produce/report-renderer.ts'

export interface DeliveredNumberFinding {
  /** Stable id so the review ledger can carry it across rounds (E4a). */
  readonly id: string
  readonly severity: 'critical'
  readonly description: string
}

/** Section headings whose numbers must close over the IR. */
const GUARDED_SECTIONS = ['摘要', '结论'] as const

/**
 * Every digit-run that is a NUMBER, using the renderer's own extractor.
 *
 * Single-sourced on purpose: that one already knows the two shapes that look
 * like numbers and are not — an identifier (`D4`, `R-N1`, `A1-BINOMIAL`) and an
 * ordinal label (`问题 1`, `情形(2)`). A second, cruder extractor here would
 * have flagged the harness's own 校核声明 ("…回读结果 JSON（D4）") as a foreign
 * number — which is exactly what it did before this import.
 */
function digitRunsOf(text: string): ReadonlyArray<string> {
  return numericLiterals(text)
}

/** The body of one `## <heading>` section, or null when the heading is absent. */
function sectionBody(text: string, heading: string): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex(line => new RegExp(`^#{1,6}\\s*${heading}\\s*$`).test(line.trim()))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^#{1,6}\s+/.test(line.trim()))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * Numbers in the guarded sections that are not IR-traceable.
 *
 * @param text - the DELIVERED text (post-revision, not the render-time draft).
 * @param allowed - Result values/uncertainties plus the registered problem's own
 *        numbers (problem-given constants are input data, not claims).
 */
export function deliveredNumberFindings(
  text: string,
  allowed: ReadonlyArray<string>,
): ReadonlyArray<DeliveredNumberFinding> {
  const allowedSet = new Set(allowed)
  const findings: DeliveredNumberFinding[] = []
  for (const heading of GUARDED_SECTIONS) {
    const body = sectionBody(text, heading)
    if (body === null) continue
    // The result table carries Result ids and values by construction; its
    // numbers are the IR's own, so it is not a place to look for strays.
    const withoutTable = body.split('\n').filter(line => !line.trim().startsWith('|')).join('\n')
    const foreign = [...new Set(digitRunsOf(withoutTable).filter(run => !allowedSet.has(run)))]
    if (foreign.length === 0) continue
    findings.push({
      id: `MECH-NUM-${heading}`,
      severity: 'critical',
      description: `「${heading}」里有不属于任何 Result/题面数字的数字：${foreign.map(f => `'${f}'`).join('、')}——`
        + '交付稿的结论面只能陈述运行算出来的数字（或题面给定的常数）。'
        + '把该数字改成绑定 Result 的写法（`{<result_id>}` 由 harness 注入），或让它由代码算出并作为 Result 声明。',
    })
  }
  return findings
}

/**
 * Arithmetic self-contradiction in the delivered text (the W11.5-A3 scan),
 * surfaced in the same shape so it can join the review ledger.
 *
 * The check is zero-false-positive by construction (a correct draft never
 * contradicts itself), which is why it is safe to make it a review defect on
 * EVERY delivery path rather than an annotation on one.
 */
export function arithmeticFindingsOf(
  findings: ReadonlyArray<{ readonly expression: string; readonly stated: number; readonly computed: number; readonly reason: string }>,
): ReadonlyArray<DeliveredNumberFinding> {
  return findings.map((f, i) => ({
    id: `MECH-ARITH-${i + 1}`,
    severity: 'critical' as const,
    description: f.reason,
  }))
}
