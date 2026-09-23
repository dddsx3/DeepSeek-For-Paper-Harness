/**
 * P3-1 (E5) — reviewer semantic cross-check v1.
 *
 * The reviewer now sees the canonical context (result rows, REQUIRED_OUTPUTs,
 * claim summaries) and may raise THREE closed semantic findings — every one
 * of them must carry evidence (verbatim text_span + resolving ref_ids).
 * Anything outside the set, or without valid evidence, is DISCARDED (never
 * upgraded, never blocking — 禁 1). Severity is fixed by kind; the ledger,
 * `resolved` handling and revise rounds are E4a's, unchanged.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-review-semantic
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../src/index.ts'
import { ModelingIr } from '../src/ir/store.ts'
import { CAPTURE_ATTESTATION, type IrKind } from '../src/ir/index.ts'
import { validChain } from './ir/fixtures.ts'
import { FAKE_DRAFT_TEXT } from './fixtures/fake-draft.ts'

/** Backbone WITHOUT a FigureSpec (the vacuous figure gate would BLOCK). */
function backbone(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-08-29T00:00:00.000Z' })
  for (const entry of validChain()) {
    if (entry.kind === 'FigureSpec' || entry.kind === 'ReviewerFinding') continue
    if (entry.kind === 'ExecutionRecord') {
      const verdict = ir.putExecutionRecord(entry.value, CAPTURE_ATTESTATION)
      if (!verdict.accepted) throw new Error('record refused')
      continue
    }
    const verdict = ir.put(entry.kind as IrKind, entry.value)
    if (!verdict.accepted) throw new Error(`${entry.kind} refused`)
  }
  return ir
}

const routes = {
  executor: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'm', credentialRef: 'c', timeoutMs: 1000 },
}

/** The deliverable prose: it claims a comparison the Result table has not. */
// 交付文本必须**够长**才算内容（`EMPTY_CONTENT_CHARS`）——旧夹具是一句话，
// 在新交付阶梯下会被判为 `fatal content probe`。句子本身保留：语义裁决的
// text_span 检查要能在交付文本里找到它。
const PROSE = `${FAKE_DRAFT_TEXT}

The model outperforms all baselines.`

async function* stream(text: string) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

async function harness(reviewerOutputs: ReadonlyArray<string>, executorConfig: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  let reviewCalls = 0
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'm', name: 'm' } }),
    stream: (request: { system?: string; messages?: Array<{ content?: unknown }> }) => {
      const system = String(request.system ?? '')
      if (system.includes('reviewer')) {
        const text = reviewerOutputs[reviewCalls] ?? '{"defects":[]}'
        reviewCalls += 1
        return stream(text)
      }
      if (system.includes('editor')) return stream(FAKE_DRAFT_TEXT)
      const joined = (request.messages ?? []).map((m) => {
        const content = (m as { content?: unknown }).content
        if (typeof content === 'string') return content
        if (Array.isArray(content)) return content.map((p: { type?: string; text?: string }) => (p?.type === 'text' ? p.text ?? '' : '')).join('')
        return ''
      }).join(' ')
      if (joined.includes('numbered execution plan')) return stream('1. draft')
      if (joined.includes('Produce the deliverable')) return stream(PROSE)
      return stream(FAKE_DRAFT_TEXT)
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'exploratory' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  ctx.provide('paperModelingIr', backbone())
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, { backoffBaseMs: 1, backoffCapMs: 1, ...executorConfig })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:p31' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')
    .then(() => ({ status: 'resolved' as const }))
    .catch((error: unknown) => ({ status: 'rejected' as const, code: (error as { code?: string }).code }))
  return { engine, runId: run.id, outcome, ctx }
}

/** A semantic finding with evidence — the legal (blocking) shape. */
function semanticFinding(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    defects: [{
      id: 'D1',
      severity: 'critical',
      description: 'the prose claims a comparison no Result supports',
      semantic: 'claim_without_evidence',
      evidence: { text_span: 'outperforms all baselines', ref_ids: ['RES1'] },
      ...overrides,
    }],
  })
}

describe('P3-1 semantic findings (E5, closed set + evidence domain)', () => {
  it('attack 1: a critical semantic defect is RECORDED AND SURFACED, not silently dropped', async () => {
    // 契约反转（本次架构改造的方向性决定）：findings 不再靠"拒绝交付"获得归宿，
    // 而是进交付物的已知缺陷表 + 审计轨迹。旧形态（一律 BLOCKED）的代价是零产物，
    // 那不是闭环，是用更严重的失败掩盖原失败。
    const { engine, runId, outcome, ctx } = await harness([semanticFinding()])
    expect(outcome.status).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
    const closed = ctx.paperAudit.list(RunId(runId)).find(e => e.eventType === 'closure_closed')
    expect(closed?.detail?.findings).toBeGreaterThan(0)
  })

  it('attack 1b: the SAME defect still blocks under explicit strict-tolerance', async () => {
    // fail-closed 路径没有被删除，只是不再是默认。它仍然必须有效。
    const { engine, runId, outcome } = await harness([semanticFinding()], { deliveryGradeMode: 'strict-tolerance' })
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
  })

  it('attack 2 (E4a reuse): a reworded draft with no resolved record keeps the defect in the ledger', async () => {
    const { engine, runId, outcome, ctx } = await harness([
      semanticFinding(),
      '{"defects":[],"resolved":[]}',   // "fixed" by rewording, never resolved
    ])
    // 改文字不能消解缺陷（这正是 L6 的 C1：不接受"我改过了"）。
    expect(outcome.status).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
    const closed = ctx.paperAudit.list(RunId(runId)).find(e => e.eventType === 'closure_closed')
    expect(closed?.detail?.findings).toBeGreaterThan(0)
  })

  it('attack 3: a semantic finding whose ref_ids dangle is discarded (no hallucinated BLOCK)', async () => {
    const { engine, runId, outcome } = await harness([
      JSON.stringify({ defects: [{ id: 'D1', severity: 'critical', description: 'unsupported', semantic: 'claim_without_evidence', evidence: { text_span: 'outperforms all baselines', ref_ids: ['GHOST'] } }] }),
    ])
    expect(outcome.status).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
  })

  it('attack 3b: a fabricated text_span (not in the delivered text) is discarded', async () => {
    const { outcome } = await harness([
      JSON.stringify({ defects: [{ id: 'D1', severity: 'critical', description: 'unsupported', semantic: 'scope_overclaim', evidence: { text_span: 'a sentence nobody wrote', ref_ids: ['RES1'] } }] }),
    ])
    expect(outcome.status).toBe('resolved')
  })

  it('attack 4: a domain-external "semantic" kind cannot become critical (style issue)', async () => {
    const { outcome } = await harness([
      JSON.stringify({ defects: [{ id: 'D1', severity: 'critical', description: 'tone is dry', semantic: 'style_issue', evidence: { text_span: 'outperforms all baselines', ref_ids: ['RES1'] } }] }),
    ])
    expect(outcome.status).toBe('resolved')
  })

  it('blue path: a clean review of the same prose delivers', async () => {
    const { engine, runId, outcome } = await harness(['{"defects":[]}'])
    expect(outcome.status).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
  })
})
