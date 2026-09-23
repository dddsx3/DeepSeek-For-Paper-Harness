/**
 * L4 — 语义指纹与三通道复验。
 *
 * ## 为什么单靠数值指纹不够
 *
 * L6 的复验判据是"修复后重跑同一 checker，看 fingerprint 是否改变"。若 fingerprint
 * 只覆盖**数值**，那么"换方法、增删方程、调整假设"这类**语义层修复**在指纹上
 * **看起来毫无变化**——修复被误判为"没修"。这是复验在建模层的**半盲**。
 *
 * 修法不是换判据，是**加通道**：
 *
 * ```
 * 修复成立 ⟺ 数值指纹变化        （覆盖数值类修复）
 *          ∨ 结构指纹变化        （覆盖语义类修复：换方法、增删方程、调整假设）
 *          ∨ 评审重打分达标      （覆盖呈现类修复：表述、图表、结构）
 * ```
 *
 * 三条取**或**。这条设计的价值在于：它让"改文字去迎合旧数字"**不再能伪装成修复**——
 * 那种改动会让数值指纹不变、结构指纹不变、评审分也不动，于是三通道一致判"未修"。
 *
 * ## 结构指纹覆盖什么
 *
 * 方程（规范化后的符号形式）+ 假设 id 集（排序）+ 方法族与关键参数签名 + 符号表。
 * **不含**文字表述——表述变化属于呈现层，由评审通道负责。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/verification/semantic-fingerprint
 */

import { createHash } from 'node:crypto'

/** 结构指纹的输入：模型本体的可机械提取部分。 */
export interface ModelStructure {
  /** 方程：id + 规范化表达式（去空白、去排版差异）。 */
  readonly equations: ReadonlyArray<{ readonly id: string; readonly expression: string }>
  /** 假设 id 集合（会排序，集合语义）。 */
  readonly assumptionIds: ReadonlyArray<string>
  /** 方法族标识（自由文本，由模型给；不参与闭集判定）。 */
  readonly method: string
  /** 关键参数签名：符号 token → 值。 */
  readonly parameters: Readonly<Record<string, number>>
  /** 符号表：排序后的 token 列表。 */
  readonly symbols: ReadonlyArray<string>
}

/**
 * 规范化一个表达式：只去掉**排版**差异，不动任何符号或数字。
 *
 * 与保真门的折叠同源（`foldForAnchorMatch` 的取向）：折叠只做"不改变任何字词"的事，
 * 否则结构指纹会把同一份模型判成两份。
 *
 * @param expression - 原始表达式。
 */
export function normalizeExpression(expression: string): string {
  return expression
    .replace(/\s+/g, '')
    .replace(/\$\$?/g, '')
    .replace(/\\(?:left|right|,|;|!|quad|qquad)/g, '')
    .replace(/\\(?:cdot|times)/g, '*')
    .replace(/\\(?:ge|geq)/g, '>=')
    .replace(/\\(?:le|leq)/g, '<=')
    .toLowerCase()
}

/**
 * 计算模型的结构指纹。
 *
 * 稳定性要求：**同一份模型必然得到同一个指纹**（因此排序、数值规范化都要做全），
 * 否则复验会把"没改"判成"改了"——那是假阳性，比漏报更伤闭环的可信度。
 *
 * @param structure - 见 {@link ModelStructure}。
 */
export function structHashOf(structure: ModelStructure): string {
  const canonical = {
    equations: [...structure.equations]
      .map(e => ({ id: e.id, expression: normalizeExpression(e.expression) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    assumptions: [...structure.assumptionIds].sort((a, b) => a.localeCompare(b)),
    method: structure.method.trim().toLowerCase(),
    parameters: Object.fromEntries(
      Object.entries(structure.parameters)
        .map(([k, v]) => [k, Number.isFinite(v) ? Number(v.toPrecision(12)) : v] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    symbols: [...structure.symbols].sort((a, b) => a.localeCompare(b)),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex').slice(0, 32)
}

/** 三通道复验的输入。 */
export interface ThreeChannelInput {
  /** 修复前的数值指纹（checker 产出）。 */
  readonly numericBefore: string
  /** 修复后的数值指纹；未重跑则为 null。 */
  readonly numericAfter: string | null
  /** 修复前的结构指纹。 */
  readonly structBefore: string
  /** 修复后的结构指纹；未重算则为 null。 */
  readonly structAfter: string | null
  /** 修复前的评审分。 */
  readonly scoreBefore: number | null
  /** 修复后的评审分。 */
  readonly scoreAfter: number | null
  /** 评审达标的分数门槛（例如 6 分制下的 6，或 10 分制下的 7）。 */
  readonly scoreThreshold: number
}

/** 三通道复验的结论。 */
export interface ThreeChannelVerdict {
  /** 是否判定为"已修复"。 */
  readonly repaired: boolean
  /** 哪条通道给出了肯定信号（空数组 = 三条都没动）。 */
  readonly channels: ReadonlyArray<'numeric' | 'structure' | 'review'>
  /** 人读的判定说明——**必须能被独立复核**。 */
  readonly detail: string
}

/**
 * 三通道复验：任一条通道显示实质变化，即判定修复成立。
 *
 * **重要**：`repaired === false` 的语义是"**未修复**"，不是"检查失败"。
 * 调用方必须把它推回闭环（重试或消解），**不许沉默通过**（C1）。
 *
 * @param input - 见 {@link ThreeChannelInput}。
 */
export function threeChannelVerdict(input: ThreeChannelInput): ThreeChannelVerdict {
  const channels: Array<'numeric' | 'structure' | 'review'> = []
  const notes: string[] = []

  if (input.numericAfter !== null && input.numericAfter !== input.numericBefore) {
    channels.push('numeric')
    notes.push(`数值指纹变化 ${short(input.numericBefore)} → ${short(input.numericAfter)}`)
  } else {
    notes.push(input.numericAfter === null ? '数值指纹未重跑' : `数值指纹未变（${short(input.numericBefore)}）`)
  }

  if (input.structAfter !== null && input.structAfter !== input.structBefore) {
    channels.push('structure')
    notes.push(`结构指纹变化 ${short(input.structBefore)} → ${short(input.structAfter)}`)
  } else {
    notes.push(input.structAfter === null ? '结构指纹未重算' : `结构指纹未变（${short(input.structBefore)}）`)
  }

  if (
    input.scoreAfter !== null &&
    input.scoreAfter >= input.scoreThreshold &&
    (input.scoreBefore === null || input.scoreAfter > input.scoreBefore)
  ) {
    channels.push('review')
    notes.push(`评审分 ${input.scoreBefore === null ? '—' : String(input.scoreBefore)} → ${String(input.scoreAfter)}（门槛 ${String(input.scoreThreshold)}）`)
  } else if (input.scoreAfter !== null) {
    notes.push(`评审分 ${input.scoreBefore === null ? '—' : String(input.scoreBefore)} → ${String(input.scoreAfter)}，未达门槛 ${String(input.scoreThreshold)} 或未上升`)
  }

  return {
    repaired: channels.length > 0,
    channels,
    detail: channels.length > 0
      ? `判定已修复（通道：${channels.join(' / ')}）。${notes.join('；')}`
      : `**判定未修复**：三条通道均未显示实质变化。${notes.join('；')}。"我改过了"不作为证据（C1）——重跑产出脚本，或把该项推进消解（显式接受）。`,
  }
}

function short(hash: string): string {
  return hash.slice(0, 8)
}
