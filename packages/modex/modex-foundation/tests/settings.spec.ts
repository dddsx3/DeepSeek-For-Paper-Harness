import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HarnessSettingsService } from '../src/settings.ts'
import type { HarnessSettings } from '../src/spec.ts'

const defaults: HarnessSettings = {
  executor: { provider: 'deepseek-official', model: 'executor-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'deepseek-official', model: 'reviewer-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'deepseek-official', model: 'editor-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

describe('HarnessSettingsService', () => {
  it('returns a detached snapshot and keeps credential values out of the settings contract', () => {
    const ctx = new Context()
    const service = new HarnessSettingsService(ctx, defaults)
    const snapshot = service.snapshot()
    snapshot.executor.model = 'changed-locally'
    expect(service.snapshot().executor.model).toBe('executor-model')
    expect(JSON.stringify(service.snapshot())).not.toContain('actual-secret')
    expect(service.settingsRevision).toBe(0)
  })
})
