#!/usr/bin/env node
// Run the TASK 0 fault corpus (D-001..D-008) against the actual
// `evaluateDelivery` + `promoteCandidateToDeliverable` implementation and
// emit per-fixture verdict files for `emit-fault-results.mjs` to consume.
//
// Usage: node run-fault-corpus.mjs <repo-root> <fixtures-dir>
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.argv[2]
const fixturesDir = process.argv[3]
if (!repoRoot || !fixturesDir) {
  console.error('usage: run-fault-corpus.mjs <repo-root> <fixtures-dir>')
  process.exit(2)
}

// We use vitest in a one-off mode: a tiny test file we generate on the
// fly that loads the fixtures, runs each attack in-process, and writes the
// verdict files. This keeps the attack logic in TypeScript and avoids
// duplicating the policy logic in a `.mjs` script.
const verdictDir = resolve(fixturesDir)
mkdirSync(verdictDir, { recursive: true })

const runnerSpec = `
import { describe, it } from 'vitest'
import {
  CRITICAL_GATE_IDS,
  evaluateDelivery,
  makeCandidateArtifact,
  promoteCandidateToDeliverable,
  type DeliveryPolicy,
  type GateRecord,
} from '${repoRoot.replace(/\\\\/g, '/')}/packages/paper/paper-foundation/src/delivery/index.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixturesDir = ${JSON.stringify(fixturesDir)}

function allPassingGates(): GateRecord[] {
  return CRITICAL_GATE_IDS.map(id => ({
    id,
    status: 'PASS' as const,
    critical: true,
    observedAt: '2026-08-28T00:00:00.000Z',
  }))
}

function policy(overrides: Partial<DeliveryPolicy> = {}): DeliveryPolicy {
  return {
    mode: 'FORMAL',
    gates: allPassingGates(),
    staleArtifactIds: [],
    unresolvedReferenceIds: [],
    requiredOutputs: [],
    runtimeProfileValid: true,
    ...overrides,
  }
}

function writeVerdict(id: string, status: 'BLOCKED' | 'PASSED' | 'UNKNOWN') {
  writeFileSync(resolve(fixturesDir, id + '.verdict.json'), JSON.stringify({ fault_id: id, actual_status: status }, null, 2))
}

describe('TASK 0 fault corpus', () => {
  it('D-001', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'reference_validation')
    gates[idx] = { ...gates[idx]!, status: 'FAIL', reason: 'missing Result[3]' }
    const d = evaluateDelivery(policy({ gates }))
    writeVerdict('D-001', d.allowed ? 'PASSED' : 'BLOCKED')
  })

  it('D-002', () => {
    const d = evaluateDelivery(policy({ staleArtifactIds: ['art-7'] }))
    writeVerdict('D-002', d.allowed ? 'PASSED' : 'BLOCKED')
  })

  it('D-003', () => {
    const d = evaluateDelivery(policy({ unresolvedReferenceIds: ['Result[3]'] }))
    writeVerdict('D-003', d.allowed ? 'PASSED' : 'BLOCKED')
  })

  it('D-004', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'provenance')
    gates[idx] = { ...gates[idx]!, status: 'FAIL', reason: 'no evidence' }
    const d = evaluateDelivery(policy({ gates }))
    writeVerdict('D-004', d.allowed ? 'PASSED' : 'BLOCKED')
  })

  it('D-005', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'numeric_consistency')
    gates[idx] = { ...gates[idx]!, status: 'FAIL' }
    const d = evaluateDelivery(policy({ mode: 'FAST', gates }))
    writeVerdict('D-005', d.allowed ? 'PASSED' : 'BLOCKED')
  })

  it('D-006', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'execution')
    gates[idx] = { ...gates[idx]!, status: 'FAIL', reason: 'exit 2' }
    const d = evaluateDelivery(policy({ gates }))
    writeVerdict('D-006', d.allowed ? 'PASSED' : 'BLOCKED')
  })

  it('D-007', async () => {
    const candidate = makeCandidateArtifact({
      id: 'art-7', createdAt: '2026-08-28T00:00:00.000Z', contentHash: 'sha256:7',
    })
    const p = policy({ requiredOutputs: [{ id: 'paper.pdf', covered: false }] })
    const d = evaluateDelivery(p)
    let writeCalls = 0
    const r = await promoteCandidateToDeliverable(
      candidate, p, d,
      { audit: () => {}, now: () => '2026-08-28T00:02:00.000Z', writeFinalOutput: async () => { writeCalls++ } },
      '/out/x', 'P',
    )
    const blocked = !r.ok && writeCalls === 0
    writeVerdict('D-007', blocked ? 'BLOCKED' : 'PASSED')
  })

  it('D-008', () => {
    const gates = allPassingGates()
    const idx = gates.findIndex(g => g.id === 'provenance')
    gates[idx] = { ...gates[idx]!, status: 'BLOCKED', reason: 'unparseable' }
    const d = evaluateDelivery(policy({ gates }))
    writeVerdict('D-008', d.allowed ? 'PASSED' : 'BLOCKED')
  })
})
`

const tmpDir = resolve(repoRoot, 'packages/paper/paper-foundation/tests/.tmp-fault-runner')
mkdirSync(tmpDir, { recursive: true })
const specPath = resolve(tmpDir, 'fault-runner.spec.ts')
writeFileSync(specPath, runnerSpec, 'utf8')

const res = spawnSync(
  process.execPath,
  [
    './node_modules/vitest/vitest.mjs',
    'run',
    specPath,
    '--reporter=default',
  ],
  { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit' },
)

if (res.status !== 0) {
  console.error(`fault runner failed: exit=${res.status}`)
  process.exit(res.status ?? 1)
}
console.log('fault verdicts written under', fixturesDir)
