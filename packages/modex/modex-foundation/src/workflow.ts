/** Persistent workflow state machine and crash recovery coordinator. */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ArtifactRecord,
  Manifest,
  NodeId,
  NodeRecord,
  NodeType,
  RunId,
  RunRecord,
  RunMode,
  RunStatus,
  Usage,
  WorkflowEvent,
} from './spec.ts'
import {
  newNodeId,
  newRunId,
} from './spec.ts'
import { assertNodeTransition, assertRunTransition, canRetryNode } from './state-machine.ts'
import { replayWorkflow, type WorkflowReplaySnapshot } from './replay.ts'
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

/** Harness version stamped into runs created through the engine. */
export const MODEX_HARNESS_VERSION = '0.1.1-rc.2'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One workflow event became durable. Emitted after the append committed,
     * carrying the exact persisted record; listener failures are contained.
     * @param event - the persisted workflow event.
     * @mode emit
     */
    'harness/run-event'(event: WorkflowEvent): void
  }
}

/**
 * Coordinates durable state transitions. Every mutation for one run is
 * serialized so event sequence allocation and record updates cannot race.
 */
export class WorkflowEngine {
  private readonly tails = new Map<RunId, Promise<void>>()

  /**
   * @param repository - Durable workflow-run repository.
   * @param ctx - Optional context used to publish durable events in-process.
   */
  constructor(
    private readonly repository: DomainWorkflowRunRepository,
    private readonly ctx?: Context,
  ) {}

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
      await this.append(input.runId, node.id, 'node_created', { state: node.state, type: node.type })
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
  /** Replay one run's durable event stream before any recovery mutation. */
  replayRun(id: RunId): WorkflowReplaySnapshot {
    this.requireRun(id)
    return replayWorkflow(id, this.repository.listEvents(id))
  }

  /** Resolve one run record without mutating it. */
  getRun(id: RunId): RunRecord | undefined {
    return this.repository.getRun(id)
  }

  /** List every run record. */
  listRuns(): RunRecord[] {
    return this.repository.listRuns()
  }

  /** List one run's node records. */
  listNodes(runId: RunId): NodeRecord[] {
    return this.repository.listNodes(runId)
  }

  /** List one run's events after a sequence cursor. */
  listEvents(runId: RunId, afterSeq = 0): WorkflowEvent[] {
    return this.repository.listEvents(runId, afterSeq)
  }

  /** Resolve one run's highest persisted event sequence. */
  latestEventSeq(runId: RunId): number {
    return this.repository.latestEventSeq(runId)
  }

  /** Accumulate usage into one run's record and emit a durable usage event. */
  applyUsage(runId: RunId, usage: Usage): Promise<RunRecord> {
    return this.enqueue(runId, async () => {
      const current = this.requireRun(runId)
      const next: RunRecord = {
        ...current,
        usage: {
          inputTokens: current.usage.inputTokens + usage.inputTokens,
          outputTokens: current.usage.outputTokens + usage.outputTokens,
          costUsd: current.usage.costUsd + usage.costUsd,
        },
        updatedAt: now(),
        version: current.version + 1,
      }
      await this.repository.putRun(next)
      await this.append(runId, null, 'usage', { ...usage })
      return next
    })
  }

  /** Persist one artifact record for a run. */
  putArtifact(record: ArtifactRecord): Promise<void> {
    return this.enqueue(record.runId, async () => {
      await this.repository.putArtifact(record)
    })
  }

  /** Persist a run's final manifest. */
  recordManifest(runId: RunId, manifest: Manifest): Promise<void> {
    return this.enqueue(runId, async () => {
      await this.repository.putManifest(manifest)
    })
  }

  /** Append one durable event outside a transition (defects, gates, requests). */
  appendPublic(
    runId: RunId,
    nodeId: NodeId | null,
    type: WorkflowEvent['type'],
    data: Record<string, unknown>,
  ): Promise<void> {
    return this.enqueue(runId, async () => {
      await this.append(runId, nodeId, type, data)
    })
  }

  /** Resolve one stored manifest. */
  getManifest(runId: RunId): Manifest | undefined {
    return this.repository.getManifest(runId)
  }

  async recover(): Promise<RecoveryResult> {
    let recoveredRuns = 0
    let retriedNodes = 0
    let pausedNodes = 0
    for (const run of this.repository.listRuns()) {
      if (run.status !== 'running' && run.status !== 'paused') continue
      const snapshot = this.replayRun(run.id)
      if (snapshot.runStatus !== run.status) {
        throw new Error(`run '${run.id}' record status '${run.status}' disagrees with replay '${snapshot.runStatus}'`)
      }
      for (const node of this.repository.listNodes(run.id)) {
        if (snapshot.nodeStates.get(node.id) !== node.state) {
          throw new Error(`node '${node.id}' record state '${node.state}' disagrees with replay`)
        }
      }
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
    const event: WorkflowEvent = { runId, nodeId, seq, type, data, timestamp: now() }
    return this.repository.appendEvent(event).then(() => {
      this.ctx?.emit('harness/run-event', event)
    })
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessWorkflow: WorkflowEngineService
  }
}

/** Cordis service exposing the durable workflow engine to later consumers. */
export class WorkflowEngineService extends Service {
  static inject = ['harnessFoundation']

  private engine: WorkflowEngine | undefined
  private recoveryResult: RecoveryResult | undefined

  /** @param ctx - Context carrying the foundation repository service. */
  constructor(ctx: Context) {
    super(ctx, 'harnessWorkflow')
  }

  /** Initialize the engine from the foundation repository and recover active runs. */
  protected async [Service.init](): Promise<void> {
    this.engine = new WorkflowEngine(this.ctx.harnessFoundation.runs, this.ctx)
    this.recoveryResult = await this.engine.recover()
  }

  /** @returns the result of the startup recovery pass. */
  get startupRecovery(): RecoveryResult {
    if (this.recoveryResult === undefined) throw new Error('workflow engine recovery has not completed')
    return this.recoveryResult
  }

  /** @returns initialized durable workflow engine. */
  get runs(): WorkflowEngine {
    if (this.engine === undefined) throw new Error('workflow engine is not initialized')
    return this.engine
  }
}

export default WorkflowEngineService
