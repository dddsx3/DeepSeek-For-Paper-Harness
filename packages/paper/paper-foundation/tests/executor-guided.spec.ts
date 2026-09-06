/**
 * TASK-PW W2 — T2 guided-step protocol through the EXECUTE path.
 *
 * When a composition opts in with initialTier: 'T2', the executor's
 * EXECUTE stage is a three-step wizard instead of a single full container:
 * the harness asks for the run declaration (step 1), then the Results
 * (step 2), then the claims (step 3); each payload is admitted against the
 * closed step schema (≤4 fields, ids/units/files harness-generated), and
 * after step 3 the harness ASSEMBLES the W1-model-face container and feeds
 * it through the SAME producer / production chain / gates as T1 (同信任链).
 * The assembled container must therefore reach the SAME report bytes as
 * the T1 container path (same sha256), and the T1 face must be untouched.
 *
 * Red-team leaves (all must be red):
 *   1. A step payload smuggling a full container (bypass) → ESCAPE, zero
 *      budget, run failed, no model-written IR.
 *   2. A step payload carrying a foreign key (foreign_key) → DRIFT: the
 *      guided retry is allowed and the correction prompt names the
 *      offending field.
 *   3. A claim referencing an unledgered result → ESCAPE refusal (zero
 *      budget, W4 attack 1 semantics).
 *
 * Step-order enforcement lives at the protocol layer (guided-steps.spec.ts
 * — 步 1 未准入不进入步 2); the executor never asks a step out of order.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-guided
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The T1 one-shot POLAR-ICE container — the equivalence baseline. Its
 *  declared facts (meaning/name/objective/title/conclusion) intentionally
 *  mirror what the T2 wizard assembles from the same step payloads, so the
 *  byte-level claim "T2 三步走完 → 与 T1 等价交付(同 report、同 sha256)"
 *  is exact: identical semantics declared in one shot vs three steps. */
function t1Container(): string {
  return JSON.stringify({
    __dsh_paper: 'ir-container-v1',
    entries: [
      { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'RES-OUT', unit: 'm', role: 'VARIABLE' } },
      { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: 'estimate RES-OUT', dependencies: [] } },
    ],
    code: [
      'const fs = require("node:fs");',
      'fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
      'console.log("run ok");',
    ].join('\n'),
    run: { outputBasenames: ['result.json'], seed: 20260903 },
    interpretations: {
      results: [
        { result_id: 'RES-OUT', name: 'RES-OUT', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm', uncertainty: null },
      ],
      claims: [
        { claim_id: 'C-OUT', text: 'mean ice thickness is 0.731 m', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] },
      ],
    },
    narrative: { title: 'estimate ice thickness', conclusion: 'mean ice thickness is 0.731 m' },
  })
}

const STEP1_OK = JSON.stringify({
  code: 'const fs = require("node:fs"); fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
  outputBasenames: ['result.json'],
  seed: 20260903,
})
const STEP2_OK = JSON.stringify({
  results: [{ data_id: 'RES-OUT', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'm' }],
})
const STEP3_OK = JSON.stringify({
  claims: [{ claim_id: 'C-OUT', text: 'mean ice thickness is 0.731 m', result_refs: ['RES-OUT'], criticality: 'CRITICAL' }],
})

/** A provider whose EXECUTE output is served by a queue (each non-plan call
 *  consumes one entry) so a step session can be scripted. Records prompts. */
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
      // T2 guided-step prompts carry a "guided step N of 3" marker.
      if (joined.includes('guided step 1 of 3') || joined.includes('guided step 2 of 3') || joined.includes('guided step 3 of 3')) {
        const out = outputs[Math.min(cursor, outputs.length - 1)]
        cursor += 1
        return stream(out ?? '')
      }
      // T3 template-fill prompt.
      if (joined.includes('T3 template fill-in')) {
        const out = outputs[Math.min(cursor, outputs.length - 1)]
        cursor += 1
        return stream(out ?? '')
      }
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
  runId: string
  finalRoot: string
  provider: { seen: string[] }
  outcome: { status: 'resolved' } | { status: 'rejected'; code?: string; message: string }
}

async function tierHarness(tier: 'T1' | 'T2', outputs: string[]): Promise<HarnessResult> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  const provider = queuedProvider(outputs)
  ctx.provide('paperProvider', provider as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'strict' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  const ir = new ModelingIr()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-t2e-'))
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    finalOutputRoot: finalRoot,
    produceRun: { command: ['node', 'main.js'], entryFile: 'main.js', environment: 'node 24 deterministic test', timeoutMs: 30_000 },
    backoffBaseMs: 1,
    backoffCapMs: 1,
    initialTier: tier,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:wt2e' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const }))
    .catch((error: unknown) => {
      const code = (error as { code?: string }).code
      return { status: 'rejected' as const, ...(code === undefined ? {} : { code }), message: (error as { message: string }).message }
    })
  return { ctx, ir, runId: String(run.id), finalRoot, provider, outcome }
}

/** The promoted final report bytes from `<finalRoot>/<runId>/final/`. */
async function finalReport(result: HarnessResult): Promise<string> {
  const finalDir = join(result.finalRoot, result.runId, 'final')
  const files = await readdir(finalDir)
  if (files.length === 0) throw new Error(`no promoted file under ${finalDir}`)
  return readFile(join(finalDir, files[0] ?? ''), 'utf8')
}

describe('T2 guided steps — executor end to end', () => {
  it('happy path: three steps deliver the SAME report sha256 as the T1 container path', async () => {
    const t1 = await tierHarness('T1', [t1Container()])
    expect(t1.outcome.status, 'T1 ' + (t1.outcome as { message?: string }).message).toBe('resolved')
    const t2 = await tierHarness('T2', [STEP1_OK, STEP2_OK, STEP3_OK])
    expect(t2.outcome.status, 'T2 ' + (t2.outcome as { message?: string }).message).toBe('resolved')
    const t1Report = await finalReport(t1)
    const t2Report = await finalReport(t2)
    // T2 三步走完 → 与 T1 等价交付: the assembled container flows through
    // the same chain, so the promoted report is byte-identical (same sha256).
    expect(sha256(t2Report)).toBe(sha256(t1Report))
  })

  it('attack 1: a full container smuggled into a step is ESCAPE — zero budget, run failed, no IR written', async () => {
    const { ctx, ir, runId, outcome } = await tierHarness('T2', [t1Container(), STEP2_OK, STEP3_OK])
    expect(outcome.status).toBe('rejected')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit).toContain('escape_refused')
    expect(audit).not.toContain('provider_retry')
    expect(ir.list().filter(r => r.kind === 'ModelSpec')).toHaveLength(0)
  })

  it('attack 2: a foreign key in a step is DRIFT — guided retry allowed, correction names the field', async () => {
    const mixedStep2 = JSON.stringify({
      results: [{ data_id: 'RES-OUT', locator: 'result.json', jsonPath: 'mean_thickness', unit: 'm' }],
      code: 'const x = 1',
    })
    const { ctx, runId, outcome, provider } = await tierHarness('T2',
      [STEP1_OK, mixedStep2, STEP2_OK, STEP3_OK])
    expect(outcome.status, (outcome as { message?: string }).message).toBe('resolved')
    expect(ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)).toContain('provider_retry')
    const guidance = provider.seen.find(p => p.includes('RETRY GUIDANCE'))
    expect(guidance).toBeDefined()
    expect(guidance).toContain('DA-RAW')
  })

  it('attack 3: a claim referencing an unledgered result is ESCAPE — zero budget', async () => {
    const badStep3 = JSON.stringify({
      claims: [{ claim_id: 'C-OUT', text: 'x is 0.731', result_refs: ['RES-NOPE'], criticality: 'CRITICAL' }],
    })
    const { ctx, runId, outcome } = await tierHarness('T2', [STEP1_OK, STEP2_OK, badStep3, STEP3_OK])
    expect(outcome.status).toBe('rejected')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit).toContain('escape_refused')
    expect(audit).not.toContain('provider_retry')
  })
})

describe('T3 template fill — executor end to end', () => {
  const FILL_OK = JSON.stringify({
    symbol_id: 'SYM-q',
    unit: 'm',
    output_file: 'result.json',
    json_path: 'mean_thickness',
  })

  /** T1 one-shot baseline mirroring the T3 assembled facts exactly. */
  function t3T1Container(): string {
    return JSON.stringify({
      __dsh_paper: 'ir-container-v1',
      entries: [
        { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'mean_thickness', unit: 'm', role: 'VARIABLE' } },
        { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumptions: ['homogeneous slab'], variable_refs: ['SYM-q'], parameter_refs: [], equations: ['q = measured'], constraints: [], objective: 'estimate mean_thickness', dependencies: [] } },
      ],
      code: [
        'const fs = require("node:fs");',
        'fs.writeFileSync("result.json", JSON.stringify({ mean_thickness: 0.731 }));',
        'console.log("run ok");',
      ].join('\n'),
      run: { outputBasenames: ['result.json'], seed: 20260903 },
      interpretations: {
        results: [
          { result_id: 'RES-OUT', name: 'mean_thickness', source: { locator: 'result.json', jsonPath: 'mean_thickness' }, unit: 'm', uncertainty: null },
        ],
        claims: [
          { claim_id: 'C-OUT', text: 'mean_thickness is 0.731 m', claim_type: 'NUMERIC', criticality: 'CRITICAL', result_refs: ['RES-OUT'], model_refs: ['M1'], evidence_refs: ['RES-OUT'] },
        ],
      },
      narrative: { title: 'estimate ice thickness', conclusion: 'mean_thickness is 0.731 m' },
    })
  }

  it('happy path: one fill-in delivers the SAME report sha256 as the T1 container path', async () => {
    const t1 = await tierHarness('T1', [t3T1Container()])
    expect(t1.outcome.status, 'T1 ' + (t1.outcome as { message?: string }).message).toBe('resolved')
    const t3 = await tierHarness('T3', [FILL_OK])
    expect(t3.outcome.status, 'T3 ' + (t3.outcome as { message?: string }).message).toBe('resolved')
    const t1Report = await finalReport(t1)
    const t3Report = await finalReport(t3)
    // T3 填充一次 → 与 T1 等价交付(同 report、同 sha256): the assembled
    // container flows through the same chain, so the promoted report is
    // byte-identical.
    expect(sha256(t3Report)).toBe(sha256(t1Report))
  })

  it('attack 1: a free number in the T3 fill-in is ESCAPE — zero budget, run failed', async () => {
    const withNumber = '{"symbol_id": "SYM-q", "unit": "m", "output_file": "result.json", "json_path": "mean_thickness", "note": "0.731"}'
    const { ctx, runId, outcome } = await tierHarness('T3', [withNumber])
    expect(outcome.status).toBe('rejected')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit).toContain('escape_refused')
    expect(audit).not.toContain('provider_retry')
  })

  it('attack 2: a container-shaped payload in T3 is ESCAPE — zero budget', async () => {
    const container = JSON.stringify({
      __dsh_paper: 'ir-container-v1',
      entries: [{ kind: 'ModelSpec', value: { model_id: 'M1' } }],
    })
    const { ctx, runId, outcome } = await tierHarness('T3', [container])
    expect(outcome.status).toBe('rejected')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit).toContain('escape_refused')
    expect(audit).not.toContain('provider_retry')
  })
})
