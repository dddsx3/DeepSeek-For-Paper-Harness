import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  WorkflowExecutionError,
  type ExecutorConfig,
  type PaperSettings,
} from '../src/index.ts'

const settings: PaperSettings = {
  executor: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

const PRICING = { fake: { 'fake-model': { inputPer1k: 1, outputPer1k: 2 } } }

/** Fast backoff so a retry path is exercised without a real wait. */
const FAST_BACKOFF: ExecutorConfig = { backoffBaseMs: 1, backoffCapMs: 1, pricing: PRICING }

async function* textStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 500 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

async function* failureStream(code: string, retryAfterMs?: number): AsyncGenerator<StreamChunk> {
  yield {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: {
        code,
        message: `scripted ${code}`,
        ...retryAfterMs === undefined ? {} : { providerRetryAfterMs: retryAfterMs },
      },
    },
  }
}

interface Behavior {
  readonly failWith?: string
  readonly text?: string
}

/** Provider stub whose queued behaviors are consumed one call at a time. */
function scriptedProvider(behaviors: Behavior[], fallback: (system: string) => string) {
  const queue = [...behaviors]
  const calls: string[] = []
  return {
    calls,
    resolveRole: () => Promise.resolve({
      route: { role: 'executor', ...settings.executor },
      model: { provider: 'fake', id: 'fake-model', name: 'fake-model' },
    }),
    stream: (options: GenerateOptions): AsyncIterable<StreamChunk> => {
      const system = options.system ?? ''
      calls.push(system.slice(0, 12))
      const next = queue.shift()
      if (next?.failWith !== undefined) return failureStream(next.failWith)
      if (next?.text !== undefined) return textStream(next.text)
      return textStream(fallback(system))
    },
  }
}

const APPROVING = (system: string): string => (system.includes('reviewer') ? '{"defects":[]}' : 'deliverable text')

async function harness(behaviors: Behavior[], config: ExecutorConfig = FAST_BACKOFF) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  const provider = scriptedProvider(behaviors, APPROVING)
  ctx.provide('paperProvider', provider as never)
  await ctx.plugin(PaperSettingsService, settings)
  await ctx.plugin(PaperAuditService, { retentionDays: 90 })
  await ctx.plugin(PaperExecutorService, config)
  return { ctx, provider }
}

describe('executor resilience', () => {
  it('retries a transport failure, records the retry, and completes', async () => {
    const { ctx, provider } = await harness([{ failWith: 'SERVER' }])
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')

    expect(outcome.run.status).toBe('completed')
    expect(provider.calls.length).toBe(4)
    const planNode = engine.listNodes(RunId(run.id)).find(node => node.type === 'plan')
    expect(planNode?.state).toBe('succeeded')
    expect(planNode?.attempts).toBe(2)
    const attempts = engine.listEvents(RunId(run.id))
      .filter(event => event.type === 'request_started')
      .map(event => event.data.attempt)
    expect(attempts.slice(0, 2)).toEqual([1, 2])
    expect(ctx.paperAudit.list(run.id).map(entry => entry.eventType))
      .toEqual(['workflow_started', 'provider_retry', 'workflow_completed'])
  })

  it('blocks a credential failure without retrying and fails the run', async () => {
    const { ctx, provider } = await harness([{ failWith: 'AUTH' }, { failWith: 'AUTH' }])
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })

    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence'))
      .rejects.toMatchObject({ code: 'provider-blocked' })
    expect(provider.calls).toHaveLength(1)
    expect(engine.getRun(RunId(run.id))?.status).toBe('failed')
    expect(engine.listNodes(RunId(run.id))[0]?.state).toBe('failed')
    expect(ctx.paperAudit.list(run.id).map(entry => entry.eventType))
      .toEqual(['workflow_started', 'provider_blocked', 'workflow_failed'])
  })

  it('pauses the run when retryable attempts are exhausted', async () => {
    const failures = [{ failWith: 'RATE_LIMIT' }, { failWith: 'RATE_LIMIT' }, { failWith: 'RATE_LIMIT' }]
    const { ctx, provider } = await harness(failures)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })

    const rejection = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence').catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(WorkflowExecutionError)
    expect(rejection).toMatchObject({ code: 'provider-unavailable' })
    expect(provider.calls).toHaveLength(3)
    expect(engine.getRun(RunId(run.id))?.status).toBe('paused')
    expect(engine.listNodes(RunId(run.id))[0]?.state).toBe('paused')
    expect(ctx.paperAudit.list(run.id).map(entry => entry.eventType))
      .toEqual(['workflow_started', 'provider_retry', 'provider_retry', 'workflow_failed'])
  })

  it('derives cost from the pricing table and carries it into the manifest', async () => {
    const { ctx } = await harness([])
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')

    // Three priced calls: 1,000 input at $1/1k plus 500 output at $2/1k each.
    expect(outcome.run.usage).toEqual({ inputTokens: 3000, outputTokens: 1500, costUsd: 6 })
    expect(outcome.manifest.usage.costUsd).toBe(6)
    expect(outcome.manifest.redacted).toBe(true)
  })

  it('pauses a new run once the day is over budget and records the refusal', async () => {
    const { ctx, provider } = await harness([], { ...FAST_BACKOFF, dailyBudgetUsd: 1 })
    const engine = ctx.paperWorkflow.runs
    const spent = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.applyUsage(RunId(spent.id), { inputTokens: 0, outputTokens: 0, costUsd: 5 })

    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence'))
      .rejects.toMatchObject({ code: 'budget-exhausted' })

    expect(provider.calls).toHaveLength(0)
    expect(engine.getRun(RunId(run.id))?.status).toBe('paused')
    expect(engine.listNodes(RunId(run.id))).toHaveLength(0)
    expect(ctx.paperAudit.list(run.id).map(entry => entry.eventType))
      .toEqual(['workflow_started', 'budget_exceeded', 'workflow_failed'])
    const budgetEvent = engine.listEvents(RunId(run.id)).find(event => event.type === 'usage')
    expect(budgetEvent?.data).toMatchObject({ budgetState: 'exhausted', limitUsd: 1, spentUsd: 5 })
  })
})
