/**
 * TASK 3 PHASE 5 — External attack suite RT-X1..RT-X4 + the EX corpus.
 *
 * Roles (task book §9 + PHASE 5):
 *
 *   RT-X1  Capture Forger      — fabricate schema-valid records; show the
 *                                structural gate's honest boundary (it
 *                                passes) and the replay's byte-level refusal.
 *   RT-X2  Replay Saboteur     — tamper the runner/replay environment; every
 *                                drift is caught (EX-04/05/06).
 *   RT-X3  Provenance Omission — hide runs from the gate; wrong-run records;
 *                                partial records (EX-02/08/11).
 *   RT-X4  Gate/Workflow       — gate identity, criticality, mode rules,
 *                                executor E2E refusals (EX-12).
 *
 * Every test asserts the observable verdict; an attack that succeeds is a
 * gap, an attack that is blocked is coverage. No production edits here.
 */
import { describe, expect, it } from 'vitest'
import { ModelingIr, canonicalJson, requiresIrBackbone, sha256Hex } from '../../src/ir/index.ts'
import {
  captureExecution,
  evaluateProvenanceGate,
  ingestCapturedRecord,
  replayExecution,
  runIndependentExecutionAudit,
  type ExecutionOutcome,
  type ExecutionRunner,
} from '../../src/execution/index.ts'
import { chainThrough, executionRecord, result, runArtifact } from '../ir/fixtures.ts'

const NOW = '2026-09-01T00:00:00.000Z'
const CODE = 'console.log("executing");\n'
const CODE_HASH = `sha256:${sha256Hex(CODE)}`
const OUTPUT_JSON = JSON.stringify({ mean_thickness: 0.731 })

function fakeRunner(overrides: Partial<ExecutionOutcome> = {}): ExecutionRunner {
  return {
    run: async () => ({
      exitStatus: 0,
      stdout: 'execution ok\n',
      stderr: '',
      outputFiles: [{ locator: 'file:///runs/RUN1/result.json', bytes: OUTPUT_JSON }],
      runtimeFacts: { runtime: 'deterministic-fake' },
      startedAt: NOW,
      finishedAt: '2026-09-01T00:00:01.000Z',
      ...overrides,
    }),
  }
}

const loadCode = async () => CODE

/** Closed critical chain whose RUN1 declares `code`. */
function buildExecutionStore() {
  const ir = new ModelingIr({ now: () => NOW })
  for (const entry of chainThrough('ModelSpec')) {
    ir.put(entry.kind, entry.value)
  }
  expect(ir.put('RunArtifact', runArtifact({ code_hash: CODE_HASH })).accepted).toBe(true)
  expect(ir.put('Result', result()).accepted).toBe(true)
  expect(ir.put('Claim', {
    claim_id: 'C1',
    text: 't', claim_type: 'NUMERIC', criticality: 'CRITICAL',
    numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    evidence_refs: ['RES1'], result_refs: ['RES1'], model_refs: ['M1'],
  }).accepted).toBe(true)
  return ir
}

async function captureInto(ir: ReturnType<typeof buildExecutionStore>, runner: ExecutionRunner = fakeRunner()) {
  const captured = await captureExecution({ ir, runRef: 'RUN1', executionId: 'EXEC1', runner, loadCode, timeoutMs: 5_000 })
  expect(captured.ok).toBe(true)
  if (!captured.ok) throw new Error('unreachable')
  expect(ingestCapturedRecord(ir, captured.record).accepted).toBe(true)
}

// ---------------------------------------------------------------------------
// RT-X1 — Capture Forger
// ---------------------------------------------------------------------------

describe('RT-X1 — Capture Forger', () => {
  /** An honestly captured record, with its byte digests then fabricated —
   *  the forger can copy every *declared* fingerprint but cannot know the
   *  bytes a real run produces. */
  async function forgedRecord(): Promise<Record<string, unknown>> {
    const scratch = buildExecutionStore()
    const captured = await captureExecution({
      ir: scratch, runRef: 'RUN1', executionId: 'EXEC1', runner: fakeRunner(), loadCode, timeoutMs: 5_000,
    })
    expect(captured.ok).toBe(true)
    if (!captured.ok) throw new Error('unreachable')
    return {
      ...captured.record,
      stdout_hash: sha256Hex('completely fabricated\n'),
      output_hash: sha256Hex(canonicalJson({
        'file:///runs/RUN1/result.json': sha256Hex('{"mean_thickness": 0.0}'),
      })),
    }
  }

  it('RT-X1-01: a hand-forged record passes the STRUCTURAL gate…', async () => {
    // The structural gate cannot see bytes — this is its honest, documented
    // boundary (the task book D8 layering: gate = cheap structural,
    // replay = byte truth).
    const ir = buildExecutionStore()
    expect(ingestCapturedRecord(ir, await forgedRecord()).accepted).toBe(true)
    expect(evaluateProvenanceGate(ir).status).toBe('PASS')
  })

  it('RT-X1-02: …but the replay audit refuses the forged byte digests', async () => {
    const ir = buildExecutionStore()
    expect(ingestCapturedRecord(ir, await forgedRecord()).accepted).toBe(true)
    const audit = await runIndependentExecutionAudit({
      ir, runner: fakeRunner(), loadCode, timeoutMs: 5_000,
    })
    expect(audit.report.status).toBe('FAIL')
    expect(audit.report.failures.some(f =>
      f.category === 'OUTPUT_MISMATCH' && f.reason.startsWith('replay:'))).toBe(true)
  })

  it('RT-X1-03: a fabricated exit_status is refused by the replay', async () => {
    const ir = buildExecutionStore()
    expect(ingestCapturedRecord(ir, executionRecord({
      execution_id: 'EXEC-LIE',
      exit_status: 0,
      stdout_hash: sha256Hex('i swear it worked\n'),
    } as Record<string, unknown>)).accepted).toBe(true)
    const audit = await runIndependentExecutionAudit({
      ir, runner: fakeRunner(), loadCode, timeoutMs: 5_000,
    })
    // The real runner exits 0 with 'execution ok\n' — the forged record's
    // stdout digest cannot reproduce.
    expect(audit.report.status).toBe('FAIL')
  })

  it('RT-X1-04: the forged pipeline cannot touch canonical state on refusal', async () => {
    const ir = buildExecutionStore()
    const before = ir.size
    await captureExecution({
      ir, runRef: 'RUN1', executionId: 'EXEC1',
      runner: fakeRunner(), loadCode: async () => 'FORGED', timeoutMs: 5_000,
    })
    expect(ir.size).toBe(before)
    expect(ir.has('EXEC1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RT-X2 — Replay Saboteur
// ---------------------------------------------------------------------------

describe('RT-X2 — Replay Saboteur', () => {
  it('RT-X2-01: swapping the runtime between capture and replay is caught', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const drifted = fakeRunner({ runtimeFacts: { runtime: 'other-runtime-vX' } })
    const verdict = await replayExecution({ ir, executionId: 'EXEC1', runner: drifted, loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.some(f => f.category === 'ENVIRONMENT_MISMATCH')).toBe(true)
  })

  it('RT-X2-02: silent output mutation between capture and replay is caught', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const mutator = fakeRunner({
      outputFiles: [{ locator: 'file:///runs/RUN1/result.json', bytes: JSON.stringify({ mean_thickness: 0.731000001 }) }],
    })
    const verdict = await replayExecution({ ir, executionId: 'EXEC1', runner: mutator, loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.some(f => f.category === 'OUTPUT_MISMATCH')).toBe(true)
  })

  it('RT-X2-03: the saboteur cannot make replay throw its way to a PASS', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const hostile: ExecutionRunner = {
      run: async () => {
        throw new Error('sabotage')
      },
    }
    // The replay propagates the runner crash — the auditor's wrapper turns
    // a crashed replay into a FAIL verdict, never a PASS.
    const audit = await runIndependentExecutionAudit({
      ir, runner: hostile, loadCode, timeoutMs: 5_000,
    })
    // The runner throws inside replayExecution, which is awaited inside the
    // audit helper: the audit itself surfaces the fault as a failure.
    expect(audit.report.status).toBe('FAIL')
    expect(audit.report.failures.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// RT-X3 — Provenance Omission
// ---------------------------------------------------------------------------

describe('RT-X3 — Provenance Omission', () => {
  it('RT-X3-01 (EX-11): a critical-chain run with no record cannot hide', () => {
    const ir = buildExecutionStore()
    const decision = evaluateProvenanceGate(ir)
    expect(decision.status).toBe('BLOCKED')
    expect(decision.report.failures[0]).toMatchObject({
      run_id: 'RUN1', category: 'MISSING_EXECUTION', severity: 'CRITICAL',
    })
  })

  it('RT-X3-02: a record attached to the WRONG run leaves the right run uncovered', () => {
    const ir = buildExecutionStore()
    expect(ir.put('RunArtifact', runArtifact({ run_id: 'RUN2', code_hash: CODE_HASH })).accepted).toBe(true)
    // The forger registers a record for RUN2 (irrelevant) hoping the gate
    // counts it toward RUN1. The gate walks per-run: RUN1 still missing.
    expect(ingestCapturedRecord(ir, executionRecord({
      execution_id: 'EXEC-RUN2', run_ref: 'RUN2',
    } as Record<string, unknown>)).accepted).toBe(true)
    const decision = evaluateProvenanceGate(ir)
    expect(decision.status).toBe('BLOCKED')
    expect(decision.report.failures.some(f =>
      f.run_id === 'RUN1' && f.category === 'MISSING_EXECUTION')).toBe(true)
  })

  it('RT-X3-03 (EX-08): a partial record (missing digests) dies at the schema', () => {
    const ir = buildExecutionStore()
    const partial = executionRecord() as Record<string, unknown>
    delete (partial as { stdout_hash?: string }).stdout_hash
    expect(ir.put('ExecutionRecord', partial).accepted).toBe(false)
  })

  it('RT-X3-04: non-critical claims (with rationale) place no provenance obligation', () => {
    // TASK 3.R1 / INV-3-I: a QUALITATIVE claim that declares
    // NON_CRITICAL MUST carry a `criticality_rationale` (the legacy
    // "NON_CRITICAL QUALITATIVE without rationale" path is closed at
    // the schema boundary). With the rationale in place, the chain
    // carries no critical claim, so the provenance gate is vacuously
    // PASS — no runs are obligation-bearing.
    const ir = new ModelingIr({ now: () => NOW })
    for (const entry of chainThrough('RunArtifact')) {
      ir.put(entry.kind, entry.value)
    }
    expect(ir.put('Result', result()).accepted).toBe(true)
    expect(ir.put('Claim', {
      claim_id: 'C1', text: 'draft', claim_type: 'QUALITATIVE',
      criticality: 'NON_CRITICAL',
      criticality_rationale: 'unreviewed draft note',
      numeric_binding: null,
      evidence_refs: [], result_refs: [], model_refs: [],
    }).accepted).toBe(true)
    // No critical claims → no runs are obligation-bearing.
    const decision = evaluateProvenanceGate(ir)
    expect(decision.status).toBe('PASS')
    expect(decision.report.execution_checked).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// RT-X4 — Gate / Workflow
// ---------------------------------------------------------------------------

describe('RT-X4 — Gate / Workflow', () => {
  it('RT-X4-01 (EX-12): unknown workflow modes fail closed (gate enforced)', () => {
    expect(requiresIrBackbone('WEIRD')).toBe(true)
    expect(requiresIrBackbone(' fast ')).toBe(true)
    expect(requiresIrBackbone('EXPLORATORY')).toBe(false)
  })

  it('RT-X4-02: a store that cannot prove its identity blocks the gate', () => {
    const impostor = { get: () => undefined, list: () => [] } as unknown as ModelingIr
    const decision = evaluateProvenanceGate(impostor)
    expect(decision.status).toBe('BLOCKED')
    expect(decision.report.failures[0]!.run_id).toBe('$store')
  })

  it('RT-X4-03: the gate verdict is deterministic for the same store', () => {
    const ir = buildExecutionStore()
    expect(evaluateProvenanceGate(ir)).toEqual(evaluateProvenanceGate(ir))
  })

  it('RT-X4-04: the gate never mutates canonical state', () => {
    const ir = buildExecutionStore()
    const before = ir.size
    evaluateProvenanceGate(ir)
    expect(ir.size).toBe(before)
  })
})