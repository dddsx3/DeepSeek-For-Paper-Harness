/**
 * W8.6 A 组验收 — 截断独立失败类 + 同因熔断.
 *
 * H1 (judge): a constructively-truncated EXECUTE output must fail as
 *   `truncated` — NEVER as parse_failed (NONE) / schema_violation (DRIFT).
 *   The W8.5 real run proved the misattribution: a provider length
 *   ceiling recorded as a model contract violation ("假红").
 * H2 (judge): two consecutive same-cause failures → no third attempt.
 *
 * Also pins A3 (the truncation wording never advises "重试一次") and the
 * "NONE ≠ 错" boundary (different prose causes do NOT trip the breaker).
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
import { blockMessage } from '../../../../apps/paper-shell/src/invoke.ts'

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}

/** Stream that ends with a GIVEN finish reason — the seam a provider
 *  adapter uses to report truncation (finish_reason=length). */
async function* streamWithFinish(text: string, finish: { kind: 'stop' } | { kind: 'max-tokens' }) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', index: 0, reason: finish }
}

async function* stream(text: string) {
  yield* streamWithFinish(text, { kind: 'stop' })
}

async function harness(outputs: ReadonlyArray<string | { text: string; finish: 'stop' | 'max-tokens' }>) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  let calls = 0
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request: { system?: string }) => {
      void request
      const entry: string | { text: string; finish: 'stop' | 'max-tokens' } | undefined = outputs[Math.min(calls, outputs.length - 1)]
      calls += 1
      if (entry === undefined) return stream('(no more queued outputs)')
      if (typeof entry === 'string') return stream(entry)
      return streamWithFinish(entry.text, entry.finish === 'max-tokens' ? { kind: 'max-tokens' } : { kind: 'stop' })
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'exploratory' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  ctx.provide('paperModelingIr', new ModelingIr())
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, { produceFromExecute: true, backoffBaseMs: 1, backoffCapMs: 1 })
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:w86' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const, message: '' }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }))
  return { ctx, engine, runId: started.id, outcome, calls: () => calls }
}

describe('W8.6-A1/H1 — truncation is its own failure class', () => {
  it('a max-tokens finish fails the EXECUTE node as TRUNCATED (never NONE/DRIFT), zero retry', async () => {
    // The text below would parse-refuse as NONE if the finish reason were
    // ignored — this test pins that it does NOT get that class.
    const { ctx, engine, runId, outcome, calls } = await harness([
      { text: '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"Sym', finish: 'max-tokens' },
    ])
    expect(outcome.status).toBe('rejected')
    expect(outcome.message).toContain('TRUNCATED')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    expect(audit).toContain('truncated')
    expect(audit).not.toContain('provider_retry') // zero retry — the ceiling will not move
    expect(calls()).toBe(2) // plan + one execute (no retry call)
    const status = (engine as { getRun(id: unknown): { status: string } | undefined }).getRun(RunId(runId))?.status
    expect(status).toBe('failed')
  })

  it('truncated failure text names the length ceiling cause, not a violation', async () => {
    const { outcome } = await harness([
      { text: 'half a container…', finish: 'max-tokens' },
    ])
    expect(outcome.message).toContain('output-length ceiling')
    expect(outcome.message).toContain('not a model contract violation')
  })
})

describe('W8.6-A4/H2 — same-cause circuit breaker', () => {
  it('two consecutive identical refusals abort before the third attempt', async () => {
    const bad = '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"ModelSpec","value":{"model_id":"M1","extra":true}}]}'
    // plan consumes #1; execute#1 and execute#2 both return the IDENTICAL
    // bad container (same output fingerprint) — the breaker must stop
    // before execute#3.
    const { ctx, runId, outcome, calls } = await harness(['plan draft', bad, bad, bad, bad])
    expect(outcome.status).toBe('rejected')
    expect(outcome.message).toContain('circuit-broken')
    const audit = ctx.paperAudit.list(runId).map((e: { eventType: string }) => e.eventType)
    // One provider_retry after the FIRST failure; the second identical
    // failure trips the breaker (no second retry, no third request).
    expect(audit.filter((t: string) => t === 'provider_retry')).toHaveLength(1)
    expect(calls()).toBe(3) // plan + execute#1 + execute#2 — execute#3 never requested
  })

  it('"NONE ≠ 错": two DIFFERENT prose outputs do NOT trip the breaker (budget 2 kept)', async () => {
    // Output budget order: plan consumes #1; execute#1 = prose A (NONE);
    // execute#2 = prose B (NONE, DIFFERENT output); execute#3 = container.
    const { ctx, runId, outcome } = await harness([
      'Plan: I will estimate the thickness carefully.', // plan
      'I will reason carefully about the ice.',         // execute#1 (NONE)
      'The mean thickness might be around 0.7 m, let me continue.', // execute#2 (NONE, different)
      '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"ModelSpec","value":{"model_id":"M1","problem_refs":["P1"],"assumption_refs":[],"variable_refs":[],"parameter_refs":[],"equation_refs":[],"constraints":[],"objective":null,"dependencies":[]}}]}', // execute#3
    ])
    // Different outputs (different causes) keep the guided-retry design.
    expect(outcome.message).not.toContain('circuit-broken')
    // The trail shows TWO guided retries (NONE budget was spent, not cut).
    const audit = ctx.paperAudit.list(runId)
    const retries = audit.filter((e: { eventType: string }) => e.eventType === 'provider_retry')
    expect(retries).toHaveLength(2)
    const breaker = audit.filter((e: { eventType: string; detail?: { reason?: string } }) =>
      e.eventType === 'gate_failed' && String(e.detail?.reason ?? '').includes('circuit breaker'))
    expect(breaker).toHaveLength(0)
  })
})

describe('W8.6-A3 — truncation wording', () => {
  it('the truncated message never advises a plain retry', () => {
    const human = blockMessage('truncated', 'EXECUTE_OUTPUT_TRUNCATED', 'x')
    expect(human.classifier).toBe('truncated')
    expect(human.advice).toContain('重试不会解决')
    expect(human.oneLine).toContain('输出长度上限')
  })
})
