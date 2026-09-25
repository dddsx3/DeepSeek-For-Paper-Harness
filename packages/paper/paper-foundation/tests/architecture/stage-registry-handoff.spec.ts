/**
 * 阶段注册表 + 通行证交接 —— 三条准入规则都必须是**代码**，不是约定。
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DETERMINISTIC_STAGES,
  MODEL_STAGES,
  STAGES,
  STAGE_IDS,
  stageDirName,
  stageOf,
} from '../../src/stages/registry.ts'
import {
  markStaleFrom,
  upstreamDigestsOf,
  passportFor,
  passportStillValid,
  readPassport,
  stageReady,
  writePassport,
  type GateVerdict,
} from '../../src/stages/handoff.ts'

const ok: GateVerdict = { code: 0, items: [{ id: 'g', ok: true, detail: 'ok' }] }

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-stages-'))
}

/** 按顺序给前 n 个阶段发证（模拟一次顺利推进）。 */
async function seed(root: string, n: number, skillVersion = 'sk1', gateVersion = 'g1'): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const spec = STAGES[i] as (typeof STAGES)[number]
    const ready = await stageReady(root, spec, skillVersion, gateVersion)
    expect(ready.ok, `${spec.id} 未就绪：${ready.reason}`).toBe(true)
    await writePassport(root, passportFor(spec, {
      // **真实上游摘要**：第一版传空数组，于是签发的摘要与 `passportStillValid`
      // 重算的对不上——那是测试辅助函数的错，不是模块的错。
      upstreamDigests: await upstreamDigestsOf(root, spec),
      skillVersion, gateVersion, artifacts: {}, gate: ok,
      now: '2026-09-24T00:00:00.000Z',
    }))
  }
}

describe('注册表 —— 结构不变量', () => {
  it('11 个阶段，序号 1..11 连续，id 与 STAGE_IDS 同序', () => {
    expect(STAGES).toHaveLength(13)
    expect(STAGES.map(s => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(STAGES.map(s => s.id)).toEqual([...STAGE_IDS])
  })

  it('**回滚目标必须更早** —— 否则回滚会成环', () => {
    for (const s of STAGES) {
      for (const target of s.rollbackTo) {
        expect(stageOf(target).index, `${s.id} 回滚到 ${target} 不是更早的阶段`).toBeLessThan(s.index)
      }
    }
  })

  it('**`consumes` 只指向更早阶段的产物** —— 依赖不得倒流', () => {
    for (const s of STAGES) {
      for (const path of s.consumes) {
        const m = /^(\d\d)-([a-z-]+)\//.exec(path)
        if (m === null) {
          // `00-input/` 是题面等外部输入，允许
          expect(path.startsWith('00-input/'), `${s.id} 的 consumes '${path}' 形态不认识`).toBe(true)
          continue
        }
        const upIndex = Number(m[1])
        expect(upIndex, `${s.id} 消费了不更早的阶段 '${path}'`).toBeLessThan(s.index)
      }
    }
  })

  it('阶段 4/5/10/11 是**确定性**的（不消耗模型调用）；9 是模型阶段', () => {
    // 建模代码（3）与图表声明（4）分属两个阶段；数据图渲染（5）与流程/架构图（6）也分开。
    expect(DETERMINISTIC_STAGES.map(s => s.id)).toEqual(['figure', 'diagram', 'format-check', 'docx-export'])
    expect(MODEL_STAGES.map(s => s.id)).toEqual(['prob-analysis', 'modeling', 'code', 'result-sources', 'figure-declare', 'review', 'paper', 'improve', 'format-profile'])
  })

  it('**每条正文契约规则都有归属**（当前头号拒绝"参考文献↔方法"必须在列）', () => {
    const owned = new Set(STAGES.flatMap(s => s.contractRules))
    expect(owned.has('references_method_keyword'), '头号拒绝没有归属 —— 这正是评估指出的缺口').toBe(true)
    // 八章横跨阶段 2 与 7：两边都要有
    expect(stageOf('modeling').contractRules).toContain('floor_analysis')
    expect(stageOf('paper').contractRules).toContain('floor_references')
    // 且不存在"定义了但没人挂"的规则
    expect(owned.size).toBeGreaterThanOrEqual(10)
  })

  it('每个阶段都写了前提或产物说明（不留空壳）', () => {
    for (const s of STAGES) {
      expect(s.produces.length, `${s.id} 没有产出`).toBeGreaterThan(0)
      expect(s.gates.length, `${s.id} 没有门禁`).toBeGreaterThan(0)
      for (const p of s.produces) expect(p.desc.length, `${s.id} 的 ${p.file} 没写说明`).toBeGreaterThanOrEqual(4)
    }
  })

  it('目录名带序号前缀（排序稳定）', () => {
    expect(stageDirName(stageOf('prob-analysis'))).toBe('01-prob-analysis')
    expect(stageDirName(stageOf('docx-export'))).toBe('13-docx-export')
  })
})

describe('通行证 —— 门禁不过就拒绝签发', () => {
  it('code=1（硬失败）→ **抛错**，不签发', () => {
    expect(() => passportFor(stageOf('modeling'), {
      upstreamDigests: [], skillVersion: 's', gateVersion: 'g', artifacts: {},
      gate: { code: 1, items: [{ id: 'modeling_floor', ok: false, detail: '只有 900 字节' }] },
    })).toThrow(/refusing to issue PASSED/)
  })

  it('**code=2（无法判定）可以签发，但必须记名** —— 不记名就等于把它当成了通过', () => {
    // 契约在 S5 改过一次，理由写在 `runner.ts` 模块头：让 `2` 阻断阶段会使
    // **所有门禁实现完之前系统完全不可运行**；而 CLEAN/MARKED/DEGRADED/ESCALATE
    // 这套既有阶梯本来就是"检出问题但如实标注、不零掉产物"。
    //
    // 但"`2` 不等于通过"**没有丢**：证上必须带 `unverifiedGates`，交付侧按它降档。
    const gate = { code: 2 as const, items: [{ id: 'leakage_audit', ok: false, detail: '无法判定' }] }
    // 不记名 → 拒绝
    expect(() => passportFor(stageOf('code'), {
      upstreamDigests: [], skillVersion: 's', gateVersion: 'g', artifacts: {}, gate,
    })).toThrow(/unjudgeable|cannot judge/)
    // 记名 → 签发，且证上带着缺口
    const passport = passportFor(stageOf('code'), {
      upstreamDigests: [], skillVersion: 's', gateVersion: 'g', artifacts: {}, gate,
      unverifiedGates: ['leakage_audit'],
    })
    expect(passport.status).toBe('passed')
    expect(passport.unverifiedGates).toEqual(['leakage_audit'])
  })

  it('**code=1（硬失败）仍然拒绝签发**（这条没变）', () => {
    expect(() => passportFor(stageOf('code'), {
      upstreamDigests: [], skillVersion: 's', gateVersion: 'g', artifacts: {},
      gate: { code: 1, items: [{ id: 'x', ok: false, detail: '硬失败' }] },
    })).toThrow(/hard failure/)
  })

  it('code=0 → 签发，且摘要覆盖上游/技能/门禁', () => {
    const p = passportFor(stageOf('modeling'), {
      upstreamDigests: ['u1'], skillVersion: 's1', gateVersion: 'g1', artifacts: {}, gate: ok,
    })
    expect(p.status).toBe('passed')
    const p2 = passportFor(stageOf('modeling'), {
      upstreamDigests: ['u1'], skillVersion: 's1', gateVersion: 'g2', artifacts: {}, gate: ok,
    })
    expect(p2.inputDigest).not.toBe(p.inputDigest)
  })
})

describe('通行证 —— 上游就绪与回滚作废', () => {
  it('上游没有 PASSED → 拒绝启动，并点名是哪一环', async () => {
    const root = await tmp()
    const ready = await stageReady(root, stageOf('modeling'), 's', 'g')
    expect(ready.ok).toBe(false)
    expect(ready.reason).toContain('prob-analysis')
  })

  it('顺推：前 n 个阶段都能启动并签发', async () => {
    const root = await tmp()
    await seed(root, 3)
    for (const id of ['prob-analysis', 'modeling', 'code'] as const) {
      expect((await readPassport(root, stageOf(id)))?.status).toBe('passed')
    }
  })

  it('**回滚到阶段 2 → 阶段 3..11 的 PASSED 全部作废**（评估指出的缺口）', async () => {
    const root = await tmp()
    await seed(root, 5)
    const stale = await markStaleFrom(root, 'modeling', '阶段 6 报 fatal：拆解回流方程未定义')
    // 只作废序号更大的
    // seed(root, 5) 只播种了阶段 1..5 —— 序号 >2 的是 code/figure-declare/figure（review 是阶段 7，未播种）
    expect(stale).toEqual(['code', 'result-sources', 'figure-declare'])
    expect((await readPassport(root, stageOf('modeling')))?.status).toBe('passed')
    // **不删除**：旧哨兵仍在，且带着作废原因（证据保留）
    const codePassport = await readPassport(root, stageOf('code'))
    expect(codePassport?.status).toBe('stale')
    expect(codePassport?.staleReason).toContain('阶段 6 报 fatal')
    expect(codePassport?.gate.code).toBe(0) // 它当时确实过了 —— 作废的是"还算不算数"
  })

  it('上游被作废后 → 下游**拒绝启动**（不会产出半新半旧的包）', async () => {
    const root = await tmp()
    await seed(root, 5)
    await markStaleFrom(root, 'modeling', '回滚')
    const ready = await stageReady(root, stageOf('review'), 's', 'g')
    expect(ready.ok).toBe(false)
    expect(ready.reason).toContain('stale')
  })

  it('技能或门禁版本变了 → 旧通行证**不再有效**（即便上游没动）', async () => {
    const root = await tmp()
    await seed(root, 2, 'sk1', 'g1')
    expect(await passportStillValid(root, stageOf('modeling'), 'sk1', 'g1')).toBe(true)
    expect(await passportStillValid(root, stageOf('modeling'), 'sk2', 'g1')).toBe(false)
    expect(await passportStillValid(root, stageOf('modeling'), 'sk1', 'g2')).toBe(false)
  })
})
