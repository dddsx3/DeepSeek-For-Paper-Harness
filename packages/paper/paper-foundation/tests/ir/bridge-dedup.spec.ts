/**
 * TASK 1.5R — PHASE 3 — Bridge de-duplication regressions.
 *
 * After PHASE 3 the bridge is no longer a structural reference sanitizer:
 * existence + kind closure happen at the `ModelingIr.put()` boundary, so a
 * snapshot the bridge reads cannot contain a missing or wrong-kind edge.
 * These tests pin the new boundary:
 *
 *   1. **No structural failures from the bridge.** On any store that is
 *      fully closed (every declared ref resolves with the allowed kind), the
 *      bridge emits no `unresolved_reference` / `reference_kind_mismatch`
 *      contract failure. Those kinds are removed from the contract failure
 *      set entirely — asserting absence would be vacuous, so the assertions
 *      pin the semantic failures that ARE emitted on deliberately wrong
 *      stores, plus the total absence on a closed one.
 *
 *   2. **Semantic attacks still block.** "Structurally legal but semantically
 *      illegal" payloads — the store accepts the kind, the bridge blocks the
 *      role / scope / source — keep the semantic guards load-bearing:
 *      R-014 (RAW_PROBLEM slot holding an INPUT_DATA artifact),
 *      R-015 (run input holding a RAW_PROBLEM artifact),
 *      R-016 (VARIABLE slot holding a PARAMETER symbol, and vice versa),
 *      R-017 (requirement source disagreeing with the problem raw source),
 *      and the scope-ownership checks.
 *
 * Assertions are structural (`kind` + `path`) rather than reason-string
 * matches, mirroring `ref-closure.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { ModelingIr, evaluateIrBridge } from '../../src/ir/index.ts'
import { findDuplicateSymbolTokens } from '../../src/ir/problem-contract.ts'
import { validateRefFields } from '../../src/ir/refs.ts'
import type { ContractFailure } from '../../src/ir/bridge.ts'
import {
  chainThrough,
  modelSpec,
  parameterSymbol,
  requirementSpec,
  requiredOutput,
  variableSymbol,
} from './fixtures.ts'

const AT = '2026-08-30T00:00:00.000Z'

/** Ingest `chainThrough(kind)` into a fresh store, throwing on refusal. */
function seedThrough(kind: Parameters<ModelingIr['put']>[0]): ModelingIr {
  const ir = new ModelingIr({ now: () => AT })
  for (const entry of chainThrough(kind)) {
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) {
      throw new Error(`seed failed at ${entry.kind}: ${JSON.stringify(verdict.failures)}`)
    }
  }
  return ir
}

/** All contract failures of one kind, with their paths. */
function failuresOf(decision: ReturnType<typeof evaluateIrBridge>, kind: ContractFailure['kind']) {
  return decision.contractFailures.filter(f => f.kind === kind).map(f => f.path)
}

describe('PHASE 3 — the bridge emits no structural reference failures', () => {
  it('on the fully closed chain, contractFailures is empty and the bridge PASSes', () => {
    const ir = seedThrough('ReviewerFinding')
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.contractFailures).toEqual([])
    expect(decision.status).toBe('PASS')
  })

  it('semantic failures are the only contract failures the bridge can emit', () => {
    // A store that is closed but semantically wrong in every load-bearing
    // way: RAW_PROBLEM slot holding an INPUT_DATA artifact, run input holding
    // a RAW_PROBLEM artifact, and a VARIABLE slot holding a PARAMETER symbol.
    const ir = seedThrough('DataArtifact')
    ir.put('RequirementSpec', requirementSpec())
    ir.put('RequirementSpec', requiredOutput())
    ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-IN', requirement_refs: ['R1', 'R-OUT'] })
    ir.put('SymbolSpec', parameterSymbol())
    ir.put('ModelSpec', { ...modelSpec(), variable_refs: ['SYM-rho'], parameter_refs: [] })
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    // All three are semantic kinds; none is unresolved_reference /
    // reference_kind_mismatch.
    expect(decision.contractFailures.length).toBeGreaterThan(0)
    for (const failure of decision.contractFailures) {
      expect(['unbound_data_artifact', 'symbol_role_mismatch', 'cross_source_requirement']).toContain(failure.kind)
    }
    expect(decision.contractFailures.some(f => f.kind === 'unresolved_reference')).toBe(false)
    expect(decision.contractFailures.some(f => f.kind === 'reference_kind_mismatch')).toBe(false)
    expect(decision.status).toBe('BLOCKED')
  })
})

describe('R-014 — raw_problem_ref binds an INPUT_DATA artifact (kind right, role wrong)', () => {
  it('store accepts the kind; bridge blocks with unbound_data_artifact', () => {
    const ir = seedThrough('DataArtifact') // DA-RAW + DA-IN both registered
    // Raw problem ref points at DA-IN (INPUT_DATA) — kind=DataArtifact is
    // legal at commit time, role is not RAW_PROBLEM.
    expect(ir.put('RequirementSpec', requirementSpec()).accepted).toBe(true)
    expect(ir.put('RequirementSpec', requiredOutput()).accepted).toBe(true)
    expect(ir.put('ProblemSpec', {
      problem_id: 'P1',
      raw_problem_ref: 'DA-IN',
      requirement_refs: ['R1', 'R-OUT'],
    }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(failuresOf(decision, 'unbound_data_artifact')).toContain('raw_problem_ref')
  })
})

describe('R-015 — RunArtifact input_data_refs binds a RAW_PROBLEM artifact', () => {
  it('store accepts the kind; bridge blocks with unbound_data_artifact', () => {
    const ir = seedThrough('DataArtifact')
    ir.put('RequirementSpec', requirementSpec())
    ir.put('RequirementSpec', requiredOutput())
    ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R1', 'R-OUT'] })
    ir.put('SymbolSpec', variableSymbol())
    ir.put('SymbolSpec', parameterSymbol())
    ir.put('ModelSpec', modelSpec())
    // The run consumes DA-RAW (RAW_PROBLEM) as its input — kind is legal,
    // role is not INPUT_DATA.
    expect(ir.put('RunArtifact', {
      run_id: 'RUN-WRONG-ROLE',
      model_ref: 'M1',
      code_ref: 'file:///runs/RUN1/main.py',
      input_data_refs: ['DA-RAW'],
      environment: 'python 3.13',
      seed: 1,
      exit_status: 0,
      stdout_ref: 'file:///runs/RUN1/stdout.log',
      stderr_ref: 'file:///runs/RUN1/stderr.log',
      output_refs: ['file:///runs/RUN1/result.json'],
      code_hash: 'sha256:' + 'a'.repeat(64),
      input_hash: 'sha256:' + 'a'.repeat(64),
      output_hash: 'sha256:' + 'a'.repeat(64),
    }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(failuresOf(decision, 'unbound_data_artifact')).toContain('RunArtifact.RUN-WRONG-ROLE.input_data_refs.DA-RAW')
  })
})

describe('R-016 — ModelSpec symbol slots bind the wrong role', () => {
  it('variable_refs holding a PARAMETER SymbolSpec: store accepts, bridge blocks', () => {
    const ir = seedThrough('DataArtifact')
    ir.put('RequirementSpec', requirementSpec())
    ir.put('RequirementSpec', requiredOutput())
    ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R1', 'R-OUT'] })
    ir.put('SymbolSpec', parameterSymbol()) // role=PARAMETER only
    expect(ir.put('ModelSpec', { ...modelSpec(), variable_refs: ['SYM-rho'], parameter_refs: [] }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(failuresOf(decision, 'symbol_role_mismatch')).toContain('ModelSpec.M1.variable_refs.SYM-rho')
  })

  it('parameter_refs holding a VARIABLE SymbolSpec: store accepts, bridge blocks', () => {
    const ir = seedThrough('DataArtifact')
    ir.put('RequirementSpec', requirementSpec())
    ir.put('RequirementSpec', requiredOutput())
    ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R1', 'R-OUT'] })
    ir.put('SymbolSpec', variableSymbol()) // role=VARIABLE only
    expect(ir.put('ModelSpec', { ...modelSpec(), variable_refs: [], parameter_refs: [{ symbol_ref: 'SYM-x', value: 2 }] }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(failuresOf(decision, 'parameter_role_mismatch')).toContain('ModelSpec.M1.parameter_refs.SYM-x')
  })

  it('a symbol scoped to another problem is unbound, not a role mismatch', () => {
    const ir = seedThrough('DataArtifact')
    ir.put('RequirementSpec', requirementSpec())
    ir.put('RequirementSpec', requiredOutput())
    ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R1', 'R-OUT'] })
    ir.put('ProblemSpec', { problem_id: 'P2', raw_problem_ref: 'DA-RAW', requirement_refs: ['R1', 'R-OUT'] })
    // SYM-x lives in P1's scope (fixture default); the model claims P2 only.
    ir.put('SymbolSpec', variableSymbol())
    expect(ir.put('ModelSpec', {
      ...modelSpec(),
      problem_refs: ['P2'],
      model_id: 'M2',
      variable_refs: ['SYM-x'],
      parameter_refs: [],
    }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(failuresOf(decision, 'unbound_variable_symbol')).toContain('ModelSpec.M2.variable_refs.SYM-x')
  })
})

describe('R-017 — RequirementSpec source disagrees with the ProblemSpec raw source', () => {
  it('store accepts (all refs closed); bridge blocks with cross_source_requirement', () => {
    const ir = seedThrough('DataArtifact')
    // R-OUT-OTHER claims to come from DA-IN, while the problem's raw source
    // is DA-RAW. Both DataArtifacts exist, so nothing is structurally wrong.
    ir.put('RequirementSpec', requirementSpec())
    ir.put('RequirementSpec', requiredOutput({ requirement_id: 'R-OUT-OTHER', source_data_ref: 'DA-IN' }))
    expect(ir.put('ProblemSpec', {
      problem_id: 'P1',
      raw_problem_ref: 'DA-RAW',
      requirement_refs: ['R1', 'R-OUT-OTHER'],
    }).accepted).toBe(true)
    const decision = evaluateIrBridge(ir, [], 'FORMAL')
    expect(decision.status).toBe('BLOCKED')
    expect(failuresOf(decision, 'cross_source_requirement')).toContain('requirement_refs.R-OUT-OTHER')
  })
})

describe('PHASE 3 — full snapshot closure proof (store boundary)', () => {
  it('every declared ref in a closed snapshot resolves with an allowed kind', () => {
    // Walk the actual snapshot: scan every record, re-run the store's own
    // ref validation against the frozen map, and require zero problems.
    const ir = seedThrough('ReviewerFinding')
    const snapshot = ModelingIr.snapshot(ir)
    expect(snapshot).not.toBeNull()
    const problems: string[] = []
    if (snapshot !== null) {
      for (const record of snapshot.values()) {
        for (const problem of validateRefFields(record.kind, record.value, ref => snapshot.get(ref)?.kind)) {
          problems.push(`${record.kind}.${problem.path}:${problem.ref}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('M-14 — findDuplicateSymbolTokens is directly load-bearing', () => {
  // The bridge-level duplicate check is a *separate* guard from the store's
  // NFC refine: the refine keeps a non-NFC spelling out of canonical state,
  // and `findDuplicateSymbolTokens` must catch two NFC-legal SymbolSpecs that
  // share one token in one scope. This test drives the function directly so a
  // mutation that empties it is killed even though no duplicate can survive
  // ingest.
  it('reports a second SymbolSpec repeating a token in the same scope', () => {
    const duplicates = findDuplicateSymbolTokens([
      variableSymbol({ symbol_id: 'SYM-x', token: 'x' }),
      variableSymbol({ symbol_id: 'SYM-x2', token: 'x' }),
      variableSymbol({ symbol_id: 'SYM-y', token: 'y' }),
    ])
    expect(duplicates).toEqual([
      { scope_ref: 'P1', token: 'x', symbol_id: 'SYM-x2' },
    ])
  })

  it('does not report tokens that differ, even in different scopes', () => {
    const duplicates = findDuplicateSymbolTokens([
      variableSymbol({ symbol_id: 'SYM-x', token: 'x' }),
      variableSymbol({ symbol_id: 'SYM-y', token: 'y' }),
      variableSymbol({ symbol_id: 'SYM-other', token: 'x', scope_ref: 'P2' }),
    ])
    expect(duplicates).toEqual([])
  })
})
