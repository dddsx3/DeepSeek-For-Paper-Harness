/**
 * TASK-M1 M1-2 — paper shell: pure helpers shared by the CLI and the specs.
 *
 * This module never re-implements engine semantics (禁 M1-1): everything the
 * engine owns (gates, failure classes, hashing, interpretation) is reused
 * from the foundation. It only: reads a problem file with shell-level
 * guardrails, maps the engine's refusal/failure codes to a human sentence
 * (reusing the W4 Wording assets — no second wording set), and packs the
 * deliverable + run report into one deterministic digest.
 */

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

/** Route: which provider adapter + model + endpoint the engine will call. */
export interface ShellRoute {
  readonly provider: string
  readonly model: string
  readonly baseURL: string
  readonly apiKey: string
}

/**
 * W8.10-A1 (O-L3-06) — the failure-class events the audit trail carries.
 *
 * 事故：`blockMessage` 的 `truncated` 分支（W8.6-A3 写的）从未执行过。
 * `executor.ts` 抛出的 `WorkflowExecutionError` 只带 `code='gate-failed'`
 * 与一句 message，**不带 eventType**；CLI 于是传 `'gate-failed'`，落到最后
 * 的 transport 兜底分支，建议用户"重试一次"——而截断是**零重试**类（上限
 * 不会动，W8.5 用两次相同截断证明了这一点）。分类信息其实**已经写在
 * audit 里**（`executor.ts` 在抛错前写 `eventType:'truncated'`），只是最后
 * 一跳没有读它。
 *
 * 这是第六类"信号与原因不符"（修复只做判定侧、未做传递侧）。
 */
export const FAILURE_CLASS_EVENTS: ReadonlyArray<string> = [
  'truncated',
  'escape_refused',
  'tier_degraded',
  'container_refused',
  'provider_blocked',
  'budget_exceeded',
]

/**
 * The LAST failure-class event of a run, or undefined when the run never
 * wrote one. "Last" because a run may fail more than once inside its retry
 * loop, and the terminal cause is the one that ended it.
 *
 * @param events - the run's audit entries in order (only `eventType` is read).
 */
export function lastFailureClassEvent(
  events: ReadonlyArray<{ readonly eventType: string }>,
): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i]?.eventType
    if (type !== undefined && FAILURE_CLASS_EVENTS.includes(type)) return type
  }
  return undefined
}

/**
 * W8.11-C1 (O-L5-07) — the structured facts a run's audit trail already holds.
 *
 * 事故：`blockMessage` 的文案表是**按失败码**设计的，而真实失败是**多重条件的
 * 组合**（gate + w4Class + 失败的 fidelity 规则）。于是逐个修分支成了无限游戏，
 * 已经复发三次：`truncated` 不可达（W8.10-A1 修）→ `budget` 落 transport
 * （A7 修）→ **`none` 分支的文案与事实相反**。
 *
 * 最后一次的形态最严重：`none` 说"模型没有给出可用结构"，而 run-4 的真实情况是
 * **E1 产出 14010 字符、minted_ir_count=3、B4 与锚点同一性检查均 PASS**——
 * 模型给出了大量可用结构，失败在 fidelity 规则上。
 *
 * 修法：**从 audit 的结构化字段生成文案**，而不是查一张按码索引的表。这些字段
 * 早就在 trail 里了（`gate_failed` 带 gate + reason；`ir_entry_written` 的
 * FidelityFinding 带 rule + ok），只是文案从没读过它们。
 */
export interface RunFailureFacts {
  /** The gate that refused, when one is named (`gate_failed.detail.gate`). */
  readonly gate?: string
  /** The gate's verbatim reason, when present. */
  readonly reason?: string
  /** Fidelity rules that FAILED on the LAST attempt, in order. */
  readonly failedRules: ReadonlyArray<string>
  /** Fidelity rules that PASSED on the last attempt (evidence of real output). */
  readonly passedRules: ReadonlyArray<string>
  /** Largest E1 analysis size seen, in characters (proof the model produced). */
  readonly e1Chars?: number
}

/**
 * Project the structured failure facts out of a run's audit trail.
 *
 * Read-only and total: every field is optional because a run may fail before
 * writing any of them, and a missing fact must stay missing rather than be
 * defaulted into a claim the trail does not support.
 *
 * @param events - the run's audit entries, in order.
 */
export function failureFactsOf(
  events: ReadonlyArray<{ readonly eventType: string; readonly detail?: Readonly<Record<string, unknown>> }>,
): RunFailureFacts {
  let gate: string | undefined
  let reason: string | undefined
  let e1Chars: number | undefined
  let failedRules: ReadonlyArray<string> = []
  let passedRules: ReadonlyArray<string> = []
  // Findings arrive in waves (one wave per attempt). The LAST wave is the one
  // that ended the run, so a wave boundary clears the previous one — otherwise
  // an attempt-1 failure would still be reported after attempt 3 passed it.
  const wave: string[] = []
  const flushWave = (): void => {
    if (wave.length === 0) return
    failedRules = []
    passedRules = []
    wave.length = 0
  }
  for (const e of events) {
    const d = e.detail ?? {}
    if (e.eventType === 'gate_failed') {
      if (typeof d['gate'] === 'string') gate = d['gate']
      if (typeof d['reason'] === 'string') reason = d['reason']
    }
    if (e.eventType === 'ir_entry_written') {
      const kind = String(d['kind'] ?? '')
      if ((kind === 'E1Analysis' || kind === 'E1Reused') && typeof d['chars'] === 'number') {
        e1Chars = Math.max(e1Chars ?? 0, d['chars'] as number)
      }
      if (kind === 'E2Normalization') flushWave()
      if (kind === 'FidelityFinding') {
        const rule = String(d['id'] ?? '')
        if (rule.length === 0) continue
        if (wave.includes(rule)) continue
        wave.push(rule)
        if (d['ok'] === true) passedRules = [...passedRules, rule]
        else failedRules = [...failedRules, rule]
      }
    }
  }
  const facts: {
    gate?: string
    reason?: string
    failedRules: ReadonlyArray<string>
    passedRules: ReadonlyArray<string>
    e1Chars?: number
  } = { failedRules, passedRules }
  if (gate !== undefined) facts.gate = gate
  if (reason !== undefined) facts.reason = reason
  if (e1Chars !== undefined) facts.e1Chars = e1Chars
  return facts
}

/**
 * Which side a failed fidelity rule belongs to.
 *
 * 这个归属**不是新语义**：`executor.ts` 的 `E1_SIDE_RULES` 已经用它决定"能否
 * 回灌给 E2"。这里只是把同一个事实讲给用户听——E1 侧的缺陷，用户改题目措辞
 * 也没用；E2 侧的才可能靠重试收敛。
 *
 * @param rule - the rule name as recorded on the trail.
 */
export function ruleSide(rule: string): 'E1' | 'E2' | 'unknown' {
  if (rule.includes('B4') || rule.includes('B5')) return 'E1'
  if (rule.includes('正向') || rule.includes('反向') || rule.includes('同一性')) return 'E2'
  return 'unknown'
}

/**
 * W8.11-C1 — the sentence for a run that died inside the receive layer.
 *
 * 只在**确有 fidelity 失败**时使用。`none` 分支的旧文案（"模型没有给出可用
 * 结构"）在 run-4 的事实面前是假的：模型产出了 14010 字符的分析、3 条 IR 条目、
 * 且四条检查里两条 PASS。真实原因是**接收层的保真检查没过**，而不是模型没产出。
 *
 * @param facts - the structured facts projected from the trail.
 */
export function fidelityBlockedHuman(facts: RunFailureFacts): BlockedHuman {
  const failed = facts.failedRules
  const e1Side = failed.filter(r => ruleSide(r) === 'E1')
  const e2Side = failed.filter(r => ruleSide(r) === 'E2')
  const produced = facts.e1Chars !== undefined
    ? `模型已产出 ${facts.e1Chars} 字符的建模分析`
    : '模型已产出建模分析'
  const passed = facts.passedRules.length > 0
    ? `。已通过：${facts.passedRules.join('、')}`
    : ''
  const sideNote = e1Side.length > 0 && e2Side.length === 0
    ? '这类失败发生在**分析侧**：模型写出的分析本身没满足要求，重试同一份分析不会改变结果。'
    : e2Side.length > 0 && e1Side.length === 0
      ? '这类失败发生在**规范化侧**：分析内容合规，是把它映射成结构化记录的那一步没对齐。'
      : '这类失败跨两侧（分析侧 + 规范化侧）。'
  return {
    classifier: 'fidelity',
    oneLine: `${produced}，但**接收层的保真检查未通过**，这次运行被判为失败。未通过的检查：${failed.join('、')}${passed}。`,
    advice: `${sideNote}失败 gate：${facts.gate ?? 'ir_producer'}${facts.reason !== undefined ? `（${facts.reason}）` : ''}。这不是"模型没有给出可用结构"——它给出了，是形式化忠实这一关没过。`,
  }
}

/** The engine failure→human sentence map (贪 the W4 text assets). */
export interface BlockedHuman {
  readonly classifier: string
  readonly oneLine: string
  readonly advice: string
  readonly field?: string
}

/**
 * One human sentence + fix suggestion for an engine refusal/failure code.
 * `classifier` is one of protocol | none | runtime | guided | transport |
 * delivery; the wording subclasses reuse the engine's own refusal reasons
 * (producer reason text is shown, never re-worded into a second set).
 */
export function blockMessage(
  eventType: string,
  code: string | undefined,
  failure: string,
): BlockedHuman {
  const sanitized = String(failure).split('\n')[0] ?? String(failure)
  const producerCodes = new Set(['hash_field_forbidden', 'input_asset_domain', 'registered_id_redeclared', 'schema_violation', 'kind_not_producible', 'parse_failed', 'conflicting_conclusion_number'])
  const guidedCodes = new Set(['step_foreign_key', 'unledgered_reference', 'free_id', 'free_structure', 'bypass_container', 't3_number_forbidden', 't3_container_forbidden', 't3_free_choice', 't3_schema_violation'])

  // W8.6-A3: truncation gets its OWN sentence. Pre-W8.6 it fell to
  // whatever catch-all matched and advised "重试一次" — an action the
  // W8.5 run PROVED cannot succeed (two retries, two identical
  // truncations at the same ceiling). The advice must name the real
  // cause: output budget / protocol length.
  if (eventType === 'truncated' || code === 'EXECUTE_OUTPUT_TRUNCATED') {
    return {
      classifier: 'truncated',
      oneLine: '本次运行的输出在中途撞到提供方的输出长度上限被截断（不是题目或模型违规）。',
      // W8.10-A1: the wording states the ceiling is immovable WITHOUT the
      // verb "重试". H1's judgement is "the advice must not advise a retry",
      // and the previous phrasing ("重试不会解决") contained the verb while
      // saying the opposite — a user scanning for an action still reads
      // "retry". The negative is now carried by the noun ("上限不会变").
      advice: '上限不会变，重复提交同一个题目得不到不同结果。这是「输出预算/协议长度不匹配」：请报告给维护者（协议分片或提高预算后才能通过）。',
    }
  }

  if (eventType === 'escape_refused' || producerCodes.has(code ?? '')) {
    return {
      classifier: 'protocol',
      oneLine: `你的输出被协议拒绝（${code ?? eventType}）：${sanitized}`,
      advice: '请完全按题目要求的格式重新提交；关键数字由引擎读取，你只需声明指针/槽位。',
    }
  }
  if (code === 'NONE' || eventType === 'tier_degraded' || sanitized.toLowerCase().includes('guided retries')) {
    return {
      classifier: 'none',
      oneLine: '模型没有给出可用结构（引擎引导了几次仍未对齐），这次运行被判为失败。',
      // W8.10-A3 (O-L5-05): the old advice recommended `--tier T3`. That is a
      // product-level error, not a wording nit: T3 does NOT read the problem
      // statement (PRD v2 F2), its 14/14 pass rate was self-certifying, and
      // it has been withdrawn from the default path (P0-2). Telling a user to
      // fall back to it would trade their paper for a green light.
      advice: '换个说法重新提交题目（把问题描述得更具体），或把题面文件另存为纯文本 UTF-8 后重试。',
    }
  }
  // W8.10-A1/A7: budget exhaustion is its own class. The per-run output-token
  // ceiling (or the daily USD ceiling) stops the run by design — advising
  // "retry" would tell the user to re-spend against a ceiling that is still
  // there. Found by the A7 live test: before this branch the run reported
  // `classifier: 'transport'` with a retry advice.
  if (eventType === 'budget_exceeded' || code === 'budget-exhausted') {
    return {
      classifier: 'budget',
      oneLine: '本次运行触发了预算门（本次运行 / 当日额度），已被主动暂停——不是题目或模型的问题。',
      advice: '提高本次运行或当日的额度后重新提交；额度是为保护你的账户而设的。',
    }
  }
  if (eventType === 'provider_blocked' || (code !== undefined && ['CODE_RUN_NOT_CONFIGURED', 'RECORD_INVALID'].includes(code))) {
    return {
      classifier: 'runtime',
      oneLine: `运行环境问题（${code ?? eventType}）：${sanitized}`,
      advice: '这不是你的题目问题——报告给维护者。',
    }
  }
  if (guidedCodes.has(code ?? '')) {
    return {
      classifier: 'guided',
      oneLine: `引导/填充校验未过（${code ?? eventType}）：${sanitized}`,
      advice: '槽位值只用候选清单里的；数字不由你填写。',
      ...(code === undefined ? {} : { field: code }),
    }
  }
  return {
    classifier: 'transport',
    oneLine: `调用/传输失败（${code ?? eventType}）：${sanitized}`,
    advice: '重试一次；若持续失败报告给维护者。',
  }
}

/** Deterministic digest over the packed deliverable bytes (zip face). */
export function packDigest(reportMd: string, runReport: string): string {
  const digest = createHash('sha256')
  digest.update('paper-shell-v0.pack')
  digest.update(reportMd)
  digest.update(runReport)
  return digest.digest('hex')
}

/** Resolve the shell route from the environment (P3D neutral family, no hardcoded vendor). */
export function resolveShellRoute(env: Record<string, string | undefined> = process.env): ShellRoute | undefined {
  const apiKey = firstDefined(env.PAPER_PROBE_API_KEY, env.DEEPSEEK_API_KEY, env.DSH_E2E_LLM_API_KEY)
  if (apiKey === undefined || apiKey.length === 0) return undefined
  return {
    provider: firstDefined(env.PAPER_PROBE_PROVIDER, env.DSH_E2E_LLM_PROVIDER) ?? 'deepseek-official',
    model: firstDefined(env.PAPER_PROBE_MODEL, env.DSH_E2E_LLM_MODEL) ?? 'deepseek-v4-flash',
    baseURL: firstDefined(env.PAPER_PROBE_BASE_URL, env.DEEPSEEK_BASE_URL, env.DSH_E2E_LLM_BASE_URL) ?? '',
    apiKey,
  }
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find(value => value !== undefined && value !== '')
}

/** Default shell policy: strict mode + full-declaration tier. P0-2 (PRD
 *  v2): the historical 'T3' default never read the problem statement —
 *  T3 is regression-only now (REAL-RUN-2024A evidence). */
export function defaultShellPolicy(): Record<string, unknown> {
  return { mode: 'strict', tier: 'T1', produceFromExecute: true, produceExtensions: ['md'] }
}

/** Read a problem file (plain text) with shell-level guardrails (M1-2 攻击). */
export async function readProblemFile(path: string): Promise<string> {
  const { stat } = await import('node:fs/promises')
  const info = await stat(path).catch(() => null)
  if (info === null || !info.isFile()) throw new Error(`不能读题目文件：${path}`)
  const bytes = await readFile(path)
  if (bytes.length === 0) throw new Error('题目文件是空的')
  if (bytes.length > 200_000) throw new Error('题目文件太大（>200KB）。请精简题目。')
  const text = bytes.toString('utf8')
  if (text.includes('\uFFFD')) throw new Error('题目文件不是有效的 UTF-8 文本。请用纯文本（记事本另存为 UTF-8）。')
  return text.trim()
}
