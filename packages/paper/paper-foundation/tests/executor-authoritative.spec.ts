/**
 * P2-1 — executor-authoritative FORMAL delivery (D7 obligation).
 *
 * The executor (not demo/run-p1-demo.mjs) is now the ONLY entry to a
 * FORMAL delivery when produceFromExecute + produceRun are mounted: the
 * EXECUTE stage runs the full production chain — deployment-owned code-run,
 * capture, dry-pass interpretation over the REAL output bytes, Result/Claim
 * minting, v1 report render — and the report text flows through the normal
 * review → FORMAL nine-gate delivery → promotion path.
 *
 * Attacks (each must be red and leave no partial Result):
 *   1. model smuggles a runnerCommand into the container run block → refused
 *      (PRODUCE_RUN_DECLARATION_INVALID; the model never chooses a command).
 *   2. interpretation reads a jsonPath that does not resolve → refused
 *      (result_source_invalid), zero partial Result writes.
 *   3. code that never produces the declared output file → capture refuses
 *      (OUTPUT_SET_MISMATCH) — nothing can claim DELIVER on an empty run.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-authoritative
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/store.ts'

const HASH = 'sha256:' + 'a'.repeat(64)

/** The POLAR-ICE container, assembled the way the EXECUTE model would emit
 *  it (only structure; the numeric value lives in the code it writes). */
function polarContainer(overrides: {
  runBlock?: Record<string, unknown>
  jsonPath?: string
  code?: string
  conclusion?: string
} = {}): string {
  const value = 0.731
  const code = overrides.code ?? [
    'const fs = require("node:fs");',
    `fs.writeFileSync("result.json", ${JSON.stringify(JSON.stringify({ mean_thickness: value }))});`,
    'console.log("run ok");',
  ].join('\n')
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'DataArtifact', value: { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///problem/polar.txt', content_hash: HASH, media_type: 'text/markdown', description: 'Estimate mean sea-ice thickness.' } },
      { kind: 'RequirementSpec', value: { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'Produce mean ice thickness.' } },
      { kind: 'ProblemSpec', value: { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] } },
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean ice thickness', unit: 'm', role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: 'estimate thickness', dependencies: [] } },
    ],
    code,
    run: {
      outputBasenames: ['result.json'],
      seed: 20260903,
      ...overrides.runBlock,
    },
    interpretations: {
      results: [
        { result_id: 'RES-OUT', name: 'mean ice thickness', source: { locator: 'result.json', jsonPath: overrides.jsonPath ?? 'mean_thickness' }, unit: 'm', uncertainty: null },
      ],
      claims: [
        { claim_id: 'C-OUT', text: `mean ice thickness is ${value} m`, claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] },
      ],
    },
    narrative: { conclusion: overrides.conclusion ?? 'Mean ice thickness is 0.731 m.', title: 'Polar ice' },
  })
}

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}

async function* stream(text: string) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

async function harness(executeText: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request: { system?: string; messages?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) => {
      const system = String(request.system ?? '')
      if (system.includes('reviewer')) return stream('{"defects":[]}')
      if (system.includes('editor')) return stream('revised text')
      const joined = (request.messages ?? [])
        .map(m => {
          const c = (m as { content?: unknown }).content
          if (typeof c === 'string') return c
          if (Array.isArray(c)) {
            return c.map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text ?? '' : '')).join('')
          }
          return ''
        })
        .join(' ')
      if (joined.includes('numbered execution plan')) return stream('1. measure along the survey line')
      if (joined.includes('Produce the deliverable')) return stream(executeText)
      console.log('AUTH-PROBE joined=', JSON.stringify(joined).slice(0,300)) 
      return stream('revised text')
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-auth-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic test', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:p21' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const }))
    .catch((error: unknown) => ({ status: 'rejected' as const, code: (error as { code?: string }).code, message: (error as { message: string }).message }))
  return { ctx, ir, engine, runId: run.id, finalRoot, outcome }
}

describe('P2-1 executor-authoritative FORMAL chain', () => {
  it('delivers POLAR-ICE end to end with Result/Claim/record in the store and a 0.731 report on disk', async () => {
    const { produceContainerInto } = await import('../src/produce/ir-producer.ts')
    const probe = produceContainerInto(new ModelingIr(), polarContainer())
    if (!probe.ok) throw new Error(`container refused: ${probe.code}: ${probe.reason}`)
    const { ir, engine, runId, finalRoot, outcome } = await harness(polarContainer())
    expect(outcome.status, JSON.stringify(outcome)).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).toContain('RunArtifact')
    expect(kinds).toContain('ExecutionRecord')
    expect(kinds).toContain('Result')
    expect(kinds).toContain('Claim')
    // The promoted final output really landed with the machine number.
    const finalDir = join(finalRoot, String(runId), 'final')
    const files = await readdir(finalDir)
    expect(files.length).toBeGreaterThan(0)
    const text = await readFile(join(finalDir, files[0]!), 'utf8')
    expect(text).toContain('0.731')
    const manifest = engine.getManifest(RunId(runId))
    expect(manifest).toBeDefined()
    expect(manifest!.informal).toBe(false)
    expect(manifest!.gates['review']).toBe(true)
  })

  it('attack 1: a model-injected runnerCommand is refused and the run is blocked with no Result', async () => {
    const { ir, engine, runId, outcome } = await harness(polarContainer({
      runBlock: { runnerCommand: ['python', '-c', 'x'] },
    }))
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).not.toContain('Result')
  })

  it('attack 2: an unresolvable interpretation jsonPath refuses with zero partial Result writes', async () => {
    const { ir, engine, runId, outcome } = await harness(polarContainer({ jsonPath: 'no.such.path' }))
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    const kinds = ir.list().map(r => r.kind)
    expect(kinds).not.toContain('Result')
  })

  it('attack 3: code that never produces the declared output cannot claim DELIVER', async () => {
    const { ir, engine, runId, outcome } = await harness(polarContainer({
      code: 'console.log("no output file written");',
    }))
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    expect(ir.list().filter(r => r.kind === 'Result')).toHaveLength(0)
  })
})
