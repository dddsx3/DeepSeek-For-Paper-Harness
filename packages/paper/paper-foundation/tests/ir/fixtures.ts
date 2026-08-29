/**
 * Shared IR fixtures for the TASK 1 suites.
 *
 * `validChain()` returns the objects of one legal provenance chain in
 * dependency order, so a test that registers them all ends with a store that
 * contains a Problem → Model → Run → Result → Claim → Verification → Figure
 * graph with every reference resolving.
 *
 * Every object is returned as a fresh mutable literal: tests mutate copies to
 * build attacks, and must never mutate the module-level originals.
 */

import { ModelingIr, type IrKind } from '../../src/ir/index.ts'

export function problemSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    problem_id: 'P1',
    raw_problem_ref: 'file:///problem/2026-mcm-a.txt',
    subproblems: [
      { subproblem_id: 'S1', statement: 'Estimate the ice thickness profile.' },
      { subproblem_id: 'S2', statement: 'Size the sensor array.' },
    ],
    required_outputs: [
      { output_id: 'O1', description: 'A thickness profile table.' },
    ],
    constraints: ['x >= 0', 'budget <= 200000'],
    ...overrides,
  }
}

export function modelSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: 'M1',
    problem_refs: ['P1'],
    assumptions: ['Ice is a homogeneous slab.'],
    variables: [{ symbol: 'x', meaning: 'distance along track', unit: 'm' }],
    parameters: [{ symbol: 'rho', value: 917, unit: 'kg/m^3' }],
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
    input_refs: ['file:///runs/RUN1/input.csv'],
    environment: 'python 3.13, numpy 2.1',
    seed: 20260828,
    exit_status: 0,
    stdout_ref: 'file:///runs/RUN1/stdout.log',
    stderr_ref: 'file:///runs/RUN1/stderr.log',
    output_refs: ['file:///runs/RUN1/result.json'],
    code_hash: 'sha256:code',
    input_hash: 'sha256:input',
    output_hash: 'sha256:output',
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
    evidence_refs: ['RES1'],
    result_refs: ['RES1'],
    model_refs: ['M1'],
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

/** The eight kinds with a valid object each, keyed by kind. */
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
  }
}

/** One legal chain in dependency order: every ref resolves if taken in order. */
export function validChain(): ReadonlyArray<{ kind: IrKind; value: Record<string, unknown> }> {
  return [
    { kind: 'ProblemSpec', value: problemSpec() },
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
 * A \`ModelingIr\` already holding the IR backbone TASK 1.25 requires for
 * delivery: Problem → Model → Run → Result → Claim, with at least one
 * CRITICAL claim.
 *
 * Executor-level suites that predate TASK 1.25 mount this so they keep
 * testing what they were written to test (context budgeting, retries, cost,
 * reviewer parsing) instead of accidentally asserting that a text-only run
 * can still be delivered.
 */
export function backboneIr(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-08-29T00:00:00.000Z' })
  for (const entry of validChain().slice(0, 5)) {
    const verdict = ir.put(entry.kind, entry.value)
    if (!verdict.accepted) throw new Error(`backbone fixture failed: ${entry.kind}`)
  }
  return ir
}
