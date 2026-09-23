/**
 * L6-f — 复验登记表：**重跑真检查器**，而不是给文本算哈希。
 *
 * ## 这一层为什么必须存在（一个必须记下的缺陷）
 *
 * 闭环的第一版把 finding 的 `fingerprint` 定义成
 * `sha256(category :: evidence :: 文本长度)`。它看起来能用，实际是**假复验**：
 * 模型只要把那段文字改长或改短一个字符，指纹就变了，闭环于是判定"已修复"——
 * 而**没有任何检查器跑过**。这恰好是 C1 要防的形态（"我改过了"不是证据），
 * 只不过伪装成了机器判定。
 *
 * 正确的定义只有一个：**指纹 = 重跑同一个检查器后，它报出的违规集合**。
 * 违规消失了 → 指纹变 → 真修好了；违规还在（哪怕文字全换了）→ 指纹不变 →
 * 未修复。
 *
 * ## 覆盖范围是**声明式**的
 *
 * 每个类别登记一个 recheck 函数。**没有登记的类别不会得到"猜测的指纹"**——
 * 它落 `checker_failed`，在闭环里等价于"未通过"（C3）。宁可如实说"没法复验"，
 * 也不要给一个会骗人的数字。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/recheck
 */

import type { IrObjectRecord } from '../ir/store.ts'
import { blankAreaViolations, numericClaimCensus, proseContractViolations, proseContractViolationsOfText, type ContractRequirement } from './prose-contracts.ts'
import { requirementCoverageFindings } from './requirement-coverage.ts'
import { digitSelfContradictionFindings } from './digit-check.ts'
import { deliveredNumberFindings } from './delivered-numbers.ts'
import { runVerificationV1V4 } from '../verification/v-structure.ts'
import type { RecheckOutcome } from './finding.ts'
import { structHashOf } from '../verification/semantic-fingerprint.ts'

/** 复验的输入：被检查产物的当前状态。 */
export interface RecheckInput {
  /** 交付正文（渲染后的完整文本）。 */
  readonly text: string
  /** 渲染用的 narrative（散文契约检查读它，不是读渲染文本）。 */
  readonly narrative: Readonly<Record<string, unknown>>
  /** 子问题要求（散文契约/空白密度检查需要）。 */
  readonly requirements: ReadonlyArray<ContractRequirement>
  /** 规范 IR 快照；未挂载时为 null。 */
  readonly store: ReadonlyMap<string, IrObjectRecord> | null
}

/** 一个类别的复验函数：跑真检查器，返回它的违规指纹。 */
export type Rechecker = (input: RecheckInput) => RecheckOutcome

/**
 * 把一组违规对象压成一个**稳定**指纹。
 *
 * ## 为什么必须剥掉数字（这是本模块最容易被写错的一处）
 *
 * 违规的 `reason` 文本里**带着易变量**：`"问题分析只有 9 字（低于 1200 字的下限）"`。
 * 若直接对 reason 取指纹，模型把那段话从 9 字改到 24 字就会让指纹变化——闭环于是
 * 判定"已修复"，而**违规依旧**。这与第一版"给文本长度算哈希"是同一个缺陷的
 * 更隐蔽形态（负对照当场抓到）。
 *
 * 判据因此是：**指纹只保留判别性结构**——哪条规则、落在哪一章/哪个目标——
 * **剥掉所有数字与空白**。于是：
 *
 *   - 违规**消失** → 集合变小 → 指纹变 → 真修好了；
 *   - 违规**仍在**（哪怕措辞、字数、那个错数字全换了）→ 结构不变 → 指纹不变 → 未修复。
 *
 * 这个取舍对每一类都成立：一个"字数不达标"的违规不会因为字数变了就变成另一条违规；
 * 一个"未声明来源的数字"也不会因为数字本身换了就变成已修复。
 *
 * @param items - 检查器报出的违规集合（只取判别字段）。
 */
export function fingerprintOfViolations(items: ReadonlyArray<Record<string, unknown>>): string {
  const normalized = items
    .map(item => JSON.stringify(
      Object.keys(item).sort().map(k => [k, stripVolatile(String(item[k] ?? ''))]),
    ))
    .sort()
  return `n=${String(items.length)};${normalized.join('|')}`
}

/**
 * 剥掉文本里的易变量：数字与空白。
 *
 * 刻意**不做**更激进的归一化（不去标点、不做同义词折叠）——那会让不同的违规
 * 撞成同一个指纹，即"改了却看不出来"，方向相反的同类错误。
 *
 * @param text - 违规描述。
 */
export function stripVolatile(text: string): string {
  return text.replace(/[0-9]+(?:\.[0-9]+)?/g, '#').replace(/\s+/g, '')
}

/** 违规集合 → 复验结果。空集合的指纹是 `n=0`，因此"违规清零"必然改变指纹。 */
function fromViolations(items: ReadonlyArray<Record<string, unknown>>): RecheckOutcome {
  return { kind: 'fingerprint', value: fingerprintOfViolations(items) }
}

/** 未登记的类别 → 如实说"没法复验"，不给猜测值。 */
const UNREGISTERED: Rechecker = input => ({
  kind: 'checker_failed',
  reason: `没有为这个类别登记复验检查器——无法独立判断修复是否发生（文本长度 ${String(input.text.length)} 不作为证据）`,
})

/**
 * 类别 → 复验函数。
 *
 * **判据**：这个类别有没有一个**确定性、可重跑、读产物**的检查器？
 * 有就登记；没有就不登记（落 `checker_failed`）。
 */
export const RECHECKERS: ReadonlyMap<string, Rechecker> = new Map<string, Rechecker>([
  // 散文契约：逐章要素与实质地板。
  //
  // **输入必须与报告该 finding 的那一次相同**，否则复验检查的不是同一个东西——
  // 那是另一种假复验。产线链的 finding 来自 `proseContractViolations(narrative)`；
  // 兜底路径没有 narrative（键为空），它的 finding 来自按渲染正文重跑的那一支。
  // 判据因此是"narrative 是否为空"，而不是"哪条路径"——它直接对上了两个来源。
  ['prose_contract', input => fromViolations(
    (Object.keys(input.narrative).length === 0
      ? proseContractViolationsOfText(input.text, input.requirements)
      : proseContractViolations(input.narrative, input.requirements)
    ).map(v => ({
      chapter: v.chapter, title: v.title, reason: v.reason,
    })),
  )],
  // 空白密度：连续空行与近空章节。
  ['blank_area', input => fromViolations(
    blankAreaViolations(input.text, input.requirements).map(v => ({
      chapter: v.chapter, title: v.title, reason: v.reason,
    })),
  )],
  // 逐问覆盖：每个子问题是否被一条 CRITICAL 链真正付清。
  ['required_output_unpaid', input => fromViolations(
    requirementCoverageFindings(input.store).map(f => ({ problem: f.problemId, reason: f.reason })),
  )],
  // 假设结构：V1–V4（未被引用的假设 / 缺来源 / 缺敏感性 / 模型覆盖）。
  ['assumption_structure', input => fromViolations(
    input.store === null
      ? []
      : runVerificationV1V4(input.store as never)
        .filter(f => !f.ok)
        .map(f => ({ rule: f.rule, detail: f.detail })),
  )],
  // 模型结构：方程 / 假设 / 方法 / 参数 / 符号表的规范化指纹。
  //
  // 这是**语义类修复**能被看见的唯一通道：换方法、增删方程、调整假设都会改变
  // 它，而数值指纹对这三类**完全无感**。反过来说，若结构指纹没变，那"我改了
  // 模型"就不成立——判据是结构，不是措辞。
  ['model_structure', input => fromViolations(
    input.store === null ? [] : [{ structure: structHashOf(modelStructureOf(input.store)) }],
  )],
  // 数字自洽：正文里的算式自身矛盾。
  ['digit_check', input => fromViolations(
    digitSelfContradictionFindings(input.text).map(f => ({ kind: f.kind, reason: f.reason })),
  )],
  // 数字暴露量：正文里**未经代码通道验证**的数字字面量个数。
  //
  // 只在兜底路径（B-e1-direct）会报这条，所以复验的含义很直接：**数字降到 0
  // 才算修好**——那意味着这一稿的数字全部换成了代码产出的 Result（或占位符）。
  // 用"数量下降"当判据是错的：改掉一个错数字、又写下另一个，数量没变而问题还在。
  ['unverified_numbers', (input) => {
    const count = numericClaimCensus(input.text)
    return count === 0 ? fromViolations([]) : fromViolations([{ unverified_numbers: count }])
  }],
  // 数字可回溯：正文数字能否在产物里找到同值。
  // `deliveredNumberFindings` 收的是"允许的数字串"清单，因此这里必须按
  // executor 的同一条口径重建它（Result 值 + 不确定度 + 题面给定常数），
  // 否则复验检查的就不是同一个东西——那是另一种假复验。
  ['delivered_numbers', input => fromViolations(
    deliveredNumberFindings(input.text, allowedNumberStrings(input.store))
      .map(f => ({ id: f.id, severity: f.severity, description: f.description })),
  )],
])

/**
 * 从 IR 快照里抽出结构指纹的输入。
 *
 * 口径与 L4 的 `ModelStructure` 一致：方程（规范化表达式）+ 假设 id 集 +
 * 方法族 + 参数签名 + 符号表。**不含任何文字表述**——表述变化属于呈现层，
 * 由评审通道负责。
 *
 * @param store - 规范 IR 快照。
 */
export function modelStructureOf(store: ReadonlyMap<string, IrObjectRecord>): {
  readonly equations: ReadonlyArray<{ readonly id: string; readonly expression: string }>
  readonly assumptionIds: ReadonlyArray<string>
  readonly method: string
  readonly parameters: Readonly<Record<string, number>>
  readonly symbols: ReadonlyArray<string>
} {
  const equations: Array<{ id: string; expression: string }> = []
  const assumptionIds: string[] = []
  const symbols: string[] = []
  const parameters: Record<string, number> = {}
  const methods: string[] = []
  for (const record of store.values()) {
    const v = record.value as Record<string, unknown>
    if (record.kind === 'EquationSpec') {
      equations.push({ id: String(v['equation_id'] ?? ''), expression: String(v['expression'] ?? '') })
    } else if (record.kind === 'AssumptionSpec') {
      assumptionIds.push(String(v['assumption_id'] ?? ''))
    } else if (record.kind === 'SymbolSpec') {
      symbols.push(String(v['token'] ?? ''))
    } else if (record.kind === 'ModelSpec') {
      methods.push(String(v['objective'] ?? ''))
      for (const ref of (Array.isArray(v['parameter_refs']) ? v['parameter_refs'] : []) as ReadonlyArray<Record<string, unknown>>) {
        const key = String(ref['symbol_ref'] ?? '')
        const value = ref['value']
        if (key.length > 0 && typeof value === 'number') parameters[key] = value
      }
    }
  }
  return { equations, assumptionIds, method: methods.sort().join('|'), parameters, symbols }
}

/**
 * 重建"允许出现在正文里的数字串"清单。
 *
 * 口径与 executor 的检出侧**完全一致**：Result 的值与不确定度、以及题面
 * （RequirementSpec.statement）里给定的常数。两处不一致会让复验比对两个不同的
 * 集合，从而给出无意义的"已修复"。
 *
 * @param store - 规范 IR 快照。
 */
export function allowedNumberStrings(store: ReadonlyMap<string, IrObjectRecord> | null): ReadonlyArray<string> {
  if (store === null) return []
  const allowed: string[] = []
  for (const record of store.values()) {
    if (record.kind === 'Result') {
      const result = record.value as { value?: unknown; uncertainty?: unknown }
      if (typeof result.value === 'number') allowed.push(String(result.value))
      if (typeof result.uncertainty === 'number') allowed.push(String(result.uncertainty))
    }
    if (record.kind === 'RequirementSpec') {
      const statement = (record.value as { statement?: unknown }).statement
      if (typeof statement === 'string') {
        for (const literal of statement.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []) allowed.push(literal)
      }
    }
  }
  return allowed
}

/**
 * 复验一条 finding。
 *
 * @param category - finding 的类别（与门禁 id 对齐）。
 * @param input - 被检查产物的当前状态。
 * @returns 新指纹，或"这个类别没法复验"。
 */
/**
 * 建模类类别 → 用**结构指纹**复验。
 *
 * 这些类别的"修复"意味着重声明模型（换方法、增删方程、调假设），因此唯一有意义
 * 的复验就是"结构变了没有"。它们此前落 `unverifiable`（没有检查器），现在有了
 * 一个**真检查**——而且这个检查恰好能抓住"改文字冒充改建模"。
 */
export const STRUCTURE_RECHECK_CATEGORIES: ReadonlySet<string> = new Set([
  'PRODUCE_CHAIN_NO_MODEL',
  'placeholder_chapter',
  'model_structure',
  'figure_data_consistency',
  'numeric_consistency',
  'config_consistency',
])

export function recheckFinding(category: string, input: RecheckInput): RecheckOutcome {
  const checker = RECHECKERS.get(category)
    ?? (STRUCTURE_RECHECK_CATEGORIES.has(category) ? RECHECKERS.get('model_structure') : undefined)
    ?? UNREGISTERED
  try {
    return checker(input)
  } catch (error) {
    // 检查器自己抛了 → 未跑通，与"未通过"同级（C3）。绝不吞掉成"通过"。
    return { kind: 'checker_failed', reason: `复验检查器抛出异常：${(error as Error).message}` }
  }
}

/**
 * 计算一条 finding 的**初始**指纹——同样由真检查器给出。
 *
 * 初始指纹与复验指纹来自**同一个函数**，这是"比对"能成立的前提：
 * 两个不同的算法算出的值没法比。
 *
 * @param category - finding 的类别。
 * @param input - 检出时的产物状态。
 */
export function initialFingerprint(category: string, input: RecheckInput): string {
  const outcome = recheckFinding(category, input)
  return outcome.kind === 'fingerprint' ? outcome.value : `unverifiable:${outcome.reason}`
}
