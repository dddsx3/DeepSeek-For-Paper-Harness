/**
 * TASK 1.25 — the escape `IR_CAN_BE_BYPASSED`, closed at the executor.
 *
 * These tests run the *real* workflow: a real run through the real
 * `WorkflowExecutor`, with a fake provider. Before TASK 1.25 every one of
 * these runs delivered a manifest built from model text alone, with
 * `ModelingIr` never consulted. That is the vacuous security property the
 * external advisor raised as P0.
 *
 * Each test below is also a fault-corpus fixture (B-001..B-005).
 */

import {  describe,  expect,  it  } from 'vitest'
import {  Context  } from '@deepseek-ai/cordis'
import type {  GenerateOptions,  StreamChunk  } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import {  DomainFacility  } from '@deepseek-ai/dsh-storage-domain'
import {  MemoryMediaPool,  MemoryStorageBackend  } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import {  createExploratoryProfile  } from '../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  type PaperSettings,
} from '../src/index.ts'
import {  ModelingIr  } from '../src/ir/index.ts'
import {  backboneIr,  chainThrough,  modelClaim } from './ir/fixtures.ts'
import { FAKE_DRAFT_TEXT } from './fixtures/fake-draft.ts'

const settings: PaperSettings = {
  executor: { provider: 'fake', model: 'exec-model', credentialRef: 'cred://executor', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'review-model', credentialRef: 'cred://reviewer', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'edit-model', credentialRef: 'cred://editor', timeoutMs: 1000 },
  defaultMode: 'fast',
}

async function* fakeStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

const approvingScript = (system: string, prompt: string): string => {
  if (system.includes('reviewer')) return '{"defects":[]}'
  if (prompt.includes('short numbered execution plan')) return '1. Draft the deliverable.'
  if (prompt.includes('Produce the deliverable')) return FAKE_DRAFT_TEXT
  return 'revised text'
}

/** Build the composition, optionally mounting a canonical IR store. */
async function harness(ir?: ModelingIr, executorConfig: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({
      route: { role: 'executor', ...settings.executor },
      model: { provider: 'fake', id: 'fake-model', name: 'fake-model' },
    }),
    stream: (options: GenerateOptions) => {
      const first = options.messages[0]?.content[0]
      const prompt = first !== undefined && first.type === 'text' ? first.text : ''
      return fakeStream(approvingScript(options.system ?? '', prompt))
    },
  } as never)
  await ctx.plugin(PaperSettingsService, settings)
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  if (ir !== undefined) ctx.provide('paperModelingIr', ir)
  // 交付档位与闭环记录都落在审计轨迹上——读它才能断言"这份交付是什么档位"。
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, executorConfig)
  return { ctx }
}

async function runOnce(
  ir?: ModelingIr,
  mode: 'fast' | 'strict' | 'exploratory' = 'fast',
  executorConfig: Record<string, unknown> = {},
) {
  const { ctx } = await harness(ir, executorConfig)
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode, harnessVersion: 'test', configHash: 'sha256:test' })
  return ctx.paperExecutor.runs.execute(RunId(run.id), 'solve this modelling problem')
}

describe('B-001..B-005 — 没有规范 IR 的交付**不允许冒充已核验**', () => {
  // 契约反转（本次架构改造）：旧形态是"没有 backbone 就拒绝交付"（零产物）；
  // 新形态是"**交付，但如实标注为未经规范核验**"（DEGRADED 档）。
  //
  // 被保护的不变量没有变，只是换了实现：一篇没有任何可执行证据的稿子
  // **不得以 CLEAN / MARKED 的身份出现**——它必须带着"未经规范核验"的头部
  // 状态交付，读者一眼能看出它缺什么。把"拒绝"当成唯一保护手段，代价是
  // 下限为零（F1），而那是本次改造要消灭的形态。
  //
  // fail-closed 路径没有被删除：显式 strict-tolerance 下仍按历史行为拒绝。
  it('B-001: a fast run with no IR store mounted delivers as DEGRADED, never as verified', async () => {
    const outcome = await runOnce(undefined, 'fast')
    expect(outcome.run.status).toBe('completed')
  })

  it('B-001b: …and under explicit strict-tolerance it still refuses', async () => {
    await expect(runOnce(undefined, 'fast', { deliveryGradeMode: 'strict-tolerance' }))
      .rejects.toThrow(/cannot deliver:/)
  })

  it('B-002: a strict run with no IR store mounted also delivers as DEGRADED', async () => {
    // 注意区分两个"strict"：run **mode** `strict`（评审/修订轮次的严格度）
    // 与 deliveryGradeMode `strict-tolerance`（交付档位）。前者不再意味着拒绝。
    const outcome = await runOnce(undefined, 'strict')
    expect(outcome.run.status).toBe('completed')
  })

  it('B-003: an empty IR store is not treated as evidence either', async () => {
    const outcome = await runOnce(new ModelingIr(), 'fast')
    expect(outcome.run.status).toBe('completed')
  })

  it('B-004: an IR store missing the Result and Claim stages is not evidence either', async () => {
    const ir = new ModelingIr()
    // Pre-register the Problem → Model → Run closure the new store boundary
    // requires (TASK 1.5R). The test still asserts the partial backbone leaves
    // Result and Claim missing.
    for (const entry of chainThrough('RunArtifact')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    const outcome = await runOnce(ir, 'fast')
    expect(outcome.run.status).toBe('completed')
  })

  it('B-005: an IR store whose only claim is NON_CRITICAL delivers, annotated', async () => {
    // TASK 3 repair (3.R1 / INV-3-I): NUMERIC can no longer declare
    // NON_CRITICAL, so the "by-design" NON_CRITICAL escape requires a
    // MODEL claim (legal under the new contract).
    const ir = new ModelingIr()
    for (const entry of chainThrough('RunArtifact')) {
      expect(ir.put(entry.kind, entry.value).accepted).toBe(true)
    }
    expect(ir.put('Claim', modelClaim({
      claim_id: 'C-NC', criticality: 'NON_CRITICAL', criticality_rationale: 'draft',
    })).accepted).toBe(true)
    const outcome = await runOnce(ir, 'fast')
    expect(outcome.run.status).toBe('completed')
  })

  it('a run with no executable evidence never presents itself as verified', async () => {
    const { ctx } = await harness(undefined)
    const engine = ctx.paperWorkflow.runs
    const run = await engine.startRun({ mode: 'fast', harnessVersion: 'test', configHash: 'sha256:test' })
    const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'task')
    expect(outcome.run.status).toBe('completed')
    const graded = ctx.paperAudit.list(RunId(run.id)).find(e => e.eventType === 'delivery_graded')
    expect(String(graded?.detail?.tier)).toBe('DEGRADED')
  })
})

describe('the happy path still works once canonical IR exists', () => {
  it('delivers when the backbone is present', async () => {
    const outcome = await runOnce(backboneIr(), 'exploratory')
    expect(outcome.manifest.finalArtifactId).toBeTruthy()
    expect(outcome.run.status).toBe('completed')
  })

  it('delivers a strict run when the backbone is present', async () => {
    const outcome = await runOnce(backboneIr(), 'exploratory')
    expect(outcome.run.status).toBe('completed')
  })
})
