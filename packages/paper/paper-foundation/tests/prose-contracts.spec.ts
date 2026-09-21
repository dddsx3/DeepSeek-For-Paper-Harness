/**
 * W11.5 round-4 — 要素级写作契约 + 实质地板（审计 §3.2 的验收）。
 *
 * baseline-23 的实证：207 字的问题分析、185 字的模型评价、1 篇参考文献、利润=0 且
 * 无过程的问题，全部机械放行——因为唯一的门槛是"非空字符串"。参照物
 * （CUMCM/workspaces/5ba6e7bd5010/paper/main.md，52,415 字符）给出了合格交付的
 * 尺度：问题分析 1,939 字符、模型评价 1,474、参考文献 3,914、附录各 1–1.8K。
 *
 * 这些测试钉住两层门槛：
 *   1. 要素——逐问归因、四要素齐备、文献 ≥3 且与所用方法有关联、代码附录点名哪几问；
 *   2. 地板——多问题论文的每一章不得低于实质篇幅下限（用户口径：不允许大片空白、
 *      不允许非常简略的片段）。
 *
 * 边界（同样被钉住）：单问题面不做逐问判定、不套四章字数地板——那不是竞赛论文。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/prose-contracts
 */

import { describe, expect, it } from 'vitest'
import { proseContractViolations } from '../src/delivery/prose-contracts.ts'

/** 把一段实质文字重复到超过某章的地板（夹具只需满足契约，篇幅是附带的）。 */
function pad(base: string, min: number): string {
  let out = base
  while (out.replace(/\s+/g, '').length < min) out += base
  return out
}

const FOUR_Q = [
  { requirementId: 'R-OUT', statement: '整篇论文的产出要求（整段题面）' },
  { requirementId: 'R-Q1', statement: '设计抽样检测方案' },
  { requirementId: 'R-Q2', statement: '给出各阶段决策' },
  { requirementId: 'R-Q3', statement: '推广到 m 工序 n 零配件' },
  { requirementId: 'R-Q4', statement: '考虑抽样误差重新求解' },
]

const LONG_ANALYSIS = [
  '问题1 归到假设检验（抽样检验），难点是两类错误下的最小样本量：需要在 95% 信度下控制第一类错误，同时保证对可检出次品率有足够功效，样本量与判定阈值的联合搜索是核心。' 
  + '这一问的结论必须分别给出两种信度下的具体方案，因此模型里同时保留精确二项分布与正态近似两条路径，用前者定稿、后者做量级校核。',
  '问题2 归到期望值决策，难点是拆解循环的期望成本递推：不合格成品拆解后重新进入检测与装配，形成不动点方程，需要证明该递推存在稳态。',
  '问题3 归到多阶段动态规划，难点是树状装配结构的阶段划分与状态转移，需要自底向上聚合各节点期望成本，并处理半成品与成品的次品率传递。',
  '问题4 归到贝叶斯决策，难点是把后验分布而非点估计代入决策，需要比较频率学派与贝叶斯两套结论的差异并给出取舍依据。',
].join('\n')

const LONG_EVAL = [
  '优点：模型结构清晰、每一步都可复算，抽样方案与决策规则都由代码给出并可独立重跑；' 
  + '四问共用一套期望成本与策略枚举的框架，参数替换即可复用到同类生产决策问题。',
  '局限：假设了各零配件次品事件独立同分布，忽略了批次内相关性与供应商间差异，拆解循环也只取稳态期望。',
  '敏感性：对次品率、调换损失与拆解费用各做 ±20% 扰动，最优方案在多数扰动下不变，边界情形会翻转。',
  '推广：同一框架可移植到多级供应链与多工序装配，只需替换装配结构与成本参数。',
].join('\n')

const LONG_REFS = [
  '[1] Wald A. Sequential Analysis. Wiley. 1947.',
  '[2] 茆诗松, 程依明, 濮晓龙. 概率论与数理统计教程. 高等教育出版社. 2011.',
  '[3] 姜启源, 谢金星, 叶俊. 数学模型. 高等教育出版社. 2018.',
].join('\n')

const LONG_CODE = [
  '问题1 由 solve_q1() 完成：在二项分布下联合搜索最小样本量与判定阈值，输出 q1_results.json。',
  '问题2 由 solve_q2() 完成：枚举 16 种检测/拆解决策组合，用不动点方程求期望成本并取最优，输出 q2_results.json。',
  '问题3 由 solve_q3() 完成：对 2 道工序 8 个零配件的树状结构自底向上递推，输出 q3_results.json。',
  '问题4 由 solve_q4() 完成：以 Beta 后验替代点估计重算问题2/3 的决策，输出 q4_results.json。',
].join('\n')

const LONG_RESTATEMENT = [
  '某企业生产电子产品，需要购买两种零配件并装配成成品，次品会沿装配链传递：只要一个零配件不合格，成品一定不合格；两个都合格，成品也未必合格。',
  '题目要求依次解决四问：设计检测次数尽可能少的抽样方案并在两种信度下给出具体结果；给出各阶段是否检测、是否拆解的决策方案与指标；推广到 m 道工序 n 个零配件；最后考虑次品率由抽样得到的不确定性重新求解。',
].join('\n')

const GOOD = {
  analysis: pad(LONG_ANALYSIS, 700),
  evaluation: pad(LONG_EVAL, 600),
  references: pad(LONG_REFS, 200),
  code: pad(LONG_CODE, 300),
  restatement: pad(LONG_RESTATEMENT, 300),
}

describe('W11.5 round-4 — 要素级写作契约', () => {
  it('要素齐备、篇幅达标的稿子零违规', () => {
    expect(proseContractViolations(GOOD, FOUR_Q)).toEqual([])
  })

  it('问题分析缺逐问归因 → 点名缺哪几问（207 字空洞章不再放行）', () => {
    const withoutQ2 = LONG_ANALYSIS.split('\n').filter(l => !l.startsWith('问题2')).join('\n')
    const findings = proseContractViolations({ ...GOOD, analysis: withoutQ2 }, FOUR_Q)
    const reason = findings.find(f => f.chapter === 'analysis')?.reason ?? ''
    expect(reason).toContain('R-Q2')
    // R-OUT 是整篇要求，不是"某一问"，不参与逐问判定
    expect(reason).not.toContain('R-OUT')
  })

  it('模型评价缺四要素 → 点名缺哪些要素', () => {
    const thin = { ...GOOD, evaluation: '结果可靠，可以推广到其它情形。'.repeat(20) }
    const reason = proseContractViolations(thin, FOUR_Q).find(f => f.chapter === 'evaluation')?.reason ?? ''
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
    const vague = { ...GOOD, code: '代码实现了本文的求解流程，细节见仓库。'.repeat(20) }
    const reason = proseContractViolations(vague, FOUR_Q).find(f => f.chapter === 'code')?.reason ?? ''
    expect(reason).toContain('R-Q3')
  })

  it('多问题论文的每一章都有实质地板（非常简略的片段一律拒）', () => {
    const fragment = { ...GOOD, evaluation: '优点：好。局限：有。敏感性：做过。推广：能。' }
    const reason = proseContractViolations(fragment, FOUR_Q).find(f => f.chapter === 'evaluation')?.reason ?? ''
    expect(reason).toContain('低于')
  })

  it('单问题面不做逐问判定、不套四章字数地板（那不是竞赛论文）', () => {
    const single = [{ requirementId: 'R-OUT', statement: '估计冰厚' }]
    const tiny = {
      analysis: '一句话分析。',
      code: '一段代码说明。',
      evaluation: '简短评价。',
      references: '[1] x. y. 2020.',
      restatement: '短。',
    }
    expect(proseContractViolations(tiny, single)).toEqual([])
  })
})
