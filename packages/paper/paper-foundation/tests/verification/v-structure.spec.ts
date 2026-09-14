/**
 * W6 — verification layer V1–V4 structural-check tests.
 *
 * PRD §6.1 P0-6 acceptance: 每项能构造出一个反例被抓住.
 * The GOOD base is `validChain()` (a fully-stored legal IR chain whose
 * refs all resolve, so it ingests cleanly); each counter-example overlays
 * ONE violating object so the violation is attributable to the injected
 * object.
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { validChain } from '../ir/fixtures.ts'
import {
  v1AssumptionUsage,
  v2AssumptionSource,
  v3AssumptionSensitivity,
  v4ModelCoverage,
  runVerificationV1V4,
} from '../../src/verification/v-structure.ts'
import { CAPTURE_ATTESTATION, type IrKind } from '../../src/ir/index.ts'

type Fixture = { kind: IrKind; value: Record<string, unknown> }

/** Store from validChain (all references resolve; ExecutionRecord enters via
 *  its attested producer, INV-3-M). The verifier normalizes a ModelingIr
 *  via `list()` (see v-structure.toMap), so returning the ModelingIr is
 *  the natural shape. */
function goodStore(): ModelingIr {
  const ir = new ModelingIr()
  for (const e of validChain()) {
    const verdict = e.kind === 'ExecutionRecord'
      ? ir.putExecutionRecord(e.value, CAPTURE_ATTESTATION)
      : ir.put(e.kind, e.value)
    if (!verdict.accepted) throw new Error(`validChain refused ${e.kind}: ${JSON.stringify(verdict.failures)}`)
  }
  return ir
}

/** Store from validChain + one extra violation object (appended). */
function storeWith(extra: Fixture): ModelingIr {
  const ir = goodStore()
  const verdict = ir.put(extra.kind, extra.value)
  if (!verdict.accepted) throw new Error(`extra fixture refused: ${JSON.stringify(verdict.failures)}`)
  return ir
}

/** The ProblemSpec id validChain uses for scope_ref. */
function scopeId(): string {
  const chain = validChain()
  const p = chain.find(e => e.kind === 'ProblemSpec')
  return String((p?.value as { problem_id?: unknown }).problem_id ?? 'PROB-1')
}

/** The DataArtifact id validChain registers (usable as justification). */
function dataId(): string {
  const chain = validChain()
  const d = chain.find(e => e.kind === 'DataArtifact')
  return String((d?.value as { data_id?: unknown }).data_id ?? 'DA-RAW')
}

describe('V1 假设-使用一致性', () => {
  it('a fully used chain passes (validChain basis)', () => {
    expect(v1AssumptionUsage(goodStore())).toHaveLength(0)
  })

  it('COUNTER-EXAMPLE: an unreferenced active assumption is flagged', () => {
    const extra: Fixture = {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-ORPHAN',
        scope_ref: scopeId(),
        statement: '相位连续可微',
        source_type: 'MODELING_CHOICE',
        justification_refs: [dataId()],
        risk_level: 'MEDIUM',
        testable: false,
        sensitivity_refs: [],
        status: 'ACTIVE',
      },
    }
    const hit = v1AssumptionUsage(storeWith(extra)).find(f => f.detail.includes('A-ORPHAN'))
    expect(hit?.ok).toBe(false)
    expect(hit?.rule).toContain('V1')
  })
})

describe('V2 假设-来源匹配', () => {
  it('validChain assumptions all pass source matching', () => {
    const findings = v2AssumptionSource(goodStore())
    // validChain's GIVEN/DERIVED assumptions carry justifications; nothing
    // should be flagged as missing.
    expect(findings.filter(f => !f.ok)).toHaveLength(0)
  })

  it('COUNTER-EXAMPLE: an APPROXIMATION assumption without justification', () => {
    const extra: Fixture = {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-APPROX',
        scope_ref: scopeId(),
        statement: '忽略空气阻力',
        source_type: 'APPROXIMATION',
        justification_refs: [],
        risk_level: 'MEDIUM',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
      },
    }
    const f = v2AssumptionSource(storeWith(extra)).find(x => !x.ok && x.detail.includes('A-APPROX'))
    expect(f?.ok).toBe(false)
  })

  it('COUNTER-EXAMPLE: a MODELING_CHOICE without justification', () => {
    const extra: Fixture = {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-CHOICE',
        scope_ref: scopeId(),
        statement: '采用线性近似',
        source_type: 'MODELING_CHOICE',
        justification_refs: [],
        risk_level: 'LOW',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
      },
    }
    const f = v2AssumptionSource(storeWith(extra)).find(x => !x.ok && x.detail.includes('A-CHOICE'))
    expect(f?.ok).toBe(false)
  })
})

describe('V3 假设-结论敏感性', () => {
  it('validChain has nothing HIGH missing sensitivity', () => {
    expect(v3AssumptionSensitivity(goodStore()).filter(f => !f.ok)).toHaveLength(0)
  })

  it('COUNTER-EXAMPLE: a HIGH-risk assumption with no sensitivity experiment', () => {
    const extra: Fixture = {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-HIGH',
        scope_ref: scopeId(),
        statement: '样本相互独立',
        source_type: 'GIVEN',
        justification_refs: [dataId()],
        risk_level: 'HIGH',
        testable: true,
        sensitivity_refs: [],
        status: 'ACTIVE',
      },
    }
    const f = v3AssumptionSensitivity(storeWith(extra)).find(x => !x.ok && x.detail.includes('A-HIGH'))
    expect(f?.ok).toBe(false)
    expect(f?.rule).toContain('V3')
  })
})

describe('V4 模型-题面覆盖', () => {
  it('validChain covers its REQUIRED_OUTPUTs and resolves symbols', () => {
    const findings = v4ModelCoverage(goodStore())
    // If the canonical chain itself has coverage failures, that is a bug in
    // the fixtures, not in the checker.
    expect(findings.filter(f => !f.ok)).toHaveLength(0)
  })

  it('COUNTER-EXAMPLE: a model referencing a ghost symbol (凭空物理量)', () => {
    // validChain's stores refuse ghost symbols at the schema layer, so the
    // closest legitimately-constructible counter-example is a manually-
    // assembled store map where the model carries SYM-GHOST with no symbol.
    const manual = new Map<string, { id: string; kind: string; value: Record<string, unknown> }>()
    manual.set('M1', {
      id: 'M1',
      kind: 'ModelSpec',
      value: {
        model_id: 'M1',
        problem_refs: [scopeId()],
        assumption_refs: [],
        variable_refs: ['SYM-GHOST'],
        parameter_refs: [],
        equation_refs: [],
        constraints: [],
        objective: null,
        dependencies: [],
      },
    })
    const f = v4ModelCoverage(manual as unknown as ModelingIr).find(x => !x.ok && x.rule.includes('V4 符号来源'))
    expect(f?.ok).toBe(false)
    expect(f?.detail).toContain('SYM-GHOST')
  })

  it('COUNTER-EXAMPLE: a REQUIRED_OUTPUT with no reaching CRITICAL chain', () => {
    // R-GHOST hangs off its OWN DataArtifact with NO ProblemSpec -> no
    // reaching results -> the coverage check must flag it. (Reusing the
    // chain's shared DA-RAW would inherit the chain's covered problem.)
    const myData: string = 'DA-GHOST'
    const extra: Fixture = {
      kind: 'DataArtifact',
      value: {
        data_id: myData,
        role: 'RAW_PROBLEM',
        locator: 'file:///ghost.md',
        content_hash: 'sha256:' + '1'.repeat(64),
        media_type: 'text/markdown',
        description: 'ghost problem',
      },
    }
    const withData = goodStore()
    const verdict = withData.put(extra.kind, extra.value)
    if (!verdict.accepted) throw new Error(`ghost DA refused: ${JSON.stringify(verdict.failures)}`)
    const reqVerdict = withData.put('RequirementSpec' as never, {
      requirement_id: 'R-GHOST',
      source_data_ref: myData,
      requirement_type: 'REQUIRED_OUTPUT',
      statement: '求幽灵指标',
    })
    if (!reqVerdict.accepted) throw new Error(`ghost REQ refused: ${JSON.stringify(reqVerdict.failures)}`)
    const f = v4ModelCoverage(withData).find(x => !x.ok && x.detail.includes('R-GHOST'))
    expect(f?.ok).toBe(false)
    expect(f?.rule).toContain('V4 REQUIRED_OUTPUT')
  })
})

describe('runVerificationV1V4 — aggregate pass (W6 exit shape)', () => {
  it('collects findings across rules', () => {
    const extra: Fixture = {
      kind: 'AssumptionSpec',
      value: {
        assumption_id: 'A-AGG',
        scope_ref: scopeId(),
        statement: '边界光滑',
        source_type: 'MODELING_CHOICE',
        justification_refs: [],
        risk_level: 'HIGH',
        testable: false,
        sensitivity_refs: [],
        status: 'ACTIVE',
      },
    }
    const findings = runVerificationV1V4(storeWith(extra))
    expect(findings.some(f => f.rule.includes('V2'))).toBe(true)
    expect(findings.some(f => f.rule.includes('V3'))).toBe(true)
  })
})
