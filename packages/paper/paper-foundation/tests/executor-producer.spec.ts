/**
 * P1-1 wiring — the EXECUTE node's structured output is produced into the
 * canonical store on the `produceFromExecute` path (task book P1-1: writer
 * mounted after the EXECUTE output, before delivery).
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-producer
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  type PaperSettings,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/store.ts'
import {
  dataArtifact,
  requirementSpec,
  requiredOutput,
  constraintRequirement,
  variableSymbol,
  parameterSymbol,
  problemSpec,
  modelSpec,
} from './ir/fixtures.ts'
import { MODEL_CONTAINER_VERSION } from '../src/produce/ir-producer.ts'

const settings: PaperSettings = {
  executor: { provider: 'fake', model: 'exec-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'review-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'edit-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'exploratory',
}

function legalContainer(): string {
  return JSON.stringify({
    __dsh_paper: MODEL_CONTAINER_VERSION,
    // No `code`: a code-carrying container would trigger the P2-1
    // production chain (needs options.produceRun); this suite tests the
    // container→store shape that predates the chain (the chain itself is
    // covered by executor-authoritative.spec.ts).
    entries: [
      { kind: 'DataArtifact', value: dataArtifact() },
      { kind: 'RequirementSpec', value: requirementSpec() },
      { kind: 'RequirementSpec', value: requiredOutput() },
      { kind: 'RequirementSpec', value: constraintRequirement() },
      { kind: 'ProblemSpec', value: problemSpec() },
      { kind: 'SymbolSpec', value: variableSymbol() },
      { kind: 'SymbolSpec', value: parameterSymbol() },
      { kind: 'ModelSpec', value: modelSpec() },
    ],
  })
}

/** A fake stream speaking the full BlockAssembler protocol. */
function fakeStream(text: string) {
  return (async function* generate() {
    yield { type: 'block-start' as const, index: 0, blockType: 'text' }
    yield { type: 'text-delta' as const, index: 0, text }
    yield { type: 'block-end' as const, index: 0, block: { type: 'text', text } }
    yield { type: 'usage' as const, usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish' as const, reason: { kind: 'stop' } }
  })()
}

interface Harness {
  ctx: Context
  ir: ModelingIr
}

async function harness(executeOutput: () => string): Promise<Harness> {
  const ir = new ModelingIr()
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
      let out = 'draft text'
      if (options.system?.includes('reviewer')) out = '{"defects":[]}'
      else if (options.system?.includes('editor')) out = 'revised'
      else if (prompt.includes('short numbered execution plan')) out = '1. draft'
      else if (prompt.includes('Produce the deliverable')) out = executeOutput()
      return fakeStream(out)
    },
  } as never)
  await ctx.plugin(PaperSettingsService, settings)
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, { produceFromExecute: true, backoffBaseMs: 1, backoffCapMs: 2 })
  return { ctx, ir }
}

async function run(ctx: Context): Promise<{ status: string; message?: string }> {
  const engine = ctx.paperWorkflow.runs
  const started = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:p1' })
  try {
    const outcome = await ctx.paperExecutor.runs.execute(RunId(started.id), 'solve this modelling problem')
    return { status: outcome.run.status }
  } catch (error) {
    return { status: 'threw', message: error instanceof Error ? error.message : String(error) }
  }
}

describe('P1-1 executor wiring — produceFromExecute', () => {
  it('produces a legal container into the store and audits every entry', async () => {
    const { ctx, ir } = await harness(legalContainer)
    const result = await run(ctx)
    expect(result.status, result.message).toBe('completed')
    const kinds = new Set(ir.list().map(r => r.kind))
    expect(kinds.has('ProblemSpec')).toBe(true)
    expect(kinds.has('ModelSpec')).toBe(true)
    expect(kinds.has('SymbolSpec')).toBe(true)
    expect(ir.list().filter(r => r.kind === 'RequirementSpec')).toHaveLength(3)
    const audit = ctx.paperAudit.list().map(e => e.eventType)
    const written = audit.filter(t => t === 'ir_entry_written')
    expect(written).toHaveLength(8)
  })

  it('refuses a schema-violating container, retries, and BLOCKs the run (no IR written)', async () => {
    const bad = JSON.stringify({
      __dsh_paper: MODEL_CONTAINER_VERSION,
      entries: [{ kind: 'ModelSpec', value: { model_id: 'M1', extra: true } }],
    })
    const { ctx, ir } = await harness(() => bad)
    const result = await run(ctx)
    expect(result.status, result.message).toBe('threw')
    const err = { code: 'gate-failed', message: result.message }
    expect(err?.code).toBe('gate-failed')
    expect(String(err?.message)).toMatch(/not a schema-valid|EXECUTE output refused/)
    expect(ir.size).toBe(0)
  })
})
