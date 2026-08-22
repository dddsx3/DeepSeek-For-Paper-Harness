import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  detectSkillConflicts,
  signaturePayload,
  SignedSkillValidationError,
  SkillCatalogService,
  SkillConflictError,
  type SignedSkillManifest,
} from '../src/index.ts'

interface PackageOptions {
  readonly id: string
  readonly version: string
  readonly tools?: readonly string[]
  readonly tags?: readonly string[]
  readonly unsigned?: boolean
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_DER = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

async function writePackage(parent: string, options: PackageOptions): Promise<string> {
  const directory = join(parent, `${options.id}-${options.version}`)
  await mkdir(directory, { recursive: true })
  const body = `# ${options.id}\n\n${options.version} body.\n`
  const tools = `{"tools":${JSON.stringify(options.tools ?? [])}}\n`
  await writeFile(join(directory, 'system.md'), body)
  await writeFile(join(directory, 'tools.json'), tools)
  const manifest = {
    id: options.id,
    version: options.version,
    name: options.id,
    description: `${options.id} description`,
    roles: ['executor'],
    tags: options.tags ?? [],
    permissions: { tools: options.tools ?? [], network: false },
    compat: { minHarness: '0.1.0' },
    integrity: {
      algo: 'sha256' as const,
      files: {
        'system.md': createHash('sha256').update(body).digest('hex'),
        'tools.json': createHash('sha256').update(tools).digest('hex'),
      },
    },
    ...(options.unsigned === true ? {} : {
      signature: { algo: 'ed25519' as const, value: '', keyId: 'test-key' },
    }),
  } satisfies SignedSkillManifest
  if (manifest.signature !== undefined) {
    manifest.signature.value = sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
  }
  await writeFile(join(directory, 'skill.json'), JSON.stringify(manifest))
  return directory
}

interface CatalogOptions {
  readonly exclusiveTagGroups?: readonly (readonly string[])[]
  readonly allowUnsigned?: boolean
}

async function catalog(options: CatalogOptions = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'harness-catalog-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(SkillCatalogService, {
    storeRoot: join(parent, 'store'),
    minHarnessVersion: '0.1.1',
    trustRoots: { 'test-key': PUBLIC_DER },
    ...options.allowUnsigned === undefined ? {} : { allowUnsigned: options.allowUnsigned },
    ...options.exclusiveTagGroups === undefined ? {} : { exclusiveTagGroups: options.exclusiveTagGroups },
  })
  return { parent, ctx, fiber, service: ctx.harnessSkillCatalog }
}

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
})

describe('SkillCatalogService', () => {
  it('installs versioned packages, keeps history, and rolls back after re-validation', async () => {
    const { parent, fiber, service } = await catalog()
    const first = await service.install(await writePackage(parent, { id: 'demo-skill', version: '1.0.0', tools: ['read_file'] }))
    expect(first.installedVersion).toBe('1.0.0')
    const second = await service.install(await writePackage(parent, { id: 'demo-skill', version: '1.1.0', tools: ['read_file'] }))
    expect(second.versions.map(entry => entry.version)).toEqual(['1.0.0', '1.1.0'])
    expect(second.installedVersion).toBe('1.1.0')
    const rolledBack = await service.rollback('demo-skill', '1.0.0')
    expect(rolledBack.installedVersion).toBe('1.0.0')
    const stored = rolledBack.versions[0]?.directory
    expect(stored).toBeDefined()
    expect(await readFile(join(stored as string, 'system.md'), 'utf8')).toContain('1.0.0')
    await expect(service.rollback('demo-skill', '9.9.9')).rejects.toThrow('no installed version')
    await fiber.dispose()
  })

  it('refuses rollback when the stored copy no longer validates', async () => {
    const { parent, fiber, service } = await catalog()
    await service.install(await writePackage(parent, { id: 'tamper-skill', version: '1.0.0' }))
    await service.install(await writePackage(parent, { id: 'tamper-skill', version: '2.0.0' }))
    const stored = service.get('tamper-skill')?.versions[0]?.directory
    expect(stored).toBeDefined()
    await writeFile(join(stored as string, 'system.md'), 'modified after install')
    await expect(service.rollback('tamper-skill', '1.0.0')).rejects.toBeInstanceOf(SignedSkillValidationError)
    await fiber.dispose()
  })

  it('rejects installs whose active tools conflict and accepts same-id upgrades', async () => {
    const { parent, fiber, service } = await catalog()
    await service.install(await writePackage(parent, { id: 'search-skill', version: '1.0.0', tools: ['web_search'] }))
    await expect(service.install(await writePackage(parent, { id: 'rival-skill', version: '1.0.0', tools: ['web_search'] })))
      .rejects.toBeInstanceOf(SkillConflictError)
    const upgraded = await service.install(await writePackage(parent, { id: 'search-skill', version: '1.1.0', tools: ['web_search'] }))
    expect(upgraded.installedVersion).toBe('1.1.0')
    expect(service.activeDirectories()).toHaveLength(1)
    await fiber.dispose()
  })

  it('enforces exclusive tag groups through install', async () => {
    const { parent, fiber, service } = await catalog({ exclusiveTagGroups: [['editor'], ['reviewer']] })
    await service.install(await writePackage(parent, { id: 'editor-skill', version: '1.0.0', tags: ['editor'] }))
    await expect(service.install(await writePackage(parent, { id: 'other-skill', version: '1.0.0', tags: ['editor'] })))
      .rejects.toBeInstanceOf(SkillConflictError)
    await fiber.dispose()
  })

  it('loads unsigned packages only in development mode', async () => {
    const refused = await catalog()
    const unsigned = await writePackage(refused.parent, { id: 'unsigned-skill', version: '1.0.0', unsigned: true })
    await expect(refused.service.install(unsigned)).rejects.toThrow('package is not signed')
    await refused.fiber.dispose()

    process.env.NODE_ENV = 'production'
    const production = await catalog({ allowUnsigned: true })
    await expect(production.service.install(unsigned)).rejects.toThrow('refused in production')
    await production.fiber.dispose()
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv

    const dev = await catalog({ allowUnsigned: true })
    const record = await dev.service.install(unsigned)
    expect(record.versions[0]?.signatureOk).toBe(false)
    await dev.fiber.dispose()
  })
})

describe('SkillCatalogService edge cases', () => {
  it('treats reinstalling a stored version as a no-op', async () => {
    const { parent, fiber, service } = await catalog()
    const directory = await writePackage(parent, { id: 'idem-skill', version: '1.0.0' })
    const first = await service.install(directory)
    const again = await service.install(directory)
    expect(again).toEqual(first)
    expect(service.get('idem-skill')?.versions).toHaveLength(1)
    await fiber.dispose()
  })

  it('installs a package whose integrity covers no tool declaration', async () => {
    const { parent, fiber, service } = await catalog()
    const directory = join(parent, 'bodyonly')
    await mkdir(directory, { recursive: true })
    const body = ['# body-only', '', 'instructions.', ''].join('\n')
    await writeFile(join(directory, 'system.md'), body)
    const manifest = {
      id: 'body-only-skill',
      version: '1.0.0',
      name: 'body-only',
      description: 'no tool declaration',
      roles: ['executor'],
      tags: [],
      permissions: { tools: [], network: false },
      compat: { minHarness: '0.1.0' },
      integrity: {
        algo: 'sha256' as const,
        files: { 'system.md': createHash('sha256').update(body).digest('hex') },
      },
      signature: { algo: 'ed25519' as const, value: '', keyId: 'test-key' },
    } satisfies SignedSkillManifest
    manifest.signature.value = sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
    await writeFile(join(directory, 'skill.json'), JSON.stringify(manifest))

    const record = await service.install(directory)
    expect(record.versions[0]?.tools).toEqual([])
    await fiber.dispose()
  })

  it('refuses to roll back a skill that was never installed', async () => {
    const { fiber, service } = await catalog()
    await expect(service.rollback('absent-skill', '1.0.0')).rejects.toThrow('is not installed')
    await fiber.dispose()
  })

  it('treats a record whose active version is missing as declaring nothing', async () => {
    const { parent, ctx, fiber, service } = await catalog()
    await service.install(await writePackage(parent, { id: 'present-skill', version: '1.0.0', tools: ['write_file'] }))
    const table = ctx.storageDomain.get('harness_skills')?.table('installed')
    expect(table).toBeDefined()
    // A record pointing at a version it does not hold contributes no tools or tags.
    await table?.put('ghost-skill', { id: 'ghost-skill', installedVersion: '9.9.9', versions: [
      { version: '1.0.0', directory: 'nowhere', installedAt: '', signatureOk: true, tools: ['read_file'], tags: [] },
    ] })
    expect(service.activeDirectories()).toHaveLength(1)

    // The ghost declares nothing, so an installing skill sees no conflict from it.
    const record = await service.install(await writePackage(parent, { id: 'other-skill', version: '1.0.0', tools: ['read_file'] }))
    expect(record.installedVersion).toBe('1.0.0')
    await fiber.dispose()
  })

  it('refuses reads once its domain is closed', async () => {
    const { fiber, service } = await catalog()
    await fiber.dispose()
    expect(() => service.list()).toThrow('not initialized')
  })
})

describe('detectSkillConflicts', () => {
  it('reports tool and tag conflicts between distinct skills only', () => {
    const existing = [{ id: 'left', tools: ['web_search'], tags: ['editor'] }]
    expect(detectSkillConflicts(existing, { id: 'left', tools: ['web_search'], tags: ['editor'] })).toEqual([])
    expect(detectSkillConflicts(existing, { id: 'right', tools: ['web_search'], tags: ['reviewer'] }, [['editor', 'reviewer']]))
      .toEqual([
        { kind: 'tool', left: 'left', right: 'right', subject: 'web_search' },
        { kind: 'tag', left: 'left', right: 'right', subject: 'editor|reviewer' },
      ])
  })
})
