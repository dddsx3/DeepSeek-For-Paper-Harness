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
      advice: '换个说法重新提交题目；或用 --tier T3（最小填充面）重试。',
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

/** Default shell policy: strict mode + smallest face; production opt-in (F5/M-B). */
export function defaultShellPolicy(): Record<string, unknown> {
  return { mode: 'strict', tier: 'T3', produceFromExecute: true, produceExtensions: ['md'] }
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
