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
