/**
 * Legacy asset translation. The predecessor build kept its configuration in a
 * flat snake_case document and its run history in its own store; this module
 * turns both into the records this package declares.
 *
 * Everything here is pure. Translation decides *what* the new records are and
 * refuses anything it cannot map; deciding *when* to write them, and keeping
 * the legacy source intact while doing so, belongs to `migration.ts`. Keeping
 * the two apart is what makes a dry run trustworthy: the same functions
 * produce the preview and the committed result.
 *
 * One rule outranks convenience: a legacy document may hold a credential
 * value inline, and this module never carries one into a settings record. A
 * value it finds becomes a {@link CredentialPlacement} the caller stores
 * through the credentials seam, and the settings record keeps only the
 * reference.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/legacy
 */

import { z } from 'zod'
import {
  ArtifactId, NodeId, RunId,
  type PaperSettings, type NodeRecord, type NodeState, type NodeType,
  type ProviderRoute, type RunMode, type RunRecord, type RunStatus, type Usage,
  type WorkflowEvent,
} from './spec.ts'

/** A legacy asset that could not be translated. */
export class LegacyMigrationError extends Error {
  /** Stable machine-readable code. */
  readonly code = 'LEGACY_UNMAPPABLE'

  /**
   * @param subject - which legacy asset was refused, safe for diagnostics.
   * @param reason - why it could not be mapped.
   */
  constructor(readonly subject: string, reason: string) {
    super(`legacy ${subject} cannot be migrated: ${reason}`)
    this.name = 'LegacyMigrationError'
  }
}

/** One legacy role block, as the predecessor document spelled it. */
const legacyRoleSchema = z.object({
  base_url: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  model_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().optional(),
  supports_tools: z.boolean().optional(),
})

/**
 * Legacy settings document. Every field is optional because the predecessor
 * wrote partial documents; {@link migrateLegacySettings} decides which
 * absences are fatal and which fall back to a supplied default.
 */
export const legacySettingsSchema = z.object({
  executor: legacyRoleSchema.optional(),
  reviewer: legacyRoleSchema.optional(),
  editor_ai: legacyRoleSchema.optional(),
  mode: z.string().min(1).optional(),
  // The oldest documents were flat rather than role-nested.
  executor_base_url: z.string().min(1).optional(),
  executor_api_key: z.string().min(1).optional(),
  executor_model_id: z.string().min(1).optional(),
})

/** Legacy settings document. */
export type LegacySettings = z.infer<typeof legacySettingsSchema>

/** The three roles a Paper settings record routes. */
export const PAPER_ROLES = ['executor', 'reviewer', 'editorAi'] as const

/** One Paper role name. */
export type PaperRoleName = typeof PAPER_ROLES[number]

/** A credential value lifted out of a legacy document, to store by reference. */
export interface CredentialPlacement {
  /** Reference the migrated settings record names. */
  readonly ref: string
  /** The value to hand to the credentials seam; never persisted in settings. */
  readonly value: string
  /** Role whose route names this reference. */
  readonly role: PaperRoleName
}

/** A migrated settings record plus the credential values to store separately. */
export interface MigratedSettings {
  /** The new settings record, holding references only. */
  readonly settings: PaperSettings
  /** Credential values to store through the credentials seam, in role order. */
  readonly credentials: readonly CredentialPlacement[]
}

/** How to resolve values a legacy document leaves unstated. */
export interface LegacySettingsOptions {
  /**
   * Provider id per base-URL path segment, e.g. `{ anthropic: 'anthropic-http' }`.
   * A deployment supplies its own table so no vendor is wired into this module.
   */
  readonly providerByPathSegment?: Readonly<Record<string, string>>
  /** Provider id for a base URL no segment matches. */
  readonly defaultProvider: string
  /** Model id for a role the legacy document leaves unstated. */
  readonly defaultModel: string
  /** Request timeout for a role the legacy document leaves unstated. */
  readonly defaultTimeoutMs?: number
  /** Builds the credential reference name for one role. */
  readonly credentialRef?: (role: PaperRoleName) => string
}

/** Request timeout applied when neither the document nor the caller states one. */
export const DEFAULT_LEGACY_TIMEOUT_MS = 120_000

const LEGACY_ROLE_KEYS: Readonly<Record<PaperRoleName, 'executor' | 'reviewer' | 'editor_ai'>> = {
  executor: 'executor',
  reviewer: 'reviewer',
  editorAi: 'editor_ai',
}

const SCREAMING = /[^A-Z0-9]+/gu

/** Default reference name for one role, e.g. `PAPER_EXECUTOR_API_KEY`. */
function defaultCredentialRef(role: PaperRoleName): string {
  return `PAPER_${role.replace(/([a-z])([A-Z])/gu, '$1_$2').toUpperCase().replace(SCREAMING, '_')}_API_KEY`
}

/**
 * Infer a provider id from a legacy base URL. The decision is a path-segment
 * lookup rather than a hardcoded host list, so a deployment states its own
 * mapping and an unrecognized URL resolves to the declared default instead of
 * guessing.
 * @param baseUrl - legacy base URL, possibly not a valid URL at all.
 * @param options - the segment table and the default provider id.
 * @returns the provider id to record.
 */
export function inferProvider(baseUrl: string | undefined, options: LegacySettingsOptions): string {
  if (baseUrl === undefined) return options.defaultProvider
  const table = options.providerByPathSegment ?? {}
  // A legacy value may be a bare host or a full URL; scan raw segments so an
  // unparseable value still resolves rather than throwing.
  for (const segment of baseUrl.toLowerCase().split(/[/?#]+/u)) {
    const provider = table[segment]
    if (provider !== undefined) return provider
  }
  return options.defaultProvider
}

/**
 * Translate one legacy settings document into a Paper settings record plus the
 * credential values to store by reference.
 *
 * A role the document omits inherits the executor's route, because the
 * predecessor ran every role on one endpoint; that keeps a migrated
 * installation working instead of failing on a role it never configured.
 * @param raw - legacy document as read from disk, still untrusted.
 * @param options - provider table and the defaults for unstated values.
 * @returns the settings record and the credential placements it references.
 * @throws {LegacyMigrationError} when the document does not parse, states no
 * executor endpoint at all, or names an unknown mode.
 */
export function migrateLegacySettings(raw: unknown, options: LegacySettingsOptions): MigratedSettings {
  const parsed = legacySettingsSchema.safeParse(raw)
  if (!parsed.success) throw new LegacyMigrationError('settings', 'it does not match any known legacy shape')
  const document = parsed.data

  // Fold the oldest flat form into the role-nested form before mapping, so the
  // two legacy generations take one path from here on.
  const flat = {
    ...document.executor_base_url === undefined ? {} : { base_url: document.executor_base_url },
    ...document.executor_api_key === undefined ? {} : { api_key: document.executor_api_key },
    ...document.executor_model_id === undefined ? {} : { model_id: document.executor_model_id },
  }
  const executor = { ...flat, ...document.executor }
  if (Object.keys(executor).length === 0) {
    throw new LegacyMigrationError('settings', 'it states no executor route to migrate')
  }

  const refFor = options.credentialRef ?? defaultCredentialRef
  const credentials: CredentialPlacement[] = []
  const routes = {} as Record<PaperRoleName, ProviderRoute>
  for (const role of PAPER_ROLES) {
    const legacy = role === 'executor' ? executor : document[LEGACY_ROLE_KEYS[role]] ?? executor
    const ref = refFor(role)
    routes[role] = {
      provider: inferProvider(legacy.base_url, options),
      model: legacy.model_id ?? options.defaultModel,
      credentialRef: ref,
      timeoutMs: legacy.timeout_ms ?? options.defaultTimeoutMs ?? DEFAULT_LEGACY_TIMEOUT_MS,
    }
    if (legacy.api_key !== undefined) credentials.push({ ref, value: legacy.api_key, role })
  }

  return {
    settings: { ...routes, defaultMode: migrateRunMode(document.mode) },
    credentials,
  }
}

/**
 * Normalize a legacy mode name.
 * @param mode - legacy mode, or `undefined` for the conservative default.
 * @returns the run mode to record.
 * @throws {LegacyMigrationError} when the name is not a known mode.
 */
export function migrateRunMode(mode: string | undefined): RunMode {
  if (mode === undefined) return 'fast'
  const normalized = mode.trim().toLowerCase()
  if (normalized === 'fast' || normalized === 'quick') return 'fast'
  // P3-5 / D-P3.1: 'formal' is registered here as an explicit strict alias.
  // The RunMode closed set stays {fast, strict, exploratory} (no gate
  // semantics move, 禁8) — 'formal' names the delivery-layer concept and
  // resolves to strict, the mode whose nine-gate delivery IS the formal one.
  if (normalized === 'strict' || normalized === 'full' || normalized === 'formal') return 'strict'
  if (normalized === 'exploratory' || normalized === 'draft') return 'exploratory'
  throw new LegacyMigrationError('run mode', `'${mode}' is not a known mode`)
}

/**
 * Legacy run states, including the ones the predecessor spelled differently.
 * `interrupted` becomes `paused` rather than `failed`: a run stopped mid-flight
 * is resumable, and recording it as failed would discard work the event log
 * still holds.
 */
const RUN_STATUS_MAP: Readonly<Record<string, RunStatus>> = {
  planning: 'planning', plan: 'planning', pending: 'planning', created: 'planning',
  running: 'running', active: 'running', in_progress: 'running',
  paused: 'paused', interrupted: 'paused', suspended: 'paused',
  completed: 'completed', complete: 'completed', success: 'completed', succeeded: 'completed',
  failed: 'failed', error: 'failed',
  cancelled: 'cancelled', canceled: 'cancelled', aborted: 'cancelled',
}

const NODE_STATE_MAP: Readonly<Record<string, NodeState>> = {
  pending: 'pending', created: 'pending', queued: 'pending',
  ready: 'ready',
  running: 'running', active: 'running', in_progress: 'running',
  succeeded: 'succeeded', success: 'succeeded', completed: 'succeeded', complete: 'succeeded',
  failed: 'failed', error: 'failed',
  skipped: 'skipped',
  paused: 'paused', interrupted: 'paused', suspended: 'paused',
}

const NODE_TYPE_MAP: Readonly<Record<string, NodeType>> = {
  plan: 'plan', planning: 'plan',
  execute: 'execute', exec: 'execute', run: 'execute',
  review: 'review', check: 'review',
  revise: 'revise', edit: 'revise', fix: 'revise',
  deliver: 'deliver', delivery: 'deliver', finalize: 'deliver',
}

const NODE_ROLE_MAP: Readonly<Record<string, NodeRecord['role']>> = {
  executor: 'executor', worker: 'executor',
  reviewer: 'reviewer', critic: 'reviewer',
  editor_ai: 'editor_ai', editor: 'editor_ai', editorai: 'editor_ai',
}

function mapped<T>(table: Readonly<Record<string, T>>, subject: string, value: string): T {
  const result = table[value.trim().toLowerCase()]
  if (result === undefined) throw new LegacyMigrationError(subject, `'${value}' has no equivalent`)
  return result
}

/**
 * Normalize a legacy run status.
 * @param status - legacy status name.
 * @returns the run status to record.
 * @throws {LegacyMigrationError} when the name has no equivalent.
 */
export function migrateRunStatus(status: string): RunStatus {
  return mapped(RUN_STATUS_MAP, 'run status', status)
}

/**
 * Normalize a legacy node state.
 * @param state - legacy state name.
 * @returns the node state to record.
 * @throws {LegacyMigrationError} when the name has no equivalent.
 */
export function migrateNodeState(state: string): NodeState {
  return mapped(NODE_STATE_MAP, 'node state', state)
}

/**
 * Normalize a legacy node kind.
 * @param type - legacy node kind name.
 * @returns the node type to record.
 * @throws {LegacyMigrationError} when the name has no equivalent.
 */
export function migrateNodeType(type: string): NodeType {
  return mapped(NODE_TYPE_MAP, 'node type', type)
}

/** Legacy run row. */
export const legacyRunSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  mode: z.string().min(1).optional(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1).optional(),
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
})

/** Legacy node row. */
export const legacyNodeSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  parent_id: z.string().min(1).nullish(),
  type: z.string().min(1),
  title: z.string().min(1).optional(),
  role: z.string().min(1).nullish(),
  state: z.string().min(1),
  attempts: z.number().int().nonnegative().optional(),
  max_attempts: z.number().int().positive().optional(),
  input_artifact_id: z.string().min(1).nullish(),
  output_artifact_id: z.string().min(1).nullish(),
  last_error: z.string().min(1).nullish(),
})

/** Legacy event row. */
export const legacyEventSchema = z.object({
  run_id: z.string().min(1),
  node_id: z.string().min(1).nullish(),
  seq: z.number().int().positive(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().min(1),
})

/** How to translate legacy identifiers and stamp migrated records. */
export interface LegacyRecordOptions {
  /** Maps one legacy id to the branded id the new records use. */
  readonly resolveRunId: (legacyId: string) => RunId
  /** Maps one legacy node id to the branded id the new records use. */
  readonly resolveNodeId: (legacyId: string) => NodeId
  /** Maps one legacy artifact id to the branded id the new records use. */
  readonly resolveArtifactId: (legacyId: string) => ArtifactId
  /** Harness version to stamp on migrated runs. */
  readonly harnessVersion: string
  /** Config hash to stamp on migrated runs. */
  readonly configHash: string
}

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

/**
 * Translate one legacy run row.
 * @param raw - legacy row, still untrusted.
 * @param options - id resolution and the stamps to apply.
 * @returns the run record to persist.
 * @throws {LegacyMigrationError} when the row or any enum has no equivalent.
 */
export function migrateLegacyRun(raw: unknown, options: LegacyRecordOptions): RunRecord {
  const parsed = legacyRunSchema.safeParse(raw)
  if (!parsed.success) throw new LegacyMigrationError('run row', 'it does not match the legacy run shape')
  const row = parsed.data
  return {
    id: options.resolveRunId(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    status: migrateRunStatus(row.status),
    mode: migrateRunMode(row.mode),
    harnessVersion: options.harnessVersion,
    configHash: options.configHash,
    usage: {
      inputTokens: row.input_tokens ?? ZERO_USAGE.inputTokens,
      outputTokens: row.output_tokens ?? ZERO_USAGE.outputTokens,
      // A legacy cost was provider-reported and is not evidence of spend, so
      // it is carried only when present and never synthesized from tokens.
      costUsd: row.cost_usd ?? ZERO_USAGE.costUsd,
    },
    version: 1,
  }
}

/**
 * Translate one legacy node row.
 * @param raw - legacy row, still untrusted.
 * @param options - id resolution and the stamps to apply.
 * @returns the node record to persist.
 * @throws {LegacyMigrationError} when the row or any enum has no equivalent.
 */
export function migrateLegacyNode(raw: unknown, options: LegacyRecordOptions): NodeRecord {
  const parsed = legacyNodeSchema.safeParse(raw)
  if (!parsed.success) throw new LegacyMigrationError('node row', 'it does not match the legacy node shape')
  const row = parsed.data
  const type = migrateNodeType(row.type)
  return {
    id: options.resolveNodeId(row.id),
    runId: options.resolveRunId(row.run_id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : options.resolveNodeId(row.parent_id),
    type,
    title: row.title ?? type,
    role: row.role === null || row.role === undefined ? null : mapped(NODE_ROLE_MAP, 'node role', row.role),
    state: migrateNodeState(row.state),
    attempts: row.attempts ?? 0,
    maxAttempts: row.max_attempts ?? 3,
    // The predecessor recorded no idempotence fact, and assuming a node is
    // safe to re-run would let recovery repeat a side effect it never proved
    // was repeatable.
    idempotent: false,
    inputArtifactId: row.input_artifact_id === null || row.input_artifact_id === undefined
      ? null
      : options.resolveArtifactId(row.input_artifact_id),
    outputArtifactId: row.output_artifact_id === null || row.output_artifact_id === undefined
      ? null
      : options.resolveArtifactId(row.output_artifact_id),
    lastErrorCode: row.last_error ?? null,
    version: 1,
  }
}

/** Legacy event names that carry over, mapped to this package's vocabulary. */
const EVENT_TYPE_MAP: Readonly<Record<string, WorkflowEvent['type']>> = {
  plan_ready: 'plan_ready', plan: 'plan_ready',
  run_state: 'run_state', run_status: 'run_state',
  node_created: 'node_created',
  node_state: 'node_state', node_status: 'node_state',
  request_started: 'request_started', request: 'request_started',
  text_delta: 'text_delta', text: 'text_delta',
  reasoning_delta: 'reasoning_delta', reasoning: 'reasoning_delta',
  tool_call: 'tool_call', tool_result: 'tool_result',
  usage: 'usage', defect: 'defect', gate_result: 'gate_result',
  completed: 'completed', failed: 'failed', paused: 'paused', recovery: 'recovery',
  context_compacted: 'context_compacted', compacted: 'context_compacted',
}

/**
 * Translate one legacy event row. Events are the authority a replay reads, so
 * an unmappable event type fails rather than being dropped: a history with a
 * silent hole cannot be validated as contiguous.
 * @param raw - legacy row, still untrusted.
 * @param options - id resolution for the run and node the event belongs to.
 * @returns the event to append.
 * @throws {LegacyMigrationError} when the row or its type has no equivalent.
 */
export function migrateLegacyEvent(raw: unknown, options: LegacyRecordOptions): WorkflowEvent {
  const parsed = legacyEventSchema.safeParse(raw)
  if (!parsed.success) throw new LegacyMigrationError('event row', 'it does not match the legacy event shape')
  const row = parsed.data
  return {
    runId: options.resolveRunId(row.run_id),
    nodeId: row.node_id === null || row.node_id === undefined ? null : options.resolveNodeId(row.node_id),
    seq: row.seq,
    type: mapped(EVENT_TYPE_MAP, 'event type', row.type),
    data: row.payload ?? {},
    timestamp: row.created_at,
  }
}
