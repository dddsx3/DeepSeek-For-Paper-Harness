/** Signed Harness skill-package validation and provider integration. */

import { createHash, verify } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  BUNDLED_SKILL_RANK,
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillLookupOptions,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { z as zod } from 'zod'

const PACKAGE_FILE_NAMES = ['system.md', 'tools.json'] as const
const PROVIDER_NAME = 'harness-signed'
const HASH_ALGORITHM = 'sha256'
const SIGNATURE_ALGORITHM = 'ed25519'

/** Manifest metadata for one signed skill package. */
export interface SignedSkillManifest {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly roles: readonly string[]
  readonly tags: readonly string[]
  readonly permissions: {
    readonly tools: readonly string[]
    readonly network: boolean
  }
  readonly compat: { readonly minHarness: string }
  readonly integrity: {
    readonly algo: 'sha256'
    readonly files: Readonly<Record<string, string>>
  }
  readonly signature?: {
    readonly algo: 'ed25519'
    readonly value: string
    readonly keyId: string
  }
}

/** Trust roots map key identifiers to Ed25519 public keys in base64 form. */
export type SkillTrustRoots = Readonly<Record<string, string>>

/** Provider configuration. */
export interface SignedSkillProviderConfig {
  readonly roots: string[]
  readonly minHarnessVersion: string
  readonly trustRoots: SkillTrustRoots
  /** Development-only: accept unsigned packages with a warning; refused in production builds. */
  readonly allowUnsigned?: boolean
}

/** Options controlling one package load. */
export interface LoadSignedSkillOptions {
  readonly minHarnessVersion: string
  readonly trustRoots: SkillTrustRoots
  /** Development-only: accept packages without a signature block. */
  readonly allowUnsigned?: boolean
  /** Optional warning sink used when an unsigned package is accepted. */
  readonly warn?: (message: string) => void
}

/** Schemastery configuration for plugin loading. */
export const SignedSkillConfig: z<SignedSkillProviderConfig> = z.object({
  roots: z.array(z.string()).required(),
  minHarnessVersion: z.string().required(),
  trustRoots: z.dict(z.string()).required(),
  allowUnsigned: z.boolean().default(false),
})

const manifestSchema = zod.object({
  id: zod.string().min(1),
  version: zod.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  name: zod.string().min(1),
  description: zod.string().min(1),
  roles: zod.array(zod.string()),
  tags: zod.array(zod.string()),
  permissions: zod.object({ tools: zod.array(zod.string()), network: zod.boolean() }),
  compat: zod.object({ minHarness: zod.string().min(1) }),
  integrity: zod.object({
    algo: zod.literal(HASH_ALGORITHM),
    files: zod.record(zod.string(), zod.string().regex(/^[a-f0-9]{64}$/u)),
  }),
  signature: zod.object({
    algo: zod.literal(SIGNATURE_ALGORITHM),
    value: zod.base64(),
    keyId: zod.string().min(1),
  }).optional(),
})

/** Error raised when a package fails trust, compatibility, or content checks. */
export class SignedSkillValidationError extends Error {
  /** Stable machine-readable code. */
  readonly code = 'SIGNED_SKILL_INVALID'

  /**
   * @param directory - Package directory being rejected.
   * @param reason - Validation reason safe to show in diagnostics.
   */
  constructor(readonly directory: string, reason: string) {
    super(`signed skill package '${directory}' is invalid: ${reason}`)
    this.name = 'SignedSkillValidationError'
  }
}

/** Validated package loaded from disk. */
export interface ValidatedSignedSkill {
  readonly directory: string
  readonly manifest: SignedSkillManifest
  readonly systemContent: string
  /** Tool names declared by tools.json, in declaration order. */
  readonly declaredTools: readonly string[]
  /** Whether the detached signature was present and verified. */
  readonly signatureVerified: boolean
}

/**
 * Load one signed package from a directory, checking every declared file and
 * the detached Ed25519 signature before returning its body. An unsigned
 * package loads only when `allowUnsigned` is set, is refused in production
 * builds, and reports through `warn`.
 * @param directory - Package directory containing skill.json.
 * @param options - trust roots, compatibility floor, and unsigned policy.
 * @returns validated package.
 */
export async function loadSignedSkill(
  directory: string,
  options: LoadSignedSkillOptions,
): Promise<ValidatedSignedSkill> {
  const absolute = resolve(directory)
  let rawManifest: unknown
  try {
    rawManifest = JSON.parse(await readFile(join(absolute, 'skill.json'), 'utf8'))
  } catch (error) {
    throw new SignedSkillValidationError(absolute, `cannot read skill.json: ${String(error)}`)
  }
  const parsed = manifestSchema.safeParse(rawManifest)
  if (!parsed.success) throw new SignedSkillValidationError(absolute, 'skill.json does not match the manifest schema')
  const manifest = parsed.data as SignedSkillManifest
  if (!isSkillName(manifest.id)) throw new SignedSkillValidationError(absolute, `invalid skill id '${manifest.id}'`)
  if (!isCompatibleVersion(options.minHarnessVersion, manifest.compat.minHarness)) {
    throw new SignedSkillValidationError(absolute, `requires harness ${manifest.compat.minHarness} or newer`)
  }

  let signatureVerified = false
  if (manifest.signature === undefined) {
    if (options.allowUnsigned === true) {
      if (process.env.NODE_ENV === 'production') {
        throw new SignedSkillValidationError(absolute, 'unsigned skill packages are refused in production builds')
      }
      options.warn?.(`unsigned skill '${manifest.id}' accepted in development mode`)
    } else {
      throw new SignedSkillValidationError(absolute, 'package is not signed')
    }
  } else {
    const publicKey = options.trustRoots[manifest.signature.keyId]
    if (publicKey === undefined) throw new SignedSkillValidationError(absolute, `unknown trust root '${manifest.signature.keyId}'`)
    const signatureBytes = Buffer.from(manifest.signature.value, 'base64')
    signatureVerified = verify(
      null,
      Buffer.from(signaturePayload(manifest), 'utf8'),
      { key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' },
      signatureBytes,
    )
    if (!signatureVerified) throw new SignedSkillValidationError(absolute, 'signature verification failed')
  }

  const contentHashes: Record<string, string> = {}
  for (const [relative, expected] of Object.entries(manifest.integrity.files)) {
    if (!PACKAGE_FILE_NAMES.includes(relative as typeof PACKAGE_FILE_NAMES[number])) {
      throw new SignedSkillValidationError(absolute, `integrity references unsupported file '${relative}'`)
    }
    const bytes = await readFile(join(absolute, relative))
    const actual = createHash(HASH_ALGORITHM).update(bytes).digest('hex')
    if (actual !== expected) throw new SignedSkillValidationError(absolute, `hash mismatch for '${relative}'`)
    contentHashes[relative] = actual
  }
  if (contentHashes['system.md'] === undefined) {
    throw new SignedSkillValidationError(absolute, 'integrity must cover system.md')
  }

  return {
    directory: absolute,
    manifest,
    systemContent: await readFile(join(absolute, 'system.md'), 'utf8'),
    declaredTools: await readDeclaredTools(absolute, manifest),
    signatureVerified,
  }
}

/** Parse the declared tool names from tools.json when integrity covers it. */
async function readDeclaredTools(directory: string, manifest: SignedSkillManifest): Promise<string[]> {
  if (!Object.hasOwn(manifest.integrity.files, 'tools.json')) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(directory, 'tools.json'), 'utf8'))
  } catch (error) {
    throw new SignedSkillValidationError(directory, `cannot parse tools.json: ${String(error)}`)
  }
  const tools = (parsed as { tools?: unknown }).tools
  if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string' || tool.length === 0)) {
    throw new SignedSkillValidationError(directory, 'tools.json must declare a non-empty string array under "tools"')
  }
  return tools as string[]
}

/** Provider that exposes validated package directories through `ctx.skills`. */
export class SignedSkillProvider implements SkillProvider {
  readonly name = PROVIDER_NAME
  private readonly roots: readonly string[]
  private readonly options: Pick<LoadSignedSkillOptions, 'minHarnessVersion' | 'trustRoots' | 'allowUnsigned'>

  /**
   * @param config - Package roots and trust policy.
   */
  constructor(config: SignedSkillProviderConfig) {
    this.roots = config.roots.map(root => resolve(root))
    this.options = {
      minHarnessVersion: config.minHarnessVersion,
      trustRoots: config.trustRoots,
      ...config.allowUnsigned === undefined ? {} : { allowUnsigned: config.allowUnsigned },
    }
  }

  /** @inheritdoc */
  async list(): Promise<readonly SkillCandidate[]> {
    const candidates: SkillCandidate[] = []
    for (const root of this.roots) {
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const directory = join(root, entry.name)
        try {
          const loaded = await loadSignedSkill(directory, this.options)
          candidates.push(candidateOf(loaded))
        } catch {
          // Invalid packages are omitted from the catalog; explicit get() reports the rejection.
        }
      }
    }
    return candidates
  }

  /** @inheritdoc */
  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (typeof candidate.locator !== 'string') return undefined
    const loaded = await loadSignedSkill(candidate.locator, this.options)
    return {
      ...candidate,
      content: loaded.systemContent,
      metadata: {
        version: loaded.manifest.version,
        roles: [...loaded.manifest.roles],
        tags: [...loaded.manifest.tags],
        permissions: loaded.manifest.permissions,
      },
    }
  }
}

/** Cordis plugin name. */
export const name = 'harness-signed-skill'
/** The provider requires the existing skill registry. */
export const inject = ['skills']

/** Register the signed provider into the existing skill registry. */
export function apply(ctx: Context, config: SignedSkillProviderConfig): void {
  const provider = new SignedSkillProvider(config)
  ctx.skills.registerProvider(() => provider)
}

/**
 * Canonical bytes the detached package signature covers.
 * @param manifest - manifest to serialize without its signature block.
 * @returns the stable JSON text that is signed and verified.
 */
export function signaturePayload(manifest: SignedSkillManifest): string {
  const unsigned = { ...manifest, signature: undefined }
  return stableJson(unsigned)
}

function candidateOf(skill: ValidatedSignedSkill): SkillCandidate {
  return {
    name: skill.manifest.id,
    description: skill.manifest.description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: PROVIDER_NAME,
    resourceBase: { kind: 'directory', path: skill.directory },
    rank: BUNDLED_SKILL_RANK,
    locator: skill.directory,
    path: join(skill.directory, 'system.md'),
    metadata: { version: skill.manifest.version, tags: [...skill.manifest.tags] },
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
}

function isCompatibleVersion(current: string, minimum: string): boolean {
  const left = current.split(/[+.-]/u).slice(0, 3).map(Number)
  const right = minimum.split(/[+.-]/u).slice(0, 3).map(Number)
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0)
  }
  return true
}
