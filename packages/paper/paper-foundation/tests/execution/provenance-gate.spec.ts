/**
 * TASK 3 PHASE 4 — provenance audit + the `provenance` critical gate.
 *
 * The delivery gate is structural (cheap, byte-free): every critical-
 * chain run must carry an ExecutionRecord consistent with its
 * RunArtifact. It is exhaustive over the canonical snapshot (INV-3-G),
 * it is a real member of the closed critical set (D8), and the executor
 * enforces it end-to-end before `authorizeDelivery`.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import {
  CRITICAL_GATE_IDS,
  PROVENANCE_GATE_ID,
} from '../../src/delivery/delivery-policy.ts'
import {
  ModelingIr,
  type ExecutionRecord,
} from '../../src/ir/index.ts'
import {
  auditExecutionProvenance,
  buildExecutionManifest,
  evaluateProvenanceGate,
  executionProvenanceGate as gateFn,
  ingestCapturedRecord,
} from '../../src/execution/index.ts'
import {
  PaperExecutorService,
  PaperFoundationService,
  PaperSettingsService,
  RunId,
  WorkflowEngineService,
  WorkflowExecutionError,
  type PaperSettings,
} from '../../src/index.ts'
import { requiresIrBackbone } from '../../src/ir/bridge.ts'
import {
  backboneIr,
  chainThrough,
  executionRecord,
  result,
  runArtifact,
} from '../ir/fixtures.ts'

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
  if (prompt.includes('Produce the deliverable')) return 'The final deliverable text.'
  return 'revised text'
}

async function harness(ir?: ModelingIr) {
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
  const { createExploratoryProfile } = await import('../../src/runtime/profile.ts')
  const { default: PaperRuntimeGuard } = await import('../../src/runtime/runtime-guard.ts')
  const guard = new PaperRuntimeGuard(ctx, { profile: createExploratoryProfile() })
  guard.markReady()
  if (ir !== undefined) ctx.provide('paperModelingIr', ir)
  await ctx.plugin(PaperExecutorService)
  return { ctx }
}

async function runOnce(ir?: ModelingIr, mode: 'fast' | 'strict' = 'fast') {
  const { ctx } = await harness(ir)
  const engine = ctx.paperWorkflow.runs
  const run = await engine.startRun({ mode, harnessVersion: 'test', configHash: 'sha256:test' })
  return ctx.paperExecutor.runs.execute(RunId(run.id), 'solve this modelling problem')
}

/** Critical chain through RUN1 (Problem → Model → Run → Result → Claim), no record. */
function bareChainStore(): ModelingIr {
  const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
  for (const entry of chainThrough('RunArtifact')) {
    ir.put(entry.kind, entry.value)
  }
  expect(ir.put('Result', result()).accepted).toBe(true)
  expect(ir.put('Claim', {
    claim_id: 'C1', text: 't', claim_type: 'NUMERIC', criticality: 'CRITICAL',
    numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1'],
  }).accepted).toBe(true)
  return ir
}

describe('the provenance gate is a real critical gate', () => {
  it('its id is a member of the closed critical set (D8)', () => {
    expect(CRITICAL_GATE_IDS).toContain(PROVENANCE_GATE_ID)
    expect(PROVENANCE_GATE_ID).toBe('provenance')
  })

  it('emits a gate record with a stable id and criticality', () => {
    const gate = gateFn(backboneIr(), '2026-09-01T00:00:00.000Z')
    expect(gate.id).toBe('provenance')
    expect(gate.critical).toBe(true)
    expect(gate.status).toBe('PASS')
  })
})

describe('evaluateProvenanceGate — structural completeness over critical-chain runs', () => {
  it('PASSes the canonical backbone (record + run agree by construction)', () => {
    const decision = evaluateProvenanceGate(backboneIr())
    expect(decision.status).toBe('PASS')
    expect(decision.report.execution_checked).toBe(1)
    expect(decision.report.failures).toEqual([])
  })

  it('EX-02 / EX-11: a critical-chain run without a record BLOCKS delivery', () => {
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('ReviewerFinding')) {
      ir.put(entry.kind, entry.value)
    }
    const decision = evaluateProvenanceGate(ir)
    expect(decision.status).toBe('BLOCKED')
    expect(decision.report.execution_checked).toBe(1)
    expect(decision.report.failures[0]).toMatchObject({
      run_id: 'RUN1',
      category: 'MISSING_EXECUTION',
      severity: 'CRITICAL',
    })
  })

  it('is vacuously PASS with no critical claims (executor ordering protects)', () => {
    const decision = evaluateProvenanceGate(new ModelingIr())
    expect(decision.status).toBe('PASS')
    expect(decision.report.execution_checked).toBe(0)
  })

  it('EX-07: a record whose seed differs from the run is ENVIRONMENT_MISMATCH', () => {
    const ir = backboneIr()
    // Forge a second record with a different seed (distinct execution_id
    // so the ingest is accepted; the conflicting-record finding is
    // expected separately in EX-10).
    const forged = executionRecord({ execution_id: 'EXEC-SEED', seed: 42 }) as Record<string, unknown>
    expect(ingestCapturedRecord(ir, forged).accepted).toBe(true)
    const manifest = buildExecutionManifest(ModelingIr.snapshot(ir)!)
    const report = auditExecutionProvenance(ModelingIr.snapshot(ir)!, manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'ENVIRONMENT_MISMATCH' && f.reason.includes('seed'))).toBe(true)
  })

  it('EX-10: two conflicting records for one run are CODE_MISMATCH (evidence disagrees with itself)', () => {
    const ir = backboneIr()
    expect(ingestCapturedRecord(ir, executionRecord({
      execution_id: 'EXEC2',
      stdout_hash: 'b'.repeat(64),
    }) as Record<string, unknown>).accepted).toBe(true)
    const manifest = buildExecutionManifest(ModelingIr.snapshot(ir)!)
    const report = auditExecutionProvenance(ModelingIr.snapshot(ir)!, manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'CODE_MISMATCH' && f.reason.includes('conflicting'))).toBe(true)
  })

  it('INV-3-D: seed null on a critical chain is ENVIRONMENT_MISMATCH', () => {
    const bare = bareChainStore()
    const nullSeed = executionRecord({ seed: null }) as Record<string, unknown>
    expect(ingestCapturedRecord(bare, nullSeed).accepted).toBe(true)
    const manifest = buildExecutionManifest(ModelingIr.snapshot(bare)!)
    const report = auditExecutionProvenance(ModelingIr.snapshot(bare)!, manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.reason.includes('seed null'))).toBe(true)
  })

  // ---------------------------------------------------------------------
  // Audit-side structural guards, pinned directly (mutation anchors for
  // P-01 / P-03 / P-04). The replay suite proves byte truth; these prove
  // the structural audit itself is load-bearing.
  // ---------------------------------------------------------------------

  it('P-01 anchor: a record freezing a different code digest is CODE_MISMATCH', () => {
    const bare = bareChainStore()
    expect(ingestCapturedRecord(bare, executionRecord({
      code_hash: `sha256:${'b'.repeat(64)}`,
    } as Record<string, unknown>)).accepted).toBe(true)
    const manifest = buildExecutionManifest(ModelingIr.snapshot(bare)!)
    const report = auditExecutionProvenance(ModelingIr.snapshot(bare)!, manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'CODE_MISMATCH' && f.execution_id === 'EXEC1')).toBe(true)
  })

  it('P-03 anchor: a captured non-zero exit is NON_ZERO_EXIT at the audit', () => {
    const bare = bareChainStore()
    expect(ingestCapturedRecord(bare, executionRecord({
      exit_status: 1,
    } as Record<string, unknown>)).accepted).toBe(true)
    const manifest = buildExecutionManifest(ModelingIr.snapshot(bare)!)
    const report = auditExecutionProvenance(ModelingIr.snapshot(bare)!, manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f => f.category === 'NON_ZERO_EXIT')).toBe(true)
  })

  it('P-04 anchor: a record captured against another declared environment is ENVIRONMENT_MISMATCH', () => {
    // The record freezes the default environment's fingerprint; the store's
    // run re-declares a drifted environment, so the audit-side check fires.
    const bare = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('ModelSpec')) {
      bare.put(entry.kind, entry.value)
    }
    expect(bare.put('RunArtifact', runArtifact({ environment: 'python 2.7 (drifted)' })).accepted).toBe(true)
    expect(bare.put('Result', result()).accepted).toBe(true)
    expect(bare.put('Claim', {
      claim_id: 'C1', text: 't', claim_type: 'NUMERIC', criticality: 'CRITICAL',
      numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
      evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1'],
    }).accepted).toBe(true)
    expect(ingestCapturedRecord(bare, executionRecord() as Record<string, unknown>).accepted).toBe(true)
    const manifest = buildExecutionManifest(ModelingIr.snapshot(bare)!)
    const report = auditExecutionProvenance(ModelingIr.snapshot(bare)!, manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f =>
      f.category === 'ENVIRONMENT_MISMATCH' && f.reason.includes('environment'))).toBe(true)
  })

  it('detects a tampered manifest before any per-run verdict (RT-X1 anchor)', () => {
    const ir = backboneIr()
    const manifest = buildExecutionManifest(ModelingIr.snapshot(ir)!)
    const tampered = { ...manifest, records: manifest.records.map(r => ({ ...r, exit_status: 1 })) }
    const report = auditExecutionProvenance(ModelingIr.snapshot(ir)!, tampered as typeof manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures[0]).toMatchObject({
      run_id: '<manifest>',
      category: 'MISSING_EXECUTION',
      severity: 'CRITICAL',
    })
    expect(report.execution_checked).toBe(0)
  })
})

describe('the executor enforces provenance end-to-end', () => {
  it('E2E: a full backbone WITHOUT an execution record is blocked with the provenance reason', async () => {
    const ir = new ModelingIr({ now: () => '2026-09-01T00:00:00.000Z' })
    for (const entry of chainThrough('ReviewerFinding')) {
      ir.put(entry.kind, entry.value)
    }
    // The refusal message is assembled by `evaluateDelivery` as
    // `critical_gate:<id>:<status>:<gate reason>`, and the gate reason
    // for a record-less critical chain is `execution provenance
    // blocked: N failure(s) [<run_id>:MISSING_EXECUTION]` (see
    // `executionProvenanceGate`). The older 'no execution provenance'
    // phrasing does not exist anywhere in `src/`, so the assertion
    // pins the stable parts instead of a sentence.
    const error: unknown = await runOnce(ir, 'fast').catch(caught => caught)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toMatch(/cannot deliver/)
    expect(message).toMatch(/provenance:BLOCKED/)
    expect(message).toMatch(/MISSING_EXECUTION/)
  })

  it('E2E: the canonical backbone (with its record) still delivers', async () => {
    const outcome = await runOnce(backboneIr(), 'fast')
    expect(outcome.run.status).toBe('completed')
    expect(outcome.manifest.finalArtifactId).toBeTruthy()
  })

  it('mode rule: EXPLORATORY is exempt, unknown modes fail closed', () => {
    expect(requiresIrBackbone('EXPLORATORY')).toBe(false)
    expect(requiresIrBackbone('fast')).toBe(true)
    expect(requiresIrBackbone('WEIRD-MODE')).toBe(true)
  })
})