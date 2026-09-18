const base = (process.env.PAPER_PROBE_BASE_URL ?? '').replace(/\/$/, '')
const key = process.env.PAPER_PROBE_API_KEY ?? ''
const list = await (await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } })).json() as { data?: Array<{ id: string }> }
const ids = (list.data ?? []).map(m => m.id)
console.log('probing', ids.length, 'models with a 1-token stream call each\n')
for (const id of ids) {
  const started = Date.now()
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'ok' }], max_tokens: 8, stream: true }),
    })
    const t = await r.text()
    const ok = r.status === 200 && t.includes('data:')
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${id.padEnd(28)} HTTP ${r.status} ${Date.now() - started}ms ${ok ? '' : t.slice(0, 90).replace(/\n/g, ' ')}`)
  } catch (e) {
    console.log(`FAIL ${id.padEnd(28)} THREW ${(e as Error).message}`)
  }
}
