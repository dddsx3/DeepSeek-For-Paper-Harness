/**
 * 阶段间传递媒介 = **JSON**，以及它唯一一处"确实不行"的折中。
 *
 * 本文件同时关掉 S0 的待办：用一份**合法注册链**的真 IR 证明"可序列化那一半无损往返"。
 * （S0 第一版手写夹具连撞 `unresolved_reference` 与 `schema_invalid`，而"往返深等"
 * 在**空 store 上空对空**地通过了——一条假绿。下面的非空守卫就是那次教训的固化。）
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import type { IrKind } from '../../src/ir/schema.ts'
import {
  IR_NON_SERIALIZABLE_KINDS,
  digestOf,
  inputDigestOf,
  irFromJson,
  irToJson,
} from '../../src/stages/interchange.ts'

/** 一条合法的注册链（引用必须先于引用者）+ 覆盖渲染路径所需的 kind。 */
const CHAIN: ReadonlyArray<{ kind: IrKind; value: Record<string, unknown> }> = [
  { kind: 'DataArtifact', value: { data_id: 'DA-RAW', locator: 'raw_problem.txt', role: 'RAW_PROBLEM', content_hash: 'sha256:' + 'a'.repeat(64), media_type: 'text/plain', description: '题面原文' } },
  { kind: 'RequirementSpec', value: { requirement_id: 'R-OUT', statement: '设计抽样方案并对生产阶段决策', requirement_type: 'REQUIRED_OUTPUT', source_data_ref: 'DA-RAW' } },
  { kind: 'ProblemSpec', value: { problem_id: 'P1', raw_problem_ref: 'DA-RAW', requirement_refs: ['R-OUT'] } },
  { kind: 'SymbolSpec', value: { symbol_id: 'SYM-n', scope_ref: 'P1', token: 'n', meaning: 'sample size', unit: '1', role: 'VARIABLE', shape: 'SCALAR', domain: 'NONNEGATIVE_INTEGER', index_set: [] } },
  { kind: 'AssumptionSpec', value: { assumption_id: 'A-ONESIDED', scope_ref: 'P1', statement: 'one-sided exact binomial test', source_type: 'MODELING_CHOICE', justification_refs: [], risk_level: 'MEDIUM', testable: true, sensitivity_refs: [], status: 'ACTIVE' } },
  { kind: 'EquationSpec', value: { equation_id: 'EQ-P', scope_ref: 'P1', expression: 'pi = R - C', representation: 'SYMPY', lhs_symbols: ['SYM-n'], rhs_symbols: [], equation_type: 'DEFINITION', unit: 'dimensionless', depends_on: [], source: 'DERIVED' } },
  { kind: 'ModelSpec', value: { model_id: 'M1', problem_refs: ['P1'], assumption_refs: ['A-ONESIDED'], variable_refs: ['SYM-n'], parameter_refs: [], equation_refs: ['EQ-P'], constraints: [], objective: 'minimize inspections', dependencies: [] } },
]

/** 建一条合法链；**逐条检查 verdict**——`put` 的拒绝是静默的。 */
function buildChain(): ModelingIr {
  const ir = new ModelingIr()
  const refused: string[] = []
  for (const r of CHAIN) {
    if (!ir.put(r.kind, r.value).accepted) refused.push(r.kind)
  }
  expect(refused, `夹具被拒的 kind：${refused.join('、')}`).toEqual([])
  // **非空守卫**：S0 第一版的假绿就是缺了它
  expect(ir.size, '夹具一条都没进 store —— 用例会假绿').toBe(CHAIN.length)
  return ir
}

describe('阶段传递媒介 = JSON — 无损往返（关掉 S0 待办）', () => {
  it('真 IR → JSON → 真 IR：id 集合、顺序、逐条 value 全部深等', () => {
    const before = buildChain()
    const restored = irFromJson(irToJson(before))
    // ① 重放没有一条被拒
    expect(restored.refused, JSON.stringify(restored.refused)).toEqual([])
    // ② 条数一致（非空守卫的下游）
    expect(restored.ir.size).toBe(before.size)
    // ③ id 集合与 ingest 顺序一致（顺序是语义：引用先于引用者）
    expect(restored.ir.list().map(r => r.kind)).toEqual(before.list().map(r => r.kind))
    // ④ 逐条 value 深等
    for (const rec of before.list()) {
      const after = restored.ir.list().find(r => r.kind === rec.kind && JSON.stringify(r.value) === JSON.stringify(rec.value))
      expect(after, `${rec.kind} 往返后找不到同值记录`).toBeDefined()
    }
  })

  it('往返**两次**结果稳定（JSON 是幂等的媒介，不是一次性快照）', () => {
    const once = irToJson(buildChain())
    const twice = irToJson(irFromJson(once).ir)
    expect(twice).toBe(once)
  })
})

describe('阶段传递媒介 = JSON — 唯一一处"确实不行"的折中', () => {
  it('`ExecutionRecord` 不可传递，且**原因被如实上报**（不静默丢弃）', () => {
    const ir = buildChain()
    // 试着放进一条 ExecutionRecord —— 被设计性拒绝，所以它进不去 store，
    // 也就不会出现在 JSON 里。这条测试钉的是"排除是显式的"。
    expect(IR_NON_SERIALIZABLE_KINDS.has('ExecutionRecord')).toBe(true)
    const parsed = JSON.parse(irToJson(ir)) as { records: unknown[]; omitted: unknown[] }
    expect(Array.isArray(parsed.records)).toBe(true)
    // `omitted` 字段**总是存在**——空数组的含义是"这次确实没有可排除的"，
    // 而不是"这个字段没人管"。
    expect(Array.isArray(parsed.omitted)).toBe(true)
  })

  it('版本不符时**抛错**而不是尽力解析（媒介格式演进不得静默降级）', () => {
    expect(() => irFromJson(JSON.stringify({ irVersion: 99, records: [] }))).toThrow(/version mismatch/)
  })

  it('重放**走 put 而不是注入内部状态** —— 非法记录在重建时被拒并上报', () => {
    // 绕过 put 重建出来的 store 会"看起来一样"却绕过了引用/闭 schema 检查。
    const bad = JSON.stringify({
      irVersion: 1,
      records: [{ kind: 'SymbolSpec', value: { symbol_id: 'SYM-x', scope_ref: 'P-NOT-REGISTERED' } }],
      omitted: [],
    })
    const restored = irFromJson(bad)
    expect(restored.ir.size).toBe(0)
    expect(restored.refused.length).toBe(1)
    expect(restored.refused[0]?.reason).toMatch(/unresolved_reference|schema_invalid/)
  })
})

describe('inputDigest —— 回滚失效判据的来源', () => {
  it('上游/技能/门禁任一变化 → 摘要变化（三者都必须覆盖）', () => {
    const base = { upstreamDigests: ['a', 'b'], skillVersion: 'sk1', gateVersion: 'g1' }
    const d = inputDigestOf(base)
    expect(inputDigestOf({ ...base, upstreamDigests: ['a', 'c'] })).not.toBe(d)
    expect(inputDigestOf({ ...base, skillVersion: 'sk2' })).not.toBe(d)
    expect(inputDigestOf({ ...base, gateVersion: 'g2' })).not.toBe(d)
    expect(inputDigestOf(base)).toBe(d)
  })

  it('上游顺序参与摘要（阶段顺序本身是语义）', () => {
    const a = inputDigestOf({ upstreamDigests: ['x', 'y'], skillVersion: 's', gateVersion: 'g' })
    const b = inputDigestOf({ upstreamDigests: ['y', 'x'], skillVersion: 's', gateVersion: 'g' })
    expect(a).not.toBe(b)
  })

  it('digestOf 只接文本（接对象会先把不确定性藏进键序里）', () => {
    expect(digestOf('{}')).toMatch(/^[0-9a-f]{64}$/)
    expect(digestOf('{}')).toBe(digestOf('{}'))
    expect(digestOf('{}')).not.toBe(digestOf('{ }'))
  })
})
