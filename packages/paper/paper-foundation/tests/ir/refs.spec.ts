import {  describe,  expect,  it  } from 'vitest'
import {  IR_REF_FIELDS,  splitCompositeRef,  validateRefFields  } from '../../src/ir/index.ts'
import type {  IrKind  } from '../../src/ir/index.ts'
import {  claim,  figureSpec,  modelSpec,  result,  runArtifact,  verificationResult  } from './fixtures.ts'

/** A store snapshot that only knows about these ids. */
const REGISTRY: ReadonlyMap<string, IrKind> = new Map<string, IrKind>([
  ['P1', 'ProblemSpec'],
  ['M1', 'ModelSpec'],
  ['M2', 'ModelSpec'],
  ['RUN1', 'RunArtifact'],
  ['RES1', 'Result'],
  ['C1', 'Claim'],
  ['DA-RAW', 'DataArtifact'],
  ['DA-IN', 'DataArtifact'],
  ['SYM-x', 'SymbolSpec'],
  ['SYM-rho', 'SymbolSpec'],
  // TASK-T1: the model fixture references AssumptionSpec ASM-1 and
  // EquationSpec EQ-1 by id.
  ['ASM-1', 'AssumptionSpec'],
  ['EQ-1', 'EquationSpec'],
])

const resolve = (ref: string): IrKind | undefined => REGISTRY.get(ref)

describe('IR reference validation', () => {
  it('declares ref fields only for fields the IR can resolve', () => {
    // External locators must stay out of the table: the store would otherwise
    // demand that a filesystem path be a registered IR id. TASK 1.5R moved
    // `raw_problem_ref` INTO the table: it is an IR-internal reference to a
    // canonical DataArtifact, not a filesystem path.
    for (const kind of Object.keys(IR_REF_FIELDS) as IrKind[]) {
      for (const field of IR_REF_FIELDS[kind]) {
        expect(field.path).not.toBe('code_ref')
        expect(field.path).not.toBe('stdout_ref')
        expect(field.path).not.toBe('stderr_ref')
        expect(field.path).not.toBe('input_refs')
        expect(field.path).not.toBe('output_refs')
      }
    }
  })

  it('accepts a fully resolving object', () => {
    expect(validateRefFields('Result', result(), resolve)).toEqual([])
    expect(validateRefFields('Claim', claim(), resolve)).toEqual([])
    expect(validateRefFields('FigureSpec', figureSpec(), resolve)).toEqual([])
  })

  it('reports a missing single ref', () => {
    const problems = validateRefFields('Result', result({ run_ref: 'RUN-NOPE' }), resolve)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toEqual({
      path: 'run_ref', ref: 'RUN-NOPE', target: 'RunArtifact', resolution: 'missing', actual: null,
    })
  })

  it('reports a missing ref inside an array, with the array path', () => {
    const problems = validateRefFields('Claim', claim({ result_refs: ['RES1', 'RES-NOPE'] }), resolve)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.path).toBe('result_refs')
    expect(problems[0]!.ref).toBe('RES-NOPE')
    expect(problems[0]!.resolution).toBe('missing')
  })

  it('reports every dangling ref at once rather than the first only', () => {
    const problems = validateRefFields(
      'Claim',
      claim({ result_refs: ['A', 'B'], model_refs: ['C'], evidence_refs: ['D'] }),
      resolve,
    )
    expect(problems.map(p => p.ref)).toEqual(['D', 'A', 'B', 'C'])
  })

  it('reports a kind mismatch when the ref exists but points at the wrong kind', () => {
    const problems = validateRefFields('Result', result({ run_ref: 'M1' }), resolve)
    expect(problems[0]).toEqual({
      path: 'run_ref', ref: 'M1', target: 'RunArtifact', resolution: 'kind_mismatch', actual: 'ModelSpec',
    })
  })

  it('delegates the Figure data_ref union to the contract guard', () => {
    // TASK 1.5R: `FigureSpec.data_refs` is the closed narrow union
    // `Result | DataArtifact`, declared on the store boundary — the per-element
    // kind check lives in the table itself. `ANY`-style targets are reserved
    // for evidence-style refs; known unions are enumerated, not collapsed.
    expect(validateRefFields('FigureSpec', figureSpec({ data_refs: ['RES1'] }), resolve)).toEqual([])
    // A Claim is neither a Result nor a DataArtifact, so the union rejects it.
    expect(validateRefFields('FigureSpec', figureSpec({ data_refs: ['C1'] }), resolve)[0]!.resolution).toBe('kind_mismatch')
    // Existence is still required: the union never relaxes the existence check.
    expect(validateRefFields('FigureSpec', figureSpec({ data_refs: ['NOPE'] }), resolve)).toEqual([
      { path: 'data_refs', ref: 'NOPE', target: ['Result', 'DataArtifact'], resolution: 'missing', actual: null },
    ])
  })

  it('accepts ANY-target refs from any registered kind', () => {
    expect(validateRefFields('VerificationResult', verificationResult({ target_ref: 'RUN1' }), resolve)).toEqual([])
    expect(validateRefFields('VerificationResult', verificationResult({ target_ref: 'C1' }), resolve)).toEqual([])
  })

  it('still rejects an unregistered ref on an ANY-target field', () => {
    const problems = validateRefFields('VerificationResult', verificationResult({ target_ref: 'NOPE' }), resolve)
    expect(problems[0]!.resolution).toBe('missing')
  })

  it('resolves ModelSpec problem_refs and dependencies with kind checks', () => {
    expect(validateRefFields('ModelSpec', modelSpec({ problem_refs: ['P1'], dependencies: ['M2'] }), resolve)).toEqual([])
    expect(validateRefFields('ModelSpec', modelSpec({ problem_refs: ['M2'] }), resolve)[0]!.resolution).toBe('kind_mismatch')
    expect(validateRefFields('ModelSpec', modelSpec({ dependencies: ['RUN1'] }), resolve)[0]!.resolution).toBe('kind_mismatch')
  })

  it('resolves ModelSpec variable_refs and nested parameter symbol_refs', () => {
    // TASK 1.5R: variables and parameters are closed against SymbolSpec.
    expect(validateRefFields('ModelSpec', modelSpec(), resolve)).toEqual([])
    expect(validateRefFields('ModelSpec', modelSpec({ variable_refs: ['M1'] }), resolve)[0]!.resolution).toBe('kind_mismatch')
    const problems = validateRefFields('ModelSpec', modelSpec({ parameter_refs: [{ symbol_ref: 'RUN1', value: 1 }] }), resolve)
    expect(problems[0]!.path).toBe('parameter_refs.0.symbol_ref')
    expect(problems[0]!.resolution).toBe('kind_mismatch')
  })

  it('closes RunArtifact model_ref and input_data_refs, ignores external locators', () => {
    // `code_ref` / `input_refs` / `output_refs` / `stdout_ref` / `stderr_ref`
    // are external locators: never resolved against the store. But
    // `model_ref` and `input_data_refs` are IR-internal (TASK 1.5R).
    const value = runArtifact({
      code_ref: 'file:///nope.py',
      input_refs: ['file:///missing.csv'],
      output_refs: ['file:///missing.json'],
      stdout_ref: 'file:///missing.log',
    })
    expect(validateRefFields('RunArtifact', value, resolve)).toEqual([])
    expect(validateRefFields('RunArtifact', runArtifact({ input_data_refs: ['RUN1'] }), resolve)[0]!.resolution)
      .toBe('kind_mismatch')
    expect(validateRefFields('RunArtifact', runArtifact({ input_data_refs: ['NOPE'] }), resolve)[0]!.resolution)
      .toBe('missing')
  })

  it('closes ProblemSpec against the canonical store (TASK 1.5R)', () => {
    // TASK 1.5R moved `raw_problem_ref` / `requirement_refs` into the closed
    // table: the graph root is no longer "nothing to check".
    expect(IR_REF_FIELDS.ProblemSpec.map(f => f.path)).toEqual(['raw_problem_ref', 'requirement_refs'])
    expect(validateRefFields('ProblemSpec', { raw_problem_ref: 'DA-RAW', requirement_refs: [] }, resolve)).toEqual([])
    expect(validateRefFields('ProblemSpec', { raw_problem_ref: 'M1', requirement_refs: [] }, resolve)[0]!.resolution)
      .toBe('kind_mismatch')
    expect(validateRefFields('ProblemSpec', { raw_problem_ref: 'DA-RAW', requirement_refs: ['NOPE'] }, resolve)[0]!.resolution)
      .toBe('missing')
  })
})

// ---------------------------------------------------------------------------
// W8.11-D1 — explicit null is LEGAL; a missing reference still is not
// ---------------------------------------------------------------------------

describe('W8.11-D1 — null tolerance + composite paths', () => {
  it('COUNTER-EXAMPLE 1: an explicit null passes (it means "does not apply")', () => {
    // 事故（C2 实测）：`required_output_ref: null` 落到 `resolve(null)` →
    // `Map.get(null)` → undefined → 报 `unresolved_reference`。于是
    // **schema 放行、下游拒绝**，且失败原因伪装成"引用不存在"——最难诊断的形态。
    // 修法：显式 null 短路。**不放松判定**：不存在的引用仍然必须拒（见下一条）。
    expect(validateRefFields('ProblemSpec', { raw_problem_ref: null, requirement_refs: [] }, resolve)).toEqual([])
    // nested 分支同样容忍
    expect(validateRefFields('ModelSpec', modelSpec({ assumption_refs: [], equation_refs: [], parameter_refs: [{ symbol_ref: null }] } as never), resolve)).toEqual([])
  })

  it('COUNTER-EXAMPLE 2: an existing path passes (composite ref)', () => {
    // 规格用的形式是 `Result:RES1.value`（`CAPABILITY-SCHEMA.md:78`）。此前
    // **全仓无解析器**，`Map.get('Result:RES1.value')` 恒 undefined → 整个
    // 示例按字面 ingest 会全部失败。
    const problems = validateRefFields('Claim', claim({ result_refs: ['Result:RES1.value'] } as never), resolve)
    expect(problems, JSON.stringify(problems)).toEqual([])
    // and the plain form is unchanged (zero behaviour change for existing refs)
    expect(validateRefFields('Claim', claim({ result_refs: ['RES1'] }), resolve)).toEqual([])
  })

  it('COUNTER-EXAMPLE 3: a missing path gives a DISTINGUISHABLE error', () => {
    // 判据要求：失败原因必须能区分"引用为 null（合法）"与"引用不存在（非法）"。
    const problems = validateRefFields('Claim', claim({ result_refs: ['Result:RES-NOPE.value'] } as never), resolve)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.resolution).toBe('missing')
    // 报的是**对象 id**，不是整条复合串——否则读者看不出缺的是哪一半
    expect(problems[0]!.ref).toBe('RES-NOPE')
    expect(problems[0]!.ref).not.toContain(':')
  })

  it('a composite ref that LIES about its kind is caught', () => {
    // `Result:RES1` 说自己是 Result——若该字段要求的是别的 kind，必须拒。
    const problems = validateRefFields('Claim', claim({ result_refs: ['ProblemSpec:P1'] } as never), resolve)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.resolution).toBe('kind_mismatch')
    expect(problems[0]!.actual).toBe('ProblemSpec')
  })

  it('a non-kind prefix is NOT treated as a composite (no silent mangling)', () => {
    // 规格的另一个例子是 `run_output:result1.xlsx!C2`——`run_output` **不是**
    // IR kind，它是外部定位符。若把任何含冒号的串都当复合引用，就会把合法的
    // id 悄悄改写成别的东西。
    const problems = validateRefFields('RunArtifact', runArtifact({ code_ref: 'run_output:result1.xlsx!C2' }), resolve)
    // code_ref is an external locator (never resolved) — proves the prefix
    // logic did not turn it into an IR reference.
    expect(problems).toEqual([])
  })

  it('splitCompositeRef parses the spec form and leaves plain ids alone', () => {
    expect(splitCompositeRef('Result:RES1.value')).toEqual({ kind: 'Result', id: 'RES1', path: 'value' })
    expect(splitCompositeRef('Result:RES1')).toEqual({ kind: 'Result', id: 'RES1', path: undefined })
    expect(splitCompositeRef('P1')).toEqual({ kind: undefined, id: 'P1', path: undefined })
    expect(splitCompositeRef('run_output:a.xlsx!C2')).toEqual({ kind: undefined, id: 'run_output:a.xlsx!C2', path: undefined })
  })
})
