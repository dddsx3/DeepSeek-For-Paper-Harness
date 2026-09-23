/**
 * L0 — 能力探针执行器：三个探针的判据必须是**机器判的**。
 *
 * 判据若由另一个模型打分，探针测的就是评审的偏好，不是模型与本架构的匹配度。
 * 因此这里逐条钉住三个探针的确定性判据，包括"结构探针要求版本标记是**第一个键**"
 * 这种看起来吹毛求疵、实则与生产链准入检查**同一件事**的要求。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/architecture/probe-runner
 */

import { describe, expect, it } from 'vitest'
import {
  PROBE_EXPECTED,
  PROBE_PROMPTS,
  extractJsonObject,
  judgeExecutionProbe,
  judgeStructureProbe,
  judgeSymbolicProbe,
  runCapabilityProbes,
  withinTolerance,
} from '../../src/probe/probe-runner.ts'

const MARKER = '"__dsh_paper":"ir-container-v1"'

describe('L0 探针判据 — structure（容器合规）', () => {
  it('版本标记是第一个键 → 通过', () => {
    const text = `{${MARKER},"entries":[{"kind":"SymbolSpec","value":{"symbol_id":"S-X"}}],"code":"","run":{"outputBasenames":["out.json"],"seed":1}}`
    const verdict = judgeStructureProbe(text)
    expect(verdict.passed).toBe(true)
    expect(verdict.detail).toContain('首键为版本标记')
  })

  it('容器合法但版本标记**不是第一个键** → 不通过（与生产链准入检查同一件事）', () => {
    const text = `{"entries":[{"kind":"SymbolSpec","value":{}}],${MARKER}}`
    const verdict = judgeStructureProbe(text)
    expect(verdict.passed).toBe(false)
    expect(verdict.detail).toContain('不是第一个键')
  })

  it('包了 markdown fence 仍算通过（生产链会剥一层 fence，探针必须同口径）', () => {
    const text = '```json\n' + `{${MARKER},"entries":[{"kind":"SymbolSpec","value":{}}]}` + '\n```'
    expect(judgeStructureProbe(text).passed).toBe(true)
  })

  it('entries 为空 → 不通过', () => {
    expect(judgeStructureProbe(`{${MARKER},"entries":[]}`).passed).toBe(false)
  })
})

describe('L0 探针判据 — execution（代码真跑）', () => {
  it('代码真的被执行，输出正确 → 通过', () => {
    const source = `
      let s = 0; for (let i = 1; i <= 40; i += 1) s += i * i;
      require('fs').writeFileSync('out.json', JSON.stringify({ value: s }));`
    const verdict = judgeExecutionProbe(source)
    expect(verdict.passed).toBe(true)
    expect(verdict.detail).toContain(String(PROBE_EXPECTED.execution))
  })

  it('代码语法错 → 不通过，且原因里带真实 stderr（不是"看起来不对"）', () => {
    const verdict = judgeExecutionProbe('const x = ;')
    expect(verdict.passed).toBe(false)
    expect(verdict.detail).toContain('代码执行失败')
  })

  it('代码跑通但结果错 → 不通过（能跑 ≠ 算对）', () => {
    const verdict = judgeExecutionProbe("require('fs').writeFileSync('out.json', JSON.stringify({ value: 1 }))")
    expect(verdict.passed).toBe(false)
    expect(verdict.detail).toContain('结果错误')
  })

  it('没写 out.json → 不通过', () => {
    expect(judgeExecutionProbe('const a = 1;').passed).toBe(false)
  })
})

describe('L0 探针判据 — symbolic（解析解）', () => {
  it('数值在容差内 → 通过', () => {
    const verdict = judgeSymbolicProbe(`{"value": ${String(PROBE_EXPECTED.symbolic)}}`)
    expect(verdict.passed).toBe(true)
  })

  it('三位有效数字（68.5）也在容差内 —— 探针不该惩罚合理的舍入', () => {
    expect(judgeSymbolicProbe('{"value": 68.5}').passed).toBe(true)
  })

  it('数值错 → 不通过', () => {
    const verdict = judgeSymbolicProbe('{"value": 100}')
    expect(verdict.passed).toBe(false)
    expect(verdict.detail).toContain('解析解错误')
  })

  it('没有 JSON → 不通过', () => {
    expect(judgeSymbolicProbe('T(1) ≈ 68.5 摄氏度').passed).toBe(false)
  })
})

describe('L0 探针 — 工具函数', () => {
  it('withinTolerance 是相对误差，且拒绝非有限值', () => {
    expect(withinTolerance(100.05, 100)).toBe(true)
    expect(withinTolerance(101, 100)).toBe(false)
    expect(withinTolerance(Number.NaN, 100)).toBe(false)
    expect(withinTolerance(Number.POSITIVE_INFINITY, 100)).toBe(false)
  })

  it('extractJsonObject 容忍前后散文，但不接受数组', () => {
    expect(extractJsonObject('前言 {"a":1} 后记')?.a).toBe(1)
    expect(extractJsonObject('[1,2]')).toBeNull()
  })
})

describe('L0 探针 — 整轮判档', () => {
  const perfect = async (prompt: string): Promise<string> => {
    if (prompt === PROBE_PROMPTS.structure) {
      return `{${MARKER},"entries":[{"kind":"SymbolSpec","value":{}}]}`
    }
    if (prompt === PROBE_PROMPTS.execution) {
      return "require('fs').writeFileSync('out.json', JSON.stringify({ value: 22140 }))"
    }
    return `{"value": ${String(PROBE_EXPECTED.symbolic)}}`
  }

  it('三探针全过 → S 档', async () => {
    const profile = await runCapabilityProbes(perfect)
    expect(profile.tier).toBe('S')
    expect(profile.observations).toHaveLength(3)
    expect(profile.teaching.preloadKnowledge).toBe(false)
  })

  it('结构不过 → B 档，且理由点名"结构探针未通过"', async () => {
    const profile = await runCapabilityProbes(async (prompt) => {
      if (prompt === PROBE_PROMPTS.structure) return '{"entries":[]}'
      return perfect(prompt)
    })
    expect(profile.tier).toBe('B')
    expect(profile.rationale).toContain('结构探针未通过')
    expect(profile.teaching.preloadKnowledge).toBe(true)
  })

  it('**一个探针抛异常不会中断整轮** —— 记为未通过并如实写原因', async () => {
    const profile = await runCapabilityProbes(async (prompt) => {
      if (prompt === PROBE_PROMPTS.symbolic) throw new Error('provider 524')
      return perfect(prompt)
    })
    expect(profile.observations).toHaveLength(3)
    const symbolic = profile.observations.find(o => o.kind === 'symbolic')
    expect(symbolic?.passed).toBe(false)
    expect(symbolic?.detail).toContain('provider 524')
    // 结构与执行都过了 → A 档（不是 S，因为有一个没过）。
    expect(profile.tier).toBe('A')
  })
})
