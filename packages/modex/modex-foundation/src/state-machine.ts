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

/**
 * Validate one run transition against the declared edge set.
 * @param id - run whose transition is being judged, named in the refusal.
 * @param from - state the run currently holds.
 * @param to - state the caller wants to reach.
 * @returns the target state when the edge is declared.
 */
export function assertRunTransition(id: string, from: RunStatus, to: RunStatus): RunStatus {
  if (!runTransitions[from].includes(to)) throw new InvalidWorkflowTransitionError('run', id, from, to)
  return to
}

/**
 * Validate one node transition against the declared edge set.
 * @param id - node whose transition is being judged, named in the refusal.
 * @param from - state the node currently holds.
 * @param to - state the caller wants to reach.
 * @returns the target state when the edge is declared.
 */
export function assertNodeTransition(id: string, from: NodeState, to: NodeState): NodeState {
  if (!nodeTransitions[from].includes(to)) throw new InvalidWorkflowTransitionError('node', id, from, to)
  return to
}

/**
 * Whether one more attempt stays within a node's ceiling.
 * @param attempts - attempts already spent.
 * @param maxAttempts - ceiling the node was created with.
 * @returns whether another attempt is permitted.
 */
export function canRetryNode(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts
}
