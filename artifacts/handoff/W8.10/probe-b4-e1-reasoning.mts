/**
 * W8.10-B4 — the reasoning_effort ROLE-SPLIT probe (read-only).
 *
 * 问题（本轮唯一要回答的）：`reasoningEffort()` 在
 * `apps/paper-shell/src/real-provider.ts` 里是**适配器级**的——它对
 * 所有调用一视同仁，因此 **E1（自由分析）也被压制推理**。而 E1 是全系统
 * 的质量源头（E2 只做映射）。W8.9 的探针只测了 E2 的长 prompt 场景，
 * 从未测过 E1。
 *
 * 本探针拿**同一个真实 E1 prompt**（题面 + plan + 协议教学 + E1 指令，
 * 与 `executor.ts:1434` 逐字同构）跑两次真实 API 调用：
 *   arm A: `reasoning_effort: "none"`   （= 生产适配器当前的默认）
 *   arm B: 不传该字段                    （= 不限，模型默认）
 * 比较：长度 / [[ASSUMPTION]] 锚点数 / 逐问（R-OUT）覆盖 / 是否回抄占位符。
 *
 * 红线 N14：**只探测，不改默认值**。本文件在 artifacts/ 下，不碰
 * packages/ 与 apps/。生产默认仍是 `reasoningEffort()` 返回 'none'。
 *
 * 用法：
 *   ./node_modules/.bin/tsx artifacts/handoff/W8.10/probe-b4-e1-reasoning.mts
 *
 * 模型：优先 PAPER_PROBE_MODEL 的覆盖值 `PAPER_B4_MODEL`（默认目标模型
 * `deepseek/deepseek-v4-flash`），先做一次可用性预检再开跑。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleBundle } from '../../../apps/paper-shell/src/bundle.ts'
import { classifyProblem, routeBanner } from '../../../apps/paper-shell/src/route.ts'
import { contractBanner } from '../../../apps/paper-shell/src/contracts/index.ts'
import { renderSections } from '../../../packages/paper/paper-foundation/src/context.ts'
import { EXECUTE_PROTOCOL_TEACHING } from '../../../packages/paper/paper-foundation/src/executor.ts'
import {
  E1_ASSUMPTION_MARKER,
  E1_REQUIREMENT_MARKER,
  e1AnalysisInstruction,
  parseE1Anchors,
} from '../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

function loadDotEnvLocal(): void {
  let text = ''
  try {
    text = readFileSync(join(repoRoot, '.env.local'), 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim()
  }
}

/** The production adapter's own executor system prompt (executor.ts:401). */
const EXECUTOR_SYSTEM = 'You are a careful task executor. Produce complete, correct output for the given task. Be concise.'
/** The harness's registered requirement id (executor.ts:947/975). */
const REQUIRED_IDS = ['R-OUT']
/** Output budget: route-env.sh's PAPER_PROBE_MAX_OUTPUT_TOKENS value. */
const MAX_TOKENS = Number(process.env.PAPER_B4_MAX_TOKENS ?? '24000')
/** Safety valve only — a streaming call that runs this long is a failure.
 *  Measured on this relay: the unlimited-reasoning arm burned 24k tokens in
 *  387 s, so the 65536-token ceiling re-run needs a generous window. */
const CALL_TIMEOUT_MS = Number(process.env.PAPER_B4_TIMEOUT_MS ?? '1800000')

interface CallResult {
  readonly label: string
  readonly status: number
  readonly content: string
  readonly reasoning: string
  readonly finishReason: string | null
  readonly inBandError: string | null
  readonly promptTokens: number
  readonly completionTokens: number
  readonly reasoningTokens: number | undefined
  readonly elapsedMs: number
  readonly transportError: string | null
}

/** One real streaming call; accumulates content and reasoning channels. */
async function callOnce(
  label: string,
  base: string,
  key: string,
  model: string,
  prompt: string,
  extra: Record<string, unknown>,
): Promise<CallResult> {
  const started = Date.now()
  let status = 0
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  let inBandError: string | null = null
  let promptTokens = 0
  let completionTokens = 0
  let reasoningTokens: number | undefined
  let transportError: string | null = null
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: EXECUTOR_SYSTEM },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        stream: true,
        max_tokens: MAX_TOKENS,
        stream_options: { include_usage: true },
        ...extra,
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    status = r.status
    if (!r.ok || r.body === null) {
      const excerpt = (await r.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ')
      transportError = `HTTP ${r.status}: ${excerpt}`
    } else {
      const reader = r.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, '')
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf('\n')
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '' || data === '[DONE]') continue
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ finish_reason?: string | null; delta?: { content?: string; reasoning_content?: string } }>
              usage?: {
                prompt_tokens?: number
                completion_tokens?: number
                completion_tokens_details?: { reasoning_tokens?: number }
              }
              error?: { message?: string }
            }
            if (chunk.error !== undefined) inBandError = chunk.error.message ?? 'error'
            if (chunk.usage !== undefined) {
              promptTokens = chunk.usage.prompt_tokens ?? promptTokens
              completionTokens = chunk.usage.completion_tokens ?? completionTokens
              reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens
            }
            const reason = chunk.choices?.[0]?.finish_reason
            if (typeof reason === 'string') finishReason = reason
            const d = chunk.choices?.[0]?.delta
            if (typeof d?.content === 'string' && d.content.length > 0) content += d.content
            if (typeof d?.reasoning_content === 'string' && d.reasoning_content.length > 0) reasoning += d.reasoning_content
          } catch {
            /* a non-JSON keep-alive line is not a protocol error */
          }
        }
      }
    }
  } catch (e) {
    transportError = `THREW ${(e as Error).message}`
  }
  return {
    label,
    status,
    content,
    reasoning,
    finishReason,
    inBandError,
    promptTokens,
    completionTokens,
    reasoningTokens,
    elapsedMs: Date.now() - started,
    transportError,
  }
}

/** The three comparison dimensions B4 asked for, computed on raw E1 text. */
function measure(r: CallResult): {
  chars: number
  assumptionAnchors: number
  requirementAnchors: number
  coveredIds: ReadonlyArray<string>
  missingIds: ReadonlyArray<string>
  placeholderEcho: boolean
  uniqueAssumptionIds: ReadonlyArray<string>
} {
  const anchors = parseE1Anchors(r.content)
  const covered = new Set(anchors.requirements.map(a => a.id))
  return {
    chars: r.content.length,
    assumptionAnchors: anchors.assumptions.length,
    requirementAnchors: anchors.requirements.length,
    coveredIds: REQUIRED_IDS.filter(id => covered.has(id)),
    missingIds: REQUIRED_IDS.filter(id => !covered.has(id)),
    placeholderEcho: r.content.includes('<your-short-id>') || r.content.includes('<id>'),
    uniqueAssumptionIds: [...new Set(anchors.assumptions.map(a => a.id))],
  }
}

async function main(): Promise<number> {
  loadDotEnvLocal()
  const base = (process.env.PAPER_PROBE_BASE_URL ?? '').replace(/\/$/, '')
  const key = process.env.PAPER_PROBE_API_KEY ?? ''
  const model = process.env.PAPER_B4_MODEL ?? 'deepseek/deepseek-v4-flash'
  if (base === '' || key === '') {
    console.log('[SKIP] no PAPER_PROBE_BASE_URL / PAPER_PROBE_API_KEY in .env.local — cannot probe.')
    return 0
  }

  console.log('=== W8.10-B4 — reasoning_effort role-split probe (E1) ===')
  console.log(`model: ${model}   (target model; .env.local PAPER_PROBE_MODEL=${process.env.PAPER_PROBE_MODEL ?? '-'})`)
  console.log(`max_tokens: ${MAX_TOKENS}`)
  console.log('')

  // --- preflight: is the chosen model actually callable? ------------------
  const preflight = await callOnce('preflight', base, key, model, 'say OK', { max_tokens: 16 })
  console.log(`[preflight] HTTP ${preflight.status} finish=${String(preflight.finishReason)} ${preflight.elapsedMs}ms` +
    (preflight.transportError === null ? '' : `  ${preflight.transportError.slice(0, 120)}`))
  if (preflight.status !== 200) {
    console.log('[ABORT] the model is not callable on this route; nothing to compare. Failure recorded above.')
    return 1
  }

  // --- build the REAL E1 prompt (executor.ts:640-657 + 1434) --------------
  const bundle = await assembleBundle(join(repoRoot, 'bench', 'problems', '2024-B', 'problem.pdf'))
  const verdict = classifyProblem(bundle.taskText)
  if (!verdict.ok) {
    console.log(`[ABORT] the problem did not route: ${verdict.reason}`)
    return 1
  }
  const taskText = `${bundle.taskText}${routeBanner(verdict)}${contractBanner(verdict.family)}`
  const task = { name: 'task', text: `Task: ${taskText}`, trimPriority: 0 }

  // The plan node runs first in the real workflow; its text is an INPUT to
  // the E1 prompt. Generate it once, then hold it FIXED across both arms so
  // the only difference between A and B is `reasoning_effort`.
  const planPrompt = renderSections([
    task,
    { name: 'instruction', text: 'Produce a short numbered execution plan.', trimPriority: 0 },
  ])
  const planCall = await callOnce('plan', base, key, model, planPrompt, { reasoning_effort: 'none' })
  if (planCall.content.length === 0) {
    console.log(`[ABORT] the plan node produced no content (HTTP ${planCall.status}); cannot build the E1 prompt.`)
    return 1
  }
  const plan = { name: 'plan', text: `Plan:\n${planCall.content}`, trimPriority: 0 }
  const e1Prompt = `${renderSections([
    task,
    plan,
    { name: 'instruction', text: EXECUTE_PROTOCOL_TEACHING, trimPriority: 0 },
  ])}\n\n${e1AnalysisInstruction(REQUIRED_IDS)}`

  console.log(`problem: bench/problems/2024-B/problem.pdf  (pypdf text ${bundle.taskText.length} chars)`)
  console.log(`route: ${verdict.family} — ${verdict.note}`)
  console.log(`plan node: ${planCall.content.length} chars (fixed for both arms)`)
  console.log(`E1 prompt: ${e1Prompt.length} chars`)
  console.log('')

  // --- the two arms ------------------------------------------------------
  const ARMS: ReadonlyArray<{ label: string; extra: Record<string, unknown> }> = [
    { label: 'A reasoning_effort=none', extra: { reasoning_effort: 'none' } },
    { label: 'B default (field absent)', extra: {} },
  ]
  const results: CallResult[] = []
  for (const arm of ARMS) {
    process.stdout.write(`${arm.label} ... `)
    const r = await callOnce(arm.label, base, key, model, e1Prompt, arm.extra)
    results.push(r)
    const m = measure(r)
    console.log(
      `HTTP ${r.status} finish=${String(r.finishReason)} content=${m.chars} reasoning=${r.reasoning.length} ` +
      `assump=${m.assumptionAnchors} req=${m.requirementAnchors} ${r.elapsedMs}ms` +
      (r.transportError === null ? '' : ` ERR=${r.transportError.slice(0, 80)}`),
    )
    // If the unlimited arm came back empty or cut short, its content quality
    // is not yet observable — escalating the budget makes the comparison
    // about QUALITY rather than about budget starvation. The relay rejects
    // max_tokens > 65536 with HTTP 400 ("max_tokens must be an integer
    // between 1 and 65536"), so the escalation is clamped to that measured
    // ceiling instead of guessing a number the endpoint will refuse.
    if (arm.label.startsWith('B') && (r.content.length === 0 || r.finishReason === 'length')) {
      const relayMax = Number(process.env.PAPER_B4_RELAY_MAX_TOKENS ?? '65536')
      const escalated = Math.min(Number(process.env.PAPER_B4_ESCALATED_TOKENS ?? String(relayMax)), relayMax)
      if (escalated > MAX_TOKENS) {
        process.stdout.write(`  → B content unusable at ${MAX_TOKENS}; re-running B at the relay ceiling max_tokens=${escalated} ... `)
        const r2 = await callOnce('B2 default, relay ceiling budget', base, key, model, e1Prompt, {
          max_tokens: escalated,
        })
        results.push(r2)
        const m2 = measure(r2)
        console.log(
          `HTTP ${r2.status} finish=${String(r2.finishReason)} content=${m2.chars} reasoning=${r2.reasoning.length} ` +
          `assump=${m2.assumptionAnchors} req=${m2.requirementAnchors} ${r2.elapsedMs}ms` +
          (r2.transportError === null ? '' : ` ERR=${r2.transportError.slice(0, 80)}`),
        )
      }
    }
  }

  // --- raw dump + comparison table ---------------------------------------
  const outPath = join(here, 'probe-b4-e1-reasoning-output.txt')
  const lines: string[] = []
  lines.push('W8.10-B4 — reasoning_effort role-split probe, RAW outputs')
  lines.push(`generated: ${new Date().toISOString()}`)
  lines.push(`model: ${model}`)
  lines.push(`problem: bench/problems/2024-B/problem.pdf (pypdf text ${bundle.taskText.length} chars, route ${verdict.family})`)
  lines.push(`E1 prompt: ${e1Prompt.length} chars, max_tokens ${MAX_TOKENS}`)
  lines.push(`plan node output (fixed for both arms): ${planCall.content.length} chars`)
  lines.push(`E1 prompt sha256: ${await sha256(e1Prompt)}`)
  lines.push(`temperature: 0.2 (as the production adapter sends) — arms differ ONLY in reasoning_effort`)
  lines.push('')
  lines.push('='.repeat(78))
  lines.push('E1 PROMPT (verbatim, both arms used this exact string)')
  lines.push('='.repeat(78))
  lines.push(e1Prompt)
  lines.push('')
  for (const r of results) {
    lines.push('='.repeat(78))
    lines.push(`ARM ${r.label}`)
    lines.push(`HTTP ${r.status} | finish=${String(r.finishReason)} | in-band error=${String(r.inBandError)}`)
    lines.push(`transport error: ${String(r.transportError)}`)
    lines.push(`tokens: prompt=${r.promptTokens} completion=${r.completionTokens} reasoning=${String(r.reasoningTokens)}`)
    lines.push(`elapsed: ${r.elapsedMs}ms | content chars=${r.content.length} | reasoning chars=${r.reasoning.length}`)
    lines.push('='.repeat(78))
    lines.push('--- reasoning_content (verbatim) ---')
    lines.push(r.reasoning.length === 0 ? '(empty)' : r.reasoning)
    lines.push('--- content (verbatim) ---')
    lines.push(r.content.length === 0 ? '(empty)' : r.content)
    lines.push('')
  }
  writeFileSync(outPath, lines.join('\n'), 'utf8')
  console.log('')
  console.log(`raw outputs -> ${outPath}`)
  console.log('')

  const cols = ['arm', 'chars', 'assump', 'req', 'covered', 'placeholder', 'finish', 'out_tok', 'reason_tok', 'ms']
  const rows = results.map(r => {
    const m = measure(r)
    return [
      r.label,
      String(m.chars),
      String(m.assumptionAnchors),
      String(m.requirementAnchors),
      m.missingIds.length === 0 ? `${m.coveredIds.length}/${REQUIRED_IDS.length}` : `${m.coveredIds.length}/${REQUIRED_IDS.length} (missing ${m.missingIds.join(',')})`,
      m.placeholderEcho ? 'YES' : 'no',
      String(r.finishReason),
      String(r.completionTokens),
      String(r.reasoningTokens ?? '-'),
      String(r.elapsedMs),
    ]
  })
  const width = cols.map((c, i) => Math.max(c.length, ...rows.map(r => (r[i] ?? '').length)))
  const fmt = (cells: ReadonlyArray<string>): string => cells.map((c, i) => c.padEnd(width[i] ?? 0)).join('  ')
  console.log(fmt(cols))
  console.log(width.map(w => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(fmt(row))
  console.log('')
  console.log(`markers: assumption="${E1_ASSUMPTION_MARKER}" requirement="${E1_REQUIREMENT_MARKER}"`)
  return 0
}

async function sha256(text: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

main().then(code => process.exit(code)).catch(error => {
  console.error('probe failed:', error)
  process.exit(1)
})
