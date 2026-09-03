import {  describe,  expect,  it  } from 'vitest'
import {  IR_REF_FIELDS,  validateRefFields  } from '../../src/ir/index.ts'
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
