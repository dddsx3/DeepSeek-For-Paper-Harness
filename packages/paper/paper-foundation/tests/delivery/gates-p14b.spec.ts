/**
 * P1-4 — requirement_coverage (A7 v0) + runtime_integrity gates.
 *
 * Coverage: a problem whose single REQUIRED_OUTPUT is reached by a CRITICAL
 * claim chain is covered; a problem that promises a second REQUIRED_OUTPUT
 * with no extra reaching result is BLOCKED (fail-closed count bound).
 * Runtime: captured records must carry well-formed fingerprints; a forged
 * record with a malformed runtime fingerprint is a finding.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/gates-p14b
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import { requirementCoverageFindings } from '../../src/delivery/requirement-coverage.ts'
import { runtimeIntegrityFindings } from '../../src/delivery/runtime-integrity.ts'
import {
  chainThrough,
  requiredOutput,
  backboneIr,
  dataArtifact,
  inputDataArtifact,
  requirementSpec,
  constraintRequirement,
  problemSpec,
  variableSymbol,
  parameterSymbol,
  modelSpec,
  runArtifact,
  result,
  claim,
} from '../ir/fixtures.ts'
import type { IrKind } from '../../src/ir/index.ts'

function chainStore(overrides: Partial<Record<IrKind, Record<string, unknown>>> = {}, extraFirst: ReadonlyArray<{ kind: string; value: Record<string, unknown> }> = []): ModelingIr {
  const ir = new ModelingIr()
  for (const entry of extraFirst) {
    const verdict = ir.put(entry.kind as IrKind, entry.value)
    if (!verdict.accepted) throw new Error(`extra load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  for (const entry of chainThrough('Claim')) {
    const value = { ...entry.value, ...(overrides[entry.kind] ?? {}) }
    if (entry.kind === 'ExecutionRecord') continue
    const verdict = ir.put(entry.kind, value)
    if (!verdict.accepted) throw new Error(`chain load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
  }
  return ir
}

describe('P1-4 requirement_coverage (A7 v0)', () => {
  it('a problem whose REQUIRED_OUTPUT is reached by a CRITICAL chain is covered', () => {
    expect(requirementCoverageFindings(ModelingIr.snapshot(chainStore()))).toHaveLength(0)
  })

  it('a second REQUIRED_OUTPUT with no extra reaching result is BLOCKED', () => {
    // Hand-built chain declaring TWO REQUIRED_OUTPUTs while only one result
    // reaches the problem (fail-closed count bound).
    const ir = new ModelingIr()
    const entries = [
      { kind: 'DataArtifact', value: dataArtifact() },
      { kind: 'DataArtifact', value: inputDataArtifact() },
      { kind: 'RequirementSpec', value: requirementSpec() },
      { kind: 'RequirementSpec', value: requiredOutput({ requirement_id: 'R-OUT' }) },
      { kind: 'RequirementSpec', value: constraintRequirement() },
      { kind: 'RequirementSpec', value: requiredOutput({ requirement_id: 'R-OUT2' }) },
      { kind: 'ProblemSpec', value: problemSpec({ requirement_refs: ['R1', 'R-OUT', 'R-CON', 'R-OUT2'] }) },
      { kind: 'SymbolSpec', value: variableSymbol() },
      { kind: 'SymbolSpec', value: parameterSymbol() },
      { kind: 'ModelSpec', value: modelSpec() },
      { kind: 'RunArtifact', value: runArtifact() },
      { kind: 'Result', value: result() },
      { kind: 'Claim', value: claim() },
    ]
    for (const entry of entries) {
      const verdict = ir.put(entry.kind as IrKind, entry.value as Record<string, unknown>)
      if (!verdict.accepted) throw new Error(`mini load failed at ${entry.kind}: ${verdict.failures[0]?.reason}`)
    }
    const findings = requirementCoverageFindings(ModelingIr.snapshot(ir))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some(f => f.requirementId === 'R-OUT2' || f.requirementId === 'R-OUT')).toBe(true)
  })
})

describe('P1-4 runtime_integrity', () => {
  it('captured records with well-formed fingerprints pass', () => {
    expect(runtimeIntegrityFindings(ModelingIr.snapshot(backboneIr()))).toHaveLength(0)
  })

  it('a forged record with a malformed runtime fingerprint is a finding (synthetic store)', () => {
    // The store schema already refuses a non-digest fingerprint, so the gate
    // defends the boundary a synthetic/non-canonical store could cross.
    const map = new Map<string, import('../../src/ir/store.ts').IrObjectRecord>([
      ['EXEC-BAD', { seq: 1, kind: 'ExecutionRecord', id: 'EXEC-BAD', value: { execution_id: 'EXEC-BAD', run_ref: 'RUN1', runtime_fingerprint_hash: 'not-a-hash', code_hash: 'a'.repeat(64), output_hash: 'b'.repeat(64) }, ingestedAt: 'x' } as unknown as import('../../src/ir/store.ts').IrObjectRecord],
    ])
    const findings = runtimeIntegrityFindings(map)
    expect(findings.some(f => f.kind === 'malformed_runtime_fingerprint')).toBe(true)
  })
})

describe('P1-4 five real gates together on the delivery policy', () => {
  it('the canonical backbone raises none of the five real-gate prefixes', async () => {
    const { buildDeliveryPolicy } = await import('../../src/delivery/gate-registry.ts')
    const { evaluateDelivery } = await import('../../src/delivery/delivery-policy.ts')
    const policy = buildDeliveryPolicy({ mode: 'fast', ir: backboneIr(), runtimeProfileValid: true })
    const decision = evaluateDelivery(policy)
    const prefixes = ['numeric_consistency', 'execution', 'reference_validation', 'runtime_integrity', 'requirement_coverage']
    for (const prefix of prefixes) {
      expect(decision.failures.some(f => f.reason.startsWith(`${prefix}:BLOCKED:`)), prefix).toBe(false)
    }
  })
})
