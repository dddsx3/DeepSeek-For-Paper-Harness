// Long-prompt streaming probe: does the finish chunk still arrive when
// the model generates a big ir-container-like output?
import { writeFileSync } from 'node:fs'
const prompt = [
  'You are a modeling assistant. Think briefly, then output EXACTLY ONE JSON object and nothing else. No prose, no markdown fences.',
  'Shape: {"__dsh_paper":"ir-container-v1","entries":[<entries>],"narrative":{"title":"..."}}.',
  'entries kinds: SymbolSpec {"symbol_id","scope_ref":"P1","token","meaning","unit","role","shape","domain","index_set"}; ModelSpec {"model_id","problem_refs":["P1"],"assumption_refs","variable_refs","parameter_refs","equation_refs","constraints","objective","dependencies"}.',
  'Declare 3 symbols and 1 model. Task: quality inspection decisions for parts production.',
].join('\n')
const started = Date.now()
const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.PAPER_PROBE_API_KEY}` },
  body: JSON.stringify({ model: 'stealth/union-alpha', messages: [{ role: 'user', content: prompt }], temperature: 0.2, stream: true, max_tokens: 4000, stream_options: { include_usage: true } }),
})
console.log('HTTP', res.status, 'in', ((Date.now()-started)/1000).toFixed(1), 's')
if (res.status !== 200) { console.log(await res.text().then(t => t.slice(0,200))); process.exit(0) }
const reader = res.body.getReader()
const decoder = new TextDecoder('utf-8')
let raw = '', buffer = '', content = '', finishReason = null, usage = null
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
    if (data === '' || data === '[DONE]') continue
    try {
      const p = JSON.parse(data)
      if (p.usage) usage = p.usage
      const fr = p.choices?.[0]?.finish_reason
      if (typeof fr === 'string') finishReason = fr
      const c = p.choices?.[0]?.delta?.content
      if (typeof c === 'string') content += c
    } catch {}
  }
}
writeFileSync('artifacts/handoff/W8.8/or-longstream-raw.txt', raw)
console.log('finish_reason:', JSON.stringify(finishReason))
console.log('usage:', JSON.stringify(usage))
console.log('content chars:', content.length)
console.log('content head:', JSON.stringify(content.slice(0, 120)))
