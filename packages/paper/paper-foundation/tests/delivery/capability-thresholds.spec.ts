/**
 * M-QUAL 阶段 B — capability-thresholds 引擎（E-1/E-2/E-3 落点）.
 *
 * 负对照：四类参考侧典型退化全部 raise（M-QUAL H-B/H-C 的退出判据）——
 * N 不足 / dt 超稳定限 / 越界 / 校核偏差超限。外加 fail-closed 三态：
 * subject 不可解析、系列算子未支持、比较算子缺阈值——**绝不静默通过**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/capability-thresholds
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { capabilityThresholdFindings } from '../../src/delivery/capability-thresholds.ts'
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
  runArtifact,
  result,
} from '../ir/fixtures.ts'
import type { CapabilitySpec } from '../../src/ir/capability-spec.ts'

function put(ir: ModelingIr, kind: Parameters<ModelingIr['put']>[0], value: Record<string, unknown>): void {
  const verdict = ir.put(kind, value)
  if (!verdict.accepted) throw new Error(`put ${kind} failed: ${verdict.failures[0]?.reason}`)
}

/** A backbone store (no CRITICAL claim needed — the engine walks capabilities). */
function baseStore(): ModelingIr {
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
  put(ir, 'EquationSpec', equationSpec())
  put(ir, 'ModelSpec', modelSpec())
  put(ir, 'RunArtifact', runArtifact())
  return ir
}

/** Bind one Result value and one capability asserting a threshold on it. */
function storeWith(capability: CapabilitySpec, resultId: string, value: number): ModelingIr {
  const ir = baseStore()
  put(ir, 'Result', result({ result_id: resultId, value }))
  const withResults: CapabilitySpec = {
    ...capability,
    falsifiable_thresholds: capability.falsifiable_thresholds.map(t => ({
      ...t,
      subject_ref: `Result:${resultId}`,
    })),
  }
  put(ir, 'CapabilitySpec', withResults)
  return ir
}

function threshold(operator: CapabilitySpec['falsifiable_thresholds'][number]['operator'], over: {
  threshold?: number | null
  tolerance?: number | null
  unit?: string
} = {}): CapabilitySpec['falsifiable_thresholds'][number] {
  return {
    subject_ref: 'Result:RES1',
    operator,
    threshold: over.threshold ?? null,
    tolerance: over.tolerance ?? null,
    unit: over.unit ?? 'dimensionless',
    at_config_ref: null,
  }
}

function capability(id: string, thresholds: CapabilitySpec['falsifiable_thresholds']): CapabilitySpec {
  return {
    capability_id: id,
    family: 'F1',
    scope_ref: 'R1',
    name: `capability ${id}`,
    criterion: 'test capability',
    judge: 'machine',
    machine_check: 'CONSTRAINT',
    falsifiable_thresholds: thresholds,
    source_anchor: 'R1',
    required_output_ref: null,
    verification_depth: 'SUBSTANTIVE',
    existence_disclaimer: null,
    probe_refs: [],
    boundary_refs: [],
  }
}

describe('capability-thresholds — 四类退化全部 raise（负对照）', () => {
  it('退化 1：N 不足（state_len=60 < 101）被抓', () => {
    const ir = storeWith(capability('CAP-N', [threshold('GE', { threshold: 101, unit: 'nodes' })]), 'RES1', 60)
    const findings = capabilityThresholdFindings(ModelingIr.snapshot(ir))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('capability_threshold_violation')
    expect(findings[0]?.reason).toContain('60')
  })

  it('退化 2：dt 超稳定限（margin=0.886 < 1）被抓', () => {
    const ir = storeWith(capability('CAP-STAB', [threshold('GE', { threshold: 1, unit: 'dimensionless' })]), 'RES1', 0.886)
    const findings = capabilityThresholdFindings(ModelingIr.snapshot(ir))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('capability_threshold_violation')
  })

  it('退化 3：越界（max_C=2.552 > 2.55，参考实测值）被抓', () => {
    const ir = storeWith(capability('CAP-BOUND', [threshold('LE', { threshold: 2.55, unit: 'kg/kg' })]), 'RES1', 2.552)
    const findings = capabilityThresholdFindings(ModelingIr.snapshot(ir))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('capability_threshold_violation')
  })

  it('退化 4：校核偏差超限（dev=1.1945e-3 > 1e-3）被抓', () => {
    const ir = storeWith(capability('CAP-DEV', [threshold('LT', { threshold: 1e-3, unit: 'degC' })]), 'RES1', 1.1945e-3)
    const findings = capabilityThresholdFindings(ModelingIr.snapshot(ir))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('capability_threshold_violation')
  })

  it('合格值全部通过（state_len=200 / margin=1.13 / max_C=2.5498 / dev=2.9459e-4）', () => {
    const cases: Array<[string, ReturnType<typeof threshold>, number]> = [
      ['RES1', threshold('GE', { threshold: 101, unit: 'nodes' }), 200],
      ['RES2', threshold('GE', { threshold: 1, unit: 'dimensionless' }), 1.13],
      ['RES3', threshold('LE', { threshold: 2.55, unit: 'kg/kg' }), 2.5498],
      ['RES4', threshold('LT', { threshold: 1e-3, unit: 'degC' }), 2.9459e-4],
    ]
    for (const [resultId, th, value] of cases) {
      const ir = baseStore()
      put(ir, 'Result', result({ result_id: resultId, value }))
      put(ir, 'CapabilitySpec', capability('CAP-OK', [{ ...th, subject_ref: `Result:${resultId}` }]))
      expect(capabilityThresholdFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
    }
  })
})

describe('capability-thresholds — E-1 容差层（ABS_LT / REL_LT）', () => {
  it('REL_LT 在容差内通过、在容差外 raise（开尔文判据形态）', () => {
    const kelvin = capability('CAP-K', [threshold('REL_LT', { threshold: 1.3471e-8, tolerance: 1e-3, unit: 'm^2/s' })])
    const ok = storeWith(kelvin, 'RES1', 1.3470e-8) // ~7e-5 relative deviation
    expect(capabilityThresholdFindings(ModelingIr.snapshot(ok))).toHaveLength(0)
    const bad = storeWith(kelvin, 'RES1', 1.5e-8) // ~11% off
    expect(capabilityThresholdFindings(ModelingIr.snapshot(bad))).toHaveLength(1)
  })

  it('ABS_LT 按绝对偏差比较', () => {
    const abs = capability('CAP-A', [threshold('ABS_LT', { threshold: 28.0, tolerance: 0.05, unit: 'degC' })])
    const ok = storeWith(abs, 'RES1', 28.03)
    expect(capabilityThresholdFindings(ModelingIr.snapshot(ok))).toHaveLength(0)
    const bad = storeWith(abs, 'RES1', 28.2)
    expect(capabilityThresholdFindings(ModelingIr.snapshot(bad))).toHaveLength(1)
  })
})

describe('capability-thresholds — fail-closed 三态（绝不静默通过）', () => {
  it('subject 不可解析 → unresolvable finding（防御分支：hand-built map 直测引擎）', () => {
    // The store REFUSES an unresolvable subject at admission (refs.ts), so
    // this branch is only reachable via a bypassed boundary — exactly the
    // scenario the defense exists for. Exercise the engine directly.
    const fakeRecord = { kind: 'CapabilitySpec', value: capability('CAP-X', [threshold('GE', { threshold: 1 })]), ingestedAt: '2026-09-19T00:00:00.000Z' }
    const fakeStore = new Map<string, unknown>([['CAP-X', fakeRecord]])
    const findings = capabilityThresholdFindings(fakeStore as Parameters<typeof capabilityThresholdFindings>[0])
    expect(findings[0]?.kind).toBe('capability_threshold_unresolvable')
  })

  it('系列算子 → unsupported finding（数据通道未落地，fail-closed）', () => {
    const ir = storeWith(capability('CAP-MAX', [threshold('MAX_OVER_AXIS', { threshold: 0.15 })]), 'RES1', 0.731)
    const findings = capabilityThresholdFindings(ModelingIr.snapshot(ir))
    expect(findings[0]?.kind).toBe('capability_threshold_unsupported')
  })

  it('比较算子缺阈值 → missing_value finding（防御分支：schema 已拒 null 阈值，直测引擎）', () => {
    // The schema refuses a null threshold on LT, so this branch is reachable
    // only through a bypassed boundary — exercise the engine directly.
    const fakeRecord = { kind: 'CapabilitySpec', value: capability('CAP-NULL', [threshold('LT')]), ingestedAt: '2026-09-19T00:00:00.000Z' }
    const resultRecord = { kind: 'Result', value: { result_id: 'RES1', run_ref: 'RUN1', name: 'x', value: 0.731, unit: 'm', uncertainty: null, source_location: 'loc' }, ingestedAt: '2026-09-19T00:00:00.000Z' }
    const fakeStore = new Map<string, unknown>([['CAP-NULL', fakeRecord], ['RES1', resultRecord]])
    const findings = capabilityThresholdFindings(fakeStore as Parameters<typeof capabilityThresholdFindings>[0])
    expect(findings[0]?.kind).toBe('capability_threshold_missing_value')
  })

  it('semantic 能力天然跳过（人读判据不进门）', () => {
    const ir = baseStore()
    put(ir, 'Result', result())
    const semantic = { ...capability('CAP-SEM', []), judge: 'semantic' as const, machine_check: null }
    put(ir, 'CapabilitySpec', semantic)
    expect(capabilityThresholdFindings(ModelingIr.snapshot(ir))).toHaveLength(0)
  })
})
