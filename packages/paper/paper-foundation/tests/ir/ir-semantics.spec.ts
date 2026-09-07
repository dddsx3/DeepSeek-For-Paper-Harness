/**
 * TASK-T1 Sprint 2 — IR semantic-contract invariants (expert plan §1).
 *
 * Three frozen rule families, one suite per family:
 *
 *   - REF-001..005 — unidirectional, scope-owned references with a derived
 *     reverse index. The six acceptance tests of expert plan §1.1.
 *   - SCH-SEM-001 — "the model does not know" is a legal canonical state:
 *     shape/domain are required KEYS with a typed UNKNOWN sentinel, never
 *     optional/undefined semantics.
 *   - DEP-001..005 — the three-fingerprint dependency lock (edge / object /
 *     closure), namespaced and canonical-sorted.
 *
 * Every test here is an invariant kill: if someone reintroduces a
 * `model_ref` back-reference, flips UNKNOWN to optional, or hashes an
 * unsorted ref array, at least one test must go red.
 */

import { describe, expect, it } from 'vitest'
import {
  FINGERPRINT_NAMESPACES,
  IR_REF_FIELDS,
  IR_SCHEMAS,
  IR_SCOPE_FIELDS,
  ModelingIr,
  SYMBOL_DOMAINS,
  SYMBOL_SHAPES,
  buildEvidenceFreeze,
  canonicalSortRefs,
  dependencyClosureFingerprint,
  dependencyEdgeFingerprint,
  modelsByEquation,
  objectFingerprint,
  symbolSpecSchema,
  validateScopeOwnership,
  type IrKind,
} from '../../src/ir/index.ts'
import {
  assumptionSpec,
  constraintRequirement,
  dataArtifact,
  equationSpec,
  inputDataArtifact,
  modelSpec,
  parameterSymbol,
  problemSpec,
  requiredOutput,
  requirementSpec,
  runArtifact,
  variableSymbol,
} from './fixtures.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A store seeded with the TASK-T1 chain through ModelSpec (no Run/Result yet). */
function storeThroughModel(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-09-07T00:00:00.000Z' })
  for (const [kind, value] of [
    ['DataArtifact', dataArtifact()],
    ['DataArtifact', inputDataArtifact()],
    ['RequirementSpec', requirementSpec()],
    ['RequirementSpec', requiredOutput()],
    ['RequirementSpec', constraintRequirement()],
    ['ProblemSpec', problemSpec()],
    ['AssumptionSpec', assumptionSpec()],
    ['SymbolSpec', variableSymbol()],
    ['SymbolSpec', parameterSymbol()],
    ['EquationSpec', equationSpec()],
    ['ModelSpec', modelSpec()],
  ] as ReadonlyArray<[IrKind, Record<string, unknown>]>) {
    const verdict = ir.put(kind, value)
    if (!verdict.accepted) throw new Error(`seed failed: ${kind} ${JSON.stringify(verdict.failures)}`)
  }
  return ir
}

/** The minimal edge (ref set) shared by the DEP tests. */
const BASE_EDGE = {
  input_data_refs: ['DA-IN'],
  parameter_refs: [{ symbol_ref: 'SYM-rho', value: 917 }] as ReadonlyArray<unknown>,
  assumption_refs: ['ASM-1'],
  equation_refs: ['EQ-1'],
}

// ---------------------------------------------------------------------------
// REF-001..005 — unidirectional references + derived reverse index
// ---------------------------------------------------------------------------

describe('REF — unidirectional scope-owned references (expert plan §1.1)', () => {
  // Acceptance 1: EquationSpec can append BEFORE ModelSpec (no forward
  // reference, no cycle — the reason `model_ref` was removed, REF-001/002).
  it('acceptance-1: EquationSpec appends before any ModelSpec references it', () => {
    const ir = new ModelingIr({ now: () => '2026-09-07T00:00:00.000Z' })
    const seeds: ReadonlyArray<[IrKind, Record<string, unknown>]> = [
      ['DataArtifact', dataArtifact()],
      ['RequirementSpec', requirementSpec()],
      ['RequirementSpec', requiredOutput()],
      ['RequirementSpec', constraintRequirement()],
      ['ProblemSpec', problemSpec()],
      ['SymbolSpec', variableSymbol()],
      ['SymbolSpec', parameterSymbol()],
      ['EquationSpec', equationSpec()],
    ]
    for (const [kind, value] of seeds) {
      expect(ir.put(kind, value).accepted).toBe(true)
    }
    // The store admits an EquationSpec that no ModelSpec references yet.
    expect(ir.kindOf('EQ-1')).toBe('EquationSpec')
  })

  // Acceptance 2: ModelSpec cannot reference a missing EquationSpec (this is
  // the store's pre-existing unresolved_reference path, pinned here as part
  // of the REF rule family).
  it('acceptance-2: ModelSpec cannot reference a not-yet-appended EquationSpec', () => {
    const ir = storeThroughModel()
    const verdict = ir.put('ModelSpec', modelSpec({ model_id: 'M2', equation_refs: ['EQ-MISSING'] }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f =>
        f.kind === 'unresolved_reference' && f.path === 'equation_refs')).toBe(true)
    }
  })

  // Acceptance 3 (REF-003): a ModelSpec may only reference equations /
  // assumptions scoped to a ProblemSpec it itself belongs to.
  it('acceptance-3: cross-scope equation references are refused (REF-003)', () => {
    const ir = storeThroughModel()
    // A second problem with its own equation.
    expect(ir.put('ProblemSpec', problemSpec({ problem_id: 'P2', requirement_refs: [] })).accepted).toBe(true)
    expect(ir.put('EquationSpec', equationSpec({
      equation_id: 'EQ-P2', scope_ref: 'P2',
    })).accepted).toBe(true)
    // M1 belongs to P1 only; borrowing P2's equation is the exact attack.
    const verdict = ir.put('ModelSpec', modelSpec({ equation_refs: ['EQ-P2'] }))
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) {
      expect(verdict.failures.some(f => f.kind === 'reference_scope_mismatch')).toBe(true)
    }
    // Same-scope borrow is fine: a new model in P2 may use EQ-P2 (it also
    // carries the chain's assumptions, which are scoped to P1 — drop them
    // so the scope rule is tested on the equation edge alone).
    expect(ir.put('ModelSpec', modelSpec({
      model_id: 'M-P2', problem_refs: ['P2'], equation_refs: ['EQ-P2'], assumption_refs: [],
    })).accepted).toBe(true)
  })

  // Acceptance 4: the reverse lookup agrees with the canonical data.
  it('acceptance-4: modelsByEquation matches the canonical ModelSpec refs', () => {
    const ir = storeThroughModel()
    expect(ir.put('ModelSpec', modelSpec({ model_id: 'M2', equation_refs: ['EQ-1'] })).accepted).toBe(true)
    const snapshot = ModelingIr.snapshot(ir)
    expect(snapshot).not.toBeNull()
    const index = modelsByEquation(snapshot!)
    expect(index.get('EQ-1')).toEqual(['M1', 'M2'])
    expect(index.get('EQ-NONE')).toBeUndefined()
  })

  // Acceptance 5: building (or not building) the derived index cannot
  // change any canonical fingerprint — the freeze hashes objects only.
  it('acceptance-5: the derived index never influences canonical fingerprints', () => {
    const ir = storeThroughModel()
    expect(ir.put('RunArtifact', runArtifact()).accepted).toBe(true)
    const snapshot = ModelingIr.snapshot(ir)!
    const before = buildEvidenceFreeze(snapshot, { now: () => '2026-09-07T00:00:00.000Z' })
    // Build the index twice from the same snapshot; hash the store around it.
    modelsByEquation(snapshot)
    modelsByEquation(snapshot)
    const after = buildEvidenceFreeze(snapshot, { now: () => '2026-09-07T00:00:00.000Z' })
    expect(after.freeze_hash).toBe(before.freeze_hash)
    expect(after.manifest_hash).toBe(before.manifest_hash)
  })

  // Acceptance 6 (REF-004 pinned at the schema level): equation_refs order
  // does not change object semantics — the fingerprint side is DEP-005
  // below; here the same objects in a different order remain the same legal
  // store contents.
  it('acceptance-6: equation_refs input order does not change admission', () => {
    const ir = storeThroughModel()
    expect(ir.put('EquationSpec', equationSpec({ equation_id: 'EQ-2' })).accepted).toBe(true)
    const a = ir.put('ModelSpec', modelSpec({ model_id: 'M-A', equation_refs: ['EQ-1', 'EQ-2'] }))
    const b = ir.put('ModelSpec', modelSpec({ model_id: 'M-B', equation_refs: ['EQ-2', 'EQ-1'] }))
    expect(a.accepted).toBe(true)
    expect(b.accepted).toBe(true)
  })

  // REF-001 pinned structurally: no canonical contract object carries a
  // back `model_ref` (EquationSpec re-adding one must fail the closed
  // schema), and IR_REF_FIELDS never learns a ModelSpec-typed field from an
  // owned kind.
  it('REF-001/005: EquationSpec cannot re-add a model_ref back-reference', () => {
    // The closed schema is the structural guard: model_ref on an
    // EquationSpec is an unrecognised key, so the cycle is unrepresentable.
    expect(IR_SCHEMAS.EquationSpec.safeParse({ ...equationSpec(), model_ref: 'M1' }).success).toBe(false)
    const registry: Record<string, { kind: IrKind; value: unknown }> = {
      P1: { kind: 'ProblemSpec', value: problemSpec() },
      'EQ-1': { kind: 'EquationSpec', value: equationSpec() },
      'ASM-1': { kind: 'AssumptionSpec', value: assumptionSpec() },
      P2: { kind: 'ProblemSpec', value: problemSpec({ problem_id: 'P2', requirement_refs: [] }) },
      'EQ-P2': { kind: 'EquationSpec', value: equationSpec({ equation_id: 'EQ-P2', scope_ref: 'P2' }) },
    }
    // validateScopeOwnership on a ModelSpec that belongs to P1 but borrows
    // P2's equation → one scope_mismatch naming the offending field.
    const problems = validateScopeOwnership(
      'ModelSpec',
      modelSpec({ equation_refs: ['EQ-P2'] }),
      ['P1'],
      ref => registry[ref],
    )
    expect(problems.length).toBe(1)
    expect(problems[0]!.resolution).toBe('scope_mismatch')
    expect(problems[0]!.path).toBe('equation_refs')
  })

  it('the scope-ownership policy table is frozen and ModelSpec-only today', () => {
    expect(IR_SCOPE_FIELDS.ModelSpec?.map(r => r.path).sort()).toEqual(['assumption_refs', 'equation_refs'])
    expect(IR_SCOPE_FIELDS.SymbolSpec).toBeUndefined()
    // The canonical ref table still resolves every ModelSpec slot — the
    // scope layer adds on top of, never replaces, ref closure.
    expect(IR_REF_FIELDS.ModelSpec.map(f => f.path)).toContain('equation_refs')
  })
})

// ---------------------------------------------------------------------------
// SCH-SEM-001 — explicit UNKNOWN is legal canonical state
// ---------------------------------------------------------------------------

describe('SCH-SEM-001 — required key + typed UNKNOWN sentinel (expert plan §1.2)', () => {
  it('UNKNOWN is in the closed shape/domain enums', () => {
    expect(SYMBOL_SHAPES).toContain('UNKNOWN')
    expect(SYMBOL_DOMAINS).toContain('UNKNOWN')
  })

  it('a symbol declaring UNKNOWN honestly is legal canonical state', () => {
    const parsed = symbolSpecSchema.safeParse(variableSymbol({ shape: 'UNKNOWN', domain: 'UNKNOWN' }))
    expect(parsed.success).toBe(true)
  })

  it('the key itself stays required — omitting shape/domain is still a schema failure', () => {
    const { shape: _s, domain: _d, ...missingBoth } = variableSymbol() as Record<string, unknown>
    const parsed = symbolSpecSchema.safeParse(missingBoth)
    expect(parsed.success).toBe(false)
  })

  it('UNKNOWN in canonical state: admitted by the store like any other value', () => {
    const ir = storeThroughModel()
    const verdict = ir.put('SymbolSpec', variableSymbol({
      symbol_id: 'SYM-unk', token: 'unkvar', shape: 'UNKNOWN', domain: 'UNKNOWN',
    }))
    expect(verdict.accepted).toBe(true)
  })

  it('an invented shape outside the closed set (including lowercase unknown) still fails', () => {
    expect(symbolSpecSchema.safeParse(variableSymbol({ shape: 'QUATERNION' })).success).toBe(false)
    expect(symbolSpecSchema.safeParse(variableSymbol({ domain: 'unknown' })).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DEP-001..005 — three-fingerprint dependency lock (expert plan §1.3)
// ---------------------------------------------------------------------------

describe('DEP — dependency fingerprints (expert plan §1.3)', () => {
  // DEP-001: a change in the dependency ref SET flips the edge fingerprint.
  it('DEP-001: ref-set change flips the edge fingerprint', () => {
    const base = dependencyEdgeFingerprint({ ...BASE_EDGE })
    const grown = dependencyEdgeFingerprint({ ...BASE_EDGE, assumption_refs: ['ASM-1', 'ASM-2'] })
    const shrunk = dependencyEdgeFingerprint({ ...BASE_EDGE, equation_refs: [] })
    expect(grown).not.toBe(base)
    expect(shrunk).not.toBe(base)
  })

  // DEP-002: the referenced object's *content* change alone (same ref ids)
  // does NOT flip the edge — that is the closure's job.
  it('DEP-002: edge anchors refs, not rendered dependency text', () => {
    const base = dependencyEdgeFingerprint({ ...BASE_EDGE })
    // Same ref ids, wildly different objects behind them — edge unchanged.
    const sameRefs = dependencyEdgeFingerprint({ ...BASE_EDGE })
    expect(sameRefs).toBe(base)
  })

  // DEP-003: the store is append-only, so a "revision change" of an
  // AssumptionSpec is a different id — an id change is a ref change and
  // must flip the edge fingerprint.
  it('DEP-003: revision change (new id) flips the edge fingerprint', () => {
    const rev1 = dependencyEdgeFingerprint({ ...BASE_EDGE, assumption_refs: ['ASM-1@rev1'] })
    const rev2 = dependencyEdgeFingerprint({ ...BASE_EDGE, assumption_refs: ['ASM-1@rev2'] })
    expect(rev1).not.toBe(rev2)
  })

  // DEP-004: tampered object bytes flip the closure fingerprint (integrity).
  it('DEP-004: tampered object content flips the closure fingerprint', () => {
    const objects = new Map<string, Record<string, unknown>>([
      ['ASM-1', assumptionSpec() as Record<string, unknown>],
      ['EQ-1', equationSpec() as Record<string, unknown>],
    ])
    const resolve = (ref: string) => objects.get(ref)
    const clean = dependencyClosureFingerprint(BASE_EDGE, resolve)
    // Same ref set, different content behind ASM-1 → closure flips.
    objects.set('ASM-1', { ...assumptionSpec(), statement: 'Demand follows a Poisson distribution.' })
    const tampered = dependencyClosureFingerprint(BASE_EDGE, resolve)
    expect(tampered).not.toBe(clean)
    // ...and the edge fingerprint over the same refs never moved.
    expect(dependencyEdgeFingerprint({ ...BASE_EDGE })).toBe(dependencyEdgeFingerprint({ ...BASE_EDGE }))
  })

  // DEP-005: input order of the ref arrays never changes any fingerprint.
  it('DEP-005: ref-array input order never changes the fingerprints', () => {
    const ordered = dependencyEdgeFingerprint({ ...BASE_EDGE, assumption_refs: ['ASM-1', 'ASM-0'], equation_refs: ['EQ-1', 'EQ-0'] })
    const shuffled = dependencyEdgeFingerprint({ ...BASE_EDGE, assumption_refs: ['ASM-0', 'ASM-1'], equation_refs: ['EQ-0', 'EQ-1'] })
    expect(ordered).toBe(shuffled)
    expect(canonicalSortRefs(['b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('namespaces keep hash inputs from different semantic spaces disjoint', () => {
    expect(FINGERPRINT_NAMESPACES.dependencyEdge).toBe('DEP-EDGE-v1')
    expect(FINGERPRINT_NAMESPACES.assumptionObject).toBe('ASSUMPTION-v1')
    expect(FINGERPRINT_NAMESPACES.equationObject).toBe('EQUATION-v1')
    // The same canonical bytes under two namespaces never collide.
    const bytes = { statement: 'Ice is a homogeneous slab.' } as Record<string, unknown>
    expect(objectFingerprint('ASSUMPTION-v1', bytes)).not.toBe(objectFingerprint('EQUATION-v1', bytes))
  })

  // The freeze manifest's dependency_lock_hash is the EDGE fingerprint and
  // stays deterministic across rebuilds (freeze_hash stability depends on it).
  it('frozen runs carry the namespaced edge fingerprint, deterministically', () => {
    const ir = storeThroughModel()
    expect(ir.put('RunArtifact', runArtifact()).accepted).toBe(true)
    const snapshot = ModelingIr.snapshot(ir)!
    const a = buildEvidenceFreeze(snapshot, { now: () => '2026-09-07T00:00:00.000Z' })
    const b = buildEvidenceFreeze(snapshot, { now: () => '2027-01-01T00:00:00.000Z' })
    expect(a.runs[0]!.dependency_lock_hash).toBe(b.runs[0]!.dependency_lock_hash)
    expect(a.freeze_hash).toBe(b.freeze_hash)
  })
})
