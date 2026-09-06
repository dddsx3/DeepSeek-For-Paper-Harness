/**
 * TASK-PW W4 — NONE/DRIFT separation + retry budgets (W-B sign-off A).
 *
 * The five-way failure classification (NONE / DRIFT / ESCAPE / RUN /
 * TRANSPORT) gives each class its own retry semantics on the producing
 * EXECUTE path:
 *
 *   NONE     — no usable container at all (prose/empty/non-JSON). NONE ≠
 *              错: the harness GUIDES the retry (layer options + the layer's
 *              minimal example) for a budget of 2; exhaustion records the
 *              failure and steps the protocol tier down T1 → T2 → T3.
 *   DRIFT    — container-shaped output that drifted from the declaration
 *              domain (schema/run-block/locator/interpretation). Retry
 *              carries a field-level correction naming only the offending
 *              field + the registered id table, same budget.
 *   ESCAPE   — a W1 impossibility (content_hash, input-asset domain,
 *              re-declared registered id). ZERO budget: the run fails on
 *              the first refusal, no retry (W4 attack 1: ESCAPE 后重试 → 拒).
 *   RUN/TRANSPORT — execution/environment failures keep the legacy loop.
 *
 * Red-team leaves:
 *   1. ESCAPE (content_hash) → run fails immediately, one provider call,
 *      audit `escape_refused`, tier unchanged.
 *   2. NONE forever → budget 2 spent (3 attempts), run fails, audit
 *      `tier_degraded` T1→T2, never admitted (W4 attack 2).
 *   3. NONE then a guided-correct container → completes (NONE ≠ 错: the
 *      guidance prompt carries the minimal example).
 *   4. DRIFT (schema violation) then a corrected container → completes;
 *      the guidance prompt names only the offending field + the id table.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-tier
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  failureClassOf,
  noneGuide,
  driftCorrection,
  NONE_RETRY_BUDGET,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/store.ts'

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

/** The POLAR-ICE model-face container (W1: only SymbolSpec + ModelSpec). */
function polarContainer(): string {
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean ice thickness', unit: 'm', role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: 'estimate thickness', dependencies: [] } },
    ],
    code: [
      'const fs = require("node:fs");',
      'fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
      'console.log("run ok");',
    ].join('\n'),
    run: { outputBasenames: ['result.json'], seed: 20260903 },
    interpretations: {
      results: [
        { result_id: 'RES-OUT', name: 'mean ice thickness', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm', uncertainty: null },
      ],
      claims: [
        { claim_id: 'C-OUT', text: 'mean ice thickness is 0.731 m', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] },
      ],
    },
    narrative: { conclusion: 'Mean ice thickness is 0.731 m.', title: 'Polar ice' },
  })
}

/** An ESCAPE: a model-declared DataArtifact carrying content_hash (F-A). */
function escapeContainer(): string {
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'DataArtifact', value: { data_id: 'DA-OUT', locator: 'result.json', content_hash: `sha256:${'b'.repeat(64)}` } },
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean ice thickness', unit: 'm', role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: 'estimate thickness', dependencies: [] } },
    ],
    code: [
      'const fs = require("node:fs");',
      'fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
      'console.log("run ok");',
    ].join('\n'),
    run: { outputBasenames: ['result.json'], seed: 20260903 },
    interpretations: {
      results: [{ result_id: 'RES-OUT', name: 'mean ice thickness', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm' }],
    },
    narrative: { conclusion: 'Mean ice thickness is 0.731 m.', title: 'Polar ice' },
  })
}

/** A DRIFT: the ModelSpec omits the required `dependencies` array. */
function driftContainer(): string {
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean ice thickness', unit: 'm', role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: 'estimate thickness' } },
    ],
    code: [
      'const fs = require("node:fs");',
      'fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
      'console.log("run ok");',
    ].join('\n'),
    run: { outputBasenames: ['result.json'], seed: 20260903 },
    interpretations: {
      results: [{ result_id: 'RES-OUT', name: 'mean ice thickness', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm' }],
    },
    narrative: { conclusion: 'Mean ice thickness is 0.731 m.', title: 'Polar ice' },
  })
}

/**
 * A provider whose EXECUTE output comes from a queue of strings (the first
 * non-plan call consumes one). Records every prompt it saw so a test can
 * assert the guidance was actually carried on the retry.
 */
function queuedProvider(outputs: string[]) {
  const seen: string[] = []
  let cursor = 0
  return {
    seen,
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request: { system?: string; messages?: Array<{ content?: unknown }> }) => {
      const system = String(request.system ?? '')
      if (system.includes('reviewer')) return stream('{"defects":[]}')
      if (system.includes('editor')) return stream('revised text')
      const joined = (request.messages ?? [])
        .map((m) => {
          const c = (m as { content?: unknown }).content
          if (typeof c === 'string') return c
          if (Array.isArray(c)) return c.map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text ?? '' : '')).join('')
          return ''
        })
        .join(' ')
      seen.push(joined)
      if (joined.includes('numbered execution plan')) return stream('1. measure along the survey line')
      if (joined.includes('ir-container-v1') || joined.includes('Produce the deliverable')) {
        const out = outputs[Math.min(cursor, outputs.length - 1)]
        cursor += 1
        return stream(out ?? '')
      }
      return stream('revised text')
    },
  } as never
}

interface HarnessResult {
  ctx: Context
  ir: ModelingIr
  engine: unknown
  runId: string
  outcome: { status: 'resolved' } | { status: 'rejected'; code?: string; message: string }
}

async function harness(outputs: string[]): Promise<HarnessResult> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', queuedProvider(outputs))
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-tier-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic test', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:wtier' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const }))
    .catch((error: unknown) => ({ status: 'rejected' as const, code: (error as { code?: string }).code, message: (error as { message: string }).message }))
  return { ctx, ir, engine, runId: String(run.id), finalRoot, outcome }
}

describe('W4 failure classes — unit mapping', () => {
  it('classifies the five classes with exact codes', () => {
    expect(failureClassOf('hash_field_forbidden')).toBe('ESCAPE')
    expect(failureClassOf('input_asset_domain')).toBe('ESCAPE')
    expect(failureClassOf('registered_id_redeclared')).toBe('ESCAPE')
    expect(failureClassOf('schema_violation')).toBe('DRIFT')
    expect(failureClassOf('PRODUCE_RUN_DECLARATION_INVALID')).toBe('DRIFT')
    expect(failureClassOf('RECORD_INVALID')).toBe('RUN')
    expect(failureClassOf('CODE_RUN_NOT_CONFIGURED')).toBe('RUN')
    expect(failureClassOf('SERVER')).toBe('TRANSPORT')
    expect(failureClassOf('HTTP_503')).toBe('TRANSPORT')
  })

  it('splits parse_failed by the raw text: prose is NONE, JSON-shaped is DRIFT', () => {
    expect(failureClassOf('parse_failed', 'I will think carefully about the ice.')).toBe('NONE')
    expect(failureClassOf('parse_failed', '')).toBe('NONE')
    expect(failureClassOf('parse_failed', '{"__dsh_paper":"ir-container-v1"}')).toBe('DRIFT')
    expect(failureClassOf('parse_failed', undefined)).toBe('NONE')
  })

  it('guidance text carries the layer options and the registered id table', () => {
    expect(noneGuide()).toContain('ir-container-v1')
    expect(noneGuide()).toContain('DA-RAW')
    expect(noneGuide()).toContain('SymbolSpec')
    const correction = driftCorrection("entry 'ModelSpec' violates its closed IR schema — dependencies: required")
    expect(correction).toContain("entry 'ModelSpec' violates its closed IR schema — dependencies: required")
    expect(correction).toContain('DA-RAW')
  })

  it('grants the W-B NONE budget (2 guided retries)', () => {
    expect(NONE_RETRY_BUDGET).toBe(2)
  })
})

describe('W4 red-team leaves on the producing EXECUTE path', () => {
  it('attack 1: an ESCAPE (content_hash) is refused with zero budget — one call, no retry, run failed', async () => {
    const { ctx, ir, engine, runId, outcome } = await harness([escapeContainer(), polarContainer()])
    expect(outcome.status).toBe('rejected')
    const engineRef = engine as { getRun(id: unknown): { status: string } | undefined }
    expect(engineRef.getRun(RunId(runId))?.status).toBe('failed')
    // Zero budget: the second queued output (a legal container) was never
    // requested — the provider saw exactly one EXECUTE call.
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit).toContain('escape_refused')
    expect(audit).not.toContain('provider_retry')
    // No model-written IR on top of the harness-registered input assets.
    expect(ir.list().filter(r => r.kind === 'ModelSpec')).toHaveLength(0)
  })

  it('attack 2: NONE forever spends the budget (3 attempts) then fails and degrades T1→T2', async () => {
    const { ctx, engine, runId, outcome } = await harness([
      'I will reason carefully about the ice.', // prose = NONE
      'The mean thickness is 0.731 m.',         // prose = NONE
      'Still thinking…',                        // prose = NONE
      polarContainer(),                          // never reached
    ])
    expect(outcome.status).toBe('rejected')
    const engineRef = engine as { getRun(id: unknown): { status: string } | undefined }
    expect(engineRef.getRun(RunId(runId))?.status).toBe('failed')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit.filter(t => t === 'provider_retry')).toHaveLength(2)
    expect(audit).toContain('tier_degraded')
    expect(audit).toContain('gate_failed')
    const degraded = ctx.paperAudit.list(runId).find((e: { eventType: string }) => e.eventType === 'tier_degraded')
    expect(degraded?.detail).toMatchObject({ from: 'T1', to: 'T2' })
  })

  it('NONE ≠ 错: prose first, then a container after the guided retry — the run completes', async () => {
    const provider = queuedProvider(['I will reason carefully about the ice.', polarContainer()])
    const { ctx } = await harnessWithProvider(provider)
    void ctx
    expect(provider.seen.some(prompt => prompt.includes('RETRY GUIDANCE') && prompt.includes('ir-container-v1'))).toBe(true)
  })

  it('DRIFT: schema-violation first, corrected after the field-level guidance — completes with the id table named', async () => {
    const provider = queuedProvider([driftContainer(), polarContainer()])
    const { outcome } = await harnessWithProvider(provider)
    expect(outcome.status).toBe('resolved')
    const guidance = provider.seen.find(prompt => prompt.includes('RETRY GUIDANCE'))
    expect(guidance).toBeDefined()
    expect(guidance).toContain('DA-RAW')
    expect(guidance).toContain('R-OUT')
  })
})

/** harness() with an externally created provider so `seen` is inspectable. */
async function harnessWithProvider(provider: ReturnType<typeof queuedProvider>): Promise<HarnessResult> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', provider as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-tier-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic test', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:wtier' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const }))
    .catch((error: unknown) => ({ status: 'rejected' as const, code: (error as { code?: string }).code, message: (error as { message: string }).message }))
  return { ctx, ir, engine, runId: String(run.id), finalRoot, outcome }
}
