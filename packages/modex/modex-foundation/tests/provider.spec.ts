import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HarnessProviderService } from '../src/provider.ts'
import type { HarnessSettings } from '../src/spec.ts'

const settings: HarnessSettings = {
  executor: { provider: 'deepseek-official', model: 'executor-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'deepseek-official', model: 'reviewer-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'deepseek-official', model: 'editor-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'strict',
}

describe('HarnessProviderService', () => {
  it('resolves a role through the provider-neutral LLM registry', async () => {
    const resolveModelInfo = vi.fn(async (provider: string, model: string) => ({
      provider,
      id: model,
      name: model,
      inputModalities: ['text' as const],
    }))
    const ctx = new Context()
    ctx.provide('llm', { resolveModelInfo, stream: vi.fn() } as never)
    const service = new HarnessProviderService(ctx)
    const resolved = await service.resolveRole('reviewer', settings)
    expect(resolved.route).toMatchObject({ role: 'reviewer', provider: 'deepseek-official', model: 'reviewer-model' })
    expect(resolveModelInfo).toHaveBeenCalledWith('deepseek-official', 'reviewer-model', undefined)
  })
})
