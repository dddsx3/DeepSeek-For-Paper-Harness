/**
 * F3 数据驱动/统计 contract (DPH 核验表 Part B — F3).
 *
 * 常见方法（**参考，不是白名单**——方法选择不受约束）:回归族 / ARIMA / 灰色 GM(1,1) / 树模型 / 聚类 /
 * 检验族。模型只能从这组里选,零发明空间。
 * 专项验证(不含通用 V1–V7):残差存在性、R²/拟合指标存在、过拟合告警
 * (参数≤样本 10% 或提供交叉验证)、数据源引用存在。
 */

import type { ContractFinding, FamilyContract } from './types.ts'

/** F3 closed candidate models. */
export const F3_MODELS = [
  'linear-regression',
  'polynomial-regression',
  'logistic-regression',
  'ARIMA',
  'gray-GM(1,1)',
  'regression-tree',
  'random-forest',
  'k-means',
  'hierarchical-clustering',
  't-test',
  'chi-square-test',
  'ANOVA',
] as const

/** F3 required assumptions — every F3 run must declare all of these. */
export const F3_ASSUMPTIONS = [
  '样本独立性',
  '误差分布假设(正态性或明确替代)',
] as const

export const F3_CONTRACT: FamilyContract = {
  family: 'F3',
  name: '数据驱动/统计',
  applies_when: '题面含回归/时间序列/分类/聚类/假设检验/数据表',
  candidate_models: [...F3_MODELS],
  required_assumptions: [...F3_ASSUMPTIONS],
  validate: (input) => {
    const findings: ContractFinding[] = []
    const model = String(input.model ?? '')
    const residuals = Array.isArray(input.residuals) ? (input.residuals as ReadonlyArray<unknown>) : []
    const hasResidual = residuals.length > 0
    const hasFit = typeof input.fit_metric === 'number' && Number.isFinite(input.fit_metric)
    const sampleN = typeof input.sample_n === 'number' ? input.sample_n : 0
    const paramK = typeof input.param_count === 'number' ? input.param_count : 0
    const hasCV = input.cross_validation === true
    findings.push({
      // 规则名从「候选模型封闭」改为「选型已登记」：验证的对象不再是"你有没有从
      // 白名单里挑"，而是"你有没有把挑的方法登记进决策记录"。
      // 闭集语义在上限解放架构 L2 里被移除（见 contracts/index.ts 的 contractBanner）。
      // `ok` 的判据也相应放宽：**任何**非空模型名都算"已登记"——它是不是这一族的
      // 常见方法，只影响 detail 里的一句提示，不影响通过与否。
      rule: '选型已登记',
      ok: model !== '',
      detail: model === ''
        ? '未声明模型'
        : `模型 ${model} 已登记${F3_MODELS.includes(model as (typeof F3_MODELS)[number]) ? '' : '（不在本族常见方法内——这是允许的，理由应在决策记录里）'}`,
    })
    findings.push({
      rule: '残差存在',
      ok: hasResidual,
      detail: hasResidual ? `残差 ${residuals.length} 点` : '缺失残差序列',
    })
    findings.push({
      rule: '拟合指标',
      ok: hasFit,
      detail: hasFit ? `R²/拟合 ${input.fit_metric}` : '缺失拟合指标',
    })
    findings.push({
      rule: '过拟合告警',
      ok: paramK === 0 || paramK <= sampleN * 0.1 || hasCV,
      detail: `参数 ${paramK} / 样本 ${sampleN}${hasCV ? '+交叉验证' : ''}`,
    })
    findings.push({
      rule: '数据源引用',
      ok: String(input.data_ref ?? '') !== '',
      detail: String(input.data_ref ?? '') === '' ? '缺数据源引用' : `源 ${input.data_ref}`,
    })
    return findings
  },
  figure_types: ['时序曲线', '散点+拟合', '残差图', '分类/聚类散点'],
  not_applicable: ['含物理机理的连续模型(→F1)', '含离散决策变量(→F2)', '多准则评价(→F4)'],
  cost_hours: 24,
}
