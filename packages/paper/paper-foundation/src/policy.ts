/** Mode-dependent execution policy for workflow runs. */

import type { RunMode } from './spec.ts'

/** Bounds applied to one run's execution loop. */
export interface RunPolicy {
  /** Maximum review-revise rounds before the gate outcome is final. */
  readonly maxReviseRounds: number
  /** Attempt ceiling handed to each created node. */
  readonly maxNodeAttempts: number
}

/**
 * Resolve one mode's policy. Fast mode delivers after a single revise round;
 * strict and exploratory modes allow three and fail the run when defects
 * persist. Exploratory shares strict's round ceiling: its difference from
 * the formal modes is the backbone-exempt delivery gate (5.0-R decision 1),
 * not a looser review loop — the review gate treats every mode alike.
 * @param mode - the run's execution mode.
 * @returns the policy bound to that mode.
 */
export function resolveRunPolicy(mode: RunMode): RunPolicy {
  return mode === 'fast'
    ? { maxReviseRounds: 1, maxNodeAttempts: 3 }
    : { maxReviseRounds: 3, maxNodeAttempts: 3 }
}
