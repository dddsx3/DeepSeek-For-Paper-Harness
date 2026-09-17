// O-L1-01 结清探针：三路同时观测 + raw SSE 落盘。
// 读 content 与 reasoning_content 两个通道；观测 finish_reason；
// prompt 用"产出 JSON"型任务（与 ir-container 同构：先推理后 JSON）。
import { appendFileSync, writeFileSync } from 'node:fs'

const KEY = process.env.PAPER_PROBE_API_KEY
const BASE = process.env.PAPER_PROBE_BASE_URL ?? 'https://api.y-api.bestvirtualgoods.com/v1'
const MODEL = process.env.PAPER_PROBE_MODEL ?? 'deepseek/deepseek-v4-flash'
const url = `${BASE.replace(/\/$/, '')}/chat/completions`

const prompt = [
  'You are a modeling assistant. Think briefly, then output EXACTLY ONE JSON object and nothing else.',
  'Shape: {"__dsh_paper":"ir-container-v1","entries":[{"kind":"SymbolSpec","value":{"symbol_id":"SYM-q","scope_ref":"P1","token":"q","meaning":"mean ice thickness","unit":"m","role":"VARIABLE","shape":"SCALAR","domain":"REAL","index_set":[]}},{"kind":"ModelSpec","value":{"model_id":"M1","problem_refs":["P1"],"assumption_refs":[],"variable_refs":["SYM-q"],"parameter_refs":[],"equation_refs":[],"constraints":[],"objective":"estimate thickness","dependencies":[]}}]}',
  'Task: estimate the mean thickness of polar ice and emit the container for that single variable.',
].join('\n')

const started = Date.now()
const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    stream: true,
    ...(process.env.PAPER_PROBE_MAX_OUTPUT_TOKENS ? { max_tokens: Number(process.env.PAPER_PROBE_MAX_OUTPUT_TOKENS) } : {}),
    stream_options: { include_usage: true },
  }),
})
console.log('HTTP', res.status, 'model requested:', MODEL)
const reader = res.body.getReader()
const decoder = new TextDecoder('utf-8')
let raw = ''
let content = ''
let reasoning = ''
let finishReason = null
let usage = null
let contentChunks = 0
let reasoningChunks = 0
let buffer = ''
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
      const c = p.choices?.[0]?.delta?.content
      if (typeof c === 'string' && c.length > 0) { content += c; contentChunks += 1 }
      const r = p.choices?.[0]?.delta?.reasoning_content
      if (typeof r === 'string' && r.length > 0) { reasoning += r; reasoningChunks += 1 }
      // 第三个假设：中转用别的字段名发 content —— 记录所有未知 delta 键
      const deltaKeys = Object.keys(p.choices?.[0]?.delta ?? {})
      if (deltaKeys.some(k => !['content', 'reasoning_content', 'role'].includes(k))) {
        appendFileSync('artifacts/handoff/W8.6/probe-p1-unknown-keys.log', JSON.stringify({ keys: deltaKeys, sample: data.slice(0, 200) }) + '\n')
      }
    } catch {}
  }
}
const wall = ((Date.now() - started) / 1000).toFixed(1)
writeFileSync('artifacts/handoff/W8.6/probe-p1-raw-sse.txt', raw)
const verdict = {
  model_requested: MODEL,
  finish_reason: finishReason,
  usage,
  content_chars: content.length,
  content_chunks: contentChunks,
  reasoning_chars: reasoning.length,
  reasoning_chunks: reasoningChunks,
  wall_seconds: Number(wall),
  content_is_json: content.trim().startsWith('{'),
  raw_sse_bytes: raw.length,
}
writeFileSync('artifacts/handoff/W8.6/probe-p1-result.json', JSON.stringify(verdict, null, 2))
console.log(JSON.stringify(verdict, null, 2))
