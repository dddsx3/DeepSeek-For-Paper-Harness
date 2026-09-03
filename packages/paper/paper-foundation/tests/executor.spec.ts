import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../src/runtime/profile.ts'
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

async function harness(script: Script, executorConfig: Record<string, unknown> = {}) {
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
  // TASK -1 rewire: mount the runtime guard with the EXPLORATORY
  // profile because the harness exercises both `fast` and `strict`
  // run modes; EXPLORATORY does not enforce a run-mode match, which
  // is exactly what unit tests need.
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  // TASK 1.25: mount a canonical IR store holding the delivery backbone.
  // Without it these runs are text-only and the bridge blocks them; these
  // suites are about context budgeting, retries and cost, not about the IR.
  ctx.provide('paperModelingIr', backboneIr())
  await ctx.plugin(PaperExecutorService, executorConfig)
  return { ctx }
}

const approvingScript: Script = (system, prompt) => {
  if (system.includes('reviewer')) return '{"defects":[]}'
  if (prompt.includes('short numbered execution plan')) return '1. Draft the deliverable.'
  if (prompt.includes('Produce the deliverable')) return 'The final deliverable text.'
  return 'revised text'
}

describe('WorkflowExecutor', () => {
  it('completes an exploratory run whose review passes on the first pass', async () => {
    const { ctx } = await harness(approvingScript)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:test' })
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

  // TASK 4.2 removed the fast-mode bypass: the review gate used to be
  // silenced on the fast path ("if (!gatePassed && mode !== 'fast')"),
  // so a defect surviving the single revise round was still delivered
  // with `gates.review === false`. That exemption is gone — a mode may
  // change how a check runs, never whether it runs (INV-3-P). Only the
  // outcome moved: the revise rounds still happen and every round's
  // defect is still recorded. 5.0-R: runs in this suite use the
  // backbone-exempt `exploratory` mode (three revise rounds), because
  // fast/strict delivery is BLOCKED at the six UNIMPLEMENTED gates until
  // P1; the fast=1/strict=3 round split is pinned in
  // executor-guards.spec.ts as resolveRunPolicy unit tests.
  it('refuses a run whose defects survive its revise rounds', async () => {
    const { ctx } = await harness((system) => {
      if (system.includes('reviewer')) return '{"defects":[{"severity":"minor","description":"tone too dry"}]}'
      if (system.includes('editor')) return 'warmer deliverable text'
      return 'draft deliverable text'
    })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:test' })

    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence'))
      .rejects.toThrow('failed its review gate')

    expect(engine.getRun(RunId(run.id))?.status).toBe('failed')
    const nodeTitles = engine.listNodes(RunId(run.id)).map(node => node.title)
    expect(nodeTitles).toContain('revise #1')
    expect(nodeTitles).toContain('review #2')
    const events = engine.listEvents(RunId(run.id))
    // Three revise rounds in exploratory mode -> four reviews, four defects.
    expect(events.filter(event => event.type === 'defect')).toHaveLength(4)
    // No promotion, therefore no deliverable: the promoter is the only
    // writer and it is never reached on a refused run (INV-014).
    expect(engine.getManifest(RunId(run.id))).toBeUndefined()
  })

  it('fails a run when defects persist past the policy ceiling', async () => {
    const { ctx } = await harness((system) => {
      if (system.includes('reviewer')) return '{"defects":[{"severity":"major","description":"missing citation"}]}'
      return 'draft text'
    })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:test' })
    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence'))
      .rejects.toThrow('failed its review gate')

    const finalRun = engine.getRun(RunId(run.id))
    expect(finalRun?.status).toBe('failed')
    const reviews = engine.listNodes(RunId(run.id)).filter(node => node.type === 'review')
    const revises = engine.listNodes(RunId(run.id)).filter(node => node.type === 'revise')
    expect(reviews).toHaveLength(4)
    expect(revises).toHaveLength(3)
    // TASK 1.25: a run rejected by review must not leave a manifest behind.
    // The old ordering recorded one before applying the verdict, so rejected
    // text was still reachable as "delivered" through getManifest (RT125B-02).
    expect(engine.getManifest(RunId(run.id))).toBeUndefined()
    const authorized = engine.listEvents(RunId(run.id))
      .some(event => event.type === 'delivery_authorized')
    expect(authorized).toBe(false)
  })

  it('pushes durable events in-process as they are appended', async () => {
    const { ctx } = await harness(approvingScript)
    const pushed: string[] = []
    ctx.on('paper/run-event', (event) => { pushed.push(`${event.seq}:${event.type}`) })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:test' })
    await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one summary sentence')

    expect(pushed[0]).toBe('1:plan_ready')
    expect(pushed).toContain('2:run_state')
    const lastSeq = engine.latestEventSeq(RunId(run.id))
    expect(pushed).toHaveLength(lastSeq)
    const seqs = pushed.map(entry => Number(entry.split(':')[0]))
    expect([...seqs].sort((left, right) => left - right)).toEqual(seqs)
  })

  it('5.0-R R5: writes the promoted final output to the mounted sink', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createHash } = await import('node:crypto')
    const root = await mkdtemp(join(tmpdir(), 'dsh-final-'))
    const { ctx } = await harness(approvingScript, { finalOutputRoot: root })
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:r5' })
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one summary sentence')
    expect(outcome.run.status).toBe('completed')
    // Promotion landed real bytes: <root>/<runId>/final/final exists and
    // its sha256 matches the deliverable the approving script produced.
    const file = join(root, run.id, 'final', 'final')
    const bytes = await readFile(file, 'utf8')
    expect(bytes).toBe('The final deliverable text.')
    expect(createHash('sha256').update(bytes).digest('hex')).toMatch(/^[0-9a-f]{64}$/)
    expect(outcome.manifest.finalArtifactId).not.toBeNull()
    // 5.0-R (R1-4): an EXPLORATORY deliverable is explicitly informal.
    expect(outcome.manifest.informal).toBe(true)
  })
})
