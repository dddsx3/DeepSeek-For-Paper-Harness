/**
 * Shared IR fixtures for the TASK 1 / TASK 1.25 / TASK 1.5 suites.
 *
 * `validChain()` returns the objects of one legal provenance chain in
 * dependency order, so a test that registers them all ends with a store that
 * contains a Problem → Model → Run → Result → Claim → Verification → Figure
 * graph with every reference resolving.
 *
 * TASK 1.5: `problemSpec` / `modelSpec` / `runArtifact` carry the new
 * canonical shapes (DataArtifact / RequirementSpec / SymbolSpec references
 * instead of nested free-text). New helpers `dataArtifact`,
 * `requirementSpec`, `symbolSpec`, `inputDataArtifact` and
 * `problemContractChain()` build the additional closure that exercises the
 * Problem Contract.
 *
 * Every object is returned as a fresh mutable literal: tests mutate copies to
 * build attacks, and must never mutate the module-level originals.
 */

import { ModelingIr, type IrKind } from '../../src/ir/index.ts'

// ---------------------------------------------------------------------------
// TASK 1.5 Problem Contract factories.
// ---------------------------------------------------------------------------

const SHA256_BLOB = 'a'.repeat(64)
const HASH_PREFIX = `sha256:${SHA256_BLOB}`

export function dataArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data_id: 'DA-RAW',
    role: 'RAW_PROBLEM',
    locator: 'file:///problem/2026-mcm-a.txt',
    content_hash: HASH_PREFIX,
    media_type: 'text/markdown',
    description: 'The MCM 2026 problem A statement.',
    ...overrides,
  }
}

export function inputDataArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data_id: 'DA-IN',
    role: 'INPUT_DATA',
    locator: 'file:///runs/RUN1/input.csv',
    content_hash: HASH_PREFIX,
    media_type: 'text/csv',
    description: 'Survey line observations for RUN1.',
    ...overrides,
  }
}

export function requirementSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requirement_id: 'R1',
    source_data_ref: 'DA-RAW',
    requirement_type: 'SUBPROBLEM',
    statement: 'Estimate the ice thickness profile.',
    ...overrides,
  }
}

export function requiredOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requirement_id: 'R-OUT',
    source_data_ref: 'DA-RAW',
    requirement_type: 'REQUIRED_OUTPUT',
    statement: 'Produce a thickness profile table.',
    ...overrides,
  }
}

export function constraintRequirement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requirement_id: 'R-CON',
    source_data_ref: 'DA-RAW',
    requirement_type: 'CONSTRAINT',
    statement: 'Total sensor budget must not exceed USD 200000.',
    ...overrides,
  }
}

export function variableSymbol(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol_id: 'SYM-x',
    scope_ref: 'P1',
    token: 'x',
    meaning: 'distance along track',
    unit: 'm',
    role: 'VARIABLE',
    ...overrides,
  }
}

export function parameterSymbol(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol_id: 'SYM-rho',
    scope_ref: 'P1',
    token: 'rho',
    meaning: 'ice density',
    unit: 'kg/m^3',
    role: 'PARAMETER',
    ...overrides,
  }
}

export function problemSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    problem_id: 'P1',
    raw_problem_ref: 'DA-RAW',
    requirement_refs: ['R1', 'R-OUT', 'R-CON'],
    ...overrides,
  }
}

export function modelSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: 'M1',
    problem_refs: ['P1'],
    assumptions: ['Ice is a homogeneous slab.'],
    variable_refs: ['SYM-x'],
    parameter_refs: [{ symbol_ref: 'SYM-rho', value: 917 }],
    equations: ['h(x) = a * x + b'],
    constraints: ['x >= 0'],
    objective: 'min sum((h - h_obs)^2)',
    dependencies: [],
    ...overrides,
  }
}

export function runArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: 'RUN1',
    model_ref: 'M1',
    code_ref: 'file:///runs/RUN1/main.py',
    input_data_refs: ['DA-IN'],
    environment: 'python 3.13, numpy 2.1',
    seed: 20260828,
    exit_status: 0,
    stdout_ref: 'file:///runs/RUN1/stdout.log',
    stderr_ref: 'file:///runs/RUN1/stderr.log',
    output_refs: ['file:///runs/RUN1/result.json'],
    code_hash: HASH_PREFIX,
    input_hash: HASH_PREFIX,
    output_hash: HASH_PREFIX,
    ...overrides,
  }
}

export function result(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    result_id: 'RES1',
    run_ref: 'RUN1',
    name: 'mean_thickness',
    value: 0.731,
    unit: 'm',
    uncertainty: 0.012,
    source_location: 'file:///runs/RUN1/result.json#mean_thickness',
    ...overrides,
  }
}

export function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim_id: 'C1',
    text: 'Mean ice thickness at the survey line is 0.731 m.',
    claim_type: 'NUMERIC',
    criticality: 'CRITICAL',
    numeric_binding: {
      result_ref: 'RES1',
      asserted_value: 0.731,
      asserted_unit: 'm',
    },
    evidence_refs: ['RES1'],
    result_refs: ['RES1'],
    model_refs: ['M1'],
    ...overrides,
  }
}

/**
 * TASK 2 — alternate claim factories. Every kind in the discriminated union
 * has a default-factory so fault fixtures can build any branch in one line.
 */
export function numericClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return claim(overrides)
}

export function modelClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim_id: 'C-MODEL',
    text: 'The adopted ice-flow model assumes a homogeneous slab.',
    claim_type: 'MODEL',
    criticality: 'CRITICAL',
    numeric_binding: null,
    evidence_refs: [],
    result_refs: [],
    model_refs: ['M1'],
    ...overrides,
  }
}

export function qualitativeClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim_id: 'C-QUAL',
    text: 'The survey line shows a monotonic thickness trend.',
    claim_type: 'QUALITATIVE',
    criticality: 'CRITICAL',
    numeric_binding: null,
    evidence_refs: ['RES1'],
    result_refs: [],
    model_refs: [],
    ...overrides,
  }
}

export function verificationResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verification_id: 'V1',
    target_ref: 'RES1',
    verifier: 'gate.numeric_consistency',
    status: 'PASS',
    evidence_refs: ['RES1'],
    ...overrides,
  }
}

export function figureSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    figure_id: 'F1',
    data_refs: ['RES1'],
    claim_refs: ['C1'],
    ...overrides,
  }
}

export function reviewerFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    finding_id: 'RF1',
    target_ref: 'RES1',
    attack_type: 'numeric-consistency',
    hypothesis: 'The paper body may restate RES1 with a different value.',
    reason: 'The abstract quotes 0.781 while RES1 holds 0.731.',
    evidence_refs: ['RES1'],
    proposed_check: 'Compare the abstract number against result RES1.',
    severity: 'CRITICAL',
    ...overrides,
  }
}

/** The eleven kinds with a valid object each, keyed by kind. */
export function validObjectFor(kind: IrKind): Record<string, unknown> {
  switch (kind) {
    case 'ProblemSpec': return problemSpec()
    case 'ModelSpec': return modelSpec()
    case 'RunArtifact': return runArtifact()
    case 'Result': return result()
    case 'Claim': return claim()
    case 'VerificationResult': return verificationResult()
    case 'FigureSpec': return figureSpec()
    case 'ReviewerFinding': return reviewerFinding()
    case 'DataArtifact': return dataArtifact()
    case 'RequirementSpec': return requirementSpec()
    case 'SymbolSpec': return variableSymbol()
  }
}

/** One legal chain in dependency order: every ref resolves if taken in order. */
export function validChain(): ReadonlyArray<{ kind: IrKind; value: Record<string, unknown> }> {
  return [
    { kind: 'DataArtifact', value: dataArtifact() },
    { kind: 'DataArtifact', value: inputDataArtifact() },
    { kind: 'RequirementSpec', value: requirementSpec() },
    { kind: 'RequirementSpec', value: requiredOutput() },
    { kind: 'RequirementSpec', value: constraintRequirement() },
    // ProblemSpec precedes SymbolSpec: `SymbolSpec.scope_ref` is a ProblemSpec
    // ref, and canonical ingest is append-only, so a symbol can only resolve
    // its scope once the scope itself is registered.
    { kind: 'ProblemSpec', value: problemSpec() },
    { kind: 'SymbolSpec', value: variableSymbol() },
    { kind: 'SymbolSpec', value: parameterSymbol() },
    { kind: 'ModelSpec', value: modelSpec() },
    { kind: 'RunArtifact', value: runArtifact() },
    { kind: 'Result', value: result() },
    { kind: 'Claim', value: claim() },
    { kind: 'VerificationResult', value: verificationResult() },
    { kind: 'FigureSpec', value: figureSpec() },
    { kind: 'ReviewerFinding', value: reviewerFinding() },
  ]
}

/**
 * The prefix of {@link validChain()} ending at the last occurrence of `kind`.
 *
 * Existing suites seed a partial store ("enough to hang a Result off") and
 * used to spell that as `validChain().slice(0, 3)`. That literal broke when
 * TASK 1.5 inserted four kinds ahead of ProblemSpec: the same `3` now means
 * two DataArtifacts and a RequirementSpec, which silently changes what every
 * seeded store contains. Naming the endpoint keeps the *intent* stable
 * across ontology changes.
 */
export function chainThrough(kind: IrKind): ReadonlyArray<{ kind: IrKind; value: Record<string, unknown> }> {
  const kinds = validChain().map(entry => entry.kind)
  const last = kinds.lastIndexOf(kind)
  if (last < 0) throw new Error(`chainThrough: ${kind} is not part of validChain()`)
  return validChain().slice(0, last + 1)
}

/**
 * The TASK 1.5 minimum Problem Contract plus the original TASK 1.25 backbone
 * (Problem → Model → Run → Result → Claim, with at least one CRITICAL claim).
 *
 * Executor-level suites that predate TASK 1.25 mount this so they keep
 * testing what they were written to test (context budgeting, retries, cost,
 * reviewer parsing) instead of accidentally asserting that a text-only run
 * can still be delivered.
 */
export function backboneIr(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-08-29T00:00:00.000Z' })
  for (const entry of validChain()) {
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) {
      throw new Error(`backbone fixture failed: ${entry.kind} ${JSON.stringify(verdict.failures)}`)
    }
  }
  return ir
}

/**
 * Slice of `validChain()` that carries only the TASK 1.25 backbone kinds
 * (Problem → Model → Run → Result → Claim, with at least one CRITICAL
 * claim). Useful for tests that want to assert the bridge blocks when the
 * new Problem Contract is missing.
 */
export function backboneOnlyChain(): ReadonlyArray<{ kind: IrKind; value: Record<string, unknown> }> {
  return [
    { kind: 'ProblemSpec', value: problemSpec() },
    { kind: 'ModelSpec', value: modelSpec() },
    { kind: 'RunArtifact', value: runArtifact() },
    { kind: 'Result', value: result() },
    { kind: 'Claim', value: claim() },
  ]
}
