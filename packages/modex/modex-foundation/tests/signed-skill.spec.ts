import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SignedSkillValidationError,
  loadSignedSkill,
  signaturePayload,
  type SignedSkillManifest,
} from '../src/index.ts'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'harness-skill-'))
  const system = '# Test skill\n\nUse a short deterministic response.\n'
  const tools = '{"tools":[]}\n'
  await writeFile(join(directory, 'system.md'), system)
  await writeFile(join(directory, 'tools.json'), tools)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const manifest = {
    id: 'test-skill',
    version: '1.0.0',
    name: 'Test Skill',
    description: 'A deterministic test skill.',
    roles: ['executor'],
    tags: ['test'],
    permissions: { tools: [], network: false },
    compat: { minHarness: '0.1.0' },
    integrity: {
      algo: 'sha256' as const,
      files: {
        'system.md': createHash('sha256').update(system).digest('hex'),
        'tools.json': createHash('sha256').update(tools).digest('hex'),
      },
    },
    signature: { algo: 'ed25519' as const, value: '', keyId: 'test-key' },
  } satisfies SignedSkillManifest
  manifest.signature.value = sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
  await writeFile(join(directory, 'skill.json'), JSON.stringify(manifest))
  return { directory, publicDer }
}

describe('signed skill packages', () => {
  it('loads a package only after hash and signature validation', async () => {
    const { directory, publicDer } = await fixture()
    const loaded = await loadSignedSkill(directory, {
      minHarnessVersion: '0.1.1',
      trustRoots: { 'test-key': publicDer },
    })
    expect(loaded.manifest.id).toBe('test-skill')
    expect(loaded.systemContent).toContain('deterministic')
  })

  it('rejects unknown trust roots and modified content', async () => {
    const { directory, publicDer } = await fixture()
    await expect(loadSignedSkill(directory, {
      minHarnessVersion: '0.1.1',
      trustRoots: {},
    })).rejects.toBeInstanceOf(SignedSkillValidationError)
    await writeFile(join(directory, 'system.md'), 'modified')
    await expect(loadSignedSkill(directory, {
      minHarnessVersion: '0.1.1',
      trustRoots: { 'test-key': publicDer },
    })).rejects.toBeInstanceOf(SignedSkillValidationError)
  })
})
