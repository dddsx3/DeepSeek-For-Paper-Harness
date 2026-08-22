/**
 * paper domain coverage over the real service composition: runs and skills
 * RPCs run against the durable engine and catalog with no network and no
 * scripted impl — every assertion exercises createApiProxy's paper block.
 */

import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import {
  PaperFoundationService,
  SkillCatalogService,
  RunId,
  WorkflowEngineService,
  signaturePayload,
  type SignedSkillManifest,
} from '@deepseek-ai/dsh-paper-foundation'
import { createApiProxy, RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ApiProxy, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_DER = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
let requestCounter = 0

function request<P>(payload: P): RpcRequest<P> {
  requestCounter += 1
  return { rpcId: RpcId(`paper-${requestCounter}`), payload }
}

async function writePackage(parent: string, id: string, version: string): Promise<string> {
  const directory = join(parent, `${id}-${version}`)
  await mkdir(directory, { recursive: true })
  const body = `# ${id}\n\n${version} body.\n`
  const tools = '{"tools":[]}\n'
  await writeFile(join(directory, 'system.md'), body)
  await writeFile(join(directory, 'tools.json'), tools)
  const manifest = {
    id,
    version,
    name: id,
    description: `${id} description`,
    roles: ['executor'],
    tags: [],
    permissions: { tools: [], network: false },
    compat: { minHarness: '0.1.0' },
    integrity: {
      algo: 'sha256' as const,
      files: {
        'system.md': createHash('sha256').update(body).digest('hex'),
        'tools.json': createHash('sha256').update(tools).digest('hex'),
      },
    },
    signature: { algo: 'ed25519' as const, value: '', keyId: 'test-key' },
  } satisfies SignedSkillManifest
  manifest.signature.value = sign(null, Buffer.from(signaturePayload(manifest)), privateKey).toString('base64')
  await writeFile(join(directory, 'skill.json'), JSON.stringify(manifest))
  return directory
}

/** Mount only the services createApiProxy touches at construction, no Paper services. */
async function bareHarness() {
  const parent = await mkdtemp(join(tmpdir(), 'apiproxy-bare-'))
  const ctx = new Context()
  await ctx.plugin(UserQuestionService)
  const api: ApiProxy = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: parent,
  })
  return api
}

async function harness() {
  const parent = await mkdtemp(join(tmpdir(), 'apiproxy-paper-'))
  const ctx = new Context()
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  await ctx.plugin(SkillCatalogService, {
    storeRoot: join(parent, 'store'),
    minHarnessVersion: '0.1.1',
    trustRoots: { 'test-key': PUBLIC_DER },
  })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: parent,
  })
  return { parent, ctx, api }
}

function unwrap<T>(response: { result: { ok: true; value: T } | { ok: false } }): T {
  if (!response.result.ok) throw new Error('paper rpc unexpectedly failed')
  return response.result.value
}

describe('paper domain over the real service composition', () => {
  it('runs start/get/pause/resume/cancel with run-not-found and transition refusals', async () => {
    const { ctx, api } = await harness()
    const started = unwrap(await api.paper.runs.start(request({ mode: 'strict' }))).run
    expect(started.status).toBe('planning')
    expect(started.mode).toBe('strict')
    expect(started.lastEventSeq).toBe(1)

    const missing = await api.paper.runs.get(request({ runId: '00000000-0000-4000-8000-000000000001' }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'paper-run-not-found' } })

    await ctx.paperWorkflow.runs.transitionRun(RunId(started.id), 'running')
    await ctx.paperWorkflow.runs.addNode({ runId: RunId(started.id), type: 'execute', title: 'first' })
    const running = unwrap(await api.paper.runs.get(request({ runId: started.id }))).run
    expect(running.status).toBe('running')
    expect(running.nodes).toHaveLength(1)
    expect(running.lastEventSeq).toBeGreaterThanOrEqual(3)

    expect(unwrap(await api.paper.runs.pause(request({ runId: started.id }))).run.status).toBe('paused')
    expect(unwrap(await api.paper.runs.resume(request({ runId: started.id }))).run.status).toBe('running')
    expect(unwrap(await api.paper.runs.cancel(request({ runId: started.id }))).run.status).toBe('cancelled')
    const reCancel = await api.paper.runs.cancel(request({ runId: started.id }))
    expect(reCancel.result).toMatchObject({ ok: false, error: { code: 'paper-run-transition-invalid' } })
  })

  it('events resume from a sequence cursor and report the head', async () => {
    const { ctx, api } = await harness()
    const started = unwrap(await api.paper.runs.start(request({ mode: 'fast' }))).run
    await ctx.paperWorkflow.runs.transitionRun(RunId(started.id), 'running')
    await ctx.paperWorkflow.runs.addNode({ runId: RunId(started.id), type: 'plan', title: 'plan' })

    const all = unwrap(await api.paper.runs.events(request({ runId: started.id })))
    expect(all.events.map(event => event.seq)).toEqual([1, 2, 3])
    expect(all.lastSeq).toBe(3)
    const tail = unwrap(await api.paper.runs.events(request({ runId: started.id, afterSeq: 2 })))
    expect(tail.events.map(event => event.seq)).toEqual([3])
    expect(tail.lastSeq).toBe(3)
  })

  it('skills install/rollback/list surface catalog outcomes as structured errors', async () => {
    const { parent, api } = await harness()
    const first = await writePackage(parent, 'api-skill', '1.0.0')
    const second = await writePackage(parent, 'api-skill', '2.0.0')

    expect(unwrap(await api.paper.skills.install(request({ directory: first }))).skill.installedVersion).toBe('1.0.0')
    expect(unwrap(await api.paper.skills.install(request({ directory: second }))).skill.installedVersion).toBe('2.0.0')
    const rolledBack = unwrap(await api.paper.skills.rollback(request({ id: 'api-skill', toVersion: '1.0.0' })))
    expect(rolledBack.skill.versions.map(entry => entry.version)).toEqual(['1.0.0', '2.0.0'])
    expect(rolledBack.skill.installedVersion).toBe('1.0.0')
    expect(unwrap(await api.paper.skills.list(request({}))).skills).toHaveLength(1)

    const invalid = await api.paper.skills.install(request({ directory: join(parent, 'missing') }))
    expect(invalid.result).toMatchObject({ ok: false, error: { code: 'paper-skill-invalid' } })
    const unknown = await api.paper.skills.rollback(request({ id: 'absent-skill', toVersion: '1.0.0' }))
    expect(unknown.result).toMatchObject({ ok: false, error: { code: 'paper-skill-not-found' } })
  })

  it('reports service-unavailable when the paper composition is absent', async () => {
    const api = await bareHarness()
    const runs = await api.paper.runs.list(request({}))
    expect(runs.result).toMatchObject({ ok: false, error: { code: 'paper-service-unavailable', details: { service: 'paperWorkflow' } } })
    const skills = await api.paper.skills.list(request({}))
    expect(skills.result).toMatchObject({ ok: false, error: { code: 'paper-service-unavailable', details: { service: 'paperSkillCatalog' } } })
  })
})
