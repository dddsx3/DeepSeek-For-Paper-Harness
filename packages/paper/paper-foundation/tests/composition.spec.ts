import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as Composition from '../src/composition.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import type { PaperSettings } from '../src/spec.ts'

const settings: PaperSettings = {
  executor: { provider: 'deepseek-official', model: 'executor-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'deepseek-official', model: 'reviewer-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'deepseek-official', model: 'editor-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

describe('Paper foundation composition', () => {
  it('loads and disposes the phase-two services over real Cordis/storage facilities', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory' })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    ctx.provide('llm', {
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      stream: () => (async function* () {})(),
    } as never)
    // TASK -1 rewire: PaperRuntimeGuard must be mounted before the composition
    // can run its full preflight gate.
    await ctx.plugin(PaperRuntimeGuard)

    const fiber = await ctx.plugin(Composition, settings)
    expect(ctx.get('paperFoundation')).toBeDefined()
    expect(ctx.get('paperProvider')).toBeDefined()
    expect(ctx.get('paperDiagnostics')).toBeDefined()
    expect(ctx.get('paperMigration')).toBeDefined()
    expect(ctx.paperMigration.state).toEqual({ lastCompletedAt: null, passes: 0 })
    await fiber.dispose()
    expect(ctx.get('paperFoundation')).toBeUndefined()
    expect(ctx.get('paperProvider')).toBeUndefined()
    expect(ctx.get('paperDiagnostics')).toBeUndefined()
    expect(ctx.get('paperMigration')).toBeUndefined()
  })
})
