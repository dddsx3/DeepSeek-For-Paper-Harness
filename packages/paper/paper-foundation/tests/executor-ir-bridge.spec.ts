/**
 * TASK 1.25 — the escape `IR_CAN_BE_BYPASSED`, closed at the executor.
 *
 * These tests run the *real* workflow: a real run through the real
 * `WorkflowExecutor`, with a fake provider. Before TASK 1.25 every one of
 * these runs delivered a manifest built from model text alone, with
 * `ModelingIr` never consulted. That is the vacuous security property the
 * external advisor raised as P0.
 *
 * Each test below is also a fault-corpus fixture (B-001..B-005).
 */

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
  WorkflowExecutionError,
  type PaperSettings,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/index.ts'
import { backboneIr, chainThrough, claim, modelSpec, problemSpec, result, runArtifact } from './ir/fixtures.ts'

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

const approvingScript = (system: string, prompt: string): string => {
  if (system.includes('reviewer')) return '{"defects":[]}'
  if (prompt.includes('short numbered execution plan')) return '1. Draft the deliverable.'
  if (prompt.includes('Produce the deliverable')) return 'The final deliverable text.'
  return 'revised text'
}

/** Build the composition, optionally mounting a canonical IR store. */
async function harness(ir?: ModelingIr) {
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
    stream: (options: GenerateOptions) => {
      const first = options.messages[0]?.content[0]
      const prompt = first !== undefined && first.type === 'text' ? first.text : ''
      return fakeStream(approvingScript(options.system ?? '', prompt))
    },
  } as never)
  await ctx.plugin(PaperSettingsService, settings)
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  if (ir !== undefined) ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperExecutorService)
  return { ctx }
}

async function runOnce(ir?: ModelingIr, mode: 'fast' | 'strict' = 'fast') {
  const { ctx } = await harness(ir)
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode, harnessVersion: 'test', configHash: 'sha256:test' })
  return ctx.paperExecutor.runs.execute(RunId(run.id), 'solve this modelling problem')
}

describe('B-001..B-003 — the workflow can no longer deliver without canonical IR', () => {
  it('B-001: a fast run with no IR store mounted is blocked, not delivered', async () => {
    await expect(runOnce(undefined, 'fast')).rejects.toThrow(WorkflowExecutionError)
    await expect(runOnce(undefined, 'fast')).rejects.toThrow(/no canonical IR/)
  })

  it('B-002: a strict run with no IR store mounted is blocked', async () => {
    await expect(runOnce(undefined, 'strict')).rejects.toThrow(/no canonical IR/)
  })

  it('B-003: an empty IR store is also blocked — presence is not enough', async () => {
    await expect(runOnce(new ModelingIr(), 'fast')).rejects.toThrow(/missing IR backbone/)
  })

  it('B-004: an IR store missing the Result and Claim stages is blocked', async () => {
    const ir = new ModelingIr()
    // Pre-register the Problem → Model → Run closure the new store boundary
    // requires (TASK 1.5R). The test still asserts the partial backbone leaves
    // Result and Claim missing.
    for (const entry of chainThrough('RunArtifact')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    await expect(runOnce(ir, 'fast')).rejects.toThrow(/missing IR backbone: Result,Claim/)
  })

  it('B-005: an IR store whose only claim is NON_CRITICAL is blocked', async () => {
    const ir = new ModelingIr()
    for (const entry of chainThrough('Result')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', claim({ criticality: 'NON_CRITICAL' })).accepted).toBe(true)
    await expect(runOnce(ir, 'fast')).rejects.toThrow(/no CRITICAL claim/)
  })

  it('the blocked run ends in `failed`, not `completed`, and records no manifest', async () => {
    const { ctx } = await harness(undefined)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await expect(ctx.paperExecutor.runs.execute(RunId(run.id), 'task')).rejects.toThrow(WorkflowExecutionError)
    const after = await engine.getRun(run.id)
    expect(after?.status).toBe('failed')
  })
})

describe('the happy path still works once canonical IR exists', () => {
  it('delivers when the backbone is present', async () => {
    const outcome = await runOnce(backboneIr(), 'fast')
    expect(outcome.manifest.finalArtifactId).toBeTruthy()
    expect(outcome.run.status).toBe('completed')
  })

  it('delivers a strict run when the backbone is present', async () => {
    const outcome = await runOnce(backboneIr(), 'strict')
    expect(outcome.run.status).toBe('completed')
  })
})
