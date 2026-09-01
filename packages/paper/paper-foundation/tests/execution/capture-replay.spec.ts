/**
 * TASK 3 PHASE 2/3 — capture pipeline + replay verification.
 *
 * The capture layer is the ONLY producer of ExecutionRecords (INV-3-B);
 * the replay layer re-derives every digest from a fresh execution and
 * compares with the frozen record (INV-3-C). These specs pin both
 * contracts, including the real LocalProcessRunner end-to-end (C5
 * evidence: an actual node process, captured, replayed, verified).
 */
import { describe, expect, it } from 'vitest'
import {
  ModelingIr,
  canonicalJson,
  sha256Hex,
} from '../../src/ir/index.ts'
import {
  LocalProcessRunner,
  captureExecution,
  replayExecution,
  runIndependentExecutionAudit,
  type ExecutionOutcome,
  type ExecutionRunner,
  type LocalProcessRunnerConfig,
} from '../../src/execution/index.ts'
import { chainThrough, result, runArtifact } from '../ir/fixtures.ts'

const NOW = '2026-09-01T00:00:00.000Z'
const CODE = 'console.log("executing");\n'
const CODE_HASH = `sha256:${sha256Hex(CODE)}`
const OUTPUT_JSON = JSON.stringify({ mean_thickness: 0.731 })

/** Deterministic fake runner: same request in, same outcome out. */
function fakeRunner(overrides: Partial<ExecutionOutcome> = {}, tracker?: { calls: number }): ExecutionRunner {
  return {
    run: async () => {
      if (tracker) tracker.calls += 1
      return {
        exitStatus: 0,
        stdout: 'execution ok\n',
        stderr: '',
        outputFiles: [{ locator: 'file:///runs/RUN1/result.json', bytes: OUTPUT_JSON }],
        runtimeFacts: { runtime: 'deterministic-fake' },
        startedAt: NOW,
        finishedAt: '2026-09-01T00:00:01.000Z',
        ...overrides,
      }
    },
  }
}

const loadCode = async () => CODE

/** Closed store whose RUN1 declares `code` as its bytes. */
function buildExecutionStore(
  resultOverrides: Record<string, unknown> = {},
  runOverrides: Record<string, unknown> = {},
  modelOverrides: Record<string, unknown> = {},
) {
  const ir = new ModelingIr({ now: () => NOW })
  for (const entry of chainThrough('ModelSpec')) {
    const value = entry.kind === 'ModelSpec' ? { ...entry.value, ...modelOverrides } : entry.value
    expect(ir.put(entry.kind, value).accepted).toBe(true)
  }
  expect(ir.put('RunArtifact', runArtifact({ code_hash: CODE_HASH, ...runOverrides })).accepted).toBe(true)
  expect(ir.put('Result', result(resultOverrides)).accepted).toBe(true)
  expect(ir.put('Claim', {
    claim_id: 'C1',
    text: 'Mean ice thickness at the survey line is 0.731 m.',
    claim_type: 'NUMERIC',
    criticality: 'CRITICAL',
    numeric_binding: { result_ref: 'RES1', asserted_value: 0.731, asserted_unit: 'm' },
    evidence_refs: ['RES1'],
    result_refs: ['RES1'],
    model_refs: ['M1'],
  }).accepted).toBe(true)
  return ir
}

async function captureInto(ir: ReturnType<typeof buildExecutionStore>, runner: ExecutionRunner = fakeRunner()) {
  const captured = await captureExecution({ ir, runRef: 'RUN1', executionId: 'EXEC1', runner, loadCode, timeoutMs: 5_000 })
  expect(captured.ok, JSON.stringify(captured)).toBe(true)
  if (!captured.ok) throw new Error('unreachable')
  expect(ir.put('ExecutionRecord', captured.record).accepted).toBe(true)
  return captured.record
}

// ---------------------------------------------------------------------------
// PHASE 2 — capture
// ---------------------------------------------------------------------------

describe('captureExecution — the only producer of execution records', () => {
  it('captures a real outcome into a schema-valid, store-frozen record', async () => {
    const ir = buildExecutionStore()
    const record = await captureInto(ir)
    expect(record.code_hash).toBe(CODE_HASH)
    expect(record.exit_status).toBe(0)
    expect(record.stdout_hash).toBe(sha256Hex('execution ok\n'))
    expect(record.output_hash).toBe(sha256Hex(canonicalJson({
      'file:///runs/RUN1/result.json': sha256Hex(OUTPUT_JSON),
    })))
    expect(record.seed).toBe(20260828)
    expect(Object.isFrozen(ir.get('EXEC1'))).toBe(true)
  })

  it('refuses when the loaded code does not hash to the declared code_hash (EX-03 capture side)', async () => {
    const ir = buildExecutionStore()
    const captured = await captureExecution({
      ir, runRef: 'RUN1', executionId: 'EXEC1',
      runner: fakeRunner(), loadCode: async () => 'TAMPERED', timeoutMs: 5_000,
    })
    expect(captured.ok).toBe(false)
    if (!captured.ok) {
      expect(captured.failures[0]!.kind).toBe('CODE_MISMATCH')
    }
    expect(ir.has('EXEC1')).toBe(false)
  })

  it('refuses when the runner produces an output set that differs from output_refs', async () => {
    const ir = buildExecutionStore()
    const runner = fakeRunner({
      outputFiles: [{ locator: 'file:///elsewhere/out.json', bytes: OUTPUT_JSON }],
    })
    const captured = await captureExecution({ ir, runRef: 'RUN1', executionId: 'EXEC1', runner, loadCode, timeoutMs: 5_000 })
    expect(captured.ok).toBe(false)
    if (!captured.ok) expect(captured.failures[0]!.kind).toBe('OUTPUT_SET_MISMATCH')
  })

  it('refuses a run that is not a registered RunArtifact', async () => {
    const ir = buildExecutionStore()
    const captured = await captureExecution({ ir, runRef: 'RUN-GHOST', executionId: 'EXEC1', runner: fakeRunner(), loadCode, timeoutMs: 5_000 })
    expect(captured.ok).toBe(false)
    if (!captured.ok) expect(captured.failures[0]!.kind).toBe('RUN_MISSING')
  })

  it('never writes canonical state on refusal', async () => {
    const ir = buildExecutionStore()
    const before = ir.size
    await captureExecution({
      ir, runRef: 'RUN1', executionId: 'EXEC1',
      runner: fakeRunner(), loadCode: async () => 'TAMPERED', timeoutMs: 5_000,
    })
    expect(ir.size).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// PHASE 3 — replay
// ---------------------------------------------------------------------------

describe('replayExecution — byte-level truth against the frozen record', () => {
  it('replays a captured execution and re-derives every digest (all checks ok)', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const verdict = await replayExecution({ ir, executionId: 'EXEC1', runner: fakeRunner(), loadCode, timeoutMs: 5_000 })
    expect(verdict.ok, JSON.stringify(verdict.failures)).toBe(true)
    // The task book's 8 PASS conditions map to 7 recorded checks: the two
    // environment fingerprints are judged together and the two stream
    // digests are judged together.
    expect(verdict.checks.length).toBeGreaterThanOrEqual(7)
    expect(verdict.checks.every(c => c.ok)).toBe(true)
  })

  it('EX-01: a tampered Result.value diverges from the replayed output (OUTPUT_MISMATCH)', async () => {
    // Store A captures reality (0.731); store B re-ingests the SAME record
    // but declares Result.value 0.999. Replay extracts 0.731 from the
    // output document and refuses the claim that B freezes 0.999.
    const irA = buildExecutionStore()
    const record = await captureInto(irA)

    const irB = buildExecutionStore({ value: 0.999 })
    expect(irB.put('ExecutionRecord', record).accepted).toBe(true)
    const verdict = await replayExecution({ ir: irB, executionId: 'EXEC1', runner: fakeRunner(), loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.some(f => f.category === 'OUTPUT_MISMATCH' && f.reason.includes('0.999'))).toBe(true)
  })

  it('EX-03: substituted code bytes fail the replayed code-hash check', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const verdict = await replayExecution({
      ir, executionId: 'EXEC1', runner: fakeRunner(),
      loadCode: async () => 'SUBSTITUTED-BYTES', timeoutMs: 5_000,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.some(f => f.category === 'CODE_MISMATCH')).toBe(true)
  })

  it('EX-04: drifted runtime facts (measured environment) fail the replay', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const saboteur = fakeRunner({ runtimeFacts: { runtime: 'drifted-v99' } })
    const verdict = await replayExecution({ ir, executionId: 'EXEC1', runner: saboteur, loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.some(f => f.category === 'ENVIRONMENT_MISMATCH')).toBe(true)
  })

  it('EX-04b: a drifted declared environment string fails the replay', async () => {
    const irA = buildExecutionStore()
    const record = await captureInto(irA)
    // Store B re-declares the run's environment differently; the record
    // still freezes the original declared fingerprint.
    const irB = buildExecutionStore({}, { environment: 'python 2.7 (drifted)' })
    expect(irB.put('ExecutionRecord', record).accepted).toBe(true)
    const verdict = await replayExecution({ ir: irB, executionId: 'EXEC1', runner: fakeRunner(), loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.some(f => f.category === 'ENVIRONMENT_MISMATCH' && f.reason.includes('declared'))).toBe(true)
  })

  it('EX-04c: a drifted dependency lock fails the STRUCTURAL audit (audit-side guard)', async () => {
    // Store A captures against the original model; store B re-declares the
    // model's assumptions. The record still freezes A's dependency-lock
    // fingerprint, so the audit-side guard (not the replay) must fire.
    const irA = buildExecutionStore()
    const record = await captureInto(irA)
    const irB = buildExecutionStore({}, {}, { assumptions: ['drifted assumption'] })
    expect(irB.put('ExecutionRecord', record).accepted).toBe(true)
    const { buildExecutionManifest: buildManifest, auditExecutionProvenance: auditProvenance } =
      await import('../../src/execution/index.ts')
    const manifest = buildManifest(ModelingIr.snapshot(irB)!)
    const report = auditProvenance(ModelingIr.snapshot(irB)!, manifest)
    expect(report.status).toBe('FAIL')
    expect(report.failures.some(f =>
      f.category === 'ENVIRONMENT_MISMATCH' && f.reason.includes('dependency lock'))).toBe(true)
  })

  it('EX-05: a fabricated exit status / stdout fails the replay', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const liar = fakeRunner({ exitStatus: 1 })
    const verdict = await replayExecution({ ir, executionId: 'EXEC1', runner: liar, loadCode, timeoutMs: 5_000 })
    expect(verdict.failures.some(f => f.category === 'NON_ZERO_EXIT')).toBe(true)

    const loudLiar = fakeRunner({ stdout: 'everything is fine\n' })
    const verdict2 = await replayExecution({ ir, executionId: 'EXEC1', runner: loudLiar, loadCode, timeoutMs: 5_000 })
    expect(verdict2.failures.some(f => f.category === 'OUTPUT_MISMATCH' && f.reason.includes('stdout'))).toBe(true)
  })

  it('EX-06: replay divergence (different output bytes) fails', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const diverged = fakeRunner({
      outputFiles: [{ locator: 'file:///runs/RUN1/result.json', bytes: JSON.stringify({ mean_thickness: 9.99 }) }],
    })
    const verdict = await replayExecution({ ir, executionId: 'EXEC1', runner: diverged, loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.some(f => f.category === 'OUTPUT_MISMATCH')).toBe(true)
  })

  it('EX-06b: byte-level divergence with an identical parsed value is still caught (P-02 anchor)', async () => {
    // The replayed bytes differ only in JSON whitespace — the extracted
    // Result.value is unchanged, so ONLY the output-hash check can catch
    // this divergence. This pins that guard as load-bearing.
    const ir = buildExecutionStore()
    await captureInto(ir)
    const whitespaceDiverged = fakeRunner({
      outputFiles: [{ locator: 'file:///runs/RUN1/result.json', bytes: '{ "mean_thickness": 0.731 }' }],
    })
    const verdict = await replayExecution({ ir, executionId: 'EXEC1', runner: whitespaceDiverged, loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures).toHaveLength(1)
    expect(verdict.failures[0]).toMatchObject({ category: 'OUTPUT_MISMATCH' })
    expect(verdict.failures[0]!.reason).toContain('replayed outputs hash')
  })

  it('returns MISSING_EXECUTION for an unknown execution id', async () => {
    const ir = buildExecutionStore()
    const verdict = await replayExecution({ ir, executionId: 'EXEC-GHOST', runner: fakeRunner(), loadCode, timeoutMs: 5_000 })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures[0]!.category).toBe('MISSING_EXECUTION')
  })
})

// ---------------------------------------------------------------------------
// Independent auditor (C5/C9) — structural + replay merged
// ---------------------------------------------------------------------------

describe('runIndependentExecutionAudit — producer != auditor', () => {
  it('PASSes a captured store end-to-end, with replays attached', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const audit = await runIndependentExecutionAudit({
      ir, runner: fakeRunner(), loadCode, timeoutMs: 5_000,
    })
    expect(audit.report.status).toBe('PASS')
    expect(audit.report.execution_checked).toBe(1)
    expect(audit.replays).toHaveLength(1)
    expect(audit.replays[0]!.ok).toBe(true)
  })

  it('FAILs when replay diverges even though the structural audit is green', async () => {
    const ir = buildExecutionStore()
    await captureInto(ir)
    const diverged = fakeRunner({ stdout: 'silent divergence\n' })
    const audit = await runIndependentExecutionAudit({
      ir, runner: diverged, loadCode, timeoutMs: 5_000,
    })
    expect(audit.report.status).toBe('FAIL')
    expect(audit.report.failures.some(f => f.category === 'OUTPUT_MISMATCH' && f.reason.startsWith('replay:'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C5 evidence — the REAL LocalProcessRunner end-to-end lives in
// `tests/execution/local-runner.spec.ts` (kept out of the mutation
// runner's targeted suite: a 30s child-process smoke under repeated
// fork pressure is a machine-flake source, and a flaky timeout can mask
// as a false mutation kill).
// ---------------------------------------------------------------------------