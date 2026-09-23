/**
 * Method-family contract registry (W5). The single place a family id maps
 * to its contract card. A family without a registered contract cannot be
 * served — the routing layer refuses it (W4). zero invention space for
 * the model; the contract card owns the closed candidate set.
 */

import type { FamilyContract } from './types.ts'
import { F3_CONTRACT } from './f3.ts'
import { F4_CONTRACT } from './f4.ts'

const CONTRACTS: Readonly<Record<string, FamilyContract>> = {
  F3: F3_CONTRACT,
  F4: F4_CONTRACT,
}

/** The ids with a live contract (W5 ships F3+F4; F1/F2 land later). */
export const CONTRACTED_FAMILIES: ReadonlyArray<string> = Object.keys(CONTRACTS)

export function getContract(family: string): FamilyContract | undefined {
  return CONTRACTS[family]
}

/**
 * 把一个族的先验渲染进 taskText。
 *
 * ## 它从"闭集契约"改成了"软先验"（上限解放架构 L2）
 *
 * 原文写的是 `候选模型集(封闭,只能从中选择,禁止自创)`。一次真实运行（2024B ×
 * strict）里，模型**逐字照抄**了这句话的后果：
 *
 * > 根据题型路由，本题适用方法族 **F4（评价决策）**，候选模型集为 entropy / AHP /
 * > CRITIC / delphi / TOPSIS / gray-relational / fuzzy-comprehensive / weighted-sum
 *
 * 它随后就在这 8 个方法里挑——**而这正是本架构要解开的那个封顶**：建模论文的质量
 * 差距大半在"选了什么方法"，闭集契约把选择权从模型手里拿走了。
 *
 * 现在它只说"这题看起来像哪一族、这一族常见什么"，并**明确写清这不是白名单**。
 * 方法族的适用条件与陷阱在 `skills/modeling-playbook.md`（探索/择优步内联）。
 *
 * ## 保留什么
 *
 * - **族的判定**：有用的先验（省掉模型重新发现"这是评价决策题"的功夫）；
 * - **常见假设与验证点**：作为**建议**——该声明什么、该验证什么仍由模型决定，
 *   只要它声明并给出理由。
 *
 * @param family - 路由判定的族。
 */
export function contractBanner(family: string): string {
  const contract = CONTRACTS[family]
  if (contract === undefined) return ''
  const lines: string[] = []
  lines.push(`## 题型先验 ${family}（${contract.name}）—— 参考，不是约束`)
  lines.push('')
  lines.push(`- 这题看起来像这一族，因为：${contract.applies_when}`)
  lines.push(`- 这一族常见的方法：${contract.candidate_models.join(' / ')}`)
  lines.push('- **这不是白名单。** 你可以用上面任何一个，也可以用一个这里没列出的方法——本 harness 不对方法选择施加约束。选型的依据是你对题目的判断，理由写进方案决策记录。')
  lines.push(`- 这一族常见的假设：${contract.required_assumptions.join('、')}（可增可减——只要在假设表里声明并给出理由）`)
  lines.push(`- 这一族常见的验证点：${contract.validate({}).map(f => f.rule).join('、')}`)
  lines.push(`- 已知不适用的场景：${contract.not_applicable.join('；')}`)
  lines.push('')
  return lines.join(String.fromCharCode(10))
}
