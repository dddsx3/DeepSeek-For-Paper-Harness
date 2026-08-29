#!/usr/bin/env node
// Run the TASK 1 fault corpus (IR-001..IR-010) against the real
// `ModelingIr` store and emit per-fixture verdict files for
// `emit-fault-results.mjs` to consume.
//
// Usage: node run-fault-corpus.mjs <repo-root> <fixtures-dir>
//
// The attack logic is inlined rather than imported from the package's test
// fixtures: the fault corpus is independent evidence, so it must not go
// stale in lockstep with the fixtures it is supposed to check.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.argv[2]
const fixturesDir = process.argv[3]
if (!repoRoot || !fixturesDir) {
  console.error('usage: run-fault-corpus.mjs <repo-root> <fixtures-dir>')
  process.exit(2)
}

mkdirSync(resolve(fixturesDir), { recursive: true })

const runnerSpec = `
import { describe, expect, it } from 'vitest'
import { ModelingIr } from '${repoRoot.replace(/\\\\/g, '/')}/packages/paper/paper-foundation/src/ir/index.ts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixturesDir = ${JSON.stringify(fixturesDir)}

const problem = {
  problem_id: 'P1',
  raw_problem_ref: 'file:///problem/2026-mcm-a.txt',
  subproblems: [{ subproblem_id: 'S1', statement: 'Estimate the ice thickness profile.' }],
  required_outputs: [{ output_id: 'O1', description: 'A thickness profile table.' }],
  constraints: ['x >= 0'],
}
const model = {
  model_id: 'M1',
  problem_refs: ['P1'],
  assumptions: ['Ice is a homogeneous slab.'],
  variables: [{ symbol: 'x', meaning: 'distance along track', unit: 'm' }],
  parameters: [{ symbol: 'rho', value: 917, unit: 'kg/m^3' }],
  equations: ['h(x) = a * x + b'],
  constraints: ['x >= 0'],
  objective: 'min sum((h - h_obs)^2)',
  dependencies: [],
}
const run = {
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
}
const res = {
  result_id: 'RES1',
  run_ref: 'RUN1',
  name: 'mean_thickness',
  value: 0.731,
  unit: 'm',
  uncertainty: 0.012,
  source_location: 'file:///runs/RUN1/result.json#mean_thickness',
}
const clm = {
  claim_id: 'C1',
  text: 'Mean ice thickness at the survey line is 0.731 m.',
  claim_type: 'NUMERIC',
  criticality: 'CRITICAL',
  evidence_refs: ['RES1'],
  result_refs: ['RES1'],
  model_refs: ['M1'],
}
const fig = { figure_id: 'F1', data_refs: ['RES1'], claim_refs: ['C1'] }
const finding = {
  finding_id: 'RF1',
  target_ref: 'RES1',
  attack_type: 'numeric-consistency',
  hypothesis: 'The body may restate RES1 with a different value.',
  reason: 'The abstract quotes 0.781 while RES1 holds 0.731.',
  evidence_refs: ['RES1'],
  proposed_check: 'Compare the abstract number against result RES1.',
  severity: 'CRITICAL',
}

/** Store holding the legal Problem -> Model -> Run prefix. */
function armed() {
  const ir = new ModelingIr({ now: () => '2026-08-28T00:00:00.000Z' })
  for (const [kind, value] of [['ProblemSpec', problem], ['ModelSpec', model], ['RunArtifact', run]]) {
    if (!ir.put(kind, value).accepted) throw new Error('fixture prefix must ingest: ' + kind)
  }
  return ir
}

const verdicts = {}

/**
 * Record the outcome of one attack. The attack is BLOCKED only when the
 * object was refused AND the id never entered canonical state.
 */
function record(id, escaped) {
  verdicts[id] = escaped ? 'PASSED' : 'BLOCKED'
}

function flush() {
  for (const [id, status] of Object.entries(verdicts)) {
    writeFileSync(resolve(fixturesDir, id + '.verdict.json'), JSON.stringify({ fault_id: id, actual_status: status }, null, 2))
  }
}

describe('TASK 1 fault corpus', () => {
  it('IR-001', () => {
    const ir = armed()
    let escaped = false
    for (const text of ['{', '{"result_id": "RES1",}', "{'result_id': 'RES1'}", 'Sure! ' + JSON.stringify(res), '', 'null', '42', '[]']) {
      const v = ir.ingestJson('Result', text)
      if (v.accepted || ir.has('RES1')) escaped = true
    }
    record('IR-001', escaped)
  })

  it('IR-002', () => {
    const ir = armed()
    ir.put('Result', res)
    let escaped = false
    if (ir.put('Result', res).accepted) escaped = true
    if (ir.put('Claim', { ...clm, claim_id: 'RES1' }).accepted) escaped = true
    if (ir.put('RunArtifact', { ...run, run_id: 'RES1' }).accepted) escaped = true
    if (ir.size !== 4) escaped = true
    record('IR-002', escaped)
  })

  it('IR-003', () => {
    const ir = armed()
    ir.put('Result', res)
    const v = ir.put('Claim', { ...clm, result_refs: ['RES-GHOST'] })
    record('IR-003', v.accepted || ir.has('C1'))
  })

  it('IR-004', () => {
    const ir = armed()
    const v = ir.put('Result', { ...res, run_ref: 'RUN-GHOST' })
    record('IR-004', v.accepted || ir.has('RES1'))
  })

  it('IR-005', () => {
    const ir = armed()
    let escaped = false
    const m = ir.put('ModelSpec', { ...model, model_id: 'M9', problem_refs: ['P-GHOST'] })
    if (m.accepted || ir.has('M9')) escaped = true
    const r = ir.put('RunArtifact', { ...run, run_id: 'RUN9', model_ref: 'M-GHOST' })
    if (r.accepted || ir.has('RUN9')) escaped = true
    record('IR-005', escaped)
  })

  it('IR-006', () => {
    const ir = armed()
    ir.put('Result', res)
    const { criticality, ...noCriticality } = clm
    const v = ir.put('Claim', noCriticality)
    const atField = !v.accepted && v.failures.some(f => f.path === 'criticality')
    record('IR-006', v.accepted || ir.has('C1') || !atField)
  })

  it('IR-007', () => {
    const ir = armed()
    ir.put('Result', res)
    const v = ir.put('FigureSpec', { ...fig, data_refs: ['DATA-GHOST'] })
    record('IR-007', v.accepted || ir.has('F1'))
  })

  it('IR-008', () => {
    const ir = armed()
    const { unit, ...noUnit } = res
    const v = ir.put('Result', noUnit)
    const atField = !v.accepted && v.failures.some(f => f.path === 'unit')
    record('IR-008', v.accepted || ir.has('RES1') || !atField)
  })

  it('IR-009', () => {
    const ir = armed()
    const { exit_status, ...noExit } = { ...run, run_id: 'RUN2' }
    const v = ir.put('RunArtifact', noExit)
    const atField = !v.accepted && v.failures.some(f => f.path === 'exit_status')
    record('IR-009', v.accepted || ir.has('RUN2') || !atField)
  })

  it('IR-010', () => {
    const ir = armed()
    ir.put('Result', res)
    let escaped = false
    if (ir.ingestJson('ReviewerFinding', '{"finding_id": ').accepted) escaped = true
    if (ir.ingestJson('ReviewerFinding', 'Looks good to me!').accepted) escaped = true
    const shapes = [
      { finding_id: 'RF1' },
      { finding_id: 'RF1', target_ref: 'RES1', attack_type: 'vibes' },
      { ...finding, severity: 'PASS' },
      { ...finding, paper_passed: true },
      { ...finding, target_ref: 'GHOST' },
      'RF1 is fine',
      [],
    ]
    for (const bad of shapes) {
      if (ir.put('ReviewerFinding', bad).accepted) escaped = true
    }
    if (ir.has('RF1')) escaped = true
    record('IR-010', escaped)
  })

  it('flush verdicts', () => {
    flush()
    // The corpus must be able to FAIL, not only to emit JSON. Without this
    // assertion a green corpus run says nothing: the runner would exit 0 even
    // with every guard removed, and the evidence would live entirely in files
    // nobody re-checks (red team RT4-05).
    const escaped = Object.keys(verdicts).filter(id => verdicts[id] !== 'BLOCKED')
    expect(escaped).toEqual([])
    // Every declared fixture must have been exercised; a missing verdict file
    // would otherwise read as UNKNOWN and count as an escape downstream.
    expect(Object.keys(verdicts).sort()).toEqual([
      'IR-001', 'IR-002', 'IR-003', 'IR-004', 'IR-005',
      'IR-006', 'IR-007', 'IR-008', 'IR-009', 'IR-010',
    ])
  })
})
`

const tmpDir = resolve(repoRoot, 'packages/paper/paper-foundation/tests/.tmp-task1-fault-runner')
mkdirSync(tmpDir, { recursive: true })
const specPath = resolve(tmpDir, 'fault-runner.spec.ts')
writeFileSync(specPath, runnerSpec, 'utf8')

const res = spawnSync(
  process.execPath,
  ['./node_modules/vitest/vitest.mjs', 'run', '--project=thread-safe', specPath, '--reporter=default'],
  { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit' },
)

if (res.status !== 0) {
  console.error(`fault runner failed: exit=${res.status}`)
  process.exit(res.status ?? 1)
}
console.log('fault verdicts written under', fixturesDir)
