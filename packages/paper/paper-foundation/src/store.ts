/** Durable repository for the Paper workflow-run domain. */

import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  ArtifactId,
  ArtifactRecord,
  Manifest,
  NodeId,
  NodeRecord,
  RunId,
  RunRecord,
  WorkflowEvent,
} from './spec.ts'
import { workflowRunDomainSpec } from './spec.ts'

/** Storage operations required by the workflow engine. */
export interface WorkflowRunRepository {
  getRun(id: RunId): RunRecord | undefined
  listRuns(): RunRecord[]
  putRun(record: RunRecord): Promise<void>
  getNode(id: NodeId): NodeRecord | undefined
  listNodes(runId: RunId): NodeRecord[]
  putNode(record: NodeRecord): Promise<void>
  appendEvent(event: WorkflowEvent): Promise<void>
  listEvents(runId: RunId, afterSeq?: number): WorkflowEvent[]
  latestEventSeq(runId: RunId): number
  putArtifact(record: ArtifactRecord): Promise<void>
  getArtifact(id: ArtifactId): ArtifactRecord | undefined
  putManifest(manifest: Manifest): Promise<void>
  getManifest(runId: RunId): Manifest | undefined
  close(): Promise<void>
}

/** In-process repository backed by the shared storage-domain service. */
export class DomainWorkflowRunRepository implements WorkflowRunRepository {
  private readonly runs: KvTable<RunId, RunRecord>
  private readonly nodes: KvTable<NodeId, NodeRecord>
  private readonly events: KvTable<string, WorkflowEvent>
  private readonly artifacts: KvTable<ArtifactId, ArtifactRecord>
  private readonly manifests: KvTable<RunId, Manifest>

  /**
   * @param domain - Opened Paper workflow domain owned by this repository.
   */
  constructor(private readonly domain: Domain<typeof workflowRunDomainSpec>) {
    this.runs = domain.table('runs')
    this.nodes = domain.table('nodes')
    this.events = domain.table('events')
    this.artifacts = domain.table('artifacts')
    this.manifests = domain.table('manifests')
  }

  /** @inheritdoc */
  getRun(id: RunId): RunRecord | undefined {
    return this.runs.get(id)
  }

  /** @inheritdoc */
  listRuns(): RunRecord[] {
    return [...this.runs.entries()].map(([, run]) => run)
  }

  /** @inheritdoc */
  putRun(record: RunRecord): Promise<void> {
    return this.runs.put(record.id, record)
  }

  /** @inheritdoc */
  getNode(id: NodeId): NodeRecord | undefined {
    return this.nodes.get(id)
  }

  /** @inheritdoc */
  listNodes(runId: RunId): NodeRecord[] {
    return [...this.nodes.entries()]
      .map(([, node]) => node)
      .filter(node => node.runId === runId)
  }

  /** @inheritdoc */
  putNode(record: NodeRecord): Promise<void> {
    return this.nodes.put(record.id, record)
  }

  /** @inheritdoc */
  async appendEvent(event: WorkflowEvent): Promise<void> {
    const key = `${event.runId}:${String(event.seq).padStart(16, '0')}`
    if (this.events.get(key) !== undefined) {
      throw new Error(`workflow event '${key}' already exists`)
    }
    await this.events.put(key, event)
  }

  /** @inheritdoc */
  listEvents(runId: RunId, afterSeq: number = 0): WorkflowEvent[] {
    return [...this.events.entries()]
      .map(([, event]) => event)
      .filter(event => event.runId === runId && event.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq)
  }

  /** @inheritdoc */
  latestEventSeq(runId: RunId): number {
    return this.listEvents(runId).at(-1)?.seq ?? 0
  }

  /** @inheritdoc */
  putArtifact(record: ArtifactRecord): Promise<void> {
    return this.artifacts.put(record.id, record)
  }

  /** @inheritdoc */
  getArtifact(id: ArtifactId): ArtifactRecord | undefined {
    return this.artifacts.get(id)
  }

  /** @inheritdoc */
  putManifest(manifest: Manifest): Promise<void> {
    return this.manifests.put(manifest.runId, manifest)
  }

  /** @inheritdoc */
  getManifest(runId: RunId): Manifest | undefined {
    return this.manifests.get(runId)
  }

  /** @inheritdoc */
  close(): Promise<void> {
    return this.domain.close()
  }
}
