import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  DEFAULT_RELEASE_HARNESS_VERSION,
  PaperAuditService,
  PaperReleaseService,
  ReleaseVerificationError,
  isInRollout,
  releaseSignaturePayload,
  resolveReleasePolicy,
  type ReleaseManifest,
  type SkillTrustRoots,
} from '../src/index.ts'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_DER = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const BODY_SHA = createHash('sha256').update('release body').digest('hex')

function manifestFor(version: string, rolloutFraction = 1, unsigned = false): ReleaseManifest {
  const manifest = {
    version,
    minHarness: '0.1.0',
    artifacts: [{ path: 'lib/index.js', sha256: BODY_SHA, bytes: 12 }],
    rolloutFraction,
    ...unsigned ? {} : { signature: { algo: 'ed25519' as const, value: '', keyId: 'release-key' } },
  } satisfies ReleaseManifest
  if (manifest.signature !== undefined) {
    manifest.signature.value = sign(null, Buffer.from(releaseSignaturePayload(manifest)), privateKey).toString('base64')
  }
  return manifest
}

interface HarnessOptions {
  readonly pool?: MemoryMediaPool
  readonly audit?: boolean
  readonly allowUnsigned?: boolean
  readonly trustRoots?: SkillTrustRoots
}

async function harness(options: HarnessOptions = {}) {
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  if (options.audit !== false) await ctx.plugin(PaperAuditService, {})
  const fiber = await ctx.plugin(PaperReleaseService, {
    trustRoots: options.trustRoots ?? { 'release-key': PUBLIC_DER },
    harnessVersion: '0.1.1',
    ...options.allowUnsigned === undefined ? {} : { allowUnsigned: options.allowUnsigned },
  })
  return { ctx, fiber, pool, release: ctx.paperRelease }
}

describe('PaperReleaseService staging', () => {
  it('mints one stable install id and keeps it across restarts', async () => {
    const first = await harness()
    const installId = first.release.installId
    expect(installId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(first.release.installId).toBe(installId)
    await first.fiber.dispose()

    const second = await harness({ pool: first.pool })
    expect(second.release.installId).toBe(installId)
    await second.fiber.dispose()
  })

  it('stages a verified release once and audits it', async () => {
    const { ctx, fiber, release } = await harness()
    const record = await release.stage(manifestFor('1.1.0'))
    expect(record).toMatchObject({ version: '1.1.0', activatedAt: null, healthyAt: null, signatureOk: true })

    // Staging the same version again is the recorded stage, not a second one.
    expect(await release.stage(manifestFor('1.1.0'))).toEqual(record)
    expect(release.list()).toHaveLength(1)
    expect(ctx.paperAudit.list().map(entry => entry.eventType)).toEqual(['release_staged'])
    await fiber.dispose()
  })

  it('refuses a release this install is not yet offered', async () => {
    const { fiber, release } = await harness()
    const heldBack = ['2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0']
      .find(version => !isInRollout(release.installId, version, 0.001))
    expect(heldBack).toBeDefined()
    await expect(release.stage(manifestFor(heldBack as string, 0.001)))
      .rejects.toThrow('is not offered to this install yet')
    expect(release.list()).toHaveLength(0)
    await fiber.dispose()
  })

  it('refuses an unverifiable release before staging it', async () => {
    const { fiber, release } = await harness()
    await expect(release.stage({ version: 'nope' })).rejects.toBeInstanceOf(ReleaseVerificationError)
    await expect(release.stage(manifestFor('3.0.0', 1, true))).rejects.toThrow('is not signed')
    expect(release.list()).toHaveLength(0)
    await fiber.dispose()
  })

  it('records an accepted unsigned release as unverified', async () => {
    const { fiber, release } = await harness({ allowUnsigned: true })
    const record = await release.stage(manifestFor('1.0.0', 1, true))
    expect(record.signatureOk).toBe(false)
    await fiber.dispose()
  })

  it('works without an audit trail in the composition', async () => {
    const { fiber, release } = await harness({ audit: false })
    await expect(release.stage(manifestFor('1.0.0'))).resolves.toMatchObject({ version: '1.0.0' })
    await fiber.dispose()
  })
})

describe('PaperReleaseService activation and health', () => {
  it('activates a staged version, remembers its predecessor, and confirms health', async () => {
    const { ctx, fiber, release } = await harness()
    await release.stage(manifestFor('1.0.0'))
    await release.stage(manifestFor('1.1.0'))
    expect(release.list().map(record => record.version)).toHaveLength(2)

    const first = await release.activate('1.0.0')
    expect(first.activatedAt).not.toBeNull()
    expect(release.startupState).toEqual({ activeVersion: null, rolledBack: false })

    expect((await release.confirmHealthy())?.healthyAt).not.toBeNull()
    // Confirming twice keeps the first confirmation rather than restamping it.
    const confirmed = await release.confirmHealthy()
    const again = await release.confirmHealthy()
    expect(again?.healthyAt).toBe(confirmed?.healthyAt)

    await release.activate('1.1.0')
    expect(ctx.paperAudit.list().filter(entry => entry.eventType === 'release_activated')).toHaveLength(2)
    await fiber.dispose()
  })

  it('refuses to activate a version that was never staged', async () => {
    const { fiber, release } = await harness()
    await expect(release.activate('9.9.9')).rejects.toThrow('was not staged')
    await fiber.dispose()
  })

  it('reports no health confirmation when nothing is active or the record is gone', async () => {
    const { ctx, fiber, release } = await harness()
    expect(await release.confirmHealthy()).toBeUndefined()

    await release.stage(manifestFor('1.0.0'))
    await release.activate('1.0.0')
    // A record deleted underneath the active pointer leaves nothing to confirm.
    await ctx.storageDomain.get('paper_releases')?.table('staged').delete('1.0.0')
    expect(await release.confirmHealthy()).toBeUndefined()
    await fiber.dispose()
  })

  it('re-activating the active version keeps its recorded predecessor', async () => {
    const { fiber, release } = await harness()
    await release.stage(manifestFor('1.0.0'))
    await release.stage(manifestFor('1.1.0'))
    await release.activate('1.0.0')
    await release.activate('1.1.0')
    await release.activate('1.1.0')

    // The predecessor is still 1.0.0, so a rollback returns there.
    await expect(release.rollback()).resolves.toBe('1.0.0')
    await fiber.dispose()
  })
})

describe('PaperReleaseService rollback', () => {
  it('returns to the recorded predecessor and audits the move', async () => {
    const { ctx, fiber, release } = await harness()
    await release.stage(manifestFor('1.0.0'))
    await release.stage(manifestFor('1.1.0'))
    await release.activate('1.0.0')
    await release.confirmHealthy()
    await release.activate('1.1.0')

    await expect(release.rollback()).resolves.toBe('1.0.0')
    expect(ctx.paperAudit.list().filter(entry => entry.eventType === 'release_rollback')).toHaveLength(1)
    await fiber.dispose()
  })

  it('refuses a rollback with no predecessor or an unstaged target', async () => {
    const { fiber, release } = await harness()
    await expect(release.rollback()).rejects.toThrow('no previous release is recorded')
    await release.stage(manifestFor('1.0.0'))
    await release.activate('1.0.0')
    await expect(release.rollback('9.9.9')).rejects.toThrow('was not staged')
    await fiber.dispose()
  })

  it('rolls back an active version that never reported healthy on the next start', async () => {
    const first = await harness()
    await first.release.stage(manifestFor('1.0.0'))
    await first.release.stage(manifestFor('1.1.0'))
    await first.release.activate('1.0.0')
    await first.release.confirmHealthy()
    await first.release.activate('1.1.0')
    await first.fiber.dispose()

    const second = await harness({ pool: first.pool })
    expect(second.release.startupState).toEqual({ activeVersion: '1.0.0', rolledBack: true })
    expect(second.ctx.paperAudit.list().some(entry => entry.eventType === 'release_rollback')).toBe(true)
    await second.fiber.dispose()
  })

  it('leaves a healthy active version alone on the next start', async () => {
    const first = await harness()
    await first.release.stage(manifestFor('1.0.0'))
    await first.release.activate('1.0.0')
    await first.release.confirmHealthy()
    await first.fiber.dispose()

    const second = await harness({ pool: first.pool })
    expect(second.release.startupState).toEqual({ activeVersion: '1.0.0', rolledBack: false })
    await second.fiber.dispose()
  })

  it('keeps an unproven first release active when it has no predecessor', async () => {
    const first = await harness()
    await first.release.stage(manifestFor('1.0.0'))
    await first.release.activate('1.0.0')
    await first.fiber.dispose()

    const second = await harness({ pool: first.pool })
    expect(second.release.startupState).toEqual({ activeVersion: '1.0.0', rolledBack: false })
    await second.fiber.dispose()
  })

  it('keeps the pointer when the active record vanished before the restart', async () => {
    const first = await harness()
    await first.release.stage(manifestFor('1.0.0'))
    await first.release.stage(manifestFor('1.1.0'))
    await first.release.activate('1.0.0')
    await first.release.activate('1.1.0')
    await first.ctx.storageDomain.get('paper_releases')?.table('staged').delete('1.1.0')
    await first.fiber.dispose()

    const second = await harness({ pool: first.pool })
    expect(second.release.startupState).toEqual({ activeVersion: '1.1.0', rolledBack: false })
    await second.fiber.dispose()
  })
})

describe('PaperReleaseService lifecycle guards', () => {
  it('refuses every operation before initialization', async () => {
    const service = new PaperReleaseService(new Context())
    expect(() => service.list()).toThrow('not initialized')
    expect(() => service.installId).toThrow('not initialized')
    expect(() => service.startupState).toThrow('not initialized')
    await expect(service.rollback('1.0.0')).rejects.toThrow('not initialized')
  })

  it('refuses reads once its domain is closed', async () => {
    const { fiber, release } = await harness()
    await fiber.dispose()
    expect(() => release.list()).toThrow('not initialized')
  })

  it('resolves its policy defaults when a composition names none', () => {
    // No trust root by default, so every signed release is refused until a
    // deployment names a key.
    expect(resolveReleasePolicy({})).toEqual({
      trustRoots: {},
      minHarnessVersion: DEFAULT_RELEASE_HARNESS_VERSION,
    })
    expect(resolveReleasePolicy({ trustRoots: { k: PUBLIC_DER }, harnessVersion: '9.0.0', allowUnsigned: true }))
      .toEqual({ trustRoots: { k: PUBLIC_DER }, minHarnessVersion: '9.0.0', allowUnsigned: true })
  })

  it('refuses a release signed by a key the deployment does not trust', async () => {
    const { fiber, release } = await harness({ trustRoots: {} })
    await expect(release.stage(manifestFor('1.0.0'))).rejects.toThrow('unknown trust root')
    await fiber.dispose()
  })
})
