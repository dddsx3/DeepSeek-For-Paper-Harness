/** Workflow run and node transition rules for the Harness engine. */

import type { NodeState, RunStatus } from './state-types.ts'

/** A transition rejected because the current state cannot reach the target. */
export class InvalidWorkflowTransitionError extends Error {
  /** Stable machine-readable error code. */
  readonly code = 'INVALID_WORKFLOW_TRANSITION'

  /**
   * @param entity - run or node.
   * @param id - entity identifier.
   * @param from - current state.
   * @param to - requested state.
   */
  constructor(entity: 'run' | 'node', id: string, from: string, to: string) {
    super(`${entity} '${id}' cannot transition from '${from}' to '${to}'`)
    this.name = 'InvalidWorkflowTransitionError'
  }
}

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  planning: ['running', 'failed', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
}

const nodeTransitions: Record<NodeState, readonly NodeState[]> = {
  pending: ['ready', 'skipped'],
  ready: ['running', 'skipped', 'paused'],
  running: ['succeeded', 'failed', 'paused'],
  succeeded: [],
  failed: ['ready', 'paused'],
  skipped: [],
  paused: ['ready', 'skipped'],
}

/** Validate a run transition and return the target state. */
export function assertRunTransition(id: string, from: RunStatus, to: RunStatus): RunStatus {
  if (!runTransitions[from].includes(to)) throw new InvalidWorkflowTransitionError('run', id, from, to)
  return to
}

/** Validate a node transition and return the target state. */
export function assertNodeTransition(id: string, from: NodeState, to: NodeState): NodeState {
  if (!nodeTransitions[from].includes(to)) throw new InvalidWorkflowTransitionError('node', id, from, to)
  return to
}

/** Return whether a node can be retried without exceeding its attempt limit. */
export function canRetryNode(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts
}
