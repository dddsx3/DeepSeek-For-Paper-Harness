/**
 * 逐节点独立审计 —— 用户新增的架构约束的机械验收。
 *
 * 约束原话：不能让一个单独的模型长期跑下去、到后期才被一个固定阶段发现问题；
 * 关键节点（分析/建模/编程…）必须固定安排审计 AI，检查"这一轮是否按要求完成"，
 * 并提前做交付结构与质量初判，**低于阈值不允许交付**；阶段 8 仍做全量审计。
 *
 * 三条判据：① 阈值/fatal/结构任一不过即不放行；② 审计提示词**只有契约与产物**
 * （独立性）；③ 审计跑不成时记 `2`，绝不当通过。
 */

import { describe, expect, it } from 'vitest'
import { auditPromptOf, decideAudit, parseAuditVerdict, type AuditVerdict } from '../../src/stages/audit.ts'
import { skillTaskOf } from '../../src/stages/briefing.ts'
import { stageOf } from '../../src/stages/registry.ts'

const spec = stageOf('modeling')

function verdict(over: Partial<AuditVerdict> = {}): AuditVerdict {
  return {
    stage: 'modeling', verdict: 'pass', score: 0.85, structureOk: true,
    requirementCompliance: [{ item: '产出契约', done: true, note: '齐备' }],
    findings: [], missing: [], model: 'auditor-x', at: '2026-09-26T00:00:00.000Z',
    ...over,
  }
}

describe('审计判定 —— 低于阈值不允许交付', () => {
  it('干净通过 → 放行', () => {
    const d = decideAudit(verdict(), { minScore: 0.7 })
    expect(d.ok).toBe(true)
    expect(d.reason).toContain('审计通过')
  })

  it('**score < 阈值 → 不放行**（用户口径的直接落点）', () => {
    const d = decideAudit(verdict({ score: 0.62 }), { minScore: 0.7 })
    expect(d.ok).toBe(false)
    // 断言实际措辞（含两个数字），不凭记忆写期望值
    expect(d.reason).toContain('质量分 0.62')
    expect(d.reason).toContain('阈值 0.70')
  })

  it('**任一 fatal → 不放行**（即使分数很高）', () => {
    const d = decideAudit(verdict({
      score: 0.95,
      findings: [{ severity: 'fatal', where: 'MODELING_REPORT.md §6', issue: '公式与题面矛盾', fix: '回阶段 1 核对' }],
    }), { minScore: 0.7 })
    expect(d.ok).toBe(false)
    expect(d.reason).toContain('fatal')
  })

  it('**结构不完整或 missing 非空 → 不放行**', () => {
    expect(decideAudit(verdict({ structureOk: false }), { minScore: 0.7 }).ok).toBe(false)
    expect(decideAudit(verdict({ missing: ['DECLARATION.json 里没有 ModelSpec'] }), { minScore: 0.7 }).ok).toBe(false)
    expect(decideAudit(verdict({ missing: ['x'] }), { minScore: 0.7 }).reason).toContain('缺：')
  })

  it('**有要求没完成 → 不放行**（"看起来做了但其实没有"必须被挡住）', () => {
    const d = decideAudit(verdict({
      requirementCompliance: [
        { item: '逐问都有 ModelSpec', done: true, note: '4/4' },
        { item: '被否方案章节', done: false, note: '只有一句"未采用其他方法"' },
      ],
    }), { minScore: 0.7 })
    expect(d.ok).toBe(false)
    expect(d.reason).toContain('要求未完成')
    expect(d.reason).toContain('被否方案')
  })

  it('阈值可配（默认 0.7 由调用方给，模块不写死）', () => {
    expect(decideAudit(verdict({ score: 0.62 }), { minScore: 0.6 }).ok).toBe(true)
    expect(decideAudit(verdict({ score: 0.62 }), { minScore: 0.8 }).ok).toBe(false)
  })
})

describe('审计提示词 —— 独立性是机械可核的', () => {
  const prompt = auditPromptOf({
    spec,
    skillTask: skillTaskOf(spec),
    artifacts: new Map([['MODELING_REPORT.md', '# 建模报告\n\n（正文）']]),
    upstreamNames: ['PROBLEM_ANALYSIS.md', 'CAPABILITY_CHECKLIST.json', 'PROBLEM_FACTS.json'],
  })

  it('给出**契约**：任务陈述 + 产出清单 + 门禁 id + 上游有什么', () => {
    expect(prompt).toContain(skillTaskOf(spec).slice(0, 40))
    for (const p of spec.produces) expect(prompt).toContain(p.file)
    for (const g of spec.gates) expect(prompt).toContain(g)
    expect(prompt).toContain('PROBLEM_FACTS.json')
  })

  it('**不泄漏执行者的提示词结构**（只给契约与产物——否则就成了自己审自己）', () => {
    for (const leaked of ['提交前自检', '明确不要做', '完成标志', '本步知识（怎么做）']) {
      expect(prompt.includes(leaked), `审计提示词里出现了执行者简报的分节「${leaked}」`).toBe(false)
    }
  })

  it('产物超预算时**明说被截断**（不许因为"没看到"就判它缺内容）', () => {
    const big = auditPromptOf({
      spec, skillTask: skillTaskOf(spec),
      artifacts: new Map([['MODELING_REPORT.md', 'x'.repeat(500)]]),
      upstreamNames: [], budgetChars: 100,
    })
    expect(big).toContain('只内联前 100 字节')
    expect(big).toContain('被截断')
  })

  it('**没有任何产物** → 提示词直接点明这是 fatal', () => {
    const empty = auditPromptOf({ spec, skillTask: skillTaskOf(spec), artifacts: new Map(), upstreamNames: [] })
    expect(empty).toContain('没有任何产物')
    expect(empty).toContain('fatal')
  })
})

/**
 * 题面事实必须内联 —— 否则审计员看不见"与题面不符"这类缺陷。
 *
 * 真实失配（2024B 红队）：题面给了调换损失 `ce=40`，阶段 3 的代码从头到尾没用它，
 * 于是"什么都不检查"虚假胜出（利润 104 vs 真值 66.09）。这不是结构缺陷——机械门禁
 * 全绿——只有拿题面当尺子才量得出来。给文件名清单是不够的。
 */
describe('题面事实 —— 审计的尺子', () => {
  const withFacts = auditPromptOf({
    spec, skillTask: skillTaskOf(spec),
    artifacts: new Map([['MODELING_REPORT.md', '# 建模报告']]),
    upstreamNames: ['PROBLEM_FACTS.json'],
    groundTruth: new Map([
      ['题面原文 problem.txt', '调换损失 6 元/件，拆解费用 5 元/件'],
      ['给定值事实表 PROBLEM_FACTS.json', '{"facts":[{"id":"F-T1-C1","value":{"调换损失":6}}]}'],
    ]),
  })

  it('题面与给定值事实表**逐字内联**，并标明是判题面相符的唯一依据', () => {
    expect(withFacts).toContain('调换损失 6 元/件')
    expect(withFacts).toContain('F-T1-C1')
    expect(withFacts).toContain('唯一')
    expect(withFacts).toContain('不是**执行者的产物')
  })

  it('**点明这类缺陷**：题面给了却没被用到的参数是最危险的一类，且要写成 finding', () => {
    expect(withFacts).toContain('与题面相符')
    // 三种形态必须分清——「声明了却是死参数」是实测里真正发生的那一种：
    // problem3.py 里 `ce: 40.0` 写在参数表里，公式 Ep 却只用 ct/cd，ce 从未参与运算。
    // 只查"参数在不在"会给出假绿，所以判据必须落在"进没进公式"上。
    expect(withFacts).toContain('声明了却是死参数')
    expect(withFacts).toContain('从未进入任何公式')
    expect(withFacts).toContain('完全找不到')
    expect(withFacts).toContain('凭空多出来')
    // 实测形态（含具体数值）被写进提示词，审计员不必自己猜"死参数"长什么样
    expect(withFacts).toContain('ce')
    expect(withFacts).toContain('40.0')
    expect(withFacts).toContain('66.09')
  })

  it('**没有题面时不出现尺子那一段**（宁可不说，也不让审计员以为自己看到了尺子）', () => {
    const noFacts = auditPromptOf({
      spec, skillTask: skillTaskOf(spec),
      artifacts: new Map([['MODELING_REPORT.md', '# 建模报告']]),
      upstreamNames: [], groundTruth: new Map(),
    })
    // 判据是**那一段标题**，不是"题面事实"这四个字——第 2 条检查里本来就会提到它。
    expect(noFacts).not.toContain('### 题面事实')
    expect(noFacts).toContain('### 上游给了什么'.slice(0, 3)) // 提示词本身仍完整
  })

  it('题面超预算时**明说被截断**（与产物同一条纪律）', () => {
    const cut = auditPromptOf({
      spec, skillTask: skillTaskOf(spec),
      artifacts: new Map(), upstreamNames: [],
      groundTruth: new Map([['题面原文 problem.txt', 'y'.repeat(500)]]),
      budgetChars: 100,
    })
    expect(cut).toContain('只内联前 100 字节')
    expect(cut).toContain('被截断')
  })
})

describe('审计结论的严格解析 —— 坏回答记 2，不当通过', () => {
  it('合法回答 → 解析出完整结论', () => {
    const raw = '```json\n{"verdict":"fail","score":0.4,"structure_ok":true,'
      + '"requirement_compliance":[{"item":"a","done":false,"note":"缺"}],'
      + '"findings":[{"severity":"fatal","where":"§3","issue":"错","fix":"改"}],"missing":["b"]}\n```'
    const v = parseAuditVerdict(raw, spec, 'auditor-x', 'T')
    expect(v.verdict).toBe('fail')
    expect(v.score).toBe(0.4)
    expect(v.findings[0]?.severity).toBe('fatal')
    expect(v.missing).toEqual(['b'])
    expect(v.model).toBe('auditor-x')
  })

  it('**缺 score / verdict 非法 / 没有 JSON → 抛错**（调用方据此记 `2`，不当作通过）', () => {
    expect(() => parseAuditVerdict('审计通过，没有问题。', spec, 'm', 'T')).toThrow(/没有 JSON/)
    expect(() => parseAuditVerdict('{"verdict":"pass"}', spec, 'm', 'T')).toThrow(/score/)
    expect(() => parseAuditVerdict('{"verdict":"maybe","score":0.9}', spec, 'm', 'T')).toThrow(/verdict/)
  })

  it('severity 越界时降级为 minor（不让"乱填严重度"卡住或放行）', () => {
    const v = parseAuditVerdict('{"verdict":"pass","score":0.9,"findings":[{"severity":"BIG","where":"w","issue":"i","fix":"f"}]}', spec, 'm', 'T')
    expect(v.findings[0]?.severity).toBe('minor')
  })
})

/**
 * 审计员必须**审编外登记簿**：它是"换一种记账"，也是最可能被滥用的地方
 * （把计算结果伪装成示意数就能绕过零数字通道）。
 */
describe('审计提示词 —— 编外登记簿要审', () => {
  const prompt = auditPromptOf({
    spec: stageOf('modeling'),
    skillTask: skillTaskOf(stageOf('modeling')),
    artifacts: new Map([['DECLARATION.json', '{}']]),
    upstreamNames: ['PROBLEM_FACTS.json'],
    groundTruth: new Map([['给定值事实表 PROBLEM_FACTS.json', '{}']]),
  })

  it('要求逐条核 `quote` 与 `reason`，并点名"结果伪装成示意"= fatal', () => {
    expect(prompt).toContain('编外登记簿要审')
    expect(prompt).toContain('illustrative_numbers')
    expect(prompt).toContain('把计算结果塞进编外来绕过零数字通道')
    expect(prompt).toContain('结果伪装成示意')
  })

  it('**反过来也要说清**：登记齐备的示意数不该被判成错', () => {
    expect(prompt).toContain('真的示意数不该被判成错')
  })
})

/**
 * **`done` 的极性** —— 一条"负面检查"被写成条目，会随机拦掉整个阶段。
 *
 * 实测（2024B 阶段 5 第二次运行）：门禁 5 条全过、审计给 pass/0.82，
 * 却因为 `requirement_compliance` 里有 `{"item":"与上游冲突/自相矛盾","done":false}`
 * 被判"1 项要求未完成"而**拒绝签发通行证**。而该条的 `note` 写的是
 * "**未发现**与 results.json / PROBLEM_ANALYSIS.md 口径冲突的声明"——
 * 这项检查其实是**干净的**，是审计员把提示词第 3 条那句"有无自相矛盾或与上游冲突？"
 * 当成了要求条目，而问句的 `done` 没有定义。代价：整个阶段重跑（十几次模型调用）。
 *
 * 修法两条：① 契约里把 `done` 的含义与"负面检查要改写成正面句"写死；
 * ② 拦截信息带上 `note`，让这种自相矛盾一眼可见（而不是只报"1 项未完成"）。
 */
describe('审计的 `done` 极性（负面检查不许当要求条目）', () => {
  const spec = stageOf('figure-declare')
  const prompt = auditPromptOf({ spec, skillTask: skillTaskOf(spec), artifacts: new Map([['FIGURE_PLAN.json', '{}']]), upstreamNames: [] })

  it('提示词写死 `done` 只有一个含义', () => {
    expect(prompt).toContain('`done` 只有一个含义')
    expect(prompt).toContain('当且仅当**这条要求被满足了**')
  })

  it('提示词点名那个真实反例，并要求改写成正面句', () => {
    expect(prompt).toContain('不要把"是否存在某类问题"的问句写成条目')
    expect(prompt).toContain('与上游冲突/自相矛盾')
    expect(prompt).toContain('产物与上游口径一致（已逐项核对）')
  })

  it('拿不准时引导到 `findings`，而不是硬拦', () => {
    expect(prompt).toContain('宁可放进 `findings`')
    expect(prompt).toContain('只留给"契约明写了、执行者确实没做"的情形')
  })

  it('第 3 条明说是"找问题的问句"，不是一条要求', () => {
    expect(prompt).toContain('不是一条要求')
  })

  it('拦截信息带上依据（极性矛盾一眼可见）', () => {
    const verdict: AuditVerdict = {
      stage: 'figure-declare', verdict: 'pass', score: 0.82, structureOk: true,
      requirementCompliance: [
        { item: '与上游冲突/自相矛盾', done: false, note: '未发现与 results.json 口径冲突的声明' },
      ],
      findings: [], missing: [], model: 'glm-5.3-flash-free', at: '2026-09-27T00:00:00.000Z',
    }
    const decision = decideAudit(verdict, { minScore: 0.7 })
    expect(decision.ok).toBe(false)
    // 只报条目名时看不出问题；带上 note 就能判定"这是记账口径问题，不是产物缺陷"
    expect(decision.reason).toContain('未发现与 results.json 口径冲突')
  })
})
