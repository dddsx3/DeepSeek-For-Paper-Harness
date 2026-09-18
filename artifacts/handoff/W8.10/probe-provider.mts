const base = (process.env.PAPER_PROBE_BASE_URL ?? '').replace(/\/$/, '')
const key = process.env.PAPER_PROBE_API_KEY ?? ''
const model = process.env.PAPER_PROBE_MODEL ?? ''
console.log('base =', base, '| model =', model)
for (const variant of [
  { label: 'no reasoning_effort', body: {} },
  { label: 'reasoning_effort=none', body: { reasoning_effort: 'none' } },
] as const) {
  const started = Date.now()
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'say OK' }], max_tokens: 20, stream: true, ...variant.body }),
    })
    const t = await r.text()
    console.log(`${variant.label}: HTTP ${r.status} in ${Date.now() - started} ms | ${t.slice(0, 160).replace(/\n/g, ' ')}`)
  } catch (e) {
    console.log(`${variant.label}: THREW ${(e as Error).message} after ${Date.now() - started} ms`)
  }
}
