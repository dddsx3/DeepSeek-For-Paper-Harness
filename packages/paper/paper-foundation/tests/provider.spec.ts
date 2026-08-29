import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PaperProviderService } from '../src/provider.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import type { PaperSettings } from '../src/spec.ts'

const settings: PaperSettings = {
  executor: { provider: 'deepseek-official', model: 'executor-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'deepseek-official', model: 'reviewer-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'deepseek-official', model: 'editor-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'strict',
}

describe('PaperProviderService', () => {
  it('resolves a role through the provider-neutral LLM registry', async () => {
    const resolveModelInfo = vi.fn(async (provider: string, model: string) => ({
      provider,
      id: model,
      name: model,
      inputModalities: ['text' as const],
    }))
    const ctx = new Context()
    ctx.provide('llm', { resolveModelInfo, stream: vi.fn() } as never)
    // TASK -1 rewire: provider.stream() routes through the runtime guard.
    // Mount the guard here so the role-resolution call (which is the
    // non-capability seam) still works without preflight; the guard
    // only gates `stream`, not `resolveRole`.
    const guard = new PaperRuntimeGuard(ctx)
    guard.markReady()
    const service = new PaperProviderService(ctx)
    const resolved = await service.resolveRole('reviewer', settings)
    expect(resolved.route).toMatchObject({ role: 'reviewer', provider: 'deepseek-official', model: 'reviewer-model' })
    expect(resolveModelInfo).toHaveBeenCalledWith('deepseek-official', 'reviewer-model', undefined)
  })
})
