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

  it('a model OUTSIDE the closed set is refused (零发明空间)', () => {
    const findings = F3_CONTRACT.validate({
      model: 'my-custom-neural-net',
      residuals: [1],
      fit_metric: 0.9,
      sample_n: 100,
      param_count: 2,
      data_ref: 'DA-RAW',
    })
    const modelFinding = findings.find(f => f.rule === '候选模型封闭')
    expect(modelFinding?.ok).toBe(false)
    expect(modelFinding?.detail).toContain('不在 F3 候选集内')
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

  it('contractBanner renders the closed candidate set + required assumptions', () => {
    const banner = contractBanner('F3')
    expect(banner).toContain('F3(数据驱动/统计)')
    expect(banner).toContain('候选模型集(封闭')
    expect(banner).toContain('linear-regression')
    expect(banner).toContain('必需假设')
    expect(banner).toContain('专项验证')
  })

  it('contractBanner for an unregistered family is empty', () => {
    expect(contractBanner('F9')).toBe('')
  })
})
