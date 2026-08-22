import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as CatalogProvider from '../src/catalog-provider.ts'
import {
  CatalogSkillProvider,
  SkillCatalogService,
  signaturePayload,
  type SignedSkillManifest,
} from '../src/index.ts'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_DER = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

async function writePackage(parent: string, id: string, version: string, tools: readonly string[] = []): Promise<string> {
  const directory = join(parent, `${id}-${version}`)
  await mkdir(directory, { recursive: true })
  const body = `# ${id}\n\n${version} instructions.\n`
  const toolsJson = `{"tools":${JSON.stringify(tools)}}\n`
  await writeFile(join(directory, 'system.md'), body)
  await writeFile(join(directory, 'tools.json'), toolsJson)
  const manifest = {
    id,
    version,
    name: id,
    description: `${id} description`,
    roles: ['executor'],
    tags: ['catalog'],
    permissions: { tools: [...tools], network: false },
    compat: { minHarness: '0.1.0' },
    integrity: {
      algo: 'sha256' as const,
      files: {
        'system.md': createHash('sha256').update(body).digest('hex'),
        'tools.json': createHash('sha256').update(toolsJson).digest('hex'),
      },
    },
    signature: { algo: 'ed25519' as const, value: '', keyId: 'test-key' },
  } satisfies SignedSkillManifest
  manifest.signature.value = sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
  await writeFile(join(directory, 'skill.json'), JSON.stringify(manifest))
  return directory
}

async function harness() {
  const parent = await mkdtemp(join(tmpdir(), 'harness-catalog-provider-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin(SkillCatalogService, {
    storeRoot: join(parent, 'store'),
    minHarnessVersion: '0.1.1',
    trustRoots: { 'test-key': PUBLIC_DER },
  })
  return { parent, ctx, fiber }
}

describe('CatalogSkillProvider', () => {
  it('lists and loads the catalog active version, and ignores foreign locators', async () => {
    const { parent, ctx, fiber } = await harness()
    await ctx.harnessSkillCatalog.install(await writePackage(parent, 'active-skill', '1.0.0', ['read_file']))
    const provider = new CatalogSkillProvider(ctx.harnessSkillCatalog)

    const candidates = await provider.list()
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]
    expect(candidate).toMatchObject({ name: 'active-skill', provider: 'harness-catalog', source: 'bundled' })
    expect(candidate?.metadata).toMatchObject({ version: '1.0.0', tags: ['catalog'] })

    const definition = await provider.get(candidate!, {})
    expect(definition?.content).toContain('1.0.0 instructions')
    expect(definition?.metadata).toMatchObject({ roles: ['executor'], permissions: { network: false } })

    // A locator the provider did not mint, and one that is no longer active.
    expect(await provider.get({ ...candidate!, locator: 42 }, {})).toBeUndefined()
    expect(await provider.get({ ...candidate!, locator: join(parent, 'absent') }, {})).toBeUndefined()
    await fiber.dispose()
  })

  it('serves the rolled-back version after the catalog switches', async () => {
    const { parent, ctx, fiber } = await harness()
    await ctx.harnessSkillCatalog.install(await writePackage(parent, 'rolling-skill', '1.0.0'))
    await ctx.harnessSkillCatalog.install(await writePackage(parent, 'rolling-skill', '2.0.0'))
    const provider = new CatalogSkillProvider(ctx.harnessSkillCatalog)

    expect((await provider.list())[0]?.metadata).toMatchObject({ version: '2.0.0' })
    await ctx.harnessSkillCatalog.rollback('rolling-skill', '1.0.0')
    const rolled = await provider.list()
    expect(rolled[0]?.metadata).toMatchObject({ version: '1.0.0' })
    expect((await provider.get(rolled[0]!, {}))?.content).toContain('1.0.0 instructions')
    await fiber.dispose()
  })

  it('registers on the skill registry so a catalog skill resolves by name', async () => {
    const { parent, ctx, fiber } = await harness()
    await ctx.harnessSkillCatalog.install(await writePackage(parent, 'registered-skill', '1.0.0'))
    const providerFiber = await ctx.plugin(CatalogProvider)

    await expect(ctx.skills.get('registered-skill'))
      .resolves.toMatchObject({ name: 'registered-skill', provider: 'harness-catalog' })
    expect((await ctx.skills.list()).map(entry => entry.name)).toContain('registered-skill')

    await providerFiber.dispose()
    await fiber.dispose()
  })
})
