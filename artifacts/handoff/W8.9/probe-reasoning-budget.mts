/**
 * W8.9-D1 diagnostic — which request shape gets CONTENT out of the relay?
 *
 * 背景：D1 的首次真实 E2 调用返回 `content: ""` 且 output=16000（撞上限），
 * 即 reasoning 通道吃掉了全部预算（P1 探针记录的 reasoning:content ≈ 14.6:1
 * 在这里表现为"零内容"）。本探针用小 max_tokens 快速试几种参数形态，找出
 * 能产出 content 的那一种——不猜，实测。
 *
 * 每次调用都是免费模型（cost=0）；小预算 → 快。
 */

import { readFileSync } from 'node:fs'

const text = readFileSync('.env.local', 'utf8')
for (const line of text.split('\n')) {
  const t = line.trim()
  if (t === '' || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq <= 0) continue
  process.env[t.slice(0, eq).trim()] ??= t.slice(eq + 1).trim()
}
const base = process.env.PAPER_PROBE_BASE_URL!.replace(/\/$/, '')
const key = process.env.PAPER_PROBE_API_KEY!
const model = process.env.PAPER_PROBE_MODEL!

const PROMPT = 'Reply with exactly this JSON and nothing else: {"ok":true}'

const VARIANTS: ReadonlyArray<{ name: string; extra: Record<string, unknown> }> = [
  { name: 'baseline', extra: {} },
  { name: 'reasoning_effort=none', extra: { reasoning_effort: 'none' } },
  { name: 'reasoning_effort=minimal', extra: { reasoning_effort: 'minimal' } },
  { name: 'enable_thinking=false', extra: { enable_thinking: false } },
  { name: 'thinking=disabled', extra: { thinking: { type: 'disabled' } } },
  { name: 'chat_template_kwargs', extra: { chat_template_kwargs: { enable_thinking: false } } },
]

for (const variant of VARIANTS) {
  const body = {
    model,
    messages: [{ role: 'user', content: PROMPT }],
    max_tokens: 200,
    temperature: 0,
    ...variant.extra,
  }
  const started = Date.now()
  let status = 0
  let finish = '?'
  let contentLen = 0
  let reasoningLen = 0
  let err = ''
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    })
    status = r.status
    const j = await r.json() as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null } }>
      usage?: { completion_tokens?: number }
      error?: { message?: string }
    }
    if (j.error !== undefined) err = j.error.message ?? 'error'
    finish = j.choices?.[0]?.finish_reason ?? '?'
    contentLen = (j.choices?.[0]?.message?.content ?? '').length
    reasoningLen = (j.choices?.[0]?.message?.reasoning_content ?? '').length
  } catch (e) {
    err = e instanceof Error ? e.message : String(e)
  }
  const ms = Date.now() - started
  const verdict = contentLen > 0 ? 'CONTENT' : 'NO-CONTENT'
  console.log(
    `${variant.name.padEnd(26)} ${String(status).padEnd(4)} ${String(finish).padEnd(9)} ` +
    `content=${String(contentLen).padEnd(5)} reasoning=${String(reasoningLen).padEnd(6)} ${String(ms).padEnd(6)}ms ${verdict}` +
    (err === '' ? '' : `  err=${err.slice(0, 60)}`),
  )
}
