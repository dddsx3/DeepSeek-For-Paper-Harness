/**
 * L2/L3 — 两个"结构约束"与"脚本通道"的机械判据。
 *
 * 两者都是**检出**而非拒绝：探索的完整性缺陷进 L6 门禁状态机（首次违规注入微教学），
 * 断言脚本的失败落 `unverifiable`（与未通过同级）。把它们做成硬门只会制造新的
 * 零产物来源——而那正是本次改造要消灭的形态。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/architecture/explore-and-claims
 */

import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reviewDecisionRecord } from '../../src/produce/explore-deepen.ts'
import {
  assertWordingMatchesLevel,
  classifyEvidenceLevel,
  renderSymbolicEvidence,
  runSymbolicChannel,
} from '../../src/verification/symbolic-channel.ts'

describe('L2 择优记录的机械检查', () => {
  // 候选必须**逐行引入**——判据是"候选在哪里被摆出来"，不是"标签出现几次"。
  const good = [
    '## P1',
    '候选 C1：回归拟合。',
    '候选 C2：插值。',
    '候选 C3：克里金。',
    '选定 C1 —— 它直接回答"平均厚度是多少"，且误差模型可复算。',
    '落选 C2：没有误差模型，无法给不确定度。',
    '落选 C3：需要变差函数，题面数据量不够。',
  ].join(String.fromCharCode(10))

  it('合格的记录零缺陷', () => {
    expect(reviewDecisionRecord(good, ['P1'])).toEqual([])
  })

  it('只有一个候选 → major（没有比较就没有择优）', () => {
    const findings = reviewDecisionRecord('## P1\n候选 C1：回归。选定 C1。', ['P1'])
    expect(findings.map(f => f.id)).toContain('EX-1')
    expect(findings.find(f => f.id === 'EX-1')?.description).toContain('没有比较就没有择优')
  })

  it('没有选择标记 → major（读者不知道最终用了哪个）', () => {
    const findings = reviewDecisionRecord('候选 C1 与 C2 都可行。', ['P1'])
    expect(findings.map(f => f.id)).toContain('EX-2')
  })

  it('有多个候选但没有落选理由 → minor', () => {
    const text = ['候选 C1：回归。', '候选 C2：插值。', '选定 C1。'].join(String.fromCharCode(10))
    expect(reviewDecisionRecord(text, ['P1']).map(f => f.id)).toContain('EX-3')
  })

  it('落选理由过短 → minor（"C1 更好"不算理由）', () => {
    const findings = reviewDecisionRecord('候选 C1 与 C2。选定 C1。落选 C2：好', ['P1'])
    expect(findings.map(f => f.id)).toContain('EX-4')
  })

  it('多子问题时缺一个子问题 → minor，且点名缺谁', () => {
    const findings = reviewDecisionRecord(good, ['P1', 'P2'])
    const ex5 = findings.find(f => f.id === 'EX-5')
    expect(ex5).toBeDefined()
    expect(ex5?.description).toContain('P2')
  })

  it('空记录 → major（这一段什么都没产出）', () => {
    const findings = reviewDecisionRecord('   ', ['P1'])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.id).toBe('EX-0')
  })

  it('**真实验测的形态**：`方案一 / 方案二 / 采用 / 未采纳` 必须零缺陷', () => {
    // 一次真实运行（2024B / strict / deepseek-v4-pro）实测：模型写的是"方案一/方案二"，
    // 而第一版判据只认 `C1`，于是报了"0 个候选"——**误报**。误报会往模型下一轮的
    // prompt 里塞一条毫无用处的微教学，所以这个形态必须被钉住。
    const real = [
      '## P1',
      '方案一：单次抽样验收，枚举 n 与 c。',
      '方案二：序贯概率比检验（SPRT）。',
      '采用方案一 —— 参数需求最少（仅 p0, α, β），且"检测次数尽可能少"是确定性的。',
      '未采纳方案二：检测次数是随机变量，且需额外设定 p1。',
    ].join(String.fromCharCode(10))
    expect(reviewDecisionRecord(real, [])).toEqual([])
  })

  it('中文序号候选（`候选一`/`候选二`）同样零缺陷', () => {
    const text = ['候选一：回归。', '候选二：插值。', '选定 候选一。', '落选 候选二：无误差模型。'].join(String.fromCharCode(10))
    expect(reviewDecisionRecord(text, [])).toEqual([])
  })

  it('负对照仍在：只有一个方案 → EX-1（放宽命名不等于放宽判据）', () => {
    expect(reviewDecisionRecord('选定 方案一，它更好。', []).map(f => f.id)).toContain('EX-1')
  })

  it('候选命名宽松：`候选1` / `candidate 2` / `C-3` 都算', () => {
    const text = [
      '候选1：A 方案。',
      'candidate 2：B 方案。',
      'C-3：C 方案。',
      '选定 候选1。',
      '落选 candidate 2：数据不支持。',
      '落选 C-3：时间不够。',
    ].join(String.fromCharCode(10))
    expect(reviewDecisionRecord(text, ['P1']).map(f => f.id)).not.toContain('EX-1')
  })

  it('**同一个候选的不同写法不算两个**（否则负对照会静默通过）', () => {
    // `候选 C1` 与后文引用的 `C1` 是同一个方案。若按"标签出现次数"计，这条会被
    // 算成 2 个候选 → 负对照通过 → 机制被绕过而没人知道（比误报更糟）。
    const text = ['候选 C1：回归。', '选定 C1。'].join(String.fromCharCode(10))
    expect(reviewDecisionRecord(text, ['P1']).map(f => f.id)).toContain('EX-1')
  })

  it('候选在**行首**引入才算；行内引用不算', () => {
    expect(reviewDecisionRecord('本方案用 方案一，不用 方案二。', ['P1']).map(f => f.id)).toContain('EX-1')
  })
})

describe('L3 断言脚本通道（离线可复核）', () => {
  function workspace(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'dph-claims-'))
    mkdirSync(join(dir, 'claims'), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, 'claims', name), body, 'utf8')
    return dir
  }

  it('代数确证的脚本被标为 symbolic_proof 并通过', () => {
    const dir = workspace({
      'q1.py': 'from sympy import symbols, simplify\nx = symbols("x")\nassert simplify((x + 1) - x - 1) == 0\n',
    })
    const result = runSymbolicChannel(dir, [{ claim_id: 'q1', script: 'claims/q1.py', statement: '恒等式' }])
    expect(result.claims[0]?.level).toBe('symbolic_proof')
    expect(result.claims[0]?.passed).toBe(true)
    expect(result.unverifiable).toHaveLength(0)
  })

  it('抽样脚本被标为 sampling_evidence（**不是**证明）', () => {
    const dir = workspace({ 'q2.py': 'assert all(x * x >= 0 for x in range(1000))\n' })
    const result = runSymbolicChannel(dir, [{ claim_id: 'q2', script: 'claims/q2.py', statement: '非负' }])
    expect(result.claims[0]?.level).toBe('sampling_evidence')
    expect(result.claims[0]?.detail).toContain('不是证明')
  })

  it('脚本失败 → 落 unverifiable，且 detail 带真实 stderr（不是"看起来不对"）', () => {
    const dir = workspace({ 'bad.py': 'raise AssertionError("bound violated")\n' })
    const result = runSymbolicChannel(dir, [{ claim_id: 'bad', script: 'claims/bad.py', statement: '界' }])
    expect(result.claims[0]?.passed).toBe(false)
    expect(result.claims[0]?.detail).toContain('断言失败')
    expect(result.unverifiable).toHaveLength(1)
  })

  it('**脚本不存在 → 未执行，按未通过处理**（C3）', () => {
    const dir = workspace({})
    const result = runSymbolicChannel(dir, [{ claim_id: 'ghost', script: 'claims/ghost.py', statement: 'x' }])
    expect(result.claims[0]?.passed).toBe(false)
    expect(result.claims[0]?.detail).toContain('不存在')
    expect(result.claims[0]?.detail).toContain('未执行按未通过处理')
  })

  it('证据级别由**脚本实际用了什么**判定，不由自称判定', () => {
    expect(classifyEvidenceLevel('assert checkodesol(ode, sol)[0]')).toBe('symbolic_proof')
    expect(classifyEvidenceLevel('assert all(f(x) for x in range(10))')).toBe('sampling_evidence')
    // 两者都有 → 取较低级别（保守）。
    expect(classifyEvidenceLevel('assert checkodesol(o, s)[0]\nassert all(f(x) for x in range(9))')).toBe('sampling_evidence')
  })

  it('三档级别各自的措辞纪律：只有代数确证可以说"证明"', () => {
    expect(assertWordingMatchesLevel('symbolic_proof', '可以证明该式恒成立')).toBeNull()
    expect(assertWordingMatchesLevel('sampling_evidence', '可以证明该式恒成立')).toContain('抽样未见反例')
    expect(assertWordingMatchesLevel('structural_check', '可以证明该式恒成立')).toContain('形式一致')
  })

  it('证据登记表把级别写成中文并带上诚实边界说明', () => {
    const dir = workspace({ 'q2.py': 'assert all(x >= 0 for x in range(10))\n' })
    const result = runSymbolicChannel(dir, [{ claim_id: 'q2', script: 'claims/q2.py', statement: '非负' }])
    const table = renderSymbolicEvidence(result.claims)
    expect(table).toContain('符号证据登记')
    expect(table).toContain('抽样证据')
    expect(table).toContain('不等同于证明')
  })
})
