/**
 * P1-1 — structured-output producer acceptance (positive + attack + regression).
 *
 * The producer is the ONLY production writer for the model-declared IR
 * kinds. These tests pin: whole-container admission with per-entry audit,
 * all-or-nothing failure (no partial trees), closed-schema strictness,
 * the INV-3-M ExecutionRecord wall, the kind whitelist, and append-only
 * conflict semantics.
 *
 * Container ordering contract: entries must be bottom-up (a referenced id
 * is registered before its referrer — ProblemSpec before SymbolSpec, and so
 * on), matching the store's 1.5R closure rule.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/produce/ir-producer
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import {
  MODEL_CONTAINER_VERSION,
  PRODUCIBLE_KINDS,
  parseModelContainer,
  produceContainerInto,
} from '../../src/produce/ir-producer.ts'
import {
  dataArtifact,
  requiredOutput,
  requirementSpec,
  constraintRequirement,
  variableSymbol,
  parameterSymbol,
  problemSpec,
  modelSpec,
} from '../ir/fixtures.ts'
import type { IrKind } from '../../src/ir/index.ts'

type AnyEntry = { kind: string; value: Record<string, unknown> }

/** Self-contained contract container, bottom-up (deps before dependents). */
function contractContainer(extra: ReadonlyArray<AnyEntry> = []): string {
  const container = {
    __dsh_paper: MODEL_CONTAINER_VERSION,
    code: 'const fs = require("node:fs");\nfs.writeFileSync("result.json", JSON.stringify({ h: 0.731 }));\n',
    narrative: { question: 'Ice thickness along a survey line.', approach: 'Linear regression on sonar returns.' },
    entries: [
      { kind: 'DataArtifact', value: dataArtifact() },
      { kind: 'RequirementSpec', value: requirementSpec() },
      { kind: 'RequirementSpec', value: requiredOutput() },
      { kind: 'RequirementSpec', value: constraintRequirement() },
      { kind: 'ProblemSpec', value: problemSpec() },
      { kind: 'SymbolSpec', value: variableSymbol() },
      { kind: 'SymbolSpec', value: parameterSymbol() },
      { kind: 'ModelSpec', value: modelSpec() },
      ...extra,
    ],
  }
  return JSON.stringify(container)
}

describe('P1-1 producer — parse', () => {
  it('parses a valid container and rejects non-container shapes', () => {
    const good = parseModelContainer(contractContainer())
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.container.__dsh_paper).toBe(MODEL_CONTAINER_VERSION)
      expect(good.container.entries).toHaveLength(8)
      expect(good.container.code).toContain('writeFileSync')
      expect(good.container.narrative).toMatchObject({ question: 'Ice thickness along a survey line.' })
    }
    expect(parseModelContainer('not json').ok).toBe(false)
    expect(parseModelContainer('{"no":"marker"}').ok).toBe(false)
    expect(parseModelContainer(JSON.stringify({ __dsh_paper: MODEL_CONTAINER_VERSION })).ok).toBe(false)
  })
})

describe('P1-1 producer — positive', () => {
  it('writes a whole legal container and audits every entry in order', () => {
    const ir = new ModelingIr()
    const audited: { kind: IrKind; id: string }[] = []
    const verdict = produceContainerInto(ir, contractContainer(), (kind, id) => audited.push({ kind, id }))
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.entries).toHaveLength(8)
    expect(audited).toEqual(verdict.entries)
    const ids = {
      Problem: ir.list().filter(r => r.kind === 'ProblemSpec').map(r => (r.value as { problem_id: string }).problem_id),
      Model: ir.list().filter(r => r.kind === 'ModelSpec').map(r => (r.value as { model_id: string }).model_id),
      Sym: ir.list().filter(r => r.kind === 'SymbolSpec').map(r => (r.value as { symbol_id: string }).symbol_id),
      Req: ir.list().filter(r => r.kind === 'RequirementSpec').map(r => (r.value as { requirement_id: string }).requirement_id),
      Data: ir.list().filter(r => r.kind === 'DataArtifact').map(r => (r.value as { data_id: string }).data_id),
    }
    expect(ids.Problem).toContain('P1')
    expect(ids.Model).toContain('M1')
    expect(ids.Sym).toEqual(expect.arrayContaining(['SYM-x', 'SYM-rho']))
    expect(ids.Req).toEqual(expect.arrayContaining(['R1', 'R-OUT', 'R-CON']))
    expect(ids.Data).toContain('DA-RAW')
    expect(ir.list().filter(r => !PRODUCIBLE_KINDS.includes(r.kind))).toHaveLength(0)
  })
})

describe('P1-1 producer — attacks', () => {
  it('① a schema violation refuses the WHOLE container and writes nothing (no partial tree)', () => {
    const ir = new ModelingIr()
    const poisonedModel = { ...modelSpec(), sneaky_extra: true } as unknown as Record<string, unknown>
    const container = contractContainer()
      .replace(JSON.stringify(modelSpec()), JSON.stringify(poisonedModel))
    const verdict = produceContainerInto(ir, container)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('schema_violation')
    expect(verdict.reason).toMatch(/sneaky_extra|unrecognized/i)
    expect(ir.size).toBe(0) // dry pass refused everything: no partial tree
  })

  it('② a container missing a required field is refused with the schema path', () => {
    const ir = new ModelingIr()
    const noConstraints = { ...modelSpec() } as Record<string, unknown>
    delete noConstraints['constraints']
    const container = contractContainer().replace(JSON.stringify(modelSpec()), JSON.stringify(noConstraints))
    const verdict = produceContainerInto(ir, container)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('schema_violation')
    expect(verdict.reason).toMatch(/constraints/)
    expect(ir.size).toBe(0)
  })

  it('③ an ExecutionRecord smuggled into the container is refused with producer_required semantics', () => {
    const ir = new ModelingIr()
    const container = contractContainer([
      { kind: 'ExecutionRecord', value: { execution_id: 'EXEC-FAKE', run_ref: 'RUN1' } },
    ])
    const verdict = produceContainerInto(ir, container)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('execution_record_forbidden')
    expect(verdict.reason).toContain('CAPTURE_ATTESTATION')
    expect(ir.size).toBe(0)
  })

  it('④ non-producible kinds (Result/RunArtifact/Claim) are refused', () => {
    for (const kind of ['Result', 'RunArtifact', 'Claim'] as const) {
      const verdict = produceContainerInto(new ModelingIr(), contractContainer([
        { kind, value: { anything: true } },
      ]))
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('kind_not_producible')
      expect(verdict.reason).toContain(kind)
    }
  })

  it('⑤ a duplicate id inside the container is a conflict (append-only semantics)', () => {
    const container = contractContainer([
      { kind: 'ProblemSpec', value: problemSpec() }, // second P1
    ])
    const verdict = produceContainerInto(new ModelingIr(), container)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(['conflicting_id', 'store_refused']).toContain(verdict.code)
    expect(verdict.reason).toMatch(/could not be admitted|duplicate/i)
  })

  it('⑥ no lenient-cleanup path exists: container fields reach the store byte-for-byte', () => {
    const ir = new ModelingIr()
    const special = 'drifting sensor bias (non-ASCII: 厚度)'
    const container = contractContainer().replace(
      JSON.stringify(modelSpec()),
      JSON.stringify({ ...modelSpec(), assumptions: [special] }),
    )
    const verdict = produceContainerInto(ir, container)
    expect(verdict.ok).toBe(true)
    const stored = ir.list().find(r => r.kind === 'ModelSpec')
    expect((stored?.value as { assumptions: string[] }).assumptions).toEqual([special])
  })
})
