/**
 * 数字出生证明审计 —— 红队实测失败模式的**回归测试**。
 *
 * 红队对 2024B 阶段 2 的独立复算结论：模型层（方法/公式）达参照物水平，
 * 但**求解层不及格**——6 处结果数字错 3 处，全部源于"在没有代码执行的环境下心算"。
 * 本文件把那次的失败形状固化成夹具：门禁必须抓住它们，且**不得**误伤
 * 题面给定值、声明常数、章节编号、参考文献年份。
 */

import { describe, expect, it } from 'vitest'
import { auditNumbers, buildAllowlist, verificationClaims } from '../../src/stages/number-audit.ts'

/** 题面给定值（2024B 表 1/表 2 的真值，带原文锚点的形态）。 */
const FACTS = JSON.stringify({
  facts: [
    { name: '标称值', value: '10%', raw_quote: '如果标称值为10%' },
    { name: '信度', value: '95%', raw_quote: '在95%的信度下' },
    { name: '信度', value: '90%', raw_quote: '在90%的信度下' },
  ],
  table1: { rows: [['1', '10%', '4', '2', '10%', '18', '3', '10%', '6', '3', '56', '6', '5']] },
  table2: { rows: [['1', '10%', '2', '1', '1', '10%', '8', '4', '6']] },
})

/** 模型自己声明的常数（Q4 的先验、Q1 的置信水平等）。 */
const DECLARATION = JSON.stringify({
  entries: [
    { kind: 'EquationSpec', value: { equation_id: 'EQ-01', expression: 'pi = 0.9 * 0.9' } },
    { kind: 'AssumptionSpec', value: { assumption_id: 'ASM-12', statement: '先验取 Beta(12, 100)' } },
  ],
})

const allowed = buildAllowlist([FACTS, DECLARATION, null])

describe('数字出生证明 —— 红队点名的错数字必须被抓', () => {
  it('阶段 2 手写的期望利润（6 处错 3 处）全部判为"无出生证明"', () => {
    // 红队复算表：报告值与真值（真值不在报告里，所以只应抓到报告值）
    const report = [
      '### 6.4 算例结果',
      '| 情况 | 最优策略 | 期望利润 |',
      '| 1 | (0,0,0,1) | 21.68 |',
      '| 2 | (1,0,0,1) | 13.81 |',
      '| 3 | (0,0,1,1) | 19.80 |',
      '| 4 | (1,0,1,1) | 12.50 |',
      '| 5 | (0,0,0,1) | 20.19 |',
      '| 6 | (1,0,1,1) | 12.50 |',
    ].join('\n')
    const audit = auditNumbers(report, allowed)
    const uniq = new Set(audit.violations.map(v => v.literal))
    for (const bad of ['21.68', '13.81', '19.80', '12.50', '20.19']) {
      expect(uniq.has(bad), `${bad} 是心算结果，必须判为无出生证明`).toBe(true)
    }
  })

  it('阶段 2 的 Q1 样本量（n=110/c=17、n=106/c=15）被抓', () => {
    const report = '情形 (1)：n=110，c=17；情形 (2)：n=106，c=15，接收概率 0.944。'
    const audit = auditNumbers(report, allowed)
    const uniq = new Set(audit.violations.map(v => v.literal))
    expect(uniq.has('110')).toBe(true)
    expect(uniq.has('106')).toBe(true)
    expect(uniq.has('0.944')).toBe(true) // 接收概率是算出来的
    // c=17 是小整数（≤30）→ 已知假阴性，如实断言这个边界
    expect(uniq.has('17')).toBe(false)
  })

  it('**不得误伤**题面给定值与声明常数（零误报面是门禁可信的前提）', () => {
    const legit = [
      '标称值 10%，在 95% 与 90% 的信度下分别给出方案（表 1 情况 1-6）。',
      '市场售价 56 元、调换损失 6 元、拆解费用 5 元、购买单价 18 元、检测成本 2 元。',
      '先验取 Beta(12, 100)，故 alpha = 0.10、beta = 0.90。',
      '第 4.2 节与 5.3 节给出推导；见参考文献 [1] Wald A. Sequential Analysis. Wiley. 1947.',
      '零配件 1-3 装配成半成品 1（见 `ASM-12`、`EQ-01`）。',
    ].join('\n')
    const audit = auditNumbers(legit, allowed)
    expect(audit.violations, `误报：${audit.violations.map(v => v.literal).join('、')}`).toEqual([])
  })

  it('阶段 9 的论文里，**账本里的结果**是合法的（出生证明由真跑代码给出）', () => {
    const withLedger = buildAllowlist([FACTS, DECLARATION, JSON.stringify({
      results: [{ result_id: 'R-Q2-case5-profit', value: 16.94 }, { result_id: 'R-Q3-profit', value: 66.09 }],
    })])
    const paper = '情况 5 的最优期望利润为 16.94 元/件，问题 3 为 66.09 元/件。'
    expect(auditNumbers(paper, withLedger).violations).toEqual([])
    // 但同一个数在没有账本的阶段（阶段 2/3）仍然是无出生证明的
    expect(auditNumbers(paper, allowed).violations.length).toBeGreaterThan(0)
  })
})

describe('"已执行检验"的假声明 —— 阶段 2 不可能跑过任何检验', () => {
  it('红队点名的 §9 完成时声明被抓', () => {
    const section = '1. **分项恒等式检验。** 表 1 的六种情况与问题 3 的算例全部通过（容差 1e-6）。'
    const claims = verificationClaims(section)
    expect(claims.length).toBeGreaterThan(0)
    expect(claims[0]?.context).toContain('全部通过')
  })

  it('写成"待执行"的方案**不**被抓（这是正确写法）', () => {
    const planned = [
      '### 9 模型检验方案（待执行）',
      '1. **分项恒等式检验**：将对 6 种情况逐一核验分项之和与更新方程相等（容差 1e-6）。',
      '2. **网格无关性**：将比较不同离散粒度的解。',
      '3. **灵敏度分析**：将扫描关键参数。',
    ].join('\n')
    expect(verificationClaims(planned)).toEqual([])
  })

  it('"已验证/已校核"式声明被抓', () => {
    expect(verificationClaims('该结论已经验证，与解析解一致。').length).toBeGreaterThan(0)
    expect(verificationClaims('复算结果为 12.50。').length).toBeGreaterThan(0)
  })
})
