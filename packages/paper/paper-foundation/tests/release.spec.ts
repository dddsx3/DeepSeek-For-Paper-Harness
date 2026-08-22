import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ReleaseVerificationError,
  isInRollout,
  releaseSignaturePayload,
  verifyReleaseArtifacts,
  verifyReleaseManifest,
  type ReleaseManifest,
  type ReleasePolicy,
} from '../src/index.ts'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_DER = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const POLICY: ReleasePolicy = { trustRoots: { 'release-key': PUBLIC_DER }, minHarnessVersion: '0.1.1' }

const BODY = new TextEncoder().encode('artifact bytes')
const BODY_SHA = createHash('sha256').update(BODY).digest('hex')

interface Overrides {
  readonly version?: string
  readonly minHarness?: string
  readonly rolloutFraction?: number
  readonly artifacts?: ReleaseManifest['artifacts']
  readonly unsigned?: boolean
  readonly forge?: boolean
  readonly keyId?: string
}

function manifestFor(overrides: Overrides = {}): ReleaseManifest {
  const manifest = {
    version: overrides.version ?? '1.2.0',
    minHarness: overrides.minHarness ?? '0.1.0',
    artifacts: overrides.artifacts ?? [{ path: 'lib/index.js', sha256: BODY_SHA, bytes: BODY.byteLength }],
    rolloutFraction: overrides.rolloutFraction ?? 1,
    ...overrides.unsigned === true
      ? {}
      : { signature: { algo: 'ed25519' as const, value: '', keyId: overrides.keyId ?? 'release-key' } },
  } satisfies ReleaseManifest
  if (manifest.signature !== undefined) {
    manifest.signature.value = overrides.forge === true
      ? Buffer.from('not the signature bytes at all').toString('base64')
      : sign(null, Buffer.from(releaseSignaturePayload(manifest)), privateKey).toString('base64')
  }
  return manifest
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

describe('release manifest verification', () => {
  it('accepts a signed manifest the deployment can run', () => {
    const verified = verifyReleaseManifest(manifestFor(), POLICY)
    expect(verified.signatureVerified).toBe(true)
    expect(verified.manifest.version).toBe('1.2.0')
  })

  it('refuses anything that is not a manifest', () => {
    for (const raw of [null, 42, {}, { version: 'not-semver' }, { ...manifestFor(), artifacts: [] }]) {
      expect(() => verifyReleaseManifest(raw, POLICY)).toThrow(ReleaseVerificationError)
    }
    expect(() => verifyReleaseManifest({}, POLICY)).toThrow('does not match the manifest schema')
  })

  it('refuses a release that requires a newer harness, and accepts short-form versions', () => {
    expect(() => verifyReleaseManifest(manifestFor({ minHarness: '9.0.0' }), POLICY))
      .toThrow('requires harness 9.0.0 or newer')
    expect(verifyReleaseManifest(manifestFor({ minHarness: '0.1.1' }), POLICY).signatureVerified).toBe(true)
    expect(() => verifyReleaseManifest(manifestFor({ minHarness: '1.2.0' }), { ...POLICY, minHarnessVersion: '1' }))
      .toThrow('or newer')
    expect(verifyReleaseManifest(manifestFor({ minHarness: '0.9' }), { ...POLICY, minHarnessVersion: '1' }))
      .toMatchObject({ signatureVerified: true })
    // A short floor reads its missing segments as zero, so a longer deployed
    // version is newer rather than incomparable.
    expect(verifyReleaseManifest(manifestFor({ minHarness: '1' }), { ...POLICY, minHarnessVersion: '1.0.1' }))
      .toMatchObject({ signatureVerified: true })
  })

  it('refuses an unknown trust root and a forged signature', () => {
    expect(() => verifyReleaseManifest(manifestFor({ keyId: 'other-key' }), POLICY))
      .toThrow("unknown trust root 'other-key'")
    expect(() => verifyReleaseManifest(manifestFor({ forge: true }), POLICY))
      .toThrow('signature did not verify')
  })

  it('accepts an unsigned manifest only in development mode', () => {
    const unsigned = manifestFor({ unsigned: true })
    expect(() => verifyReleaseManifest(unsigned, POLICY)).toThrow('is not signed')

    expect(verifyReleaseManifest(unsigned, { ...POLICY, allowUnsigned: true }))
      .toMatchObject({ signatureVerified: false })

    process.env.NODE_ENV = 'production'
    try {
      expect(() => verifyReleaseManifest(unsigned, { ...POLICY, allowUnsigned: true }))
        .toThrow('refused in production builds')
    } finally {
      if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = ORIGINAL_NODE_ENV
    }
  })

  it('signs a stable payload regardless of key order', () => {
    const manifest = manifestFor()
    const reordered = {
      rolloutFraction: manifest.rolloutFraction,
      artifacts: manifest.artifacts,
      minHarness: manifest.minHarness,
      version: manifest.version,
      signature: manifest.signature,
    } as ReleaseManifest
    expect(releaseSignaturePayload(reordered)).toBe(releaseSignaturePayload(manifest))
    expect(releaseSignaturePayload(manifest)).not.toContain('signature')
  })
})

describe('staged rollout', () => {
  it('offers everything at one and nothing at zero', () => {
    expect(isInRollout('install-a', '1.0.0', 1)).toBe(true)
    expect(isInRollout('install-a', '1.0.0', 1.5)).toBe(true)
    expect(isInRollout('install-a', '1.0.0', 0)).toBe(false)
    expect(isInRollout('install-a', '1.0.0', -1)).toBe(false)
  })

  it('is stable per install and version, and splits the population in between', () => {
    const first = isInRollout('install-a', '1.0.0', 0.5)
    expect(isInRollout('install-a', '1.0.0', 0.5)).toBe(first)

    const installs = Array.from({ length: 400 }, (_value, index) => `install-${index}`)
    const included = installs.filter(id => isInRollout(id, '1.0.0', 0.5)).length
    // A hash-bucketed half should land near half, not at either extreme.
    expect(included).toBeGreaterThan(120)
    expect(included).toBeLessThan(280)

    // A different version re-draws the bucket, so a held-back install can be
    // offered the next release.
    const heldBack = installs.find(id => !isInRollout(id, '1.0.0', 0.5)) as string
    const versions = ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0']
    expect(versions.some(version => isInRollout(heldBack, version, 0.5))).toBe(true)
  })
})

describe('release artifact verification', () => {
  it('accepts artifacts whose bytes match their recorded hash and size', async () => {
    await expect(verifyReleaseArtifacts(manifestFor(), () => Promise.resolve(BODY))).resolves.toBeUndefined()
  })

  it('refuses a wrong size before it hashes, and a wrong hash after', async () => {
    const shorter = new TextEncoder().encode('short')
    await expect(verifyReleaseArtifacts(manifestFor(), () => Promise.resolve(shorter)))
      .rejects.toThrow('has 5 bytes, not 14')

    const sameLength = new TextEncoder().encode('artifact BYTES')
    expect(sameLength.byteLength).toBe(BODY.byteLength)
    await expect(verifyReleaseArtifacts(manifestFor(), () => Promise.resolve(sameLength)))
      .rejects.toThrow('does not match its recorded hash')
  })
})
