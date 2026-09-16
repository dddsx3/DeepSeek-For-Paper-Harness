/**
 * P0-3 acceptance (PRD v2 §8 W2 exit criterion): 构造一篇"有内容但有
 * 未过项"的稿 → 能 MARKED 交付。
 *
 * Runs the executor end-to-end with deliveryGradeMode: 'fail-soft':
 *   - a draft with real content + a surviving MINOR/CRITICAL review defect
 *     must DELIVER (status completed) with grade MARKED, and the final
 *     output sink must contain the honest appendix;
 *   - an empty draft must still BLOCK (fatal probe, fail-soft or not);
 *   - a clean draft delivers CLEAN with no appendix;
 *   - the audit trail carries delivery_graded with the grade.
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import PaperRuntimeGuard from '../../src/runtime/runtime-guard.ts'
import { createExploratoryProfile } from '../../src/runtime/profile.ts'
import {
  PaperAuditService,
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
} from '../../src/index.ts'
import { backboneIr } from '../ir/fixtures.ts'

const routes = {
  executor: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://e', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://r', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://d', timeoutMs: 1000 },
}

type StreamChunk = {
  readonly type: string
  readonly index: number
  readonly text?: string
  readonly blockType?: string
  readonly block?: { readonly type: string; readonly text: string }
  readonly reason?: { readonly kind: string }
}

async function* textStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

/** A draft long enough to pass the fatal content probe (>=200 chars). */
const REAL_DRAFT = '问题分析：本题要求建立抽样检验决策模型。我们首先对零配件次品率建立二项分布假设，然后通过序贯抽样给出最小检测次数方案。在 95% 信度下，拒绝域由单侧检验给出；在 90% 信度下接受域由对立检验给出。随后对生产过程各阶段建立期望费用模型，比较八种检测组合的期望成本，得出最优策略。'.repeat(2)

interface HarnessOutcome {
  readonly ctx: Context
  readonly runId: string
  readonly status: 'resolved' | 'rejected'
  readonly code: string | undefined
  readonly message: string | undefined
}

/**
 * Fail-soft harness: reviewer scripted by round, executor/editor return
 * the REAL_DRAFT, deliveryGradeMode: 'fail-soft', final output written to
 * a real sink directory (asserting the appendix lands in the delivered
 * FILE, not just in an audit record).
 */
async function failSoftHarness(
  reviewerOutputs: ReadonlyArray<string>,
  executorDraft: string,
  ir?: ModelingIr,
): Promise<HarnessOutcome & { readonly finalOutput: () => string | undefined }> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(PaperFoundationService)
  await ctx.plugin(WorkflowEngineService)
  let reviewCalls = 0
  const finalRoot = await mkdtemp(join(tmpdir(), 'dsh-p03-'))
  ctx.provide('paperProvider', {
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'fake-model', name: 'fake-model' } }),
    stream: (request: { system?: string }): AsyncIterable<StreamChunk> => {
      const system = request.system ?? ''
      if (system.includes('reviewer')) {
        const text = reviewerOutputs[reviewCalls] ?? '{"defects":[]}'
        reviewCalls += 1
        return textStream(text)
      }
      return textStream(executorDraft)
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: 'exploratory' })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  // The full backbone keeps the nine gates PASS; only the review ledger
  // carries the scripted defect, so the MARKED grade is attributable to
  // the review defect alone.
  ctx.provide('paperModelingIr', ir ?? backboneIr())
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, {
    backoffBaseMs: 1,
    backoffCapMs: 1,
    deliveryGradeMode: 'fail-soft',
    finalOutputRoot: finalRoot,
  })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode: 'exploratory', harnessVersion: 'test', configHash: 'sha256:p03' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'produce a decision paper')
    .then(() => ({ status: 'resolved' as const, code: undefined, message: undefined }))
    .catch((error: unknown) => ({
      status: 'rejected' as const,
      code: (error as { code?: string }).code,
      message: (error as { message: string }).message,
    }))
  // Read the delivered file straight from the promotion sink: the MARKED
  // appendix must exist in the bytes the user receives, not just in audit.
  const finalOutput = async (): Promise<string | undefined> => {
    const dir = join(finalRoot, String(run.id), 'final')
    const names = await readdir(dir).catch(() => [] as string[])
    const first = names[0]
    if (first === undefined) return undefined
    return readFile(join(dir, first), 'utf8')
  }
  const capturedFinal = outcome.status === 'resolved' ? await finalOutput() : undefined
  return { ctx, runId: run.id, ...outcome, finalOutput: () => capturedFinal }
}

/** Same harness with a pre-built IR (for overlay tests). */
async function failSoftHarnessWithIr(
  ir: ModelingIr,
  reviewerOutputs: ReadonlyArray<string>,
  executorDraft: string,
) {
  return failSoftHarness(reviewerOutputs, executorDraft, ir)
}

describe('P0-3 fail-soft delivery — the W2 acceptance case', () => {
  it('a paper with content and a surviving critical defect delivers as MARKED with an honest appendix', async () => {
    const outcome = await failSoftHarness([
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
    ], REAL_DRAFT)
    expect(outcome.status).toBe('resolved')
    const run = outcome.ctx.paperWorkflow.runs.getRun(RunId(outcome.runId))
    expect(run?.status).toBe('completed')
    // The manifest exists — a MARKED delivery is still a delivery.
    expect(outcome.ctx.paperWorkflow.runs.getManifest(RunId(outcome.runId))).toBeDefined()
    // Audit: the grade event says MARKED, and it is NOT missing.
    const grades = outcome.ctx.paperAudit.list(RunId(outcome.runId)).filter(e => e.eventType === 'delivery_graded')
    expect(grades).toHaveLength(1)
    expect(String(grades[0]?.detail.grade)).toBe('MARKED')
    // The delivered FILE carries the honest appendix (not audit-only):
    // body first, then the appendix table with the defect's own words.
    const delivered = outcome.finalOutput()
    expect(delivered).toBeDefined()
    expect(delivered).toContain(REAL_DRAFT.slice(0, 20))
    expect(delivered).toContain('附录：交付标注（自动生成）')
    expect(delivered).toContain('MARKED')
    expect(delivered).toContain('结论缺少数值依据')
    // W8: the backbone IR is structurally VALID, so V1–V4 contribute zero
    // findings here — the appendix attributes this MARKED grade to the
    // review ledger alone (verifier zero-false-positive property).
    expect(delivered).toContain('review ledger')
  })

  it('W8: a V1 structural failure joins the fail-soft grade input and lands in the appendix', async () => {
    // Overlay one unreferenced ACTIVE assumption onto the backbone — V1
    // flags it; the run still DELIVERS (fail-soft) with the V finding in
    // the appendix. This is the verification layer becoming a real gate.
    const ir = backboneIr()
    const ghost = ir.put('AssumptionSpec' as never, {
      assumption_id: 'A-ORPHAN',
      scope_ref: 'P1',
      statement: '幽灵假设：从未被任何模型引用',
      source_type: 'MODELING_CHOICE',
      justification_refs: ['DA-RAW'],
      risk_level: 'MEDIUM',
      testable: false,
      sensitivity_refs: [],
      status: 'ACTIVE',
    })
    if (!ghost.accepted) throw new Error(`overlay refused: ${JSON.stringify(ghost.failures)}`)
    // rebuild the harness with the modified IR by re-running the same flow
    const outcome = await failSoftHarnessWithIr(ir, [
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
      '{"defects":[{"id":"D1","severity":"critical","description":"结论缺少数值依据：决策方案未给出期望费用数字"}]}',
    ], REAL_DRAFT)
    expect(outcome.status).toBe('resolved')
    const delivered = outcome.finalOutput()
    expect(delivered).toContain('MARKED')
    expect(delivered).toContain('A-ORPHAN')
    expect(delivered).toContain('假设')
  })

  it('a clean review delivers CLEAN (fail-soft does not invent annotations)', async () => {
    const outcome = await failSoftHarness([], REAL_DRAFT)
    expect(outcome.status).toBe('resolved')
    const grades = outcome.ctx.paperAudit.list(RunId(outcome.runId)).filter(e => e.eventType === 'delivery_graded')
    expect(String(grades[0]?.detail.grade)).toBe('CLEAN')
    // CLEAN ships no appendix.
    expect(outcome.finalOutput()).not.toContain('附录：交付标注')
  })

  it('an EMPTY draft still BLOCKS under fail-soft (fatal condition 1)', async () => {
    const outcome = await failSoftHarness(['{"defects":[]}'], '')
    expect(outcome.status).toBe('rejected')
    expect(outcome.code).toBe('gate-failed')
    expect(outcome.message).toContain('fatal content probe')
    expect(outcome.ctx.paperWorkflow.runs.getRun(RunId(outcome.runId))?.status).toBe('failed')
  })
})
