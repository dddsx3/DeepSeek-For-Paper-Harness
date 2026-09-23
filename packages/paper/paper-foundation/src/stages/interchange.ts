/**
 * 阶段间的**唯一传递媒介：JSON**。
 *
 * ## 为什么是 JSON 而不是别的东西
 *
 * 11 阶段架构里，每个阶段要把自己的产出交给下一阶段。可选媒介有三种：内存对象、
 * 自定义二进制、JSON。选 JSON 的理由是**可核验**：
 *
 * - **可 diff**：两个阶段的产出可以直接比，不需要先反序列化；
 * - **可哈希**：`inputDigest` / `PASSED` 哨兵都建在"文本的 sha256"上（见 `handoff`），
 *   而哈希一个内存对象要先定义序列化顺序——那是把不确定性藏起来；
 * - **可人工检查**：检查点报告要给人看，JSON 直接可读。
 *
 * ## 一条**确实不行**的地方，以及它的折中（不是设计缺陷）
 *
 * `ExecutionRecord` **不能** JSON 往返：`put('ExecutionRecord', …)` 被设计性拒绝
 * （`ir/store.ts:241`），唯一合法入口是 `putExecutionRecord(record, attestation)`，
 * 而那个 attestation 符号 **never serializable**（INV-3-M 的防伪缝——它防的正是
 * "把一条伪造的执行记录当成真跑过"）。
 *
 * 所以折中是**显式排除 + 如实上报**，不是静默丢弃：
 * - `irToJson` 把被排除的 kind 记进 `omitted[]`，**带原因**；
 * - `irFromJson` 返回 `omitted`，调用方**必须**能看到"这一段没被传过去"；
 * - 已经核实**渲染路径不读 `ExecutionRecord`**（S0，`chain-split-prototype.spec.ts`），
 *   所以对渲染段这条排除是安全的；将来若某条路径确实需要它，只能**进程内传递或只读
 *   投影**，不能靠重放——这条约束写在类型与测试里，不靠注释。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/interchange
 */

import { createHash } from 'node:crypto'
import { ModelingIr } from '../ir/store.ts'
import type { IrKind } from '../ir/schema.ts'

/** 无法经 JSON 传递的 kind —— 目前只有一条，且原因是防伪而非能力。 */
export const IR_NON_SERIALIZABLE_KINDS: ReadonlySet<string> = new Set(['ExecutionRecord'])

/** 被排除的 kind 及其原因（**如实上报**，不静默丢弃）。 */
export interface OmittedKind {
  readonly kind: string
  readonly reason: string
}

/** 一份 IR 的 JSON 形态。 */
export interface IrSnapshotJson {
  readonly irVersion: 1
  /** 按 ingest 顺序排列——顺序本身是语义（引用必须先于引用者）。 */
  readonly records: ReadonlyArray<{ readonly kind: string; readonly value: unknown }>
  /** 本次传递**排除掉**的 kind。空数组 ≠ 没排除，而是"确实没有可排除的"。 */
  readonly omitted: ReadonlyArray<OmittedKind>
}

/**
 * IR → JSON 文本。
 *
 * @param ir - 规范 IR 仓库。
 * @returns JSON 文本；`records` 保持 ingest 顺序，`omitted` 列出被排除的 kind。
 */
export function irToJson(ir: ModelingIr): string {
  const records: Array<{ kind: string; value: unknown }> = []
  const omitted: OmittedKind[] = []
  const seenOmitted = new Set<string>()
  for (const record of ir.list()) {
    if (IR_NON_SERIALIZABLE_KINDS.has(record.kind)) {
      if (!seenOmitted.has(record.kind)) {
        seenOmitted.add(record.kind)
        omitted.push({
          kind: record.kind,
          reason: 'producer-only：只能经 putExecutionRecord(record, attestation) 进入，'
            + '而 attestation 符号 never serializable（INV-3-M 的防伪缝）。'
            + '需要它的路径只能进程内传递或只读投影，不能靠 JSON 重放。',
        })
      }
      continue
    }
    records.push({ kind: record.kind, value: record.value })
  }
  const snapshot: IrSnapshotJson = { irVersion: 1, records, omitted }
  return JSON.stringify(snapshot, null, 2)
}

/** 从 JSON 重建的结果。 */
export interface IrRestoreResult {
  readonly ir: ModelingIr
  /** 重建时被 store 拒绝的记录（kind + id + 原因）——**必须检查**，否则会以为重建成功。 */
  readonly refused: ReadonlyArray<{ kind: string; id: string; reason: string }>
  /** 原文本里声明被排除的 kind（透传，便于调用方判断这次传递是否完整）。 */
  readonly omitted: ReadonlyArray<OmittedKind>
}

/**
 * JSON 文本 → IR。
 *
 * **重放 `put` 而不是注入内部状态**：`put` 是唯一的准入路径，它带全套校验。
 * 绕过它重建出来的 store 会**看起来**一样但绕过了引用/闭 schema 检查——那是一条
 * 把校验关掉的捷径，不能要。
 *
 * @param text - `irToJson` 的产物。
 * @returns 重建的仓库 + 被拒记录 + 原文本声明的排除项。
 */
export function irFromJson(text: string): IrRestoreResult {
  const parsed = JSON.parse(text) as Partial<IrSnapshotJson>
  if (parsed.irVersion !== 1) {
    throw new Error(`ir snapshot version mismatch: expected 1, got ${String(parsed.irVersion)}`)
  }
  const ir = new ModelingIr()
  const refused: Array<{ kind: string; id: string; reason: string }> = []
  for (const record of parsed.records ?? []) {
    const verdict = ir.put(record.kind as IrKind, record.value)
    if (!verdict.accepted) {
      const failures = (verdict as { failures?: ReadonlyArray<{ kind: string; reason: string }> }).failures ?? []
      refused.push({
        kind: record.kind,
        id: String((verdict as { id?: unknown }).id ?? '?'),
        reason: failures.map(f => `${f.kind}: ${f.reason}`).join('; ') || 'unknown refusal',
      })
    }
  }
  return { ir, refused, omitted: parsed.omitted ?? [] }
}

/**
 * 稳定摘要：对文本取 sha256。
 *
 * 只接受**文本**（不接对象）：对对象取哈希要先定义键序与浮点格式，那是把不确定性
 * 藏进一个看起来确定的值里。文本已经是 JSON，键序在序列化时就被定死了。
 *
 * @param text - 任意文本（通常是 JSON 文本）。
 * @returns 十六进制 sha256。
 */
export function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 一个阶段的输入摘要。
 *
 * 覆盖三样东西，缺一不可：
 * - **上游产出的摘要**：上游变了，本阶段的结果就不再可信；
 * - **技能版本**：技能改了（哪怕产出没变），本阶段的行为可能变；
 * - **门禁版本**：门禁改了，"通过"的含义就变了。
 *
 * 三者任一变化 → 本阶段的 `PASSED` 失效。这正是"回滚后下游必须作废"的判据来源。
 *
 * @param input - 上游摘要（按阶段顺序）、技能版本、门禁版本。
 * @returns 十六进制 sha256。
 */
export function inputDigestOf(input: {
  readonly upstreamDigests: ReadonlyArray<string>
  readonly skillVersion: string
  readonly gateVersion: string
}): string {
  return digestOf(JSON.stringify({
    upstream: [...input.upstreamDigests],
    skill: input.skillVersion,
    gate: input.gateVersion,
  }))
}
