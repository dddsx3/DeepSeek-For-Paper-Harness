/**
 * M-QUAL 阶段 A — config-consistency（M5 / N-1）六种处置的构造性反例.
 *
 * D-1 校核↔交付不一致 → 标注（两侧具体数值都在理由里）
 * D-2/D-6 交付 run 无配置证据 → config_evidence_missing（合并形态）
 * D-3 声明↔实际不符 → config_declared_actual_mismatch
 * D-4 跨段配置差未声明 → config_mismatch（cross-section 措辞）
 * D-5 已声明的受控算例差 → 零发现
 * 契约未激活（pre-M5 store）→ 零发现
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/config-consistency
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { CAPTURE_ATTESTATION, canonicalJson, declaredDependencyLockFingerprint, declaredEnvironmentFingerprint, sha256Hex } from '../../src/ir/index.ts'
import { configConsistencyFindings } from '../../src/delivery/config-consistency.ts'
import {
  dataArtifact,
  inputDataArtifact,
  requirementSpec,
  requiredOutput,
  constraintRequirement,
  problemSpec,
  assumptionSpec,
  variableSymbol,
  parameterSymbol,
  equationSpec,
  modelSpec,
  result,
  claim,
} from '../ir/fixtures.ts'
import type { IrKind } from '../../src/ir/index.ts'

/** Minimal quality store: one model, optional runs/configs/claims. */
function put(ir: ModelingIr, kind: IrKind, value: Record<string, unknown>): void {
  const verdict = ir.put(kind, value)
  if (!verdict.accepted) throw new Error(`put ${kind} failed: ${verdict.failures[0]?.reason}`)
}

interface RunSpec {
  readonly runId: string
  readonly configDt?: number
  readonly critical?: boolean
  readonly resultValue?: number
}

function qualityStore(
  runs: ReadonlyArray<RunSpec>,
  experimentRunIds: ReadonlyArray<string> = [],
  modelDt: number | null = 0.25,
): ModelingIr {
  const ir = new ModelingIr()
  put(ir, 'DataArtifact', dataArtifact())
  put(ir, 'DataArtifact', inputDataArtifact())
  put(ir, 'RequirementSpec', requirementSpec())
  put(ir, 'RequirementSpec', requiredOutput())
  put(ir, 'RequirementSpec', constraintRequirement())
  put(ir, 'ProblemSpec', problemSpec())
  put(ir, 'AssumptionSpec', assumptionSpec())
  put(ir, 'SymbolSpec', variableSymbol())
  put(ir, 'SymbolSpec', parameterSymbol())
  put(ir, 'SymbolSpec', parameterSymbol({ symbol_id: 'SYM-dt', token: 'dt' }))
  put(ir, 'EquationSpec', equationSpec())
  put(ir, 'ModelSpec', modelSpec({
    // modelDt = null ⇒ the model binds no parameter value, isolating the
    // C-1/D-5 config-pair semantics from C-2's declared-vs-actual comparison.
    parameter_refs: modelDt === null ? [] : [{ symbol_ref: 'SYM-dt', value: modelDt }],
  }))
  for (const run of runs) {
    put(ir, 'RunArtifact', {
      run_id: run.runId,
      model_ref: 'M1',
      code_ref: `file:///runs/${run.runId}/main.py`,
      input_data_refs: ['DA-IN'],
      environment: 'python 3.13',
      seed: 20260828,
      exit_status: 0,
      stdout_ref: `file:///runs/${run.runId}/stdout.txt`,
      stderr_ref: `file:///runs/${run.runId}/stderr.txt`,
      output_refs: [`file:///runs/${run.runId}/result.json`],
      code_hash: `sha256:${'a'.repeat(64)}`,
      input_hash: `sha256:${'a'.repeat(64)}`,
      output_hash: `sha256:${'a'.repeat(64)}`,
    })
    if (run.configDt !== undefined) {
      put(ir, 'NumericConfig', {
        config_id: `NC-${run.runId}`,
        run_ref: run.runId,
        discretization: [{ symbol_ref: 'SYM-dt', value: run.configDt }],
        physical: [],
        choices: [],
        property_set: null,
      })
    }
    if (run.critical === true) {
      put(ir, 'Result', result({
        result_id: `RES-${run.runId}`,
        run_ref: run.runId,
        value: run.resultValue ?? 0.731,
      }))
      put(ir, 'Claim', claim({
        claim_id: `C-${run.runId}`,
        evidence_refs: [`RES-${run.runId}`],
        result_refs: [`RES-${run.runId}`],
        numeric_binding: { result_ref: `RES-${run.runId}`, asserted_value: run.resultValue ?? 0.731, asserted_unit: 'm' },
      }))
    }
  }
  // Commit one internally-consistent ExecutionRecord per run so the
  // execution gate's own findings stay empty and ONLY the config findings
  // surface through the gate (the gate reason names the first finding).
  const snapshot = ModelingIr.snapshot(ir)
  const model = snapshot?.get('M1')?.value as Record<string, unknown> | undefined
  for (const run of runs) {
    const runValue = snapshot?.get(run.runId)?.value as Record<string, unknown>
    const outputRefs = runValue.output_refs as string[]
    const record = {
      execution_id: `EXEC-${run.runId}`,
      run_ref: run.runId,
      code_hash: runValue.code_hash,
      environment_hash: declaredEnvironmentFingerprint(runValue),
      runtime_fingerprint_hash: sha256Hex(canonicalJson({ runtime: 'deterministic-fake' })),
      dependency_lock_hash: declaredDependencyLockFingerprint(runValue, model),
      input_data_refs: [...(runValue.input_data_refs as string[])],
      output_refs: [...outputRefs],
      output_hash: sha256Hex(canonicalJson(Object.fromEntries(outputRefs.map(l => [l, sha256Hex('bytes')])))),
      stdout_hash: sha256Hex('execution ok\n'),
      stderr_hash: sha256Hex(''),
      exit_status: 0,
      seed: runValue.seed,
      started_at: '2026-09-01T00:00:00.000Z',
      finished_at: '2026-09-01T00:00:01.000Z',
    }
    const committed = ir.putExecutionRecord(record, CAPTURE_ATTESTATION)
    if (!committed.accepted) throw new Error(`record commit failed: ${committed.failures[0]?.reason}`)
  }
  if (experimentRunIds.length > 0) {
    put(ir, 'ExperimentSpec', {
      experiment_id: 'EX1',
      purpose: 'Controlled convergence check',
      input_data_refs: ['DA-IN'],
      parameter_sweep: [{ symbol_ref: 'SYM-dt', values: [0.25, 1] }],
      metrics: [],
      replications: 1,
      seed_policy: 'FIXED',
      expected_invariants: [],
      run_refs: [...experimentRunIds],
    })
  }
  return ir
}

const DELIVERY: RunSpec = { runId: 'RUN-D', configDt: 1, critical: true }
const CHECK: RunSpec = { runId: 'RUN-X', configDt: 0.25, critical: false }

describe('config-consistency — contract activation', () => {
  it('a pre-M5 store without any NumericConfig yields zero findings', () => {
    const ir = qualityStore([{ runId: 'RUN-D', critical: true }])
    expect(configConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })
})

describe('config-consistency — D-2/D-6 (delivery run without config evidence)', () => {
  it('a delivery run lacking a config is reported while the contract is active (构造性反例)', () => {
    // RUN-X (auxiliary, configured) activates the contract; RUN-D (delivery)
    // records none — the exact "校核有配置、交付没有"的漏配形态.
    const ir = qualityStore([{ runId: 'RUN-D', critical: true }, CHECK])
    const findings = configConsistencyFindings(ModelingIr.snapshot(ir))
    expect(findings.some(f => f.kind === 'config_evidence_missing' && f.runId === 'RUN-D')).toBe(true)
  })

  it('an auxiliary run without a config is NOT reported (只有交付链要求证据)', () => {
    const ir = qualityStore([DELIVERY, { runId: 'RUN-X', critical: false }])
    const findings = configConsistencyFindings(ModelingIr.snapshot(ir))
    expect(findings.some(f => f.kind === 'config_evidence_missing' && f.runId === 'RUN-X')).toBe(false)
  })
})

describe('config-consistency — D-1 (C-1: the check must not endorse a delivery it did not run at)', () => {
  it('a check-run at dt=0.25 vs delivery at dt=1 reports BOTH values (构造性反例)', () => {
    // 2026-A F1 major 的机械复现：校核 0.25 / 交付 1.0，两侧各自合法。
    const ir = qualityStore([{ ...DELIVERY, configDt: 4 }, CHECK])
    const findings = configConsistencyFindings(ModelingIr.snapshot(ir))
    const mismatch = findings.find(f => f.kind === 'config_mismatch' && f.field === 'discretization.SYM-dt')
    expect(mismatch).toBeDefined()
    if (mismatch !== undefined) {
      expect(mismatch.reason).toContain('4 vs 0.25')
      expect(mismatch.reason).toContain('RUN-X')
      expect(mismatch.reason).toContain('RUN-D')
    }
  })
})

describe('config-consistency — D-3 (C-2: declared vs actual)', () => {
  it('an emitted dt that contradicts the model\u2019s declared parameter is a record distortion (构造性反例)', () => {
    // 参考 minor [P-08][4]：JSON 记 dt=0.5 而主算例实跑 0.2 的 DPH 形态。
    const ir = qualityStore([DELIVERY], [], 0.25) // model declares dt=0.25, run emitted 1
    const findings = configConsistencyFindings(ModelingIr.snapshot(ir))
    const declared = findings.find(f => f.kind === 'config_declared_actual_mismatch')
    expect(declared).toBeDefined()
    if (declared !== undefined) {
      expect(declared.reason).toContain('1')
      expect(declared.reason).toContain('0.25')
    }
  })

  it('an emitted dt equal to the declared parameter raises nothing', () => {
    const ir = qualityStore([{ ...DELIVERY, configDt: 0.25 }], [], 0.25)
    expect(configConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })

  it('a one-ULP parse artifact (9.499999999999998 vs 9.5) is NOT record distortion (run-9 真实回归)', () => {
    // W11.5 A5 run-9: the model declared S-A = 9.5; the emitted config carried
    // 9.499999999999998 — the closest-double artifact of how the code derived
    // the value. Same quantity; the gate must not label it record distortion.
    const ir = qualityStore([{ ...DELIVERY, configDt: 9.499999999999998 }], [], 9.5)
    expect(configConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })

  it('a real value change beyond one ULP still reports (守卫不松动)', () => {
    // 0.25 → 0.3 is far beyond a ULP: the D-3 verdict must survive.
    const ir = qualityStore([{ ...DELIVERY, configDt: 0.3 }], [], 0.25)
    expect(configConsistencyFindings(ModelingIr.snapshot(ir)).some(f => f.kind === 'config_declared_actual_mismatch')).toBe(true)
  })
})

describe('config-consistency — D-4/D-5 (C-3: cross-section config differences)', () => {
  it('two delivery runs with differing configs and no experiment declaration are flagged (构造性反例)', () => {
    // modelDt = null ⇒ no C-2 noise; the pair difference is the only signal.
    const ir = qualityStore([
      { runId: 'RUN-D1', configDt: 0.25, critical: true },
      { runId: 'RUN-D2', configDt: 1, critical: true },
    ], [], null)
    const findings = configConsistencyFindings(ModelingIr.snapshot(ir))
    const mismatch = findings.find(f => f.kind === 'config_mismatch')
    expect(mismatch).toBeDefined()
    if (mismatch !== undefined) expect(mismatch.reason).toContain('cross-section')
  })

  it('the same difference declared via ExperimentSpec.run_refs passes (D-5 防误报)', () => {
    const ir = qualityStore([
      { runId: 'RUN-D1', configDt: 0.25, critical: true },
      { runId: 'RUN-D2', configDt: 1, critical: true },
    ], ['RUN-D1', 'RUN-D2'], null)
    expect(configConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })
})

describe('config-consistency — clean store and gate wiring', () => {
  it('a delivery + check pair with identical configs yields zero findings', () => {
    const ir = qualityStore([{ ...DELIVERY, configDt: 0.25 }, CHECK])
    expect(configConsistencyFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })

  it('the execution gate BLOCKs with the config prefix on an active-contract mismatch', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const ir = qualityStore([{ ...DELIVERY, configDt: 4 }, CHECK])
    const policy = buildDeliveryPolicy({ mode: 'fast', ir, runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.allowed).toBe(false)
    expect(decision.failures.some(f =>
      f.reason.startsWith('execution:BLOCKED:') && f.reason.includes('config_mismatch'),
    )).toBe(true)
  })

  it('the execution gate stays PASS on a pre-M5 store (既有判定不回归)', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const ir = qualityStore([{ runId: 'RUN-D', critical: true }])
    const policy = buildDeliveryPolicy({ mode: 'fast', ir, runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    expect(decision.failures.some(f => f.reason.startsWith('execution:BLOCKED:'))).toBe(false)
  })
})
