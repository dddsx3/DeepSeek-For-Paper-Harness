import { describe, expect, it } from 'vitest'
import { IR_REF_FIELDS, validateRefFields } from '../../src/ir/index.ts'
import type { IrKind } from '../../src/ir/index.ts'
import { claim, figureSpec, modelSpec, result, runArtifact, verificationResult } from './fixtures.ts'

/** A store snapshot that only knows about these ids. */
const REGISTRY: ReadonlyMap<string, IrKind> = new Map<string, IrKind>([
  ['P1', 'ProblemSpec'],
  ['M1', 'ModelSpec'],
  ['M2', 'ModelSpec'],
  ['RUN1', 'RunArtifact'],
  ['RES1', 'Result'],
  ['C1', 'Claim'],
])

const resolve = (ref: string): IrKind | undefined => REGISTRY.get(ref)

describe('IR reference validation', () => {
  it('declares ref fields only for fields the IR can resolve', () => {
    // External locators must stay out of the table: the store would otherwise
    // demand that a filesystem path be a registered IR id.
    for (const kind of Object.keys(IR_REF_FIELDS) as IrKind[]) {
      for (const field of IR_REF_FIELDS[kind]) {
        expect(field.path).not.toBe('code_ref')
        expect(field.path).not.toBe('stdout_ref')
        expect(field.path).not.toBe('raw_problem_ref')
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

  it('reports a kind mismatch for a Figure data_ref that names a Claim', () => {
    const problems = validateRefFields('FigureSpec', figureSpec({ data_refs: ['C1'] }), resolve)
    expect(problems[0]!.resolution).toBe('kind_mismatch')
    expect(problems[0]!.actual).toBe('Claim')
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

  it('ignores external refs on RunArtifact entirely', () => {
    const value = runArtifact({
      code_ref: 'file:///nope.py',
      input_refs: ['file:///missing.csv'],
      output_refs: ['file:///missing.json'],
      stdout_ref: 'file:///missing.log',
    })
    expect(validateRefFields('RunArtifact', value, resolve)).toEqual([])
  })

  it('has nothing to check on ProblemSpec, the graph root', () => {
    expect(IR_REF_FIELDS.ProblemSpec).toEqual([])
    expect(validateRefFields('ProblemSpec', {}, resolve)).toEqual([])
  })
})
