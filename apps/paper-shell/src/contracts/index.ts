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

/** Render ONE contract card into the taskText (the W5 banner the model
 *  sees before it models: closed candidates + required assumptions +
 *  dedicated validation rules). */
export function contractBanner(family: string): string {
  const contract = CONTRACTS[family]
  if (contract === undefined) return ''
  const lines: string[] = []
  lines.push(`## 方法族契约 ${family}(${contract.name})`)
  lines.push('')
  lines.push(`- 适用判定:${contract.applies_when}`)
  lines.push(`- 候选模型集(封闭,只能从中选择,禁止自创):${contract.candidate_models.join(' / ')}`)
  lines.push(`- 必需假设:${contract.required_assumptions.join('、')}`)
  lines.push(`- 专项验证:${contract.validate({}).map(f => f.rule).join('、')}`)
  lines.push(`- 已知不适用:${contract.not_applicable.join(';')}`)
  lines.push('')
  return lines.join('\n')
}
