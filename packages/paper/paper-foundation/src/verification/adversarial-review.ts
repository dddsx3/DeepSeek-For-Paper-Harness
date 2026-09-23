/**
 * L5 — 对抗评审（三个独立 persona）。
 *
 * ## 为什么是三个 persona 而不是一个"总评审"
 *
 * 一个评审者只能给出一种视角，而论文的失败模式至少有三类，且**互不覆盖**：
 *
 *   - 推导错了、假设不合理、量纲不一致 —— 数学问题；
 *   - 模型没真回答题目所问、参数不现实、结论不可用 —— 应用问题；
 *   - 章节缺要素、图表与正文矛盾、摘要没有信息量 —— 呈现问题。
 *
 * 一个"总评审"会系统性地偏向其中一类（通常是它最容易判的那类），另外两类
 * 静默漏过。三个 persona **各自独立上下文**，是让三类都有人负责的最简结构。
 *
 * ## 盲评（防共谋）
 *
 * 每个 persona **只看产物 + 评分细则，不看模型的自我声明**。理由：实测中
 * 出现过"复核 AI 与答题同源，读同一份输入，若上游读错则共犯同一错误"的形态。
 * 把自我声明从评审输入里摘掉，是这条链上唯一能做的隔离。
 *
 * ## 与 L6 的接口
 *
 * 本模块只**产出 findings**，不决定交付。findings 进闭环（`closure.ts`），
 * 由它决定修还是接受。这是"检出"与"归宿"分离的设计。
 *
 * ## 误报优先于漏报（precision over recall）
 *
 * 公开的验证器研究一致指出：LLM judge 会被自信行文诱导出很高的假阳率。
 * 而一个塞满误报的 findings 队列会**淹掉闭环**——没人愿意消费它。
 * 因此本模块的取向是：**宁可少报，不可误报**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/verification/adversarial-review
 */

import { adjudicateAdversarialReview, type AdversarialVerdict } from './v5-adversarial.ts'
import { makeFinding, type Finding, type ClosureSeverity } from '../delivery/finding.ts'

/** 三个评审视角。 */
export const REVIEW_PERSONAS = ['mathematical-rigor', 'application-relevance', 'presentation'] as const
export type ReviewPersona = (typeof REVIEW_PERSONAS)[number]

/**
 * persona 的**短码**——用于给并行评审产出的缺陷 id 加前缀。
 *
 * 三个视角在同一条链上并行评审，各自从 `D1` 开始编号；不加前缀会让
 * "数学视角的 D1" 与 "呈现视角的 D1" 撞成同一条，ledger 于是只能记住一个，
 * 另一个静默消失。前缀是**缺陷不丢失**的机械保证。
 */
export const PERSONA_SHORT: Readonly<Record<ReviewPersona, string>> = {
  'mathematical-rigor': 'math',
  'application-relevance': 'app',
  presentation: 'pres',
}

/** persona 的展示名与审查焦点（写进 prompt，也写进报告）。 */
export const PERSONA_SPEC: Readonly<Record<ReviewPersona, { readonly name: string; readonly focus: string }>> = {
  'mathematical-rigor': {
    name: '数学严格性',
    focus: '推导是否成立、假设是否合理、边界条件是否交代、量纲是否一致、数值方法是否稳定（显式格式的稳定限！）、结论是否被自己的方程支持',
  },
  'application-relevance': {
    name: '应用相关性',
    focus: '模型是否真的回答了题目所问、参数取值是否现实、结论是否可被决策者使用、是否遗漏了题面明确要求的输出',
  },
  presentation: {
    name: '写作与呈现',
    focus: '章节要素是否齐备、图表与正文数值是否一致、摘要是否携带信息（每问的模型与结论）、格式是否规范、是否存在机器写作的机械模式',
  },
}

/** 一条评审产出（未消解的原始形态）。 */
export interface RawReviewFinding {
  readonly finding_id: string
  readonly persona: ReviewPersona
  readonly severity: ClosureSeverity
  /** 攻击的 IR 目标（可悬空 —— 悬空即丢弃）。 */
  readonly target_ref?: string
  readonly evidence_refs?: ReadonlyArray<string>
  /** 论文里被质疑的那句话（必须能在交付文本里找到，否则视为伪造）。 */
  readonly span: string
  readonly reason: string
  /** 建议修法。 */
  readonly fix_hint?: string
}

/** 一次三 persona 评审的汇总。 */
export interface AdversarialReviewOutcome {
  readonly verdicts: Readonly<Record<ReviewPersona, AdversarialVerdict>>
  /** 通过裁决的 findings（已转成闭环契约形态）。 */
  readonly findings: ReadonlyArray<Finding>
  /** 被丢弃的（悬空引用 / 伪造 span）——**丢弃不等于没发生**，进审计轨迹。 */
  readonly discarded: ReadonlyArray<{ readonly id: string; readonly reason: string }>
  /** 是否所有 persona 都真的攻击了（有 persona 零发现 = 该视角缺席）。 */
  readonly complete: boolean
}

/**
 * 裁决一次三 persona 评审。
 *
 * 三个视角各自独立裁决：某 persona 的 findings 引用悬空或 span 伪造，只影响它
 * 自己，不牵连别的视角。
 *
 * @param input - 原始 findings、交付文本、引用解析器。
 */
export function adjudicateThreePersonaReview(input: {
  readonly findings: ReadonlyArray<RawReviewFinding>
  readonly paperText: string
  readonly refResolves: (ref: string) => boolean
}): AdversarialReviewOutcome {
  const verdicts = {} as Record<ReviewPersona, AdversarialVerdict>
  const findings: Finding[] = []
  const discarded: Array<{ id: string; reason: string }> = []
  let complete = true

  for (const persona of REVIEW_PERSONAS) {
    const mine = input.findings.filter(f => f.persona === persona)
    const verdict = adjudicateAdversarialReview({
      // exactOptionalPropertyTypes: 可选字段必须**缺席**而不是显式 undefined——
      // 显式 undefined 会让 v5 的"引用悬空即丢弃"把正常条目也判掉。
      findings: mine.map(f => ({
        finding_id: f.finding_id,
        ...(f.target_ref === undefined ? {} : { target_ref: f.target_ref }),
        ...(f.evidence_refs === undefined ? {} : { evidence_refs: f.evidence_refs }),
        reason: f.span,
        severity: f.severity,
        attack_type: persona,
      })),
      paperText: input.paperText,
      refResolves: input.refResolves,
    })
    verdicts[persona] = verdict
    if (!verdict.valid) complete = false
    for (const d of verdict.findings_discarded) discarded.push(d)

    // 只有通过裁决的条目才转成闭环 finding。
    const discardedIds = new Set(verdict.findings_discarded.map(d => d.id))
    for (const f of mine) {
      if (discardedIds.has(f.finding_id)) continue
      findings.push(
        makeFinding({
          category: `review:${persona}`,
          severity: f.severity,
          checker: `adversarial-review:${persona}`,
          files: ['paper/main.md'],
          // 评审类 finding 落在正文——分派表会把它交给写作技能，允许直接编辑。
          artifactScope: ['paper/'],
          evidence: `${PERSONA_SPEC[persona].name}｜span「${f.span}」｜${f.reason}`,
          fingerprint: `review:${persona}:${f.span}`,
          fixHint: f.fix_hint ?? '按该视角的审查焦点修正；若判定为误报，走消解（驳回并附证据）。',
        }),
      )
    }
  }

  return { verdicts, findings, discarded, complete }
}

/**
 * 渲染对抗评审报告——进交付物附录，让读者看到"这篇论文被三个视角攻击过，
 * 结果是什么"。
 *
 * @param outcome - 评审汇总。
 */
export function renderAdversarialReport(outcome: AdversarialReviewOutcome): string {
  const lines: string[] = []
  lines.push('')
  lines.push('## 附录：对抗评审记录（三视角盲评）')
  lines.push('')
  lines.push('| 视角 | 审查焦点 | 提出 | 有效 | 丢弃 | 结论 |')
  lines.push('|---|---|---|---|---|---|')
  for (const persona of REVIEW_PERSONAS) {
    const v = outcome.verdicts[persona]
    const spec = PERSONA_SPEC[persona]
    lines.push(
      `| ${spec.name} | ${spec.focus.replace(/\|/g, '\\|')} | ${String(v.findings_total)} | ${String(v.findings_valid)} | ${String(v.findings_discarded.length)} | ${v.valid ? '✅ 有效' : '⚠️ 无效（零发现或引用悬空）'} |`,
    )
  }
  lines.push('')
  if (!outcome.complete) {
    lines.push('> ⚠️ **有视角未提出有效发现**：该视角的审查缺席，不能读作"该维度无问题"。')
    lines.push('')
  }
  if (outcome.discarded.length > 0) {
    lines.push('被丢弃的条目（引用悬空或 span 在交付文本中不存在 —— 幻觉攻击不算发现）：')
    for (const d of outcome.discarded) lines.push(`- \`${d.id}\`：${d.reason}`)
    lines.push('')
  }
  lines.push('*三个 persona 各自独立上下文，且只看产物与评分细则，不看模型的自我声明（防共谋）。*')
  return lines.join('\n')
}
