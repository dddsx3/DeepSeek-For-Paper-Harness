import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  DomainWorkflowRunRepository,
  InvalidWorkflowTransitionError,
  WorkflowEngine,
  workflowRunDomainSpec,
} from '../src/index.ts'

async function openEngine() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const domain = await facility.open(workflowRunDomainSpec)
  const repository = new DomainWorkflowRunRepository(domain)
  return { repository }
}

describe('WorkflowEngine', () => {
  it('persists legal run and node transitions and rejects terminal rewrites', async () => {
    const { repository } = await openEngine()
    const engine = new WorkflowEngine(repository)
    const run = await engine.startRun({ mode: 'strict', harnessVersion: 'test', configHash: 'sha256:test' })
    const node = await engine.addNode({ runId: run.id, type: 'execute', title: 'execute', maxAttempts: 2 })
    await engine.transitionRun(run.id, 'running')
    await engine.transitionNode(node.id, 'ready')
    const running = await engine.transitionNode(node.id, 'running')
    expect(running.attempts).toBe(1)
    await engine.transitionNode(node.id, 'succeeded')
    await expect(engine.transitionNode(node.id, 'running')).rejects.toBeInstanceOf(InvalidWorkflowTransitionError)
    expect(repository.listEvents(run.id).map(event => event.type)).toEqual([
      'plan_ready', 'run_state', 'node_state', 'node_state', 'node_state',
    ])
    await repository.close()
  })

  it('recovers idempotent nodes to ready and pauses non-idempotent nodes', async () => {
    const { repository } = await openEngine()
    const engine = new WorkflowEngine(repository)
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const retryable = await engine.addNode({ runId: run.id, type: 'execute', title: 'retryable', maxAttempts: 2, idempotent: true })
    const manual = await engine.addNode({ runId: run.id, type: 'execute', title: 'manual', maxAttempts: 2, idempotent: false })
    await engine.transitionRun(run.id, 'running')
    await engine.transitionNode(retryable.id, 'ready')
    await engine.transitionNode(retryable.id, 'running')
    await engine.transitionNode(manual.id, 'ready')
    await engine.transitionNode(manual.id, 'running')

    await expect(engine.recover()).resolves.toEqual({ recoveredRuns: 1, retriedNodes: 1, pausedNodes: 1 })
    expect(repository.getNode(retryable.id)?.state).toBe('ready')
    expect(repository.getNode(manual.id)?.state).toBe('paused')
    expect(repository.getRun(run.id)?.status).toBe('paused')
    expect(repository.listEvents(run.id).some(event => event.type === 'recovery')).toBe(true)
    await repository.close()
  })
})
