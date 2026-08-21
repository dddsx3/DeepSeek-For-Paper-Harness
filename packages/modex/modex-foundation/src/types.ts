/**
 * Client-safe type surface of the Harness foundation: type-only re-exports and
 * the cordis `Events` declaration consumers and the api-remotes forwarding
 * face read. No runtime imports belong here.
 *
 * @module @deepseek-ai/dsh-harness-foundation/types
 */

import type { WorkflowEvent } from './spec.ts'

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

export type { WorkflowEvent } from './spec.ts'
export type { RunId, NodeId, ArtifactId } from './spec.ts'
