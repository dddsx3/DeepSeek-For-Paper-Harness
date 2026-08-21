import { describe, expect, it } from 'vitest'
import {
  artifactRecordSchema,
  harnessSettingsSchema,
  runRecordSchema,
  workflowEventSchema,
} from '../src/spec.ts'

const uuid = '00000000-0000-4000-8000-000000000001'
const timestamp = '2026-08-22T00:00:00.000Z'

const run = {
  id: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
  status: 'planning',
  mode: 'fast',
  harnessVersion: '0.1.1-rc.2',
  configHash: 'sha256:test',
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  version: 1,
} as const

describe('Harness foundation schemas', () => {
  it('accepts a complete run record and preserves the UUID brand at runtime', () => {
    expect(runRecordSchema.parse(run)).toMatchObject(run)
  })

  it('rejects a credential value in the role settings contract', () => {
    const result = harnessSettingsSchema.safeParse({
      executor: { provider: 'deepseek-official', model: 'deepseek-v4-pro', credentialRef: 'cred://executor', timeoutMs: 1000 },
      reviewer: { provider: 'deepseek-official', model: 'deepseek-v4-pro', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
      editorAi: { provider: 'deepseek-official', model: 'deepseek-v4-pro', credentialRef: 'cred://editor', timeoutMs: 1000 },
      defaultMode: 'strict',
    })
    expect(result.success).toBe(true)
    expect(JSON.stringify(result)).not.toContain('actual-secret')
  })

  it('rejects event sequence zero and malformed artifact hashes', () => {
    expect(workflowEventSchema.safeParse({
      runId: uuid,
      nodeId: null,
      seq: 0,
      type: 'text_delta',
      data: {},
      timestamp,
    }).success).toBe(false)
    expect(artifactRecordSchema.safeParse({
      id: uuid,
      runId: uuid,
      nodeId: null,
      kind: 'text',
      mime: 'text/plain',
      size: 1,
      sha256: 'not-a-sha256',
      storageKey: 'artifacts/test',
    }).success).toBe(false)
  })
})
