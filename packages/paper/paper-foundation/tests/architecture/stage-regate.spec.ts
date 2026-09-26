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
import { runStages, type StageRunContext } from '../../src/stages/runner.ts'
import { stageOf } from '../../src/stages/registry.ts'

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
