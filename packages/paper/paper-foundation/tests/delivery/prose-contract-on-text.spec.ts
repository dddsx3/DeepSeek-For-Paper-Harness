/**
 * W12-B1 — 按**渲染后的正文**重跑正文契约 + 数字暴露量普查。
 *
 * ## 它守的缺陷（strict-11 实测出来的洞）
 *
 * `proseContractViolations` 读的是 `narrative`——容器里的那个字段。兜底路径
 * （B-e1-direct）**没有 narrative**，于是检查静默空转：兜底稿从不进这套判据。
 *
 * 而兜底稿不是终点，它之后还要过**修订轮**。修订轮的输入输出都是自由文本，
 * 唯一守卫是 `revisionDestroysDraft`（标题集合 + 长度 ≥50%）。实测：
 *
 *   - 兜底稿写着"本稿没有模型评价与推广：这一章由 E2 产出的容器提供…"（如实说明）
 *   - 修订轮把它整章改写成 1,193 字的真内容；参考文献章从说明变成 425 字条目表
 *   - 也就是说：**交付出去的那两章，是一次从未被任何契约检查过的自由文本改写**
 *
 * 更糟的是它改出了**伪造的验证结论**：结果章写"情形(1)在 n=29, c₁=6 时第一类
 * 错误为 0.0473，满足不超过 5% 的要求"。独立复算 P(X≥6|29,0.1) = **0.0637**
 * （不满足），0.0473 对应的是 (27,6)。一个声称"通过精确二项分布验证"的数字，
 * 本身是错的。
 *
 * 这一层不拒绝任何东西（兜底的意义是"总得交出点东西"），它把违规与数字暴露量
 * 逐条报出来，落进交付附录的已知缺陷表。
 */

import { describe, expect, it } from 'vitest'
import {
  chaptersOfPaper,
  numericClaimCensus,
  proseContractViolationsOfText,
} from '../../src/delivery/prose-contracts.ts'

const REQS = [
  { requirementId: 'R-Q1', statement: '设计抽样检测方案' },
  { requirementId: 'R-Q2', statement: '对生产各阶段作出决策' },
]

/**
 * 一份"四问齐全、要素齐备"的合格正文骨架，用来做反向对照。
 *
 * `overrides` 按**章标题**替换该章正文（不是追加）——第一版写成追加，于是被改坏的
 * 那一章后面还跟着原来的合格内容，"改坏"根本没生效，四条用例因此假绿。
 */
function goodPaper(overrides: Record<string, string> = {}): string {
  const ch = (title: string, body: string): string => `## ${title}\n\n${overrides[title] ?? body}\n`
  const long = (s: string, n: number): string => s.repeat(Math.ceil(n / s.length))
  return [
    '# 建模分析稿',
    ch('1 问题重述', long('本题要求设计抽样检测方案并对生产阶段决策。', 420)),
    ch('2 问题分析', long('问题1归到统计检验，问题2归到决策优化，两者都按问逐段分析。', 1300)),
    ch('3 模型假设', long('假设检测无误差、事件独立。', 200)),
    ch('10 结果对比与校核', long('结果与解析解一致，误差在容许范围内。', 200)),
    ch('11 模型评价与推广', long('优点：可复算。局限：假设理想化。敏感性：结论对参数不敏感。推广：可用于多工序。', 900)),
    ch('参考文献', [
      '[1] Montgomery D C. Introduction to Statistical Quality Control. Wiley, 2019.',
      '[2] 茆诗松, 程依明, 濮晓龙. 概率论与数理统计教程. 高等教育出版社, 2011.',
      '[3] 姜启源, 谢金星, 叶俊. 数学模型. 高等教育出版社, 2018.',
      long('抽样检验与序贯决策的方法综述。', 620),
    ].join('\n\n')),
    ch('附录 B 核心代码', long('代码覆盖问题1与问题2的求解。', 640)),
  ].join('\n')
}

describe('W12-B1 — chaptersOfPaper', () => {
  it('剥掉序号前缀后按章名映射（渲染稿的标题形态是 `## 6 问题1：…`）', () => {
    const md = [
      '## 1 问题重述',
      '甲',
      '## 10 结果对比与校核',
      '乙',
      '## 11 模型评价与推广',
      '丙',
      '## 参考文献',
      '丁',
      '## 6 问题1：最小样本量与拒收临界值',
      '这是逐问章，不进契约映射',
    ].join('\n')
    const chapters = chaptersOfPaper(md)
    expect(Object.keys(chapters).sort()).toEqual(['evaluation', 'references', 'restatement', 'results'])
    expect(chapters['evaluation']).toContain('丙')
    expect(chapters['restatement']).toContain('甲')
    // 逐问章不属于契约章，不该被误当成 analysis
    expect(chapters['analysis']).toBeUndefined()
  })

  it('同名章出现两次时**追加**（取并集才不会因为拆章形态变化而漏判）', () => {
    const chapters = chaptersOfPaper('## 参考文献\n甲\n## 参考文献\n乙\n')
    expect(chapters['references']).toContain('甲')
    expect(chapters['references']).toContain('乙')
  })

  it('未知章名不进映射（不猜测）', () => {
    const chapters = chaptersOfPaper('## 附录 C 致谢\n内容\n')
    expect(Object.keys(chapters)).toEqual([])
  })
})

describe('W12-B1 — proseContractViolationsOfText', () => {
  it('合格正文零违规（反向对照，防误报）', () => {
    const violations = proseContractViolationsOfText(goodPaper(), REQS)
    expect(violations, JSON.stringify(violations)).toEqual([])
  })

  it('参考文献缺方法关键词 → 报出来（strict-11 的头号阻断就是这条规则）', () => {
    const paper = goodPaper({
      '参考文献': [
        '[1] 张三. 一本与本题无关的书. 某出版社, 2019.',
        '[2] 李四. 另一本无关的书. 某出版社, 2020.',
        '[3] 王五. 第三本无关的书. 某出版社, 2021.',
      ].join('\n\n'),
    })
    const violations = proseContractViolationsOfText(paper, REQS)
    expect(violations.some(v => v.chapter === 'references')).toBe(true)
  })

  it('模型评价缺"推广"要素 → 报出来', () => {
    const paper = goodPaper({ '11 模型评价与推广': '优点：可复算。局限：假设理想化。敏感性：不敏感。' })
    const violations = proseContractViolationsOfText(paper, REQS)
    expect(violations.some(v => v.chapter === 'evaluation')).toBe(true)
  })

  it('问题分析没有逐问归因 → 报出来', () => {
    const paper = goodPaper({ '2 问题分析': '本题是一个综合问题，需要仔细分析。'.repeat(60) })
    const violations = proseContractViolationsOfText(paper, REQS)
    expect(violations.some(v => v.chapter === 'analysis')).toBe(true)
  })

  it('篇幅地板对渲染正文同样生效（不是只有 narrative 才判）', () => {
    const paper = goodPaper({ '11 模型评价与推广': '优点：可复算。局限：理想化。敏感性：不敏感。推广：可用于多工序。' })
    const violations = proseContractViolationsOfText(paper, REQS)
    expect(violations.some(v => v.chapter === 'evaluation' && v.reason.includes('字'))).toBe(true)
  })
})

describe('W12-B1 — numericClaimCensus', () => {
  it('数出正文里的数字字面量', () => {
    expect(numericClaimCensus('样本量为 29 件，临界值 6 件。')).toBe(2)
  })

  it('**排除代码块**：那里的数字是源码，不是结论', () => {
    const md = ['正文有 3 处结论。', '```python', 'n = 46', 'c = 2', 'print(n, c)', '```', '结尾。'].join('\n')
    expect(numericClaimCensus(md)).toBe(1)
  })

  it('**排除 `{<result_id>}` 占位符**：那是零数字通道的合法形态', () => {
    // 注意 `情形(1)` 里的 `1` **仍然被数**——它是货真价实的数字字面量（与图注
    // 那条判据同一口径：中文序号里的数字也算）。普查宁可多报不可漏报：
    // 这条 finding 的用途是"告诉读者这稿的数字没验证过"，少报才是危险的。
    const md = '情形(1)最小样本量为 {R-N1} 件，临界值 {R-C1} 件，第一类错误为 {R-ALPHA}。'
    expect(numericClaimCensus(md)).toBe(1)
    // 纯占位符、没有序号时是 0
    expect(numericClaimCensus('最小样本量为 {R-N1} 件，临界值 {R-C1} 件。')).toBe(0)
  })

  it('反向守卫：占位符之外的真数字照数（不能因为排占位符把真数字也放过）', () => {
    const md = '最小样本量为 {R-N1} 件，即 29 件。'
    expect(numericClaimCensus(md)).toBe(1)
  })

  it('标识符里的数字不算（`R-Q1` 不是数量）', () => {
    expect(numericClaimCensus('见 R-Q1 与 P2 的分析。')).toBe(0)
  })

  it('空正文为 0（不抛）', () => {
    expect(numericClaimCensus('')).toBe(0)
  })
})
