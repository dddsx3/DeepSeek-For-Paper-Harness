import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import {
  SignedSkillProvider,
  signaturePayload,
  type SignedSkillManifest,
} from '../src/index.ts'

async function packageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-provider-'))
  const directory = join(root, 'catalog-skill')
  const body = 'catalog body\n'
  await (await import('node:fs/promises')).mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'system.md'), body)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const manifest = {
    id: 'catalog-skill', version: '1.0.0', name: 'Catalog Skill', description: 'Catalog skill',
    roles: ['executor'], tags: ['catalog'], permissions: { tools: [], network: false },
    compat: { minHarness: '0.1.0' }, integrity: { algo: 'sha256' as const, files: {
      'system.md': createHash('sha256').update(body).digest('hex'),
    } }, signature: { algo: 'ed25519' as const, value: '', keyId: 'catalog-key' },
  } satisfies SignedSkillManifest
  manifest.signature.value = sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
  await writeFile(join(directory, 'skill.json'), JSON.stringify(manifest))
  return { root, publicDer, directory }
}

describe('SignedSkillProvider', () => {
  it('lists and loads validated skills through the upstream registry', async () => {
    const fixture = await packageFixture()
    const provider = new SignedSkillProvider({
      roots: [fixture.root], minHarnessVersion: '0.1.1', trustRoots: { 'catalog-key': fixture.publicDer },
    })
    const candidates = await provider.list()
    expect(candidates).toHaveLength(1)
    const definition = await provider.get(candidates[0]!, {})
    expect(definition?.name).toBe('catalog-skill')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.skills.registerProvider(() => provider)
    await expect(ctx.skills.get('catalog-skill')).resolves.toMatchObject({ content: 'catalog body\n' })
  })
})
