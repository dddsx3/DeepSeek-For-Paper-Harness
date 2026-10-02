/**
 * 结果锚点替换 —— 零数字通道缺的最后一段。
 *
 * 契约从阶段 2 起就要求"要报结果的地方写锚点"，但此前**没有任何环节把锚点换成值**：
 * `docx_precheck` 只认 `{<result_id>}` 尖括号形态，`numbers_traced` 又把 `{…}` 整段剥掉。
 * 于是 `{R-Q2-case5-profit}` 会原样印进最终 Word。这个模块补上那一段。
 */

import { describe, expect, it } from 'vitest'
import {
  anchorsIn, blankFencedCode, formatResultValue, parseAnchorReport, substituteResultAnchors,
} from '../../src/stages/anchor-resolve.ts'
import { addRoundedVariants, buildAllowlist, auditNumbers } from '../../src/stages/number-audit.ts'

const rows = [
  { result_id: 'R-Q1-p', name: '次品率', value: 0.1, unit: '' },
  { result_id: 'R-Q2-profit', name: '期望利润', value: 15.8765432, unit: '元' },
  { result_id: 'R-Q3-scan', name: '扫描表', value: [1, 2, 3], unit: '' },
]

describe('围栏代码块识别', () => {
  it('代码块整段置空（保留行数），块外原文不动', () => {
    const md = '正文 A\n```python\nx = {R-Q9}\n```\n正文 B'
    const blanked = blankFencedCode(md)
    expect(blanked.split('\n').length).toBe(md.split('\n').length)
    expect(blanked).not.toContain('R-Q9')
    expect(blanked).toContain('正文 A')
    expect(blanked).toContain('正文 B')
  })

  it('~~~ 围栏同样识别', () => {
    expect(blankFencedCode('~~~\n{R-Q9}\n~~~')).not.toContain('R-Q9')
  })
})

describe('锚点抽取', () => {
  it('按出现顺序去重，只认 `{R-…}` 形态', () => {
    expect(anchorsIn('a {R-Q1-p} b {R-Q2-x} c {R-Q1-p} d {不是锚点} e {<result_id>}'))
      .toEqual(['R-Q1-p', 'R-Q2-x'])
  })
})

describe('数值格式化 —— 4 位小数、去尾零、极端值走科学计数法', () => {
  it('常规值', () => {
    expect(formatResultValue(15.8765432)).toBe('15.8765')
    expect(formatResultValue(0.5)).toBe('0.5')
    expect(formatResultValue(0)).toBe('0')
    expect(formatResultValue(3)).toBe('3')
  })

  it('极小/极大值不写成 0.0000000…', () => {
    expect(formatResultValue(7.0089e-8)).toBe('7.0089e-8')
    expect(formatResultValue(1.2345e9)).toBe('1.2345e9')
  })
})

describe('替换', () => {
  it('标量锚点换成值；散文之外一律不动', () => {
    const md = '最优次品率为 {R-Q1-p}，期望利润 {R-Q2-profit} 元。'
    const out = substituteResultAnchors(md, rows)
    expect(out.text).toBe('最优次品率为 0.1，期望利润 15.8765 元。')
    expect(out.resolved.map(r => r.id)).toEqual(['R-Q1-p', 'R-Q2-profit'])
    expect(out.unresolved).toEqual([])
  })

  it('账本里没有的 id → **原样保留**并给出原因（不许猜、不许置空）', () => {
    const out = substituteResultAnchors('收益 {R-Q9-nope}。', rows)
    expect(out.text).toBe('收益 {R-Q9-nope}。')
    expect(out.unresolved[0]?.reason).toContain('账本里没有')
  })

  it('数组/矩阵类结果不能内联成数值 → 原样保留，提示改写成"见图 N"', () => {
    const out = substituteResultAnchors('扫描结果 {R-Q3-scan}。', rows)
    expect(out.text).toBe('扫描结果 {R-Q3-scan}。')
    expect(out.unresolved[0]?.reason).toContain('见图 N')
  })

  it('**附录代码块里的 `{R-…}` 一个都不许换**', () => {
    const md = '正文 {R-Q1-p}\n\n```python\nprint("{R-Q2-profit}")\n```\n'
    const out = substituteResultAnchors(md, rows)
    expect(out.text).toContain('正文 0.1')
    expect(out.text).toContain('print("{R-Q2-profit}")')
  })

  it('幂等：换过一遍之后再跑是空操作', () => {
    const once = substituteResultAnchors('值 {R-Q1-p}', rows).text
    const twice = substituteResultAnchors(once, rows)
    expect(twice.text).toBe(once)
    expect(twice.resolved).toEqual([])
  })
})

describe('四舍五入变体 —— 正文写"15.88"而账本存"15.8765432"必须算有出生证明', () => {
  const ledger = JSON.stringify({ results: [{ result_id: 'R-Q2-profit', value: 15.8765432 }] })

  it('变体由真值派生：15.88 / 15.877 / 15.8765 都在白名单里', () => {
    const allowed = new Set(buildAllowlist([ledger]))
    addRoundedVariants(ledger, allowed)
    for (const v of ['15.88', '15.877', '15.8765', '15.8765432']) expect(allowed.has(v), v).toBe(true)
  })

  it('**编造的数不会因此蒙混**：偏离真值较远的数仍不在白名单', () => {
    const allowed = new Set(buildAllowlist([ledger]))
    addRoundedVariants(ledger, allowed)
    expect(allowed.has('21.68')).toBe(false)
    expect(allowed.has('12.5')).toBe(false)
  })

  it('端到端：替换后的正文过 `numbers_traced` 的数字审计', () => {
    const text = substituteResultAnchors('期望利润为 {R-Q2-profit} 元。', rows).text
    const allowed = new Set(buildAllowlist([ledger]))
    addRoundedVariants(ledger, allowed)
    expect(auditNumbers(text, allowed).violations).toEqual([])
  })

  it('坏账本文本不抛错（由铸数那边报，这里只是拿不到变体）', () => {
    const allowed = new Set<string>()
    expect(() => { addRoundedVariants('{ 不是 JSON', allowed) }).not.toThrow()
    expect(allowed.size).toBe(0)
  })
})

describe('替换报告解析', () => {
  it('坏文件 → null（**不因此阻断**，门禁自己还会扫正文）', () => {
    expect(parseAnchorReport(null)).toBeNull()
    expect(parseAnchorReport('{坏')).toBeNull()
  })

  it('正常报告按条读出', () => {
    const r = parseAnchorReport(JSON.stringify({ resolved: 2, unresolved: [{ id: 'R-X', reason: 'r' }] }))
    expect(r?.resolved).toBe(2)
    expect(r?.unresolved).toEqual([{ id: 'R-X', reason: 'r' }])
  })
})
