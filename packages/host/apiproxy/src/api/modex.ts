/**
 * harness domain contract: workflow-run control, resumable event reads, and
 * the signed skill catalog. Reads and mutations both live here because runs
 * have no session projection — the durable event log is the read model and
 * `events` carries the `afterSeq` cursor clients resume from.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire projection of one run node. */
export interface HarnessNodeView {
  readonly id: string
  readonly type: 'plan' | 'execute' | 'review' | 'revise' | 'deliver'
  readonly state: 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'paused'
  readonly title: string
  readonly attempts: number
  readonly maxAttempts: number
}

/** Wire projection of one workflow run, including its event cursor. */
export interface HarnessRunView {
  readonly id: string
  readonly status: 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  readonly mode: 'fast' | 'strict'
  readonly createdAt: string
  readonly updatedAt: string
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number }
  readonly version: number
  readonly lastEventSeq: number
  readonly nodes: readonly HarnessNodeView[]
}

/** Wire projection of one persisted workflow event. */
export interface HarnessEventView {
  readonly seq: number
  readonly type: string
  readonly nodeId: string | null
  readonly data: Record<string, unknown>
  readonly timestamp: string
}

/** Wire projection of one installed skill catalog record. */
export interface HarnessSkillView {
  readonly id: string
  readonly installedVersion: string
  readonly versions: readonly {
    readonly version: string
    readonly installedAt: string
    readonly signatureOk: boolean
  }[]
}

/** Harness-domain unary methods (the harness.* keys of RpcMethodMap). */
export interface HarnessApi {
  /** Workflow run control and resumable event reads. */
  runs: {
    /** List every run with its node states and event cursor. */
    list(request: RpcRequest<{}>): Promise<RpcResponse<{ runs: readonly HarnessRunView[] }>>

    /** Resolve one run snapshot by id. */
    get(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: HarnessRunView }>>

    /** Create a new planning run; the run id and first event are durable. */
    start(request: RpcRequest<{ mode: 'fast' | 'strict' }>): Promise<RpcResponse<{ run: HarnessRunView }>>

    /** Transition one run to paused. */
    pause(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: HarnessRunView }>>

    /** Transition one paused run back to running. */
    resume(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: HarnessRunView }>>

    /** Transition one active run to cancelled. */
    cancel(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: HarnessRunView }>>

    /** Read one run's events after a sequence cursor for resumable consumption. */
    events(request: RpcRequest<{ runId: string; afterSeq?: number }>): Promise<
      RpcResponse<{ events: readonly HarnessEventView[]; lastSeq: number }>
    >
  }

  /** Signed skill catalog operations. */
  skills: {
    /** List installed records with their version history. */
    list(request: RpcRequest<{}>): Promise<RpcResponse<{ skills: readonly HarnessSkillView[] }>>

    /** Validate and install one signed package directory. */
    install(request: RpcRequest<{ directory: string }>): Promise<RpcResponse<{ skill: HarnessSkillView }>>

    /** Re-validate and activate a previously installed version. */
    rollback(request: RpcRequest<{ id: string; toVersion: string }>): Promise<RpcResponse<{ skill: HarnessSkillView }>>
  }
}
