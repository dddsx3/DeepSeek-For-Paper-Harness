/**
 * L6 — 闭环层的不变量（C1 / C2 / C3 + 分派表 + ESCALATE 语义）。
 *
 * 这一层是本次架构改造**唯一真正新增**的东西，也是两侧都缺的那一半：
 * 一边是"检测到但无消费方"，另一边是"findings 一律 BLOCKED → 零产物"。
 * 因此它的不变量必须有机械落点，不能只写在设计文档里。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/architecture/closure
 */

import { describe, expect, it } from 'vitest'
import { ClosureSession, DEFAULT_CLOSURE_BUDGET, renderEscalationPackage } from '../../src/delivery/closure.ts'
import { dispatchOf, makeFinding, renderKnownDefectsTable, type Finding } from '../../src/delivery/finding.ts'

function finding(overrides: Partial<Parameters<typeof makeFinding>[0]> = {}): Finding {
  return makeFinding({
    category: 'prose_contract',
    severity: 'major',
    checker: 'prose_contract',
    files: ['paper/main.md'],
    artifactScope: ['paper/'],
    evidence: '问题分析章节低于退回线',
    fingerprint: 'fp-1',
    fixHint: '补写该章',
    ...overrides,
  })
}

describe('L6 闭环 — C1：复验比对指纹，不接受"我改过了"', () => {
  it('指纹未变 → 不算修复，finding 留在 open', () => {
    const session = new ClosureSession([finding()])
    const record = session.recheck(session.findings[0]!.id, { kind: 'fingerprint', value: 'fp-1' })
    expect(record.changed).toBe(false)
    expect(session.findings[0]?.state).toBe('open')
    expect(session.close().outcome).toBe('ESCALATE')
  })

  it('指纹变化 → 判定已修复', () => {
    const session = new ClosureSession([finding()])
    session.recheck(session.findings[0]!.id, { kind: 'fingerprint', value: 'fp-2' })
    expect(session.findings[0]?.state).toBe('fixed')
    expect(session.close().outcome).toBe('MARKED')
  })

  it('复验记录带上"改变/未改变"的证据，便于独立复核', () => {
    const session = new ClosureSession([finding()])
    const record = session.recheck(session.findings[0]!.id, { kind: 'fingerprint', value: 'fp-9' })
    expect(record).toMatchObject({ before: 'fp-1', after: 'fp-9', changed: true, checkerFailed: false })
  })
})

describe('L6 闭环 — C2：预算耗尽的语义是 ESCALATE，不是 CLEAN', () => {
  it('还有 open 的 finding 时，终局一定是 ESCALATE', () => {
    const session = new ClosureSession([finding(), finding({ fingerprint: 'fp-2' })])
    session.beginRound()
    session.beginRound()
    expect(session.budgetExhausted()).toBe(true)
    const report = session.close()
    expect(report.outcome).toBe('ESCALATE')
    expect(report.unresolved).toHaveLength(2)
    // 预算耗尽**不能**变成"没检出问题"。
    expect(report.outcome).not.toBe('CLEAN')
  })

  it('ESCALATE 产出缺口清单（未完成包），不是空手而归', () => {
    const session = new ClosureSession([finding()])
    const report = session.close()
    const pkg = renderEscalationPackage(report)
    expect(pkg).toContain('未完成包')
    expect(pkg).toContain('缺口清单')
    // 缺口清单必须给出"谁该修"与"证据"——否则人工接管无从下手。
    expect(pkg).toContain('建议分派')
    expect(pkg).toContain('问题分析章节低于退回线')
  })

  it('零 finding → CLEAN；全部消解 → MARKED', () => {
    expect(new ClosureSession([]).close().outcome).toBe('CLEAN')
    const session = new ClosureSession([finding()])
    session.resolve(session.findings[0]!.id, 'accepted', '本轮不修，如实披露')
    expect(session.close().outcome).toBe('MARKED')
  })
})

describe('L6 闭环 — C3：checker 未执行与未通过同级', () => {
  it('checker 跑不起来 → unverifiable（不是"通过"，也不是中性）', () => {
    const session = new ClosureSession([finding()])
    const record = session.recheck(session.findings[0]!.id, { kind: 'checker_failed', reason: 'python 缺失' })
    expect(record.checkerFailed).toBe(true)
    expect(session.findings[0]?.state).toBe('unverifiable')
    // unverifiable 是**终态**（允许交付），但它出现在已知缺陷表里——
    // "未执行"不会伪装成"绿"。
    const report = session.close()
    expect(report.outcome).toBe('MARKED')
    expect(renderKnownDefectsTable(report.findings)).toContain('无法复验')
  })
})

describe('L6 闭环 — 分派表：对抗成本不对称', () => {
  it('代码类 finding 分派给"重跑"，并明示禁止改写论文数字', () => {
    const d = dispatchOf(['code/problem1.py'])
    expect(d.matched).toBe(true)
    expect(d.assignee).toContain('重跑')
    expect(d.forbidden).toContain('禁止改写论文里的数字')
  })

  it('结果/图表类 finding 禁止文本编辑，只能重跑产出脚本', () => {
    expect(dispatchOf(['results/out.json']).forbidden).toContain('禁止文本编辑')
    expect(dispatchOf(['figures/fig1.svg']).forbidden).toContain('禁止改数据源')
  })

  it('正文类 finding 允许直接编辑（这是唯一允许改文字的地方）', () => {
    const d = dispatchOf(['paper/main.md'])
    expect(d.matched).toBe(true)
    expect(d.forbidden).toBe('')
  })

  it('无法分派的 finding 不会静默留在 open——它必须进消解', () => {
    const d = dispatchOf(['some/unknown/path'])
    expect(d.matched).toBe(false)
    expect(d.assignee).toContain('未分派')
  })
})

describe('L6 闭环 — 防震荡与预算', () => {
  it('单条 finding 的尝试次数受上限约束', () => {
    const session = new ClosureSession([finding()], { maxRounds: 3, maxAttemptsPerFinding: 2 })
    const id = session.findings[0]!.id
    expect(session.recordAttempt(id)).toBe(true)   // 1 次
    expect(session.recordAttempt(id)).toBe(false)  // 到达上限
    expect(session.findings[0]?.attempts).toBe(2)
  })

  it('默认预算是 2 轮 / 每条 2 次（设计选择，非测量结论）', () => {
    expect(DEFAULT_CLOSURE_BUDGET).toEqual({ maxRounds: 2, maxAttemptsPerFinding: 2 })
  })
})

describe('finding 契约 — 每个字段都有下游消费者', () => {
  it('id 由 checker + category + fingerprint 派生，因此同一个问题有同一个 id', () => {
    const a = finding({ fingerprint: 'same' })
    const b = finding({ fingerprint: 'same' })
    const c = finding({ fingerprint: 'different' })
    expect(a.id).toBe(b.id)
    expect(a.id).not.toBe(c.id)
  })

  it('已知缺陷表把"检测到但没修"变成对用户可见', () => {
    const accepted = finding({ fingerprint: 'x' })
    const table = renderKnownDefectsTable([{ ...accepted, state: 'accepted', evidence: '已接受：本轮不修' }])
    expect(table).toContain('已知缺陷表')
    expect(table).toContain('已接受（如实披露）')
    expect(table).toContain('本轮不修')
  })

  it('全部已修时，表里不出现"未修复"项', () => {
    const fixed = finding({ fingerprint: 'y' })
    const table = renderKnownDefectsTable([{ ...fixed, state: 'fixed' }])
    expect(table).toContain('0 项未修复')
  })
})
