/**
 * E4 sign-off A acceptance (P2, TASK-P2 §9) — review-loop semantics v2.
 *
 * E4a: defects accumulate ACROSS rounds; a defect leaves the ledger only
 *      through an explicit `resolved` id. "Round 0 critical → round 1
 *      claims fixed (clean, but no resolved record) → round 2 clean" must
 *      STILL block — critical never expires without its resolved record.
 * E4b: the reviewer prompt teaches three severities and an unknown value
 *      is fail-closed (parsed as CRITICAL, never downgraded); a single
 *      critical finding blocks delivery.
 * E4c: fast mode may deliver with MINOR defects left (advisory_defects
 *      audited in the manifest); MAJOR still blocks fast; strict/formal/
 *      exploratory keep zero tolerance.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-review-v2
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
import { backboneIr, validChain } from './ir/fixtures.ts'

/**
 * A canonical backbone WITHOUT any FigureSpec — the P2 figure gate is
 * vacuous (any FigureSpec BLOCKs until P2-3), and fast-mode delivery runs
 * the REAL nine gates, so a fast happy path must be figure-free. Skips
 * FigureSpec/ReviewerFinding (which would cite it) and commits the
 * ExecutionRecord through the producer-only door.
 */
function noFigureBackbone(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-08-29T00:00:00.000Z' })
  for (const entry of validChain()) {
    if (entry.kind === 'FigureSpec' || entry.kind === 'ReviewerFinding') continue
    if (entry.kind === 'ExecutionRecord') {
      const verdict = ir.putExecutionRecord(entry.value, CAPTURE_ATTESTATION)
      if (!verdict.accepted) throw new Error(`noFigureBackbone record failed: ${JSON.stringify(verdict.failures)}`)
      continue
    }
    const verdict = ir.put(entry.kind as IrKind, entry.value)
    if (!verdict.accepted) throw new Error(`noFigureBackbone failed at ${entry.kind}: ${JSON.stringify(verdict.failures)}`)
  }
  return ir
}

const routes = {
  executor: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://e', timeoutMs: 1000 },
  reviewer: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://r', timeoutMs: 1000 },
  editorAi: { provider: 'fake', model: 'fake-model', credentialRef: 'cred://d', timeoutMs: 1000 },
}

async function* textStream(text: string): AsyncGenerator<{ type: string; index: number; text?: string; blockType?: string; block?: { type: string; text: string }; reason?: { kind: string } }> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', index: 0, reason: { kind: 'stop' } }
}

/**
 * Harness whose reviewer consumes `reviewerOutputs` one call at a time
 * (round order), letting a test script the review-adjudication arc.
 */
async function harness(reviewerOutputs: ReadonlyArray<string>, mode: 'fast' | 'exploratory') {
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
    resolveRole: () => Promise.resolve({ route: { role: 'executor', ...routes.executor }, model: { provider: 'fake', id: 'fake-model', name: 'fake-model' } }),
    stream: (request: { system?: string }): AsyncIterable<{ type: string; index: number; text?: string; blockType?: string; block?: { type: string; text: string }; reason?: { kind: string } }> => {
      const system = request.system ?? ''
      if (system.includes('reviewer')) {
        const text = reviewerOutputs[reviewCalls] ?? '{"defects":[]}'
        reviewCalls += 1
        return textStream(text)
      }
      return textStream('revised deliverable text')
    },
  } as never)
  await ctx.plugin(PaperSettingsService, { executor: routes.executor, reviewer: routes.reviewer, editorAi: routes.editorAi, defaultMode: mode })
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  ctx.provide('paperModelingIr', mode === 'fast' ? noFigureBackbone() : backboneIr())
  await ctx.plugin(PaperAuditService, {})
  await ctx.plugin(PaperExecutorService, { backoffBaseMs: 1, backoffCapMs: 1 })
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode, harnessVersion: 'test', configHash: 'sha256:e4' })
  const outcome = await ctx.paperExecutor.runs.execute(RunId(run.id), 'write one sentence')
    .then(() => ({ status: 'resolved' }))
    .catch((error: unknown) => ({
      status: 'rejected',
      code: (error as { code?: string }).code,
      message: (error as { message: string }).message,
    }))
  return { ctx, runId: run.id, engine, outcome }
}

describe('E4a — defects accumulate across rounds (critical never expires without resolved)', () => {
  it('round-0 critical + clean rounds with NO resolved record → still BLOCKED', async () => {
    const { engine, runId, outcome } = await harness([
      '{"defects":[{"id":"D1","severity":"critical","description":"data integrity"}]}',
      '{"defects":[],"resolved":[]}',
      '{"defects":[],"resolved":[]}',
    ], 'exploratory')
    expect(outcome.status).toBe('rejected')
    expect((outcome as { code?: string }).code).toBe('gate-failed')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    // The critical defect was reported and never resolved — it must stay
    // in the public trail and the run must not deliver.
    const defectEvents = engine.listEvents(RunId(runId))
      .filter(e => e.type === 'defect')
      .map(e => `${String(e.data.severity)}:${String(e.data.description)}`)
    expect(defectEvents.some(d => d.startsWith('critical:'))).toBe(true)
    expect(engine.getManifest(RunId(runId))).toBeUndefined()
  })

  it('a later explicit resolved record DOES clear the critical (the legal exit)', async () => {
    const { engine, runId, outcome } = await harness([
      '{"defects":[{"id":"D1","severity":"critical","description":"data integrity"}]}',
      '{"defects":[],"resolved":["D1"]}',
    ], 'exploratory')
    expect(outcome.status).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
  })
})

describe('E4b — three-value severity, unknown values fail-closed', () => {
  it('an unknown severity is parsed as a CRITICAL finding and blocks', async () => {
    const { engine, runId, outcome } = await harness([
      '{"defects":[{"id":"X1","severity":"ALIEN","description":"odd wording"}]}',
    ], 'exploratory')
    expect(outcome.status).toBe('rejected')
    const defects = engine.listEvents(RunId(runId))
      .filter(e => e.type === 'defect')
      .map(e => `${String(e.data.severity)}:${String(e.data.description)}`)
    // E4b: an unclassifiable severity is a CRITICAL finding (never a
    // downgrade), keeping its original description.
    expect(defects.some(d => d.startsWith('critical:') && d.includes('odd wording'))).toBe(true)
  })

  it('a single well-formed critical finding blocks delivery', async () => {
    const { outcome } = await harness([
      '{"defects":[{"id":"C1","severity":"critical","description":"numeric escape"}]}',
    ], 'exploratory')
    expect(outcome.status).toBe('rejected')
    expect((outcome as { code?: string }).code).toBe('gate-failed')
  })
})

describe('E4c — fast mode delivers with advisory MINOR defects, blocks MAJOR', () => {
  it('fast: a MINOR surviving the rounds delivers with advisory_defects audited', async () => {
    const { engine, runId, outcome } = await harness([
      '{"defects":[{"id":"M1","severity":"minor","description":"tone too dry"}]}',
      '{"defects":[{"id":"M1","severity":"minor","description":"tone too dry"}]}',
    ], 'fast')
    expect(outcome.status).toBe('resolved')
    expect(engine.getRun(RunId(runId))?.status).toBe('completed')
    const manifest = engine.getManifest(RunId(runId))
    expect(manifest).toBeDefined()
    expect(manifest!.gates['review']).toBe(true)
    expect(manifest!.advisory_defects).toEqual([
      { id: 'M1', severity: 'minor', description: 'tone too dry' },
    ])
  })

  it('fast: a MAJOR surviving the rounds still blocks (no downgrade, no bypass)', async () => {
    const { engine, runId, outcome } = await harness([
      '{"defects":[{"id":"J1","severity":"major","description":"missing citation"}]}',
      '{"defects":[{"id":"J1","severity":"major","description":"missing citation"}]}',
    ], 'fast')
    expect(outcome.status).toBe('rejected')
    expect(engine.getRun(RunId(runId))?.status).toBe('failed')
    expect(engine.getManifest(RunId(runId))).toBeUndefined()
  })
})
