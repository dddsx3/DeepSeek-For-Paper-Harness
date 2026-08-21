/** Deterministic replay of persisted workflow facts into a recovery snapshot. */

import type { NodeId, NodeState, RunId, RunStatus, WorkflowEvent } from './spec.ts'
import { nodeStateSchema, runStatusSchema } from './spec.ts'
import { assertNodeTransition, assertRunTransition } from './state-machine.ts'

/** Snapshot reconstructed from a contiguous workflow event stream. */
export interface WorkflowReplaySnapshot {
  readonly runId: RunId
  readonly runStatus: RunStatus
  readonly nodeStates: ReadonlyMap<NodeId, NodeState>
  readonly lastSeq: number
  readonly eventCount: number
}

/** A persisted event stream that cannot be safely replayed. */
export class WorkflowReplayError extends Error {
  /** Stable machine-readable error code. */
  readonly code = 'WORKFLOW_REPLAY_FAILED'

  /**
   * @param runId - Run whose event stream failed validation.
   * @param reason - Specific replay failure.
   */
  constructor(readonly runId: RunId, reason: string) {
    super(`workflow run '${runId}' cannot be replayed: ${reason}`)
    this.name = 'WorkflowReplayError'
  }
}

/**
 * Rebuild run and node lifecycle state from the append-only event stream.
 * Sequence gaps, cross-run events, malformed transition payloads, and
 * transitions that violate the state table fail closed.
 * @param runId - Expected run identifier.
 * @param events - Events in any order; replay sorts by sequence.
 * @returns immutable replay snapshot.
 */
export function replayWorkflow(runId: RunId, events: readonly WorkflowEvent[]): WorkflowReplaySnapshot {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const nodeStates = new Map<NodeId, NodeState>()
  let runStatus: RunStatus = 'planning'
  let expectedSeq = 1

  for (const event of ordered) {
    if (event.runId !== runId) throw new WorkflowReplayError(runId, `event ${event.seq} belongs to another run`)
    if (event.seq !== expectedSeq) {
      throw new WorkflowReplayError(runId, `expected sequence ${expectedSeq}, received ${event.seq}`)
    }
    expectedSeq += 1
    try {
      switch (event.type) {
        case 'run_state':
          runStatus = transitionRun(runId, runStatus, event.data, event.seq)
          break
        case 'node_created':
          createNode(nodeStates, event, runId)
          break
        case 'node_state':
          transitionNode(nodeStates, event, runId)
          break
        case 'recovery':
          transitionNodeFromRecovery(nodeStates, event, runId)
          break
        case 'paused':
          if (event.nodeId === null) runStatus = transitionRunTo(runId, runStatus, 'paused')
          else setNode(nodeStates, event.nodeId, 'paused', runId, event.seq)
          break
        case 'completed':
          runStatus = transitionRunTo(runId, runStatus, 'completed')
          break
        case 'failed':
          runStatus = transitionRunTo(runId, runStatus, 'failed')
          break
        default:
          break
      }
    } catch (error) {
      if (error instanceof WorkflowReplayError) throw error
      throw new WorkflowReplayError(runId, `event ${event.seq}: ${String(error)}`)
    }
  }

  return {
    runId,
    runStatus,
    nodeStates: new Map(nodeStates),
    lastSeq: ordered.at(-1)?.seq ?? 0,
    eventCount: ordered.length,
  }
}

function transitionRun(
  runId: RunId,
  current: RunStatus,
  data: Record<string, unknown>,
  seq: number,
): RunStatus {
  const from = runStatusSchema.parse(data.from)
  const to = runStatusSchema.parse(data.to)
  if (from !== current) throw new Error(`event ${seq} says run is '${from}', replay state is '${current}'`)
  return assertRunTransition(runId, from, to)
}

function transitionRunTo(runId: RunId, current: RunStatus, to: RunStatus): RunStatus {
  if (current === to) return current
  return assertRunTransition(runId, current, to)
}

function createNode(
  nodeStates: Map<NodeId, NodeState>,
  event: WorkflowEvent,
  runId: RunId,
): void {
  if (event.nodeId === null) throw new Error('node_created event has no node id')
  if (nodeStates.has(event.nodeId)) throw new Error(`node '${event.nodeId}' was created twice`)
  nodeStates.set(event.nodeId, 'pending')
  if (event.runId !== runId) throw new Error('node event belongs to another run')
}

function transitionNode(
  nodeStates: Map<NodeId, NodeState>,
  event: WorkflowEvent,
  runId: RunId,
): void {
  if (event.nodeId === null) throw new Error(`event ${event.seq} has no node id`)
  const current = nodeStates.get(event.nodeId)
  if (current === undefined) throw new Error(`node '${event.nodeId}' was not created`)
  const from = nodeStateSchema.parse(event.data.from)
  const to = nodeStateSchema.parse(event.data.to)
  if (from !== current) throw new Error(`event ${event.seq} says node is '${from}', replay state is '${current}'`)
  setNode(nodeStates, event.nodeId, assertNodeTransition(event.nodeId, from, to), runId, event.seq)
}

function transitionNodeFromRecovery(
  nodeStates: Map<NodeId, NodeState>,
  event: WorkflowEvent,
  runId: RunId,
): void {
  if (event.nodeId === null) throw new Error(`event ${event.seq} has no node id`)
  const current = nodeStates.get(event.nodeId)
  if (current === undefined) throw new Error(`node '${event.nodeId}' was not created`)
  const to = nodeStateSchema.parse(event.data.to)
  setNode(nodeStates, event.nodeId, to, runId, event.seq)
}

function setNode(
  nodeStates: Map<NodeId, NodeState>,
  nodeId: NodeId,
  state: NodeState,
  runId: RunId,
  seq: number,
): void {
  if (typeof nodeId !== 'string' || nodeId.length === 0) throw new Error(`event ${seq} has an invalid node id`)
  if (typeof runId !== 'string' || runId.length === 0) throw new Error(`event ${seq} has an invalid run id`)
  nodeStates.set(nodeId, state)
}
