import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  type PaperSettings,
} from '../src/index.ts'

const settings: PaperSettings = {
  executor: { provider: 'fake', model: 'exec-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'review-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'edit-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

async function* fakeStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

type Script = (system: string, prompt: string) => string

function userText(options: GenerateOptions): string {
  const first = options.messages[0]?.content[0]
  return first !== undefined && first.type === 'text' ? first.text : ''
}

async function harness(script: Script) {
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
    stream: (options: GenerateOptions) => fakeStream(script(options.system ?? '', userText(options))),
  } as never)
  await ctx.plugin(PaperSettingsService, settings)
  await ctx.plugin(PaperExecutorService)
  return { ctx }
}

const approvingScript: Script = (system, prompt) => {
  if (system.includes('reviewer')) return '{"defects":[]}'
  if (prompt.includes('short numbered execution plan')) return '1. Draft the deliverable.'
  if (prompt.includes('Produce the deliverable')) return 'The final deliverable text.'
  return 'revised text'
}

describe('WorkflowExecutor', () => {
  it('completes a fast run whose review passes on the first pass', async () => {
    const { ctx } = await harness(approvingScript)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one summary sentence')

    expect(outcome.run.status).toBe('completed')
    expect(outcome.manifest.gates.review).toBe(true)
    expect(outcome.manifest.finalArtifactId).not.toBeNull()
    expect(engine.getManifest(RunId(run.id))?.gates.review).toBe(true)
    expect(outcome.run.usage.inputTokens).toBeGreaterThanOrEqual(30)
    const types = engine.listEvents(RunId(run.id)).map(event => event.type)
    expect(types).toContain('request_started')
    expect(types).toContain('gate_result')
    expect(types.filter(type => type === 'usage').length).toBeGreaterThanOrEqual(3)
    const nodes = engine.listNodes(RunId(run.id)).map(node => node.type)
    expect(nodes).toEqual(['plan', 'execute', 'review', 'deliver'])
  })

  it('delivers a fast run with defects after its single revise round', async () => {
    const { ctx } = await harness((system) => {
      if (system.includes('reviewer')) return '{"defects":[{"severity":"minor","description":"tone too dry"}]}'
      if (system.includes('editor')) return 'warmer deliverable text'
      return 'draft deliverable text'
    })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')

    expect(outcome.run.status).toBe('completed')
    expect(outcome.manifest.gates.review).toBe(false)
    const nodeTitles = engine.listNodes(RunId(run.id)).map(node => node.title)
    expect(nodeTitles).toContain('revise #1')
    expect(nodeTitles).toContain('review #2')
    const events = engine.listEvents(RunId(run.id))
    expect(events.filter(event => event.type === 'defect')).toHaveLength(2)
  })

  it('fails a strict run when defects persist past the policy ceiling', async () => {
    const { ctx } = await harness((system) => {
      if (system.includes('reviewer')) return '{"defects":[{"severity":"major","description":"missing citation"}]}'
      return 'draft text'
    })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:test' })
    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence'))
      .rejects.toThrow('failed its review gate')

    const finalRun = engine.getRun(RunId(run.id))
    expect(finalRun?.status).toBe('failed')
    const reviews = engine.listNodes(RunId(run.id)).filter(node => node.type === 'review')
    const revises = engine.listNodes(RunId(run.id)).filter(node => node.type === 'revise')
    expect(reviews).toHaveLength(4)
    expect(revises).toHaveLength(3)
    expect(engine.getManifest(RunId(run.id))?.gates.review).toBe(false)
  })

  it('pushes durable events in-process as they are appended', async () => {
    const { ctx } = await harness(approvingScript)
    const pushed: string[] = []
    ctx.on('paper/run-event', (event) => { pushed.push(`${event.seq}:${event.type}`) })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one summary sentence')

    expect(pushed[0]).toBe('1:plan_ready')
    expect(pushed).toContain('2:run_state')
    const lastSeq = engine.latestEventSeq(RunId(run.id))
    expect(pushed).toHaveLength(lastSeq)
    const seqs = pushed.map(entry => Number(entry.split(':')[0]))
    expect([...seqs].sort((left, right) => left - right)).toEqual(seqs)
  })
})
