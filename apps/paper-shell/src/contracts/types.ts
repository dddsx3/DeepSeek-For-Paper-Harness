/**
 * Method-family contracts (DPH-PRD-v2 P0-8, W5; 核验表 Part B).
 *
 * A family contract is the closed set of what the ENGINE must provide for
 * that family — the model gets ZERO invention space (候选模型集封闭):
 * the model may only pick a model from the enumerated candidates, declare
 * the required assumptions, and pass the family's dedicated validation.
 *
 * This module holds the contract CARDS as data + the family-specific
 * VALIDATION RULES as executable pure functions. The generic V1–V7
 * verification layer is W6–W7; these are the family-specific rules that
 * generic checks must NOT duplicate (核验表 Part B item 3: 专项验证规则,
 * 不含通用 7 项).
 *
 * Two contracts ship in W5 (each must run 1 visible problem):
 *   F3 数据驱动/统计   — regression/time-series/classification
 *   F4 评价决策        — multi-criteria evaluation/ranking
 */

/** A family-specific validation finding. */
export interface ContractFinding {
  readonly rule: string
  readonly ok: boolean
  readonly detail: string
}

/** The closed candidate-model set + required assumptions + dedicated
 *  validation for one family. */
export interface FamilyContract {
  readonly family: string
  readonly name: string
  readonly applies_when: string
  /** 候选模型集 — closed; the model may only pick from this list. */
  readonly candidate_models: ReadonlyArray<string>
  /** 必需假设集 — every run must declare all of these. */
  readonly required_assumptions: ReadonlyArray<string>
  /** 专项验证规则 — family-specific checks, NOT the generic V1–V7. */
  readonly validate: (input: Record<string, unknown>) => ReadonlyArray<ContractFinding>
  /** 标准图表集 — figures this family's paper should carry. */
  readonly figure_types: ReadonlyArray<string>
  /** 已知不适用 — sub-cases this contract cannot cover (→ 缺口日志). */
  readonly not_applicable: ReadonlyArray<string>
  /** 边际成本估算(人时) */
  readonly cost_hours: number
}
