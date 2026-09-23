/**
 * W5 — method-family contract tests.
 *
 * For each shipped contract (F3, F4) verify:
 *   - a model inside the closed candidate set passes the dedicated rules;
 *   - a model OUTSIDE the set is refused (零发明空间);
 *   - a missing dedicated input (residuals / sensitivity / reversal) is
 *     refused;
 *   - the contract registry maps family -> card and the banner renders.
 */

import { describe, expect, it } from 'vitest'
import { F3_CONTRACT } from '../src/contracts/f3.ts'
import { F4_CONTRACT } from '../src/contracts/f4.ts'
import { CONTRACTED_FAMILIES, contractBanner, getContract } from '../src/contracts/index.ts'

describe('F3 数据驱动/统计 contract', () => {
  it('an in-candidate regression model with residuals + fit + CV passes', () => {
    const findings = F3_CONTRACT.validate({
      model: 'linear-regression',
      residuals: [0.1, -0.2, 0.05],
      fit_metric: 0.92,
      sample_n: 120,
      param_count: 3,
      cross_validation: true,
      data_ref: 'DA-RAW',
    })
    expect(findings.every(f => f.ok)).toBe(true)
  })

  it('一个**不在常见方法内**的模型被**接受**，只在 detail 里提示（方法选择自由）', () => {
    // 契约反转（上限解放架构 L2）：原文是"a model OUTSIDE the closed set is
    // refused (零发明空间)"——模型的选型自由被拿走了，而"选了什么方法"正是建模
    // 论文质量差距的大头。现在验证的对象是"你有没有登记选型"，不是"你有没有从
    // 白名单里挑"。
    const findings = F3_CONTRACT.validate({
      model: 'my-custom-neural-net',
      residuals: [1],
      fit_metric: 0.9,
      sample_n: 100,
      param_count: 2,
      data_ref: 'DA-RAW',
    })
    const modelFinding = findings.find(f => f.rule === '选型已登记')
    expect(modelFinding?.ok).toBe(true)
    expect(modelFinding?.detail).toContain('已登记')
    expect(modelFinding?.detail).toContain('这是允许的')
  })

  it('未声明模型仍然不通过（"自由"不等于"可以不说"）', () => {
    const findings = F3_CONTRACT.validate({
      model: '',
      residuals: [1],
      fit_metric: 0.9,
      sample_n: 100,
      param_count: 2,
      data_ref: 'DA-RAW',
    })
    expect(findings.find(f => f.rule === '选型已登记')?.ok).toBe(false)
  })

  it('a missing residual sequence is refused', () => {
    const findings = F3_CONTRACT.validate({
      model: 'linear-regression',
      fit_metric: 0.9,
      sample_n: 100,
      param_count: 2,
      data_ref: 'DA-RAW',
    })
    expect(findings.find(f => f.rule === '残差存在')?.ok).toBe(false)
  })

  it('overfitting alert fires when params >> 10% of sample and no CV', () => {
    const findings = F3_CONTRACT.validate({
      model: 'polynomial-regression',
      residuals: [0.1],
      fit_metric: 0.99,
      sample_n: 20,
      param_count: 15,
      data_ref: 'DA-RAW',
    })
    expect(findings.find(f => f.rule === '过拟合告警')?.ok).toBe(false)
  })
})

describe('F4 评价决策 contract', () => {
  it('an in-candidate entropy×TOPSIS with sensitivity + reversal passes', () => {
    const findings = F4_CONTRACT.validate({
      weight_method: 'entropy',
      aggregate_method: 'TOPSIS',
      sensitivity_trials: [{ delta: 0.1, max_rank_shift: 0 }],
      ranking: ['A', 'B', 'C'],
      reversal_check: { alternatives_removed: 1, relative_order_preserved: true },
    })
    expect(findings.every(f => f.ok)).toBe(true)
  })

  it('an out-of-candidate weight method is refused', () => {
    const findings = F4_CONTRACT.validate({
      weight_method: 'my-own-magic-weights',
      aggregate_method: 'TOPSIS',
      sensitivity_trials: [{ delta: 0.1, max_rank_shift: 0 }],
      ranking: ['A'],
      reversal_check: { alternatives_removed: 0 },
    })
    expect(findings.find(f => f.rule === '权重方法封闭')?.ok).toBe(false)
  })

  it('missing sensitivity trials is refused (专项)', () => {
    const findings = F4_CONTRACT.validate({
      weight_method: 'entropy',
      aggregate_method: 'TOPSIS',
      ranking: ['A'],
      reversal_check: { alternatives_removed: 0 },
    })
    expect(findings.find(f => f.rule === '权重敏感性(专项)')?.ok).toBe(false)
  })

  it('a reversal that breaks relative order is refused (逆序检验)', () => {
    const findings = F4_CONTRACT.validate({
      weight_method: 'entropy',
      aggregate_method: 'TOPSIS',
      sensitivity_trials: [{ delta: 0.1, max_rank_shift: 0 }],
      ranking: ['A', 'B'],
      reversal_check: { alternatives_removed: 1, relative_order_preserved: false },
    })
    expect(findings.find(f => f.rule === '逆序检验(专项)')?.ok).toBe(false)
  })
})

describe('contract registry', () => {
  it('W5 ships exactly F3 + F4', () => {
    expect(CONTRACTED_FAMILIES).toEqual(['F3', 'F4'])
  })

  it('getContract maps family -> card', () => {
    expect(getContract('F3')).toBe(F3_CONTRACT)
    expect(getContract('F4')).toBe(F4_CONTRACT)
    expect(getContract('F1')).toBeUndefined()
  })

  it('contractBanner 是**软先验**，不是闭集契约（上限解放架构 L2）', () => {
    const banner = contractBanner('F3')
    expect(banner).toContain('F3（数据驱动/统计）')
    // 候选方法仍然列出来（有用的先验）……
    expect(banner).toContain('linear-regression')
    expect(banner).toContain('常见的假设')
    expect(banner).toContain('常见的验证点')
    // ……但**必须明说这不是白名单**。
    // 事故：原文写"候选模型集(封闭,只能从中选择,禁止自创)"，一次真实运行里模型
    // 逐字照抄并在那 8 个方法里挑——而"方法选择自由"正是本架构要解开的封顶。
    expect(banner).toContain('不是白名单')
    expect(banner).toContain('不对方法选择施加约束')
    expect(banner, '闭集措辞回流了').not.toContain('禁止自创')
    expect(banner).not.toContain('封闭')
  })

  it('contractBanner for an unregistered family is empty', () => {
    expect(contractBanner('F9')).toBe('')
  })
})
