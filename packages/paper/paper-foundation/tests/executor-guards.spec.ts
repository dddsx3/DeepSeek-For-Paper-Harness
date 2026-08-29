import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createFastProfile } from '../src/runtime/profile.ts'
import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
  DEFAULT_BUDGET_WARN_FRACTION,
  DEFAULT_CONTEXT_UTILIZATION,
  DEFAULT_DAILY_BUDGET_USD,
  DEFAULT_STRICT_BUDGET_MULTIPLIER,
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  newRunId,
  resolveExecutorOptions,
  type ExecutorConfig,
  type PaperSettings,
} from '../src/index.ts'

const settings: PaperSettings = {
  executor: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

async function* textStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

interface HarnessOptions {
  readonly reviewerText?: string
  readonly throwing?: unknown
  readonly config?: ExecutorConfig
}

async function harness(options: HarnessOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({
      route: { role: 'executor', ...settings.executor },
      model: { provider: 'fake', id: 'fake-model', name: 'fake-model' },
    }),
    stream: (request: GenerateOptions): AsyncIterable<StreamChunk> => {
      if (options.throwing !== undefined) throw options.throwing
      const system = request.system ?? ''
      if (system.includes('reviewer')) return textStream(options.reviewerText ?? '{"defects":[]}')
      return textStream('deliverable text')
    },
  } as never)
  await ctx.plugin(PaperSettingsService, settings)
  await ctx.plugin(PaperAuditService, {})
  // TASK -1 rewire: mount the runtime guard with the FAST profile
  // because the harness creates runs in `fast` mode.
  const guard = new PaperRuntimeGuard(ctx, { profile: createFastProfile() })
  guard.markReady()
  await ctx.plugin(PaperExecutorService, options.config ?? { backoffBaseMs: 1, backoffCapMs: 1 })
  return { ctx }
}

describe('executor policy resolution', () => {
  it('resolves every default for a composition that declares none', () => {
    expect(resolveExecutorOptions({})).toEqual({
      pricing: {},
      budget: {
        dailyBudgetUsd: DEFAULT_DAILY_BUDGET_USD,
        warnFraction: DEFAULT_BUDGET_WARN_FRACTION,
        strictMultiplier: DEFAULT_STRICT_BUDGET_MULTIPLIER,
      },
      backoff: { baseMs: DEFAULT_BACKOFF_BASE_MS, capMs: DEFAULT_BACKOFF_CAP_MS },
      contextUtilization: DEFAULT_CONTEXT_UTILIZATION,
    })
  })

  it('keeps every declared value and attaches an audit sink when one is mounted', () => {
    const audit = { record: () => Promise.resolve(undefined) }
    const declared: ExecutorConfig = {
      pricing: { fake: { 'fake-model': { inputPer1k: 1, outputPer1k: 2 } } },
      dailyBudgetUsd: 5,
      budgetWarnFraction: 0.5,
      strictBudgetMultiplier: 3,
      backoffBaseMs: 7,
      backoffCapMs: 9,
      contextUtilization: 0.25,
    }
    expect(resolveExecutorOptions(declared, audit)).toEqual({
      pricing: declared.pricing,
      budget: { dailyBudgetUsd: 5, warnFraction: 0.5, strictMultiplier: 3 },
      backoff: { baseMs: 7, capMs: 9 },
      contextUtilization: 0.25,
      audit,
    })
  })
})

describe('executor run guards', () => {
  it('refuses to execute a run that does not exist', async () => {
    const { ctx } = await harness()
    await expect(ctx.paperExecutor.runs.execute(newRunId(), 'write one sentence'))
      .rejects.toThrow('was not found')
  })

  it('executes a run that is already running without re-transitioning it', async () => {
    const { ctx } = await harness()
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(run.id, 'running')

    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')
    expect(outcome.run.status).toBe('completed')
    const runStates = engine.listEvents(RunId(run.id)).filter(event => event.type === 'run_state')
    // One transition into running, one into completed: the executor did not repeat the first.
    expect(runStates.map(event => event.data.to)).toEqual(['running', 'completed'])
  })

  it('warns at the budget fraction and still finishes the run', async () => {
    const { ctx } = await harness({
      config: {
        backoffBaseMs: 1,
        backoffCapMs: 1,
        dailyBudgetUsd: 10,
        budgetWarnFraction: 0.5,
        pricing: { fake: { 'fake-model': { inputPer1k: 0, outputPer1k: 0 } } },
      },
    })
    const engine = ctx.paperWorkflow.runs
    const spent = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.applyUsage(RunId(spent.id), { inputTokens: 0, outputTokens: 0, costUsd: 6 })

    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')

    expect(outcome.run.status).toBe('completed')
    const warning = engine.listEvents(RunId(run.id)).find(event => event.type === 'usage')
    expect(warning?.data).toMatchObject({ budgetState: 'warning', limitUsd: 10, spentUsd: 6 })
    expect(ctx.paperAudit.list(run.id).map(entry => entry.eventType))
      .toEqual(['workflow_started', 'workflow_completed'])
  })

  it('classifies a thrown non-provider value and pauses after its attempts', async () => {
    const { ctx } = await harness({ throwing: 'socket vanished' })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })

    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence'))
      .rejects.toMatchObject({ code: 'provider-unavailable' })
    expect(engine.getRun(RunId(run.id))?.status).toBe('paused')
  })

  it('blocks immediately on a thrown value that carries a blocking code', async () => {
    const { ctx } = await harness({ throwing: Object.assign(new Error('no credential'), { code: 'AUTH' }) })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })

    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence'))
      .rejects.toMatchObject({ code: 'provider-blocked' })
    expect(engine.getRun(RunId(run.id))?.status).toBe('failed')
  })
})

describe('reviewer output parsing', () => {
  async function reviewDefects(reviewerText: string): Promise<string[]> {
    const { ctx } = await harness({ reviewerText })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')
    return engine.listEvents(RunId(run.id))
      .filter(event => event.type === 'defect')
      .map(event => `${String(event.data.severity)}:${String(event.data.description)}`)
  }

  it('treats output with no JSON object as one major defect', async () => {
    expect(await reviewDefects('looks fine to me'))
      .toContain('major:reviewer returned no JSON object')
  })

  it('treats JSON without a defects array as one major defect', async () => {
    expect(await reviewDefects('{"verdict":"ok"}'))
      .toContain('major:reviewer JSON has no defects array')
  })

  it('treats unparsable JSON as one major defect', async () => {
    expect(await reviewDefects('{"defects":[,]}'))
      .toContain('major:reviewer returned unparsable JSON')
  })

  it('keeps described entries, drops shapeless ones, and defaults severity to minor', async () => {
    const reported = await reviewDefects(
      '{"defects":[{"description":"missing citation"},"nonsense",{"severity":"major","description":"wrong claim"}]}',
    )
    expect(reported).toContain('minor:missing citation')
    expect(reported).toContain('major:wrong claim')
    expect(reported.some(entry => entry.includes('nonsense'))).toBe(false)
  })
})
