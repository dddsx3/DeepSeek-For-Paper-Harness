/**
 * M-QUAL 阶段 D — bench/quality/cumcm-2026-A 回归基准（golden corpus）.
 *
 * 把参考工作流 2026-A 从"一次性实测"变成"每次回归的标尺"：
 *   - 能力阈值库 11 条全部 schema 合法，合格 Result 全部 PASS；
 *   - 四类参考侧典型退化（N 不足 / dt 超稳定限 / 越界 / 校核偏差超限）
 *     全部 raise——参考实测数字（state_len<101、margin 0.886、max_C 2.5520、
 *     dev 1.1945e-3）直接作为退化臂的输入；
 *   - F1 major 的机械复现：校核 run dt=0.25 vs 交付 run dt=1.0 →
 *     config_mismatch；修正后零发现。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/quality/cumcm-2026-a
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { CAPTURE_ATTESTATION, canonicalJson, declaredDependencyLockFingerprint, declaredEnvironmentFingerprint, sha256Hex } from '../../src/ir/index.ts'
import { capabilitySpecSchema } from '../../src/ir/capability-spec.ts'
import { capabilityThresholdFindings } from '../../src/delivery/capability-thresholds.ts'
import { configConsistencyFindings } from '../../src/delivery/config-consistency.ts'
import { dataArtifact, inputDataArtifact, requirementSpec, requiredOutput, constraintRequirement, problemSpec, assumptionSpec, variableSymbol, parameterSymbol, equationSpec, modelSpec, result, claim, runArtifact } from '../ir/fixtures.ts'
import type { CapabilitySpec } from '../../src/ir/capability-spec.ts'

const BENCH = '../../../../../bench/quality/cumcm-2026-A'
const LIBRARY = JSON.parse(
  readFileSync(fileURLToPath(new URL(`${BENCH}/capability-library.json`, import.meta.url)), 'utf8'),
) as { capabilities: Record<string, unknown>[] }

/** 参考侧合格值（problem-faithful.md 的"数值事实"表；出处逐条可追溯）。 */
const GOOD_VALUES: Record<string, number> = {
  state_len: 200,
  criterion_max: 0.149,
  radius_shrink_cm: 0.802,
  analytic_max_dev_degC: 2.9459e-4,
  max_C: 2.5498,
  max_T: 49.9664,
  D_at_ref: 1.3471e-8,
  center_C_drift_1800s: 7.63e-6,
  stability_margin: 4.43, // limit 0.8863 / dt 0.2
  dry_matter_drift: 1e-9,
  t_star_hours: 57.378888,
}

function put(ir: ModelingIr, kind: Parameters<ModelingIr['put']>[0], value: Record<string, unknown>): void {
  const verdict = ir.put(kind, value)
  if (!verdict.accepted) throw new Error(`put ${kind} failed: ${verdict.failures[0]?.reason}`)
}

/** The golden delivery store: backbone + one Result per library subject + all capabilities. */
function goldenStore(valueOverrides: Record<string, number> = {}): ModelingIr {
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
  put(ir, 'ModelSpec', modelSpec())
  put(ir, 'RunArtifact', { ...runArtifact(), run_id: 'RUN-DELIVERY' })
  for (const [resultId, value] of Object.entries({ ...GOOD_VALUES, ...valueOverrides })) {
    put(ir, 'Result', result({ result_id: resultId, value, run_ref: 'RUN-DELIVERY' }))
  }
  for (const capability of LIBRARY.capabilities) {
    put(ir, 'CapabilitySpec', capability)
  }
  return ir
}

describe('cumcm-2026-A golden — 能力阈值库（阶段 B）', () => {
  it(`全部 ${LIBRARY.capabilities.length} 条能力 schema 合法（judge 全 machine、阈值非空）`, () => {
    expect(LIBRARY.capabilities.length).toBe(11)
    for (const capability of LIBRARY.capabilities) {
      const parsed = capabilitySpecSchema.safeParse(capability)
      expect(parsed.success, `capability ${String(capability.capability_id)} parses`).toBe(true)
    }
  })

  it('库内每条 subject_ref 都能绑定到 golden store 的 Result（护栏：库与 store 漂移即失败）', () => {
    const snapshot = ModelingIr.snapshot(goldenStore())
    if (snapshot === null) throw new Error('golden store failed')
    for (const capability of LIBRARY.capabilities) {
      const spec = capability as unknown as CapabilitySpec
      for (const threshold of spec.falsifiable_thresholds) {
        const resultId = threshold.subject_ref.replace(/^Result:/, '')
        expect(snapshot.get(resultId)?.kind, `${spec.capability_id} subject ${resultId}`).toBe('Result')
      }
    }
  })

  it('合格 Result 上零发现（库不是恒红的量具）', () => {
    expect(capabilityThresholdFindings(ModelingIr.snapshot(goldenStore()))).toHaveLength(0)
  })
})

describe('cumcm-2026-A golden — 四类退化全部 raise（负对照）', () => {
  const degradations: Array<[string, string, number, string]> = [
    ['N 不足', 'state_len', 60, 'CAP-2026A-DISTRIBUTED'],
    ['dt 超稳定限', 'stability_margin', 0.886, 'CAP-2026A-STABILITY'],
    ['越界（参考实测 2.5520 > 2.55）', 'max_C', 2.552, 'CAP-2026A-BOUND-C'],
    ['校核偏差超限（交付 dt=1.0 实测 1.1945e-3）', 'analytic_max_dev_degC', 1.1945e-3, 'CAP-2026A-ANALYTIC-DEV'],
  ]
  for (const [name, subject, value, capabilityId] of degradations) {
    it(`退化：${name} → ${capabilityId} violation`, () => {
      const ir = goldenStore({ [subject]: value })
      const findings = capabilityThresholdFindings(ModelingIr.snapshot(ir))
      const violation = findings.find(f => f.capabilityId === capabilityId)
      expect(violation, `${capabilityId} must raise`).toBeDefined()
      expect(violation?.kind).toBe('capability_threshold_violation')
      expect(violation?.reason).toContain(String(value))
    })
  }
})

// ---------------------------------------------------------------------------
// F1 major 的机械复现（阶段 A）：校核 dt=0.25 / 交付 dt=1.0。
// ---------------------------------------------------------------------------

function configStore(deliveryDt: number, modelDt: number | null = 0.25): ModelingIr {
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
    parameter_refs: modelDt === null ? [] : [{ symbol_ref: 'SYM-dt', value: modelDt }],
  }))
  const runs = [
    { runId: 'RUN-CHECK', dt: 0.25, critical: false },
    { runId: 'RUN-DELIVERY', dt: deliveryDt, critical: true },
  ]
  for (const run of runs) {
    put(ir, 'RunArtifact', { ...runArtifact(), run_id: run.runId })
    put(ir, 'NumericConfig', {
      config_id: `NC-${run.runId}`,
      run_ref: run.runId,
      discretization: [{ symbol_ref: 'SYM-dt', value: run.dt }],
      physical: [],
      choices: [],
      property_set: null,
    })
    if (run.critical) {
      put(ir, 'Result', result({ run_ref: run.runId }))
      put(ir, 'Claim', claim({
        evidence_refs: ['RES1'],
        result_refs: ['RES1'],
      }))
    }
  }
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
  return ir
}

describe('cumcm-2026-A golden — 配置错配（F1 major 复现，阶段 A）', () => {
  it('校核 dt=0.25 / 交付 dt=1.0 → config_mismatch，理由携带两侧数值', () => {
    const findings = configConsistencyFindings(ModelingIr.snapshot(configStore(1)))
    const mismatch = findings.find(f => f.kind === 'config_mismatch')
    expect(mismatch).toBeDefined()
    if (mismatch !== undefined) {
      expect(mismatch.reason).toContain('0.25')
      expect(mismatch.reason).toContain('1')
      expect(mismatch.reason).toContain('RUN-CHECK')
      expect(mismatch.reason).toContain('RUN-DELIVERY')
    }
  })

  it('修正后（交付 dt=0.25）零发现', () => {
    expect(configConsistencyFindings(ModelingIr.snapshot(configStore(0.25)))).toHaveLength(0)
  })

  it('声明↔实际（C-2）：交付实跑 dt=1 而模型声明 0.25 → config_declared_actual_mismatch', () => {
    const findings = configConsistencyFindings(ModelingIr.snapshot(configStore(1)))
    expect(findings.some(f => f.kind === 'config_declared_actual_mismatch')).toBe(true)
  })
})
