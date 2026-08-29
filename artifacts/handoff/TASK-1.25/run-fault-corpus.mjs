#!/usr/bin/env node
// Run the TASK 1.25 fault corpus (B-001..B-008) against the real composition
// and emit per-fixture verdict files for `emit-fault-results.mjs`.
//
// Usage: node run-fault-corpus.mjs <repo-root> <fixtures-dir>
//
// The attacks are inlined rather than imported from the package's test
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

const root = repoRoot.replace(/\\/g, '/')
mkdirSync(resolve(fixturesDir), { recursive: true })

const runnerSpec = `
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '${root}/packages/storage/storage-domain/tests/helpers/memory-backend.ts'
import PaperRuntimeGuard from '${root}/packages/paper/paper-foundation/src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '${root}/packages/paper/paper-foundation/src/runtime/profile.ts'
import {
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '${root}/packages/paper/paper-foundation/src/index.ts'
import { ModelingIr, evaluateIrBridge, irBridgeGate } from '${root}/packages/paper/paper-foundation/src/ir/index.ts'
import { CRITICAL_GATE_IDS, IR_CANONICALIZATION_GATE_ID, evaluateDelivery } from '${root}/packages/paper/paper-foundation/src/delivery/index.ts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixturesDir = ${JSON.stringify(fixturesDir)}
const AT = '2026-08-29T00:00:00.000Z'

const settings = {
  executor: { provider: 'fake', model: 'exec-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'review-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'edit-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

async function* fakeStream(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

const script = (system, prompt) => {
  if (String(system).includes('reviewer')) return '{"defects":[]}'
  if (String(prompt).includes('short numbered execution plan')) return '1. Draft the deliverable.'
  if (String(prompt).includes('Produce the deliverable')) return 'The final deliverable text.'
  return 'revised text'
}

const problem = {
  problem_id: 'P1', raw_problem_ref: 'file:///p.txt',
  subproblems: [{ subproblem_id: 'S1', statement: 'Estimate the thickness profile.' }],
  required_outputs: [{ output_id: 'O1', description: 'A thickness table.' }],
  constraints: ['x >= 0'],
}
const model = {
  model_id: 'M1', problem_refs: ['P1'], assumptions: ['Slab.'],
  variables: [{ symbol: 'x', meaning: 'distance', unit: 'm' }],
  parameters: [{ symbol: 'rho', value: 917, unit: 'kg/m^3' }],
  equations: ['h(x)=a*x+b'], constraints: ['x>=0'], objective: 'min err', dependencies: [],
}
const run = {
  run_id: 'RUN1', model_ref: 'M1', code_ref: 'file:///r/main.py',
  input_refs: ['file:///r/in.csv'], environment: 'python 3.13', seed: 1, exit_status: 0,
  stdout_ref: 'file:///r/out.log', stderr_ref: 'file:///r/err.log',
  output_refs: ['file:///r/res.json'], code_hash: 'sha256:c', input_hash: 'sha256:i', output_hash: 'sha256:o',
}
const res = {
  result_id: 'RES1', run_ref: 'RUN1', name: 'mean_thickness', value: 0.731,
  unit: 'm', uncertainty: 0.012, source_location: 'file:///r/res.json#mean',
}
const clm = {
  claim_id: 'C1', text: 'Mean thickness is 0.731 m.', claim_type: 'NUMERIC',
  criticality: 'CRITICAL', evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1'],
}

function backbone() {
  const ir = new ModelingIr({ now: () => AT })
  for (const [k, v] of [['ProblemSpec', problem], ['ModelSpec', model], ['RunArtifact', run], ['Result', res], ['Claim', clm]]) {
    if (!ir.put(k, v).accepted) throw new Error('backbone ingest failed: ' + k)
  }
  return ir
}

async function harness(ir) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...settings.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (options) => {
      const first = options.messages[0]?.content[0]
      const prompt = first !== undefined && first.type === 'text' ? first.text : ''
      return fakeStream(script(options.system ?? '', prompt))
    },
  })
  await ctx.plugin(PaperSettingsService, settings)
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  if (ir !== undefined) ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperExecutorService)
  return { ctx }
}

/**
 * Try to drive a text-only run all the way to a manifest. Returns true when
 * the run delivered anyway (escape), false when it was blocked.
 */
async function tryTextOnlyRun(ir, mode) {
  const { ctx } = await harness(ir)
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode, harnessVersion: 'test', configHash: 'sha256:test' })
  try {
    const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'solve it')
    // A manifest with a final artifact is a delivered paper.
    return Boolean(outcome.manifest.finalArtifactId)
  } catch {
    return false
  }
}

function gateSet(ir, mode, claims = [], omitCanonical = false) {
  const gates = CRITICAL_GATE_IDS.filter(id => id !== IR_CANONICALIZATION_GATE_ID)
    .map(id => ({ id, status: 'PASS', critical: true, observedAt: AT }))
  if (!omitCanonical) gates.push(irBridgeGate(ir, claims, mode, AT))
  return {
    mode, gates, staleArtifactIds: [], unresolvedReferenceIds: [],
    requiredOutputs: [], runtimeProfileValid: true,
  }
}

const verdicts = {}
const record = (id, escaped) => { verdicts[id] = escaped ? 'PASSED' : 'BLOCKED' }

function flush() {
  for (const [id, status] of Object.entries(verdicts)) {
    writeFileSync(resolve(fixturesDir, id + '.verdict.json'), JSON.stringify({ fault_id: id, actual_status: status }, null, 2))
  }
}

describe('TASK 1.25 fault corpus', () => {
  it('B-001', async () => {
    record('B-001', await tryTextOnlyRun(undefined, 'fast'))
  })

  it('B-002', async () => {
    record('B-002', await tryTextOnlyRun(undefined, 'strict'))
  })

  it('B-003', async () => {
    record('B-003', await tryTextOnlyRun(new ModelingIr(), 'fast'))
  })

  it('B-004', async () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const [k, v] of [['ProblemSpec', problem], ['ModelSpec', model], ['RunArtifact', run]]) ir.put(k, v)
    record('B-004', await tryTextOnlyRun(ir, 'fast'))
  })

  it('B-005', async () => {
    const ir = new ModelingIr({ now: () => AT })
    for (const [k, v] of [['ProblemSpec', problem], ['ModelSpec', model], ['RunArtifact', run], ['Result', res]]) ir.put(k, v)
    ir.put('Claim', { ...clm, criticality: 'NON_CRITICAL' })
    record('B-005', await tryTextOnlyRun(ir, 'fast'))
  })

  it('B-006', () => {
    // Omit the ir_canonicalization gate entirely and hope the policy does not
    // notice the hole.
    const decision = evaluateDelivery(gateSet(backbone(), 'FORMAL', [], true))
    record('B-006', decision.allowed)
  })

  it('B-007', () => {
    // A text artifact claiming to be an IR object whose ref does not exist.
    const decision = evaluateIrBridge(backbone(), [
      { artifact_id: 'A1', ir_kind: 'Result', ir_ref: 'RES-GHOST' },
    ], 'FORMAL', AT)
    record('B-007', decision.status === 'PASS')
  })

  it('B-008', () => {
    // A claim naming a real object of the wrong kind.
    const decision = evaluateIrBridge(backbone(), [
      { artifact_id: 'A1', ir_kind: 'Claim', ir_ref: 'RES1' },
    ], 'FORMAL', AT)
    record('B-008', decision.status === 'PASS')
  })

  it('flush verdicts', () => {
    flush()
    const escaped = Object.keys(verdicts).filter(id => verdicts[id] !== 'BLOCKED')
    expect(escaped).toEqual([])
    expect(Object.keys(verdicts).sort()).toEqual([
      'B-001', 'B-002', 'B-003', 'B-004', 'B-005', 'B-006', 'B-007', 'B-008',
    ])
  })
})
`

const tmpDir = resolve(repoRoot, 'packages/paper/paper-foundation/tests/.tmp-task125-fault-runner')
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
