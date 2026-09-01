/**
 * Durable, redacted audit trail. The trail lives in its own storage domain,
 * separate from workflow records, so it can be retained, exported, or pruned
 * on its own schedule without touching business state.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/audit
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
import { redactSensitiveDetail } from './redact.ts'

/** Closed vocabulary of audited operations. */
export const AUDIT_EVENT_TYPES = [
  'settings_changed',
  'skill_installed',
  'skill_rollback',
  'workflow_started',
  'workflow_completed',
  'workflow_failed',
  'gate_failed',
  'budget_exceeded',
  'provider_retry',
  'provider_blocked',
  'recovery',
  'auth_failure',
  'release_staged',
  'release_activated',
  'release_rollback',
  'migration_started',
  'migration_record',
  'migration_skipped',
  'migration_completed',
  'migration_failed',
  'preflight_blocked',
  'capability_check',
  'ir_bridge_blocked',
  'provenance_gate_blocked',
] as const

/** One audited operation kind. */
export type AuditEventType = typeof AUDIT_EVENT_TYPES[number]

/**
 * Durable schema of one audit entry. `seq` orders the trail rather than `ts`
 * alone: two operations can land in the same millisecond, and a trail that
 * cannot state which came first is not evidence.
 */
export const auditRecordSchema = zod.object({
  id: zod.uuid(),
  seq: zod.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ts: zod.iso.datetime({ offset: true }),
  runId: zod.string().min(1).nullable(),
  actor: zod.string().min(1),
  eventType: zod.enum(AUDIT_EVENT_TYPES),
  detail: zod.record(zod.string(), zod.unknown()),
})

/** One persisted audit entry. */
export type AuditRecord = zod.infer<typeof auditRecordSchema>

/** Caller-supplied fields of one audit entry; identity, order, and time are assigned here. */
export interface AuditEntryInput {
  /** Audited operation kind. */
  readonly eventType: AuditEventType
  /** Who or what performed the operation. */
  readonly actor: string
  /** Run the operation belongs to, when it belongs to one. */
  readonly runId?: string | null
  /** Open detail map; redacted before it becomes durable. */
  readonly detail?: Readonly<Record<string, unknown>>
}

/** Audit storage declaration, deliberately separate from the workflow domain. */
export const auditDomainSpec = defineDomain({
  name: 'paper_audit',
  version: 0,
  tables: {
    entries: domainTable<string, AuditRecord>(auditRecordSchema),
  },
})

/** Days an entry is kept when a composition names no retention. */
export const DEFAULT_AUDIT_RETENTION_DAYS = 90

/** Retention policy for the trail. */
export interface AuditConfig {
  /** Days an entry is kept; older entries are pruned on the next write. */
  readonly retentionDays?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperAudit: PaperAuditService
  }
}

const MS_PER_DAY = 86_400_000
const KEY_WIDTH = 16

/** Durable audit trail over its own storage domain. */
export class PaperAuditService extends Service {
  static inject = ['storageDomain']

  static Config: s<AuditConfig> = s.object({
    retentionDays: s.number().step(1).min(1).default(DEFAULT_AUDIT_RETENTION_DAYS),
  })

  private readonly retentionDays: number
  private table: KvTable<string, AuditRecord> | undefined
  private nextSeq = 1

  /**
   * @param ctx - Context carrying the storage-domain facility.
   * @param config - Retention policy.
   */
  constructor(ctx: Context, config: AuditConfig = {}) {
    super(ctx, 'paperAudit')
    this.retentionDays = config.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS
  }

  /** Open the audit domain, resume its sequence, and close it with the service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(auditDomainSpec)
    const table = domain.table('entries')
    this.table = table
    // Resume after the highest persisted entry so a restart cannot reuse an
    // order position and interleave silently with the existing trail.
    this.nextSeq = [...table.entries()]
      .reduce((highest, [, record]) => Math.max(highest, record.seq), 0) + 1
    this.ctx.effect(() => async () => {
      this.table = undefined
      await domain.close()
    }, 'paper-audit.close')
  }

  /**
   * Append one entry, redacting its detail first, then prune expired entries.
   * @param entry - the operation to record.
   * @returns the persisted entry.
   */
  async record(entry: AuditEntryInput): Promise<AuditRecord> {
    const table = this.requireTable()
    const timestamp = new Date()
    const record: AuditRecord = {
      id: randomUUID(),
      seq: this.nextSeq,
      ts: timestamp.toISOString(),
      runId: entry.runId ?? null,
      actor: entry.actor,
      eventType: entry.eventType,
      detail: redactSensitiveDetail(entry.detail ?? {}),
    }
    this.nextSeq += 1
    await table.put(keyOf(record), record)
    await this.prune(timestamp.getTime())
    return record
  }

  /**
   * Read the trail in append order.
   * @param runId - when given, only entries belonging to that run.
   * @returns the matching entries, oldest first.
   */
  list(runId?: string): AuditRecord[] {
    const entries = [...this.requireTable().entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, record]) => record)
    return runId === undefined ? entries : entries.filter(record => record.runId === runId)
  }

  /** Drop entries older than the retention window. */
  private async prune(nowMs: number): Promise<void> {
    const table = this.requireTable()
    const cutoff = nowMs - this.retentionDays * MS_PER_DAY
    for (const [key, record] of [...table.entries()]) {
      if (Date.parse(record.ts) < cutoff) await table.delete(key)
    }
  }

  private requireTable(): KvTable<string, AuditRecord> {
    if (this.table === undefined) throw new Error('paper audit trail is not initialized')
    return this.table
  }
}

/** Append-order key so a snapshot sorts without re-parsing timestamps. */
function keyOf(record: AuditRecord): string {
  return String(record.seq).padStart(KEY_WIDTH, '0')
}

export default PaperAuditService
