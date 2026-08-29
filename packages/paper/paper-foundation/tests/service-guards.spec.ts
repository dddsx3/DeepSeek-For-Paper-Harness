import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import * as PaperInvariant from '../src/invariant.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import {
  PAPER_SETTINGS_NAMESPACE,
  PaperAuditService,
  auditDomainSpec,
  PaperDiagnosticsService,
  PaperExecutorService,
  PaperFoundationService,
  PaperProviderService,
  PaperSettingsService,
  WorkflowEngineService,
  detectSkillConflicts,
  type PaperSettings,
} from '../src/index.ts'

const settings: PaperSettings = {
  executor: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

async function storageContext() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  return ctx
}

function diagnosticsContext(stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>): Context {
  const ctx = new Context()
  ctx.provide('llm', { stream } as never)
  // TASK -1 rewire: probe() now goes through the runtime guard. The
  // helper mounts the guard and readies it directly; the unit tests
  // for diagnostics only care about the streaming semantics, not the
  // preflight surface. The constructor registers the guard in the
  // context, so no separate `ctx.provide` is required.
  const guard = new PaperRuntimeGuard(ctx)
  guard.markReady()
  return ctx
}

async function* noFinish(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
}

describe('PaperDiagnosticsService guards', () => {
  it('refuses a timeout that is not a positive safe integer', async () => {
    const service = new PaperDiagnosticsService(diagnosticsContext(() => noFinish()))
    for (const timeoutMs of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      await expect(service.probe({ provider: 'fake', model: 'fake-model', timeoutMs }))
        .rejects.toThrow('positive safe integer')
    }
  })

  it('reports an incomplete stream that neither finished nor aborted', async () => {
    const service = new PaperDiagnosticsService(diagnosticsContext(() => noFinish()))
    await expect(service.probe({ provider: 'fake', model: 'fake-model', timeoutMs: 5000 }))
      .resolves.toMatchObject({ ok: false, code: 'INCOMPLETE_RESPONSE' })
  })

  it('reports an aborted terminal result', async () => {
    const aborted = async function* (): AsyncGenerator<StreamChunk> {
      yield {
        type: 'finish',
        reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'caller cancelled' } },
      }
    }
    const service = new PaperDiagnosticsService(diagnosticsContext(() => aborted()))
    await expect(service.probe({ provider: 'fake', model: 'fake-model', timeoutMs: 5000 }))
      .resolves.toMatchObject({ ok: false, code: 'ABORTED' })
  })

  it('reports a throw that lands after the deadline as an abort', async () => {
    const abortThenThrow = (options: GenerateOptions): AsyncIterable<StreamChunk> =>
      (async function* (): AsyncGenerator<StreamChunk> {
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        throw new Error('connection dropped while cancelling')
      })()
    const service = new PaperDiagnosticsService(diagnosticsContext(abortThenThrow))
    await expect(service.probe({ provider: 'fake', model: 'fake-model', timeoutMs: 5 }))
      .resolves.toMatchObject({ ok: false, code: 'ABORTED' })
  })

  it('projects a thrown provider error onto its stable code, and anything else onto a generic one', async () => {
    const typed = new PaperDiagnosticsService(diagnosticsContext(() => {
      throw new LlmError('provider refused the credential', 'AUTH')
    }))
    await expect(typed.probe({ provider: 'fake', model: 'fake-model', timeoutMs: 5000 }))
      .resolves.toMatchObject({ ok: false, code: 'AUTH' })

    const untyped = new PaperDiagnosticsService(diagnosticsContext(() => {
      throw new Error('socket closed')
    }))
    await expect(untyped.probe({ provider: 'fake', model: 'fake-model', timeoutMs: 5000 }))
      .resolves.toMatchObject({ ok: false, code: 'DIAGNOSTICS_FAILED' })
  })
})

describe('PaperProviderService', () => {
  it('dispatches an assembled request through the shared runtime', async () => {
    const chunks: StreamChunk[] = [{ type: 'finish', reason: { kind: 'stop' } }]
    const stream = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield* chunks
    })
    const ctx = new Context()
    ctx.provide('llm', { stream } as never)
    // TASK -1 rewire: provider.stream() goes through the runtime guard.
    const guard = new PaperRuntimeGuard(ctx)
    guard.markReady()
    const service = new PaperProviderService(ctx)

    const received: StreamChunk[] = []
    for await (const chunk of service.stream({ provider: 'fake', model: 'fake-model', messages: [] })) {
      received.push(chunk)
    }
    expect(received).toEqual(chunks)
    expect(stream).toHaveBeenCalledTimes(1)
  })
})

describe('PaperAuditService lifecycle', () => {
  it('records a host-scoped entry and refuses reads once its domain is closed', async () => {
    const ctx = await storageContext()
    const fiber = await ctx.plugin(PaperAuditService, {})
    const audit = ctx.paperAudit
    await audit.record({ eventType: 'auth_failure', actor: 'operator', runId: 'run-x' })
    expect(audit.list('run-x')).toHaveLength(1)

    await fiber.dispose()
    expect(() => audit.list()).toThrow('not initialized')
    // The disposer released the domain, so the same unit opens again.
    await expect(ctx.storageDomain.open(auditDomainSpec)).resolves.toBeDefined()
  })

  it('falls back to the default retention when constructed without config', () => {
    const service = new PaperAuditService(new Context())
    expect(() => service.list()).toThrow('not initialized')
  })
})

describe('PaperSettingsService over a real settings provider', () => {
  it('reads through the registered scope and counts committed changes', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    const provider = ctx.get('settings') as MemorySettings
    await ctx.plugin(PaperSettingsService, settings)
    const service = ctx.paperSettings

    expect(service.snapshot().defaultMode).toBe('fast')
    const revisionBefore = service.settingsRevision
    await ctx.settings.update(PAPER_SETTINGS_NAMESPACE, { defaultMode: 'strict' })

    expect(service.snapshot().defaultMode).toBe('strict')
    expect(service.settingsRevision).toBeGreaterThan(revisionBefore)
    expect(provider.persisted.length).toBeGreaterThan(0)
  })
})

describe('PaperExecutorService configuration', () => {
  it('resolves every policy default when a composition names none', async () => {
    const ctx = await storageContext()
    await ctx.plugin(PaperFoundationService)
    await ctx.plugin(WorkflowEngineService)
    ctx.provide('paperProvider', { stream: () => noFinish() } as never)
    await ctx.plugin(PaperSettingsService, settings)
    // TASK -1 rewire: mount the runtime guard so PaperExecutorService can
    // inject it into WorkflowExecutor.
    const guard = new PaperRuntimeGuard(ctx)
    guard.markReady()
    await ctx.plugin(PaperExecutorService, {})

    expect(ctx.paperExecutor.runs).toBeDefined()
  })

  it('refuses use before initialization', () => {
    const service = new PaperExecutorService(new Context())
    expect(() => service.runs).toThrow('not initialized')
  })
})

describe('paper invariant companion', () => {
  it('accepts declared tables and schema-valid values, and fails on anything else', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(PaperInvariant)

    // A change from another domain is not this companion's business.
    expect(() => {
      ctx.emit('domain/changed', {
        domain: 'other_domain', table: 'runs', key: 'k', operation: 'put', value: {},
      })
    }).not.toThrow()

    // A declared table with a deleted key carries no value to validate.
    expect(() => {
      ctx.emit('domain/changed', {
        domain: 'paper_workflow', table: 'runs', key: 'k', operation: 'deleted',
      })
    }).not.toThrow()

    expect(() => {
      ctx.emit('domain/changed', {
        domain: 'paper_workflow', table: 'not_declared', key: 'k', operation: 'put', value: {},
      })
    }).toThrow('undeclared table')

    expect(() => {
      ctx.emit('domain/changed', {
        domain: 'paper_workflow', table: 'runs', key: 'k', operation: 'put', value: { id: 'nope' },
      })
    }).toThrow('fails its durable schema')

    await fiber.dispose()
  })
})

describe('skill conflict detection', () => {
  it('reports nothing when tools and tags do not overlap', () => {
    const existing = [{ id: 'left', tools: ['read_file'], tags: ['research'] }]
    expect(detectSkillConflicts(existing, { id: 'right', tools: ['web_search'], tags: ['writing'] }, [['editor']]))
      .toEqual([])
  })
})
