import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  ArtifactId, LegacyMigrationRunner, PaperAuditService, PaperFoundationService,
  PaperMigrationService, NodeId, RunId, resolveMigrationConfig,
  type LegacyRunBundle,
} from '../src/index.ts'

const RESOLVERS = {
  resolveRunId: (legacy: string) => RunId(`00000000-0000-4000-8000-${legacy.padStart(12, '0')}`),
  resolveNodeId: (legacy: string) => NodeId(`00000000-0000-4000-8001-${legacy.padStart(12, '0')}`),
  resolveArtifactId: (legacy: string) => ArtifactId(`00000000-0000-4000-8002-${legacy.padStart(12, '0')}`),
}

function bundle(legacyId: string, events = 2): LegacyRunBundle {
  return {
    legacyId,
    run: { id: legacyId, status: 'completed', mode: 'fast', created_at: '2026-08-01T00:00:00.000Z' },
    nodes: [{ id: `${legacyId}1`, run_id: legacyId, type: 'plan', state: 'succeeded' }],
    events: Array.from({ length: events }, (_value, index) => ({
      run_id: legacyId, seq: index + 1, type: 'run_state', created_at: '2026-08-01T00:00:00.000Z',
    })),
  }
}

interface HarnessOptions {
  readonly pool?: MemoryMediaPool
  readonly audit?: boolean
}

async function harness(options: HarnessOptions = {}) {
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  if (options.audit !== false) await ctx.plugin(PaperAuditService, {})
  const fiber = await ctx.plugin(PaperMigrationService, { harnessVersion: '0.1.1-rc.2' })
  return { ctx, fiber, pool, service: ctx.paperMigration }
}

describe('LegacyMigrationRunner dry run', () => {
  it('previews without writing anything', async () => {
    const { ctx, fiber, service } = await harness()
    const report = service.runner(RESOLVERS).plan([bundle('1'), bundle('2')])

    expect(report).toMatchObject({ committed: false, migrated: 2, skipped: 0, refused: 0 })
    expect(report.runs.map(run => run.legacyId)).toEqual(['1', '2'])
    expect(ctx.paperFoundation.runs.listRuns()).toEqual([])
    expect(service.marks()).toEqual([])
    // A preview is not a pass, so it leaves the recorded state alone.
    expect(service.state).toEqual({ lastCompletedAt: null, passes: 0 })
    await fiber.dispose()
  })

  it('reports the same refusal a commit would make', async () => {
    const { fiber, service } = await harness()
    const broken = { ...bundle('1'), run: { id: '1', status: 'zombie', created_at: '2026-08-01T00:00:00.000Z' } }
    const runner = service.runner(RESOLVERS)

    const planned = runner.plan([broken])
    expect(planned).toMatchObject({ refused: 1, migrated: 0 })
    expect(planned.runs[0]?.reason).toContain("'zombie' has no equivalent")

    const applied = await runner.apply([broken])
    expect(applied.runs[0]).toMatchObject({ state: 'refused', reason: planned.runs[0]?.reason })
    await fiber.dispose()
  })
})

describe('LegacyMigrationRunner commit', () => {
  it('writes records, marks the legacy id, and audits the pass', async () => {
    const { ctx, fiber, service } = await harness()
    const report = await service.runner(RESOLVERS).apply([bundle('1')])

    expect(report).toMatchObject({ committed: true, migrated: 1 })
    expect(report.runs[0]).toMatchObject({ legacyId: '1', state: 'migrated', nodes: 1, events: 2 })

    const runs = ctx.paperFoundation.runs.listRuns()
    expect(runs).toHaveLength(1)
    const runId = runs[0]?.id
    expect(runs[0]).toMatchObject({
      status: 'completed', harnessVersion: '0.1.1-rc.2', configHash: 'legacy-migration',
    })
    expect(ctx.paperFoundation.runs.listNodes(runId as never)).toHaveLength(1)
    expect(ctx.paperFoundation.runs.listEvents(runId as never)).toHaveLength(2)

    expect(service.marks()).toMatchObject([{ legacyId: '1', nodes: 1, events: 2 }])
    expect(ctx.paperAudit.list().map(entry => entry.eventType))
      .toEqual(['migration_started', 'migration_record', 'migration_completed'])
    await fiber.dispose()
  })

  it('skips a legacy id a previous pass already completed', async () => {
    const { ctx, fiber, service } = await harness()
    const runner = service.runner(RESOLVERS)
    await runner.apply([bundle('1')])

    const again = await runner.apply([bundle('1'), bundle('2')])
    expect(again).toMatchObject({ migrated: 1, skipped: 1 })
    expect(again.runs.map(run => run.state)).toEqual(['skipped', 'migrated'])
    expect(service.marks()).toHaveLength(2)
    expect(ctx.paperAudit.list().some(entry => entry.eventType === 'migration_skipped')).toBe(true)
    // A completed bundle is not re-planned either.
    expect(runner.plan([bundle('1')]).skipped).toBe(1)
    await fiber.dispose()
  })

  it('retries an unmarked bundle without duplicating the events it already wrote', async () => {
    const { ctx, fiber, service } = await harness()
    const target = bundle('1')
    await service.runner(RESOLVERS).apply([target])
    const runId = ctx.paperFoundation.runs.listRuns()[0]?.id

    // An interruption between the records and the mark leaves the bundle
    // unmarked; the next pass must retry over rows that already exist.
    await ctx.storageDomain.get('paper_migration')?.table('marks').delete('1')
    const retry = await service.runner(RESOLVERS).apply([target])

    expect(retry).toMatchObject({ migrated: 1 })
    expect(ctx.paperFoundation.runs.listRuns()).toHaveLength(1)
    expect(ctx.paperFoundation.runs.listEvents(runId as never)).toHaveLength(2)
    await fiber.dispose()
  })

  it('refuses a run whose migrated event log has a gap', async () => {
    const { ctx, fiber, service } = await harness()
    const gapped: LegacyRunBundle = {
      ...bundle('1'),
      events: [
        { run_id: '1', seq: 1, type: 'run_state', created_at: '2026-08-01T00:00:00.000Z' },
        { run_id: '1', seq: 3, type: 'run_state', created_at: '2026-08-01T00:00:00.000Z' },
      ],
    }
    const report = await service.runner(RESOLVERS).apply([gapped])
    expect(report.runs[0]).toMatchObject({ state: 'refused' })
    expect(report.runs[0]?.reason).toContain('does not continue the log')
    // Nothing partial survives a refusal.
    expect(ctx.paperFoundation.runs.listRuns()).toEqual([])
    expect(service.marks()).toEqual([])
    await fiber.dispose()
  })

  it('accepts an out-of-order but complete event log', async () => {
    const { fiber, service } = await harness()
    const shuffled: LegacyRunBundle = {
      ...bundle('1'),
      events: [
        { run_id: '1', seq: 2, type: 'run_state', created_at: '2026-08-01T00:00:00.000Z' },
        { run_id: '1', seq: 1, type: 'run_state', created_at: '2026-08-01T00:00:00.000Z' },
      ],
    }
    expect(await service.runner(RESOLVERS).apply([shuffled])).toMatchObject({ migrated: 1 })
    await fiber.dispose()
  })

  it('works without an audit trail in the composition', async () => {
    const { fiber, service } = await harness({ audit: false })
    expect(await service.runner(RESOLVERS).apply([bundle('1')])).toMatchObject({ migrated: 1 })
    await fiber.dispose()
  })

  it('lets a non-migration failure out rather than reporting it as a refusal', async () => {
    const { ctx, fiber } = await harness()
    const runner = new LegacyMigrationRunner(
      ctx.paperFoundation.runs,
      ctx.storageDomain.get('paper_migration')?.table('marks') as never,
      {
        ...RESOLVERS,
        // A resolver bug is a caller defect, not an unmappable legacy record.
        resolveRunId: () => { throw new TypeError('id resolver exploded') },
        harnessVersion: 'v',
        configHash: 'c',
      },
    )
    expect(() => runner.plan([bundle('1')])).toThrow('id resolver exploded')
    await fiber.dispose()
  })
})

describe('PaperMigrationService state', () => {
  it('counts only committed passes and survives a restart', async () => {
    const first = await harness()
    const runner = first.service.runner(RESOLVERS)
    await first.service.notePass(runner.plan([bundle('1')]))
    expect(first.service.state).toEqual({ lastCompletedAt: null, passes: 0 })

    const noted = await first.service.notePass(await runner.apply([bundle('1')]))
    expect(noted.passes).toBe(1)
    expect(noted.lastCompletedAt).not.toBeNull()
    await first.fiber.dispose()

    const second = await harness({ pool: first.pool })
    expect(second.service.state.passes).toBe(1)
    expect(second.service.marks()).toHaveLength(1)
    await second.fiber.dispose()
  })

  it('stamps an unnamed harness version rather than an empty one', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory' })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(PaperFoundationService)
    const fiber = await ctx.plugin(PaperMigrationService)

    await ctx.paperMigration.runner(RESOLVERS).apply([bundle('1')])
    expect(ctx.paperFoundation.runs.listRuns()[0]).toMatchObject({
      harnessVersion: 'unknown', configHash: 'legacy-migration',
    })
    await fiber.dispose()
  })

  it('refuses every operation once its domain is closed', async () => {
    const { fiber, service } = await harness()
    await fiber.dispose()
    expect(() => service.marks()).toThrow('not initialized')
    expect(() => service.state).toThrow('not initialized')
    expect(() => service.runner(RESOLVERS)).toThrow('not initialized')
  })
})

describe('resolveMigrationConfig', () => {
  it('resolves both absent and explicitly empty harness versions', () => {
    expect(resolveMigrationConfig({})).toEqual({
      harnessVersion: 'unknown', configHash: 'legacy-migration',
    })
    expect(resolveMigrationConfig({ harnessVersion: '', configHash: 'named' })).toEqual({
      harnessVersion: 'unknown', configHash: 'named',
    })
  })

  it('keeps both caller-supplied stamps', () => {
    expect(resolveMigrationConfig({ harnessVersion: '1.2.3', configHash: 'hash' })).toEqual({
      harnessVersion: '1.2.3', configHash: 'hash',
    })
  })
})
