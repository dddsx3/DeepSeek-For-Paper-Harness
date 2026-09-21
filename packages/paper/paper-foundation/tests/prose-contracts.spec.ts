/**
 * W11.5 round-4 — 要素级写作契约（审计 §3.2 的验收）。
 *
 * baseline-23 的实证：207 字的问题分析、185 字的模型评价、1 篇参考文献、利润=0 且
 * 无过程的问题，全部机械放行——因为唯一的门槛是"非空字符串"。这些测试钉住新的
 * 要素门槛：逐问归因、四要素齐备、文献 ≥3 且与所用方法有关联、代码附录点名哪几问。
 *
 * 边界（同样被钉住）：**不设字数下限**——一段 200 字但要素齐备的分析必须通过，
 * 否则就变成"字数酷刑"，会逼模型灌水。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/prose-contracts
 */

import { describe, expect, it } from 'vitest'
import { proseContractViolations } from '../src/delivery/prose-contracts.ts'

const FOUR_Q = [
  { requirementId: 'R-OUT', statement: '整篇论文的产出要求（整段题面）' },
  { requirementId: 'R-Q1', statement: '设计抽样检测方案' },
  { requirementId: 'R-Q2', statement: '给出各阶段决策' },
  { requirementId: 'R-Q3', statement: '推广到 m 工序 n 零配件' },
  { requirementId: 'R-Q4', statement: '考虑抽样误差重新求解' },
]

const GOOD = {
  analysis: '问题1 归到假设检验，难点是两类错误下的最小样本量；问题2 归到期望值决策，难点是拆解循环的递推；问题3 归到多阶段动态规划，难点是树状结构；问题4 归到贝叶斯决策，难点是后验代入。',
  evaluation: '优点：结构清晰、可复算。局限：假设了独立同分布，忽略批次相关性。敏感性：对次品率 ±20% 扰动做了检验，最优方案不变。推广：可移植到多级供应链。',
  references: '[1] Wald A. Sequential Analysis. 1947.\n[2] 茆诗松. 概率论与数理统计教程. 2011.\n[3] 姜启源. 数学模型. 2018.',
  code: '问题1 由 solve_q1() 完成；问题2 由 solve_q2() 完成；问题3 由 solve_q3() 完成；问题4 由 solve_q4() 完成。',
}

describe('W11.5 round-4 — 要素级写作契约', () => {
  it('要素齐备的稿子零违规（即使篇幅不长）', () => {
    expect(proseContractViolations(GOOD, FOUR_Q)).toEqual([])
  })

  it('问题分析缺逐问归因 → 点名缺哪几问（207 字空洞章不再放行）', () => {
    const thin = { ...GOOD, analysis: '问题1为二项检验，其余各问为离散优化。' }
    const findings = proseContractViolations(thin, FOUR_Q)
    expect(findings.map(f => f.chapter)).toContain('analysis')
    const reason = findings.find(f => f.chapter === 'analysis')?.reason ?? ''
    expect(reason).toContain('R-Q2')
    expect(reason).toContain('R-Q4')
    // R-OUT 是整篇要求，不是"某一问"，不参与逐问判定
    expect(reason).not.toContain('R-OUT')
  })

  it('模型评价缺四要素 → 点名缺哪些要素', () => {
    const thin = { ...GOOD, evaluation: '结果可靠，可以推广到其它情形。' }
    const findings = proseContractViolations(thin, FOUR_Q)
    const reason = findings.find(f => f.chapter === 'evaluation')?.reason ?? ''
    expect(reason).toContain('优点')
    expect(reason).toContain('局限')
    expect(reason).toContain('敏感性')
  })

  it('参考文献少于 3 条 → 拒；≥3 条但与方法无关 → 拒', () => {
    const one = { ...GOOD, references: '[1] 茆诗松. 统计手册. 2011.' }
    expect(proseContractViolations(one, FOUR_Q).map(f => f.chapter)).toContain('references')
    const unrelated = {
      ...GOOD,
      references: '[1] 某公司年报. 2024.\n[2] 某行业白皮书. 2023.\n[3] 某新闻. 2022.',
    }
    expect(proseContractViolations(unrelated, FOUR_Q).map(f => f.chapter)).toContain('references')
  })

  it('代码附录没点名实现了哪几问 → 拒', () => {
    const vague = { ...GOOD, code: '代码实现了本文的求解流程。' }
    const reason = proseContractViolations(vague, FOUR_Q).find(f => f.chapter === 'code')?.reason ?? ''
    expect(reason).toContain('R-Q3')
  })

  it('单问题面不做逐问判定（没有"每问"可言）', () => {
    const single = [{ requirementId: 'R-OUT', statement: '估计冰厚' }]
    expect(proseContractViolations({ ...GOOD, analysis: '一句话分析。', code: '一段代码说明。' }, single)).toEqual([])
  })
})
