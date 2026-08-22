import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  DomainWorkflowRunRepository,
  HarnessFoundationService,
  WorkflowEngine,
  WorkflowEngineService,
  newArtifactId,
  newNodeId,
  newRunId,
  workflowRunDomainSpec,
  type NodeRecord,
  type RunRecord,
} from '../src/index.ts'

const timestamp = '2026-08-22T00:00:00.000Z'

async function openEngine() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const domain = await facility.open(workflowRunDomainSpec)
  const repository = new DomainWorkflowRunRepository(domain)
  return { ctx, repository, engine: new WorkflowEngine(repository) }
}

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: newRunId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'planning',
    mode: 'fast',
    harnessVersion: 'test',
    configHash: 'sha256:test',
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    version: 1,
    ...overrides,
  }
}

function nodeRecord(runId: RunRecord['id'], overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: newNodeId(),
    runId,
    parentId: null,
    type: 'execute',
    title: 'node',
    role: 'executor',
    state: 'running',
    attempts: 1,
    maxAttempts: 3,
    idempotent: true,
    inputArtifactId: null,
    outputArtifactId: null,
    lastErrorCode: null,
    version: 1,
    ...overrides,
  }
}

describe('workflow engine guards', () => {
  it('refuses to add a node to a run that is no longer planning or running', async () => {
    const { engine } = await openEngine()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(run.id, 'cancelled')
    await expect(engine.addNode({ runId: run.id, type: 'execute', title: 'late' }))
      .rejects.toThrow('cannot add nodes while')
  })

  it('rejects transitions, usage, and artifacts that name something absent', async () => {
    const { engine } = await openEngine()
    const missingRun = newRunId()
    await expect(engine.transitionNode(newNodeId(), 'ready')).rejects.toThrow('was not found')
    await expect(engine.transitionRun(missingRun, 'running')).rejects.toThrow("run '")
    await expect(engine.applyUsage(missingRun, { inputTokens: 1, outputTokens: 1, costUsd: 0 }))
      .rejects.toThrow('was not found')
    expect(engine.getManifest(missingRun)).toBeUndefined()
  })

  it('serializes concurrent writes on one run and releases the queue afterwards', async () => {
    const { engine } = await openEngine()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const usage = { inputTokens: 10, outputTokens: 5, costUsd: 0.5 }
    await Promise.all([
      engine.applyUsage(run.id, usage),
      engine.applyUsage(run.id, usage),
      engine.applyUsage(run.id, usage),
    ])
    expect(engine.getRun(run.id)?.usage).toEqual({ inputTokens: 30, outputTokens: 15, costUsd: 1.5 })
    // A later write still succeeds, so the per-run queue entry was released.
    await engine.applyUsage(run.id, usage)
    expect(engine.getRun(run.id)?.usage.inputTokens).toBe(40)
  })

  it('stores and reads artifacts through the repository', async () => {
    const { engine, repository } = await openEngine()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const artifact = {
      id: newArtifactId(),
      runId: run.id,
      nodeId: null,
      kind: 'text' as const,
      mime: 'text/plain',
      size: 4,
      sha256: 'a'.repeat(64),
      storageKey: 'inline:test',
    }
    await engine.putArtifact(artifact)
    expect(repository.getArtifact(artifact.id)).toEqual(artifact)
    expect(repository.getArtifact(newArtifactId())).toBeUndefined()
  })
})

describe('workflow recovery guards', () => {
  it('refuses to recover a run whose record disagrees with its replayed history', async () => {
    const { engine, repository } = await openEngine()
    // A record claiming to run with no run_state event cannot be reconciled.
    const run = runRecord({ status: 'running' })
    await repository.putRun(run)
    await repository.putNode(nodeRecord(run.id))
    await expect(engine.recover()).rejects.toThrow('disagrees with replay')
  })

  it('refuses to recover when a node record disagrees with its replayed state', async () => {
    const { engine, repository } = await openEngine()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(run.id, 'running')
    // A node written straight to the store has no node_created event behind it.
    await repository.putNode(nodeRecord(run.id))
    await expect(engine.recover()).rejects.toThrow('disagrees with replay')
  })

  it('skips runs with no running node and leaves terminal runs alone', async () => {
    const { engine } = await openEngine()
    const idle = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(idle.id, 'running')
    const done = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(done.id, 'cancelled')

    await expect(engine.recover()).resolves.toEqual({ recoveredRuns: 0, retriedNodes: 0, pausedNodes: 0 })
    expect(engine.getRun(idle.id)?.status).toBe('running')
    expect(engine.getRun(done.id)?.status).toBe('cancelled')
  })

  it('pauses an idempotent node that has already spent its attempts', async () => {
    const { engine } = await openEngine()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(run.id, 'running')
    const node = await engine.addNode({ runId: run.id, type: 'execute', title: 'single', maxAttempts: 1 })
    await engine.transitionNode(node.id, 'ready')
    await engine.transitionNode(node.id, 'running')

    await expect(engine.recover()).resolves.toEqual({ recoveredRuns: 1, retriedNodes: 0, pausedNodes: 1 })
    expect(engine.getRun(run.id)?.status).toBe('paused')
  })

  it('leaves an already paused run paused while recovering its node', async () => {
    const { engine } = await openEngine()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(run.id, 'running')
    const node = await engine.addNode({ runId: run.id, type: 'execute', title: 'node', maxAttempts: 2 })
    await engine.transitionNode(node.id, 'ready')
    await engine.transitionNode(node.id, 'running')
    await engine.transitionRun(run.id, 'paused')

    await expect(engine.recover()).resolves.toEqual({ recoveredRuns: 1, retriedNodes: 1, pausedNodes: 0 })
    expect(engine.getRun(run.id)?.status).toBe('paused')
    expect(engine.getRun(run.id)?.version).toBe(3)
  })

  it('skips a node that stopped running before recovery reached it', async () => {
    const { engine } = await openEngine()
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    await engine.transitionRun(run.id, 'running')
    const node = await engine.addNode({ runId: run.id, type: 'execute', title: 'racing', maxAttempts: 2 })
    await engine.transitionNode(node.id, 'ready')
    await engine.transitionNode(node.id, 'running')

    // Queued first, so recovery's own queue slot observes a succeeded node.
    const settling = engine.transitionNode(node.id, 'succeeded')
    const recovery = engine.recover()
    await settling
    await expect(recovery).resolves.toEqual({ recoveredRuns: 1, retriedNodes: 0, pausedNodes: 0 })
    expect(engine.getRun(run.id)?.status).toBe('paused')
    expect(engine.getRun(node.runId)?.status).toBe('paused')
  })
})

describe('WorkflowEngineService lifecycle', () => {
  it('exposes the startup recovery result and refuses use before initialization', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory' })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(HarnessFoundationService)
    await ctx.plugin(WorkflowEngineService)

    expect(ctx.harnessWorkflow.startupRecovery).toEqual({ recoveredRuns: 0, retriedNodes: 0, pausedNodes: 0 })
    expect(ctx.harnessWorkflow.runs).toBeInstanceOf(WorkflowEngine)

    const bare = new Context()
    const uninitialized = new WorkflowEngineService(bare)
    expect(() => uninitialized.runs).toThrow('not initialized')
    expect(() => uninitialized.startupRecovery).toThrow('has not completed')
  })

  it('refuses repository use before the foundation opens its domain', () => {
    const bare = new Context()
    const foundation = new HarnessFoundationService(bare)
    expect(() => foundation.runs).toThrow('not initialized')
  })
})
