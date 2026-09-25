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

import { CallId, type StreamChunk, type ToolSchema } from '@deepseek-ai/dsh-llm'

/** One SSE `data:` JSON payload from an OpenAI-compatible endpoint. */
interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      /** OpenAI wire shape for streamed tool calls: the name arrives on the
       *  first fragment, the arguments accumulate across fragments. */
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
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
  /**
   * 这一次流里出现过工具调用分片。
   *
   * 工具调用回合**本来就没有正文**，所以"零文本块"在那里是正常形态，不是空流。
   * 有些 OpenAI 兼容端点在工具调用回合**不发 `finish_reason`**（协议上允许它
   * 只出现在 `[DONE]` 之前的那一片里），此时若只看 `contentChunks === 0`，一次
   * 成功的工具调用会被判成 `EMPTY_STREAM` 而失败。
   */
  readonly sawToolCalls: boolean
}): StreamOutcome {
  const { inBandError, finishReason, contentChunks, sawAnyChoice, sawToolCalls } = state
  if (inBandError !== null) {
    return {
      kind: 'error',
      message: `provider stream error: ${inBandError.message}`,
      code: inBandError.code === undefined ? 'PROVIDER_STREAM_ERROR' : `PROVIDER_${inBandError.code}`,
    }
  }
  if (finishReason === 'length') return { kind: 'max-tokens' }
  if (contentChunks === 0 && finishReason === null) {
    // 工具调用回合没有正文是**正常**的：只要见到过调用分片，就不是空流。
    if (sawToolCalls) return { kind: 'stop' }
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

/**
 * harness 的工具定义 → OpenAI wire 形状。
 *
 * 两个形状不同（`{name, description, parameters}` vs
 * `{type:'function', function:{…}}`），而差异只应存在于这一个边界文件里；
 * 把它摊到调用方会让每个调用点都要知道对端的协议细节。
 */
export function toWireTools(
  tools: ReadonlyArray<ToolSchema>,
): ReadonlyArray<{ readonly type: 'function'; readonly function: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> } }> {
  return tools.map(tool => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/** One real streaming call → StreamChunks (non-streaming fallback). */
export async function* streamCompletion(
  route: { baseURL: string; apiKey: string; model: string },
  request: {
    system?: string
    messages: Array<{ content: string }>
    /**
     * Tool definitions in the **harness** shape (`ToolSchema`: flat
     * `{name, description, parameters}`). Present ⇒ the model MAY call them,
     * and the stream carries `tool-call-delta` fragments for each call.
     * Absent ⇒ byte-identical to the previous behaviour (text only).
     *
     * 这一层是 OpenAI 兼容边界，所以**转换发生在这里**（下面 `toWireTools`）：
     * 调用方按 harness 的形状给，wire 形状只在这一个文件里出现。
     */
    tools?: ReadonlyArray<ToolSchema>
  },
): AsyncGenerator<StreamChunk> {
  //
  // **产出约束 = 无令牌看门狗（idle watchdog），不是墙钟。**
  // 2024B-stages-1 真实运行实测：阶段 1 要产出约 280KB 的高质量分析，跑了约 7 分钟
  // 才完成——而此前的墙钟（5 分钟）把它拦腰截断。高质量建模的产出时长**本来就
  // 不可预测**，任何墙钟都会撞上"慢但健康"的生成。
  //
  // 合理的判据是**令牌是否还在流动**：健康的生成会持续吐字节；对端挂住/中转断流
  // 则一个字节都不来。所以每个收到的 chunk 都重置一次看门狗，超过
  // `PAPER_IDLE_TIMEOUT_MS`（默认 180s）没有任何新字节才判失败——这保住了
  // 原来墙钟要防的那个真故障（挂住的对端让整轮运行永久停摆、审计一动不动），
  // 又不再误杀长产出。**0 = 关闭看门狗**（不推荐：那是回到"永久卡死"的路径）。
  const idleConfigured = Number(process.env.PAPER_IDLE_TIMEOUT_MS ?? '')
  const idleTimeoutMs = Number.isFinite(idleConfigured) && idleConfigured >= 0 ? idleConfigured : 180_000
  const idle = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined = idleTimeoutMs > 0
    ? setTimeout(() => idle.abort(new Error(`idle watchdog：${String(idleTimeoutMs)}ms 没有任何新令牌 —— 对端大概率已挂住`)), idleTimeoutMs)
    : undefined
  const bumpIdle = (): void => {
    if (idleTimeoutMs <= 0) return
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => idle.abort(new Error(`idle watchdog：${String(idleTimeoutMs)}ms 没有任何新令牌 —— 对端大概率已挂住`)), idleTimeoutMs)
  }
  // 生成结束（无论成败）都要清掉看门狗，否则定时器会挂着进程不放。
  const stopIdle = (): void => { clearTimeout(idleTimer) }
  const url = `${route.baseURL.replace(/\/$/, '')}/chat/completions`
  const budget = outputBudget()
  // **非流式模式**：harness 的缝是 AsyncIterable，所以完整回答会在下面被展开成
  // 同一形状的 chunk 序列——下游（阶段链/交付链）完全无感。
  // 注意：非流式下没有"字节在流动"可观察，看门狗不适用；唯一的界是总时长
  // （PAPER_NON_STREAM_TIMEOUT_MS，默认 15 分钟——这是该模式**不得不**用的墙钟，
  // 与流式路径的无令牌判据是两回事）。工具调用回合不支持非流式：带了 tools
  // 就回落到流式（工具往返需要增量拼装）。
  const nonStream = process.env.PAPER_NON_STREAM === '1' && (request.tools ?? []).length === 0
  const nonStreamTimeoutMs = (() => {
    const raw = Number(process.env.PAPER_NON_STREAM_TIMEOUT_MS ?? '')
    return Number.isFinite(raw) && raw > 0 ? raw : 900_000
  })()
  const payload = JSON.stringify({
    model: route.model,
    messages: [
      ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
      ...request.messages.map(m => ({ role: 'user', content: m.content })),
    ],
    temperature: 0.2,
    // 非流式模式（PAPER_NON_STREAM=1）：一次拿完整 JSON。中转对流式与非流式的
    // 输出天花板可能不同（2024B 阶段 3 的 max-tokens 截断只在流式下反复出现），
    // 且 SSE 断流（terminated）这类传输失败在非流式下天然不存在。
    stream: !nonStream,
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
    ...(nonStream ? {} : { stream_options: { include_usage: true } }),
    // Tools ride along only when the caller supplied them — an absent field
    // keeps every existing request byte-identical.
    ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: toWireTools(request.tools) }),
  })

  // The concurrency slot spans all attempts of one call: a retry must not
  // open a second in-flight request while the first is being backed off.
  await acquire()
  // ── 非流式分支：一次拿完整 JSON，展开成同一形状的 chunk 序列后直接返回。──
  if (nonStream) {
    try {
      for (let attempt = 1; ; attempt += 1) {
        let response: Response | undefined
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${route.apiKey}`,
            },
            body: payload,
            // 非流式没有"字节在流动"可观察，唯一能设的界是总时长
            //（生成期间没有任何中间信号可喂看门狗）。
            signal: AbortSignal.timeout(nonStreamTimeoutMs),
          })
        } catch (error) {
          const message = String(error instanceof Error ? error.message : error)
          if (attempt < MAX_ATTEMPTS && /timeout|terminated|ECONNRESET|fetch failed/i.test(message)) {
            await new Promise(resolve => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)))
            continue
          }
          throw error
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          const err = new Error(`provider http ${response.status} ${detail.slice(0, 200)}`) as Error & { status?: number }
          err.status = response.status
          if (!retryableStatus(response.status) || attempt >= MAX_ATTEMPTS) throw err
          await new Promise(resolve => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)))
          continue
        }
        const data = JSON.parse(await response.text()) as {
          choices?: ReadonlyArray<{ message?: { content?: string }; finish_reason?: string | null }>
          usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } }
          error?: { message?: string }
        }
        const content = data.choices?.[0]?.message?.content ?? ''
        const wireFinish = data.choices?.[0]?.finish_reason ?? null
        release()
        stopIdle()
        yield { type: 'block-start', index: 0, blockType: 'text' }
        if (content !== '') yield { type: 'text-delta', index: 0, text: content }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: content } }
        if (data.error !== undefined) {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: String(data.error.message ?? 'provider error'), code: 'in_band' } } }
        } else if (wireFinish === 'length') {
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        } else {
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
        const usage = data.usage
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
        return
      }
    } catch (error) {
      release()
      stopIdle()
      throw error
    }
  }
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
        // **同一个看门狗信号管全程**（连接 + 流式 body）。绝不能用
        // AbortSignal.timeout(连接上限)：那个信号会一直挂在响应上，把 body 的
        // 流式读取也一起掐断——2024B 阶段 3 实测就是这样在 10s 处被杀的。
        signal: idle.signal,
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
    stopIdle()
    throw error
  }

  if (response === undefined || response.body === null) {
    release()
    stopIdle()
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
  let toolCallsSeen = 0
  let sawAnyChoice = false
  try {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for await (const line of sseLines(body)) {
      bumpIdle() // 有字节来 = 对端活着；看门狗只在**持续无字节**时触发
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
      // 判据必须是 `typeof === 'string'`，不能是 `!== undefined`：OpenAI 兼容
      // 端点在**工具调用分片**上会把 `content` 显式写成 `null`，而
      // `null !== undefined` 为真，于是 `delta.length` 抛
      // `Cannot read properties of null (reading 'length')`——整次调用失败。
      //
      // 落盘证据（strict-8 真实运行，attempt 3）：`provider_retry UNKNOWN:
      // Cannot read properties of null (reading 'length')`。这是**工具通道**带出来的
      // 新形态：没有工具时端点从不发 `content: null`。
      const delta = parsed.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) {
        text += delta
        contentChunks += 1
        yield { type: 'text-delta', index: 0, text: delta }
      }
      // 工具调用：OpenAI 的分片形态是"名字在首片、参数跨片累积"。原样转发成
      // `tool-call-delta`，由 BlockAssembler 拼装（它早已支持这个类型）。
      // **不改动文本通道**：工具调用的存在不影响 content 的收集与 finish 判定。
      const toolCalls = parsed.choices?.[0]?.delta?.tool_calls
      if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
          if (call === null || typeof call !== 'object') continue
          toolCallsSeen += 1
          yield {
            type: 'tool-call-delta',
            index: 1 + (typeof call.index === 'number' ? call.index : 0),
            id: CallId(String(call.id ?? `call_${String(toolCallsSeen)}`)),
            ...(typeof call.function?.name === 'string' ? { name: call.function.name } : {}),
            argumentsDelta: String(call.function?.arguments ?? ''),
          }
        }
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
    const outcome = classifyStream({ inBandError, finishReason, contentChunks, sawAnyChoice, sawToolCalls: toolCallsSeen > 0 })
    if (outcome.kind === 'error') {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: outcome.message, code: outcome.code } } }
    } else if (outcome.kind === 'max-tokens') {
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
    } else {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  } finally {
    // 无论怎么退出（正常 finish / max-tokens / error / 调用方提前 break），
    // 看门狗定时器都必须清掉——否则它会挂着进程不放，运行"结束"了进程还在。
    stopIdle()
    await finish()
  }
}
