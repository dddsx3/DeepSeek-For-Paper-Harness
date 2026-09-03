/**
 * Real-API acceptance for the Paper workflow, against the live DeepSeek
 * adapter. The suite skips entirely without $DEEPSEEK_API_KEY, so a keyless
 * CI lane stays green.
 *
 * Every case asserts the durable record, not the model's prose: the run a
 * review passes must leave a manifest, an artifact, accumulated usage, and an
 * audit trail, and a replay of its event log must agree with the records.
 * Model wording is only required to be non-empty — asserting more would test
 * the provider, not this package.
 *
 * Cost discipline: revise rounds are what multiply calls, so the strict mode
 * case is deliberately absent. Its four reviews would spend four times the
 * fast case to assert the same durable facts the unit suites already pin.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/workflow.e2e
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import {
  PaperAuditService,
  PaperDiagnosticsService,
  PaperExecutorService,
  PaperFoundationService,
  PaperProviderService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  replayWorkflow,
  type PaperSettings,
  type ProviderRoute,
} from '../src/index.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createFastProfile } from '../src/runtime/profile.ts'
import { backboneIr } from './ir/fixtures.ts'

const API_KEY = process.env.DEEPSEEK_API_KEY
const KEYLESS = API_KEY === undefined || API_KEY === ''
const PROVIDER = 'deepseek-official'
const MODEL = 'deepseek-v4-flash'
/** One short task: the acceptance target is the durable record, not the prose. */
const TASK = 'In one sentence, state why an append-only log makes a crash recoverable.'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function settingsWith(route: ProviderRoute): PaperSettings {
  return { executor: route, reviewer: route, editorAi: route, defaultMode: 'fast' }
}

const LIVE_ROUTE: ProviderRoute = {
  provider: PROVIDER,
  model: MODEL,
  credentialRef: 'DEEPSEEK_API_KEY',
  timeoutMs: 120_000,
}

/** Compose the real adapter over durable JSON storage in a scratch directory. */
async function harness(route: ProviderRoute = LIVE_ROUTE) {
  const root = await mkdtemp(join(tmpdir(), 'paper-e2e-'))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmDeepSeek, { apiKeyEnv: route.credentialRef })
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  await ctx.plugin(PaperProviderService)
  await ctx.plugin(PaperDiagnosticsService)
  await ctx.plugin(PaperSettingsService, settingsWith(route))
  await ctx.plugin(PaperAuditService, {})
  // TASK -1 rewire: mount the runtime guard before the executor so the
  // service's static inject can find it.
  const guard = new PaperRuntimeGuard(ctx, { profile: createFastProfile() })
  guard.markReady()
  // TASK 1.25 / 3.R3: the executor delivers only when a canonical IR
  // carrying a closed Problem Contract is mounted (3.R2 single verdict;
  // otherwise every FAST run is BLOCKED at ir_canonicalization before it
  // can leave a manifest). The text-then-gate workflow expects the caller
  // to pre-load the backbone — exactly as the executor unit suites do
  // with backboneIr(). Without this line this acceptance suite could only
  // ever observe gate failures, never the durable record it asserts.
  ctx.provide('paperModelingIr', backboneIr())
  await ctx.plugin(PaperExecutorService, {
    backoffBaseMs: 1000,
    backoffCapMs: 4000,
    pricing: { [PROVIDER]: { [MODEL]: { inputPer1k: 0.0002, outputPer1k: 0.0008 } } },
  })
  return { ctx }
}

describe.skipIf(KEYLESS)('paper workflow against the live provider', () => {
  it('completes a fast run and leaves a manifest, artifact, usage, and audit trail', async () => {
    const { ctx } = await harness()
    const engine = ctx.paperWorkflow.runs
    const started = await engine.startRun({
      mode: 'fast',
      harnessVersion: 'e2e',
      configHash: 'sha256:e2e',
    })
    const runId = RunId(started.id)

    const outcome = await ctx.paperExecutor.runs.execute(runId, TASK)

    expect(outcome.run.status).toBe('completed')
    expect(outcome.manifest.redacted).toBe(true)
    expect(outcome.manifest.finalArtifactId).not.toBeNull()
    expect(engine.getManifest(runId)).toEqual(outcome.manifest)

    // Real usage arrived and priced into a real cost.
    expect(outcome.run.usage.inputTokens).toBeGreaterThan(0)
    expect(outcome.run.usage.outputTokens).toBeGreaterThan(0)
    expect(outcome.run.usage.costUsd).toBeGreaterThan(0)

    const nodes = engine.listNodes(runId)
    expect(nodes.map(node => node.type)).toEqual(
      expect.arrayContaining(['plan', 'execute', 'review', 'deliver']),
    )
    expect(nodes.every(node => node.state === 'succeeded')).toBe(true)

    const events = engine.listEvents(runId)
    const types = new Set(events.map(event => event.type))
    expect(types).toContain('request_started')
    expect(types).toContain('usage')
    expect(types).toContain('gate_result')

    // The durable log alone reconstructs the state the records hold.
    const snapshot = replayWorkflow(runId, events)
    expect(snapshot.runStatus).toBe('completed')
    expect(snapshot.lastSeq).toBe(engine.latestEventSeq(runId))
    for (const node of nodes) {
      expect(snapshot.nodeStates.get(node.id)).toBe(node.state)
    }

    const audit = ctx.paperAudit.list(started.id).map(entry => entry.eventType)
    expect(audit[0]).toBe('workflow_started')
    expect(audit.at(-1)).toBe('workflow_completed')
    // No credential value reaches the trail.
    expect(JSON.stringify(ctx.paperAudit.list())).not.toContain(API_KEY as string)
  }, 180_000)

  it('reports an unresolvable credential as a blocking failure without retrying', async () => {
    const { ctx } = await harness({ ...LIVE_ROUTE, credentialRef: 'PAPER_E2E_ABSENT_KEY' })
    const engine = ctx.paperWorkflow.runs
    const started = await engine.startRun({
      mode: 'fast',
      harnessVersion: 'e2e',
      configHash: 'sha256:e2e-absent-credential',
    })
    const runId = RunId(started.id)

    await expect(ctx.paperExecutor.runs.execute(runId, TASK))
      .rejects.toMatchObject({ code: 'provider-blocked' })

    expect(engine.getRun(runId)?.status).toBe('failed')
    // Blocked rather than retried, so exactly one attempt was spent.
    expect(engine.listEvents(runId).filter(event => event.type === 'request_started')).toHaveLength(1)
    expect(ctx.paperAudit.list(started.id).map(entry => entry.eventType))
      .toEqual(['workflow_started', 'provider_blocked', 'workflow_failed'])
  }, 60_000)

  it('probes the configured route and returns only non-sensitive facts', async () => {
    const { ctx } = await harness()
    const result = await ctx.paperDiagnostics.probe({
      provider: PROVIDER,
      model: MODEL,
      timeoutMs: 60_000,
    })

    expect(result).toMatchObject({ ok: true, provider: PROVIDER, model: MODEL, code: 'OK' })
    expect(result.latencyMs).toBeGreaterThan(0)
    expect(Object.keys(result).sort()).toEqual(['code', 'latencyMs', 'model', 'ok', 'provider'])
    // A probe is not a Session and leaves no run behind.
    expect(ctx.paperWorkflow.runs.listRuns()).toHaveLength(0)
  }, 90_000)

  it('reports an unresolvable credential from the probe without throwing', async () => {
    const { ctx } = await harness({ ...LIVE_ROUTE, credentialRef: 'PAPER_E2E_ABSENT_KEY' })
    const result = await ctx.paperDiagnostics.probe({
      provider: PROVIDER,
      model: MODEL,
      timeoutMs: 30_000,
    })

    expect(result.ok).toBe(false)
    expect(result.code).not.toBe('OK')
    expect(JSON.stringify(result)).not.toContain('PAPER_E2E_ABSENT_KEY')
  }, 60_000)
})
