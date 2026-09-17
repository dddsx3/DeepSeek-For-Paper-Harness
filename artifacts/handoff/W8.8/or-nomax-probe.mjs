// Decisive probe: long generation WITHOUT max_tokens (the V1 configuration).
// Does the stream end mid-way without a finish chunk? Record raw tail.
import { writeFileSync } from 'node:fs'
const prompt = [
  'You are a modeling assistant. Think briefly, then output EXACTLY ONE JSON object and nothing else. No prose, no markdown fences.',
  'Shape: {"__dsh_paper":"ir-container-v1","entries":[<entries>],"code":"...","run":{...},"interpretations":{...},"narrative":{...}}.',
  'Declare 5 symbols, 2 assumptions, 2 equations, 1 model, node code that writes output, and interpretations for 3 results. Task: quality inspection decisions for parts production (CUMCM 2024-B style).',
].join('\n')
const started = Date.now()
const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PAPER_PROBE_API_KEY}` },
  body: JSON.stringify({ model: 'stealth/union-alpha', messages: [{ role: 'user', content: prompt }], temperature: 0.2, stream: true, stream_options: { include_usage: true } }),
})
console.log('HTTP', res.status)
if (res.status !== 200) { console.log((await res.text()).slice(0, 300)); process.exit(0) }
const reader = res.body.getReader()
const decoder = new TextDecoder('utf-8')
let raw = '', buffer = '', content = '', finishReason = null, usage = null, sawDone = false
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  const text = decoder.decode(value, { stream: true })
  raw += text; buffer += text
  let i
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).replace(/\r$/, '')
    buffer = buffer.slice(i + 1)
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') { sawDone = true; continue }
    if (data === '') continue
    try {
      const p = JSON.parse(data)
      if (p.usage) usage = p.usage
      if (p.error) console.log('IN-BAND ERROR:', JSON.stringify(p.error).slice(0, 200))
      const fr = p.choices?.[0]?.finish_reason
      if (typeof fr === 'string') finishReason = fr
      const c = p.choices?.[0]?.delta?.content
      if (typeof c === 'string') content += c
    } catch {}
  }
}
writeFileSync('artifacts/handoff/W8.8/or-nomax-raw.txt', raw)
console.log('saw [DONE]:', sawDone)
console.log('finish_reason:', JSON.stringify(finishReason))
console.log('usage:', JSON.stringify(usage))
console.log('content chars:', content.length, '| wall:', ((Date.now()-started)/1000).toFixed(1), 's')
console.log('content tail:', JSON.stringify(content.slice(-150)))
