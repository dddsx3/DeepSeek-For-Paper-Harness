/**
 * TASK-PW W1 — model-face producer acceptance (input-asset domain + the
 * impossible-field rule).
 *
 * The producer is the ONLY production writer for the model-declared IR
 * kinds. W1 (W-C sign-off A) narrows the model's declaration domain:
 *
 *   - the model face whitelists ONLY SymbolSpec / ModelSpec /
 *     DataArtifact(output-pointer);
 *   - ProblemSpec / RequirementSpec entries are refused outright (the
 *     harness registers the problem assets; the model references ids);
 *   - a DataArtifact carrying content_hash is refused with a dedicated
 *     code (the impossible-field rule — audit finding F-A: the sha256 of
 *     bytes that do not exist until the run cannot be model-known);
 *   - a model-declared DataArtifact is NOT written at admission — it comes
 *     back as a pending output artifact for the harness to mint post-run
 *     with the real hash;
 *   - re-declaring a harness-registered id is a declaration refusal.
 *
 * The whole-container all-or-nothing semantics, the INV-3-M ExecutionRecord
 * wall, the kind whitelist, and append-only conflict semantics are unchanged.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/produce/ir-producer
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import {
  MODEL_CONTAINER_VERSION,
  MODEL_FACE_KINDS,
  parseModelContainer,
  produceContainerInto,
} from '../../src/produce/ir-producer.ts'
import {
  variableSymbol,
  parameterSymbol,
  modelSpec,
} from '../ir/fixtures.ts'
import { sha256Hex } from '../../src/ir/index.ts'
import type { IrKind } from '../../src/ir/index.ts'

type AnyEntry = { kind: string; value: Record<string, unknown> }

/**
 * Mirror the executor's registerInputAssets: the harness-side problem assets
 * (full IR shapes, hashes computed by the harness) land in the store BEFORE
 * the model container is applied.
 */
function registerHarnessAssets(ir: ModelingIr): void {
  const put = (kind: Parameters<ModelingIr['put']>[0], value: Record<string, unknown>) => {
    const verdict = ir.put(kind, value)
    if (!verdict.accepted) throw new Error(`harness registration refused: ${verdict.failures[0]?.reason}`)
  }
  put('DataArtifact', {
    data_id: 'DA-RAW',
    role: 'RAW_PROBLEM',
    locator: 'file:///problems/run/task.md',
    content_hash: `sha256:${sha256Hex('Estimate mean sea-ice thickness.')}`,
    media_type: 'text/markdown',
    description: 'Estimate mean sea-ice thickness.',
  })
  put('RequirementSpec', {
    requirement_id: 'R-OUT',
    source_data_ref: 'DA-RAW',
    requirement_type: 'REQUIRED_OUTPUT',
    statement: 'Estimate mean sea-ice thickness.',
  })
  put('ProblemSpec', {
    problem_id: 'P1',
    raw_problem_ref: 'DA-RAW',
    requirement_refs: ['R-OUT'],
  })
}

/** Self-contained model-face container (W1 shape, modeling-side kinds). */
const RESERVED = new Set(['DA-RAW', 'R-OUT', 'P1'])

function modelFaceContainer(extra: ReadonlyArray<AnyEntry> = []): string {
  const container = {
    __dsh_paper: MODEL_CONTAINER_VERSION,
    code: 'const fs = require("node:fs");\nfs.writeFileSync("result.json", JSON.stringify({ h: 0.731 }));\n',
    narrative: { question: 'Ice thickness along a survey line.', approach: 'Linear regression on sonar returns.' },
    entries: [
      { kind: 'SymbolSpec', value: variableSymbol() },
      { kind: 'SymbolSpec', value: parameterSymbol() },
      { kind: 'ModelSpec', value: modelSpec() },
      ...extra,
    ],
  }
  return JSON.stringify(container)
}

describe('W1 producer — parse + model face', () => {
  it('parses a valid model-face container and rejects non-container shapes', () => {
    const good = parseModelContainer(modelFaceContainer())
    expect(good.ok).toBe(true)
    if (good.ok) {
      expect(good.container.__dsh_paper).toBe(MODEL_CONTAINER_VERSION)
      expect(good.container.entries).toHaveLength(3)
      expect(good.container.code).toContain('writeFileSync')
      expect(good.container.narrative).toMatchObject({ question: 'Ice thickness along a survey line.' })
    }
    expect(parseModelContainer('not json').ok).toBe(false)
    expect(parseModelContainer('{"no":"marker"}').ok).toBe(false)
    expect(parseModelContainer(JSON.stringify({ __dsh_paper: MODEL_CONTAINER_VERSION })).ok).toBe(false)
  })

  it('the model-face kind whitelist is exactly SymbolSpec/ModelSpec/DataArtifact', () => {
    expect(MODEL_FACE_KINDS).toEqual(['SymbolSpec', 'ModelSpec', 'DataArtifact'])
  })
})

describe('W1 producer — positive', () => {
  it('writes a whole legal model-face container and audits every entry in order', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const audited: { kind: IrKind; id: string }[] = []
    const verdict = produceContainerInto(ir, modelFaceContainer(), (kind, id) => audited.push({ kind, id }), { reservedIds: RESERVED })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.entries).toHaveLength(3)
    expect(audited).toEqual(verdict.entries)
    expect(verdict.pendingOutputArtifacts).toEqual([])
    const ids = {
      Model: ir.list().filter(r => r.kind === 'ModelSpec').map(r => (r.value as { model_id: string }).model_id),
      Sym: ir.list().filter(r => r.kind === 'SymbolSpec').map(r => (r.value as { symbol_id: string }).symbol_id),
    }
    expect(ids.Model).toContain('M1')
    expect(ids.Sym).toEqual(expect.arrayContaining(['SYM-x', 'SYM-rho']))
  })

  it('a model-declared output DataArtifact comes back PENDING (unwritten) — the hash is the harness\u2019s job', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'DataArtifact', value: { data_id: 'DA-OUT', locator: 'result.json' } },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.pendingOutputArtifacts).toEqual([{ data_id: 'DA-OUT', locator: 'result.json' }])
    // Nothing was written for the pending artifact: the store holds only the
    // harness assets (3) + the model face (3).
    const dataArtifacts = ir.list().filter(r => r.kind === 'DataArtifact').map(r => (r.value as { data_id: string }).data_id)
    expect(dataArtifacts).toEqual(['DA-RAW'])
  })
})

describe('W1 producer — domain attacks (each must refuse)', () => {
  it('attack 1a: a ProblemSpec entry is refused as input-asset domain (harness-registered)', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'ProblemSpec', value: { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] } },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('input_asset_domain')
    expect(verdict.reason).toMatch(/harness-registered/)
    // The harness registration survived; the model wrote nothing.
    expect(ir.list().filter(r => r.kind === 'ModelSpec')).toHaveLength(0)
  })

  it('attack 1b: a RequirementSpec entry is refused as input-asset domain', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'RequirementSpec', value: { requirement_id: 'R-NEW', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'Produce something else.' } },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('input_asset_domain')
  })

  it('attack 1c: re-declaring the registered RAW_PROBLEM id is a declaration refusal', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'DataArtifact', value: { data_id: 'DA-RAW', locator: 'result.json' } },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('registered_id_redeclared')
    expect(verdict.reason).toMatch(/referenced by id, never re-declared/)
  })

  it('attack 1d: a model id colliding with a registered id is a declaration refusal', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'SymbolSpec', value: { symbol_id: 'P1', scope_ref: 'P1', token: 'p', meaning: 'collision', unit: '1', role: 'VARIABLE' } },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('registered_id_redeclared')
  })

  it('attack 2: content_hash inside a model DataArtifact is refused with the dedicated impossible-field code', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'DataArtifact', value: { data_id: 'DA-OUT', locator: 'result.json', content_hash: `sha256:${'b'.repeat(64)}` } },
    ]))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('hash_field_forbidden')
    expect(verdict.reason).toMatch(/F-A|impossible-field/)
  })

  it('attack 2b: role/media_type/description are equally outside the model face (strict shape)', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'DataArtifact', value: { data_id: 'DA-OUT', locator: 'result.json', media_type: 'application/json' } },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('schema_violation')
  })

  it('attack 3 (legacy-shape regression): an old full DataArtifact (F-A era) refuses under the W1 face', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const legacy = { data_id: 'DA-OLD', role: 'RAW_PROBLEM', locator: 'file:///problem/x.txt', content_hash: `sha256:${'a'.repeat(64)}`, media_type: 'text/markdown', description: 'x' }
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'DataArtifact', value: legacy },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    // content_hash fires the dedicated refusal before the strict-shape one.
    expect(verdict.code).toBe('hash_field_forbidden')
  })
})

describe('W1 producer — unchanged walls', () => {
  it('an ExecutionRecord smuggled into the container is refused with producer_required semantics', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'ExecutionRecord', value: { execution_id: 'EXEC-FAKE', run_ref: 'RUN1' } },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('execution_record_forbidden')
    expect(verdict.reason).toContain('CAPTURE_ATTESTATION')
  })

  it('non-producible kinds (Result/RunArtifact/Claim) are refused', () => {
    for (const kind of ['Result', 'RunArtifact', 'Claim'] as const) {
      const ir = new ModelingIr()
      registerHarnessAssets(ir)
      const verdict = produceContainerInto(ir, modelFaceContainer([
        { kind, value: { anything: true } },
      ]), undefined, { reservedIds: RESERVED })
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.code).toBe('kind_not_producible')
      expect(verdict.reason).toContain(kind)
    }
  })

  it('a schema violation refuses the WHOLE container and writes nothing on the model side', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const poisonedModel = { ...modelSpec(), sneaky_extra: true } as unknown as Record<string, unknown>
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'ModelSpec', value: poisonedModel },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('schema_violation')
    expect(verdict.reason).toMatch(/sneaky_extra|unrecognized/i)
    // The harness assets survive; the model wrote nothing.
    expect(ir.list().filter(r => r.kind === 'ModelSpec')).toHaveLength(0)
  })

  it('a container missing a required ModelSpec field is refused with the schema path', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const noConstraints = { ...modelSpec() } as Record<string, unknown>
    delete noConstraints['constraints']
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'ModelSpec', value: noConstraints },
    ]), undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('schema_violation')
    expect(verdict.reason).toMatch(/constraints/)
  })

  it('a duplicate id inside the container is a conflict (append-only semantics)', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, modelFaceContainer([
      { kind: 'SymbolSpec', value: variableSymbol() }, // second SYM-x
    ]))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(['conflicting_id', 'store_refused']).toContain(verdict.code)
    expect(verdict.reason).toMatch(/could not be admitted|duplicate/i)
  })

  it('no lenient-cleanup path exists: container fields reach the store byte-for-byte', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const special = 'drifting sensor bias (non-ASCII: 厚度)'
    const container = modelFaceContainer().replace(
      JSON.stringify(modelSpec()),
      JSON.stringify({ ...modelSpec(), assumptions: [special] }),
    )
    const verdict = produceContainerInto(ir, container, undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(true)
    const stored = ir.list().find(r => r.kind === 'ModelSpec')
    expect((stored?.value as { assumptions: string[] }).assumptions).toEqual([special])
  })
})
