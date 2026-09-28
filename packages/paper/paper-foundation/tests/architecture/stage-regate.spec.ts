/**
 * **复评（`--stage-regate`）** —— 判据修好了、产物没变时，不该再付一次产出的钱。
 *
 * 为什么要有这个能力（两次真实代价，都是我的判据有 bug、产物却全部合格）：
 * ① 阶段 5 的 `figure_script_traced` 把 `contourf(levels=[-0.5, 0.5, 1.5])` 判成
 *    "成串的硬编码数据"，一份合规脚本被拦；
 * ② 审计把提示词里"有无自相矛盾或与上游冲突？"这句**问话**写成了要求条目
 *    （`done:false`），而它的 `note` 写的是"未发现冲突"——检查其实干净。
 * 两次都各花掉一次完整重跑（十几次模型调用、十几分钟），而产物一字未动。
 *
 * 这个文件钉住两件事，缺一不可：
 * - **真的不调模型**（复评的意义所在）；
 * - **不静默放行**（复评只跳过"重新产出"，门禁与审计照跑——产物不在就如实失败，
 *   否则复评就成了绕过执行的暗道）。
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { passportFor, readPassport } from '../../src/stages/handoff.ts'
import { priorReviewFindings, priorRuntimeFindings, runStages, type StageRunContext } from '../../src/stages/runner.ts'
import { stageOf } from '../../src/stages/registry.ts'
import { stageBriefing } from '../../src/stages/briefing.ts'

/** 造一个最小 ctx：`callModel` 记调用次数（复评时它必须一直是 0）。 */
function ctxOf(stagesRoot: string, calls: { n: number }): StageRunContext {
  return {
    stagesRoot,
    callModel: async () => {
      calls.n += 1
      return '{"files":{}}'
    },
    skillVersionOf: () => 'v1',
    gateVersionOf: () => 'v1',
  }
}

/** 铺出阶段 1 的输入（`stageReady` 要求上游存在）。 */
async function seedInput(root: string): Promise<void> {
  const input = join(root, '00-input')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'problem.txt'), '问题 1：求最小样本量。\n', 'utf8')
}

describe('复评 —— 不重跑模型，但也不放行', () => {
  it('**复评不调模型**（产物不在就如实失败，不是静默通过）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regate-'))
    await seedInput(root)
    const calls = { n: 0 }
    const outcomes = await runStages(ctxOf(root, calls), {
      only: ['prob-analysis'],
      problemCount: 1,
      regate: { reason: '判据已修正' },
    })
    expect(calls.n, '复评**不得**调用模型').toBe(0)
    // 产物不在 → 必须失败。复评跳过的是"产出"，不是"判"。
    expect(outcomes[0]?.status).toBe('gate-failed')
    expect(outcomes[0]?.gate.items.some(i => i.id === 'stage_deliverable_missing')).toBe(true)
  })

  it('**不复评时会调模型**（对照：证明上一条不是因为链路本来就断）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regate-'))
    await seedInput(root)
    const calls = { n: 0 }
    await runStages(ctxOf(root, calls), { only: ['prob-analysis'], problemCount: 1 })
    expect(calls.n, '正常路径必须调用模型').toBeGreaterThan(0)
  })

  it('复评签发的通行证**留痕**（`regate.reason` 进证——检查人看得出产物没重生成）', async () => {
    const spec = stageOf('prob-analysis')
    const passport = passportFor(spec, {
      upstreamDigests: [],
      skillVersion: 'v1',
      gateVersion: 'v1',
      artifacts: { 'PROBLEM_ANALYSIS.md': 'abc' },
      gate: { code: 0, items: [] },
      regate: { reason: '门禁误判已修正，产物未变' },
      now: '2026-09-27T00:00:00.000Z',
    })
    expect(passport.status).toBe('passed')
    expect(passport.regate?.reason).toContain('门禁误判已修正')
  })

  it('不复评时通行证上**没有** `regate`（两个轴不许混）', async () => {
    const passport = passportFor(stageOf('prob-analysis'), {
      upstreamDigests: [], skillVersion: 'v1', gateVersion: 'v1',
      artifacts: {}, gate: { code: 0, items: [] },
    })
    expect(passport.regate).toBeUndefined()
  })

  it('通行证能读回来（留痕不是只写在内存里）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-regate-'))
    await seedInput(root)
    const spec = stageOf('prob-analysis')
    const dir = join(root, '01-prob-analysis')
    await mkdir(dir, { recursive: true })
    const { writePassport } = await import('../../src/stages/handoff.ts')
    await writePassport(root, passportFor(spec, {
      upstreamDigests: [], skillVersion: 'v1', gateVersion: 'v1',
      artifacts: {}, gate: { code: 0, items: [] },
      regate: { reason: '复评留痕测试' },
    }))
    const back = await readPassport(root, spec)
    expect(back?.regate?.reason).toBe('复评留痕测试')
  })
})

/**
 * **复核的结论必须回灌到被回滚的阶段** —— 重启前检查发现的缺口。
 *
 * 事故背景：阶段 8 复核报出 4 条致命（全在建模/编程），判定 `ROLLBACK`，
 * `rollback_target: ['02-modeling', '03-code']`。但 runner 原有的两路回灌
 * （`priorGateFindings` / `priorAuditFindings`）**只读本阶段自己的报告**——
 * 而这两个阶段当时自身门禁与审计**都是通过的**，所以它们的 `prior` 是空的。
 * 后果：按复核要求回滚之后，**被回滚的阶段拿不到"你为何被回滚"**，只能盲重跑，
 * 几乎必然重犯同一批缺陷。整次回滚白做。
 *
 * 判据取自复核自己写的归属：每条 finding 都带 `owner_stage`
 * （`02-modeling` / `02-modeling/03-code`），按本阶段 id 子串匹配即可分发。
 */
describe('复核结论回灌 —— 回滚不能是盲跑', () => {
  const verdict = (findings: ReadonlyArray<Record<string, unknown>>): string =>
    JSON.stringify({ findings, fatal_count: findings.length })

  async function seedVerdict(findings: ReadonlyArray<Record<string, unknown>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-prior-review-'))
    const dir = join(root, '08-review')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'COMP_REVIEW_VERDICT.json'), verdict(findings), 'utf8')
    return root
  }

  const f001 = {
    id: 'F-001', category: 'task_misread', severity: 'fatal', owner_stage: '02-modeling',
    where: 'MODELING_REPORT.md §1.1', evidence: '题面没给 Δ、β', impact: '问题 1 不可复算',
    fix: '登记并论证 Δ、β', acceptance_test: '正文直接给出 Δ、β、n、c',
  }
  const f002 = {
    id: 'F-002', category: 'cross_problem', severity: 'fatal', owner_stage: '02-modeling/03-code',
    where: 'EQ-Q3-UNITCOST', evidence: 'Z_v=0 时 U_v=K_f 漏除以 q_v', impact: '成本与决策可能全错',
    fix: 'U_v 除以 q_v', acceptance_test: 'A_v=8、q_v=0.9 时 U_v=(8+B)/0.9',
  }

  it('按 `owner_stage` 分发：建模阶段拿到 F-001 与 F-002，编程阶段拿到 F-002', async () => {
    const root = await seedVerdict([f001, f002])
    const modeling = await priorReviewFindings(root, stageOf('modeling'))
    const code = await priorReviewFindings(root, stageOf('code'))
    expect(modeling.map(f => f.where)).toEqual([
      expect.stringContaining('F-001'), expect.stringContaining('F-002'),
    ])
    expect(code).toHaveLength(1)
    expect(code[0]?.where).toContain('F-002')
    // 致命级必须原样保留（回滚的理由就是它们）
    expect(modeling.every(f => f.severity === 'fatal')).toBe(true)
  })

  it('**真的进得了简报**（这是"不盲跑"的落点）', async () => {
    const root = await seedVerdict([f001])
    const prior = await priorReviewFindings(root, stageOf('modeling'))
    const brief = stageBriefing(stageOf('modeling'), new Map(), false, prior)
    expect(brief).toContain('F-001')
    expect(brief).toContain('题面没给 Δ、β')
    expect(brief).toContain('登记并论证 Δ、β')
    expect(brief).toContain('验收判据') // acceptance_test 也要带上，否则改没改到位无法判
  })

  it('归属不含本阶段的 findings **不分发**（不制造噪声）', async () => {
    const root = await seedVerdict([f001])
    expect(await priorReviewFindings(root, stageOf('paper'))).toEqual([])
  })

  it('复核没跑过 / 格式坏了 → 空数组，**不因此阻断**', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-prior-review-'))
    expect(await priorReviewFindings(root, stageOf('modeling'))).toEqual([])
    const bad = await seedVerdict([])
    await writeFile(join(bad, '08-review', 'COMP_REVIEW_VERDICT.json'), '{ 坏 JSON', 'utf8')
    expect(await priorReviewFindings(bad, stageOf('modeling'))).toEqual([])
  })
})

/**
 * **运行时失败必须回到写代码的那个阶段** —— 实测代价 9 次空转、半个多小时。
 *
 * 事故：阶段 3 的代码里一个变量名拼写错（`at_palt` vs 它自己定义的 `at_p_alt`），
 * 于是阶段 4 真跑 `code/main.py` 时报 `NameError`。但那条错误记在**阶段 4** 的报告里，
 * 而 `--stage-next` 只会重跑**阶段 4**——拿同一份坏代码再跑一遍。**连撞 9 次**，
 * 每次一次模型调用 + 一次代码执行，而那条栈从来没到过该看它的阶段。
 *
 * 与"复核结论回灌"（`priorReviewFindings`）同类：**下游发现的错误必须能回到该负责的上游**，
 * 否则重试就是空转。
 */
describe('运行时失败回灌 —— 拼写错误不该让下游空转 9 次', () => {
  const traceback = 'Traceback (most recent call last):\n'
    + '  File "code/problem1.py", line 88, in main\n'
    + '    at_palt["stop_at_limit_probability"],\n'
    + 'NameError: name \'at_palt\' is not defined. Did you mean: \'at_p_alt\'?'

  async function seed(trace: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-'))
    const dir = join(root, '03-code')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, '_runtime-failure.txt'), trace, 'utf8')
    return root
  }

  it('阶段 3 拿到完整的栈（含文件与行号）', async () => {
    const root = await seed(traceback)
    const prior = await priorRuntimeFindings(root, stageOf('code'))
    expect(prior).toHaveLength(1)
    expect(prior[0]?.severity).toBe('fatal')
    expect(prior[0]?.issue).toContain('NameError')
    expect(prior[0]?.issue).toContain('line 88')
    expect(prior[0]?.fix).toContain('你的代码跑不起来')
  })

  it('**真的进得了简报**（这是"不空转"的落点）', async () => {
    const root = await seed(traceback)
    const brief = stageBriefing(stageOf('code'), new Map(), false, await priorRuntimeFindings(root, stageOf('code')))
    expect(brief).toContain('NameError')
    expect(brief).toContain('at_p_alt') // 栈里的"Did you mean"提示要带上，那是最省事的修法线索
  })

  it('**别的阶段不注入**（否则只是噪声）', async () => {
    const root = await seed(traceback)
    expect(await priorRuntimeFindings(root, stageOf('modeling'))).toEqual([])
    expect(await priorRuntimeFindings(root, stageOf('result-sources'))).toEqual([])
  })

  it('没有回执 / 空回执 → 空数组，不阻断', async () => {
    const clean = await mkdtemp(join(tmpdir(), 'dsh-runtime-'))
    expect(await priorRuntimeFindings(clean, stageOf('code'))).toEqual([])
    const empty = await seed('   \n')
    expect(await priorRuntimeFindings(empty, stageOf('code'))).toEqual([])
  })
})
