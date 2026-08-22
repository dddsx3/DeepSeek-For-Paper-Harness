/**
 * Legacy migration: a resumable, auditable, non-destructive pass that moves a
 * predecessor installation's runs, nodes, events, and settings into this
 * package's domains.
 *
 * Three properties shape the design.
 *
 * It never deletes. The legacy source stays exactly as it was found; progress
 * is recorded on this side as a completion mark per legacy id. An operator who
 * dislikes the result rolls back by pointing the installation at the old data
 * again, and cleaning up the source is a separate decision made after the new
 * records have been reviewed.
 *
 * It is resumable rather than transactional. A migration spans many durable
 * writes and can be interrupted between any two of them; instead of pretending
 * otherwise, each legacy id is marked complete only after its records land, so
 * a re-run skips what finished and retries the rest. Interruption therefore
 * costs the remainder, never the whole pass.
 *
 * It previews with the same code that commits. {@link LegacyMigrationRunner.plan}
 * runs every translation and reports what would be written without writing, so
 * a preview cannot disagree with the outcome — the only difference is whether
 * the writes happen.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/migration
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
import type { AuditSink } from './executor.ts'
import {
  LegacyMigrationError,
  migrateLegacyEvent, migrateLegacyNode, migrateLegacyRun,
  type LegacyRecordOptions,
} from './legacy.ts'
import type { NodeRecord, RunRecord, WorkflowEvent } from './spec.ts'
import type { WorkflowRunRepository } from './store.ts'

/** One legacy run and the rows that belong to it. */
export interface LegacyRunBundle {
  /** Legacy run id, used as the completion-mark key. */
  readonly legacyId: string
  /** The legacy run row. */
  readonly run: unknown
  /** The legacy node rows for this run. */
  readonly nodes: readonly unknown[]
  /** The legacy event rows for this run, in sequence order. */
  readonly events: readonly unknown[]
}

/** What one legacy run's migration produced, or why it was refused. */
export interface MigratedRunOutcome {
  /** Legacy run id. */
  readonly legacyId: string
  /** Whether the bundle translated, was already done, or was refused. */
  readonly state: 'migrated' | 'skipped' | 'refused'
  /** Node rows translated; zero for a skip or refusal. */
  readonly nodes: number
  /** Event rows translated; zero for a skip or refusal. */
  readonly events: number
  /** Present only for a refusal, safe to show in diagnostics. */
  readonly reason?: string
}

/** Summary of one migration pass. */
export interface MigrationReport {
  /** Whether this pass wrote anything. */
  readonly committed: boolean
  /** Per-bundle outcomes, in input order. */
  readonly runs: readonly MigratedRunOutcome[]
  /** Bundles translated in this pass. */
  readonly migrated: number
  /** Bundles already complete before this pass. */
  readonly skipped: number
  /** Bundles refused because something in them had no equivalent. */
  readonly refused: number
}

/** Completion mark for one legacy run. */
export const migrationMarkSchema = zod.object({
  legacyId: zod.string().min(1),
  runId: zod.string().min(1),
  migratedAt: zod.iso.datetime({ offset: true }),
  nodes: zod.number().int().nonnegative(),
  events: zod.number().int().nonnegative(),
})

/** Completion mark for one legacy run. */
export type MigrationMark = zod.infer<typeof migrationMarkSchema>

/** Whether a migration has been attempted at all, and when it last finished. */
export const migrationStateSchema = zod.object({
  lastCompletedAt: zod.iso.datetime({ offset: true }).nullable(),
  passes: zod.number().int().nonnegative(),
})

/** Durable migration progress. */
export type MigrationState = zod.infer<typeof migrationStateSchema>

/** Migration storage declaration, separate from the records being migrated. */
export const migrationDomainSpec = defineDomain({
  name: 'paper_migration',
  version: 0,
  global: {
    schema: migrationStateSchema,
    initial: { lastCompletedAt: null, passes: 0 },
  },
  tables: {
    marks: domainTable<string, MigrationMark>(migrationMarkSchema),
  },
})

const now = (): string => new Date().toISOString()

/**
 * Translate and persist legacy run bundles. Construct one per pass; the runner
 * holds no state of its own beyond the collaborators it was given.
 */
export class LegacyMigrationRunner {
  /**
   * @param repository - durable destination for migrated records.
   * @param marks - completion marks that make a re-run resumable.
   * @param options - id resolution and the stamps to apply.
   * @param audit - audit sink, when the composition mounts one.
   */
  constructor(
    private readonly repository: WorkflowRunRepository,
    private readonly marks: KvTable<string, MigrationMark>,
    private readonly options: LegacyRecordOptions,
    private readonly audit?: AuditSink,
  ) {}

  /**
   * Translate every bundle and report what a commit would write, without
   * writing. A refusal here is the same refusal {@link apply} would make.
   * @param bundles - legacy bundles to preview.
   * @returns the report for an uncommitted pass.
   */
  plan(bundles: readonly LegacyRunBundle[]): MigrationReport {
    return report(false, bundles.map(bundle => this.translate(bundle).outcome))
  }

  /**
   * Translate and persist every bundle that is not already complete.
   *
   * A bundle is written records-first and marked last, so an interruption
   * leaves it unmarked and the next pass retries it. Retrying is safe because
   * every write is keyed by the record's own id: the second attempt overwrites
   * the first attempt's rows rather than duplicating them.
   * @param bundles - legacy bundles to migrate.
   * @returns the report for the committed pass.
   */
  async apply(bundles: readonly LegacyRunBundle[]): Promise<MigrationReport> {
    await this.record('migration_started', { bundles: bundles.length })
    const outcomes: MigratedRunOutcome[] = []
    for (const bundle of bundles) {
      outcomes.push(await this.applyOne(bundle))
    }
    const result = report(true, outcomes)
    await this.record('migration_completed', {
      migrated: result.migrated, skipped: result.skipped, refused: result.refused,
    })
    return result
  }

  private async applyOne(bundle: LegacyRunBundle): Promise<MigratedRunOutcome> {
    if (this.marks.get(bundle.legacyId) !== undefined) {
      const done: MigratedRunOutcome = { legacyId: bundle.legacyId, state: 'skipped', nodes: 0, events: 0 }
      await this.record('migration_skipped', { legacyId: bundle.legacyId, reason: 'already migrated' })
      return done
    }
    const { outcome, records } = this.translate(bundle)
    if (records === undefined) {
      await this.record('migration_failed', { legacyId: bundle.legacyId, reason: outcome.reason })
      return outcome
    }

    await this.repository.putRun(records.run)
    for (const node of records.nodes) await this.repository.putNode(node)
    for (const event of records.events) await this.appendOnce(event)
    await this.marks.put(bundle.legacyId, {
      legacyId: bundle.legacyId,
      runId: records.run.id,
      migratedAt: now(),
      nodes: records.nodes.length,
      events: records.events.length,
    })
    await this.record('migration_record', {
      legacyId: bundle.legacyId, runId: records.run.id,
      nodes: records.nodes.length, events: records.events.length,
    })
    return outcome
  }

  /**
   * Append one migrated event, tolerating an event a previous interrupted pass
   * already wrote. The repository refuses a duplicate sequence to protect a
   * live run's log; during a retry that refusal means "already there", which is
   * the state this pass wants.
   */
  private async appendOnce(event: WorkflowEvent): Promise<void> {
    const existing = this.repository.listEvents(event.runId, event.seq - 1)
    if (existing.some(candidate => candidate.seq === event.seq)) return
    await this.repository.appendEvent(event)
  }

  /** Translate one bundle, turning any refusal into a reported outcome. */
  private translate(bundle: LegacyRunBundle): {
    outcome: MigratedRunOutcome
    records?: { run: RunRecord; nodes: NodeRecord[]; events: WorkflowEvent[] }
  } {
    if (this.marks.get(bundle.legacyId) !== undefined) {
      return { outcome: { legacyId: bundle.legacyId, state: 'skipped', nodes: 0, events: 0 } }
    }
    try {
      const run = migrateLegacyRun(bundle.run, this.options)
      const nodes = bundle.nodes.map(node => migrateLegacyNode(node, this.options))
      const events = bundle.events.map(event => migrateLegacyEvent(event, this.options))
      assertContiguous(bundle.legacyId, events)
      return {
        outcome: {
          legacyId: bundle.legacyId, state: 'migrated', nodes: nodes.length, events: events.length,
        },
        records: { run, nodes, events },
      }
    } catch (error) {
      if (!(error instanceof LegacyMigrationError)) throw error
      return {
        outcome: {
          legacyId: bundle.legacyId, state: 'refused', nodes: 0, events: 0, reason: error.message,
        },
      }
    }
  }

  private async record(
    eventType: 'migration_started' | 'migration_record' | 'migration_skipped'
      | 'migration_completed' | 'migration_failed',
    detail: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.audit?.record({ eventType, actor: 'paper-migration', detail })
  }
}

/**
 * Refuse a run whose migrated event log has a gap. Replay validates contiguity
 * before it will recover a run, so importing a log with a hole would produce
 * records that look migrated but can never be replayed — a failure discovered
 * later, at recovery, instead of now.
 */
function assertContiguous(legacyId: string, events: readonly WorkflowEvent[]): void {
  const seen = [...events].sort((left, right) => left.seq - right.seq)
  seen.forEach((event, index) => {
    if (event.seq !== index + 1) {
      throw new LegacyMigrationError(
        `run '${legacyId}' event log`,
        `sequence ${event.seq} does not continue the log at position ${index + 1}`,
      )
    }
  })
}

function report(committed: boolean, runs: readonly MigratedRunOutcome[]): MigrationReport {
  return {
    committed,
    runs,
    migrated: runs.filter(run => run.state === 'migrated').length,
    skipped: runs.filter(run => run.state === 'skipped').length,
    refused: runs.filter(run => run.state === 'refused').length,
  }
}

/** Stamps a migrated record carries when the composition names none. */
export const DEFAULT_MIGRATION_CONFIG_HASH = 'legacy-migration'

/** Deployment migration policy. */
export interface MigrationConfig {
  /** Harness version stamped on migrated runs. */
  readonly harnessVersion?: string
  /** Config hash stamped on migrated runs. */
  readonly configHash?: string
}

/** Resolved stamps applied to every record in one migration pass. */
export interface ResolvedMigrationConfig {
  /** Non-empty harness version, or `unknown` when the caller cannot name one. */
  readonly harnessVersion: string
  /** Non-empty hash identifying the configuration used for the pass. */
  readonly configHash: string
}

/**
 * Resolve the stamps a partial migration configuration applies. This is shared
 * by loader-built and hand-built compositions so defaults have one owner.
 * @param config - possibly partial deployment configuration.
 * @returns non-empty record stamps.
 */
export function resolveMigrationConfig(config: MigrationConfig): ResolvedMigrationConfig {
  return {
    harnessVersion: config.harnessVersion === undefined || config.harnessVersion === ''
      ? 'unknown'
      : config.harnessVersion,
    configHash: config.configHash ?? DEFAULT_MIGRATION_CONFIG_HASH,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperMigration: PaperMigrationService
  }
}

/** Lifecycle owner of the migration domain and its runner factory. */
export class PaperMigrationService extends Service {
  static inject = ['storageDomain', 'paperFoundation']

  static Config: s<MigrationConfig> = s.object({
    harnessVersion: s.string().default(''),
    configHash: s.string().default(DEFAULT_MIGRATION_CONFIG_HASH),
  })

  private table: KvTable<string, MigrationMark> | undefined
  private global: DomainGlobal<MigrationState> | undefined

  /**
   * @param ctx - Context carrying the storage-domain facility and the run repository.
   * @param config - Stamps applied to migrated records.
   */
  constructor(ctx: Context, private readonly config: MigrationConfig = {}) {
    super(ctx, 'paperMigration')
  }

  /** Open the migration domain and close it with the service lifecycle. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(migrationDomainSpec)
    this.table = domain.table('marks')
    this.global = domain.global
    this.ctx.effect(() => async () => {
      this.table = undefined
      this.global = undefined
      await domain.close()
    }, 'paper-migration.close')
  }

  /**
   * Build a runner over this installation's durable records.
   * @param resolvers - id translation for the legacy ids being imported.
   * @returns a runner for one migration pass.
   */
  runner(resolvers: Pick<LegacyRecordOptions, 'resolveRunId' | 'resolveNodeId' | 'resolveArtifactId'>): LegacyMigrationRunner {
    return new LegacyMigrationRunner(
      this.ctx.paperFoundation.runs,
      this.requireTable(),
      { ...resolvers, ...resolveMigrationConfig(this.config) },
      this.ctx.get('paperAudit'),
    )
  }

  /**
   * Every completion mark recorded so far, oldest first.
   * @returns a snapshot of the migration marks.
   */
  marks(): MigrationMark[] {
    return [...this.requireTable().entries()]
      .map(([, mark]) => mark)
      .sort((left, right) => left.migratedAt.localeCompare(right.migratedAt))
  }

  /**
   * Note that a pass finished, so an operator can tell a fresh installation
   * from one that has already imported its predecessor's data.
   * @param report - the committed pass to record.
   * @returns the durable state after recording.
   */
  async notePass(report: MigrationReport): Promise<MigrationState> {
    const global = this.requireGlobal()
    const state: MigrationState = {
      lastCompletedAt: report.committed ? now() : global.get().lastCompletedAt,
      passes: global.get().passes + (report.committed ? 1 : 0),
    }
    await global.set(state)
    return state
  }

  /**
   * Resolve durable migration progress.
   * @returns the recorded pass count and last completion.
   */
  get state(): MigrationState {
    return this.requireGlobal().get()
  }

  private requireTable(): KvTable<string, MigrationMark> {
    if (this.table === undefined) throw new Error('paper migration service is not initialized')
    return this.table
  }

  private requireGlobal(): DomainGlobal<MigrationState> {
    if (this.global === undefined) throw new Error('paper migration service is not initialized')
    return this.global
  }
}

export default PaperMigrationService
