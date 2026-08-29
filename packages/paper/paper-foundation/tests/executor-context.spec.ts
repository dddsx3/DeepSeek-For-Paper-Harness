import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createFastProfile } from '../src/runtime/profile.ts'
import {
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  type PaperSettings,
} from '../src/index.ts'
import { backboneIr } from './ir/fixtures.ts'

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

/** Provider stub that reports a context window and records the prompts it saw. */
function windowedProvider(contextWindow: number | undefined) {
  const prompts: string[] = []
  return {
    prompts,
    resolveRole: () => Promise.resolve({
      route: { role: 'executor', ...settings.executor },
      model: {
        provider: 'fake',
        id: 'fake-model',
        name: 'fake-model',
        ...contextWindow === undefined ? {} : { context: { contextWindow } },
      },
    }),
    stream: (options: GenerateOptions): AsyncIterable<StreamChunk> => {
      const first = options.messages[0]?.content[0]
      prompts.push(first !== undefined && first.type === 'text' ? first.text : '')
      return textStream((options.system ?? '').includes('reviewer') ? '{"defects":[]}' : 'deliverable')
    },
  }
}

async function harness(contextWindow: number | undefined) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  const provider = windowedProvider(contextWindow)
  ctx.provide('paperProvider', provider as never)
  await ctx.plugin(PaperSettingsService, settings)
  // TASK -1 rewire: mount the runtime guard with the FAST profile
  // because the harness creates runs in `fast` mode.
  const guard = new PaperRuntimeGuard(ctx, { profile: createFastProfile() })
  guard.markReady()
  // TASK 1.25: mount the canonical IR backbone so these suites keep testing
  // budgeting / retries / cost rather than a text-only delivery path.
  ctx.provide('paperModelingIr', backboneIr())
  await ctx.plugin(PaperExecutorService, { contextUtilization: 0.5 })
  return { ctx, provider }
}

describe('executor context budgeting', () => {
  it('compacts an oversized prompt, references the full text, and records the elision', async () => {
    const { ctx, provider } = await harness(400)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const task = 'summarize: '.repeat(600)

    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), task)
    expect(outcome.run.status).toBe('completed')

    // The budget is 400 * 0.5 = 200 tokens, so the plan prompt cannot carry the task whole.
    const planPrompt = provider.prompts[0] as string
    expect(planPrompt.length).toBeLessThan(task.length)
    expect(planPrompt).toContain('characters elided')
    expect(planPrompt).toContain('<artifact_ref kind="text"')

    const compactions = engine.listEvents(RunId(run.id)).filter(event => event.type === 'context_compacted')
    expect(compactions.length).toBeGreaterThanOrEqual(1)
    const first = compactions[0]
    expect(first?.data).toMatchObject({ budgetTokens: 200 })
    expect(Array.isArray(first?.data.elided)).toBe(true)
    const artifactId = first?.data.fullPromptArtifactId
    expect(typeof artifactId).toBe('string')
    // The untrimmed prompt stays recoverable as a durable artifact.
    expect(engine.listEvents(RunId(run.id)).some(event => event.type === 'node_created')).toBe(true)
  })

  it('sends prompts whole when the adapter states no context window', async () => {
    const { ctx, provider } = await harness(undefined)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const task = 'summarize: '.repeat(600)

    await ctx.paperExecutor.runs.execute(RunId(run.id), task)

    expect(provider.prompts[0]).toContain(task)
    expect(engine.listEvents(RunId(run.id)).filter(event => event.type === 'context_compacted')).toHaveLength(0)
  })

  it('leaves a prompt that already fits untouched', async () => {
    const { ctx, provider } = await harness(100_000)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })

    await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')

    expect(provider.prompts[0]).toContain('write one sentence')
    expect(provider.prompts[0]).not.toContain('characters elided')
    expect(engine.listEvents(RunId(run.id)).filter(event => event.type === 'context_compacted')).toHaveLength(0)
  })
})
