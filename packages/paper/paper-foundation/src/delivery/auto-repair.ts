/**
 * L6-e — 自动返修（只做**确定性**的那一层）。
 *
 * ## 为什么只做格式层
 *
 * 实测规律很明确：**格式层的"检测 → 修复 → 复检"是能跑通的**（含数值门槛），
 * 而建模层的 findings 全部没跑通。差别不在"有没有设计"，在**成本不对称**：
 * 格式层的修是"确定性、单次、局部"的；建模层的修是"要重跑代码、重出图、
 * 重写章节、跨多个产物"的。
 *
 * 因此本模块**只做便宜那层**，并且做得干净：每一项自动修复都必须通过 N30
 * 不变量（自动修复不得改语义）。昂贵那层交给闭环层如实披露或交人工，
 * 而不是假装修过。
 *
 * ## 判据
 *
 * `repair()` 返回的新指纹**必须由重跑同一 checker 得到**，不是由修复函数自称。
 * 这是 C1 在自动修复路径上的落点：修复函数只提供候选文本，判定权在 checker。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/auto-repair
 */

import { applySafeFormatFixes, n30Holds, stripFormat } from './format-fix.ts'
import type { Finding } from './finding.ts'

/** 自动修复能处理的类别（**白名单**，不是黑名单）。 */
export const AUTO_REPAIRABLE_CATEGORIES: ReadonlySet<string> = new Set([
  'prose_contract',
  'blank_area',
  'format',
])

/** 一次自动修复尝试的结果。 */
export interface AutoRepairAttempt {
  /** 是否产出了候选修复文本。 */
  readonly produced: boolean
  /** 候选文本（`produced === false` 时为原文）。 */
  readonly text: string
  /** N30 不变量是否成立（自动修复不得改语义）。 */
  readonly semanticsPreserved: boolean
  /** 人读说明——**修复函数不自称成功**，它只说"产出了候选"。 */
  readonly detail: string
}

/**
 * 尝试自动修复一条 finding。
 *
 * **它不是"修好了"的判定**：判定由调用方重跑 checker 后比对指纹得出。
 * 本函数只做两件事：产出候选文本，并验证 N30 不变量。
 *
 * @param finding - 目标 finding（按 `category` 决定是否可自动修复）。
 * @param text - 当前正文。
 */
export function attemptAutoRepair(finding: Finding, text: string): AutoRepairAttempt {
  if (!AUTO_REPAIRABLE_CATEGORIES.has(finding.category)) {
    return {
      produced: false,
      text,
      semanticsPreserved: true,
      detail: `类别 ${finding.category} 不在自动修复白名单内——它需要重跑产出物，不是文本编辑（见分派表）`,
    }
  }
  const candidate = applySafeFormatFixes(text)
  if (candidate === text) {
    return {
      produced: false,
      text,
      semanticsPreserved: true,
      detail: '格式修复未产生任何改动——该 finding 的成因不在可安全修复的形态里',
    }
  }
  const preserved = n30Holds(candidate)
  if (!preserved) {
    // N30 不变量被破坏：拒绝这次修复。**不做"尽力而为"的修复**——
    // 一个改坏了语义的自动修复比不修危险得多。
    return {
      produced: false,
      text,
      semanticsPreserved: false,
      detail: 'N30 不变量不成立（自动修复改变了语义）——本次修复被拒绝，保留原文',
    }
  }
  return {
    produced: true,
    text: candidate,
    semanticsPreserved: true,
    detail: `产出候选修复文本（${String(stripFormat(text).length)} → ${String(stripFormat(candidate).length)} 字符，N30 成立）；是否算修复由重跑 checker 的指纹比对决定`,
  }
}
