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
import { blockMessage, lastFailureClassEvent } from '../../../../apps/paper-shell/src/invoke.ts'

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
  // W8.9-A4: this suite pins the SINGLE-SHOT path (truncation / circuit-breaker
  // semantics live there). Sharding is the default now, so name the path.
  await ctx.plugin(PaperExecutorService, {
    produceFromExecute: true,
    disableShardDeclare: true,
    disableE1E2: true,
    backoffBaseMs: 1,
    backoffCapMs: 1,
  })
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:w86' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'estimate ice thickness')
    .then(() => ({ status: 'resolved' as const, message: '' }))
    .catch((error: unknown) => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }))
  return { ctx, engine, runId: started.id, outcome, calls: () => calls }
}

describe('W8.10-A1 — the failure class reaches blockMessage (O-L3-06)', () => {
  it('a real truncation gets the truncated advice, NOT "retry"', async () => {
    // 构造性反例，且**走真实错误对象**（本文件 harness 的真实 executor 抛出的
    // WorkflowExecutionError + 真实 audit）——不得手传参数。
    //
    // 修复前的链路：executor 抛 `code:'gate-failed'`（不带 eventType）→ CLI 传
    // 'gate-failed' → blockMessage 落到 transport 兜底 → 建议"重试一次"，而
    // 截断是零重试类。分类信息一直在 audit 的 `truncated` 事件里。
    const { ctx, runId, outcome } = await harness([
      { text: '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"Sym', finish: 'max-tokens' },
    ])
    expect(outcome.status).toBe('rejected')

    // Reproduce the CLI's terminal hop exactly: read the class from the audit
    // (this is what cli.ts now does), then map it.
    const events = ctx.paperAudit.list(runId)
    const classEvent = lastFailureClassEvent(events)
    expect(classEvent).toBe('truncated')

    const human = blockMessage(classEvent as string, 'gate-failed', outcome.message)
    expect(human.classifier).toBe('truncated')
    // H1: the advice must NOT tell the user to retry.
    expect(human.advice).not.toContain('重试')
    expect(human.advice).toContain('输出预算')

    // Counter-check: the OLD hop (literal 'gate-failed') is what produced the
    // wrong advice — this pins that the bug was real and is now bypassed.
    const oldHuman = blockMessage('gate-failed', 'gate-failed', outcome.message)
    expect(oldHuman.classifier).toBe('transport')
    expect(oldHuman.advice).toContain('重试')
  })

  it('a real ESCAPE refusal reaches the protocol classifier', async () => {
    const { ctx, runId, outcome } = await harness([
      '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"DataArtifact","value":{"data_id":"DA-X","locator":"out.json","content_hash":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}}]}',
    ])
    expect(outcome.status).toBe('rejected')
    const classEvent = lastFailureClassEvent(ctx.paperAudit.list(runId))
    expect(classEvent).toBe('escape_refused')
    const human = blockMessage(classEvent as string, 'hash_field_forbidden', outcome.message)
    expect(human.classifier).toBe('protocol')
  })

  it('lastFailureClassEvent returns the TERMINAL class when several were written', () => {
    // A run may fail more than once inside its retry loop; the last one ended it.
    const events = [
      { eventType: 'workflow_started' },
      { eventType: 'container_refused' },
      { eventType: 'provider_retry' },
      { eventType: 'truncated' },
      { eventType: 'workflow_failed' },
    ]
    expect(lastFailureClassEvent(events)).toBe('truncated')
  })

  // W8.10-A1 验收③ — every classifier's reachability, decided by evidence
  // rather than by reading the if-chain.
  //
  // The chain reads `eventType` (now supplied from the audit trail) and
  // `code`. `WorkflowExecutionError.code` is the closed set
  // `budget-exhausted | provider-blocked | provider-unavailable | gate-failed`
  // (executor.ts:332) — so a classifier that needs a *producer* code (e.g.
  // `schema_violation`, `free_id`) can only be reached through the eventType
  // arm, never through `code`.
  it('classifier reachability: the audit trail supplies every reachable class', () => {
    // eventType arm -> reachable (the executor writes these before throwing)
    const reachable = [
      ['truncated', 'truncated'],
      ['escape_refused', 'protocol'],
      ['tier_degraded', 'none'],
      ['provider_blocked', 'runtime'],
      // W8.10-A7: found live — a budget stop used to fall through to
      // 'transport' and advise a retry against a ceiling that was still there.
      ['budget_exceeded', 'budget'],
    ] as const
    for (const [eventType, expected] of reachable) {
      expect(blockMessage(eventType, 'gate-failed', 'x').classifier, eventType).toBe(expected)
    }
    // fallback -> always reachable
    expect(blockMessage('gate-failed', 'gate-failed', 'x').classifier).toBe('transport')
  })

  it('classifier reachability: `guided` is UNREACHABLE on the terminal path (stated, not silent)', () => {
    // `guided` requires `code ∈ guidedCodes`. Those codes are admission codes
    // on the T2 wizard path; they travel as `w4Class` and drive a RETRY, and
    // the terminal throw is always `code:'gate-failed'`. So a run that ends
    // with a guided-class refusal surfaces as `tier_degraded` -> 'none'
    // (when the class is NONE) or as the transport fallback (otherwise) —
    // never as 'guided'.
    const guidedOnlyCode = 'step_foreign_key'
    // The branch exists and answers correctly when handed the code directly…
    expect(blockMessage('gate-failed', guidedOnlyCode, 'x').classifier).toBe('guided')
    // …but no real run reaches it: the executor's closed code set has no
    // guided code, and the audit's guided event is `tier_degraded`.
    const events = [{ eventType: 'tier_degraded' }]
    expect(lastFailureClassEvent(events)).toBe('tier_degraded')
    expect(blockMessage('tier_degraded', 'gate-failed', 'x').classifier).toBe('none')
  })

  it('lastFailureClassEvent is undefined for a run with no class event', () => {
    expect(lastFailureClassEvent([{ eventType: 'workflow_started' }])).toBeUndefined()
    expect(lastFailureClassEvent([])).toBeUndefined()
  })
})

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

describe('W8.6-A3 / W8.10-A1 — truncation wording', () => {
  // SCOPE: this case pins the WORDING TABLE only (it passes the classifier in
  // by hand). The wiring — "does a real truncation actually reach this
  // classifier?" — is covered by the W8.10-A1 cases above, which read the
  // class off a real run's audit trail. Before A1 the wiring was broken and
  // this table test was the only thing passing, which is exactly how the
  // dead branch survived: 测试路径 ≠ 运行路径.
  it('the truncated message never advises a plain retry (wording table only)', () => {
    const human = blockMessage('truncated', 'EXECUTE_OUTPUT_TRUNCATED', 'x')
    expect(human.classifier).toBe('truncated')
    expect(human.advice).not.toContain('重试')
    expect(human.advice).toContain('上限不会变')
    expect(human.oneLine).toContain('输出长度上限')
  })
})
