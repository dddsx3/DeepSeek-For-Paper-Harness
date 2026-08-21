/** Persistent workflow state machine and crash recovery coordinator. */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  NodeId,
  NodeRecord,
  NodeType,
  RunId,
  RunRecord,
  RunMode,
  RunStatus,
  WorkflowEvent,
} from './spec.ts'
import {
  newNodeId,
  newRunId,
} from './spec.ts'
import { assertNodeTransition, assertRunTransition, canRetryNode } from './state-machine.ts'
import type { DomainWorkflowRunRepository } from './store.ts'

/** Input for one workflow run. */
export interface StartRunInput {
  readonly mode: RunMode
  readonly harnessVersion: string
  readonly configHash: string
}

/** Input for one planned node. */
export interface AddNodeInput {
  readonly runId: RunId
  readonly parentId?: NodeId
  readonly type: NodeType
  readonly title: string
  readonly role?: NodeRecord['role']
  readonly maxAttempts?: number
  readonly idempotent?: boolean
}

/** Result of one recovery pass. */
export interface RecoveryResult {
  readonly recoveredRuns: number
  readonly retriedNodes: number
  readonly pausedNodes: number
}

const now = (): string => new Date().toISOString()

/**
 * Coordinates durable state transitions. Every mutation for one run is
 * serialized so event sequence allocation and record updates cannot race.
 */
export class WorkflowEngine {
  private readonly tails = new Map<RunId, Promise<void>>()

  /**
   * @param repository - Durable workflow-run repository.
   */
  constructor(private readonly repository: DomainWorkflowRunRepository) {}

  /** Create a new planning run and emit its first recovery-safe event. */
  startRun(input: StartRunInput): Promise<RunRecord> {
    const id = newRunId()
    return this.enqueue(id, async () => {
      const timestamp = now()
      const run: RunRecord = {
        id,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'planning',
        mode: input.mode,
        harnessVersion: input.harnessVersion,
        configHash: input.configHash,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        version: 1,
      }
      await this.repository.putRun(run)
      await this.append(run.id, null, 'plan_ready', { status: run.status })
      return run
    })
  }

  /** Add one pending node to a planning or running run. */
  addNode(input: AddNodeInput): Promise<NodeRecord> {
    return this.enqueue(input.runId, async () => {
      const run = this.requireRun(input.runId)
      if (run.status !== 'planning' && run.status !== 'running') {
        throw new Error(`run '${input.runId}' cannot add nodes while '${run.status}'`)
      }
      const node: NodeRecord = {
        id: newNodeId(),
        runId: input.runId,
        parentId: input.parentId ?? null,
        type: input.type,
        title: input.title,
        role: input.role ?? null,
        state: 'pending',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 1,
        idempotent: input.idempotent ?? true,
        inputArtifactId: null,
        outputArtifactId: null,
        lastErrorCode: null,
        version: 1,
      }
      await this.repository.putNode(node)
      return node
    })
  }

  /** Transition one run and append a durable state event. */
  transitionRun(id: RunId, to: RunStatus): Promise<RunRecord> {
    return this.enqueue(id, async () => {
      const current = this.requireRun(id)
      assertRunTransition(id, current.status, to)
      const run: RunRecord = {
        ...current,
        status: to,
        updatedAt: now(),
        version: current.version + 1,
      }
      await this.repository.putRun(run)
      await this.append(id, null, 'run_state', { from: current.status, to })
      return run
    })
  }

  /** Transition one node and append a durable state event. */
  transitionNode(id: NodeId, to: NodeRecord['state']): Promise<NodeRecord> {
    const current = this.repository.getNode(id)
    if (current === undefined) return Promise.reject(new Error(`node '${id}' was not found`))
    return this.enqueue(current.runId, async () => {
      const node = this.requireNode(id)
      assertNodeTransition(id, node.state, to)
      const next: NodeRecord = {
        ...node,
        state: to,
        attempts: to === 'running' ? node.attempts + 1 : node.attempts,
        version: node.version + 1,
      }
      await this.repository.putNode(next)
      await this.append(node.runId, id, 'node_state', { from: node.state, to })
      return next
    })
  }

  /**
   * Reconcile runs left active by a process crash. Idempotent running nodes
   * return to ready when attempts remain; non-idempotent nodes pause for review.
   */
  async recover(): Promise<RecoveryResult> {
    let recoveredRuns = 0
    let retriedNodes = 0
    let pausedNodes = 0
    for (const run of this.repository.listRuns()) {
      if (run.status !== 'running' && run.status !== 'paused') continue
      const running = this.repository.listNodes(run.id).filter(node => node.state === 'running')
      if (running.length === 0) continue
      recoveredRuns += 1
      await this.enqueue(run.id, async () => {
        const currentRun = this.requireRun(run.id)
        for (const node of running) {
          const current = this.requireNode(node.id)
          if (current.state !== 'running') continue
          const failed: NodeRecord = {
            ...current,
            state: 'failed',
            lastErrorCode: 'PROCESS_RECOVERY',
            version: current.version + 1,
          }
          await this.repository.putNode(failed)
          await this.append(run.id, current.id, 'recovery', { from: 'running', to: 'failed' })
          if (current.idempotent && canRetryNode(current.attempts, current.maxAttempts)) {
            const ready: NodeRecord = { ...failed, state: 'ready', version: failed.version + 1 }
            await this.repository.putNode(ready)
            await this.append(run.id, current.id, 'recovery', { from: 'failed', to: 'ready' })
            retriedNodes += 1
          } else {
            const paused: NodeRecord = { ...failed, state: 'paused', version: failed.version + 1 }
            await this.repository.putNode(paused)
            await this.append(run.id, current.id, 'paused', { reason: 'recovery_requires_review' })
            pausedNodes += 1
          }
        }
        if (currentRun.status === 'running') {
          const pausedRun: RunRecord = {
            ...currentRun,
            status: 'paused',
            updatedAt: now(),
            version: currentRun.version + 1,
          }
          await this.repository.putRun(pausedRun)
          await this.append(run.id, null, 'paused', { reason: 'process_recovery' })
        }
      })
    }
    return { recoveredRuns, retriedNodes, pausedNodes }
  }

  private requireRun(id: RunId): RunRecord {
    const run = this.repository.getRun(id)
    if (run === undefined) throw new Error(`run '${id}' was not found`)
    return run
  }

  private requireNode(id: NodeId): NodeRecord {
    const node = this.repository.getNode(id)
    if (node === undefined) throw new Error(`node '${id}' was not found`)
    return node
  }

  private append(
    runId: RunId,
    nodeId: NodeId | null,
    type: WorkflowEvent['type'],
    data: Record<string, unknown>,
  ): Promise<void> {
    const seq = this.repository.latestEventSeq(runId) + 1
    return this.repository.appendEvent({ runId, nodeId, seq, type, data, timestamp: now() })
  }

  private enqueue<T>(runId: RunId, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(runId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(runId, tail)
    return result.finally(() => {
      if (this.tails.get(runId) === tail) this.tails.delete(runId)
    })
  }
}

/** Cordis service exposing the durable workflow engine to later consumers. */
export class WorkflowEngineService extends Service {
  static inject = ['harnessFoundation']

  private engine: WorkflowEngine | undefined

  /** @param ctx - Context carrying the foundation repository service. */
  constructor(ctx: Context) {
    super(ctx, 'workflowEngine')
  }

  /** Initialize the engine from the foundation repository. */
  protected [Service.init](): void {
    this.engine = new WorkflowEngine(this.ctx.harnessFoundation.runs)
  }

  /** @returns initialized durable workflow engine. */
  get runs(): WorkflowEngine {
    if (this.engine === undefined) throw new Error('workflow engine is not initialized')
    return this.engine
  }
}

export default WorkflowEngineService
