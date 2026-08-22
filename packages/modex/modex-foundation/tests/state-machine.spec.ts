import { describe, expect, it } from 'vitest'
import {
  InvalidWorkflowTransitionError,
  WorkflowReplayError,
  assertNodeTransition,
  assertRunTransition,
  canRetryNode,
  newNodeId,
  newRunId,
  replayWorkflow,
  type NodeState,
  type RunStatus,
  type WorkflowEvent,
} from '../src/index.ts'

const timestamp = '2026-08-22T00:00:00.000Z'

const RUN_EDGES: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  planning: ['running', 'failed', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

const NODE_EDGES: Readonly<Record<NodeState, readonly NodeState[]>> = {
  pending: ['ready', 'skipped'],
  ready: ['running', 'skipped', 'paused'],
  running: ['succeeded', 'failed', 'paused'],
  succeeded: [],
  failed: ['ready', 'paused'],
  skipped: [],
  paused: ['ready', 'skipped'],
}

const RUN_STATES = Object.keys(RUN_EDGES) as RunStatus[]
const NODE_STATES = Object.keys(NODE_EDGES) as NodeState[]

function event(
  runId: WorkflowEvent['runId'],
  seq: number,
  type: WorkflowEvent['type'],
  nodeId: WorkflowEvent['nodeId'],
  data: Record<string, unknown> = {},
): WorkflowEvent {
  return { runId, seq, type, nodeId, data, timestamp }
}

describe('workflow transition table', () => {
  it('accepts exactly the declared run edges and refuses every other pair', () => {
    for (const from of RUN_STATES) {
      for (const to of RUN_STATES) {
        if (RUN_EDGES[from].includes(to)) {
          expect(assertRunTransition('run-1', from, to)).toBe(to)
        } else {
          expect(() => assertRunTransition('run-1', from, to)).toThrow(InvalidWorkflowTransitionError)
        }
      }
    }
  })

  it('accepts exactly the declared node edges and refuses every other pair', () => {
    for (const from of NODE_STATES) {
      for (const to of NODE_STATES) {
        if (NODE_EDGES[from].includes(to)) {
          expect(assertNodeTransition('node-1', from, to)).toBe(to)
        } else {
          expect(() => assertNodeTransition('node-1', from, to)).toThrow(InvalidWorkflowTransitionError)
        }
      }
    }
  })

  it('names the entity, id, and states it refused', () => {
    expect(() => assertRunTransition('run-9', 'completed', 'running'))
      .toThrow("run 'run-9' cannot transition from 'completed' to 'running'")
    expect(() => assertNodeTransition('node-9', 'succeeded', 'ready'))
      .toThrow("node 'node-9' cannot transition from 'succeeded' to 'ready'")
  })

  it('permits a retry only while attempts remain', () => {
    expect(canRetryNode(0, 1)).toBe(true)
    expect(canRetryNode(1, 1)).toBe(false)
    expect(canRetryNode(2, 5)).toBe(true)
    expect(canRetryNode(5, 5)).toBe(false)
  })
})

describe('replay of the remaining event kinds', () => {
  it('follows recovery, pause, completion, and failure events', () => {
    const runId = newRunId()
    const nodeId = newNodeId()
    const snapshot = replayWorkflow(runId, [
      event(runId, 1, 'node_created', nodeId),
      event(runId, 2, 'run_state', null, { from: 'planning', to: 'running' }),
      event(runId, 3, 'node_state', nodeId, { from: 'pending', to: 'ready' }),
      event(runId, 4, 'node_state', nodeId, { from: 'ready', to: 'running' }),
      event(runId, 5, 'recovery', nodeId, { from: 'running', to: 'failed' }),
      event(runId, 6, 'recovery', nodeId, { to: 'ready' }),
      event(runId, 7, 'paused', nodeId, { reason: 'needs review' }),
      event(runId, 8, 'paused', null, { reason: 'process recovery' }),
      event(runId, 9, 'text_delta', nodeId, { text: 'ignored by replay' }),
    ])
    expect(snapshot.runStatus).toBe('paused')
    expect(snapshot.nodeStates.get(nodeId)).toBe('paused')
    expect(snapshot.eventCount).toBe(9)

    const completed = replayWorkflow(runId, [
      event(runId, 1, 'run_state', null, { from: 'planning', to: 'running' }),
      event(runId, 2, 'completed', null, { manifest: 'ref' }),
      event(runId, 3, 'completed', null, { manifest: 'ref' }),
    ])
    expect(completed.runStatus).toBe('completed')

    const failed = replayWorkflow(runId, [
      event(runId, 1, 'run_state', null, { from: 'planning', to: 'running' }),
      event(runId, 2, 'failed', null, { code: 'provider-blocked' }),
    ])
    expect(failed.runStatus).toBe('failed')
  })

  it('refuses an event stream that mixes runs', () => {
    const runId = newRunId()
    const foreign = newRunId()
    expect(() => replayWorkflow(runId, [event(foreign, 1, 'plan_ready', null)]))
      .toThrow('belongs to another run')
  })

  it('refuses node events that name no node or an uncreated node', () => {
    const runId = newRunId()
    const nodeId = newNodeId()
    expect(() => replayWorkflow(runId, [event(runId, 1, 'node_created', null)]))
      .toThrow(WorkflowReplayError)
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'node_state', null, { from: 'pending', to: 'ready' }),
    ])).toThrow(WorkflowReplayError)
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'recovery', null, { to: 'ready' }),
    ])).toThrow(WorkflowReplayError)
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'recovery', nodeId, { to: 'ready' }),
    ])).toThrow(WorkflowReplayError)
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'node_state', nodeId, { from: 'pending', to: 'ready' }),
    ])).toThrow('was not created')
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'node_created', nodeId),
      event(runId, 2, 'node_created', nodeId),
    ])).toThrow('created twice')
  })

  it('refuses an illegal run transition and a contradictory run state', () => {
    const runId = newRunId()
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'run_state', null, { from: 'planning', to: 'completed' }),
    ])).toThrow(WorkflowReplayError)
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'run_state', null, { from: 'running', to: 'paused' }),
    ])).toThrow('replay state is')
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'run_state', null, { from: 'planning', to: 'not-a-status' }),
    ])).toThrow(WorkflowReplayError)
  })

  it('reports an empty stream as sequence zero', () => {
    const runId = newRunId()
    const snapshot = replayWorkflow(runId, [])
    expect(snapshot).toMatchObject({ runStatus: 'planning', lastSeq: 0, eventCount: 0 })
    expect(snapshot.nodeStates.size).toBe(0)
  })
})
