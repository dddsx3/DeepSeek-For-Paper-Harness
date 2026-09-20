/**
 * W11.5-A3 — 数字核对步（自洽扫描）的构造性测试 + 真实交付物样本.
 *
 * 三个真实样本全部取自 `artifacts/handoff/neizero/report.md`（第零次内测的
 * 真实交付物，其数字错误已由人工评估逐条核验）——"抓真错"与"零误报"都
 * 必须在真实文本上成立，而不是在我编的例子上了事。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/digit-check
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { digitSelfContradictionFindings } from '../../src/delivery/digit-check.ts'

describe('digit-check — 真实交付物样本（第零次内测 report.md）', () => {
  const neizero = readFileSync(
    fileURLToPath(new URL('../../../../../artifacts/handoff/neizero/report.md', import.meta.url)),
    'utf8',
  )

  it('抓住真实错误：$q_f=0.9^8\\times0.9^3\\approx0.478$（实为 0.3138）', () => {
    const findings = digitSelfContradictionFindings(neizero)
    const hit = findings.find(f => Math.abs(f.stated - 0.478) < 1e-9)
    expect(hit, 'the 0.478 contradiction must be caught').toBeDefined()
    expect(hit?.computed).toBeCloseTo(0.31381059, 6)
  })

  it('不误报：$q=0.872\\times0.9\\times0.9=0.706$（0.70632 四舍五入即 0.706）', () => {
    const findings = digitSelfContradictionFindings(neizero)
    expect(findings.some(f => Math.abs(f.stated - 0.706) < 1e-9)).toBe(false)
  })

  it('不误报：$0.197\\times4=0.79$（两位小数陈述，半 ULP 容差吸收）', () => {
    const findings = digitSelfContradictionFindings(neizero)
    expect(findings.some(f => Math.abs(f.stated - 0.79) < 1e-9)).toBe(false)
  })

  it('整篇扫描的发现数被逐条记录（可归档；不是"全绿"式假绿）', () => {
    const findings = digitSelfContradictionFindings(neizero)
    // The archive of this scan lives in the W11.5 report; here we only pin
    // that it found the known contradiction and nothing on the controls.
    expect(findings.length).toBeGreaterThanOrEqual(1)
    writeFindings(findings)
  })
})

/** Persist the scan for the round archive (the H4 "抓到的错误逐条归档"). */
function writeFindings(findings: ReturnType<typeof digitSelfContradictionFindings>): void {
  // Side-effect-free in tests unless the archive dir exists (it does in this
  // round; the import is lazy so a fresh checkout without it stays green).
  try {
    const dir = fileURLToPath(new URL('../../../../../artifacts/handoff/W11.5/', import.meta.url))
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}a3-digit-scan-neizero.json`, JSON.stringify(findings, null, 2))
  } catch { /* archive is best-effort; the assertions above are the test */ }
}

describe('digit-check — 构造性反例（判定的边界必须可证）', () => {
  it('纯数值算式且结果错 → 抓', () => {
    expect(digitSelfContradictionFindings('计算得 $q=0.5\\times0.5\\times0.5=0.2$。')).toHaveLength(1)
  })

  it('结果对 → 不抓（同一算式，正确值）', () => {
    expect(digitSelfContradictionFindings('计算得 $q=0.5\\times0.5\\times0.5=0.125$。')).toHaveLength(0)
  })

  it('含符号/单位/百分号的算式 → 不判（超出可判范围，绝不猜）', () => {
    expect(digitSelfContradictionFindings('$V=21.87\\times0.9=19.68$ 元。')).toHaveLength(0)
    expect(digitSelfContradictionFindings('成本 2+3=6 元。')).toHaveLength(0)
  })

  it('散文里的裸数字（无算式）→ 不判', () => {
    expect(digitSelfContradictionFindings('利润为 21.87 元，置信度 0.95。')).toHaveLength(0)
  })

  it('只有一个运算符 → 不判（a=b 型陈述不构成可判算式）', () => {
    expect(digitSelfContradictionFindings('$0.9^8=0.478$')).toHaveLength(0)
  })

  it('括号内先算（不误报）：$0.81\\times(4+18)=17.82$ —— 真实交付物里的正确算式', () => {
    // 第一版评估器丢掉括号，把它读成 0.81×4+18=21.24 并误报；
    // 真实交付物上的这条假阳性是本模块改为递归下降求值的原因。
    expect(digitSelfContradictionFindings('$0.81\\times(4+18)=17.82$')).toHaveLength(0)
  })

  it('括号内先算（真错照抓）：$0.81\\times(4+18)=21.24$', () => {
    expect(digitSelfContradictionFindings('$0.81\\times(4+18)=21.24$')).toHaveLength(1)
  })

  it('幂运算优先级正确：$0.9^8\\times0.9\\times0.9\\times0.9\\approx0.478$ 抓，≈0.314 不抓', () => {
    expect(digitSelfContradictionFindings('$0.9^8\\times0.9\\times0.9\\times0.9\\approx0.478$')).toHaveLength(1)
    expect(digitSelfContradictionFindings('$0.9^8\\times0.9\\times0.9\\times0.9\\approx0.314$')).toHaveLength(0)
  })

  it('行内与行间公式都扫（$$ 与 $ 两种定界符）', () => {
    expect(digitSelfContradictionFindings('$$0.5\\times0.5\\times0.5=0.2$$')).toHaveLength(1)
    expect(digitSelfContradictionFindings('$0.5\\times0.5\\times0.5=0.2$')).toHaveLength(1)
  })
})
