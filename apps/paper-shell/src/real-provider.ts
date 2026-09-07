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
  const tail = decoder.decode()
  if (tail.length > 0 && tail.startsWith('data:')) yield tail.slice(5).trim()
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

/** One real streaming call → StreamChunks (non-streaming fallback). */
export async function* streamCompletion(
  route: { baseURL: string; apiKey: string; model: string },
  request: { system?: string; messages: Array<{ content: string }> },
): AsyncGenerator<StreamChunk> {
  const url = `${route.baseURL.replace(/\/$/, '')}/chat/completions`
  const payload = JSON.stringify({
    model: route.model,
    messages: [
      ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
      ...request.messages.map(m => ({ role: 'user', content: m.content })),
    ],
    temperature: 0.2,
    stream: true,
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
      const delta = parsed.choices?.[0]?.delta?.content
      if (delta !== undefined && delta.length > 0) {
        text += delta
        yield { type: 'text-delta', index: 0, text: delta }
      }
      if (parsed.choices?.[0]?.finish_reason != null) break
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } finally {
    await finish()
  }
}
