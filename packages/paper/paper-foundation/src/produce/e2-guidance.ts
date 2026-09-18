/**
 * W8.10-B1/B2 — the E2 drift guidance backfill.
 *
 * 问题（W8.9 §0.5 的失败分类）：
 *   run-1  `store_refused`    —— `ModelSpec` 引用 `DA-RAW` 解析为 `DataArtifact`（**引用类型错**）
 *   run-3  `store_refused`    —— 把表达式 `'P(Bin(n,0.10) > c)'` 当 `symbol_id`（**引用未注册**）
 *   run-3  `conflicting_id`   —— `S-P` 重复且内容不同（**重复 id**）
 *   run-3  `parse_failed`     —— JSON 语法错（12983 字符长输出）
 *
 * **前三条是"信息不足"**：模型不知道引用约束、不知道哪些 id 已注册。
 * 第四条是"输出能力"（B 组解决不了，见 §4-R1）。本模块只处理前三条。
 *
 * 做法：E2 失败后，把**结构化后的失败 reason** 拼入下一次 E2 的 prompt。
 * 三类内容：
 *   ① 引用类型约束 —— 直接派生自 `IR_REF_FIELDS`（单一真相源，不会漂移）
 *   ② 已注册 id 清单 —— 从 canonical store 快照取（"以下 id 已注册，不得重复声明"）
 *   ③ 上次的具体违规 —— 逐条 reason，不是泛泛的"请改正"
 *
 * 禁项（W8.10-B1）：**不得把回灌做成"加强协议教学"**——那会一并丢掉 E2 已有的
 * 合规产出。回灌只补"上次错在哪"，不重述整个 schema。
 *
 * 禁项（W8.10-B2 / 红线 N12）：**回灌文本不得含任何数值字面量**。零数字通道是
 * 项目的核心约束——数字只能经 `code → jsonPath → Result` 流动。回灌是散文，
 * 不得成为数字的第二入口。本模块在拼装后**机械剥离**数字（不是"保证没有"）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/e2-guidance
 */

import { IR_REF_FIELDS } from '../ir/refs.ts'
import type { IrKind } from '../ir/schema.ts'

/** One reference rule, as the guidance states it. */
export interface RefRule {
  readonly kind: string
  readonly path: string
  readonly target: string
}

/**
 * The reference rules for the kinds a container may declare.
 *
 * Derived from `IR_REF_FIELDS` — the same table `reference_validation` walks.
 * Deriving rather than restating is the point: a hand-written lecture would
 * drift from the validator the first time a kind gains a field, and the model
 * would then be told a rule the harness does not enforce.
 */
export function declarableRefRules(): ReadonlyArray<RefRule> {
  const declarable: ReadonlyArray<IrKind> = ['ModelSpec', 'RunArtifact', 'Result', 'Claim', 'FigureSpec']
  const out: RefRule[] = []
  for (const kind of declarable) {
    for (const spec of IR_REF_FIELDS[kind] ?? []) {
      const target = Array.isArray(spec.target)
        ? spec.target.join(' | ')
        : String(spec.target)
      out.push({ kind: String(kind), path: spec.path, target })
    }
  }
  return out
}

/**
 * W8.10-B2 — strip every numeric literal from a piece of guidance text.
 *
 * Why stripping rather than asserting: the raw failure reasons come from the
 * producer and CAN contain digits (byte offsets, line numbers, exit codes).
 * An assertion would either reject useful guidance or force the caller to
 * hand-craft reason text — and hand-crafting is how the diagnostic chain lost
 * its classification in the first place (A1). Stripping keeps the mechanism
 * mechanical: whatever the caller passes, what leaves here has no digits.
 *
 * A digit is replaced by `#` so the SHAPE of the removed token stays visible
 * ("position ####" still reads as "some offset") without carrying a value.
 *
 * @param text - any guidance fragment.
 */
export function stripNumericLiterals(text: string): string {
  return text.replace(/[0-9]/g, '#')
}

/** Whether a string is free of numeric literals (the prose-level invariant). */
export function hasNoNumericLiterals(text: string): boolean {
  return !/[0-9]/.test(text)
}

/**
 * W8.10-B2 (the invariant actually asserted on the shipped guidance).
 *
 * Every digit in `text` must fall inside one of `allowedIds`. Equivalent to
 * "the guidance contains no numeric literal other than the harness's own
 * identifiers" — which is the property the zero-number channel needs, and
 * which a blanket `[0-9]` check cannot express because those ids carry digits
 * (`P1` is the ProblemSpec id registered by `registerInputAssets`).
 *
 * @param text - the assembled guidance.
 * @param allowedIds - ids that may appear verbatim.
 */
export function hasNoNumericLiteralsOutsideIds(
  text: string,
  allowedIds: ReadonlyArray<string>,
): boolean {
  let scrubbed = text
  // Longest first so `SYM-q1` is removed before `SYM-q`.
  for (const id of [...allowedIds].sort((a, b) => b.length - a.length)) {
    if (id.length === 0) continue
    scrubbed = scrubbed.split(id).join('')
  }
  return !/[0-9]/.test(scrubbed)
}

/** One prior violation, as reported by the producer or the fidelity check. */
export interface PriorViolation {
  /** The producer/executor failure code (e.g. `store_refused`). */
  readonly code: string
  /** The human reason, verbatim from the audit trail. */
  readonly reason: string
}

/** What the guidance builder needs. */
export interface E2DriftGuidanceInput {
  /** Violations observed on the PREVIOUS attempt, in order. */
  readonly priorViolations: ReadonlyArray<PriorViolation>
  /** Ids already in the canonical store (must not be re-declared). */
  readonly registeredIds: ReadonlyArray<string>
}

/** The section header, kept as a constant so tests and prompts agree. */
export const E2_DRIFT_HEADER = '--- CORRECTIONS FOR THIS ATTEMPT (the previous attempt was refused) ---'

/**
 * Build the drift guidance appended to the NEXT E2 prompt.
 *
 * Returns the empty string when there is nothing to correct — a first attempt
 * gets the plain prompt (the teaching plus E1), byte-identical to W8.9's.
 * That keeps the initial call unchanged and confines the backfill to retries.
 *
 * @param input - the previous violations and the registered ids.
 */
export function e2DriftGuidance(input: E2DriftGuidanceInput): string {
  const { priorViolations, registeredIds } = input
  const hasViolations = priorViolations.length > 0
  const hasRegistered = registeredIds.length > 0
  if (!hasViolations && !hasRegistered) return ''

  // Prose lines are digit-stripped; the id list is appended VERBATIM (see the
  // SCOPE note on stripNumericLiterals — ids like `P1` carry digits and
  // mangling them would instruct the model to use a non-existent id).
  const lines: string[] = [E2_DRIFT_HEADER, '']

  // ③ the specific violations (most actionable, so first).
  if (hasViolations) {
    lines.push('What went wrong last time (fix exactly these, change nothing else):')
    for (const v of priorViolations) {
      lines.push(`  - [${v.code}] ${v.reason}`)
    }
    lines.push('')
  }

  // ① the reference-type constraints, derived from the validator's own table.
  lines.push('Reference rules (a reference must resolve to the stated kind — this is what the harness checks):')
  for (const rule of declarableRefRules()) {
    lines.push(`  - ${rule.kind}.${rule.path} -> ${rule.target}`)
  }
  lines.push('')

  lines.push('Do not restate the whole schema — only correct the items above.')

  // Strip per line, preserving each violation's `[CODE]` prefix: the code is
  // an identifier (`E1_E2_FIDELITY_VIOLATION`), not a quantity.
  const stripped = lines
    .map((line) => {
      const m = /^(\s*-\s*)\[([A-Za-z0-9_]+)\](.*)$/.exec(line)
      if (m === null) return stripNumericLiterals(line)
      return `${m[1]}[${m[2]}]${stripNumericLiterals(m[3] ?? '')}`
    })
    .join('\n')
  if (!hasRegistered) return stripped

  return [
    stripped,
    '',
    'These ids are ALREADY REGISTERED in the canonical store. Reference them by id; NEVER declare them again (re-declaring an id with different content is refused):',
    ...registeredIds.map(id => `  - ${id}`),
  ].join('\n')
}

/** The E2 prompt with the guidance appended (or the bare prompt when empty). */
export function e2PromptWithGuidance(basePrompt: string, guidance: string): string {
  if (guidance.length === 0) return basePrompt
  return `${basePrompt}\n\n${guidance}`
}
