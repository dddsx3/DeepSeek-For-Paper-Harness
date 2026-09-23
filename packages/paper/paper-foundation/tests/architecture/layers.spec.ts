/**
 * 上限解放架构 — 各层不变量（L0 / L1 / L2 / L3 / L4 / L5）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/architecture/layers
 */

import { describe, expect, it } from 'vitest'
import { GateStateMachine, GATE_ACTIVATIONS } from '../../src/delivery/gate-state.ts'
import { gradeLadder, type LadderInput } from '../../src/delivery/delivery-ladder.ts'
import { assessCapability, defaultProfile, withNegativeFeedback, type ProbeObservation } from '../../src/probe/capability-profile.ts'
import { ExploreSelectDeepenSession, MIN_CANDIDATES_PER_PROBLEM } from '../../src/produce/explore-deepen.ts'
import { classifyEvidenceLevel, assertWordingMatchesLevel } from '../../src/verification/symbolic-channel.ts'
import { structHashOf, threeChannelVerdict, type ModelStructure } from '../../src/verification/semantic-fingerprint.ts'
import { adjudicateThreePersonaReview, REVIEW_PERSONAS } from '../../src/verification/adversarial-review.ts'
import { materializeSkillLibrary, SKILL_DOCS } from '../../src/knowledge/skill-library.ts'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('L6 门禁状态机 — DORMANT → WARN → ENFORCE', () => {
  it('DORMANT 起步时，首次违规只记录并注入**针对性**微教学，不拦截', () => {
    // A 档下 prose_contract 从 DORMANT 起步——这是"强模型不需要被教"的形态。
    const sm = new GateStateMachine('A')
    expect(sm.modeOf('prose_contract')).toBe('DORMANT')
    const first = sm.recordViolation('prose_contract')
    expect(first.mode).toBe('WARN')
    expect(first.enforcing).toBe(false)
    expect(first.microTeaching).toContain('writing-norms.md')
  })

  it('WARN 起步（弱模型）时，首次违规即收紧为硬拦截', () => {
    // B 档下同一个门禁直接从 WARN 起步——同一份代码，两种行为，由档位决定。
    const sm = new GateStateMachine('B')
    expect(sm.modeOf('prose_contract')).toBe('WARN')
    const first = sm.recordViolation('prose_contract')
    expect(first.mode).toBe('ENFORCE')
    expect(first.enforcing).toBe(true)
    // 没有"首次教学"这一步（它已经从更严的档位起步）。
    expect(first.microTeaching).toBeNull()
  })

  it('强模型（S 档）的绝大多数门禁停在 DORMANT——跑一程可能一个都没感知到', () => {
    const sm = new GateStateMachine('S')
    expect(sm.modeOf('prose_contract')).toBe('DORMANT')
    expect(sm.modeOf('container_shape')).toBe('DORMANT')
    expect(sm.isEnforcing('prose_contract')).toBe(false)
  })

  it('未登记的门禁默认 ENFORCE——登记表是白名单，不是黑名单', () => {
    // 一个忘了登记的门禁不该因为"忘了"而被静默放过。
    const sm = new GateStateMachine('S')
    expect(sm.modeOf('some_gate_nobody_registered')).toBe('ENFORCE')
  })

  it('运行内不衰减——"再试几次就过了"不是一条可行路径', () => {
    const sm = new GateStateMachine('S')
    expect(sm.modeOf('blank_area')).toBe('DORMANT')
    sm.recordViolation('blank_area')
    expect(sm.modeOf('blank_area')).toBe('WARN')
    sm.recordPass('blank_area')
    expect(sm.modeOf('blank_area')).toBe('WARN')
  })

  it('收紧记录可作为能力画像的负反馈', () => {
    const sm = new GateStateMachine('A')
    sm.recordViolation('numeric_consistency')
    expect(sm.tightenedGates()).toEqual(['numeric_consistency'])
    const fb = withNegativeFeedback('S', sm.tightenedGates())
    expect(fb.tier).toBe('A')
    expect(fb.note).toContain('负反馈')
  })

  it('每个登记的门禁都给出三档的初始模式', () => {
    for (const a of GATE_ACTIVATIONS) {
      for (const tier of ['S', 'A', 'B'] as const) {
        expect(['DORMANT', 'WARN', 'ENFORCE']).toContain(a.initial[tier])
      }
      // 档位越弱，起步越严（或持平）——方向性守卫。
      const rank = { DORMANT: 0, WARN: 1, ENFORCE: 2 } as const
      expect(rank[a.initial.B]).toBeGreaterThanOrEqual(rank[a.initial.S])
    }
  })
})

describe('L6 四档交付语义', () => {
  const base: LadderInput = {
    grade: 'CLEAN',
    annotations: [],
    fatal: { emptyContent: false, executionFailed: false, referenceCatastrophe: false },
    closure: null,
    deliveryPath: 'A-produce-chain',
    unverified: false,
    findings: [],
  }

  it('findings 空 → CLEAN', () => {
    expect(gradeLadder(base).tier).toBe('CLEAN')
  })

  it('无正文 → 唯一真正的硬拒绝（连未完成包都产不出）', () => {
    const d = gradeLadder({ ...base, fatal: { ...base.fatal, emptyContent: true } })
    expect(d.tier).toBe('ESCALATE')
    expect(d.hardRefused).toBe(true)
    expect(d.refusalReason).toContain('fatal content probe')
  })

  it('悬空引用（声称有数字支撑而实际没有）→ 硬拒绝', () => {
    const d = gradeLadder({
      ...base,
      fatal: { ...base.fatal, referenceCatastrophe: true },
      annotations: [{ kind: 'critical_gate', reason: 'missing IR backbone: Result', location: 'delivery' }],
    })
    expect(d.hardRefused).toBe(true)
    expect(d.refusalReason).toContain('cannot deliver')
    expect(d.refusalReason).toContain('missing IR backbone')
  })

  it('兜底路径产出 → DEGRADED（交付但注明未经规范核验）', () => {
    const d = gradeLadder({ ...base, deliveryPath: 'B-e1-direct' })
    expect(d.tier).toBe('DEGRADED')
    expect(d.hardRefused).toBe(false)
    expect(d.headline).toContain('未经规范核验')
  })

  it('无任何可执行证据 → DEGRADED（与"引用悬空"是两件事）', () => {
    const d = gradeLadder({ ...base, unverified: true })
    expect(d.tier).toBe('DEGRADED')
    expect(d.hardRefused).toBe(false)
  })

  it('闭环未收口 → ESCALATE，且**不**是硬拒绝（要交出未完成包）', () => {
    const d = gradeLadder({
      ...base,
      closure: { outcome: 'ESCALATE', findings: [], rechecks: [], roundsUsed: 2, unresolved: [], gapList: ['x'] },
    })
    expect(d.tier).toBe('ESCALATE')
    expect(d.hardRefused).toBe(false)
    expect(d.appendix).toContain('未完成包')
  })

  it('编造引用是唯一保留的 finding 级硬阻断', () => {
    const d = gradeLadder({
      ...base,
      findings: [{
        id: 'F-1', category: 'fabricated_reference', severity: 'fatal', checker: 'reference_validation',
        where: { files: ['paper/main.md'], artifactScope: ['paper/'] },
        evidence: '第 4 条参考文献 DOI 无法解析', fingerprint: 'fp', fixHint: '换一篇', state: 'open', attempts: 0,
      }],
    })
    expect(d.hardRefused).toBe(true)
    expect(d.refusalReason).toContain('学术不端')
  })

  it('有 finding 但全部已消解 → MARKED，且交付物带已知缺陷表', () => {
    const d = gradeLadder({
      ...base,
      findings: [{
        id: 'F-2', category: 'prose_contract', severity: 'major', checker: 'prose_contract',
        where: { files: ['paper/main.md'], artifactScope: ['paper/'] },
        evidence: '问题分析偏短', fingerprint: 'fp', fixHint: '补写', state: 'accepted', attempts: 1,
      }],
    })
    expect(d.tier).toBe('MARKED')
    expect(d.appendix).toContain('已知缺陷表')
  })
})

describe('L0 能力画像', () => {
  const obs = (symbolic: boolean, execution: boolean, structure: boolean): ReadonlyArray<ProbeObservation> => [
    { kind: 'symbolic', passed: symbolic, detail: '', elapsedMs: 1 },
    { kind: 'execution', passed: execution, detail: '', elapsedMs: 1 },
    { kind: 'structure', passed: structure, detail: '', elapsedMs: 1 },
  ]

  it('三探针全过 → S；结构过 + 一个别的过 → A；结构不过 → B', () => {
    expect(assessCapability(obs(true, true, true)).tier).toBe('S')
    expect(assessCapability(obs(true, false, true)).tier).toBe('A')
    expect(assessCapability(obs(false, false, true)).tier).toBe('B')
    expect(assessCapability(obs(true, true, false)).tier).toBe('B')
  })

  it('结构探针权重更高——它是硬依赖（容器不合规则零产物）', () => {
    const p = assessCapability(obs(true, true, false))
    expect(p.rationale).toContain('结构探针未通过')
    expect(p.teaching.preloadKnowledge).toBe(true)
  })

  it('无探针时默认 A（保守），不是 S', () => {
    const p = defaultProfile('测试')
    expect(p.tier).toBe('A')
    expect(p.teaching.preloadKnowledge).toBe(false)
  })
})

describe('L2 探索—择优—深挖', () => {
  const sketch = (id: string) => ({
    candidate_id: id, method: 'm', approach: 'a', requires: [], risk: 'r', expectedDepth: 'd',
  })

  it('少于 2 个草图 → 拒绝（没有比较这回事）', () => {
    const s = new ExploreSelectDeepenSession()
    expect(() => s.submitSketches('P1', [sketch('C1')])).toThrow(/at least 2/)
    expect(MIN_CANDIDATES_PER_PROBLEM).toBe(2)
  })

  it('择优必须给出理由，且落选者各带理由', () => {
    const s = new ExploreSelectDeepenSession()
    s.submitSketches('P1', [sketch('C1'), sketch('C2')])
    s.beginSelection()
    expect(() => s.recordSelection({
      problem_ref: 'P1', chosen: 'C1', reason: '短',
      scores: [
        { candidate_id: 'C1', correctnessRisk: 8, depthPotential: 7, dataFit: 8, timeFeasibility: 9 },
        { candidate_id: 'C2', correctnessRisk: 4, depthPotential: 9, dataFit: 5, timeFeasibility: 6 },
      ],
      rejected: [],
    })).toThrow()
  })

  it('没有打分的候选不能被选（选择必须由比较支撑）', () => {
    const s = new ExploreSelectDeepenSession()
    s.submitSketches('P1', [sketch('C1'), sketch('C2')])
    s.beginSelection()
    expect(() => s.recordSelection({
      problem_ref: 'P1', chosen: 'C3', reason: '看起来不错',
      scores: [{ candidate_id: 'C1', correctnessRisk: 8, depthPotential: 7, dataFit: 8, timeFeasibility: 9 }],
      rejected: [],
    })).toThrow(/no score/)
  })

  it('回溯必须带失败证据——"结果不好看"不是证据', () => {
    const s = new ExploreSelectDeepenSession()
    s.submitSketches('P1', [sketch('C1'), sketch('C2')])
    s.beginSelection()
    s.recordSelection({
      problem_ref: 'P1', chosen: 'C1', reason: '枚举能直接回答比较优劣',
      scores: [
        { candidate_id: 'C1', correctnessRisk: 8, depthPotential: 7, dataFit: 8, timeFeasibility: 9 },
        { candidate_id: 'C2', correctnessRisk: 4, depthPotential: 9, dataFit: 5, timeFeasibility: 6 },
      ],
      rejected: [{ candidate_id: 'C2', why: '数据不支持' }],
    })
    expect(() => s.backtrack({ from_candidate: 'C1', to_candidate: 'C2', failureEvidence: '不好看', reason: '换一个' })).toThrow(/real failure evidence/)
    s.backtrack({
      from_candidate: 'C1', to_candidate: 'C2',
      failureEvidence: '拆解件没有独立分组数据，期望递推无法闭合（缺 3 个参数）',
      reason: '改用分层估计',
    })
    expect(s.stage).toBe('select')
    // 落选方案留在存档里，可复活。
    expect(s.archive.map(a => a.candidate_id)).toEqual(['C1', 'C2'])
  })
})

describe('L3 符号证据通道', () => {
  it('按脚本**实际用了什么**判定证据级别，不按模型自称', () => {
    expect(classifyEvidenceLevel('from sympy import checkodesol\nassert checkodesol(ode, sol)[0]')).toBe('symbolic_proof')
    expect(classifyEvidenceLevel('assert all(f(x) <= b for x in range(1000))')).toBe('sampling_evidence')
    // 两者都有 → 取**较低**级别（保守）。
    expect(classifyEvidenceLevel('assert checkodesol(ode, sol)[0]\nassert all(g(x) for x in range(10))')).toBe('sampling_evidence')
  })

  it('抽样证据不得说成"证明"——机械检查，不是提示', () => {
    expect(assertWordingMatchesLevel('sampling_evidence', '由上式可证明该界恒成立')).toContain('抽样未见反例')
    expect(assertWordingMatchesLevel('sampling_evidence', '千点抽样未见反例')).toBeNull()
    expect(assertWordingMatchesLevel('symbolic_proof', '由上式可证明该界恒成立')).toBeNull()
  })
})

describe('L4 语义指纹与三通道复验', () => {
  const structure = (over: Partial<ModelStructure> = {}): ModelStructure => ({
    equations: [{ id: 'EQ-1', expression: 'dT/dt = -k (T - T_env)' }],
    assumptionIds: ['A-1', 'A-2'],
    method: 'F1-机理',
    parameters: { k: 0.1 },
    symbols: ['T', 'k'],
    ...over,
  })

  it('同一份模型必然得到同一个指纹（否则复验会把"没改"判成"改了"）', () => {
    expect(structHashOf(structure())).toBe(structHashOf(structure()))
    // 排序与排版差异不算改变。
    expect(structHashOf(structure({ assumptionIds: ['A-2', 'A-1'] }))).toBe(structHashOf(structure()))
    expect(structHashOf(structure({ equations: [{ id: 'EQ-1', expression: 'dT/dt=-k(T-T_env)' }] }))).toBe(structHashOf(structure()))
  })

  it('换方法 / 增删方程 / 调参数 → 指纹改变（这是语义类修复能被看见的前提）', () => {
    const base = structHashOf(structure())
    expect(structHashOf(structure({ method: 'F2-统计' }))).not.toBe(base)
    expect(structHashOf(structure({ equations: [] }))).not.toBe(base)
    expect(structHashOf(structure({ parameters: { k: 0.2 } }))).not.toBe(base)
  })

  it('三通道取或：任一显示实质变化即判定已修复', () => {
    const numeric = threeChannelVerdict({
      numericBefore: 'a', numericAfter: 'b', structBefore: 's', structAfter: 's',
      scoreBefore: 6, scoreAfter: 6, scoreThreshold: 7,
    })
    expect(numeric.repaired).toBe(true)
    expect(numeric.channels).toEqual(['numeric'])

    const semantic = threeChannelVerdict({
      numericBefore: 'a', numericAfter: 'a', structBefore: 's', structAfter: 't',
      scoreBefore: 6, scoreAfter: 6, scoreThreshold: 7,
    })
    expect(semantic.repaired).toBe(true)
    expect(semantic.channels).toEqual(['structure'])
  })

  it('"改文字迎合旧数字"三条通道全不动 → 判定未修复（这正是它该被抓住的地方）', () => {
    const v = threeChannelVerdict({
      numericBefore: 'a', numericAfter: 'a', structBefore: 's', structAfter: 's',
      scoreBefore: 6, scoreAfter: 6, scoreThreshold: 7,
    })
    expect(v.repaired).toBe(false)
    expect(v.detail).toContain('未修复')
    expect(v.detail).toContain('我改过了')
  })
})

describe('L5 三视角对抗评审', () => {
  it('三个 persona 各自独立裁决；引用悬空/span 伪造的条目被丢弃', () => {
    const out = adjudicateThreePersonaReview({
      findings: [
        { finding_id: 'R1', persona: 'mathematical-rigor', severity: 'major', span: '温度随时间线性上升', reason: '与方程不符', target_ref: 'EQ-1' },
        { finding_id: 'R2', persona: 'mathematical-rigor', severity: 'major', span: '一句论文里没有的话', reason: '幻觉', target_ref: 'EQ-1' },
        { finding_id: 'R3', persona: 'presentation', severity: 'minor', span: '温度随时间线性上升', reason: '段首以图作主语', target_ref: 'EQ-1' },
      ],
      paperText: '温度随时间线性上升（图 3）。',
      refResolves: ref => ref === 'EQ-1',
    })
    expect(REVIEW_PERSONAS).toHaveLength(3)
    // R2 的 span 不在交付文本里 → 丢弃，不进闭环。
    expect(out.findings.map(f => f.category)).not.toContain('review:mathematical-rigor'.replace('mathematical-rigor', 'application-relevance'))
    expect(out.discarded.map(d => d.id)).toContain('R2')
    expect(out.findings).toHaveLength(2)
    // 有视角零发现 → complete=false（该视角缺席，不能读作"无问题"）。
    expect(out.complete).toBe(false)
  })

  it('评审 finding 的 artifactScope 落在正文，因此分派表允许直接编辑', () => {
    const out = adjudicateThreePersonaReview({
      findings: [{ finding_id: 'P1', persona: 'presentation', severity: 'minor', span: '温度上升', reason: '机械段首' }],
      paperText: '温度上升',
      refResolves: () => true,
    })
    expect(out.findings[0]?.where.artifactScope).toEqual(['paper/'])
  })
})

describe('L1 知识外置 — 技能库落盘', () => {
  it('materializeSkillLibrary 把每份文档写到工作区，且可读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dph-skills-'))
    const written = materializeSkillLibrary(dir)
    expect(written).toHaveLength(SKILL_DOCS.length)
    for (const doc of SKILL_DOCS) {
      const path = join(dir, 'skills', `${doc.id}.md`)
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe(doc.body)
    }
  })

  it('幂等：重复落盘不改变任何字节', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dph-skills-'))
    materializeSkillLibrary(dir)
    const first = SKILL_DOCS.map(d => readFileSync(join(dir, 'skills', `${d.id}.md`), 'utf8'))
    materializeSkillLibrary(dir)
    const second = SKILL_DOCS.map(d => readFileSync(join(dir, 'skills', `${d.id}.md`), 'utf8'))
    expect(second).toEqual(first)
  })
})
