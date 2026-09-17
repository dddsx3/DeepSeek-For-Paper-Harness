/**
 * W8.9-D1 — the offline E2 drive on the REAL run#4 analysis (H7).
 *
 * 这是本轮的关键判据（任务总书 §2.1 H7）：**把 run#4 的真实分析文本经 E2
 * 产出 schema-valid 容器**。它不花 API 也能回答"接收层是否成立"——若 E2
 * 连这份**真实存在的、已经证明模型能产出的**分析都规范化不了，就不必花
 * key 做真实运行。
 *
 * 模式：
 *   --offline  只做结构自检（fixture 完整性 + 锚点解析），零网络
 *   默认       用真实 provider 调一次 E2（需要 .env.local 的 PAPER_PROBE_*）
 *
 * 三条实测结论（本脚本的诊断轮，非猜测）：
 *   ① 非流式 + 大预算 → Cloudflare **524**（源站超时 126 s）。故改用流式，
 *      与生产适配器 real-provider.ts 的传输一致。
 *   ② 不限制 reasoning 通道 → E2 的 5574 字符 prompt 会把 16000 tokens 全部
 *      耗在 reasoning 上并返回 content=""（P1 探针的 14.6:1 在这里表现为
 *      零内容）。`reasoning_effort: none` 是实测有效的抑制手段。
 *   ③ 即使抑制了 reasoning，E2 仍需约 8k+ 输出预算才写完容器。
 *
 * 禁项（W8.9-D1）：**不得为通过测试而修改 fixture 文本**。本脚本只读它。
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  E1_ASSUMPTION_MARKER,
  checkE1E2Fidelity,
  e2NormalizationPrompt,
  fidelityOk,
  parseE1Anchors,
} from '../../../packages/paper/paper-foundation/src/produce/e1-e2.ts'
import { EXECUTE_PROTOCOL_TEACHING } from '../../../packages/paper/paper-foundation/src/executor.ts'
import { parseModelContainer } from '../../../packages/paper/paper-foundation/src/produce/ir-producer.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const FIXTURE = join(repoRoot, 'packages', 'paper', 'paper-foundation', 'tests', 'fixtures', 'e1-run4-analysis.txt')

function loadDotEnvLocal(): void {
  let text = ''
  try {
    text = readFileSync(join(repoRoot, '.env.local'), 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1).trim()
  }
}

/** Accumulate an OpenAI-compatible SSE stream into its text + terminal facts. */
async function readSse(body: ReadableStream<Uint8Array>): Promise<{
  text: string
  finishReason: string | null
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  inBandError: string | null
}> {
  let text = ''
  let finishReason: string | null = null
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined
  let inBandError: string | null = null
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '')
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '' || data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data) as {
          choices?: Array<{ finish_reason?: string | null; delta?: { content?: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
          error?: { message?: string }
        }
        if (chunk.error !== undefined) inBandError = chunk.error.message ?? 'error'
        if (chunk.usage !== undefined) usage = chunk.usage
        const reason = chunk.choices?.[0]?.finish_reason
        if (typeof reason === 'string') finishReason = reason
        const delta = chunk.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) text += delta
      } catch {
        /* a non-JSON keep-alive line is not a protocol error */
      }
    }
  }
  return { text, finishReason, usage, inBandError }
}

async function main(): Promise<number> {
  const offline = process.argv.includes('--offline')
  const analysis = readFileSync(FIXTURE, 'utf8')
  const sha = createHash('sha256').update(analysis, 'utf8').digest('hex')

  console.log('=== W8.9-D1 — run#4 analysis -> E2 ===')
  console.log(`fixture: ${FIXTURE}`)
  console.log(`chars: ${analysis.length}`)
  console.log(`sha256: ${sha}`)
  console.log(`finish marker present: ${analysis.includes('验证与交付')}`)
  console.log('')

  const anchors = parseE1Anchors(analysis)
  console.log(`E1 anchors in the raw fixture: assumptions=${anchors.assumptions.length} requirements=${anchors.requirements.length}`)
  if (anchors.assumptions.length === 0) {
    console.log('')
    console.log('NOTE: the raw run#4 text predates the anchor convention (W8.9-B3) —')
    console.log('      it was written before the harness asked for anchors. This drive')
    console.log('      therefore exercises the NORMALIZATION half of H7 (does a real')
    console.log('      analysis become a schema-valid container?); the fidelity rules')
    console.log('      are exercised on anchor-bearing text in tests/executor-e1e2.spec.ts.')
    console.log(`      (marker "${E1_ASSUMPTION_MARKER}" appears ${analysis.split(E1_ASSUMPTION_MARKER).length - 1} times)`)
  }

  if (offline) {
    console.log('')
    console.log('[--offline] structural checks only; no provider call made.')
    return 0
  }

  loadDotEnvLocal()
  const apiKey = process.env.PAPER_PROBE_API_KEY
  const baseURL = process.env.PAPER_PROBE_BASE_URL
  const model = process.env.PAPER_PROBE_MODEL
  if (apiKey === undefined || baseURL === undefined || model === undefined) {
    console.log('')
    console.log('[SKIP] no PAPER_PROBE_* route in the environment — cannot drive a real E2.')
    return 0
  }
  console.log('')
  console.log(`route: model=${model} baseURL=${baseURL.replace(/\/\/.*@/, '//<redacted>@')}`)

  const prompt = e2NormalizationPrompt(analysis, EXECUTE_PROTOCOL_TEACHING)
  console.log(`E2 prompt chars: ${prompt.length}`)

  const started = Date.now()
  const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0,
      max_tokens: Number(process.env.PAPER_D1_MAX_TOKENS ?? '24000'),
      reasoning_effort: process.env.PAPER_D1_REASONING ?? 'none',
    }),
  })
  if (!response.ok || response.body === null) {
    const excerpt = (await response.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ')
    console.log(`[FAIL] provider HTTP ${response.status} after ${Date.now() - started} ms; body: ${excerpt}`)
    return 1
  }
  const { text, finishReason, usage, inBandError } = await readSse(response.body)
  const elapsedMs = Date.now() - started
  if (inBandError !== null) {
    console.log(`[FAIL] in-band provider error: ${inBandError}`)
    return 1
  }
  console.log(`HTTP ${response.status} in ${elapsedMs} ms; finish=${String(finishReason)}; usage in/out = ${usage?.prompt_tokens}/${usage?.completion_tokens}`)
  console.log(`E2 output chars: ${text.length}`)

  const parsed = parseModelContainer(text)
  console.log('')
  if (!parsed.ok) {
    console.log(`[H7 NOT MET] E2 output is not a legal container: ${parsed.reason}`)
    console.log('raw head:', JSON.stringify(text.slice(0, 300)))
    return 1
  }
  const kinds = parsed.container.entries.map(e => e.kind)
  console.log(`[H7] E2 produced a schema-valid container: ${kinds.length} entries (${kinds.join(', ')})`)

  const findings = checkE1E2Fidelity({
    e1Text: analysis,
    entries: parsed.container.entries.map(e => ({ kind: e.kind, value: e.value as Readonly<Record<string, unknown>> })),
    requiredOutputIds: ['R-OUT'],
  })
  for (const f of findings) console.log(`  ${f.ok ? 'PASS' : 'FAIL'}  ${f.rule} | ${f.detail}`)
  console.log('')
  console.log(`H7 schema-valid: MET.  fidelity (informational on this fixture): ${fidelityOk(findings) ? 'all pass' : 'findings above'}`)
  return 0
}

main().then(code => process.exit(code)).catch(error => {
  console.error('driver failed:', error)
  process.exit(1)
})
