import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEGACY_TIMEOUT_MS,
  LegacyMigrationError,
  MODEX_ROLES,
  ArtifactId, NodeId, RunId,
  inferProvider,
  migrateLegacyEvent, migrateLegacyNode, migrateLegacyRun, migrateLegacySettings,
  migrateNodeState, migrateNodeType, migrateRunMode, migrateRunStatus,
  type LegacyRecordOptions, type LegacySettingsOptions,
} from '../src/index.ts'

const SETTINGS_OPTIONS: LegacySettingsOptions = {
  providerByPathSegment: { 'vendor-a': 'vendor-a-http' },
  defaultProvider: 'deepseek-official',
  defaultModel: 'deepseek-v4-flash',
}

const RECORD_OPTIONS: LegacyRecordOptions = {
  resolveRunId: legacy => RunId(`00000000-0000-4000-8000-${legacy.padStart(12, '0')}`),
  resolveNodeId: legacy => NodeId(`00000000-0000-4000-8001-${legacy.padStart(12, '0')}`),
  resolveArtifactId: legacy => ArtifactId(`00000000-0000-4000-8002-${legacy.padStart(12, '0')}`),
  harnessVersion: '0.1.1-rc.2',
  configHash: 'legacy',
}

describe('inferProvider', () => {
  it('resolves a declared path segment and defaults everything else', () => {
    expect(inferProvider('https://host/vendor-a/v1', SETTINGS_OPTIONS)).toBe('vendor-a-http')
    expect(inferProvider('https://host/v1', SETTINGS_OPTIONS)).toBe('deepseek-official')
    expect(inferProvider(undefined, SETTINGS_OPTIONS)).toBe('deepseek-official')
  })

  it('resolves an unparseable value rather than throwing, and needs no table', () => {
    expect(inferProvider('vendor-a', SETTINGS_OPTIONS)).toBe('vendor-a-http')
    expect(inferProvider('::not a url::', SETTINGS_OPTIONS)).toBe('deepseek-official')
    expect(inferProvider('https://host/vendor-a', { defaultProvider: 'fallback', defaultModel: 'm' }))
      .toBe('fallback')
  })

  it('matches a segment case-insensitively', () => {
    expect(inferProvider('https://host/VENDOR-A/v1', SETTINGS_OPTIONS)).toBe('vendor-a-http')
  })
})

describe('migrateLegacySettings', () => {
  it('lifts every credential value out of the settings record', () => {
    const { settings, credentials } = migrateLegacySettings({
      executor: { base_url: 'https://host/v1', api_key: 'legacy-executor-secret', model_id: 'model-x' },
      reviewer: { base_url: 'https://host/vendor-a/v1', api_key: 'legacy-reviewer-secret' },
      mode: 'strict',
    }, SETTINGS_OPTIONS)

    expect(settings.defaultMode).toBe('strict')
    expect(settings.executor).toEqual({
      provider: 'deepseek-official',
      model: 'model-x',
      credentialRef: 'MODEX_EXECUTOR_API_KEY',
      timeoutMs: DEFAULT_LEGACY_TIMEOUT_MS,
    })
    // The reviewer states its own endpoint, so it is not the executor's copy.
    expect(settings.reviewer.provider).toBe('vendor-a-http')
    expect(settings.reviewer.credentialRef).toBe('MODEX_REVIEWER_API_KEY')
    // Not one secret reached the document.
    expect(JSON.stringify(settings)).not.toContain('legacy-executor-secret')
    expect(JSON.stringify(settings)).not.toContain('legacy-reviewer-secret')
    expect(credentials).toEqual([
      { ref: 'MODEX_EXECUTOR_API_KEY', value: 'legacy-executor-secret', role: 'executor' },
      { ref: 'MODEX_REVIEWER_API_KEY', value: 'legacy-reviewer-secret', role: 'reviewer' },
      // editorAi configured nothing, so it inherits the executor's endpoint and
      // key under its own reference — a migrated install runs, and the two can
      // diverge later without touching the document again.
      { ref: 'MODEX_EDITOR_AI_API_KEY', value: 'legacy-executor-secret', role: 'editorAi' },
    ])
  })

  it('gives an unconfigured role the executor route so a migrated install still runs', () => {
    const { settings } = migrateLegacySettings({
      executor: { base_url: 'https://host/v1', model_id: 'model-x', timeout_ms: 5000 },
    }, SETTINGS_OPTIONS)
    for (const role of MODEX_ROLES) {
      expect(settings[role].model, role).toBe('model-x')
      expect(settings[role].timeoutMs, role).toBe(5000)
    }
    // Each role still names its own reference, so they can diverge later.
    expect(new Set(MODEX_ROLES.map(role => settings[role].credentialRef)).size).toBe(3)
  })

  it('folds the oldest flat document into the role form', () => {
    const { settings, credentials } = migrateLegacySettings({
      executor_base_url: 'https://host/vendor-a/v1',
      executor_api_key: 'flat-secret',
      executor_model_id: 'flat-model',
    }, SETTINGS_OPTIONS)
    expect(settings.executor.provider).toBe('vendor-a-http')
    expect(settings.executor.model).toBe('flat-model')
    expect(settings.defaultMode).toBe('fast')
    expect(credentials).toHaveLength(3)
  })

  it('prefers a role block over the flat fields of the same document', () => {
    const { settings } = migrateLegacySettings({
      executor_model_id: 'flat-model',
      executor: { model_id: 'nested-model' },
    }, SETTINGS_OPTIONS)
    expect(settings.executor.model).toBe('nested-model')
  })

  it('applies the caller default timeout and reference naming', () => {
    const { settings } = migrateLegacySettings({ executor: { model_id: 'm' } }, {
      ...SETTINGS_OPTIONS,
      defaultTimeoutMs: 7000,
      credentialRef: role => `KEY_${role}`,
    })
    expect(settings.executor.timeoutMs).toBe(7000)
    expect(settings.editorAi.credentialRef).toBe('KEY_editorAi')
  })

  it('names the default model when the document states none', () => {
    const { settings } = migrateLegacySettings({ executor: { base_url: 'https://host/v1' } }, SETTINGS_OPTIONS)
    expect(settings.executor.model).toBe('deepseek-v4-flash')
  })

  it('refuses a document it cannot recognize or that configures nothing', () => {
    for (const raw of [null, 42, { executor: { base_url: '' } }]) {
      expect(() => migrateLegacySettings(raw, SETTINGS_OPTIONS)).toThrow(LegacyMigrationError)
    }
    expect(() => migrateLegacySettings({}, SETTINGS_OPTIONS)).toThrow('states no executor route')
    expect(() => migrateLegacySettings({ mode: 'turbo', executor: { model_id: 'm' } }, SETTINGS_OPTIONS))
      .toThrow("'turbo' is not a known mode")
  })
})

describe('enum normalization', () => {
  it('maps every legacy spelling of a run status', () => {
    expect(migrateRunStatus('IN_PROGRESS')).toBe('running')
    expect(migrateRunStatus(' succeeded ')).toBe('completed')
    expect(migrateRunStatus('canceled')).toBe('cancelled')
    // A run stopped mid-flight is resumable, so it is paused rather than failed.
    expect(migrateRunStatus('interrupted')).toBe('paused')
    expect(() => migrateRunStatus('zombie')).toThrow("'zombie' has no equivalent")
  })

  it('maps legacy node states, kinds, and modes', () => {
    expect(migrateNodeState('queued')).toBe('pending')
    expect(migrateNodeState('complete')).toBe('succeeded')
    expect(migrateNodeType('finalize')).toBe('deliver')
    expect(migrateRunMode('QUICK')).toBe('fast')
    expect(migrateRunMode('full')).toBe('strict')
    expect(migrateRunMode(undefined)).toBe('fast')
    expect(() => migrateNodeState('melted')).toThrow(LegacyMigrationError)
    expect(() => migrateNodeType('ponder')).toThrow(LegacyMigrationError)
  })
})

describe('migrateLegacyRun', () => {
  it('maps a full row and stamps the migrating harness', () => {
    const run = migrateLegacyRun({
      id: '7', status: 'running', mode: 'strict',
      created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z',
      input_tokens: 10, output_tokens: 4, cost_usd: 0.25,
    }, RECORD_OPTIONS)
    expect(run).toMatchObject({
      status: 'running', mode: 'strict', harnessVersion: '0.1.1-rc.2', configHash: 'legacy', version: 1,
      usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.25 },
    })
    expect(run.id).toContain('000000000007')
  })

  it('defaults absent usage and reuses the creation stamp', () => {
    const run = migrateLegacyRun({ id: '1', status: 'completed', created_at: '2026-08-01T00:00:00.000Z' }, RECORD_OPTIONS)
    expect(run.updatedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(run.usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  })

  it('refuses a row that is not a legacy run', () => {
    expect(() => migrateLegacyRun({ id: '1' }, RECORD_OPTIONS)).toThrow('does not match the legacy run shape')
  })
})

describe('migrateLegacyNode', () => {
  it('maps a full row with both artifact links', () => {
    const node = migrateLegacyNode({
      id: '2', run_id: '7', parent_id: '1', type: 'exec', title: 'draft', role: 'worker',
      state: 'in_progress', attempts: 2, max_attempts: 5,
      input_artifact_id: '10', output_artifact_id: '11', last_error: 'HTTP_500',
    }, RECORD_OPTIONS)
    expect(node).toMatchObject({
      type: 'execute', title: 'draft', role: 'executor', state: 'running',
      attempts: 2, maxAttempts: 5, lastErrorCode: 'HTTP_500', version: 1,
    })
    expect(node.parentId).toContain('000000000001')
    expect(node.inputArtifactId).toContain('000000000010')
    expect(node.outputArtifactId).toContain('000000000011')
  })

  it('defaults a sparse row and never assumes a node is safe to re-run', () => {
    const node = migrateLegacyNode({ id: '2', run_id: '7', type: 'plan', state: 'pending' }, RECORD_OPTIONS)
    expect(node).toMatchObject({
      title: 'plan', role: null, attempts: 0, maxAttempts: 3, idempotent: false,
      parentId: null, inputArtifactId: null, outputArtifactId: null, lastErrorCode: null,
    })
  })

  it('treats an explicit legacy null the same as an absent field', () => {
    const node = migrateLegacyNode({
      id: '2', run_id: '7', type: 'plan', state: 'pending',
      parent_id: null, role: null, input_artifact_id: null, output_artifact_id: null, last_error: null,
    }, RECORD_OPTIONS)
    expect(node.parentId).toBeNull()
    expect(node.role).toBeNull()
    expect(node.inputArtifactId).toBeNull()
    expect(node.outputArtifactId).toBeNull()
  })

  it('refuses an unmappable role and a row of the wrong shape', () => {
    expect(() => migrateLegacyNode({ id: '2', run_id: '7', type: 'plan', state: 'pending', role: 'oracle' }, RECORD_OPTIONS))
      .toThrow("'oracle' has no equivalent")
    expect(() => migrateLegacyNode({ id: '2' }, RECORD_OPTIONS)).toThrow('does not match the legacy node shape')
  })
})

describe('migrateLegacyEvent', () => {
  it('maps a full row and its payload', () => {
    const event = migrateLegacyEvent({
      run_id: '7', node_id: '2', seq: 3, type: 'node_status',
      payload: { state: 'running' }, created_at: '2026-08-01T00:00:00.000Z',
    }, RECORD_OPTIONS)
    expect(event).toMatchObject({ seq: 3, type: 'node_state', data: { state: 'running' } })
    expect(event.nodeId).toContain('000000000002')
  })

  it('defaults an absent payload and a run-scoped event', () => {
    const event = migrateLegacyEvent({
      run_id: '7', seq: 1, type: 'compacted', created_at: '2026-08-01T00:00:00.000Z',
    }, RECORD_OPTIONS)
    expect(event).toMatchObject({ nodeId: null, type: 'context_compacted', data: {} })
  })

  it('refuses an unmappable event rather than dropping it from the log', () => {
    expect(() => migrateLegacyEvent({
      run_id: '7', seq: 1, type: 'telemetry_ping', created_at: '2026-08-01T00:00:00.000Z',
    }, RECORD_OPTIONS)).toThrow("'telemetry_ping' has no equivalent")
    expect(() => migrateLegacyEvent({ run_id: '7' }, RECORD_OPTIONS))
      .toThrow('does not match the legacy event shape')
  })
})
