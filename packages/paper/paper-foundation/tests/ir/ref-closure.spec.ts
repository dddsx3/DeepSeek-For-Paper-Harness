/**
 * TASK 1.5R — PHASE 0 — Structural reference closure regressions (R-001..R-013).
 *
 * Every test in this file asserts one structural reference attack against the
 * canonical `ModelingIr.put()` verdict, *not* against the delivery bridge. The
 * bridge is allowed to also flag the same payload, but the point of TASK 1.5R
 * is to restore the store boundary the way TASK 1 originally defined it: any
 * IR-internal missing or wrong-kind reference must be refused at commit time.
 *
 * The first 13 cases (R-001..R-013) are the external review's listed attacks.
 * Each test name carries the same id so a failure log points straight at the
 * gate. Seeding uses `chainThrough(kind)` so the baseline is always a *closed*
 * canonical chain — under PHASE 1's store boundary every object before the
 * attack already resolves. That keeps the failure reason attributable to the
 * field under attack alone.
 *
 * Assertions are structural (`kind` + `path` on `failuresOf(verdict)`) instead
 * of matching the exact reason sentence, so the regressions stay stable when
 * a diagnostic string is reworded.
 *
 * Naming convention:
 *   R-NNN  test id (mirrors the table in HANDOVER.md §2.5)
 *   kind   the kind being put()
 *   path   the field under attack
 *   target the ref that violates existence / kind closure
 */
import {  describe,  expect,  it  } from 'vitest'
import {  ModelingIr,  type IrIngestVerdict,  type IrFailure  } from '../../src/ir/index.ts'
import {
  dataArtifact,
  modelSpec,
  runArtifact,
  chainThrough,
} from './fixtures.ts'

/** Seed a fresh store with `chainThrough(kind)`, throwing if any seed fails. */
function seedThrough(kind: Parameters<ModelingIr['put']>[0]): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
  for (const entry of chainThrough(kind)) {
    const verdict = ir.put(entry.kind, entry.value) as IrIngestVerdict
    if (!verdict.accepted) {
      throw new Error(`seed failed at ${entry.kind}: ${JSON.stringify(failuresOf(verdict))}`)
    }
  }
  return ir
}

/** Whether `failures` contains a failure of `kind` anchored at `path`. */
function hasFailure(
  failures: ReadonlyArray<IrFailure>,
  kind: IrFailure['kind'],
  path: string,
): boolean {
  return failures.some(f => f.kind === kind && f.path === path)
}

/**
 * Discriminate the ingest verdict so the rejected-branch `failures`
 * field is reachable from plain (non-control-flow) test code. The
 * union member that carries `failures` is only the `accepted: false`
 * one; reading it unconditionally on the union is a type error, so the
 * helper surfaces `[]` on the accepted branch (where the failure
 * assertion below is false either way).
 */
function failuresOf(verdict: IrIngestVerdict): ReadonlyArray<IrFailure> {
  const v: IrIngestVerdict = verdict
  return v.accepted ? [] : v.failures
}

describe('R-001 — ProblemSpec.raw_problem_ref points at an unregistered id', () => {
  it('store refuses with unresolved_reference', () => {
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    const verdict = ir.put('ProblemSpec', {
      problem_id: 'P1',
      raw_problem_ref: 'DA-DOES-NOT-EXIST',
      requirement_refs: [],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'unresolved_reference', 'raw_problem_ref')).toBe(true)
    expect(ir.has('P1')).toBe(false)
  })
})

describe('R-002 — ProblemSpec.requirement_refs points at an unregistered id', () => {
  it('store refuses with unresolved_reference', () => {
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    // A closed raw_problem_ref but a dangling requirement_ref: the gap is
    // purely the requirement_ref closure.
    ir.put('DataArtifact', dataArtifact())
    const verdict = ir.put('ProblemSpec', {
      problem_id: 'P1',
      raw_problem_ref: 'DA-RAW',
      requirement_refs: ['R-DOES-NOT-EXIST'],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'unresolved_reference', 'requirement_refs')).toBe(true)
    expect(ir.has('P1')).toBe(false)
  })
})

describe('R-003 — ProblemSpec.requirement_refs points at a DataArtifact (kind mismatch)', () => {
  it('store refuses with reference_kind_mismatch', () => {
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    // A DataArtifact is fully registrable, but it is not a RequirementSpec —
    // so the failure must be attributed to kind mismatch, not existence.
    ir.put('DataArtifact', dataArtifact())
    const verdict = ir.put('ProblemSpec', {
      problem_id: 'P1',
      raw_problem_ref: 'DA-RAW',
      requirement_refs: ['DA-RAW'],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'reference_kind_mismatch', 'requirement_refs')).toBe(true)
  })
})

describe('R-004 — ModelSpec.variable_refs points at an unregistered id', () => {
  it('store refuses with unresolved_reference', () => {
    const ir = seedThrough('ProblemSpec')
    const verdict = ir.put('ModelSpec', {
      ...modelSpec(),
      model_id: 'M2',
      variable_refs: ['SYM-DOES-NOT-EXIST'],
      parameter_refs: [],
      dependencies: [],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'unresolved_reference', 'variable_refs')).toBe(true)
  })
})

describe('R-005 — ModelSpec.variable_refs points at a Result (kind mismatch)', () => {
  it('store refuses with reference_kind_mismatch', () => {
    const ir = seedThrough('Result')
    const verdict = ir.put('ModelSpec', {
      ...modelSpec(),
      model_id: 'M-WRONG-KIND',
      variable_refs: ['RES1'],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'reference_kind_mismatch', 'variable_refs')).toBe(true)
  })
})

describe('R-006 — parameter_refs[].symbol_ref points at an unregistered id', () => {
  it('store refuses with unresolved_reference at a stable nested path', () => {
    const ir = seedThrough('ProblemSpec')
    const verdict = ir.put('ModelSpec', {
      ...modelSpec(),
      model_id: 'M-PARAM-MISSING',
      parameter_refs: [{ symbol_ref: 'SYM-DOES-NOT-EXIST', value: 1 }],
      dependencies: [],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    // The path must be stable and nested so the audit trail names the exact
    // offender (parameter_refs.<index>.symbol_ref).
    expect(hasFailure(failuresOf(verdict), 'unresolved_reference', 'parameter_refs.0.symbol_ref')).toBe(true)
  })
})

describe('R-007 — parameter_refs[].symbol_ref points at a DataArtifact (kind mismatch)', () => {
  it('store refuses with reference_kind_mismatch', () => {
    const ir = seedThrough('ProblemSpec')
    const verdict = ir.put('ModelSpec', {
      ...modelSpec(),
      model_id: 'M-PARAM-WRONG',
      parameter_refs: [{ symbol_ref: 'DA-RAW', value: 1 }],
      dependencies: [],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'reference_kind_mismatch', 'parameter_refs.0.symbol_ref')).toBe(true)
  })
})

describe('R-008 — RunArtifact.input_data_refs points at an unregistered id', () => {
  it('store refuses with unresolved_reference', () => {
    const ir = seedThrough('ModelSpec')
    const verdict = ir.put('RunArtifact', {
      ...runArtifact(),
      run_id: 'RUN-MISSING-INPUT',
      input_data_refs: ['DA-DOES-NOT-EXIST'],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'unresolved_reference', 'input_data_refs')).toBe(true)
  })
})

describe('R-009 — RunArtifact.input_data_refs points at a Result (kind mismatch)', () => {
  it('store refuses with reference_kind_mismatch', () => {
    const ir = seedThrough('Result')
    const verdict = ir.put('RunArtifact', {
      ...runArtifact(),
      run_id: 'RUN-RESULT-AS-INPUT',
      input_data_refs: ['RES1'],
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'reference_kind_mismatch', 'input_data_refs')).toBe(true)
  })
})

describe('R-010 — FigureSpec.data_refs points at a ModelSpec (kind mismatch)', () => {
  it('store refuses with reference_kind_mismatch', () => {
    const ir = seedThrough('ModelSpec')
    const verdict = ir.put('FigureSpec', {
      figure_id: 'F-WRONG-KIND',
      data_refs: ['M1'],
      claim_refs: [],
      data_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'reference_kind_mismatch', 'data_refs')).toBe(true)
  })
})

describe('R-011 — FigureSpec.data_refs points at an unregistered id', () => {
  it('store refuses with unresolved_reference', () => {
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    const verdict = ir.put('FigureSpec', {
      figure_id: 'F-MISSING',
      data_refs: ['DA-DOES-NOT-EXIST'],
      claim_refs: [],
      data_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(false)
    expect(hasFailure(failuresOf(verdict), 'unresolved_reference', 'data_refs')).toBe(true)
  })
})

describe('R-012 — FigureSpec.data_refs → Result is accepted (legal union member)', () => {
  it('store accepts', () => {
    const ir = seedThrough('Result')
    const verdict = ir.put('FigureSpec', {
      figure_id: 'F-RESULT',
      data_refs: ['RES1'],
      claim_refs: [],
      data_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(true)
  })
})

describe('R-013 — FigureSpec.data_refs → DataArtifact is accepted (legal union member)', () => {
  it('store accepts', () => {
    const ir = new ModelingIr({ now: () => '2026-08-30T00:00:00.000Z' })
    ir.put('DataArtifact', dataArtifact())
    const verdict = ir.put('FigureSpec', {
      figure_id: 'F-DATAARTIFACT',
      data_refs: ['DA-RAW'],
      claim_refs: [],
      data_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }) as IrIngestVerdict
    expect(verdict.accepted).toBe(true)
  })
})
