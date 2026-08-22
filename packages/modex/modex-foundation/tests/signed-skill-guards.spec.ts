import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SignedSkill from '../src/signed-skill.ts'
import {
  SignedSkillProvider,
  SignedSkillValidationError,
  loadSignedSkill,
  signaturePayload,
  type SignedSkillManifest,
} from '../src/index.ts'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_DER = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const TRUST = { minHarnessVersion: '0.1.1', trustRoots: { 'test-key': PUBLIC_DER } }

interface Overrides {
  readonly id?: string
  readonly version?: string
  readonly minHarness?: string
  readonly integrityFiles?: Record<string, string>
  readonly toolsJson?: string
  readonly omitToolsJson?: boolean
  readonly tamperSignature?: boolean
  readonly rawManifest?: string
}

async function writePackage(parent: string, name: string, overrides: Overrides = {}): Promise<string> {
  const directory = join(parent, name)
  await mkdir(directory, { recursive: true })
  const body = `# ${name}\n\ninstructions.\n`
  const toolsJson = overrides.toolsJson ?? '{"tools":["read_file"]}\n'
  await writeFile(join(directory, 'system.md'), body)
  if (overrides.omitToolsJson !== true) await writeFile(join(directory, 'tools.json'), toolsJson)
  const manifest = {
    id: overrides.id ?? 'guard-skill',
    version: overrides.version ?? '1.0.0',
    name,
    description: 'guard skill',
    roles: ['executor'],
    tags: [],
    permissions: { tools: [], network: false },
    compat: { minHarness: overrides.minHarness ?? '0.1.0' },
    integrity: {
      algo: 'sha256' as const,
      files: overrides.integrityFiles ?? {
        'system.md': createHash('sha256').update(body).digest('hex'),
        'tools.json': createHash('sha256').update(toolsJson).digest('hex'),
      },
    },
    signature: { algo: 'ed25519' as const, value: '', keyId: 'test-key' },
  } satisfies SignedSkillManifest
  manifest.signature.value = overrides.tamperSignature === true
    ? Buffer.from('not-the-signature-bytes-at-all').toString('base64')
    : sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
  await writeFile(join(directory, 'skill.json'), overrides.rawManifest ?? JSON.stringify(manifest))
  return directory
}

describe('signed package validation refusals', () => {
  it('refuses a directory with no readable manifest', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    await expect(loadSignedSkill(join(parent, 'absent'), TRUST))
      .rejects.toThrow('cannot read skill.json')
    const malformed = await writePackage(parent, 'malformed', { rawManifest: '{not json' })
    await expect(loadSignedSkill(malformed, TRUST)).rejects.toThrow('cannot read skill.json')
  })

  it('refuses a manifest that does not match the schema', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const directory = await writePackage(parent, 'schema', { rawManifest: JSON.stringify({ id: 'x' }) })
    await expect(loadSignedSkill(directory, TRUST))
      .rejects.toThrow('does not match the manifest schema')
  })

  it('refuses an id that is not a skill name', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const directory = await writePackage(parent, 'bad-id', { id: 'Not_A_Skill_Name' })
    await expect(loadSignedSkill(directory, TRUST)).rejects.toThrow('invalid skill id')
  })

  it('refuses a package that requires a newer harness and accepts equal or older', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const newer = await writePackage(parent, 'newer', { minHarness: '9.0.0' })
    await expect(loadSignedSkill(newer, TRUST)).rejects.toThrow('or newer')

    const equal = await writePackage(parent, 'equal', { minHarness: '0.1.1' })
    await expect(loadSignedSkill(equal, TRUST)).resolves.toMatchObject({ signatureVerified: true })

    const patchOlder = await writePackage(parent, 'patch-older', { minHarness: '0.1.0' })
    await expect(loadSignedSkill(patchOlder, TRUST)).resolves.toMatchObject({ signatureVerified: true })

    const minorNewer = await writePackage(parent, 'minor-newer', { minHarness: '0.2.0' })
    await expect(loadSignedSkill(minorNewer, TRUST)).rejects.toThrow('or newer')

    // A version with fewer than three segments reads its missing parts as zero.
    const shortForm = await writePackage(parent, 'short-form', { minHarness: '0.1' })
    await expect(loadSignedSkill(shortForm, TRUST)).resolves.toMatchObject({ signatureVerified: true })
    const shortNewer = await writePackage(parent, 'short-newer', { minHarness: '1' })
    await expect(loadSignedSkill(shortNewer, TRUST)).rejects.toThrow('or newer')

    // The harness version may also be short-form on either side of the compare.
    const older = await writePackage(parent, 'short-current', { minHarness: '0.0.9' })
    await expect(loadSignedSkill(older, { ...TRUST, minHarnessVersion: '1' }))
      .resolves.toMatchObject({ signatureVerified: true })

    // The segment that decides is one the current version does not state, so it
    // reads as zero and the requirement is not met.
    const deeper = await writePackage(parent, 'deeper-minimum', { minHarness: '1.2.0' })
    await expect(loadSignedSkill(deeper, { ...TRUST, minHarnessVersion: '1' }))
      .rejects.toThrow('or newer')
  })

  it('refuses a forged signature', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const directory = await writePackage(parent, 'forged', { tamperSignature: true })
    await expect(loadSignedSkill(directory, TRUST)).rejects.toThrow('signature verification failed')
  })

  it('refuses integrity that names an unsupported file or omits the body', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const unsupported = await writePackage(parent, 'unsupported', {
      integrityFiles: { 'secrets.env': 'a'.repeat(64) },
    })
    await expect(loadSignedSkill(unsupported, TRUST))
      .rejects.toThrow('integrity references unsupported file')

    const body = '# body-only\n\ninstructions.\n'
    const bodyless = join(parent, 'bodyless')
    await mkdir(bodyless, { recursive: true })
    await writeFile(join(bodyless, 'system.md'), body)
    await writeFile(join(bodyless, 'tools.json'), '{"tools":[]}\n')
    const manifest = {
      id: 'bodyless-skill',
      version: '1.0.0',
      name: 'bodyless',
      description: 'no body hash',
      roles: [],
      tags: [],
      permissions: { tools: [], network: false },
      compat: { minHarness: '0.1.0' },
      integrity: {
        algo: 'sha256' as const,
        files: { 'tools.json': createHash('sha256').update('{"tools":[]}\n').digest('hex') },
      },
      signature: { algo: 'ed25519' as const, value: '', keyId: 'test-key' },
    } satisfies SignedSkillManifest
    manifest.signature.value = sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
    await writeFile(join(bodyless, 'skill.json'), JSON.stringify(manifest))
    await expect(loadSignedSkill(bodyless, TRUST)).rejects.toThrow('integrity must cover system.md')
  })

  it('refuses tools.json that is unreadable or not a string array', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const unreadable = await writePackage(parent, 'unreadable-tools', {
      toolsJson: '{not json',
      omitToolsJson: false,
    })
    await expect(loadSignedSkill(unreadable, TRUST)).rejects.toThrow('cannot parse tools.json')

    const notArray = await writePackage(parent, 'not-array', { toolsJson: '{"tools":"read_file"}\n' })
    await expect(loadSignedSkill(notArray, TRUST))
      .rejects.toThrow('must declare a non-empty string array')

    const emptyName = await writePackage(parent, 'empty-name', { toolsJson: '{"tools":[""]}\n' })
    await expect(loadSignedSkill(emptyName, TRUST))
      .rejects.toThrow('must declare a non-empty string array')
  })

  it('reads no declared tools when integrity does not cover tools.json', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const body = '# body\n\ninstructions.\n'
    const directory = join(parent, 'no-tools')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'system.md'), body)
    const manifest = {
      id: 'no-tools-skill',
      version: '1.0.0',
      name: 'no-tools',
      description: 'body only',
      roles: [],
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

    await expect(loadSignedSkill(directory, TRUST)).resolves.toMatchObject({ declaredTools: [] })
  })
})

describe('SignedSkillProvider catalog behavior', () => {
  it('skips unreadable roots and invalid packages while listing the sound ones', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    await writePackage(parent, 'sound', { id: 'sound-skill' })
    await writePackage(parent, 'forged', { id: 'forged-skill', tamperSignature: true })
    await writeFile(join(parent, 'stray-file.txt'), 'not a package')

    const provider = new SignedSkillProvider({
      roots: [parent, join(parent, 'absent-root')],
      ...TRUST,
      allowUnsigned: false,
    })
    const candidates = await provider.list()
    expect(candidates.map(entry => entry.name)).toEqual(['sound-skill'])

    expect(await provider.get({ ...candidates[0]!, locator: 7 }, {})).toBeUndefined()
    await expect(provider.get(candidates[0]!, {})).resolves.toMatchObject({ name: 'sound-skill' })
  })

  it('accepts an unsigned package only when the deployment allows it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const directory = join(parent, 'unsigned')
    await mkdir(directory, { recursive: true })
    const body = '# unsigned\n\ninstructions.\n'
    await writeFile(join(directory, 'system.md'), body)
    await writeFile(join(directory, 'skill.json'), JSON.stringify({
      id: 'unsigned-skill',
      version: '1.0.0',
      name: 'unsigned',
      description: 'unsigned package',
      roles: [],
      tags: [],
      permissions: { tools: [], network: false },
      compat: { minHarness: '0.1.0' },
      integrity: {
        algo: 'sha256',
        files: { 'system.md': createHash('sha256').update(body).digest('hex') },
      },
    }))

    const warnings: string[] = []
    await expect(loadSignedSkill(directory, {
      ...TRUST,
      allowUnsigned: true,
      warn: (message) => { warnings.push(message) },
    })).resolves.toMatchObject({ signatureVerified: false })
    expect(warnings).toEqual(["unsigned skill 'unsigned-skill' accepted in development mode"])

    // No warning sink is also valid; the acceptance itself is what matters.
    await expect(loadSignedSkill(directory, { ...TRUST, allowUnsigned: true }))
      .resolves.toMatchObject({ signatureVerified: false })
  })

  it('registers on the skill registry through its plugin form', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    await writePackage(parent, 'plugged', { id: 'plugged-skill' })
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SignedSkill, { roots: [parent], ...TRUST })

    await expect(ctx.skills.get('plugged-skill'))
      .resolves.toMatchObject({ name: 'plugged-skill', provider: 'harness-signed' })
    await fiber.dispose()
  })

  it('reports the refused directory on its validation error', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'harness-guard-'))
    const directory = await writePackage(parent, 'reported', { tamperSignature: true })
    const error = await loadSignedSkill(directory, TRUST).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(SignedSkillValidationError)
    expect((error as SignedSkillValidationError).directory).toContain('reported')
    expect((error as SignedSkillValidationError).code).toBe('SIGNED_SKILL_INVALID')
  })
})
