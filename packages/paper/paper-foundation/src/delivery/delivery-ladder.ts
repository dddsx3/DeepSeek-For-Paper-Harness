/**
 * L6-d — 失败语义四档阶梯（替代布尔式的 BLOCKED）。
 *
 * ## 为什么不是布尔
 *
 * 旧形态只有"过"与"零产物"两档：`gradeInput.length === 0 ? 'CLEAN' : 'BLOCKED'`，
 * 且注释明写 "never MARKED"。于是产线的输出分布是**双峰**的——要么一份核验通过的
 * 论文，要么什么都没有，**没有"平庸但可用"这一档**。而中间档恰恰是优质论文
 * 实际诞生的地方：一条从未产出过"合格稿"的产线，没有资格谈优质稿。
 *
 * ## 四档
 *
 * | 档位 | 触发 | 交付物形态 | 用户动作 |
 * |---|---|---|---|
 * | `CLEAN` | findings 空 | 完整包 | 直接交 |
 * | `MARKED` | findings 非空但**全部已消解/接受** | 完整包 + 已知缺陷附录 | 看一眼附录 |
 * | `DEGRADED` | 主路径失败，兜底路径产出 | 结构完整 + 注明"未经规范核验" | 需人工补 |
 * | `ESCALATE` | 兜底也不适用 / 闭环预算耗尽 | **未完成包**：中间物 + 缺口清单 + 建议动作 | 人工接管 |
 *
 * **唯一真正的硬拒绝**：连"未完成包"都产不出（例如题面解析就失败，或正文为空）。
 * **唯一保留的 finding 级硬阻断**：`fabricated` 引用（编造参考文献）——在期刊
 * 场景下它直接构成学术不端，值得硬阻断。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/delivery-ladder
 */

import type { ClosureReport } from './closure.ts'
import { renderEscalationPackage } from './closure.ts'
import type { DeliveryGrade } from './delivery-grade.ts'
import { renderDeliveryAppendix, type FatalConditions, type GradeAnnotation } from './delivery-grade.ts'
import { renderKnownDefectsTable, type Finding } from './finding.ts'

/** 四档交付语义。 */
export const DELIVERY_TIERS = ['CLEAN', 'MARKED', 'DEGRADED', 'ESCALATE'] as const
export type DeliveryTier = (typeof DELIVERY_TIERS)[number]

/** 产线实际走过的路径（决定是不是 DEGRADED）。 */
export type DeliveryPath = 'A-produce-chain' | 'A-normalized-no-code' | 'B-e1-direct'

/** 阶梯判定的输入。 */
export interface LadderInput {
  /** 内层判定（`gradeDelivery` 的三档结论）。 */
  readonly grade: DeliveryGrade
  readonly annotations: ReadonlyArray<GradeAnnotation>
  readonly fatal: FatalConditions
  /** 闭环报告；无闭环层时传 null（按"无 finding"处理）。 */
  readonly closure: ClosureReport | null
  readonly deliveryPath: DeliveryPath
  /**
   * 本次交付**没有任何可执行证据**（未挂载规范 IR，或一个 Result 都没铸出来）。
   *
   * 它与 `referenceCatastrophe` 是两件事，必须分开：
   *   - 没有证据 → 这是一份**草稿**，结构可能完整但没有规范核验 → `DEGRADED`；
   *   - 有引用但引用悬空 → 论文**声称**有数字支撑而实际上没有 → 拒绝。
   * 把前者也判成拒绝，会让"兜底直通"这条路径永远交不出东西，F1（下限不为零）
   * 就不成立——而兜底路径的存在理由恰恰是"总得交出点东西"。
   */
  readonly unverified: boolean
  /** 全部 finding（用于渲染已知缺陷表）。 */
  readonly findings: ReadonlyArray<Finding>
}

/** 阶梯判定的输出。 */
export interface LadderDecision {
  readonly tier: DeliveryTier
  /** 是否连"未完成包"都产不出（唯一的硬拒绝）。 */
  readonly hardRefused: boolean
  /** 硬拒绝的原因（仅 `hardRefused` 时非空）。 */
  readonly refusalReason: string | null
  /** 要附加到交付物的附录文本（可能为空串）。 */
  readonly appendix: string
  /** 给用户的一句话结论——**不能把"有未修缺陷"显示成"通过"**。 */
  readonly headline: string
}

/**
 * 编造引用是唯一保留的 finding 级硬阻断。
 *
 * 理由（ADR-4）：编造参考文献在期刊场景下构成学术不端，值得硬阻断；而
 * `unverifiable`（不可达）可能只是网络问题，只标注、不阻断。
 */
export const FABRICATED_REFERENCE_CATEGORY = 'fabricated_reference'

/**
 * 判定交付档位。
 *
 * @param input - 见 {@link LadderInput}。
 */
export function gradeLadder(input: LadderInput): LadderDecision {
  // ── 唯一的硬拒绝：连未完成包都产不出 ────────────────────────────────
  if (input.fatal.emptyContent) {
    return {
      tier: 'ESCALATE',
      hardRefused: true,
      refusalReason: 'fatal content probe：正文内容为空——连"未完成包"都无法产出（题面解析或产出阶段就失败了）',
      appendix: '',
      headline: '未产出：正文为空，无法交付任何形态的成果',
    }
  }

  // ── 致命条件 3：正文数字没有任何可回溯的证据支撑 ──────────────────
  // 这条对应旧代码里被**写死为 false** 的两个 fatal 之一（D4：文档承诺的三个
  // 致命条件实际只有"空内容"可达）。零数字通道是本项目的存在理由——一篇数字
  // 无处可回溯的稿子不是"有缺陷的论文"，是**没有证据的散文**，交付它等于把
  // 项目的核心保证让掉。
  //
  // 措辞沿用仓库既有词汇（`cannot deliver: <kind>:<reason>`），因此这条拒绝
  // 在日志与测试里与历史形态同形，不引入第二套说法。
  if (input.fatal.referenceCatastrophe) {
    const reasons = input.annotations.map(a => `${a.kind}:${a.reason}`).join('; ')
    return {
      tier: 'ESCALATE',
      hardRefused: true,
      refusalReason: `cannot deliver: reference catastrophe — 正文数字没有任何可回溯的证据支撑（${reasons === '' ? '无具体门禁原因' : reasons}）`,
      appendix: '',
      headline: '拒绝交付：正文数字无可回溯证据',
    }
  }

  // ── 唯一保留的 finding 级硬阻断：编造引用 ──────────────────────────
  const fabricated = input.findings.filter(f => f.category === FABRICATED_REFERENCE_CATEGORY)
  if (fabricated.length > 0) {
    return {
      tier: 'ESCALATE',
      hardRefused: true,
      refusalReason: `检出 ${String(fabricated.length)} 条无法核验且疑似编造的参考文献——编造引用构成学术不端，不予交付`,
      appendix: renderEscalationPackage({
        outcome: 'ESCALATE',
        findings: input.findings,
        rechecks: [],
        roundsUsed: 0,
        unresolved: fabricated,
        gapList: fabricated.map(f => `编造引用 @ ${f.where.files.join('、')} — ${f.evidence}`),
      }),
      headline: `拒绝交付：${String(fabricated.length)} 条疑似编造的参考文献`,
    }
  }

  // ── 闭环未收口 → ESCALATE（C2：预算耗尽**不是** CLEAN） ─────────────
  if (input.closure !== null && input.closure.outcome === 'ESCALATE') {
    const pkg = renderEscalationPackage(input.closure)
    const withKnown = input.findings.length > 0 ? `${pkg}${renderKnownDefectsTable(input.findings)}` : pkg
    return {
      tier: 'ESCALATE',
      hardRefused: false,
      refusalReason: null,
      appendix: withKnown,
      headline: `未完成包：${String(input.closure.unresolved.length)} 项 finding 在 ${String(input.closure.roundsUsed)} 轮预算内未消解`,
    }
  }

  // ── 无规范核验（兜底路径 / 无证据） → DEGRADED ─────────────────────
  if (input.deliveryPath === 'B-e1-direct' || input.unverified) {
    return {
      tier: 'DEGRADED',
      hardRefused: false,
      refusalReason: null,
      appendix: `${renderDeliveryAppendix('MARKED', input.annotations)}${renderKnownDefectsTable(input.findings)}`,
      headline: input.deliveryPath === 'B-e1-direct'
        ? '结构完整但**未经规范核验**（走了兜底路径：自由分析直通交付）——需人工补核'
        : '结构完整但**未经规范核验**（本次交付没有任何可执行证据：未挂载规范 IR 或未铸出 Result）——需人工补核',
    }
  }

  // ── 有 finding（全部已消解）→ MARKED ───────────────────────────────
  if (input.findings.length > 0) {
    return {
      tier: 'MARKED',
      hardRefused: false,
      refusalReason: null,
      appendix: `${renderDeliveryAppendix('MARKED', input.annotations)}${renderKnownDefectsTable(input.findings)}`,
      headline: `交付（标注）：${String(input.findings.length)} 项已检出的问题，全部有归宿（见附录已知缺陷表）`,
    }
  }

  // ── 内层判定不是 CLEAN 但仍交付（例如仅剩非致命标注） → MARKED ──────
  if (input.grade !== 'CLEAN' || input.annotations.length > 0) {
    return {
      tier: 'MARKED',
      hardRefused: false,
      refusalReason: null,
      appendix: renderDeliveryAppendix('MARKED', input.annotations),
      headline: `交付（标注）：${String(input.annotations.length)} 项未通过检查（见附录）`,
    }
  }

  return {
    tier: 'CLEAN',
    hardRefused: false,
    refusalReason: null,
    appendix: '',
    headline: '交付：全部检查通过，无已知缺陷',
  }
}

/** 档位的中文标签，用于报告与日志。 */
export const TIER_LABEL: Readonly<Record<DeliveryTier, string>> = {
  CLEAN: 'CLEAN（干净交付）',
  MARKED: 'MARKED（标注交付）',
  DEGRADED: 'DEGRADED（降级交付，未规范核验）',
  ESCALATE: 'ESCALATE（未完成包，需人工接管）',
}

/**
 * 交付物顶部的一句话状态。
 *
 * **它必须如实**：一份带未消解缺陷的交付物，头部不能显示"通过"。实测依据：
 * 一次真实交付以 `PASS_WITH_FIXES` 出包，用户看到的是"通过"，而不是
 * "还有 2 个 major 未修"。
 *
 * @param decision - 阶梯判定。
 * @param findingCount - 被检出问题总数。
 */
export function renderTierBanner(decision: LadderDecision, findingCount: number): string {
  const unresolved = decision.tier === 'ESCALATE' ? '未消解项见缺口清单' : '无未消解项'
  return [
    `【交付状态：${TIER_LABEL[decision.tier]}】`,
    `本次运行共检出 ${String(findingCount)} 项问题；${unresolved}。`,
    decision.headline.replace(/\*\*/g, ''),
  ].join('\n')
}
