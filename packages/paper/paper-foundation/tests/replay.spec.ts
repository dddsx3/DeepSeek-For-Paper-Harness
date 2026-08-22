import { describe, expect, it } from 'vitest'
import {
  WorkflowReplayError,
  newNodeId,
  newRunId,
  replayWorkflow,
  type WorkflowEvent,
} from '../src/index.ts'

const timestamp = '2026-08-22T00:00:00.000Z'

function event(
  runId: WorkflowEvent['runId'],
  seq: number,
  type: WorkflowEvent['type'],
  nodeId: WorkflowEvent['nodeId'],
  data: Record<string, unknown>,
): WorkflowEvent {
  return { runId, seq, type, nodeId, data, timestamp }
}

describe('replayWorkflow', () => {
  it('reconstructs run and node state from an ordered event stream', () => {
    const runId = newRunId()
    const nodeId = newNodeId()
    const snapshot = replayWorkflow(runId, [
      event(runId, 3, 'node_state', nodeId, { from: 'ready', to: 'running' }),
      event(runId, 1, 'node_created', nodeId, { state: 'pending' }),
      event(runId, 2, 'node_state', nodeId, { from: 'pending', to: 'ready' }),
      event(runId, 4, 'run_state', null, { from: 'planning', to: 'running' }),
    ])
    expect(snapshot.runStatus).toBe('running')
    expect(snapshot.nodeStates.get(nodeId)).toBe('running')
    expect(snapshot.lastSeq).toBe(4)
  })

  it('fails closed on gaps and contradictory state facts', () => {
    const runId = newRunId()
    expect(() => replayWorkflow(runId, [
      event(runId, 2, 'plan_ready', null, {}),
    ])).toThrow(WorkflowReplayError)

    const nodeId = newNodeId()
    expect(() => replayWorkflow(runId, [
      event(runId, 1, 'node_created', nodeId, {}),
      event(runId, 2, 'node_state', nodeId, { from: 'ready', to: 'running' }),
    ])).toThrow(WorkflowReplayError)
  })
})
