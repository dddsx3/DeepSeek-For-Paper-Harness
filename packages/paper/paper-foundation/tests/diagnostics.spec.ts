import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PaperDiagnosticsService } from '../src/diagnostics.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'

type Chunk = {
  type: 'finish'
  reason: { kind: 'stop' } | { kind: 'error'; failure: { code: string; message: string } }
}

function contextWithStream(stream: (signal: AbortSignal) => AsyncIterable<Chunk>): Context {
  const ctx = new Context()
  ctx.provide('llm', { stream: (options: { signal?: AbortSignal }) => stream(options.signal ?? new AbortController().signal) } as never)
  // TASK -1 rewire: probe() goes through the runtime guard.
  const guard = new PaperRuntimeGuard(ctx)
  guard.markReady()
  return ctx
}

describe('PaperDiagnosticsService', () => {
  it('returns only stable success facts for a terminal provider result', async () => {
    const ctx = contextWithStream(async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const service = new PaperDiagnosticsService(ctx)
    await expect(service.probe({ provider: 'deepseek-official', model: 'test-model', timeoutMs: 1000 })).resolves.toMatchObject({
      ok: true,
      provider: 'deepseek-official',
      model: 'test-model',
      code: 'OK',
    })
  })

  it('maps a provider failure without exposing response content', async () => {
    const ctx = contextWithStream(async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'provider rejected request' } } }
    })
    const service = new PaperDiagnosticsService(ctx)
    await expect(service.probe({ provider: 'deepseek-official', model: 'test-model', timeoutMs: 1000 })).resolves.toMatchObject({
      ok: false,
      code: 'AUTH',
    })
  })

  it('aborts a probe that does not produce a terminal result before the deadline', async () => {
    const ctx = contextWithStream(signal => (async function* () {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    })())
    const service = new PaperDiagnosticsService(ctx)
    await expect(service.probe({ provider: 'deepseek-official', model: 'test-model', timeoutMs: 5 })).resolves.toMatchObject({
      ok: false,
      code: 'ABORTED',
    })
  })
})
