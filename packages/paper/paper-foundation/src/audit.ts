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
  // TASK 5.0.5: the promoter is the only component that mints a
  // DeliverableArtifact (INV-014) and it reports both outcomes on the
  // audit trail. The two names are part of the promoter's own contract
  // (`promoteCandidateToDeliverable`); they are declared here so the
  // executor can forward them verbatim instead of relabelling a
  // promotion event as some unrelated kind.
  'promotion_succeeded',
  'promotion_failed',
  // TASK 5.0.5: written once per successful promotion by the single
  // final-output sink the promoter calls (INV-014).
  'final_output_written',
  // W8.12 (E1 direct delivery): the container path failed after every retry,
  // the run fell back to delivering the E1 analysis under fail-soft, and the
  // fidelity findings moved into the MARKED appendix. Carries the verbatim
  // gate reason so the delivered paper quotes the store, not a paraphrase.
  'e1_direct_delivery',  // P1-1: one entry written to canonical IR by the structured-output
  // producer (kind + id), so the trail reconstructs the run's IR evolution.
  'ir_entry_written',
  // TASK-PW W4: an ESCAPE-class EXECUTE output was hard-refused with zero
  // retry budget (W-B); and a NONE/DRIFT guided budget was exhausted and
  // the run's protocol tier was stepped down (T1 → T2 → T3).
  'escape_refused',
  'tier_degraded',
  // W8.6-A1: the provider's output-length ceiling cut an EXECUTE output
  // mid-generation (finish_reason=length). Its own event so the trail
  // distinguishes "transport truncated" from "model refused" — the
  // 假红 fix: a length ceiling must never be recorded as a violation.
  'truncated',
  // W8.6-D1: the IR producer refused a model container. Carries a bounded
  // head/tail excerpt + hash + reason so the refusal is diagnosable
  // (W8.5 exec#2's offending field path was unknowable forever because
  // nothing was kept). Repo principle: 模型可见 ⟺ 已记录.
  'container_refused',
  // TASK-M1 M1-2: the product shell deliberately enabled the form-production
  // path (produceFromExecute). Each explicit enable is one audit entry so
  // every FORMAL-eligible delivery carries the evidence that production was
  // enabled (F5 closure — the shell opts in, never the library default).
  'production_enabled',
  // P0-3 (PRD v2 §3.3): every run's delivery grade (CLEAN / MARKED /
  // BLOCKED) lands on the audit trail — a MARKED delivery must never be
  // indistinguishable from a CLEAN one in the evidence (no silent
  // downgrade, §7 诚实标注).
  'delivery_graded',
  // 上限解放架构 L6：门禁状态机的每一次转移（DORMANT → WARN → ENFORCE）。
  // 它必须可审计，因为"这次运行被收紧到什么程度"是解释交付结果的必要证据——
  // 一份被反复 WARN 的稿子与一份一次通过的稿子，可信度不是一回事。
  'gate_state_changed',
  // 上限解放架构 L6：闭环收口。携带每条 finding 的终态与复验记录。
  // **未消解必须可见**：一条留在 open 的 finding 会让终局变成 ESCALATE，
  // 而 ESCALATE 与 MARKED 的区别正是"有没有归宿"。
  'closure_closed',
  // 上限解放架构 L1：技能库落盘（外置知识的"可读性"前提——索引里写着一个
  // 读不到的路径等于没写）。记录文件数与目录，便于核验。
  'skill_library_materialized',
  // 上限解放架构 L2：探索—择优完成（或 fail-soft 失败）。它必须可审计，因为
  // "这次运行的方案是比出来的还是第一个想到的"是解释论文质量的关键证据。
  'explore_select_completed',
  // 上限解放架构 L3：符号证据通道跑完（harness 侧驱动的形式一致性检查）。
  // 记录通过数与失败 claim id，因此"这次交付的解析结论被独立检查过吗"可回答。
  'symbolic_channel_run',
  // 上限解放架构 L4：交付模型的**结构指纹**（方程+假设+方法+参数+符号表）。
  // 它让"模型结构在两次尝试之间变了没有"可回答——换方法/增删方程/调假设这三类
  // 语义修复，数值指纹完全无感，只有结构指纹看得见。
  'structure_fingerprint',
  // W12-C1：分阶段切片落盘（热重启的检查点）。
  'stage_checkpoint',
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
