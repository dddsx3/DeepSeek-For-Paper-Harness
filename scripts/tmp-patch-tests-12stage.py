# -*- coding: utf-8 -*-
"""一次性补丁：测试跟上 12 阶段结构（code 只写代码+铸数；新增 figure-declare）。"""
import io

def sub(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, path + ' missing: ' + old[:80]
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print('patched', path)

# ── stage-registry-handoff.spec.ts ─────────────────────────────────────────
sub('packages/paper/paper-foundation/tests/architecture/stage-registry-handoff.spec.ts', [
  ("""    expect(STAGES).toHaveLength(11)
    expect(STAGES.map(s => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])""",
   """    expect(STAGES).toHaveLength(12)
    expect(STAGES.map(s => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])"""),
  ("""    expect(DETERMINISTIC_STAGES.map(s => s.id)).toEqual(['figure', 'diagram', 'format-check', 'docx-export'])
    expect(MODEL_STAGES.map(s => s.id)).toEqual(['prob-analysis', 'modeling', 'code', 'review', 'paper', 'improve', 'format-profile'])""",
   """    // 建模代码（3）与图表声明（4）分属两个阶段；数据图渲染（5）与流程/架构图（6）也分开。
    expect(DETERMINISTIC_STAGES.map(s => s.id)).toEqual(['figure', 'diagram', 'format-check', 'docx-export'])
    expect(MODEL_STAGES.map(s => s.id)).toEqual(['prob-analysis', 'modeling', 'code', 'figure-declare', 'review', 'paper', 'improve', 'format-profile'])"""),
  ("""    expect(stageDirName(stageOf('docx-export'))).toBe('11-docx-export')""",
   """    expect(stageDirName(stageOf('docx-export'))).toBe('12-docx-export')"""),
  ("""    // 只作废序号更大的
    // seed(root, 5) 只播种了阶段 1..5 —— 序号 >2 的是 code/figure/diagram（review 是阶段 6，未播种）
    expect(stale).toEqual(['code', 'figure', 'diagram'])""",
   """    // 只作废序号更大的
    // seed(root, 5) 只播种了阶段 1..5 —— 序号 >2 的是 code/figure-declare/figure（review 是阶段 7，未播种）
    expect(stale).toEqual(['code', 'figure-declare', 'figure'])"""),
])

# ── gates.spec.ts ──────────────────────────────────────────────────────────
sub('packages/paper/paper-foundation/tests/architecture/gates.spec.ts', [
  ("""  const decls = (figures: ReadonlyArray<unknown>, results: ReadonlyArray<unknown> = [{ result_id: 'RES-A', name: 'A', value: 1, unit: '%', uncertainty: null }]): string =>
    JSON.stringify({ results, figures })""",
   """  // 声明文件只带 figures；数在阶段 3 由 harness 铸出的账本（results.json）里。
  const decls = (figures: ReadonlyArray<unknown>): string => JSON.stringify({ figures })
  const ledger = (ids: ReadonlyArray<string>): string =>
    JSON.stringify({ results: ids.map(id => ({ result_id: id, name: id, value: 1, unit: '%', uncertainty: null })) })"""),
  ("""  it('`data_refs` 悬空 → 硬失败并点名**哪一个 ref 找不到**', () => {
    const up = { 'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-GHOST'] }]) }
    const v = run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('RES-GHOST')
  })

  it('声明了但没渲染 → 硬失败；全部解析且渲染 → 0', () => {
    const good = { 'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A'] }]) }
    expect(run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, good)).code).toBe(0)
    const v = run('figure_declaration_complete', input({}, good))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('没渲染')
  })""",
   """  it('`data_refs` 悬空 → 硬失败并点名**哪一个 ref 找不到**（数的来源是铸出的账本）', () => {
    const up = {
      'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-GHOST'] }]),
      'results.json': ledger(['RES-A']),
    }
    const v = run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, up))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('RES-GHOST')
  })

  it('声明了但没渲染 → 硬失败；全部解析且渲染 → 0；**账本不在 → 2**（数不由模型持有）', () => {
    const good = {
      'FIGURE_DECLARATIONS.json': decls([{ figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A'] }]),
      'results.json': ledger(['RES-A']),
    }
    expect(run('figure_declaration_complete', input({ 'figures/fig_a.svg': '<svg/>' }, good)).code).toBe(0)
    const v = run('figure_declaration_complete', input({}, good))
    expect(v.code).toBe(1)
    expect(v.items[0]?.detail).toContain('没渲染')
    const noLedger = run('figure_declaration_complete', input({}, { 'FIGURE_DECLARATIONS.json': decls([]) }))
    expect(noLedger.code).toBe(2)
    expect(noLedger.items[0]?.detail).toContain('results.json')
  })"""),
  # style-rule tests: decls() now takes a figures array
  ("""  const decls = (caption: string): string =>
    JSON.stringify({ results: [], figures: [{ figure_id: 'fig_a', chart_type: 'line', data_refs: ['RES-A'], caption }] })""",
   """  const decls = (caption: string): string =>
    JSON.stringify({ figures: [{ figure_id: 'fig_a', chart_type: 'line', data_refs: ['RES-A'], caption }] })"""),
])

# ── stage-runner.spec.ts ───────────────────────────────────────────────────
p = 'packages/paper/paper-foundation/tests/architecture/stage-runner.spec.ts'
s = io.open(p, encoding='utf-8').read()

# imports
s = s.replace("import { deterministicRunner } from '../../src/stages/deterministic.ts'",
              "import { deterministicRunner } from '../../src/stages/deterministic.ts'\nimport { runCodeAndMintResults } from '../../src/stages/execute-and-mint.ts'", 1)

# fixture: RESULT_SOURCES replaces FIGURE_DECLARATIONS in the code stage
s = s.replace("""  if (file === 'FIGURE_DECLARATIONS.json') return figureDeclarations()""",
              """  if (file === 'RESULT_SOURCES.json') {
    return JSON.stringify({
      sources: [
        { result_id: 'RES-A', name: '指标A', locator: 'outputs.json', json_path: 'a', unit: '%' },
        { result_id: 'RES-B', name: '指标B', locator: 'outputs.json', json_path: 'b', unit: '%' },
      ],
    })
  }""", 1)

# code/main.py must be REAL python that writes outputs.json
s = s.replace("""    if (spec.id === 'code') {
      // 逐问实现：`code_parity` 要 `code/problem*.py` ≥ 题面问数。
      for (let i = 1; i <= 4; i += 1) files[`code/problem${String(i)}.py`] = `# 问题${String(i)}\\nprint(${String(i)})\\n`
    }""",
              """    if (spec.id === 'code') {
      // 逐问实现：`code_parity` 要 `code/problem*.py` ≥ 题面问数。
      for (let i = 1; i <= 4; i += 1) files[`code/problem${String(i)}.py`] = `# 问题${String(i)}\\nprint(${String(i)})\\n`
      // **真跑得起来**：afterModel 会执行 code/main.py，它必须写出 RESULT_SOURCES 声明的产物。
      files['code/main.py'] = [
        'import json',
        'json.dump({"a": 12.5, "b": 7.25}, open("outputs.json", "w"))',
        '',
      ].join('\\n')
    }""", 1)

# new figure-declare stage answer + code stage no longer carries declarations
s = s.replace("""function fakeCallModel(): StageRunContext['callModel'] {
  return async (spec) => {
    if (spec.produces.length === 1) {
      const only = spec.produces[0]!
      return fakeDeliverable(spec, only.file)
    }""",
              """function fakeCallModel(): StageRunContext['callModel'] {
  return async (spec) => {
    if (spec.id === 'figure-declare') {
      // 单产出 → 原文。只声明结构；数在阶段 3 铸出的账本里。
      return JSON.stringify({
        figures: [
          { figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A', 'RES-B'], caption: '两项指标对照', y_label: '占比 / %' },
        ],
      })
    }
    if (spec.produces.length === 1) {
      const only = spec.produces[0]!
      return fakeDeliverable(spec, only.file)
    }""", 1)

# ctxOf: wire afterModel (the REAL execute-and-mint — it really runs python)
s = s.replace("""    runDeterministic: deterministicRunner(),""",
              """    runDeterministic: deterministicRunner(),
    afterModel: (spec, root) => spec.id === 'code' ? runCodeAndMintResults(root) : Promise.resolve(),""", 1)

# 12 stages / renamed stage indices in assertions
s = s.replace("    expect(outcomes).toHaveLength(11)\n    expect(outcomes.map(o => o.stage)).toEqual(STAGES.map(s => s.id))",
              "    expect(outcomes).toHaveLength(12)\n    expect(outcomes.map(o => o.stage)).toEqual(STAGES.map(s => s.id))", 1)
s = s.replace("expect(outcomes).toHaveLength(11)", "expect(outcomes).toHaveLength(12)", 1)
s = s.replace("**阶段 4 真的渲染出了图**", "**阶段 5 真的渲染出了图**", 1)
s = s.replace("const dir = join(root, stageDirName(stageOf('figure')))", "const dir = join(root, stageDirName(stageOf('figure')))", 1)
s = s.replace("**阶段 5 的 TikZ 缺口如实标 `2`**", "**阶段 6 的 TikZ 缺口如实标 `2`**", 1)
s = s.replace("const diagram = outcomes.find(o => o.stage === 'diagram')", "const diagram = outcomes.find(o => o.stage === 'diagram')", 1)
s = s.replace("**阶段 11 真的导出了 docx**", "**阶段 12 真的导出了 docx**", 1)
s = s.replace("expect(passport?.status).toBe('passed')\n    expect(Object.keys(passport?.artifacts ?? {})).toContain('paper/main.docx')",
              "expect(passport?.status).toBe('passed')\n    expect(Object.keys(passport?.artifacts ?? {})).toContain('paper/main.docx')", 1)
s = s.replace("**阶段 10 就地修复后仍留下改动前的副本**", "**阶段 11 就地修复后仍留下改动前的副本**", 1)
s = s.replace("const dir = join(root, stageDirName(stageOf('docx-export')))", "const dir = join(root, stageDirName(stageOf('docx-export')))", 1)
# stage 3 fixture texts used by the envelope test
s = s.replace("""        'RESULTS.md': 'x',
        'DELIVERABLES.json': '{}',
        'FIGURE_DECLARATIONS.json': '{}',
      },
    }))
    expect(out.get('code/problem1.py')).toBe('print(1)')""",
              """        'RESULTS.md': 'x',
        'DELIVERABLES.json': '{}',
        'RESULT_SOURCES.json': '{}',
      },
    }))
    expect(out.get('code/problem1.py')).toBe('print(1)')""", 1)
s = s.replace("""      files: { 'code/main.py': 'x', 'RESULTS.md': 'x', 'DELIVERABLES.json': '{}', 'FIGURE_DECLARATIONS.json': '{}', 'notes/other.md': 'y' },""",
              """      files: { 'code/main.py': 'x', 'RESULTS.md': 'x', 'DELIVERABLES.json': '{}', 'RESULT_SOURCES.json': '{}', 'notes/other.md': 'y' },""", 1)
# figure declarations moved to stage 4; the stage-4 executor reads the ledger
s = s.replace("""function figureDeclarations(): string {
  return JSON.stringify({
    results: [
      { result_id: 'RES-A', name: '指标A', value: 12.5, unit: '%', uncertainty: null },
      { result_id: 'RES-B', name: '指标B', value: 7.25, unit: '%', uncertainty: 0.4 },
    ],
    figures: [
      { figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A', 'RES-B'], caption: '两项指标对照', y_label: '占比 / %' },
    ],
  })
}""",
"""// 阶段 4（figure-declare）的声明：只有结构；数在阶段 3 铸出的账本里。
function figureDeclarations(): string {
  return JSON.stringify({
    figures: [
      { figure_id: 'fig_a', chart_type: 'bar', data_refs: ['RES-A', 'RES-B'], caption: '两项指标对照', y_label: '占比 / %' },
    ],
  })
}""", 1)
# the figure-declare stage's single produce returns raw text via fakeDeliverable — wire it
s = s.replace("""  if (file === 'RESULT_SOURCES.json') {""",
              """  if (file === 'FIGURE_DECLARATIONS.json') return figureDeclarations()
  if (file === 'RESULT_SOURCES.json') {""", 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('patched', p)
print('PART2 OK')
