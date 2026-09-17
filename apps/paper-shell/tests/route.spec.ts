/**
 * P0-5 (W4) — problem-family routing tests.
 *
 * Verifies the classifier:
 *   - routes a statistical problem to F3 (supported);
 *   - routes an evaluation/decision problem to F4 (supported);
 *   - routes an optimization problem to F1 (unsupported today) and
 *     DECLINES explicitly with a reason, zero tokens spent;
 *   - declines a bare/generic statement instead of guessing;
 *   - is deterministic (same input -> same verdict);
 *   - produces a route banner the W5 contract layer can consume.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyProblem,
  routeBanner,
  routeCoversTruth,
  routeMismatch,
  SUPPORTED_FAMILIES,
  FAMILIES,
  MIN_SIGNAL,
} from '../src/route.ts'

const STAT_PROBLEM = '已知两种零配件的次品率，请通过抽样检测方法在 95% 信度下判断是否接收这批货物，并设计样本量最小的检测方案。数据如表所示。'
const DECISION_PROBLEM = '请比较三种生产决策方案的成本与收益，用层次分析法进行多准则评价，给出最优选择与综合评分。'
const OPTIMIZATION_PROBLEM = '某物流企业需要规划一条从仓库到多个配送点的运输路线，在车辆容量、时间窗和道路约束下，使总运输成本最小化，并给出每天的调度排程方案与最优解。'
const GENERIC = '请写一篇论文。'

describe('route — family classification', () => {
  it('routes a statistical problem to F3 (supported, ok)', () => {
    const v = classifyProblem(STAT_PROBLEM)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.family).toBe('F3')
      expect(v.note).toContain('F3')
      expect(SUPPORTED_FAMILIES).toContain('F3')
    }
  })

  it('routes an evaluation/decision problem to F4 (supported, ok)', () => {
    const v = classifyProblem(DECISION_PROBLEM)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.family).toBe('F4')
  })

  it('routes an optimization problem to F2 (unsupported) and DECLINES explicitly', () => {
    // W8.6-P3 realign: 优化 = 组合/离散（核验表 Part B 的 F2），不是 F1（机理/连续）。
    // 旧词表把优化串到 F1 是 W8.5 路由浪费的上游成因之一。
    const v = classifyProblem(OPTIMIZATION_PROBLEM)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toContain('明确拒绝')
      expect(v.reason).toContain('不消耗额度')
      expect(v.reason).toContain('F2')
      expect(v.reason).toContain('混合题必须先补齐缺失组件的契约')
    }
  })

  it('declines a generic statement instead of guessing a family', () => {
    const v = classifyProblem(GENERIC)
    expect(v.ok).toBe(false)
  })

  it('declines an extremely short statement', () => {
    const v = classifyProblem('好')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('过短')
  })

  it('is deterministic: same input -> same verdict', () => {
    const a = classifyProblem(STAT_PROBLEM)
    const b = classifyProblem(STAT_PROBLEM)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('the closed family list is exposed for the contract layer', () => {
    expect(FAMILIES).toEqual(['F1', 'F2', 'F3', 'F4'])
    expect(SUPPORTED_FAMILIES).toEqual(['F3', 'F4'])
    expect(MIN_SIGNAL).toBe(2)
  })
})

describe('route — banner', () => {
  it('the banner carries the family so W5 can route', () => {
    const v = classifyProblem(STAT_PROBLEM)
    expect(v.ok).toBe(true)
    if (v.ok) {
      const banner = routeBanner(v)
      expect(banner).toContain('方法族：F3')
      expect(banner).toContain('题型路由（自动）')
    }
  })
})

describe('route — W8.9-A2 component-set mismatch', () => {
  // 2024-B: truth label "F3+F4", router primary family "F4", components F4×4 + F3×3.
  const B_STATEMENT = '某企业生产电子产品，需要购买两种零配件装配成品，零配件和成品存在次品率。请用抽样检测方法在 95% 信度下判断是否接收，并针对表 1 的六种情况给出各阶段的生产决策方案，包括是否检测零配件与成品、不合格成品是否拆解，并给出决策依据及成本、利润等指标结果，比较各方案的优劣。'

  it('2024-B: a mixed truth label is NOT a mismatch when components cover it', () => {
    const v = classifyProblem(B_STATEMENT)
    expect(v.ok).toBe(true)
    if (v.ok) {
      // the truth file says F3+F4; the router's primary family is F4.
      expect(v.family).toBe('F4')
      expect(v.components.map(c => c.family)).toContain('F3')
      expect(routeCoversTruth('F3+F4', v)).toBe(true)
      expect(routeMismatch('F3+F4', v)).toBe(false)
    }
  })

  it('a truth component the router never saw IS a mismatch', () => {
    const v = classifyProblem(B_STATEMENT)
    expect(v.ok).toBe(true)
    if (v.ok) {
      // The routed set is {F4, F3}; a truth label naming F2 is NOT covered.
      // (F2's words are absent from this statement, so the router never saw it.)
      expect(v.components.map(c => c.family)).not.toContain('F2')
      expect(routeCoversTruth('F3+F2', v)).toBe(false)
      expect(routeMismatch('F3+F2', v)).toBe(true)
    }
  })

  it('null truth and unparseable truth never manufacture a mismatch', () => {
    const v = classifyProblem(B_STATEMENT)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(routeCoversTruth(null, v)).toBe(true)
      expect(routeMismatch(null, v)).toBe(false)
      expect(routeCoversTruth('not-a-family', v)).toBe(true)
      expect(routeMismatch('not-a-family', v)).toBe(false)
    }
  })

  it('a genuinely missing component is a mismatch (constructed counter-example)', () => {
    // Hand-built verdict whose component set is {F4} only; truth needs F3 too.
    const verdict = { ok: true as const, family: 'F4' as const, note: 'stub', components: [{ family: 'F4' as const, hits: 4 }] }
    expect(routeCoversTruth('F3+F4', verdict)).toBe(false)
    expect(routeMismatch('F3+F4', verdict)).toBe(true)
    expect(routeCoversTruth('F4', verdict)).toBe(true)
  })

  it('string equality would have been wrong here (the old behaviour)', () => {
    const verdict = { ok: true as const, family: 'F4' as const, note: 'stub', components: [{ family: 'F4' as const, hits: 4 }, { family: 'F3' as const, hits: 3 }] }
    // old: truth !== routed  ->  'F3+F4' !== 'F4'  ->  true (false alarm)
    expect('F3+F4' !== verdict.family).toBe(true)
    // new: component-set coverage -> false (correct)
    expect(routeMismatch('F3+F4', verdict)).toBe(false)
  })
})
