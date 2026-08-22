import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  DomainWorkflowRunRepository,
  newRunId,
  workflowRunDomainSpec,
  type RunRecord,
  type WorkflowEvent,
} from '../src/index.ts'

const timestamp = '2026-08-22T00:00:00.000Z'

async function openRepository(pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const domain = await facility.open(workflowRunDomainSpec)
  return { ctx, facility, repository: new DomainWorkflowRunRepository(domain), pool }
}

function runRecord(id: RunRecord['id']): RunRecord {
  return {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'planning',
    mode: 'fast',
    harnessVersion: 'test',
    configHash: 'sha256:test',
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    version: 1,
  }
}

describe('DomainWorkflowRunRepository', () => {
  it('persists runs and resumes events after reopening the shared medium', async () => {
    const first = await openRepository()
    const id = newRunId()
    await first.repository.putRun(runRecord(id))
    const event: WorkflowEvent = {
      runId: id,
      nodeId: null,
      seq: 1,
      type: 'plan_ready',
      data: { nodeCount: 0 },
      timestamp,
    }
    await first.repository.appendEvent(event)
    expect(first.repository.getRun(id)?.id).toBe(id)
    expect(first.repository.listEvents(id)).toEqual([event])
    await first.repository.close()

    const second = await openRepository(first.pool)
    expect(second.repository.getRun(id)).toEqual(runRecord(id))
    expect(second.repository.listEvents(id, 0)).toEqual([event])
    await second.repository.close()
  })

  it('rejects duplicate event sequence keys without replacing the first event', async () => {
    const { repository } = await openRepository()
    const id = newRunId()
    const event: WorkflowEvent = {
      runId: id,
      nodeId: null,
      seq: 1,
      type: 'text_delta',
      data: { text: 'first' },
      timestamp,
    }
    await repository.appendEvent(event)
    await expect(repository.appendEvent({ ...event, data: { text: 'second' } })).rejects.toThrow('already exists')
    expect(repository.listEvents(id)).toEqual([event])
    await repository.close()
  })
})
