/** Durable workflow-run records and the Paper role configuration schemas. */

import { randomUUID } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'

/** Opaque identifier for one workflow run. */
export type RunId = Branded<'PaperRunId'>
/** Opaque identifier for one workflow node. */
export type NodeId = Branded<'PaperNodeId'>
/** Opaque identifier for one workflow artifact. */
export type ArtifactId = Branded<'PaperArtifactId'>

const opaqueUuid = <B extends string>() => z.uuid().transform(value => value as Branded<B>)
const timestampSchema = z.iso.datetime({ offset: true })
const nonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const jsonObject = z.record(z.string(), z.unknown())

/** Runtime validation for a run identifier. */
export const runIdSchema = opaqueUuid<'PaperRunId'>()
/** Runtime validation for a node identifier. */
export const nodeIdSchema = opaqueUuid<'PaperNodeId'>()
/** Runtime validation for an artifact identifier. */
export const artifactIdSchema = opaqueUuid<'PaperArtifactId'>()

/** Lifecycle states for one workflow run. */
export const runStatusSchema = z.enum(['planning', 'running', 'paused', 'completed', 'failed', 'cancelled'])
/** Lifecycle states for one workflow node. */
export const nodeStateSchema = z.enum(['pending', 'ready', 'running', 'succeeded', 'failed', 'skipped', 'paused'])
/** Supported workflow node responsibilities. */
export const nodeTypeSchema = z.enum(['plan', 'execute', 'review', 'revise', 'deliver'])
/** Runtime mode controlling the later workflow policy. */
export const runModeSchema = z.enum(['fast', 'strict'])

/** Persisted usage accounting for a run. */
export const usageSchema = z.object({
  inputTokens: nonNegativeInteger,
  outputTokens: nonNegativeInteger,
  costUsd: z.number().nonnegative(),
})

/** One durable run record. */
export const runRecordSchema = z.object({
  id: runIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  status: runStatusSchema,
  mode: runModeSchema,
  harnessVersion: z.string().min(1),
  configHash: z.string().min(1),
  usage: usageSchema,
  version: z.number().int().positive(),
})

/** One durable node record. */
export const nodeRecordSchema = z.object({
  id: nodeIdSchema,
  runId: runIdSchema,
  parentId: nodeIdSchema.nullable(),
  type: nodeTypeSchema,
  title: z.string().min(1),
  role: z.enum(['executor', 'reviewer', 'editor_ai']).nullable(),
  state: nodeStateSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  idempotent: z.boolean(),
  inputArtifactId: artifactIdSchema.nullable(),
  outputArtifactId: artifactIdSchema.nullable(),
  lastErrorCode: z.string().min(1).nullable(),
  version: z.number().int().positive(),
})

/** Persisted event envelope; payloads remain JSON and are bounded by callers. */
export const workflowEventSchema = z.object({
  runId: runIdSchema,
  nodeId: nodeIdSchema.nullable(),
  seq: z.number().int().positive(),
  type: z.enum([
    'plan_ready', 'run_state', 'node_created', 'node_state', 'request_started',
    'context_compacted', 'reasoning_delta', 'text_delta',
    'tool_call', 'tool_result', 'usage', 'defect', 'gate_result', 'completed',
    'failed', 'paused', 'recovery',
  ]),
  data: jsonObject,
  timestamp: timestampSchema,
})

/** Durable artifact metadata; content is stored separately by a later provider. */
export const artifactRecordSchema = z.object({
  id: artifactIdSchema,
  runId: runIdSchema,
  nodeId: nodeIdSchema.nullable(),
  kind: z.enum(['text', 'json', 'file', 'image', 'tool_result']),
  mime: z.string().min(1),
  size: nonNegativeInteger,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storageKey: z.string().min(1),
})

/** Final run summary produced by the later delivery stage. */
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: runIdSchema,
  harnessVersion: z.string().min(1),
  mode: runModeSchema,
  finalArtifactId: artifactIdSchema.nullable(),
  gates: z.record(z.string(), z.boolean()),
  usage: usageSchema,
  redacted: z.literal(true),
})

/** Provider route configuration shared by the three workflow roles. */
export const providerRouteSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  credentialRef: z.string().min(1),
  timeoutMs: z.number().int().positive(),
})

/** Paper role settings; credential values never belong in this document. */
export const paperSettingsSchema = z.object({
  executor: providerRouteSchema,
  reviewer: providerRouteSchema,
  editorAi: providerRouteSchema,
  defaultMode: runModeSchema,
})

/** One domain declaration used by the durable repository. */
export const workflowRunDomainSpec = defineDomain({
  name: 'paper_workflow',
  version: 1,
  tables: {
    runs: domainTable<RunId, z.infer<typeof runRecordSchema>>(runRecordSchema),
    nodes: domainTable<NodeId, z.infer<typeof nodeRecordSchema>>(nodeRecordSchema),
    events: domainTable<string, z.infer<typeof workflowEventSchema>>(workflowEventSchema),
    artifacts: domainTable<ArtifactId, z.infer<typeof artifactRecordSchema>>(artifactRecordSchema),
    manifests: domainTable<RunId, z.infer<typeof manifestSchema>>(manifestSchema),
  },
})

/** Execution mode of one run, which bounds its review loop and budget. */
export type RunMode = z.infer<typeof runModeSchema>
/** Token and cost accounting accumulated onto one run. */
export type Usage = z.infer<typeof usageSchema>
/** Lifecycle state of one run. */
export type RunStatus = z.infer<typeof runStatusSchema>
/** Lifecycle state of one node. */
export type NodeState = z.infer<typeof nodeStateSchema>
/** Responsibility one node carries in the workflow. */
export type NodeType = z.infer<typeof nodeTypeSchema>
/** One durable run record. */
export type RunRecord = z.infer<typeof runRecordSchema>
/** One durable node record. */
export type NodeRecord = z.infer<typeof nodeRecordSchema>
/** One persisted workflow event. */
export type WorkflowEvent = z.infer<typeof workflowEventSchema>
/** Durable metadata for one run artifact. */
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>
/** Final summary recorded when a run delivers. */
export type Manifest = z.infer<typeof manifestSchema>
/** Provider route one workflow role dispatches through. */
export type ProviderRoute = z.infer<typeof providerRouteSchema>
/** Role settings document; credential values never appear here. */
export type PaperSettings = z.infer<typeof paperSettingsSchema>

/**
 * Create one opaque run identifier.
 * @returns a fresh branded run id.
 */
export function newRunId(): RunId {
  return randomUUID() as RunId
}

/**
 * Brand an existing string as a {@link RunId}; no validation is performed.
 * @param id - the persisted run identifier.
 * @returns the same string, branded.
 */
export function RunId(id: string): RunId {
  return id as RunId
}

/**
 * Create one opaque node identifier.
 * @returns a fresh branded node id.
 */
export function newNodeId(): NodeId {
  return randomUUID() as NodeId
}

/**
 * Brand an existing string as a {@link NodeId}; no validation is performed.
 * @param id - the persisted node identifier.
 * @returns the same string, branded.
 */
export function NodeId(id: string): NodeId {
  return id as NodeId
}

/**
 * Create one opaque artifact identifier.
 * @returns a fresh branded artifact id.
 */
export function newArtifactId(): ArtifactId {
  return randomUUID() as ArtifactId
}

/**
 * Brand an existing string as an {@link ArtifactId}; no validation is performed.
 * @param id - the persisted artifact identifier.
 * @returns the same string, branded.
 */
export function ArtifactId(id: string): ArtifactId {
  return id as ArtifactId
}
