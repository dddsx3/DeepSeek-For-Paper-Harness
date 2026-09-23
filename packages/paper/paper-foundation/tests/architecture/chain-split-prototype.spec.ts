/**
 * S0 —— 产出链**切分原型**：render 边界能否从序列化状态重入。
 *
 * ## 为什么这是 make-or-break
 *
 * 11 阶段架构把"跑代码 / 铸 IR / 渲染 / 契约检查"拆成不同阶段。它成立的前提是：
 * **渲染段可以只靠前一段留下的序列化状态重入**——不重跑代码、不重发 E2。
 *
 * 这个前提**曾被判定不成立**（`runtime/stage-checkpoint.ts` 的文件头记着：初版设计里
 * 有独立的 `render` 阶段，实现时去掉了，理由是"`runProductionChain` 把五件事放在一次
 * 调用里，中间没有可序列化的停顿点"）。所以本文件不是"验证一个已知结论"，而是
 * **把那条旧判断放到可观测的实验里**。
 *
 * ## 已核实的结论
 *
 * ### ① 切分**可行**：渲染路径不依赖那条不可序列化的记录
 *
 * - `report-renderer.ts` **不直接读任何 IR kind**——它吃的是准备好的
 *   `results / skeletonRows / problemChapters / verification / figures / dataFiles`。
 * - `perProblemChaptersFromIr` 只读 `EquationSpec` / `ModelSpec` / `ProblemSpec`（＋ Result 链）。
 * - **两者都不读 `ExecutionRecord`。**
 *
 * 所以渲染所需的**全部**输入都落在可序列化的那一半里。
 *
 * ### ② 硬边界：`ExecutionRecord` 按设计不可序列化
 *
 * `put('ExecutionRecord', …)` 被拒绝（`ir/store.ts:241`），唯一合法入口是
 * `putExecutionRecord(record, attestation)`，而那个 attestation 符号
 * **never serializable**（INV-3-M 的防伪缝）。
 *
 * 这条**不是缺陷，是防线**——它同时否掉了"整链状态 JSON 往返"这种设想
 * （**包括本文件第一版的设想**）。切分边界的合法位置因此被限定为：
 * **必须在 ExecutionRecord 捕获之后，且重入时不得重新 ingest 它**。
 *
 * ## 待办（本文件尚未覆盖的那一半）
 *
 * "可序列化那一半**无损往返**"这一条还**没有被证明**——它需要一份**合法注册链**的 IR
 * 夹具（`scope_ref: 'P1'` 要求 `P1` 已作为 ProblemSpec 存在，而 ProblemSpec 又引用
 * `DA-RAW` 与 `R-OUT`，且每条的字段名必须逐字照闭 schema）。
 *
 * 我手写夹具连撞两次（`unresolved_reference`、`schema_invalid`），**第二次是被下面那条
 * 闭 schema 守卫抓出来的**——第一版的"往返深等"在**空 store 上空对空**地通过了，是一条
 * 假绿。正确的下一步不是继续手写，而是用一份**已经跑通的真 IR**
 * （`executor-authoritative.spec.ts` 的 POLAR-ICE 夹具，或 `--fake` 跑出来的 store）做往返。
 */

import { describe, expect, it } from 'vitest'
import { ModelingIr } from '../../src/ir/store.ts'
import type { IrKind } from '../../src/ir/schema.ts'

describe('S0 — 产出链切分：已核实的部分', () => {
  it('**`ExecutionRecord` 按设计不可重放** —— 切分边界的硬约束，不是缺陷', () => {
    // INV-3-M 的防伪缝：唯一合法入口是 putExecutionRecord(record, attestation)，
    // 而 attestation 符号 never serializable。任何"整链状态 JSON 往返"的方案都会在
    // 这一条上撞墙——**包括本文件第一版的设想**。
    const ir = new ModelingIr()
    const verdict = ir.put('ExecutionRecord' as IrKind, { record_id: 'RUN1' })
    expect(verdict.accepted).toBe(false)
    const failures = (verdict as { failures?: ReadonlyArray<{ kind: string }> }).failures ?? []
    expect(failures.some(f => f.kind === 'producer_required'), JSON.stringify(failures)).toBe(true)
    expect(ir.size).toBe(0)
  })

  it('闭 schema 拒绝未知字段 —— 手写 IR 夹具必须逐字照 schema，且**必须检查 verdict**', () => {
    // 给夹具作者的守卫：`DataArtifact` 的合法字段是 role/content_hash/media_type/
    // description；写成 sha256/bytes/kind 会被整条拒绝，而**拒绝是静默的**
    // （`put` 返回 verdict，不抛）——不检查 verdict 就会以为放进去了。
    const ir = new ModelingIr()
    const bad = ir.put('DataArtifact' as IrKind, { data_id: 'DA-RAW', locator: 'x', sha256: '0', bytes: 1, kind: 'RAW' })
    expect(bad.accepted).toBe(false)
    const failures = (bad as { failures?: ReadonlyArray<{ kind: string }> }).failures ?? []
    expect(failures.some(f => f.kind === 'schema_invalid'), JSON.stringify(failures)).toBe(true)
    expect(ir.size).toBe(0)
  })
})
