/**
 * W11.5 baseline-18 — sub-problem extraction (审计 A-3/A-4/B-2/B-3/B-4).
 *
 * The seventeenth baseline's paper answered only 问题1: the harness registered a
 * single REQUIRED_OUTPUT for the whole paper, so the coverage gate had nothing to
 * demand and the model stopped after the first sub-problem. The sub-problems are
 * now read out of the statement itself, one REQUIRED_OUTPUT each — harness-side,
 * so the model can neither invent nor omit one.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/input-registration
 */

import { describe, expect, it } from 'vitest'
import { subProblemsOf } from '../src/executor.ts'

const FOUR_QUESTION = [
  '某企业生产某种畅销的电子产品……',
  '问题 1 供应商声称一批零配件的次品率不会超过某个标称值。请设计抽样检测方案。',
  '问题 2 已知两种零配件和成品次品率，请为生产过程的各个阶段作出决策。',
  '问题 3 对 m 道工序、n 个零配件，重复问题 2，给出生产过程的决策方案。',
  '问题 4 假设问题 2 和问题 3 中次品率均是通过抽样检测方法得到的，请重新完成。',
].join('\n')

describe('W11.5 baseline-18 — 逐问 REQUIRED_OUTPUT', () => {
  it('四问的题面 → R-Q1..R-Q4，每问带自己的题面片段', () => {
    const subs = subProblemsOf(FOUR_QUESTION)
    expect(subs.map(s => s.requirementId)).toEqual(['R-Q1', 'R-Q2', 'R-Q3', 'R-Q4'])
    expect(subs[0]?.statement).toContain('抽样检测方案')
    expect(subs[2]?.statement).toContain('m 道工序')
    // 每一问的片段不得吞掉下一问（否则"覆盖"就成了空话）
    expect(subs[0]?.statement).not.toContain('问题 2')
    expect(subs[1]?.statement).not.toContain('问题 3')
  })

  it('中文数字与"第N问"写法同样识别', () => {
    const subs = subProblemsOf('问题一：求 A。\n问题二：求 B。\n第3问：求 C。')
    expect(subs.map(s => s.requirementId)).toEqual(['R-Q1', 'R-Q2'])
  })

  it('单问题面 → 空（保持原有的整体 R-OUT 语义，不制造假要求）', () => {
    expect(subProblemsOf('请估计冰层平均厚度。')).toEqual([])
    expect(subProblemsOf('问题 1 只有一个问题。')).toEqual([])
  })

  it('重复出现的"问题 2"（如问题4 复述问题2）不产生重复 id', () => {
    const subs = subProblemsOf(FOUR_QUESTION)
    expect(new Set(subs.map(s => s.requirementId)).size).toBe(subs.length)
  })
})

// ---------------------------------------------------------------------------
// W11.5 baseline-18 — 交付文本的数字闭环（审计 A-2）
// ---------------------------------------------------------------------------
describe('W11.5 baseline-18 — 交付稿的结论面数字必须回到 IR', () => {
  const REPORT = [
    '# 题',
    '',
    '## 摘要',
    '',
    '针对《题》，本文给出关键结论。',
    '- 最小样本量为 29。',
    '',
    '## 结果对比与校核',
    '',
    '### 结论',
    '',
    '- 最小样本量为 {R-N}。',
    '',
    '_校核声明：本表数字由规范 IR Result 记录渲染（D4）。_',
  ].join('\n')

  it('摘要里出现非 IR 数字 → 机械缺陷（点名那个数字）', async () => {
    const { deliveredNumberFindings } = await import('../src/delivery/delivered-numbers.ts')
    const findings = deliveredNumberFindings(REPORT, ['2'])
    expect(findings.length).toBeGreaterThan(0)
    const text = findings.map(f => f.description).join(' ')
    expect(text).toContain("'29'")
    expect(findings[0]?.severity).toBe('critical')
    expect(findings[0]?.id.startsWith('MECH-NUM-')).toBe(true)
  })

  it('全部数字都在 IR/题面集合里 → 零缺陷（含标识符与序号的负对照）', async () => {
    const { deliveredNumberFindings } = await import('../src/delivery/delivered-numbers.ts')
    // 'D4' 是标识符、'问题 1' 是序号，都不是数字——不得误报
    const clean = REPORT.replace('最小样本量为 29。', '问题 1 的最小样本量为 2。')
    expect(deliveredNumberFindings(clean, ['2'])).toEqual([])
  })
})
