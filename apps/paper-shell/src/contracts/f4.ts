/**
 * F4 评价决策 contract (DPH 核验表 Part B — F4).
 *
 * 候选模型集封闭:权重端(熵权/AHP/CRITIC/层次)× 聚合端(TOPSIS/灰色
 * 关联/模糊综合/加权和)。模型只能从这组里选,零发明空间。
 * 专项验证(不含通用 V1–V7):权重敏感性(扰动权重 → 排序变化幅度)、
 * 排序稳健性(排序对权重扰动的容忍)、逆序检验(增删备选 → 原相对序
 * 是否保持)。
 */

import type { ContractFinding, FamilyContract } from './types.ts'

/** F4 closed candidate models: weight-method × aggregation-method. */
export const F4_WEIGHT_METHODS = ['entropy', 'AHP', 'CRITIC', 'delphi'] as const
export const F4_AGGREGATE_METHODS = ['TOPSIS', 'gray-relational', 'fuzzy-comprehensive', 'weighted-sum'] as const

/** F4 required assumptions — every F4 run must declare all of these. */
export const F4_ASSUMPTIONS = [
  '指标方向(正向/负向已归一)',
  '权重来源(主观/客观/混合)',
] as const

/**
 * F4 dedicated validations. Pure & deterministic over the input.
 * `input.weights` = { method, vector: number[] }
 * `input.sensitivity` = [{ delta, max_rank_shift }]
 * `input.reversal` = { alternatives_removed, relative_order_preserved }
 */
export const F4_CONTRACT: FamilyContract = {
  family: 'F4',
  name: '评价决策',
  applies_when: '题面含多准则评价/排序/方案比较/打分/层次',
  candidate_models: [...F4_WEIGHT_METHODS, ...F4_AGGREGATE_METHODS],
  required_assumptions: [...F4_ASSUMPTIONS],
  validate: (input) => {
    const findings: ContractFinding[] = []
    const weightMethod = String(input.weight_method ?? '')
    const aggregate = String(input.aggregate_method ?? '')
    // 权重敏感性: 扰动权重后排序位移的最大值 ≤ 1 为稳健
    const sens = Array.isArray(input.sensitivity_trials)
      ? (input.sensitivity_trials as Array<{ delta: number; max_rank_shift: number }>)
      : []
    const maxShift = sens.length > 0 ? Math.max(...sens.map(s => Number(s.max_rank_shift) || 0)) : NaN
    const ranking = Array.isArray(input.ranking) && (input.ranking as ReadonlyArray<unknown>).length > 0
    const reversal = (input.reversal_check ?? {}) as { alternatives_removed?: number; relative_order_preserved?: boolean }
    findings.push({
      rule: '权重方法封闭',
      ok: F4_WEIGHT_METHODS.includes(weightMethod as (typeof F4_WEIGHT_METHODS)[number]),
      detail: weightMethod === '' ? '未声明权重方法' : `${weightMethod}${F4_WEIGHT_METHODS.includes(weightMethod as (typeof F4_WEIGHT_METHODS)[number]) ? '' : ' 不在 F4 权重候选集内'}`,
    })
    findings.push({
      rule: '聚合方法封闭',
      ok: F4_AGGREGATE_METHODS.includes(aggregate as (typeof F4_AGGREGATE_METHODS)[number]),
      detail: aggregate === '' ? '未声明聚合方法' : `${aggregate}${F4_AGGREGATE_METHODS.includes(aggregate as (typeof F4_AGGREGATE_METHODS)[number]) ? '' : ' 不在 F4 聚合候选集内'}`,
    })
    findings.push({
      rule: '权重敏感性(专项)',
      ok: sens.length > 0 && maxShift <= 1,
      detail: sens.length === 0 ? '缺权重敏感性试验' : `最大排序位移 ${maxShift}${maxShift <= 1 ? '' : ' ≥1 → 对权重扰动敏感'}`,
    })
    findings.push({
      rule: '排序存在且稳健',
      ok: ranking,
      detail: ranking ? `排序 ${(input.ranking as ReadonlyArray<unknown>).length} 个备选` : '缺最终排序',
    })
    findings.push({
      rule: '逆序检验(专项)',
      ok: reversal.alternatives_removed === 0 || reversal.relative_order_preserved === true,
      detail: reversal.alternatives_removed === 0
        ? '未做增删备选试验(记录为未覆盖)'
        : (reversal.relative_order_preserved === true ? '增删备选后原相对序保持' : '增删备选后原相对序改变 → 逆序!!'),
    })
    return findings
  },
  figure_types: ['权重柱状', '雷达图', 'TOPSIS 散点/排序图'],
  not_applicable: ['含回归/检验的统计问题(→F3)', '连续机理(→F1)', '离散优化(→F2)'],
  cost_hours: 16,
}
