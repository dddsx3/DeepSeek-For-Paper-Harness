/**
 * W8.6-P4 验收 — per-run output-token ceiling (O-L5-03).
 *
 * The USD daily budget cannot fire when pricing is unconfigured —
 * W8.5 burned 75,669 output tokens on an unpriced relay with no cap.
 * This gate counts TOKENS: a run whose accumulated output exceeds the
 * ceiling pauses with `budget-exhausted` and an audited `budget_exceeded`
 * event (kind=output_tokens_per_run).
 */

import { describe, expect, it } from 'vitest'
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

/** A legal minimal ir-container so EXECUTE passes the producer and the
 *  budget gate is the thing under test (not the schema). */
const LEGAL_CONTAINER = JSON.stringify({
  __dsh_paper: 'ir-container-v1',
  entries: [
    { kind: 'SymbolSpec', value: { symbol_id: 'SYM-q', scope_ref: 'P1', token: 'q', meaning: 'q', unit: 'm', role: 'VARIABLE', shape: 'SCALAR', domain: 'REAL', index_set: [] } },
    { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: [], variable_refs: ['SYM-q'], parameter_refs: [], equation_refs: [], constraints: [], objective: 'x', dependencies: [] } },
  ],
})

async function* stream(text: string, outputTokens: number) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

async function runWithCeiling(ceiling: number, perCallOutputTokens: number) {
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
    stream: (request: { system?: string }) => {
      const system = request.system ?? ''
      if (system.includes('reviewer')) return stream('{"defects":[]}', perCallOutputTokens)
      return stream(LEGAL_CONTAINER, perCallOutputTokens)
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'exploratory' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  ctx.provide('paperModelingIr', new ModelingIr())
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    backoffBaseMs: 1,
    backoffCapMs: 1,
    maxOutputTokensPerRun: ceiling,
  })
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:p4' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'do the task')
    .then(() => ({ status: 'resolved' as const, message: '' }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }))
  return { ctx, engine, runId: started.id, outcome }
}

describe('W8.6-P4 — per-run output-token ceiling', () => {
  it('exceeding the ceiling pauses the run with budget-exhausted', async () => {
    // Two calls at 600 output tokens each; ceiling 1000 trips after call #2.
    const { ctx, engine, runId, outcome } = await runWithCeiling(1000, 600)
    expect(outcome.status).toBe('rejected')
    expect(outcome.message).toContain('output-token ceiling')
    const status = (engine as { getRun(id: unknown): { status: string } | undefined }).getRun(RunId(runId))?.status
    expect(status).toBe('paused')
    const exceeded = ctx.paperAudit.list(runId).filter((e: { eventType: string }) => e.eventType === 'budget_exceeded')
    expect(exceeded.length).toBeGreaterThan(0)
    const detail = exceeded[0]?.detail as { kind?: string; ceiling?: number } | undefined
    expect(detail?.kind).toBe('output_tokens_per_run')
    expect(detail?.ceiling).toBe(1000)
  })

  it('a run under the ceiling completes normally (guard is not a tax)', async () => {
    const { engine, runId, outcome } = await runWithCeiling(100000, 100)
    expect(outcome.status).toBe('resolved')
    const status = (engine as { getRun(id: unknown): { status: string } | undefined }).getRun(RunId(runId))?.status
    expect(status).toBe('completed')
  })

  it('ceiling 0 = unbounded (historical behavior preserved)', async () => {
    const { outcome } = await runWithCeiling(0, 100000)
    expect(outcome.status).toBe('resolved')
  })
})
