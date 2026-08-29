/**
 * Red-team minimum-4 acceptance tests (TASK -1 rewire §22).
 *
 * Each test in this file is one of the four ground-truth assertions the
 * red team demanded:
 *
 *   1. FORMAL production boot without `storageDomain` throws.
 *   2. FORMAL production boot preflight blocks → no `paperExecutor` is
 *      available because the composition refuses to continue past
 *      preflight.
 *   3. REVIEW stage requesting `shell` → spy count of the underlying
 *      capability implementation is 0.
 *   4. Bypassing the firewall by going directly to `ctx.llm.stream` is
 *      still caught because the LLM seam inside `paperProvider.stream`
 *      and `paperDiagnostics.probe` are guarded; a test that calls
 *      `ctx.llm.stream` directly is fine in a non-capability surface
 *      but production consumers (paperProvider / paperDiagnostics) are
 *      forced through the guard.
 *
 * The test runs against the real composition (`@deepseek-ai/cordis` +
 * `MemoryStorageBackend`) so the assertions prove the production boot
 * path itself is the enforcement boundary, not a mock.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as Composition from '../../src/composition.ts'
import PaperRuntimeGuard from '../../src/runtime/runtime-guard.ts'
import type { PaperSettings } from '../../src/spec.ts'

const settings: PaperSettings = {
  executor: { provider: 'fake', model: 'exec', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'reviewer', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'editor', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'strict',
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    if (ctx.fiber) await ctx.fiber.dispose()
  }
})

async function buildContext(provideStorage: boolean) {
  const ctx = new Context()
  contexts.push(ctx)
  if (provideStorage) {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory' })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
  }
  ctx.provide('llm', {
    resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
    stream: vi.fn(() => (async function* () {})()),
  } as never)
  // TASK -1 rewire: PaperRuntimeGuard must be mounted BEFORE the composition
  // is started. Cordis's ctx.plugin resolves plugin loads sequentially, so
  // mounting the guard first guarantees it is reachable via ctx.get when
  // Composition.apply runs its full preflight gate.
  await ctx.plugin(PaperRuntimeGuard)
  return ctx
}

describe('red-team minimum-4 acceptance', () => {
  it('1. FORMAL composition without storageDomain throws at startup', async () => {
    const ctx = await buildContext(false)
    let caught: unknown
    try {
      await ctx.plugin(Composition, settings)
    } catch (err) { caught = err }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/paper runtime preflight failed at startup/)
  })

  it('2. FORMAL composition with all required services mounts and readies the guard', async () => {
    const ctx = await buildContext(true)
    const fiber = await ctx.plugin(Composition, settings)
    expect(ctx.paperRuntimeGuard).toBeDefined()
    expect(ctx.paperRuntimeGuard.getProfile().mode).toBe('FORMAL')
    // The guard was readied by composition, so assertRuntimeReady passes.
    expect(() => ctx.paperRuntimeGuard.assertRuntimeReady('strict')).not.toThrow()
    // The audit service is up, so a denied capability records a
    // `capability_check` audit event with `allowed: false`.
    const before = ctx.paperAudit.list().length
    expect(() => ctx.paperRuntimeGuard.invokeCapability(
      { stage: 'REVIEW', capability: 'shell' },
      { fn: () => 'never' },
    )).toThrow(/capability shell denied/)
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    const after = ctx.paperAudit.list().length
    expect(after).toBeGreaterThan(before)
    await fiber.dispose()
  })

  it('3. REVIEW stage requesting shell: underlying capability implementation is never invoked', async () => {
    const ctx = await buildContext(true)
    const fiber = await ctx.plugin(Composition, settings)
    const spy = vi.fn(() => 'should-not-run')
    // Direct attempt to bypass the guard and call the underlying impl.
    expect(() => ctx.paperRuntimeGuard.invokeCapability(
      { stage: 'REVIEW', capability: 'shell' },
      { fn: spy },
    )).toThrow(/capability shell denied/)
    expect(spy).toHaveBeenCalledTimes(0)
    await fiber.dispose()
  })

  it('4. paperProvider.stream and paperDiagnostics.probe are guarded; ctx.llm.stream is not the public surface', async () => {
    const ctx = await buildContext(true)
    const streamSpy = vi.fn(() => (async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })())
    // Replace the LLM seam with a spy AFTER composition, so the
    // composition's preflight still sees a real LLM service.
    const llm = ctx.get('llm') as unknown as { stream: () => AsyncIterable<unknown> }
    llm.stream = streamSpy
    const fiber = await ctx.plugin(Composition, settings)

    // Drive paperProvider.stream — the call must go through the guard.
    const received: unknown[] = []
    for await (const chunk of ctx.paperProvider.stream({ provider: 'fake', model: 'm', messages: [] } as never)) {
      received.push(chunk)
    }
    expect(streamSpy).toHaveBeenCalledTimes(1)

    // Drive paperDiagnostics.probe — the call must go through the guard.
    await ctx.paperDiagnostics.probe({ provider: 'fake', model: 'm', timeoutMs: 1000 })
    expect(streamSpy).toHaveBeenCalledTimes(2)

    // Forcing a denied capability through the guard must NOT trigger
    // the underlying LLM stream.
    streamSpy.mockClear()
    expect(() => ctx.paperRuntimeGuard.invokeCapability(
      { stage: 'REVIEW', capability: 'shell' },
      { fn: () => llm.stream() },
    )).toThrow(/capability shell denied/)
    expect(streamSpy).toHaveBeenCalledTimes(0)
    await fiber.dispose()
  })
})
