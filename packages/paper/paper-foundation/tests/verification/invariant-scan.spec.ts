/**
 * DECLARED-INVARIANT SCAN — 随机扫描验证的打包层测试。
 *
 * 通道直击 2024B 缺陷形态 F-002（单位/口径）与 F-003（守恒/边界）：模型声明的
 * 不变量在声明域的随机采样下逐点核对。打包层（`runInvariantScan`）对着真实
 * 脚本跑 —— 与 v6-v7.spec.ts 对 V7 的测法一致；判定语义（容差表/屏蔽语义/
 * 固定种子）由脚本侧实现，这里用输入-输出契约钉住：
 *   - 箱上恒成立的不变量 0 违约（含等式容差路径 —— 随机采样下精确相等不可依赖）；
 *   - 假不变量报违约率 + 违约样本；
 *   - 口径对不上（未声明符号/解析失败）报 INV-001；
 *   - python 缺失时降级为 INV-EXEC finding，不抛。
 *
 * **一个故意留下的反例**：任务书里"`p1 + p2 <= 1` over [0,1] 应通过"的例子
 * 本身是错的 —— p1、p2 独立均匀采样时整箱有一半违约。本套件把这一形态钉成
 * 反例（CAUGHT），恰好演示通道的"牙口"：声明域与不变量必须自洽。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runInvariantScan, INVARIANT_SCAN_SCRIPT } from '../../src/verification/invariant-scan.ts'
import type { InvariantScanInput, InvariantScanVariable } from '../../src/verification/invariant-scan.ts'
import { existsSync } from 'node:fs'

type SpawnSyncFn = typeof import('node:child_process').spawnSync

// spawnSync 可注入：绝大多数测试走**真实子进程**（pass-through），只有"输出非
// JSON"这一条分支用注入桩覆盖 —— 真实脚本永远输出合法 JSON，这条分支只有
// 脚本本身被破坏时才会走到（正是它要防的情形）。
const { spawnSyncMock, realSpawnSyncRef } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn<(...args: Parameters<SpawnSyncFn>) => ReturnType<SpawnSyncFn>>(),
  realSpawnSyncRef: { current: null as SpawnSyncFn | null },
}))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  realSpawnSyncRef.current = actual.spawnSync
  return { ...actual, spawnSync: spawnSyncMock }
})

const PROB_VARS = [
  { name: 'p1', low: 0, high: 1, unit: 'probability' },
  { name: 'p2', low: 0, high: 1, unit: 'probability' },
] as const

function scan(partial: Partial<InvariantScanInput>): ReadonlyArray<{ rule: string; ok: boolean; detail: string }> {
  return runInvariantScan({ samples: 400, ...partial })
}

describe('DECLARED-INVARIANT SCAN 打包层', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    const real = realSpawnSyncRef.current
    if (!real) throw new Error('child_process mock 未拿到真实实现')
    spawnSyncMock.mockImplementation((...args) => real(...args))
  })

  it('the script resolves inside the repo', () => {
    expect(existsSync(INVARIANT_SCAN_SCRIPT)).toBe(true)
  })

  it('a true inequality invariant over its declared box passes with 0 violations', () => {
    const findings = scan({
      variables: [...PROB_VARS],
      invariants: [{ id: 'INV-A', expr: 'p1 + p2 >= 0', vars: ['p1', 'p2'], description: '概率非负' }],
    })
    const scanVerdict = findings.find(f => f.rule === 'INV-002')
    expect(scanVerdict?.ok).toBe(true)
    expect(scanVerdict?.detail).toContain('0/400')
    expect(findings.some(f => f.rule === 'INV-002' && !f.ok)).toBe(false)
  })

  it('a non-trivial equality holds via the 1e-9 tolerance path (exact equality is not dependable)', () => {
    const findings = scan({
      variables: [...PROB_VARS],
      // 解析期不会被 sympy 结构化简，只能靠数值容差路径判 —— 浮点误差 ~1e-16 ≪ 1e-9。
      invariants: [{ id: 'INV-EQ', expr: '(p1 + p2)**2 == p1**2 + 2*p1*p2 + p2**2' }],
    })
    const verdict = findings.find(f => f.rule === 'INV-002')
    expect(verdict?.ok).toBe(true)
    expect(verdict?.detail).toContain('等式')
  })

  it('a bare residual expression is judged against the 1e-9 tolerance (conservation form)', () => {
    const good = scan({
      variables: [{ name: 'x', low: 0, high: 1 }],
      invariants: [{ id: 'R0', expr: 'x - x' }],
    })
    expect(good.find(f => f.rule === 'INV-002')?.ok).toBe(true)
    const bad = scan({
      variables: [{ name: 'x', low: 0, high: 1 }],
      invariants: [{ id: 'R1', expr: 'x - x - 0.5' }],
    })
    const verdict = bad.find(f => f.rule === 'INV-002')
    expect(verdict?.ok).toBe(false)
    expect(verdict?.detail).toContain('残差')
  })

  it('COUNTER-EXAMPLE: a false invariant is caught with rate and a violating sample', () => {
    const findings = scan({
      variables: [{ name: 'x', low: 0, high: 1 }],
      invariants: [{ id: 'BAD-1', expr: 'x > 2', vars: ['x'] }],
    })
    const verdict = findings.find(f => f.rule === 'INV-002')
    expect(verdict?.ok).toBe(false)
    expect(verdict?.detail).toContain('违约率 100')
    expect(verdict?.detail).toContain('例:')
    expect(verdict?.detail).toContain('x=')
  })

  it('COUNTER-EXAMPLE: the naive simplex invariant p1+p2<=1 over the FULL unit box is caught', () => {
    // p1、p2 独立均匀采样时 P(p1+p2<=1) = 1/2 —— 声明域与不变量不自洽必须现形。
    const findings = scan({
      variables: [...PROB_VARS],
      invariants: [{ id: 'NAIVE', expr: 'p1 + p2 <= 1', vars: ['p1', 'p2'] }],
    })
    const verdict = findings.find(f => f.rule === 'INV-002')
    expect(verdict?.ok).toBe(false)
    expect(verdict?.detail).toContain('违约率')
  })

  it('COUNTER-EXAMPLE: an expression undefined on the whole domain fails, not silently passes', () => {
    const findings = scan({
      variables: [{ name: 'p1', low: 0, high: 1 }],
      invariants: [{ id: 'SING', expr: 'sqrt(p1 - 2) >= 0' }],
    })
    const verdict = findings.find(f => f.rule === 'INV-002')
    expect(verdict?.ok).toBe(false)
    expect(verdict?.detail).toContain('全部 400 个样本未定义')
  })

  it('COUNTER-EXAMPLE: an unparseable expression yields INV-001', () => {
    const findings = scan({
      variables: [...PROB_VARS],
      invariants: [{ id: 'BROKEN', expr: 'p1 +* 2 <= 1' }],
    })
    const verdict = findings.find(f => f.rule === 'INV-001')
    expect(verdict?.ok).toBe(false)
    expect(verdict?.detail).toContain('解析失败')
  })

  it('COUNTER-EXAMPLE: an undeclared symbol yields INV-001 (F-002 口径形态)', () => {
    const findings = scan({
      variables: [...PROB_VARS],
      invariants: [{ id: 'SCOPE', expr: 'q + p1 >= 0' }],
    })
    const verdict = findings.find(f => f.rule === 'INV-001')
    expect(verdict?.ok).toBe(false)
    expect(verdict?.detail).toContain('未声明的符号 q')
  })

  it('a variable range that is not finite-by-construction is flagged in INV-003', () => {
    const findings = scan({
      variables: [{ name: 'w', low: 1, high: 0 }],
      invariants: [{ id: 'USEW', expr: 'w >= 0' }],
    })
    const sanity = findings.find(f => f.rule === 'INV-003')
    expect(sanity?.ok).toBe(false)
    expect(findings.find(f => f.rule === 'INV-001')?.detail).toContain('非法变量域')
  })

  it('an empty invariant list is a skip, not a failure', () => {
    const findings = scan({ variables: [...PROB_VARS], invariants: [] })
    const sanity = findings.find(f => f.rule === 'INV-003')
    expect(sanity?.ok).toBe(true)
    expect(sanity?.detail).toContain('跳过')
  })

  it('invalid sample counts fall back to the default and are reported via INV-003', () => {
    // samples: 0 不合法 → 回退 20000；扫描本身照常出判定。
    const findings = runInvariantScan({
      variables: [{ name: 'x', low: 0, high: 1 }],
      invariants: [{ id: 'A', expr: 'x >= 0' }],
      samples: 0,
    })
    const sanity = findings.find(f => f.rule === 'INV-003')
    expect(sanity?.ok).toBe(false)
    expect(sanity?.detail).toContain('回退默认')
    expect(findings.some(f => f.rule === 'INV-002')).toBe(true)
  })

  it('is deterministic for a fixed seed (同一输入同一判定 —— 可复算纪律)', () => {
    const input: InvariantScanInput = {
      variables: [...PROB_VARS],
      invariants: [
        { id: 'A', expr: 'p1 + p2 <= 1.5' },
        { id: 'B', expr: '(p1 + p2)**2 == p1**2 + 2*p1*p2 + p2**2' },
      ],
      samples: 600,
    }
    const first = JSON.stringify(runInvariantScan(input))
    const second = JSON.stringify(runInvariantScan(input))
    expect(second).toBe(first)
  })

  it('degrades gracefully when python is missing (INV-EXEC finding, no throw)', () => {
    vi.stubEnv('PYTHON', 'dsh-no-such-python-for-invariant-scan')
    try {
      const findings = runInvariantScan({
        variables: [{ name: 'x', low: 0, high: 1 }],
        invariants: [{ id: 'A', expr: 'x >= 0' }],
        samples: 10,
      })
      expect(findings).toHaveLength(1)
      expect(findings[0]?.rule).toBe('INV-EXEC')
      expect(findings[0]?.ok).toBe(false)
      expect(findings[0]?.detail.length).toBeGreaterThan(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('maps a helper crash (top-level payload shape violated) to INV-EXEC with the stderr trail', () => {
    // 契约层破坏（variables 不是列表）→ 脚本如实崩（带 traceback）→
    // 打包层把退出码 + stderr 映射成 INV-EXEC —— 调用方 bug 不许静默通过。
    const findings = runInvariantScan({
      variables: 5 as unknown as ReadonlyArray<InvariantScanVariable>,
      invariants: [{ id: 'A', expr: 'x >= 0' }],
      samples: 10,
      seed: 0,
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe('INV-EXEC')
    expect(findings[0]?.ok).toBe(false)
  })

  it('degrades gracefully when the helper emits non-JSON with exit 0 (INV-PARSE finding)', () => {
    // 真实脚本恒输出合法 JSON；这一分支防的是脚本被破坏/被换成别的东西。
    // 桩返回类型按 spawnSync 的 Buffer 重载取形，字符串 stdout 需一次显式收窄。
    const fake = { status: 0, stdout: '<html>crashed</html>', stderr: '' } as unknown as ReturnType<SpawnSyncFn>
    spawnSyncMock.mockReturnValue(fake)
    const findings = runInvariantScan({
      variables: [{ name: 'x', low: 0, high: 1 }],
      invariants: [{ id: 'A', expr: 'x >= 0' }],
      samples: 10,
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe('INV-PARSE')
    expect(findings[0]?.ok).toBe(false)
    expect(findings[0]?.detail).toContain('非 JSON')
  })
})
