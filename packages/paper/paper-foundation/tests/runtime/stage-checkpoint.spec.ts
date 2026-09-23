/**
 * 分阶段切片与热重启 —— 用户口径的验收。
 *
 * 要守的三件事：
 *   1. **每阶段完成即停**，切片落盘、可检查；
 *   2. 在 B 阶段暴露问题时，能从"**A 已完成、B 未开始**"重启——判据是"检查通过"；
 *   3. **每一轮切片都保留**，且被改过的切片**不能**被当成续跑点。
 */

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  STAGES,
  STAGE_IDS,
  listSlices,
  nextStageAfter,
  readSlicePayload,
  recordReview,
  renderResumeInstruction,
  resumePointOf,
  sliceDirName,
  writeSlice,
} from '../../src/runtime/stage-checkpoint.ts'

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-slices-'))
}

/** 写 n 个切片，并把前 `pass` 个标为检查通过。 */
async function seed(root: string, n: number, pass: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const stage = STAGE_IDS[i] as (typeof STAGE_IDS)[number]
    const { dir } = await writeSlice(root, {
      stage,
      index: i + 1,
      runId: 'run-1',
      payload: `payload for ${stage}`,
      facts: { note: `${stage} 的产出已落盘` },
      now: '2026-09-24T00:00:00.000Z',
    })
    if (i < pass) {
      await recordReview(dir, { verdict: 'passed', note: '人工检查通过', at: '2026-09-24T00:01:00.000Z' })
    }
  }
}

describe('切片 — 落盘与读取', () => {
  it('写一个切片后能读回载荷，且清单记录哈希', async () => {
    const root = await tmp()
    await writeSlice(root, { stage: 'analyze', index: 1, runId: 'r', payload: 'E1 全文', facts: {} })
    const slices = await listSlices(root)
    expect(slices).toHaveLength(1)
    expect(slices[0]?.stage).toBe('analyze')
    expect(slices[0]?.payloadSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await readSlicePayload(join(root, sliceDirName(1, 'analyze')))).toBe('E1 全文')
  })

  it('目录名带序号前缀（顺序一眼可见，且排序稳定）', () => {
    expect(sliceDirName(1, 'analyze')).toBe('01-analyze')
    expect(sliceDirName(10, 'deliver')).toBe('10-deliver')
  })

  it('**每一轮切片都保留**：后写的切片不覆盖先写的', async () => {
    const root = await tmp()
    await seed(root, 3, 0)
    const slices = await listSlices(root)
    expect(slices.map(s => s.stage)).toEqual(['analyze', 'declare', 'produce'])
  })
})

describe('切片 — 完整性（不猜）', () => {
  it('缺清单的目录**不算切片**', async () => {
    const root = await tmp()
    const { rm } = await import('node:fs/promises')
    await seed(root, 2, 0)
    await rm(join(root, sliceDirName(2, 'declare'), 'manifest.json'))
    const slices = await listSlices(root)
    expect(slices.map(s => s.stage)).toEqual(['analyze'])
  })

  it('**载荷被改过 → 切片作废**（不静默采用）', async () => {
    // 一个被改过的切片会让"续跑"从错误的状态开始，而那种错误极难从产物上看出来。
    const root = await tmp()
    await seed(root, 1, 1)
    const dir = join(root, sliceDirName(1, 'analyze'))
    await writeFile(join(dir, 'payload.txt'), 'E1 全文（被人手改过）', 'utf8')
    expect(await listSlices(root)).toHaveLength(0)
  })

  it('清单不是合法 JSON → 不算切片', async () => {
    const root = await tmp()
    await seed(root, 1, 0)
    await writeFile(join(root, sliceDirName(1, 'analyze'), 'manifest.json'), '{ 坏掉的 json', 'utf8')
    expect(await listSlices(root)).toHaveLength(0)
  })

  it('未知 sliceVersion → 不算切片（格式演进时不误读）', async () => {
    const root = await tmp()
    await seed(root, 1, 0)
    const dir = join(root, sliceDirName(1, 'analyze'))
    const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...m, sliceVersion: 99 }), 'utf8')
    expect(await listSlices(root)).toHaveLength(0)
  })
})

describe('热重启 — 续跑点 = 最后一个"检查通过"的切片', () => {
  it('全部通过 → 续跑点是最后一个', async () => {
    const root = await tmp()
    await seed(root, 3, 3)
    const point = resumePointOf(await listSlices(root))
    expect(point?.stage).toBe('produce')
    expect(point?.index).toBe(3)
  })

  it('**B 阶段未检查通过 → 续跑点停在 A**（用户口径的核心）', async () => {
    // 场景：analyze(A) 检查通过，declare(B) 完成但检查未通过（或还没检查）。
    // 修完之后要从"**A 已完成、B 未开始**"重启 B —— 而不是从头跑。
    const root = await tmp()
    await seed(root, 2, 1)
    const slices = await listSlices(root)
    const point = resumePointOf(slices)
    expect(point?.stage).toBe('analyze')
    expect(nextStageAfter(slices).id).toBe('declare')
  })

  it('检查**未通过**的切片不能当续跑点（"检查通过才继续"不是空话）', async () => {
    const root = await tmp()
    await seed(root, 2, 0)
    const dir = join(root, sliceDirName(1, 'analyze'))
    await recordReview(dir, { verdict: 'passed', note: 'ok', at: '2026-09-24T00:02:00.000Z' })
    await recordReview(join(root, sliceDirName(2, 'declare')), {
      verdict: 'failed', note: '容器里少了第二问的模型', at: '2026-09-24T00:03:00.000Z',
    })
    const slices = await listSlices(root)
    expect(resumePointOf(slices)?.stage).toBe('analyze')
    // 失败的那一片**仍然保留**（要能回看它为什么失败）
    expect(slices.map(s => s.stage)).toEqual(['analyze', 'declare'])
    expect(slices[1]?.review?.verdict).toBe('failed')
  })

  it('序号不连续 → 不能越过缺口续跑（前提不成立）', async () => {
    const root = await tmp()
    await seed(root, 1, 1)
    // 直接写第 3 片（模拟第 2 片丢失/损坏）
    await writeSlice(root, { stage: 'produce', index: 3, runId: 'r', payload: 'x', facts: {} })
    const slices = await listSlices(root)
    expect(resumePointOf(slices)?.index).toBe(1)
    expect(nextStageAfter(slices).id).toBe('declare')
  })

  it('第一片就不是 1 号 → 没有合格续跑点（从头跑）', async () => {
    const root = await tmp()
    await writeSlice(root, { stage: 'declare', index: 2, runId: 'r', payload: 'x', facts: {} })
    expect(resumePointOf(await listSlices(root))).toBeNull()
    expect(nextStageAfter(await listSlices(root)).id).toBe('analyze')
  })

  it('一片都没有 → 从第 1 阶段开始', async () => {
    const root = await tmp()
    expect(resumePointOf(await listSlices(root))).toBeNull()
    expect(nextStageAfter(await listSlices(root)).id).toBe(STAGES[0]?.id)
  })
})

describe('热重启 — 续跑提示必须含"怎么继续"', () => {
  it('提示里有：停在哪、待检查项、下一阶段、**可复制的续跑命令**', async () => {
    const root = await tmp()
    await seed(root, 2, 1)
    const text = renderResumeInstruction({
      slicesRoot: root,
      runId: 'run-1',
      problemFile: 'bench/problems/2024-B/problem-faithful.md',
      slices: await listSlices(root),
    })
    expect(text).toContain('已停在检查点')
    expect(text).toContain('01-analyze')
    expect(text).toContain('待检查：02-declare')
    expect(text).toContain('下一阶段：declare')
    // 缺了"怎么继续"，热重启就只是"跑一半停了"
    expect(text).toContain('--resume')
    expect(text).toContain('--run-id run-1')
  })
})

describe('切片 — 阶段表本身', () => {
  it('五个阶段，顺序固定，且每个都写明了"为什么能续跑"', () => {
    // 阶段表**只列真实存在的边界**：初版设计里有独立的 `render`，实现时发现
    // `runProductionChain` 把代码→IR→渲染放在一次调用里，没有可序列化的停顿点，
    // 于是折进 `produce`。一个永远发不出来的阶段名会让"下一阶段"指向不存在的切片。
    expect(STAGE_IDS).toEqual(['analyze', 'declare', 'produce', 'review', 'deliver'])
    for (const s of STAGES) {
      expect(s.resumableBecause.length, `${s.id} 没写 resumableBecause`).toBeGreaterThan(10)
      expect(s.produces.length).toBeGreaterThan(0)
    }
  })
})

describe('切片 — 重跑同一阶段时**旧切片必须留下**', () => {
  it('重写同一 (index, stage) → 旧的被移到 .superseded-N，新的照常可读', async () => {
    // 用户口径："每一轮切片都保留"。修完问题从上一个检查点重启时，**旧切片是
    // "修之前长什么样"的唯一证据**——覆盖掉它，事后就无法证明修复真的改变了什么。
    const root = await tmp()
    await writeSlice(root, { stage: 'analyze', index: 1, runId: 'r1', payload: '修复前的 E1', facts: {} })
    await writeSlice(root, { stage: 'analyze', index: 1, runId: 'r2', payload: '修复后的 E1', facts: {} })
    // 参与续跑判定的只有新的那一片
    const slices = await listSlices(root)
    expect(slices).toHaveLength(1)
    expect(await readSlicePayload(join(root, sliceDirName(1, 'analyze')))).toBe('修复后的 E1')
    // 旧的仍在磁盘上，且载荷可读
    const kept = join(root, `${sliceDirName(1, 'analyze')}.superseded-1`)
    expect(await readSlicePayload(kept)).toBe('修复前的 E1')
  })

  it('重跑两次 → 两个历史轮次都在（.superseded-1 / .superseded-2）', async () => {
    const root = await tmp()
    for (const [i, text] of ['第一轮', '第二轮', '第三轮'].entries()) {
      await writeSlice(root, { stage: 'analyze', index: 1, runId: `r${String(i)}`, payload: text, facts: {} })
    }
    expect(await readSlicePayload(join(root, '01-analyze.superseded-1'))).toBe('第一轮')
    expect(await readSlicePayload(join(root, '01-analyze.superseded-2'))).toBe('第二轮')
    expect(await readSlicePayload(join(root, '01-analyze'))).toBe('第三轮')
  })

  it('被移开的旧切片**不参与**续跑判定（否则序号会重复、续跑链被截断）', async () => {
    const root = await tmp()
    await writeSlice(root, { stage: 'analyze', index: 1, runId: 'r1', payload: 'A', facts: {} })
    await writeSlice(root, { stage: 'analyze', index: 1, runId: 'r2', payload: 'A2', facts: {} })
    await writeSlice(root, { stage: 'declare', index: 2, runId: 'r2', payload: 'B', facts: {} })
    const slices = await listSlices(root)
    expect(slices.map(s => s.index)).toEqual([1, 2])
    // 两片都检查通过 → 续跑点是第 2 片（序号连续，没有被历史轮次打断）
    await recordReview(join(root, '01-analyze'), { verdict: 'passed', note: 'ok', at: 'x' })
    await recordReview(join(root, '02-declare'), { verdict: 'passed', note: 'ok', at: 'x' })
    expect(resumePointOf(await listSlices(root))?.index).toBe(2)
  })
})
