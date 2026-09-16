/**
 * W8.6 C 组验收 — 无契约零 token 拒绝 (H3) + 路由/预注册不一致标记 (C2).
 *
 * H3 (judge): routing to a family WITHOUT an implemented contract must
 *   refuse with zero model calls. W8.5's causal chain: prereg said F3,
 *   router said F4/F1-mix, contract gap F2 — the missing gate let an
 *   18-minute / 75,669-token run proceed under a wrong contract.
 */

import { describe, expect, it } from 'vitest'
import { classifyProblem, SUPPORTED_FAMILIES } from '../src/route.ts'
import { getContract, CONTRACTED_FAMILIES } from '../src/contracts/index.ts'

describe('W8.6-C1/H3 — no contract = refusal, zero tokens', () => {
  it('SUPPORTED_FAMILIES is DERIVED from the contract registry (no drift)', () => {
    expect([...SUPPORTED_FAMILIES].sort()).toEqual([...CONTRACTED_FAMILIES].sort())
    for (const family of SUPPORTED_FAMILIES) {
      expect(getContract(family)).toBeDefined()
    }
  })

  it('routing an F1 (no contract) problem refuses with a reason naming the contracted set', () => {
    const v = classifyProblem(
      '某物流企业需要规划一条从仓库到多个配送点的运输路线，在车辆容量、时间窗和道路约束下，使总运输成本最小化，并给出每天的调度排程方案与最优解。',
    )
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toContain('没有已实现的契约')
      expect(v.reason).toContain('不消耗额度')
      expect(v.reason).toContain('F3')
    }
  })

  it('the refusal happens with ZERO provider involvement (pure function, no injection path)', () => {
    // classifyProblem has no I/O and no provider parameter — zero-token is
    // structural, not a runtime check. This test pins the property: the
    // verdict for an unsupported family returns before ANY async work.
    const v = classifyProblem('求最小化总成本，在约束下给出最优调度与目标函数的解，涉及路径规划与网络流。')
    expect(v.ok).toBe(false)
  })
})
