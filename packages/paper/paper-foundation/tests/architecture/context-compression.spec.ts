/**
 * 数学建模语境的结构保持压缩 —— "不能套用常用压缩"的机械验收。
 *
 * 判据不是"压得小"，而是三条硬约束：
 * ① **数字一个不少**（多重集守恒——一位小数都不能丢）；
 * ② **锚点/清单标记/代码围栏逐字保留**（下游按字面对账，代码是可执行语义）；
 * ③ **确定性**（同一输入永远同一输出——可审计、可复算）。
 * 在这三条之下才谈"散文变短"。
 */

import { describe, expect, it } from 'vitest'
import { compressForModeling, compressionLosses, numbersOf, shouldCompress } from '../../src/stages/context-compression.ts'

/** 一段有代表性的题面/上游产物：散文 + 硬约束 + 表格 + 代码 + 锚点。 */
const SAMPLE = [
  '# 问题重述',
  '',
  '某企业生产某种电子产品，需要两种零配件，每种零配件单独进入装配环节。',
  '如果零配件被检测为次品，则丢弃；如果装配后检测为次品，可以选择拆解或者报废。',
  '企业需要决定是否对零配件进行检测，以及在装配环节是否进行检测，从而使得期望利润最大。',
  '',
  '[[ASSUMPTION: A-X]] 零配件次品率相互独立，且装配过程不会引入新的次品。',
  '[[REQUIREMENT: R-Q1]] 在 95% 的置信水平下给出抽样检测方案，并计算检测次数。',
  '',
  '硬约束：次品率不得超过 10%，检测成本每人次 2 元，装配成本每件 6 元，',
  '市场售价 56 元，调换损失 6 元，拆解费用 5 元，新样品数量至少 800 件。',
  '',
  '| 情形 | 次品率 | 购买单价 | 检测成本 |',
  '| --- | --- | --- | --- |',
  '| 情况1 | 10% | 4 | 2 |',
  '',
  '```python',
  'import json',
  'json.dump({"n_star": 17}, open("outputs.json", "w"))',
  '```',
  '',
  '上面的模型假设与情形设定构成了本文全部计算的基础，后续各问都在这一框架下展开，',
  '并在灵敏度分析一节检验结论对参数扰动的稳健性。',
].join('\n')

describe('数学建模语境压缩 —— 三条硬约束', () => {
  it('① 数字一个不少（多重集守恒）', () => {
    const { text } = compressForModeling(SAMPLE, 450)
    const before = numbersOf(SAMPLE)
    const after = numbersOf(text)
    for (const n of before) expect(after.has(n), `数字 ${n} 在压缩后丢了`).toBe(true)
    expect(compressionLosses(SAMPLE, text)).toEqual([])
  })

  it('② 锚点/清单标记/代码围栏逐字保留', () => {
    const { text } = compressForModeling(SAMPLE, 450)
    expect(text).toContain('[[ASSUMPTION: A-X]] 零配件次品率相互独立，且装配过程不会引入新的次品。')
    expect(text).toContain('[[REQUIREMENT: R-Q1]] 在 95% 的置信水平下给出抽样检测方案，并计算检测次数。')
    expect(text).toContain('import json')
    expect(text).toContain('json.dump({"n_star": 17}, open("outputs.json", "w"))')
    // 表格行逐字保留
    expect(text).toContain('| 情况1 | 10% | 4 | 2 |')
    expect(compressionLosses(SAMPLE, text)).toEqual([])
  })

  it('散文确实变短（压得动）——用散文为主的样本', () => {
    // 纯散文 + 少量必须保的数：压缩的空间全在散文里。
    const prose = [
      '# 灵敏度分析',
      '',
      ...Array.from({ length: 12 }, (_, i) =>
        `讨论段 ${String(i + 1)}：这一段展开讨论模型对参数扰动的响应特性，`
          + '包括求解器的收敛行为、离散化误差的传播路径，以及不同初值下迭代轨迹的差异性，'
          + '并逐一说明这些现象与理论预期之间的对应关系，为后文的稳健性检验做铺垫。'.repeat(2)),
      '',
      '硬约束：次品率不得超过 10%，检测成本每人次 2 元。',
    ].join('\n')
    const { text, report } = compressForModeling(prose, 1600)
    expect(report.compressedChars).toBeLessThan(report.originalChars)
    expect(text).toContain('……（已压缩）')
    // 数字仍然一个不少
    expect(compressionLosses(prose, text)).toEqual([])
    // SAMPLE（受保护行占绝对多数）在预算内原样传递；超出时如实超、不丢对象
    const tight = compressForModeling(SAMPLE, 450)
    expect(compressionLosses(SAMPLE, tight.text)).toEqual([])
  })

  it('③ 确定性：同一输入两次压缩逐字节相同', () => {
    const a = compressForModeling(SAMPLE, 450)
    const b = compressForModeling(SAMPLE, 450)
    expect(a.text).toBe(b.text)
    expect(a.report).toEqual(b.report)
  })

  it('反例：把文本对半砍会丢数字——losses 必须抓得住（这就是不能用通用压缩的原因）', () => {
    const naive = SAMPLE.slice(0, Math.floor(SAMPLE.length / 2))
    const losses = compressionLosses(SAMPLE, naive)
    expect(losses.length, '对半砍居然没丢任何东西——判据失效').toBeGreaterThan(0)
    expect(losses.some(x => x.startsWith('数字'))).toBe(true)
  })

  it('压不进预算时**如实超**，不丢保护对象（不静默丢）', () => {
    // 预算给到比全部保护行加起来还小：只能超，不许丢
    const { text, report } = compressForModeling(SAMPLE, 50)
    expect(compressionLosses(SAMPLE, text)).toEqual([])
    expect(report.compressedChars).toBeGreaterThan(50) // 宁超不丢
  })

  it('没超预算 → 原样传递（压缩本身也有风险，能不压就不压）', () => {
    expect(shouldCompress(SAMPLE, SAMPLE.length + 1)).toBe(false)
    expect(shouldCompress(SAMPLE, 10)).toBe(true)
    const { text } = compressForModeling(SAMPLE, SAMPLE.length + 100)
    expect(text).toBe(SAMPLE)
  })

  it('代码围栏内的行全保（摘要器最容易把代码当散文删半句）', () => {
    const { text } = compressForModeling(SAMPLE, 250)
    expect(text).toContain('"n_star": 17')
  })
})
