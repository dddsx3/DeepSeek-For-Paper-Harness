import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  PaperAuditService,
  REDACTED,
  redactSensitiveDetail,
  redactSensitiveText,
  redactSensitiveValue,
} from '../src/index.ts'

async function auditHarness(retentionDays = 90, pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(PaperAuditService, { retentionDays })
  return { ctx, fiber, audit: ctx.paperAudit }
}

describe('redaction', () => {
  it('masks labeled, bearer, and prefixed credential material in text', () => {
    expect(redactSensitiveText('api_key: sk-abcdefghijklmnopqrstuvwx'))
      .toBe(`api_key: ${REDACTED}`)
    expect(redactSensitiveText('authorization: Bearer abcdefghijklmnop'))
      .toBe(`authorization: Bearer ${REDACTED}`)
    expect(redactSensitiveText('use sk-1234567890abcdef in the call'))
      .toBe(`use ${REDACTED} in the call`)
    expect(redactSensitiveText('token=abcdefghijkl and secret="mnopqrstuvwx"'))
      .toBe(`token=${REDACTED} and secret="${REDACTED}"`)
  })

  it('leaves ordinary prose and short values untouched', () => {
    const prose = 'the reviewer found two defects in section 3'
    expect(redactSensitiveText(prose)).toBe(prose)
    expect(redactSensitiveText('token=short')).toBe('token=short')
  })

  it('masks credential-bearing keys at every depth and refuses to follow cycles', () => {
    const cyclic: Record<string, unknown> = { name: 'run' }
    cyclic.self = cyclic
    expect(redactSensitiveValue(cyclic)).toEqual({ name: 'run', self: REDACTED })

    expect(redactSensitiveValue({
      provider: 'deepseek-official',
      apiKey: 'sk-abcdefghijklmnopqrst',
      nested: { authorization: 'Bearer abcdefghijklmnop', executor_api_key: 'plain-value', keep: 42 },
      list: [{ access_token: 'abcdefghijkl' }, 'note'],
    })).toEqual({
      provider: 'deepseek-official',
      apiKey: REDACTED,
      nested: { authorization: REDACTED, executor_api_key: REDACTED, keep: 42 },
      list: [{ access_token: REDACTED }, 'note'],
    })
  })

  it('replaces structure past the depth ceiling and drops non-JSON values', () => {
    let deep: Record<string, unknown> = { leaf: 'end' }
    for (let level = 0; level < 12; level += 1) deep = { level, next: deep }
    expect(JSON.stringify(redactSensitiveValue(deep))).toContain(REDACTED)

    expect(redactSensitiveValue({ fn: () => 'x', sym: Symbol('s'), ok: 1 }))
      .toEqual({ fn: null, sym: null, ok: 1 })
  })

  it('redacts detail maps without dropping their keys', () => {
    expect(redactSensitiveDetail({ token: 'abcdefghijkl', mode: 'strict', note: 'api_key: sk-abcdefghijklmnop' }))
      .toEqual({ token: REDACTED, mode: 'strict', note: `api_key: ${REDACTED}` })
  })
})

describe('PaperAuditService restart', () => {
  it('resumes the append sequence past the highest persisted entry', async () => {
    const pool = new MemoryMediaPool()
    const first = await auditHarness(90, pool)
    await first.audit.record({ eventType: 'workflow_started', actor: 'paper-executor', runId: 'run-1' })
    await first.audit.record({ eventType: 'workflow_completed', actor: 'paper-executor', runId: 'run-1' })
    expect(first.audit.list().map(entry => entry.seq)).toEqual([1, 2])
    await first.fiber.dispose()

    // A restart over the same medium must not reuse an order position.
    const second = await auditHarness(90, pool)
    const resumed = await second.audit.record({
      eventType: 'workflow_started', actor: 'paper-executor', runId: 'run-2',
    })
    expect(resumed.seq).toBe(3)
    expect(second.audit.list().map(entry => entry.seq)).toEqual([1, 2, 3])
    await second.fiber.dispose()
  })
})

describe('PaperAuditService', () => {
  it('records redacted entries in chronological order and filters by run', async () => {
    const { fiber, audit } = await auditHarness()
    const first = await audit.record({
      eventType: 'workflow_started',
      actor: 'paper-executor',
      runId: 'run-a',
      detail: { mode: 'strict', apiKey: 'sk-abcdefghijklmnopqrst' },
    })
    await audit.record({ eventType: 'gate_failed', actor: 'paper-executor', runId: 'run-b', detail: { defects: 2 } })
    await audit.record({ eventType: 'workflow_completed', actor: 'paper-executor', runId: 'run-a' })

    expect(first.detail).toEqual({ mode: 'strict', apiKey: REDACTED })
    expect(JSON.stringify(audit.list())).not.toContain('sk-abcdefghijklmnopqrst')
    expect(audit.list().map(entry => entry.eventType))
      .toEqual(['workflow_started', 'gate_failed', 'workflow_completed'])
    expect(audit.list('run-a').map(entry => entry.eventType))
      .toEqual(['workflow_started', 'workflow_completed'])
    expect(audit.list('run-b')).toHaveLength(1)
    expect(first.runId).toBe('run-a')
    await fiber.dispose()
  })

  it('records a null run for host-scoped operations', async () => {
    const { fiber, audit } = await auditHarness()
    const entry = await audit.record({ eventType: 'settings_changed', actor: 'operator' })
    expect(entry.runId).toBeNull()
    const explicit = await audit.record({ eventType: 'settings_changed', actor: 'operator', runId: null })
    expect(explicit.runId).toBeNull()
    expect(entry.detail).toEqual({})
    await fiber.dispose()
  })

  it('prunes entries past the retention window on the next write', async () => {
    const { ctx, fiber, audit } = await auditHarness(1)
    const domain = ctx.storageDomain.get('paper_audit')
    expect(domain).toBeDefined()
    const stale = {
      id: '00000000-0000-4000-8000-000000000001',
      ts: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      runId: 'run-old',
      actor: 'paper-executor',
      eventType: 'workflow_completed' as const,
      detail: {},
    }
    await domain?.table('entries').put(`${stale.ts}:${stale.id}`, stale)
    expect(audit.list()).toHaveLength(1)

    await audit.record({ eventType: 'workflow_started', actor: 'paper-executor', runId: 'run-new' })
    expect(audit.list().map(entry => entry.runId)).toEqual(['run-new'])
    await fiber.dispose()
  })
})
