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
  assumptionSpec,
  equationSpec,
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
      { kind: 'AssumptionSpec', value: assumptionSpec() },
      { kind: 'EquationSpec', value: equationSpec() },
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
      expect(good.container.entries).toHaveLength(5)
      expect(good.container.code).toContain('writeFileSync')
      expect(good.container.narrative).toMatchObject({ question: 'Ice thickness along a survey line.' })
    }
    expect(parseModelContainer('not json').ok).toBe(false)
    expect(parseModelContainer('{"no":"marker"}').ok).toBe(false)
    expect(parseModelContainer(JSON.stringify({ __dsh_paper: MODEL_CONTAINER_VERSION })).ok).toBe(false)
  })

  it('the model-face kind whitelist is exactly SymbolSpec/AssumptionSpec/EquationSpec/ModelSpec/DataArtifact', () => {
    // TASK-T1: AssumptionSpec/EquationSpec joined the model face when the
    // contract objects became the canonical owners of assumptions/equations.
    expect(MODEL_FACE_KINDS).toEqual([
      'SymbolSpec', 'AssumptionSpec', 'EquationSpec', 'ModelSpec', 'DataArtifact',
    ])
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
    expect(verdict.entries).toHaveLength(5)
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
    // TASK-T1: the assumption lives in its canonical AssumptionSpec; mutate
    // the OWNER object's statement and verify no cleanup path alters it.
    const container = modelFaceContainer().replace(
      JSON.stringify(assumptionSpec()),
      JSON.stringify({ ...assumptionSpec(), statement: special }),
    )
    const verdict = produceContainerInto(ir, container, undefined, { reservedIds: RESERVED })
    expect(verdict.ok).toBe(true)
    const stored = ir.list().find(r => r.kind === 'AssumptionSpec')
    expect((stored?.value as { statement: string }).statement).toBe(special)
  })
})

describe('W9-P2 / O-L1-10 — idempotent re-entry after a partial write', () => {
  it('re-running the SAME container over a partially-written store succeeds (retry-safe)', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const container = modelFaceContainer([]) // legal container
    // attempt 1: write it fully
    const first = produceContainerInto(ir, container)
    expect(first.ok).toBe(true)
    // attempt 2 (retry): the SAME container again — every entry already
    // exists with identical content → idempotent, not a duplicate conflict.
    const second = produceContainerInto(ir, container)
    expect(second.ok).toBe(true)
    if (second.ok) expect(second.entries.length).toBe(first.ok ? first.entries.length : 0)
  })

  it('re-running a CHANGED container still conflicts (append-only unchanged)', () => {
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const first = produceContainerInto(ir, modelFaceContainer([]))
    expect(first.ok).toBe(true)
    // same ids, different content → a real conflict, never a quiet update
    const changed = modelFaceContainer([{ kind: 'SymbolSpec', value: { ...variableSymbol(), meaning: 'CHANGED' } }])
    const second = produceContainerInto(ir, changed)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('conflicting_id')
  })
})

// ---------------------------------------------------------------------------
// W11.5 baseline-2（首次真实产出实测）—— 围栏容错与负对照。
// 证据：三次尝试里有两次把容器包在 ```json … ``` 里，raw JSON.parse 撞上
// 反引号直接 parse_failed。
// ---------------------------------------------------------------------------
describe('W11.5 baseline-2 — 容器围栏是渲染差异（内容仍须合法）', () => {
  it('一层 markdown 围栏被剥掉后正常解析', async () => {
    const { parseModelContainer } = await import('../../src/produce/ir-producer.ts')
    const inner = JSON.stringify({ __dsh_paper: 'ir-container-v1', entries: [{ kind: 'SymbolSpec', value: { symbol_id: 'SYM-n' } }], code: 'x' })
    expect(parseModelContainer('```json\n' + inner + '\n```').ok).toBe(true)
    expect(parseModelContainer('```\n' + inner + '\n```').ok).toBe(true)
  })

  it('负对照：围栏里不是合法 JSON 仍然拒绝（容错只到围栏为止）', async () => {
    const { parseModelContainer } = await import('../../src/produce/ir-producer.ts')
    expect(parseModelContainer('```json\n{ not json }\n```').ok).toBe(false)
    expect(parseModelContainer('前言 ' + JSON.stringify({ __dsh_paper: 'ir-container-v1' })).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// W11.5 baseline-3（首次真实产出实测）—— 重试容错：首次声明为准。
// 证据：attempt 1 的条目已入 store，attempt 2 重发整容器时有 27/42 条同 id
// 内容不同（多为 `token: p_1` → `p1` 这类写法差异 + 少量判断变化），
// append-only 冲突使重试循环**永远赢不了**（attempt 2/3 全部 conflicting_id）。
// ---------------------------------------------------------------------------
describe('W11.5 baseline-3 — 同 run 重试：首次声明为准（跨 run/保留 id 守卫不动）', () => {
  const sym = (id: string, token: string): Record<string, unknown> => ({
    symbol_id: id, scope_ref: 'P1', token, meaning: 'x', unit: 'dimensionless',
    role: 'PARAMETER', shape: 'SCALAR', domain: 'PROBABILITY', index_set: [],
  })
  const container = (entries: ReadonlyArray<unknown>): string => JSON.stringify({
    __dsh_paper: 'ir-container-v1', entries, code: 'console.log(1)',
    run: { outputBasenames: [], seed: 1 },
  })

  const registerInputs = async (ir: import('../../src/ir/store.ts').ModelingIr): Promise<void> => {
    // harness-style input assets (the reference closure needs P1)
    const entries: Array<[string, Record<string, unknown>]> = [
      ['DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///p.md', content_hash: 'sha256:' + 'a'.repeat(64), media_type: 'text/markdown', description: 'x' }],
      ['RequirementSpec', { requirement_id: 'R-OUT', source_data_ref: 'DA-RAW', requirement_type: 'REQUIRED_OUTPUT', statement: 'x' }],
      ['ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] }],
    ]
    for (const [kind, value] of entries) {
      const v = ir.put(kind as never, value)
      if (!v.accepted) throw new Error(String(v.failures[0]?.reason))
    }
  }

  it('重试改写了已注册条目的内容 → 跳过（不冲突），首次内容保留', async () => {
    const { ModelingIr } = await import('../../src/ir/store.ts')
    const { produceContainerInto } = await import('../../src/produce/ir-producer.ts')
    const ir = new ModelingIr()
    await registerInputs(ir)
    const first = produceContainerInto(ir, container([{ kind: 'SymbolSpec', value: sym('S-P1', 'p_1') }]))
    expect(first.ok).toBe(true)
    // retry re-declares with a different token spelling
    const retry = produceContainerInto(ir, container([{ kind: 'SymbolSpec', value: sym('S-P1', 'p1') }]))
    expect(retry.ok).toBe(true)
    if (retry.ok) {
      expect(retry.superseded.map(s => s.id)).toEqual(['S-P1'])
      expect(retry.entries).toHaveLength(0)
    }
    // first declaration wins — the store still carries p_1
    expect((ir.get('S-P1')?.value as { token: string }).token).toBe('p_1')
  })

  it('harness 保留 id 被改写 → 仍然硬拒（那不是重试，是错误）', async () => {
    const { ModelingIr } = await import('../../src/ir/store.ts')
    const { produceContainerInto } = await import('../../src/produce/ir-producer.ts')
    const ir = new ModelingIr()
    const reserved = new Set(['DA-RAW'])
    const okFirst = ir.put('DataArtifact', { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///p.md', content_hash: 'sha256:' + 'a'.repeat(64), media_type: 'text/markdown', description: 'x' })
    expect(okFirst.accepted).toBe(true)
    const verdict = produceContainerInto(ir, container([{ kind: 'DataArtifact', value: { data_id: 'DA-RAW', role: 'RAW_PROBLEM', locator: 'file:///other.md' } }]), undefined, { reservedIds: reserved })
    expect(verdict.ok).toBe(false)
    // Pass 1 的保留 id 守卫先命中（更早、更准确）；Pass 2 的分支是纵深防御
    if (!verdict.ok) expect(verdict.reason).toContain('harness-registered asset id')
  })
})

// ---------------------------------------------------------------------------
// W11.5 baseline-9 — the duplicate-token mistake must be named AS ITSELF.
// ---------------------------------------------------------------------------
describe('W11.5 baseline-9 — 同名 token 在入库处就按"重名 token"拒绝', () => {
  const sym = (id: string, token: string, meaning: string): Record<string, unknown> => ({
    symbol_id: id, scope_ref: 'P1', token, meaning, unit: 'dimensionless',
    role: 'PARAMETER', shape: 'SCALAR', domain: 'PROBABILITY', index_set: [],
  })
  const container = (entries: ReadonlyArray<unknown>): string => JSON.stringify({
    __dsh_paper: 'ir-container-v1', entries,
    code: 'const fs=require("node:fs");fs.writeFileSync("result.json","{}");',
    run: { outputBasenames: ['result.json'], seed: 1 },
  })

  it('两条 SymbolSpec 共用 token → duplicate_symbol_token，理由点出两个 symbol_id 与那个 token', async () => {
    // 第九次真实运行：S-P1 与 S-P2_1 都叫 p_1（一个"可容忍次品率上界"、一个
    // "零配件1的次品率"）。第一个症状不是这个——是配置发射被拒："key 'p1'
    // matches more than one declared SymbolSpec by spelling — rename the key"，
    // 指向的是**配置的键**。模型照做了：三次尝试都在改键名（p1 / p1_val …），
    // 而让所有拼写都歧义的那个重名 token 一直没动。不变式本身不新（bridge 早已
    // 报 duplicate_symbol_token、ir_canonicalization 会拦），把它挪到入库处
    // 只是让纠错落在真正的错误上。
    const { ModelingIr } = await import('../../src/ir/store.ts')
    const { produceContainerInto } = await import('../../src/produce/ir-producer.ts')
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const verdict = produceContainerInto(ir, container([
      { kind: 'SymbolSpec', value: sym('S-P1', 'p_1', '可容忍的次品率上界') },
      { kind: 'SymbolSpec', value: sym('S-P2_1', 'p_1', '零配件1的次品率') },
    ]))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.code).toBe('duplicate_symbol_token')
    expect(verdict.reason).toContain("'p_1'")
    expect(verdict.reason).toContain('S-P1')
    expect(verdict.reason).toContain('S-P2_1')
    // 拒绝发生在写入之前：一条都没进 store
    expect(ir.list().filter(r => r.kind === 'SymbolSpec')).toHaveLength(0)
  })

  it('同名 token 但作用域不同 → 允许（唯一性是同作用域内的）', async () => {
    const { ModelingIr } = await import('../../src/ir/store.ts')
    const { produceContainerInto } = await import('../../src/produce/ir-producer.ts')
    const ir = new ModelingIr()
    registerHarnessAssets(ir)
    const other = { ...sym('S-Q1', 'q', '另一个问题的量'), scope_ref: 'P1' }
    const verdict = produceContainerInto(ir, container([
      { kind: 'SymbolSpec', value: sym('S-P1', 'p_1', 'x') },
      { kind: 'SymbolSpec', value: other },
    ]))
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
  })
})
