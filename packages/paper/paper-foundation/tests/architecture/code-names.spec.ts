/**
 * 名字一致性分析（`code-names.ts`）—— 门禁 `code_name_consistency` 与阶段 3 分片的
 * **单片自检**共用同一份判据。
 *
 * 这里既测判据本身，也测**它被两边共用**这件事：判据分叉（门禁一套、分片自检另一套）
 * 会让"分片自查通过但门禁仍拦"或反过来，那比没有自检更糟。
 */

import { describe, expect, it } from 'vitest'
import { CODE_PY_RE, definitionsIn, undefinedConstNames } from '../../src/stages/code-names.ts'
import { runGates, type GateInput } from '../../src/stages/gates.ts'

describe('CODE_PY_RE —— 判据作用的文件形态', () => {
  it('只认 code/ 下的 .py（与门禁逐字一致）', () => {
    expect(CODE_PY_RE.test('code/problem1.py')).toBe(true)
    expect(CODE_PY_RE.test('code/main.py')).toBe(true)
    expect(CODE_PY_RE.test('code/sub/deep.py')).toBe(false)
    expect(CODE_PY_RE.test('problem1.py')).toBe(false)
    expect(CODE_PY_RE.test('code/params.txt')).toBe(false)
  })
})

describe('definitionsIn —— 哪些写法算"定义了一个名字"', () => {
  it('赋值 / def / class / import / for / with-as / except-as 都算', () => {
    const src = [
      'A = 1',
      'B: float = 2',
      'def f(): pass',
      'class C: pass',
      'import numpy',
      'from params import *',
      'for I in range(3): pass',
      'with open("x") as F: pass',
      'try: pass',
      'except ValueError as E: pass',
    ].join('\n')
    const d = definitionsIn(src)
    for (const n of ['A', 'B', 'f', 'C', 'numpy', 'I', 'F', 'E']) expect(d.has(n), n).toBe(true)
  })
})

describe('undefinedConstNames —— 判据本身（含**零误报**用例）', () => {
  it('引用了任何文件都没定义的常量 → 报出该文件与名字', () => {
    const f = undefinedConstNames([['code/problem4.py', 'x = Q4_SCENARIO_NODE_COUNT + 1\n']])
    expect(f).toEqual([{ file: 'code/problem4.py', names: ['Q4_SCENARIO_NODE_COUNT'] }])
  })

  it('在**别的文件**里定义过 → 不算未定义（`params.py` 是共享契约）', () => {
    const f = undefinedConstNames([
      ['code/params.py', 'Q4_SCENARIO_NODE_COUNT = 8\n'],
      ['code/problem4.py', 'x = Q4_SCENARIO_NODE_COUNT\n'],
    ])
    expect(f).toEqual([])
  })

  it('在**本文件**里定义过 → 不算未定义', () => {
    const f = undefinedConstNames([['code/problem4.py', 'Q4_SCENARIO_NODE_COUNT = 8\nx = Q4_SCENARIO_NODE_COUNT\n']])
    expect(f).toEqual([])
  })

  it('**零误报**：属性访问（`source.Q2_COUNT`）不是裸名字', () => {
    const f = undefinedConstNames([['code/problem4.py', 'x = source.Q2_EFFECTIVE_STRATEGY_COUNT\n']])
    expect(f).toEqual([])
  })

  it('**零误报**：注释/字符串/三引号里的名字不算引用', () => {
    const src = [
      '# Q4_SCENARIO_NODE_COUNT 待补',
      'note = "Q4_SCENARIO_NODE_COUNT"',
      '"""',
      'Q4_SCENARIO_NODE_COUNT',
      '"""',
      'x = 1',
    ].join('\n')
    expect(undefinedConstNames([['code/problem4.py', src]])).toEqual([])
  })

  it('**零误报**：小写名字与短名字不在判据里（只查全大写且 ≥4 字符的常量形态）', () => {
    expect(undefinedConstNames([['code/p.py', 'x = q4_count + ABC + AB\n']])).toEqual([])
  })

  it('没有 `code/*.py` 时返回空（调用方自己去判"无法判定"）', () => {
    expect(undefinedConstNames([['RESULTS.md', 'Q4_X']])).toEqual([])
  })
})

describe('门禁与分片自检**共用同一份判据**（防判据分叉）', () => {
  const gate = (files: Record<string, string>) => runGates(['code_name_consistency'], {
    files: new Map(Object.entries(files)), upstream: new Map(), problemCount: 4,
  } as GateInput)

  it('同一组文件，两边结论一致（有未定义名）', () => {
    const files = { 'code/problem4.py': 'x = Q4_SCENARIO_NODE_COUNT\n' }
    expect(undefinedConstNames(Object.entries(files)).length).toBe(1)
    expect(gate(files).code).toBe(1)
  })

  it('同一组文件，两边结论一致（干净）', () => {
    const files = { 'code/params.py': 'Q4_SCENARIO_NODE_COUNT = 8\n', 'code/problem4.py': 'x = Q4_SCENARIO_NODE_COUNT\n' }
    expect(undefinedConstNames(Object.entries(files))).toEqual([])
    expect(gate(files).code).toBe(0)
  })
})
