// P1-mini: 小规模探针 —— 短 prompt + max_tokens=3000。目标是看清
// (1) reasoning_content 通道是否存在 (2) 中转把内容放在哪个 delta 字段。
import { writeFileSync, appendFileSync } from 'node:fs'
const KEY = process.env.PAPER_PROBE_API_KEY
const BASE = process.env.PAPER_PROBE_BASE_URL ?? 'https://api.y-api.bestvirtualgoods.com/v1'
const MODEL = process.env.PAPER_PROBE_MODEL ?? 'deepseek/deepseek-v4-flash'
const url = `${BASE.replace(/\/$/, '')}/chat/completions`
const started = Date.now()
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: '输出一行 JSON: {"ok":true}。只输出 JSON,不要解释。' }],
    temperature: 0.2,
    stream: true,
    max_tokens: 3000,
    stream_options: { include_usage: true },
  }),
})
console.log('HTTP', res.status, '| ct:', res.headers.get('content-type'))
const reader = res.body.getReader()
const decoder = new TextDecoder('utf-8')
let raw = ''
let content = '', reasoning = ''
let finishReason = null, usage = null
let buffer = ''
const unknownKeys = new Set()
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  const text = decoder.decode(value, { stream: true })
  raw += text
  buffer += text
  let i
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).replace(/\r$/, '')
    buffer = buffer.slice(i + 1)
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '' || data === '[DONE]') continue
    try {
      const p = JSON.parse(data)
      if (p.usage) usage = p.usage
      const fr = p.choices?.[0]?.finish_reason
      if (typeof fr === 'string') finishReason = fr
      const d = p.choices?.[0]?.delta ?? {}
      if (typeof d.content === 'string' && d.content.length > 0) content += d.content
      if (typeof d.reasoning_content === 'string' && d.reasoning_content.length > 0) reasoning += d.reasoning_content
      for (const k of Object.keys(d)) if (!['content', 'reasoning_content', 'role'].includes(k)) unknownKeys.add(k)
    } catch {}
  }
}
const wall = ((Date.now() - started) / 1000).toFixed(1)
writeFileSync('artifacts/handoff/W8.6/probe-p1-mini-raw-sse.txt', raw)
const verdict = {
  http_status: res.status,
  finish_reason: finishReason,
  usage,
  content_chars: content.length,
  reasoning_chars: reasoning.length,
  unknown_delta_keys: [...unknownKeys],
  wall_seconds: Number(wall),
  content: content.slice(0, 200),
}
writeFileSync('artifacts/handoff/W8.6/probe-p1-mini-result.json', JSON.stringify(verdict, null, 2))
console.log(JSON.stringify(verdict, null, 2))
