/**
 * paper domain contract: workflow-run control, resumable event reads, and
 * the signed skill catalog. Reads and mutations both live here because runs
 * have no session projection — the durable event log is the read model and
 * `events` carries the `afterSeq` cursor clients resume from.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire projection of one run node. */
export interface PaperNodeView {
  readonly id: string
  readonly type: 'plan' | 'execute' | 'review' | 'revise' | 'deliver'
  readonly state: 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'paused'
  readonly title: string
  readonly attempts: number
  readonly maxAttempts: number
}

/** Wire projection of one workflow run, including its event cursor. */
export interface PaperRunView {
  readonly id: string
  readonly status: 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  readonly mode: 'fast' | 'strict'
  readonly createdAt: string
  readonly updatedAt: string
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number }
  readonly version: number
  readonly lastEventSeq: number
  readonly nodes: readonly PaperNodeView[]
}

/** Wire projection of one persisted workflow event. */
export interface PaperEventView {
  readonly seq: number
  readonly type: string
  readonly nodeId: string | null
  readonly data: Record<string, unknown>
  readonly timestamp: string
}

/** Wire projection of one installed skill catalog record. */
export interface PaperSkillView {
  readonly id: string
  readonly installedVersion: string
  readonly versions: readonly {
    readonly version: string
    readonly installedAt: string
    readonly signatureOk: boolean
  }[]
}

/** Paper-domain unary methods (the paper.* keys of RpcMethodMap). */
export interface PaperApi {
  /** Workflow run control and resumable event reads. */
  runs: {
    /** List every run with its node states and event cursor. */
    list(request: RpcRequest<{}>): Promise<RpcResponse<{ runs: readonly PaperRunView[] }>>

    /** Resolve one run snapshot by id. */
    get(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: PaperRunView }>>

    /** Create a new planning run; the run id and first event are durable. */
    start(request: RpcRequest<{ mode: 'fast' | 'strict' }>): Promise<RpcResponse<{ run: PaperRunView }>>

    /** Transition one run to paused. */
    pause(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: PaperRunView }>>

    /** Transition one paused run back to running. */
    resume(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: PaperRunView }>>

    /** Transition one active run to cancelled. */
    cancel(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: PaperRunView }>>

    /** Read one run's events after a sequence cursor for resumable consumption. */
    events(request: RpcRequest<{ runId: string; afterSeq?: number }>): Promise<
      RpcResponse<{ events: readonly PaperEventView[]; lastSeq: number }>
    >
  }

  /** Signed skill catalog operations. */
  skills: {
    /** List installed records with their version history. */
    list(request: RpcRequest<{}>): Promise<RpcResponse<{ skills: readonly PaperSkillView[] }>>

    /** Validate and install one signed package directory. */
    install(request: RpcRequest<{ directory: string }>): Promise<RpcResponse<{ skill: PaperSkillView }>>

    /** Re-validate and activate a previously installed version. */
    rollback(request: RpcRequest<{ id: string; toVersion: string }>): Promise<RpcResponse<{ skill: PaperSkillView }>>
  }
}
