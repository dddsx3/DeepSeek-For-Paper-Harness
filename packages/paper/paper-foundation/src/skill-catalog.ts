/** Install, version, and rollback management for signed Paper skill packages. */

import { copyFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
import { loadSignedSkill, type LoadSignedSkillOptions, type SkillTrustRoots, type ValidatedSignedSkill } from './signed-skill.ts'

/** One stored version of an installed skill package. */
export interface InstalledSkillVersion {
  /** Package version this entry holds. */
  readonly version: string
  /** Directory inside the catalog store holding this version's files. */
  readonly directory: string
  /** ISO timestamp recorded when this version was installed. */
  readonly installedAt: string
  /** Whether the detached signature was present and verified at install. */
  readonly signatureOk: boolean
  /** Tool names this version declares through tools.json. */
  readonly tools: readonly string[]
  /** Manifest tags recorded for conflict detection. */
  readonly tags: readonly string[]
}

/** Catalog record for one installed skill id. */
export interface InstalledSkillRecord {
  /** Kebab-case skill id. */
  readonly id: string
  /** Version the catalog currently serves. */
  readonly installedVersion: string
  /** Every installed version, oldest first. */
  readonly versions: readonly InstalledSkillVersion[]
}

/** Catalog configuration. */
export interface SkillCatalogConfig {
  /** Directory root under which installed versions are stored. */
  readonly storeRoot: string
  /** Minimum harness version accepted at install and rollback. */
  readonly minHarnessVersion: string
  /** Trusted signing keys by key id. */
  readonly trustRoots: SkillTrustRoots
  /** Development-only: accept unsigned packages with a warning. */
  readonly allowUnsigned?: boolean
  /** Tag groups whose members may not be active together. */
  readonly exclusiveTagGroups?: readonly (readonly string[])[]
}

/** One reason two skills cannot be active together. */
export interface SkillConflict {
  /** Whether a shared tool or an exclusive tag group caused the conflict. */
  readonly kind: 'tool' | 'tag'
  /** First conflicting skill id. */
  readonly left: string
  /** Second conflicting skill id. */
  readonly right: string
  /** Shared tool name, or the exclusive group joined with '|'. */
  readonly subject: string
}

/** An install refused because skills cannot be active together. */
export class SkillConflictError extends Error {
  /** Stable machine-readable error code. */
  readonly code = 'SKILL_CONFLICT'

  /**
   * @param conflicts - Every detected conflict, never empty.
   */
  constructor(readonly conflicts: readonly SkillConflict[]) {
    super(`skill conflict detected: ${conflicts.map(conflict => `${conflict.left}/${conflict.right} share ${conflict.subject}`).join('; ')}`)
    this.name = 'SkillConflictError'
  }
}

/**
 * Detect reasons a skill set cannot be active together: one tool declared by
 * two different skills, or two skills whose tags fall into one exclusive group.
 * @param existing - Already active skills with their declared tools and tags.
 * @param incoming - Skill being considered for activation.
 * @param exclusiveTagGroups - Tag groups whose members may not co-occur.
 * @returns every detected conflict; empty when the set is compatible.
 */
export function detectSkillConflicts(
  existing: readonly { readonly id: string; readonly tools: readonly string[]; readonly tags: readonly string[] }[],
  incoming: { readonly id: string; readonly tools: readonly string[]; readonly tags: readonly string[] },
  exclusiveTagGroups: readonly (readonly string[])[] = [],
): SkillConflict[] {
  const conflicts: SkillConflict[] = []
  for (const skill of existing) {
    if (skill.id === incoming.id) continue
    for (const tool of incoming.tools) {
      if (skill.tools.includes(tool)) {
        conflicts.push({ kind: 'tool', left: skill.id, right: incoming.id, subject: tool })
      }
    }
    for (const group of exclusiveTagGroups) {
      if (group.some(tag => skill.tags.includes(tag)) && group.some(tag => incoming.tags.includes(tag))) {
        conflicts.push({ kind: 'tag', left: skill.id, right: incoming.id, subject: group.join('|') })
      }
    }
  }
  return conflicts
}

const versionEntrySchema = zod.object({
  version: zod.string().min(1),
  directory: zod.string().min(1),
  installedAt: zod.string().min(1),
  signatureOk: zod.boolean(),
  tools: zod.array(zod.string()),
  tags: zod.array(zod.string()),
})

const installedRecordSchema = zod.object({
  id: zod.string().min(1),
  installedVersion: zod.string().min(1),
  versions: zod.array(versionEntrySchema).min(1),
})

/** Durable catalog storage declaration. */
export const skillCatalogDomainSpec = defineDomain({
  name: 'paper_skills',
  version: 0,
  tables: {
    installed: domainTable<string, zod.infer<typeof installedRecordSchema>>(installedRecordSchema),
  },
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperSkillCatalog: SkillCatalogService
  }

  interface Events {
    /**
     * One installed skill record changed through install or rollback. Emitted
     * after the record is durable; listener failures are contained.
     * @param record - the updated catalog record.
     * @mode emit
     */
    'paper-skill/catalog-changed'(record: InstalledSkillRecord): void
  }
}

/**
 * Durable skill package catalog. Validates packages at install, stores one
 * directory per version, re-validates the target before rollback, and refuses
 * installs whose active set would conflict.
 */
export class SkillCatalogService extends Service {
  static inject = ['storageDomain']

  private table: KvTable<string, InstalledSkillRecord> | undefined

  /**
   * @param ctx - Context carrying the storage-domain facility.
   * @param config - Store root and trust policy.
   */
  constructor(ctx: Context, private readonly config: SkillCatalogConfig) {
    super(ctx, 'paperSkillCatalog')
  }

  /** Open the catalog domain and close it with the service lifecycle. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(skillCatalogDomainSpec)
    const table = domain.table('installed')
    this.table = table
    this.ctx.effect(() => async () => {
      this.table = undefined
      await domain.close()
    }, 'paper-skill-catalog.close')
  }

  /**
   * Validate and install one package version. Installing the same version
   * again is idempotent; a new version of the same id keeps prior versions.
   * @param directory - Package directory containing skill.json.
   * @returns the updated catalog record.
   */
  async install(directory: string): Promise<InstalledSkillRecord> {
    const loaded = await loadSignedSkill(directory, this.loadOptions())
    const table = this.requireTable()
    const existing = table.get(loaded.manifest.id)
    if (existing?.versions.some(entry => entry.version === loaded.manifest.version)) return existing

    const conflicts = detectSkillConflicts(
      this.activeSummaries().filter(skill => skill.id !== loaded.manifest.id),
      { id: loaded.manifest.id, tools: loaded.declaredTools, tags: loaded.manifest.tags },
      this.config.exclusiveTagGroups ?? [],
    )
    if (conflicts.length > 0) throw new SkillConflictError(conflicts)

    const target = join(resolve(this.config.storeRoot), loaded.manifest.id, loaded.manifest.version)
    await mkdir(target, { recursive: true })
    await copyFile(join(loaded.directory, 'skill.json'), join(target, 'skill.json'))
    await copyFile(join(loaded.directory, 'system.md'), join(target, 'system.md'))
    if (Object.hasOwn(loaded.manifest.integrity.files, 'tools.json')) {
      await copyFile(join(loaded.directory, 'tools.json'), join(target, 'tools.json'))
    }
    const entry: InstalledSkillVersion = {
      version: loaded.manifest.version,
      directory: target,
      installedAt: new Date().toISOString(),
      signatureOk: loaded.signatureVerified,
      tools: [...loaded.declaredTools],
      tags: [...loaded.manifest.tags],
    }
    const record: InstalledSkillRecord = {
      id: loaded.manifest.id,
      installedVersion: entry.version,
      versions: existing === undefined ? [entry] : [...existing.versions, entry],
    }
    await table.put(record.id, record)
    this.ctx.emit('paper-skill/catalog-changed', record)
    return record
  }

  /**
   * Switch one skill back to a previously installed version after
   * re-validating the stored copy.
   * @param id - Installed skill id.
   * @param toVersion - Version to activate.
   * @returns the updated catalog record.
   */
  async rollback(id: string, toVersion: string): Promise<InstalledSkillRecord> {
    const table = this.requireTable()
    const record = table.get(id)
    if (record === undefined) throw new Error(`skill '${id}' is not installed`)
    const entry = record.versions.find(candidate => candidate.version === toVersion)
    if (entry === undefined) throw new Error(`skill '${id}' has no installed version '${toVersion}'`)
    await loadSignedSkill(entry.directory, this.loadOptions())
    const next: InstalledSkillRecord = { ...record, installedVersion: toVersion }
    await table.put(id, next)
    this.ctx.emit('paper-skill/catalog-changed', next)
    return next
  }

  /**
   * List every installed record.
   * @returns snapshot of the installed table.
   */
  list(): InstalledSkillRecord[] {
    return [...this.requireTable().entries()].map(([, record]) => record)
  }

  /**
   * Resolve one installed record by id.
   * @param id - Installed skill id.
   * @returns the record, or `undefined` when absent.
   */
  get(id: string): InstalledSkillRecord | undefined {
    return this.requireTable().get(id)
  }

  /**
   * Directories of every record's active version, for provider wiring.
   * @returns active version directories.
   */
  activeDirectories(): string[] {
    return this.list()
      .map(record => record.versions.find(entry => entry.version === record.installedVersion)?.directory)
      .filter((directory): directory is string => directory !== undefined)
  }

  /**
   * Validate and load every record's active version.
   * @returns validated active packages, in record order.
   */
  async activeSkills(): Promise<ValidatedSignedSkill[]> {
    return Promise.all(this.activeDirectories().map(directory => loadSignedSkill(directory, this.loadOptions())))
  }

  /** Project the active version of every record for conflict checks. */
  private activeSummaries(): { id: string; tools: readonly string[]; tags: readonly string[] }[] {
    return this.list().map((record) => {
      const active = record.versions.find(entry => entry.version === record.installedVersion)
      return { id: record.id, tools: active?.tools ?? [], tags: active?.tags ?? [] }
    })
  }

  /** Shared validation options for install and rollback loads. */
  private loadOptions(): LoadSignedSkillOptions {
    return {
      minHarnessVersion: this.config.minHarnessVersion,
      trustRoots: this.config.trustRoots,
      ...this.config.allowUnsigned === undefined ? {} : { allowUnsigned: this.config.allowUnsigned },
      warn: (message) => { this.ctx.logger.warn(message) },
    }
  }

  private requireTable(): KvTable<string, InstalledSkillRecord> {
    if (this.table === undefined) throw new Error('paper skill catalog is not initialized')
    return this.table
  }
}

export default SkillCatalogService
