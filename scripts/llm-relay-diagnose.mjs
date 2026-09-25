// 诊断脚本（专家建议第〇节）：推理为什么会出现在 content 里？
// 用法：PAPER_PROBE_BASE_URL=... PAPER_PROBE_API_KEY=... PAPER_PROBE_MODEL=... node scripts/llm-relay-diagnose.mjs [模式]
// 模式：diag（默认，最小请求）| compare（对同一 prompt 分别用 默认/关思考 各发一次）
import { readFileSync } from 'node:fs'

const envFile = (() => { try { return readFileSync(new URL('../.env.local', import.meta.url), 'utf8') } catch { return '' } })()
for (const line of envFile.split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
  if (m !== null && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const base = (process.env.PAPER_PROBE_BASE_URL ?? '').replace(/\/$/, '')
const key = process.env.PAPER_PROBE_API_KEY ?? ''
const model = process.env.PAPER_PROBE_MODEL ?? 'deepseek-v4-pro'
const mode = process.argv[2] ?? 'diag'
if (base === '' || key === '') { console.error('缺少 PAPER_PROBE_BASE_URL / PAPER_PROBE_API_KEY'); process.exit(1) }

/** 发一次流式请求，统计：首事件类型/延迟、reasoning_content 是否出现、content 头部、usage。 */
async function probe(label, body) {
  const t0 = Date.now()
  let firstEventAt = null
  let firstContentAt = null
  let reasoningChars = 0
  let contentChars = 0
  let reasoningEvents = 0
  let head = ''
  let tail = ''
  let finish = null
  let usage = null
  let sawReasoningKey = false
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  console.log(`\n[${label}] http ${res.status} ${res.headers.get('content-type') ?? ''}`)
  if (!res.ok) { console.log('  body:', (await res.text()).slice(0, 300)); return }
  const text = await res.text()
  // 非流式响应（content-type 是 json）——直接解析
  if (!text.startsWith('data:') && (res.headers.get('content-type') ?? '').includes('json')) {
    const data = JSON.parse(text)
    const msg = data.choices?.[0]?.message ?? {}
    console.log('  [非流式响应]')
    console.log('  reasoning_content 长度:', (msg.reasoning_content ?? '').length)
    console.log('  content 长度:', (msg.content ?? '').length, '| 头部:', (msg.content ?? '').slice(0, 120).replace(/\n/g, '\\n'))
    console.log('  finish:', data.choices?.[0]?.finish_reason, '| usage:', JSON.stringify(data.usage ?? {}))
    return
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || !line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') continue
    let d
    try { d = JSON.parse(payload) } catch { continue }
    if (firstEventAt === null) firstEventAt = Date.now() - t0
    const choice = d.choices?.[0] ?? {}
    const delta = choice.delta ?? {}
    if ('reasoning_content' in delta) sawReasoningKey = true
    const r = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : ''
    if (r.length > 0) { reasoningChars += r.length; reasoningEvents += 1 }
    const c = typeof delta.content === 'string' ? delta.content : ''
    if (c.length > 0) {
      if (firstContentAt === null) firstContentAt = Date.now() - t0
      contentChars += c.length
      if (head.length < 160) head += c
      tail = (tail + c).slice(-600)
    }
    if (choice.finish_reason != null) finish = choice.finish_reason
    if (d.usage !== undefined) usage = d.usage
  }
  console.log('  首事件延迟:', firstEventAt, 'ms | 首个 content:', firstContentAt, 'ms')
  console.log('  delta 里出现 reasoning_content 键:', sawReasoningKey, '| 推理事件数:', reasoningEvents)
  console.log('  reasoning_content 字符数:', reasoningChars, '| content 字符数:', contentChars)
  console.log('  content 头部:', JSON.stringify(head.slice(0, 150)))
  console.log('  content 尾部:', JSON.stringify(tail.slice(-150)))
  console.log('  finish:', finish, '| usage:', usage === null ? '(无)' : JSON.stringify({
    prompt: usage.prompt_tokens, completion: usage.completion_tokens,
    reasoning: usage.completion_tokens_details?.reasoning_tokens ?? '(未报)',
  }))
}

const baseBody = {
  model,
  messages: [{ role: 'user', content: '只输出一行 Python：print(1)' }],
  max_tokens: 200,
  stream: true,
  stream_options: { include_usage: true },
}

if (mode === 'diag' || mode === 'compare') {
  // ① 原样（我们管线当前的形态：只带 reasoning_effort）
  await probe('A: reasoning_effort=none（现状）', {
    ...baseBody,
    reasoning_effort: 'none',
    ...(process.env.PAPER_PROBE_MAX_OUTPUT_TOKENS ? { max_tokens: Number(process.env.PAPER_PROBE_MAX_OUTPUT_TOKENS) } : {}),
  })
}
if (mode === 'compare') {
  // ② 专家建议：两个开关都传
  await probe('B: thinking.disabled + reasoning_effort=none', {
    ...baseBody,
    thinking: { type: 'disabled' },
    reasoning_effort: 'none',
  })
  // ③ 默认（什么都不传，看默认开不开思考）
  await probe('C: 不传任何开关', { ...baseBody })
  // ④ 大 max_tokens 验证（专家：65536 恰是思考模式默认值，无法区分）
  await probe('D: max_tokens=150000 + 关思考', {
    ...baseBody,
    max_tokens: 150000,
    thinking: { type: 'disabled' },
    reasoning_effort: 'none',
    messages: [{ role: 'user', content: '从 1 数到 200，每行一个数。' }],
  })
}
console.log('\n诊断完成。判定：若 A 先吐 reasoning_content 或英文分析再给 print(1)，而 B 直接给 print(1) —— 思考开关没透传/没生效；若 A/B 都直接给 print(1)，则中转正常，问题在长任务 prompt 诱发模型写正文推理。')
