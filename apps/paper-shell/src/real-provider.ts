/**
 * TASK-M1 M1-2 — real provider adapter for the paper shell.
 *
 * Transport-only: routes an OpenAI-compatible chat-completions endpoint
 * through the same provider seam the demos' fakes occupy. No engine
 * semantics live here (禁 M1-1); this file only turns HTTP+SSE into the
 * StreamChunk shape the executor's BlockAssembler consumes.
 *
 * TASK-T1 Sprint 2 (new-key discipline): the shared relay key has a hard
 * concurrency ceiling, so the adapter owns a process-wide gate — a global
 * semaphore (default limit 1, i.e. strictly serial) plus a 429/5xx
 * exponential backoff. Strict concurrency is enforced by the client, not
 * left to luck; the limit is configurable via PAPER_PROBE_MAX_CONCURRENCY
 * for probe batches that have verified headroom.
 *
 * @module apps/paper-shell/src/real-provider
 */

import type { StreamChunk } from '@deepseek-ai/dsh-llm'

/** One SSE `data:` JSON payload from an OpenAI-compatible endpoint. */
interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string; reasoning_content?: string }
    finish_reason?: string | null
  }>
  /** Final chunk's usage block when stream_options.include_usage is set. */
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

/** Split an SSE byte stream into `data:` lines (OpenAI wire format). */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary: number
    while ((boundary = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, boundary).replace(/\r$/, '')
      buffer = buffer.slice(boundary + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  // W8.9-A3 (found by this batch's own test): the pre-W8.9 tail check read
  // ONLY `decoder.decode()` — the decoder's byte remainder — and never the
  // string remainder still sitting in `buffer`. A stream that closes without
  // a trailing newline therefore DROPPED its last `data:` line. When that
  // line is the finish chunk, the dropped reason is exactly what turns a
  // normal stop into `FINISH_REASON_UNKNOWN` — the misclassification this
  // batch exists to remove. The tail is the decoder remainder PLUS the
  // un-terminated buffer.
  const tail = buffer + decoder.decode()
  const lastLine = tail.replace(/\r$/, '')
  if (lastLine.startsWith('data:')) yield lastLine.slice(5).trim()
}

/**
 * W8.9-A3 — the wire outcome of one stream, as a pure value.
 *
 * Extracted from the streaming loop so the classification is testable with
 * constructed inputs (the failure-class boundary is exactly where the W8.8
 * misattribution lived). The precedence is fixed and total:
 *   in-band error > length > EMPTY_STREAM > unknown > stop.
 */
export type StreamOutcome =
  | { readonly kind: 'error'; readonly message: string; readonly code: string }
  | { readonly kind: 'max-tokens' }
  | { readonly kind: 'stop' }

/**
 * Classify a completed stream.
 *
 * `EMPTY_STREAM` is the case W8.9-A3 exists for: HTTP 200, zero content
 * deltas, no finish chunk, no in-band error. Before this it fell into
 * `FINISH_REASON_UNKNOWN`, which made "the upstream sent nothing" and
 * "the protocol has a bug" indistinguishable (W8.8 runs #3/#4).
 *
 * @param state - what the loop observed.
 */
export function classifyStream(state: {
  readonly inBandError: { message: string; code?: number } | null
  readonly finishReason: string | null
  readonly contentChunks: number
  readonly sawAnyChoice: boolean
}): StreamOutcome {
  const { inBandError, finishReason, contentChunks, sawAnyChoice } = state
  if (inBandError !== null) {
    return {
      kind: 'error',
      message: `provider stream error: ${inBandError.message}`,
      code: inBandError.code === undefined ? 'PROVIDER_STREAM_ERROR' : `PROVIDER_${inBandError.code}`,
    }
  }
  if (finishReason === 'length') return { kind: 'max-tokens' }
  if (contentChunks === 0 && finishReason === null) {
    return {
      kind: 'error',
      message: `provider returned HTTP 200 with an empty stream: no content chunk and no finish_reason${sawAnyChoice ? ' (choices present, all deltas empty)' : ' (no choices at all)'}`,
      code: 'EMPTY_STREAM',
    }
  }
  if (finishReason === null) {
    return {
      kind: 'error',
      message: 'finish_reason missing from provider stream (stream ended without a terminal chunk)',
      code: 'FINISH_REASON_UNKNOWN',
    }
  }
  return { kind: 'stop' }
}

// ---------------------------------------------------------------------------
// Concurrency gate — process-wide, default strictly serial.
// ---------------------------------------------------------------------------

const MAX_CONCURRENCY = (() => {
  const raw = Number.parseInt(process.env.PAPER_PROBE_MAX_CONCURRENCY ?? '1', 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 1
})()

let inFlight = 0
const waiters: Array<() => void> = []

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight += 1
    return
  }
  await new Promise<void>(resolve => waiters.push(resolve))
  inFlight += 1
}

function release(): void {
  inFlight -= 1
  const next = waiters.shift()
  if (next !== undefined) next()
}

/** Retryable transport statuses: 429 plus the transient 5xx band. */
function retryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

const MAX_ATTEMPTS = 4
const BASE_BACKOFF_MS = 1_500

/** W8.6-B1: explicit output budget, configurable — NOT hardcoded. The
 *  32k ceiling that truncated the W8.5 run was a RELAY DEFAULT; asking
 *  for an explicit max_tokens is the only way to find out whether the
 *  limit is negotiable (W8.6-B2 probes it; Q1/Q2 cover "relay ignores
 *  it" / "32k is the model's max"). null = leave the field out entirely
 *  (pre-W8.6 wire shape, kept for probes comparing behavior). */
function outputBudget(): number | null {
  const raw = process.env.PAPER_PROBE_MAX_OUTPUT_TOKENS
  if (raw === undefined || raw === '') return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * W8.9-D1 (measured, not guessed) — the reasoning-channel control.
 *
 * 实测（artifacts/handoff/W8.9/probe-reasoning-budget.mts +
 * probe-e2-budget.mts，真实中转、真实模型）：
 *   - 短 prompt：reasoning 只占 50-67 字符，任何参数形态都产出 content。
 *   - E2 的 5574 字符 prompt：**不限 reasoning 时 16000 tokens 全部耗在
 *     reasoning 上，content 返回空串**（P1 探针的 reasoning:content ≈ 14.6:1
 *     在这里表现为零内容）。
 *   - 加 `reasoning_effort: "none"` 后，同一 prompt 在 8000 tokens 就产出
 *     了合法容器的开头。
 * 故生产适配器默认抑制 reasoning；`PAPER_PROBE_REASONING=default` 可还原
 * 未抑制的形态（供探针做 A/B）。
 */
function reasoningEffort(): string | null {
  const raw = process.env.PAPER_PROBE_REASONING
  if (raw === 'default' || raw === 'off') return null
  return raw ?? 'none'
}

/** One real streaming call → StreamChunks (non-streaming fallback). */
export async function* streamCompletion(
  route: { baseURL: string; apiKey: string; model: string },
  request: { system?: string; messages: Array<{ content: string }> },
): AsyncGenerator<StreamChunk> {
  const url = `${route.baseURL.replace(/\/$/, '')}/chat/completions`
  const budget = outputBudget()
  const payload = JSON.stringify({
    model: route.model,
    messages: [
      ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
      ...request.messages.map(m => ({ role: 'user', content: m.content })),
    ],
    temperature: 0.2,
    stream: true,
    // W8.6-B1: explicit budget when configured (PAPER_PROBE_MAX_OUTPUT_TOKENS).
    ...(budget === null ? {} : { max_tokens: budget }),
    // W8.9-D1: keep the reasoning channel from eating the whole budget
    // (measured — see reasoningEffort()). Without this the E2 call returns
    // an EMPTY content string with the entire budget spent on reasoning.
    ...(reasoningEffort() === null ? {} : { reasoning_effort: reasoningEffort() as string }),
    // TASK-Q2 (usage telemetry): ask the endpoint for the final usage
    // block so every call's token accounting is real, not estimated. An
    // endpoint that ignores the option simply omits usage — the executor
    // already treats missing usage as "not reported", never as zero-with-
    // confidence.
    stream_options: { include_usage: true },
  })

  // The concurrency slot spans all attempts of one call: a retry must not
  // open a second in-flight request while the first is being backed off.
  await acquire()
  let response: Response | undefined
  try {
    for (let attempt = 1; ; attempt += 1) {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${route.apiKey}`,
        },
        body: payload,
      })
      if (response.ok) break
      const detail = await response.text().catch(() => '')
      const err = new Error(`provider http ${response.status} ${detail.slice(0, 200)}`) as Error & { status?: number }
      err.status = response.status
      if (!retryableStatus(response.status) || attempt >= MAX_ATTEMPTS) throw err
      await new Promise(resolve => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)))
    }
  } catch (error) {
    release()
    throw error
  }

  if (response === undefined || response.body === null) {
    release()
    throw new Error('provider returned an empty body')
  }
  const body = response.body
  const finish = async () => {
    try { await body.cancel() } catch { /* already closed */ }
    release()
  }
  let text = ''
  let usage: ChatCompletionChunk['usage']
  // W8.8 temporary diagnostic (PAPER_PROBE_RAW_DEBUG=1): dump the raw SSE
  // bytes of every call so a stream that ends without a finish chunk can
  // be examined directly.
  const rawDebug = process.env.PAPER_PROBE_RAW_DEBUG === '1'
  let rawAccum = ''
  // W8.6-A2: the wire `finish_reason` is the ONLY trustworthy signal that
  // an output hit the provider's length ceiling. Discarding it (pre-W8.6)
  // made truncation indistinguishable from a model contract violation —
  // the "假红" misattribution. null means "the field never arrived" —
  // W8.8: an in-band `{"error":...}` line (OpenRouter sends one and then
  // closes on upstream rate limits) is captured so the failure names the
  // real cause instead of a generic unknown.
  let finishReason: string | null = null
  let inBandError: { message: string; code?: number } | null = null
  // W8.9-A3: how many `data:` lines carried actual content. An HTTP 200
  // stream that closes without a single content delta and without a finish
  // chunk is its OWN failure class (EMPTY_STREAM), not "unknown": the W8.8
  // runs #3/#4 hit HTTP 200 + empty SSE twice and each time it surfaced as
  // FINISH_REASON_UNKNOWN, indistinguishable from a genuine protocol bug.
  let contentChunks = 0
  let sawAnyChoice = false
  try {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for await (const line of sseLines(body)) {
      if (line === '' || line === '[DONE]') continue
      let parsed: ChatCompletionChunk
      try {
        parsed = JSON.parse(line) as ChatCompletionChunk
      } catch {
        continue
      }
      // W8.8: in-band error object — record it; the stream may then close
      // without any finish chunk (V1: three EXECUTE attempts surfaced as a
      // generic FINISH_REASON_UNKNOWN while the real cause "temporarily
      // rate-limited upstream" was silently dropped).
      if (rawDebug) rawAccum += `${line.slice(0, 4000)}\n---\n`
      const errObj = (parsed as { error?: { message?: string; code?: number } }).error
      if (errObj !== undefined) {
        inBandError = { message: String(errObj.message ?? 'provider error'), ...(typeof errObj.code === 'number' ? { code: errObj.code } : {}) }
        continue
      }
      // The usage block arrives on a choices-empty final chunk (OpenAI
      // wire shape when include_usage is on) — AFTER the finish_reason
      // chunk. Breaking at finish_reason would miss it, so keep scanning
      // until the stream ends or [DONE]; deltas after finish do not exist.
      if (parsed.usage !== undefined) usage = parsed.usage
      if (parsed.choices !== undefined && parsed.choices.length > 0) sawAnyChoice = true
      const reason = parsed.choices?.[0]?.finish_reason
      if (typeof reason === 'string') finishReason = reason
      const delta = parsed.choices?.[0]?.delta?.content
      if (delta !== undefined && delta.length > 0) {
        text += delta
        contentChunks += 1
        yield { type: 'text-delta', index: 0, text: delta }
      }
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    // Real token accounting, exactly the disjoint TokenUsage shape the
    // runtime expects: inputTokens = uncached input only; cache hits
    // reported separately (TASK-Q2 telemetry).
    if (usage !== undefined) {
      const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
      const promptTotal = usage.prompt_tokens ?? 0
      yield {
        type: 'usage',
        usage: {
          inputTokens: Math.max(promptTotal - cached, 0),
          outputTokens: usage.completion_tokens ?? 0,
          ...(cached > 0 ? { cacheReadTokens: cached } : {}),
          ...(usage.completion_tokens_details?.reasoning_tokens !== undefined
            ? { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }
            : {}),
        },
      }
    }
    if (rawDebug) {
      try {
        const { appendFileSync } = await import('node:fs')
        appendFileSync('/tmp/paper-raw-sse-debug.txt', `
=== call ===
finishReason=${String(finishReason)} inBandError=${JSON.stringify(inBandError)}
${rawAccum}`)
      } catch { /* diagnostics must never break the call */ }
    }
    // W8.6-A2 / W8.8 / W8.9-A3: translate the wire outcome into the harness
    // vocabulary via `classifyStream` (single source; the boundary cases are
    // unit-tested with constructed inputs there).
    const outcome = classifyStream({ inBandError, finishReason, contentChunks, sawAnyChoice })
    if (outcome.kind === 'error') {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: outcome.message, code: outcome.code } } }
    } else if (outcome.kind === 'max-tokens') {
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    } else {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  } finally {
    await finish()
  }
}
