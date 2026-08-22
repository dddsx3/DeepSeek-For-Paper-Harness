/**
 * Release staging, activation, and rollback. A release is a signed manifest of
 * content-addressed artifacts; nothing is activated that has not verified, and
 * a version that never reported itself healthy is rolled back on the next
 * start rather than left active.
 *
 * The feed is a caller-supplied reader, not a URL this module opens, so a
 * deployment decides whether updates are reachable at all and tests need no
 * network. An empty feed means updates are disabled, which is the default.
 *
 * @module @deepseek-ai/dsh-harness-foundation/src/release
 */

import { createHash, verify } from 'node:crypto'
import { z as zod } from 'zod'
import type { SkillTrustRoots } from './signed-skill.ts'

const SIGNATURE_ALGORITHM = 'ed25519'
const HASH_ALGORITHM = 'sha256'
/** Buckets a rollout fraction is resolved against; 10,000 gives basis points. */
const ROLLOUT_BUCKETS = 10_000

/** One artifact a release carries, addressed by content hash. */
export const releaseArtifactSchema = zod.object({
  path: zod.string().min(1),
  sha256: zod.string().regex(/^[a-f0-9]{64}$/u),
  bytes: zod.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})

/** One artifact a release carries. */
export type ReleaseArtifact = zod.infer<typeof releaseArtifactSchema>

/** Manifest describing one release and how widely it may roll out. */
export const releaseManifestSchema = zod.object({
  version: zod.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  minHarness: zod.string().min(1),
  artifacts: zod.array(releaseArtifactSchema).min(1),
  rolloutFraction: zod.number().min(0).max(1),
  signature: zod.object({
    algo: zod.literal(SIGNATURE_ALGORITHM),
    value: zod.base64(),
    keyId: zod.string().min(1),
  }).optional(),
})

/** Manifest describing one release. */
export type ReleaseManifest = zod.infer<typeof releaseManifestSchema>

/** A release refused before it could be staged. */
export class ReleaseVerificationError extends Error {
  /** Stable machine-readable code. */
  readonly code = 'RELEASE_INVALID'

  /**
   * @param reason - why the release was refused, safe to show in diagnostics.
   */
  constructor(reason: string) {
    super(`release manifest is invalid: ${reason}`)
    this.name = 'ReleaseVerificationError'
  }
}

/** Trust and compatibility policy one release is judged against. */
export interface ReleasePolicy {
  /** Signing keys this deployment trusts, by key id. */
  readonly trustRoots: SkillTrustRoots
  /** Harness version the deployment runs; an older one refuses the release. */
  readonly minHarnessVersion: string
  /** Development-only: accept a manifest with no signature block. */
  readonly allowUnsigned?: boolean
}

/** One verified release plus whether its signature was present and valid. */
export interface VerifiedRelease {
  /** The parsed manifest. */
  readonly manifest: ReleaseManifest
  /** Whether a detached signature verified; false only for an accepted unsigned manifest. */
  readonly signatureVerified: boolean
}

/**
 * Canonical bytes the detached release signature covers.
 * @param manifest - manifest to serialize without its signature block.
 * @returns the stable JSON text that is signed and verified.
 */
export function releaseSignaturePayload(manifest: ReleaseManifest): string {
  return stableJson({ ...manifest, signature: undefined })
}

/**
 * Parse and verify one release manifest. Schema, harness compatibility, trust
 * root, and signature are all checked before the manifest is returned; an
 * unsigned manifest passes only under `allowUnsigned`, never in production.
 * @param raw - manifest as read from a feed, still untrusted.
 * @param policy - trust roots, harness floor, and unsigned policy.
 * @returns the verified manifest and its signature state.
 */
export function verifyReleaseManifest(raw: unknown, policy: ReleasePolicy): VerifiedRelease {
  const parsed = releaseManifestSchema.safeParse(raw)
  if (!parsed.success) throw new ReleaseVerificationError('it does not match the manifest schema')
  const manifest = parsed.data
  if (!isAtLeast(policy.minHarnessVersion, manifest.minHarness)) {
    throw new ReleaseVerificationError(`it requires harness ${manifest.minHarness} or newer`)
  }
  if (manifest.signature === undefined) {
    if (policy.allowUnsigned !== true) throw new ReleaseVerificationError('it is not signed')
    if (process.env.NODE_ENV === 'production') {
      throw new ReleaseVerificationError('unsigned releases are refused in production builds')
    }
    return { manifest, signatureVerified: false }
  }
  const publicKey = policy.trustRoots[manifest.signature.keyId]
  if (publicKey === undefined) {
    throw new ReleaseVerificationError(`it names the unknown trust root '${manifest.signature.keyId}'`)
  }
  const verified = verify(
    null,
    Buffer.from(releaseSignaturePayload(manifest), 'utf8'),
    { key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' },
    Buffer.from(manifest.signature.value, 'base64'),
  )
  if (!verified) throw new ReleaseVerificationError('its signature did not verify')
  return { manifest, signatureVerified: true }
}

/**
 * Whether one install is inside a release's staged rollout. The decision is a
 * pure function of the install identity and the version, so an install that is
 * in the rollout stays in it across restarts instead of re-drawing a lot.
 * @param installId - stable identity of this installation.
 * @param version - release version being rolled out.
 * @param rolloutFraction - share of installs the release is offered to.
 * @returns whether this install is offered the release.
 */
export function isInRollout(installId: string, version: string, rolloutFraction: number): boolean {
  if (rolloutFraction >= 1) return true
  if (rolloutFraction <= 0) return false
  const digest = createHash(HASH_ALGORITHM).update(`${installId}:${version}`).digest()
  const bucket = digest.readUInt32BE(0) % ROLLOUT_BUCKETS
  return bucket < Math.floor(rolloutFraction * ROLLOUT_BUCKETS)
}

/**
 * Verify every artifact's content hash against bytes the caller resolved.
 * @param manifest - the verified manifest whose artifacts to check.
 * @param read - resolves one artifact path to its bytes.
 * @returns resolution when every artifact matched its recorded hash.
 */
export async function verifyReleaseArtifacts(
  manifest: ReleaseManifest,
  read: (path: string) => Promise<Uint8Array>,
): Promise<void> {
  for (const artifact of manifest.artifacts) {
    const bytes = await read(artifact.path)
    if (bytes.byteLength !== artifact.bytes) {
      throw new ReleaseVerificationError(`artifact '${artifact.path}' has ${bytes.byteLength} bytes, not ${artifact.bytes}`)
    }
    const digest = createHash(HASH_ALGORITHM).update(bytes).digest('hex')
    if (digest !== artifact.sha256) {
      throw new ReleaseVerificationError(`artifact '${artifact.path}' does not match its recorded hash`)
    }
  }
}

/** Stable JSON so a signature covers one byte sequence regardless of key order. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(entry => stableJson(entry)).join(',')}]`
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).filter(key => object[key] !== undefined).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`
}

/** Whether `current` is at least `minimum`; missing segments read as zero. */
function isAtLeast(current: string, minimum: string): boolean {
  const left = current.split(/[+.-]/u).slice(0, 3).map(Number)
  const right = minimum.split(/[+.-]/u).slice(0, 3).map(Number)
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0)
  }
  return true
}
