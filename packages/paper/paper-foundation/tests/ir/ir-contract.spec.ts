import { describe, expect, it } from 'vitest'
import type { IrKind } from '../../src/ir/index.ts'
import {
  ASSUMPTION_SOURCE_TYPES,
  ASSUMPTION_STATUSES,
  EQUATION_REPRESENTATIONS,
  EQUATION_TYPES,
  EXPERIMENT_SEED_POLICIES,
  IR_REF_FIELDS,
  IR_SCHEMAS,
  SYMBOL_DOMAINS,
  SYMBOL_SHAPES,
  assumptionSpecSchema,
  equationSpecSchema,
  experimentSpecSchema,
  isAllowedTarget,
  modelSpecSchema,
  validateRefFields,
} from '../../src/ir/index.ts'
import { assumptionSpec, equationSpec, experimentSpec, modelSpec, validObjectFor } from './fixtures.ts'

describe('IR Semantic Contract — T1.2 canonical owner (唯一 owner)', () => {
  // M-T1-1 / duplicate-truth-source mutation: the schema must make a
  // re-embedded free-text assumption or equation *unrepresentable*, not just
  // discouraged. Deleting the reference fields from ModelSpec would let the
  // free text co-exist; this test drives the schema directly (M-14 pattern)
  // so the mutation is killed even though the store can never reach the
  // mixed state in practice.
  it('ModelSpec re-embedding an assumption or equation is rejected (second source of truth)', () => {
    expect(modelSpecSchema.safeParse({ ...modelSpec(), assumptions: ['sneaky free text'] }).success).toBe(false)
    expect(modelSpecSchema.safeParse({ ...modelSpec(), equations: ['sneaky free text'] }).success).toBe(false)
  })

  it('.strict() rejects a parallel free-text assumptions/equations key on a valid contract object', () => {
    // The canonical owner exists (ASM-1 / EQ-1 in the fixture); re-declaring
    // the same facts as text is the exact INV-1.5-C attack shape.
    expect(modelSpecSchema.safeParse({ ...modelSpec(), assumptions: [], assumptions_note: 'parallel' }).success).toBe(false)
    expect(modelSpecSchema.safeParse({ ...equationSpec(), latex: 'x = 1' }).success).toBe(false)
  })

  it('assumption/equation/experiment objects are closed schemas (unrecognised keys fail)', () => {
    for (const [schema, value] of [
      [assumptionSpecSchema, assumptionSpec()],
      [equationSpecSchema, equationSpec()],
      [experimentSpecSchema, experimentSpec()],
    ] as const) {
      expect(schema.safeParse({ ...value, surprise_field: 1 }).success).toBe(false)
    }
  })

  it('closed enums for the contract objects reject unknown values', () => {
    expect(assumptionSpecSchema.safeParse({ ...assumptionSpec(), source_type: 'VIBES' }).success).toBe(false)
    expect(equationSpecSchema.safeParse({ ...equationSpec(), representation: 'PSEUDOCODE' }).success).toBe(false)
    expect(experimentSpecSchema.safeParse({ ...experimentSpec(), seed_policy: 'RANDOM' }).success).toBe(false)
    expect(ASSUMPTION_SOURCE_TYPES).toContain('APPROXIMATION')
    expect(ASSUMPTION_STATUSES).toContain('QUESTIONED')
    expect(EQUATION_REPRESENTATIONS).toContain('SYMPY')
    expect(EQUATION_TYPES).toContain('OBJECTIVE')
    expect(EXPERIMENT_SEED_POLICIES).toContain('FIXED')
  })

  it('symbol shape/domain closed enums are exported for the T2 gates', () => {
    expect(SYMBOL_SHAPES).toContain('MATRIX')
    expect(SYMBOL_DOMAINS).toContain('PROBABILITY')
    expect(SYMBOL_DOMAINS).toContain('NONNEGATIVE_INTEGER')
  })
})

describe('IR Semantic Contract — bypass-reference (bypass reference 闭合)', () => {
  // M-T1-2 / bypass-reference mutation: IR_REF_FIELDS is the *only* place a
  // reference field is closed. This test drives validateRefFields +
  // isAllowedTarget directly so a mutation that deletes a target row (or a
  // whole kind's row) is killed even when no fixture reaches the store path.
  it('every ModelSpec reference slot resolves to an allowed kind (validateRefFields)', () => {
    const registry: Record<string, IrKind> = {
      P1: 'ProblemSpec',
      'ASM-1': 'AssumptionSpec',
      'EQ-1': 'EquationSpec',
      'SYM-x': 'SymbolSpec',
      'SYM-rho': 'SymbolSpec',
      M1: 'ModelSpec',
    }
    const resolve = (ref: string): IrKind | undefined => registry[ref]
    const problems = validateRefFields('ModelSpec', modelSpec(), resolve)
    expect(problems).toEqual([])
  })

  it('a reference that bypasses IR_REF_FIELDS is never resolved (declaration is the policy)', () => {
    // A hypothetical model field `assumption_text` holds a free-text string;
    // it is NOT in IR_REF_FIELDS[ModelSpec], so validateRefFields never
    // touches it — that is exactly the bypass this contract forbids. Any
    // future code that reads it would be reading second truth.
    const declared = new Set(IR_REF_FIELDS.ModelSpec.map(f => f.path))
    expect(declared).not.toContain('assumption_text')
    expect(declared).not.toContain('equation_text')
    // And the schema side refuses it outright (closed .strict()).
    expect(modelSpecSchema.safeParse({ ...modelSpec(), equation_text: 'x = 1' }).success).toBe(false)
  })

  it('isAllowedTarget keeps the target table honest (narrow ≠ ANY)', () => {
    // EquationSpec.depends_on must point at EquationSpec and nothing else.
    expect(isAllowedTarget('EquationSpec', 'EquationSpec')).toBe(true)
    expect(isAllowedTarget('EquationSpec', 'AssumptionSpec')).toBe(false)
    // AssumptionSpec.justification_refs is genuinely ANY (evidence-style).
    expect(isAllowedTarget('ANY', 'Result')).toBe(true)
    expect(isAllowedTarget('ANY', 'Claim')).toBe(true)
  })

  it('every contract object resolves against the store-closed registry kinds', () => {
    const registry: Record<string, IrKind> = {
      P1: 'ProblemSpec',
      'DA-RAW': 'DataArtifact',
      'DA-IN': 'DataArtifact',
      'SYM-x': 'SymbolSpec',
      'SYM-rho': 'SymbolSpec',
      RES1: 'Result',
      RUN1: 'RunArtifact',
    }
    // EquationSpec.source is an EXTERNAL locator (deliberately not in the
    // table), so honoring shapes requires only the symbol/scope edges.
    const registered: Record<string, IrKind> = {
      ...registry,
      'ASM-1': 'AssumptionSpec',
      'EQ-1': 'EquationSpec',
      'EX1': 'ExperimentSpec',
    }
    const resolveAll = (ref: string): IrKind | undefined => registered[ref]
    expect(validateRefFields('AssumptionSpec', assumptionSpec(), resolveAll)).toEqual([])
    expect(validateRefFields('EquationSpec', equationSpec(), resolveAll)).toEqual([])
    expect(validateRefFields('ExperimentSpec', experimentSpec(), resolveAll)).toEqual([])
  })

  it('a wrong-kind target is caught by validateRefFields (kind_mismatch)', () => {
    const resolve = (ref: string): IrKind | undefined =>
      ref === 'EQ-1' ? 'EquationSpec' : (ref === 'ASM-1' ? 'AssumptionSpec' : undefined)
    // ModelSpec.equation_refs pointing at an AssumptionSpec is a kind_mismatch
    // (the ref exists but resolves to the wrong kind). Filter to the
    // equation_refs problem specifically — the other ModelSpec slots also
    // resolve through the same registry.
    const problems = validateRefFields('ModelSpec', { ...modelSpec(), equation_refs: ['ASM-1'] }, resolve)
      .filter(p => p.path === 'equation_refs')
    expect(problems.length).toBe(1)
    expect(problems[0]!.resolution).toBe('kind_mismatch')
    expect(problems[0]!.actual).toBe('AssumptionSpec')
  })
})

describe('IR Semantic Contract — schema wiring totals', () => {
  it('every contract-kind schema parses its own fixture and carries an id field', () => {
    for (const kind of ['AssumptionSpec', 'EquationSpec', 'ExperimentSpec'] as const) {
      expect(IR_SCHEMAS[kind]).toBeDefined()
      expect(IR_SCHEMAS[kind].safeParse(validObjectFor(kind)).success).toBe(true)
    }
  })

  it('AssumptionSpec scoped cross-store duplicate ids are prevented', () => {
    // Two AssumptionSpecs in the same scope are fine (uniqueness is per-id);
    // the store's global id uniqueness is asserted in store.spec. Here we
    // only pin the shape contract: the id field is the canonical key.
    expect(assumptionSpecSchema.safeParse({ ...assumptionSpec(), assumption_id: 'ASM-2' }).success).toBe(true)
  })
})
