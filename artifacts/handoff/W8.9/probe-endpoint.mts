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
console.log('configured model =', model)
const r1 = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } })
const j1 = await r1.json() as { data?: Array<{ id: string }> }
const ids = (j1.data ?? []).map(m => m.id)
console.log('model present in /models:', ids.includes(model))
console.log('z-ai models:', ids.filter(i => i.startsWith('z-ai')).join(', '))
console.log('glm models:', ids.filter(i => i.toLowerCase().includes('glm')).slice(0,10).join(', '))
// try a minimal non-stream call
const r2 = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'say OK' }], max_tokens: 5 }),
})
const t2 = await r2.text()
console.log('POST /chat/completions ->', r2.status, r2.headers.get('content-type'))
console.log('body head:', t2.slice(0, 300).replace(/\n/g, ' '))
