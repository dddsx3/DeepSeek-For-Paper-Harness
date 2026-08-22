/**
 * Durable release state: which version is staged, which is active, and which
 * has reported itself healthy. A version that was activated but never reported
 * healthy is rolled back on the next start, so a bad release cannot strand an
 * installation on itself.
 *
 * @module @deepseek-ai/dsh-harness-foundation/src/release-service
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
import type { AuditSink } from './executor.ts'
import {
  isInRollout,
  releaseArtifactSchema,
  verifyReleaseManifest,
  type ReleasePolicy,
} from './release.ts'
import type { SkillTrustRoots } from './signed-skill.ts'

/** One staged release as it is recorded on disk. */
export const releaseRecordSchema = zod.object({
  version: zod.string().min(1),
  stagedAt: zod.iso.datetime({ offset: true }),
  activatedAt: zod.iso.datetime({ offset: true }).nullable(),
  healthyAt: zod.iso.datetime({ offset: true }).nullable(),
  signatureOk: zod.boolean(),
  artifacts: zod.array(releaseArtifactSchema),
})

/** One staged release. */
export type ReleaseRecord = zod.infer<typeof releaseRecordSchema>

/** Which version is active, which it replaced, and this install's identity. */
export const releaseStateSchema = zod.object({
  installId: zod.uuid(),
  activeVersion: zod.string().min(1).nullable(),
  previousVersion: zod.string().min(1).nullable(),
})

/** Durable release state. */
export type ReleaseState = zod.infer<typeof releaseStateSchema>

/** Release storage declaration, separate from workflow and audit records. */
export const releaseDomainSpec = defineDomain({
  name: 'harness_releases',
  version: 0,
  global: {
    schema: releaseStateSchema,
    initial: { installId: '00000000-0000-4000-8000-000000000000', activeVersion: null, previousVersion: null },
  },
  tables: {
    staged: domainTable<string, ReleaseRecord>(releaseRecordSchema),
  },
})

/** Deployment release policy. */
export interface ReleaseConfig {
  /** Signing keys this deployment trusts, by key id. */
  readonly trustRoots?: SkillTrustRoots
  /** Harness version this deployment runs. */
  readonly harnessVersion?: string
  /** Development-only: accept an unsigned manifest. */
  readonly allowUnsigned?: boolean
}

/** Harness version assumed when a composition names none. */
export const DEFAULT_RELEASE_HARNESS_VERSION = '0.1.1-rc.2'

/**
 * Resolve one deployment's release policy. The loader applies the schema
 * defaults before construction; this is the same resolution for a hand-built
 * composition, and the single place either path defaults. An empty trust-root
 * map is the deliberate default: with no trusted key, every signed release is
 * refused, so updates are off until a deployment names a key.
 * @param config - the composition's declared policy, possibly partial.
 * @returns the trust roots, harness floor, and unsigned policy to judge against.
 */
export function resolveReleasePolicy(config: ReleaseConfig): ReleasePolicy {
  return {
    trustRoots: config.trustRoots ?? {},
    minHarnessVersion: config.harnessVersion ?? DEFAULT_RELEASE_HARNESS_VERSION,
    ...config.allowUnsigned === undefined ? {} : { allowUnsigned: config.allowUnsigned },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    harnessRelease: HarnessReleaseService
  }
}

/** Outcome of one startup reconciliation. */
export interface ReleaseStartupResult {
  /** Version active after reconciliation, or `null` when none ever activated. */
  readonly activeVersion: string | null
  /** Whether an unhealthy version was rolled back during this start. */
  readonly rolledBack: boolean
}

const now = (): string => new Date().toISOString()

/** Durable staging, activation, health confirmation, and rollback of releases. */
export class HarnessReleaseService extends Service {
  static inject = ['storageDomain']

  static Config: s<ReleaseConfig> = s.object({
    trustRoots: s.dict(s.string()).default({}),
    harnessVersion: s.string().default(DEFAULT_RELEASE_HARNESS_VERSION),
    allowUnsigned: s.boolean().default(false),
  })

  private table: KvTable<string, ReleaseRecord> | undefined
  private global: DomainGlobal<ReleaseState> | undefined
  private startup: ReleaseStartupResult | undefined

  /**
   * @param ctx - Context carrying the storage-domain facility.
   * @param config - Trust roots, harness version, and unsigned policy.
   */
  constructor(ctx: Context, private readonly config: ReleaseConfig = {}) {
    super(ctx, 'harnessRelease')
  }

  /** Open the release domain, reconcile an unhealthy active version, then close with the service. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(releaseDomainSpec)
    this.table = domain.table('staged')
    this.global = domain.global
    this.ctx.effect(() => async () => {
      this.table = undefined
      this.global = undefined
      await domain.close()
    }, 'harness-release.close')
    await this.ensureInstallId()
    this.startup = await this.reconcile()
  }

  /**
   * Resolve the startup reconciliation result.
   * @returns the active version after reconciliation and whether it rolled back.
   */
  get startupState(): ReleaseStartupResult {
    if (this.startup === undefined) throw new Error('harness release service is not initialized')
    return this.startup
  }

  /**
   * Stable identity of this installation, used to resolve staged rollouts.
   * @returns the durable install id.
   */
  get installId(): string {
    return this.requireGlobal().get().installId
  }

  /**
   * Verify one manifest and record it as staged. Verification failure and a
   * rollout this install is not part of are both refusals, so nothing unstaged
   * can later be activated.
   * @param raw - manifest as read from a feed, still untrusted.
   * @returns the staged record.
   */
  async stage(raw: unknown): Promise<ReleaseRecord> {
    const verified = verifyReleaseManifest(raw, resolveReleasePolicy(this.config))
    const { manifest } = verified
    if (!isInRollout(this.installId, manifest.version, manifest.rolloutFraction)) {
      throw new Error(`release ${manifest.version} is not offered to this install yet`)
    }
    const table = this.requireTable()
    const existing = table.get(manifest.version)
    if (existing !== undefined) return existing
    const record: ReleaseRecord = {
      version: manifest.version,
      stagedAt: now(),
      activatedAt: null,
      healthyAt: null,
      signatureOk: verified.signatureVerified,
      artifacts: manifest.artifacts.map(artifact => ({ ...artifact })),
    }
    await table.put(record.version, record)
    await this.audit('release_staged', { version: record.version, signatureOk: record.signatureOk })
    return record
  }

  /**
   * Activate one staged version, remembering the version it replaced so an
   * unhealthy start can return to it.
   * @param version - staged version to activate.
   * @returns the activated record.
   */
  async activate(version: string): Promise<ReleaseRecord> {
    const table = this.requireTable()
    const record = table.get(version)
    if (record === undefined) throw new Error(`release ${version} was not staged`)
    const state = this.requireGlobal().get()
    const activated: ReleaseRecord = { ...record, activatedAt: now(), healthyAt: null }
    await table.put(version, activated)
    await this.requireGlobal().set({
      ...state,
      activeVersion: version,
      previousVersion: state.activeVersion === version ? state.previousVersion : state.activeVersion,
    })
    await this.audit('release_activated', { version, previousVersion: state.activeVersion })
    return activated
  }

  /**
   * Mark the active version healthy. Until this lands, the next start treats
   * the version as unproven and returns to its predecessor.
   * @returns the confirmed record, or `undefined` when no version is active.
   */
  async confirmHealthy(): Promise<ReleaseRecord | undefined> {
    const state = this.requireGlobal().get()
    if (state.activeVersion === null) return undefined
    const table = this.requireTable()
    const record = table.get(state.activeVersion)
    if (record === undefined) return undefined
    if (record.healthyAt !== null) return record
    const healthy: ReleaseRecord = { ...record, healthyAt: now() }
    await table.put(healthy.version, healthy)
    return healthy
  }

  /**
   * Return to a previously staged version.
   * @param toVersion - version to activate; omitted uses the recorded predecessor.
   * @returns the version now active.
   * @throws when no predecessor is recorded or the target was never staged.
   */
  async rollback(toVersion?: string): Promise<string> {
    const state = this.requireGlobal().get()
    const target = toVersion ?? state.previousVersion
    if (target === null) throw new Error('no previous release is recorded to roll back to')
    const table = this.requireTable()
    if (table.get(target) === undefined) throw new Error(`release ${target} was not staged`)
    await this.activate(target)
    await this.audit('release_rollback', { from: state.activeVersion, to: target })
    return target
  }

  /**
   * List every staged release, oldest first.
   * @returns a snapshot of the staged table.
   */
  list(): ReleaseRecord[] {
    return [...this.requireTable().entries()]
      .map(([, record]) => record)
      .sort((left, right) => left.stagedAt.localeCompare(right.stagedAt))
  }

  /** Roll back an active version that never reported itself healthy. */
  private async reconcile(): Promise<ReleaseStartupResult> {
    const state = this.requireGlobal().get()
    if (state.activeVersion === null) return { activeVersion: null, rolledBack: false }
    const active = this.requireTable().get(state.activeVersion)
    if (active === undefined || active.healthyAt !== null || state.previousVersion === null) {
      return { activeVersion: state.activeVersion, rolledBack: false }
    }
    const restored = await this.rollback(state.previousVersion)
    return { activeVersion: restored, rolledBack: true }
  }

  /** Mint this install's identity once, so rollout buckets stay stable. */
  private async ensureInstallId(): Promise<void> {
    const global = this.requireGlobal()
    const state = global.get()
    if (state.installId !== releaseDomainSpec.global.initial.installId) return
    await global.set({ ...state, installId: randomUUID() })
  }

  private async audit(
    eventType: 'release_staged' | 'release_activated' | 'release_rollback',
    detail: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const sink: AuditSink | undefined = this.ctx.get('harnessAudit')
    await sink?.record({ eventType, actor: 'harness-release', detail })
  }

  private requireTable(): KvTable<string, ReleaseRecord> {
    if (this.table === undefined) throw new Error('harness release service is not initialized')
    return this.table
  }

  private requireGlobal(): DomainGlobal<ReleaseState> {
    if (this.global === undefined) throw new Error('harness release service is not initialized')
    return this.global
  }
}

export default HarnessReleaseService
