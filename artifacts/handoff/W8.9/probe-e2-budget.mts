/**
 * W8.9-D1 diagnostic 2 — the E2 prompt is LONG; does budget scale with it?
 *
 * 探针 1 的结论：短 prompt 下任何参数形态都产出 content（reasoning 只占
 * 50-67 字符）。故 D1 首跑的"零 content"不是参数问题，而是**prompt 长度**
 * 问题：E2 的输入是 E1 全文 + 协议教学，模型对长输入的 reasoning 会暴涨。
 *
 * 本探针用真实 E2 prompt 测三个预算档，确认"需要多少预算才能拿到 content"。
 * 这是给 D1（和未来真实运行）的**实测依据**，不是猜测。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { e2NormalizationPrompt } from '../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'
import { EXECUTE_PROTOCOL_TEACHING } from '../../../packages/paper/paper-foundation/src/executor.ts'

const env = readFileSync('.env.local', 'utf8')
for (const line of env.split('\n')) {
  const t = line.trim()
  if (t === '' || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq <= 0) continue
  process.env[t.slice(0, eq).trim()] ??= t.slice(eq + 1).trim()
}
const base = process.env.PAPER_PROBE_BASE_URL!.replace(/\/$/, '')
const key = process.env.PAPER_PROBE_API_KEY!
const model = process.env.PAPER_PROBE_MODEL!

const analysis = readFileSync(
  join('packages', 'paper', 'paper-foundation', 'tests', 'fixtures', 'e1-run4-analysis.txt'),
  'utf8',
)
const prompt = e2NormalizationPrompt(analysis, EXECUTE_PROTOCOL_TEACHING)
console.log(`E2 prompt chars: ${prompt.length}`)
console.log('')

const BUDGETS = [8000, 24000, 40000]

for (const maxTokens of BUDGETS) {
  const started = Date.now()
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
      reasoning_effort: 'none',
    }),
  })
  const j = await r.json() as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null } }>
    usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
    error?: { message?: string }
  }
  const ms = Date.now() - started
  const content = j.choices?.[0]?.message?.content ?? ''
  const reasoning = j.choices?.[0]?.message?.reasoning_content ?? ''
  const finish = j.choices?.[0]?.finish_reason ?? '?'
  const out = j.usage?.completion_tokens ?? 0
  const reas = j.usage?.completion_tokens_details?.reasoning_tokens ?? reasoning.length
  console.log(
    `max_tokens=${String(maxTokens).padEnd(6)} HTTP ${r.status} finish=${finish.padEnd(9)} ` +
    `out=${String(out).padEnd(6)} reasoning_tokens=${String(reas).padEnd(6)} content_chars=${String(content.length).padEnd(6)} ${ms}ms`,
  )
  if (j.error !== undefined) console.log('  error:', j.error.message)
  if (content.length > 0) {
    console.log('  content head:', JSON.stringify(content.slice(0, 200)))
    break
  }
}
