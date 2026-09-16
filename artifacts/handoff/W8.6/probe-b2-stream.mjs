// W8.6-B2 stream probe: does max_tokens=40000 exceed the 32k default?
// Streams (non-stream 50k got 524). Records: max_tokens sent, completion
// tokens received, finish_reason, wall time. Raw SSE kept alongside.
import { writeFileSync, appendFileSync } from 'node:fs'

const KEY = process.env.PAPER_PROBE_API_KEY
const BASE = process.env.PAPER_PROBE_BASE_URL ?? 'https://api.y-api.bestvirtualgoods.com/v1'
const url = `${BASE.replace(/\/$/, '')}/chat/completions`
const started = Date.now()
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: process.env.PAPER_PROBE_MODEL ?? 'deepseek/deepseek-v4-flash',
    messages: [{ role: 'user', content: "Write the exact token 'AAAA' on its own line, then repeat the line. Keep going without stopping. Do not summarise, do not apologise, do not stop early." }],
    temperature: 0.2,
    stream: true,
    max_tokens: 40000,
    stream_options: { include_usage: true },
  }),
})
console.log('HTTP', res.status, 'after', ((Date.now() - started) / 1000).toFixed(1), 's')
let text = ''
let finishReason = null
let usage = null
let chunks = 0
const reader = res.body.getReader()
const decoder = new TextDecoder('utf-8')
let buffer = ''
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
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
      const d = p.choices?.[0]?.delta?.content
      if (typeof d === 'string' && d.length > 0) { text += d; chunks += 1 }
    } catch {}
  }
}
const wall = ((Date.now() - started) / 1000).toFixed(1)
console.log('finish_reason:', finishReason)
console.log('usage:', JSON.stringify(usage))
console.log('output chars:', text.length, '| chunks:', chunks, '| wall:', wall, 's')
appendFileSync('artifacts/handoff/W8.6/probe-b2-stream-result.json', JSON.stringify({ max_tokens_sent: 40000, finish_reason: finishReason, usage, output_chars: text.length, wall_seconds: Number(wall) }) + '\n')
