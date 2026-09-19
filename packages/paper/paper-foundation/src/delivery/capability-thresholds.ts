/**
 * Capability-threshold engine — M-QUAL 阶段 B（E-1/E-2/E-3 的落点）.
 *
 * 执行 `CapabilitySpec.falsifiable_thresholds` 的结构化判据：解析
 * `subject_ref` → 取 Result 标量 → 按算子比较 → 违反即 finding（**退化被
 * 抓**的机械事件）。这是 G5 `numeric_consistency` 门（既有 id）的扩展，
 * 不新增 gate id（N4；GATE-MAPPING §2 的 E-1/E-2/E-3 全部落在这里）。
 *
 * 与 R1-3 冻结决策的关系（显式复核记录）：`claim-evidence.ts` 的
 * "comparison is EXACT — no tolerance layer" 判定的是 **Claim ↔ Result**
 * 的绑定相等（NUMERIC claim 的值必须逐位等于它的 Result——零数字通道的
 * 存在理由，不动）；本引擎的容差（REL_LT / ABS_LT 的 `tolerance` 字段）
 * 服务的是 **Capability ↔ Result** 的可证伪阈值（参考侧阈值几乎全部带
 * 容差：`1e-3` / `1e-5` / `0.05`）。两个语义层不同，冻结决策未被触碰。
 *
 * **fail-closed 原则（绝不静默通过）**：
 *   - `subject_ref` 解析不到 Result → `capability_threshold_unresolvable`；
 *   - 系列算子（MONOTONE_* / MAX_OVER_AXIS）的数据通道尚未落地 →
 *     `capability_threshold_unsupported`（诚实边界，见 capability-spec.ts
 *     头注释；请用代码发射的聚合标量 + 普通算子表达同类判据）；
 *   - 需要比较的算子缺 threshold → `capability_threshold_missing_value`。
 * 三者都是 RED——一个无法执行的判据不能算通过（假绿形态 1 的反面）。
 *
 * **同源边界（REVIEW-INDEPENDENCE §3 的自应用）**：阈值断言的 subject 是
 * 代码发射的 Result，与被断言的解同源——本引擎证明的是"交付值满足其
 * 声明的判据"，不证明"判据本身选对了"（均值 vs 逐点判据的混淆由探针
 * P-3/P-6 在 E2E 期补偿）。本引擎不声称消除同源。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/capability-thresholds
 */

import type { IrObjectRecord } from '../ir/store.ts'
import type { CapabilitySpec, FalsifiableThreshold } from '../ir/capability-spec.ts'
import { splitCompositeRef } from '../ir/refs.ts'

export interface CapabilityThresholdFinding {
  readonly capabilityId: string
  readonly kind:
    | 'capability_threshold_violation'
    | 'capability_threshold_unresolvable'
    | 'capability_threshold_unsupported'
    | 'capability_threshold_missing_value'
  readonly path: string
  readonly reason: string
}

/** 系列算子：数据通道未落地，fail-closed（绝不静默通过）。 */
const UNSUPPORTED_OPERATORS = new Set(['MONOTONE_INCREASING', 'MONOTONE_NONINCREASING', 'MAX_OVER_AXIS'])

function evaluateThreshold(
  threshold: FalsifiableThreshold,
  observed: number,
): { ok: boolean; detail: string } {
  const op = threshold.operator
  const t = threshold.threshold
  const tol = threshold.tolerance
  switch (op) {
    case 'LT': return { ok: observed < (t as number), detail: `observed ${observed} < ${t}` }
    case 'LE': return { ok: observed <= (t as number), detail: `observed ${observed} <= ${t}` }
    case 'GT': return { ok: observed > (t as number), detail: `observed ${observed} > ${t}` }
    case 'GE': return { ok: observed >= (t as number), detail: `observed ${observed} >= ${t}` }
    case 'EQ': return { ok: observed === t, detail: `observed ${observed} == ${t}` }
    case 'NE': return { ok: observed !== t, detail: `observed ${observed} != ${t}` }
    case 'ABS_LT': {
      const deviation = Math.abs(observed - (t as number))
      return { ok: deviation < (tol as number), detail: `|${observed} - ${t}| = ${deviation} < ${tol}` }
    }
    case 'REL_LT': {
      const reference = Math.abs(t as number)
      const rel = reference === 0 ? Math.abs(observed) : Math.abs(observed - (t as number)) / reference
      return { ok: rel < (tol as number), detail: `relative deviation ${rel} < ${tol}` }
    }
    case 'COUNT_ZERO': return { ok: observed === 0, detail: `violation count ${observed} == 0` }
    case 'MATCHES_EXACT': {
      // E-1 预留算子：v1 引擎只在接受显式 threshold 时可执行（等值比较）。
      // threshold 为 null 的情况已在调用侧 fail-closed。
      return { ok: observed === t, detail: `observed ${observed} matches ${t} exactly` }
    }
    case 'MONOTONE_INCREASING':
    case 'MONOTONE_NONINCREASING':
    case 'MAX_OVER_AXIS':
      return { ok: false, detail: `operator ${op} needs the series data channel (not landed)` }
  }
}

/**
 * Walk every CapabilitySpec in the store and evaluate its machine thresholds.
 * Pure, total, read-only. `judge=semantic` 能力不带阈值，天然跳过
 * （人读判据不进门——GATE-MAPPING §3 的"文本是阈值的投影"）。
 */
export function capabilityThresholdFindings(
  store: ReadonlyMap<string, IrObjectRecord> | null,
): ReadonlyArray<CapabilityThresholdFinding> {
  if (store === null) return []
  const findings: CapabilityThresholdFinding[] = []
  for (const record of store.values()) {
    if (record.kind !== 'CapabilitySpec') continue
    const capability = record.value
    if (capability.judge !== 'machine') continue
    for (let i = 0; i < capability.falsifiable_thresholds.length; i += 1) {
      const threshold = capability.falsifiable_thresholds[i]
      if (threshold === undefined) continue
      const path = `falsifiable_thresholds.${i}`
      findings.push(...evaluateOne(store, capability, threshold, path))
    }
  }
  return findings
}

function evaluateOne(
  store: ReadonlyMap<string, IrObjectRecord>,
  capability: CapabilitySpec,
  threshold: FalsifiableThreshold,
  path: string,
): ReadonlyArray<CapabilityThresholdFinding> {
  if (UNSUPPORTED_OPERATORS.has(threshold.operator)) {
    return [{
      capabilityId: capability.capability_id,
      kind: 'capability_threshold_unsupported',
      path,
      reason: `threshold ${path} uses operator '${threshold.operator}' whose series data channel is not landed — fail-closed (use a code-emitted aggregate Result with a scalar operator instead)`,
    }]
  }
  const composite = splitCompositeRef(threshold.subject_ref)
  const record = store.get(composite.id)
  if (record === undefined || record.kind !== 'Result') {
    return [{
      capabilityId: capability.capability_id,
      kind: 'capability_threshold_unresolvable',
      path,
      reason: `threshold ${path} subject '${threshold.subject_ref}' does not resolve to a Result (fail-closed: an unexecutable assertion can never silently pass)`,
    }]
  }
  const result = record.value as { result_id: string; value: number; unit: string; name: string }
  if (threshold.threshold === null) {
    return [{
      capabilityId: capability.capability_id,
      kind: 'capability_threshold_missing_value',
      path,
      reason: `threshold ${path} (${threshold.operator}) carries no threshold — the comparison has no reference value (fail-closed)`,
    }]
  }
  const verdict = evaluateThreshold(threshold, result.value)
  if (verdict.ok) return []
  return [{
    capabilityId: capability.capability_id,
    kind: 'capability_threshold_violation',
    path,
    reason: `capability '${capability.capability_id}' (${capability.name}): Result '${result.result_id}' (${result.name} = ${result.value} ${result.unit}) violates ${threshold.operator}: expected ${verdict.detail} [unit '${threshold.unit}'] — 该族典型退化被抓`,
  }]
}
