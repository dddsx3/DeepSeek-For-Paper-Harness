/**
 * V6 — model-choice interpretability (DPH-PRD-v2 §6.4, W7).
 *
 * 数模评审本身就是"模型比较"得分点,所以选择必须可解释:
 *   - >= MIN_CANDIDATES candidate models considered;
 *   - a chosen model with an explicit 选型理由;
 *   - the rejected candidates with a 放弃理由 each.
 *
 * Pure structural check over a declaration object (the contract layer
 * supplies the closed candidate set; a paper carries the choice).
 */

export const MIN_CANDIDATES = 2

export interface ModelChoiceInput {
  readonly family: string
  /** Closed candidate set considered (from the family contract). */
  readonly candidates: ReadonlyArray<string>
  readonly chosen: string
  readonly choice_reason: string
  readonly rejected: ReadonlyArray<{ model: string; reason: string }>
}

export interface V6Finding {
  readonly rule: string
  readonly ok: boolean
  readonly detail: string
}

export function modelChoiceCheck(input: ModelChoiceInput): ReadonlyArray<V6Finding> {
  const findings: V6Finding[] = []
  const candOk = input.candidates.length >= MIN_CANDIDATES
  findings.push({
    rule: 'V6 候选集≥2',
    ok: candOk,
    detail: candOk ? `${input.candidates.length} 个候选模型(${input.candidates.join('/')})` : `候选仅 ${input.candidates.length} 个(<${MIN_CANDIDATES})`,
  })
  const chosenInSet = input.candidates.includes(input.chosen)
  findings.push({
    rule: 'V6 选中在候选内',
    ok: chosenInSet,
    detail: chosenInSet ? `选中 ${input.chosen} 在候选集内` : `选中 ${input.chosen} 不在候选集内 — 自创模型`,
  })
  findings.push({
    rule: 'V6 选型理由',
    ok: input.choice_reason.trim().length >= 8,
    detail: input.choice_reason.trim().length >= 8 ? '选型理由已声明' : '缺选型理由(或过短)',
  })
  const rejectedCovered = input.rejected.length >= input.candidates.length - 1
  const rejectedAllHaveReason = input.rejected.every(r => r.reason.trim().length >= 4)
  findings.push({
    rule: 'V6 放弃理由',
    ok: rejectedCovered && rejectedAllHaveReason,
    detail: rejectedCovered && rejectedAllHaveReason
      ? `已放弃 ${input.rejected.length} 个候选并给出理由`
      : `放弃候选 ${input.rejected.length}/${input.candidates.length - 1}，或有候选缺放弃理由`,
  })
  return findings
}
