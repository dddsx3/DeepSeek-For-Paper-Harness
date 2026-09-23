/**
 * L6 — 复验登记表：**指纹只能来自重跑真检查器**。
 *
 * 这里钉住的是本次改造中修掉的一个真实缺陷：第一版把指纹定义成
 * `sha256(category :: evidence :: 文本长度)`。它让"模型把文字改长一个字符"就能
 * 让指纹变化、被判"已修复"——**而没有任何检查器跑过**。那正是 C1 要防的形态
 * （"我改过了"不是证据），只不过伪装成了机器判定。
 *
 * 因此本文件的第一条测试是**负对照**：一段文字被彻底改写、但违规依旧 →
 * 指纹**必须不变**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/architecture/recheck
 */

import { describe, expect, it } from 'vitest'
import { ClosureSession } from '../../src/delivery/closure.ts'
import { makeFinding, type Finding } from '../../src/delivery/finding.ts'
import {
  RECHECKERS,
  allowedNumberStrings,
  initialFingerprint,
  recheckFinding,
  type RecheckInput,
} from '../../src/delivery/recheck.ts'

const requirement = { requirementId: 'R-Q1', statement: '求最小样本量' }

/** A narrative whose 问题分析 is far below the rewrite floor. */
const THIN_NARRATIVE: Readonly<Record<string, unknown>> = {
  title: '标题',
  methods: '方法',
  conclusion: '结论',
  restatement: '重述',
  analysis: '问题1用二项检验。',
  evaluation: '好',
  references: '参考文献',
  code: '代码',
}

function input(over: Partial<RecheckInput> = {}): RecheckInput {
  return { text: 'x'.repeat(500), narrative: THIN_NARRATIVE, requirements: [requirement], store: null, ...over }
}

describe('L6 复验 — 指纹必须来自重跑真检查器', () => {
  it('**负对照**：文字被彻底改写但违规依旧 → 指纹不变（"改过了"不是证据）', () => {
    const before = initialFingerprint('prose_contract', input({ narrative: THIN_NARRATIVE }))
    // 同一份内容，措辞与**字数**全换（违规 reason 里带着字数，这是最容易被
    // 漏掉的易变量）——违规集合没变。
    const rewritten = { ...THIN_NARRATIVE, analysis: '问题1 采用单侧二项检验，因为题面给出了接收判据，样本量待定。' }
    const after = recheckFinding('prose_contract', input({ narrative: rewritten }))
    expect(after.kind).toBe('fingerprint')
    if (after.kind === 'fingerprint') expect(after.value).toBe(before)
  })

  it('违规消失 → 指纹改变（这才是"修复"的判据）', () => {
    const before = initialFingerprint('prose_contract', input({ narrative: THIN_NARRATIVE }))
    // 把每一章都写到退回线以上。
    const full: Record<string, unknown> = {
      ...THIN_NARRATIVE,
      analysis: '问题1 采用单侧二项检验，因为题面给出了接收判据与拒收判据，样本量待定。'.repeat(20),
      evaluation: '优点：口径同源可复算。局限：成本参数被当作已知常数。敏感性：对次品率最敏感。推广：同一框架可用于多阶段质量控制。'.repeat(10),
      references: '[1] 作者. 抽样检验方法. 统计出版社. 2020. '.repeat(20),
      code: '问题1 由 solve_q1() 完成，负责解最小样本量。'.repeat(20),
      restatement: '本文研究抽样检验设计问题，要求给出统一的最小样本量。'.repeat(10),
    }
    const after = recheckFinding('prose_contract', input({ narrative: full }))
    expect(after.kind).toBe('fingerprint')
    if (after.kind === 'fingerprint') expect(after.value).not.toBe(before)
  })

  it('**未登记的类别不给猜测值** —— 落 checker_failed（与未通过同级）', () => {
    const outcome = recheckFinding('some_gate_nobody_registered', input())
    expect(outcome.kind).toBe('checker_failed')
    if (outcome.kind === 'checker_failed') {
      expect(outcome.reason).toContain('没有为这个类别登记复验检查器')
      // 明确说明文本长度不作为证据——这句话本身就是那条缺陷的墓碑。
      expect(outcome.reason).toContain('文本长度')
    }
  })

  it('登记表覆盖了能真跑的检查器，且不含"给文本算哈希"的伪实现', () => {
    const ids = [...RECHECKERS.keys()].sort()
    expect(ids).toEqual([
      'assumption_structure', 'blank_area', 'delivered_numbers',
      'digit_check', 'model_structure', 'prose_contract', 'required_output_unpaid',
      // W12-B1：正文里未经代码通道验证的数字字面量个数（只在兜底路径上报）。
      // 复验判据是"降到 0 才算修好"——用"数量下降"当判据会让"改掉一个错数字、
      // 又写下另一个"混过去。
      'unverified_numbers',
    ])
  })

  it('建模类类别走**结构指纹**复验——"改文字冒充改建模"因此过不了复验', () => {
    const store = new Map([
      ['EQ-1', { kind: 'EquationSpec', value: { equation_id: 'EQ-1', expression: 'q' } }],
      ['SYM-q', { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', token: 'q' } }],
    ])
    const before = recheckFinding('PRODUCE_CHAIN_NO_MODEL', input({ store: store as never }))
    expect(before.kind).toBe('fingerprint')
    // 同一结构（只改了文字表述）→ 指纹不变。
    const same = recheckFinding('PRODUCE_CHAIN_NO_MODEL', input({ store: store as never, text: '完全重写的一段话' }))
    if (before.kind === 'fingerprint' && same.kind === 'fingerprint') expect(same.value).toBe(before.value)
    // 结构真的变了（换了方程）→ 指纹改变。
    const changed = new Map([...store, ['EQ-2', { kind: 'EquationSpec', value: { equation_id: 'EQ-2', expression: 'q = m' } }]])
    const after = recheckFinding('PRODUCE_CHAIN_NO_MODEL', input({ store: changed as never }))
    if (before.kind === 'fingerprint' && after.kind === 'fingerprint') expect(after.value).not.toBe(before.value)
  })

  it('空白密度：连续空行被消掉后指纹改变', () => {
    const withBlanks = `# 标题\n\n\n\n\n问题1 的分析\n${'内容'.repeat(100)}`
    const withoutBlanks = `# 标题\n\n问题1 的分析\n${'内容'.repeat(100)}`
    const a = recheckFinding('blank_area', input({ text: withBlanks }))
    const b = recheckFinding('blank_area', input({ text: withoutBlanks }))
    expect(a.kind).toBe('fingerprint')
    expect(b.kind).toBe('fingerprint')
    if (a.kind === 'fingerprint' && b.kind === 'fingerprint') expect(a.value).not.toBe(b.value)
  })

  it('数字白名单按 executor 的同一条口径重建（Result 值 + 不确定度 + 题面常数）', () => {
    const store = new Map([
      ['RES-1', { kind: 'Result', value: { result_id: 'RES-1', value: 1762, uncertainty: 12 } }],
      ['R-Q1', { kind: 'RequirementSpec', value: { requirement_id: 'R-Q1', statement: '在 95% 信度下判断' } }],
    ])
    const allowed = allowedNumberStrings(store as never)
    expect(allowed).toContain('1762')
    expect(allowed).toContain('12')
    expect(allowed).toContain('95')
  })
})

describe('L6 闭环 — 重复 id 必须快速失败', () => {
  it('两条同 (checker, category, fingerprint) 的 finding 若不带 occurrence，构造即抛', () => {
    const base = {
      category: 'prose_contract', severity: 'major' as const, checker: 'prose_contract',
      files: ['paper/main.md'], artifactScope: ['paper/'], evidence: 'e', fingerprint: 'same', fixHint: 'h',
    }
    const a = makeFinding(base)
    const b = makeFinding(base)
    expect(a.id).toBe(b.id)
    // 静默撞车会让 resolve 反复命中同一条，重复项永远留在 open，终局被误判为
    // ESCALATE——排查成本极高，所以在入口就红。
    expect(() => new ClosureSession([a, b])).toThrow(/duplicate finding id/)
  })

  it('带 occurrence 的两条 finding 各有独立 id，各自可消解', () => {
    const base = {
      category: 'prose_contract', severity: 'major' as const, checker: 'prose_contract',
      files: ['paper/main.md'], artifactScope: ['paper/'], evidence: 'e', fingerprint: 'same', fixHint: 'h',
    }
    const a = makeFinding({ ...base, occurrence: 0 })
    const b = makeFinding({ ...base, occurrence: 1 })
    expect(a.id).not.toBe(b.id)
    const session = new ClosureSession([a, b])
    session.resolve(a.id, 'accepted', '第一条')
    session.resolve(b.id, 'accepted', '第二条')
    expect(session.close().outcome).toBe('MARKED')
  })
})

describe('L6 闭环 — 与真复验串联', () => {
  it('复验指纹未变时 finding 留在 open，终局 ESCALATE（不许沉默通过）', () => {
    const finding: Finding = makeFinding({
      category: 'prose_contract', severity: 'major', checker: 'prose_contract',
      files: ['paper/main.md'], artifactScope: ['paper/'],
      evidence: '问题分析偏短',
      fingerprint: initialFingerprint('prose_contract', input()),
      fixHint: '补写',
    })
    const session = new ClosureSession([finding])
    // 文字改了，但违规没消失 → 复验判"未修复"。
    const rewritten = { ...THIN_NARRATIVE, analysis: '问题1 用二项检验，理由如上所述。' }
    session.recheck(finding.id, recheckFinding('prose_contract', input({ narrative: rewritten })))
    expect(session.findings[0]?.state).toBe('open')
    expect(session.close().outcome).toBe('ESCALATE')
  })
})
