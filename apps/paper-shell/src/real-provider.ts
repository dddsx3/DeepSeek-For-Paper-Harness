/**
 * TASK-M1 M1-2 — real provider adapter for the paper shell.
 *
 * Transport-only: routes an OpenAI-compatible chat-completions endpoint
 * through the same provider seam the demos' fakes occupy. No engine
 * semantics live here (禁 M1-1); this file only turns HTTP+SSE into the
 * StreamChunk shape the executor's BlockAssembler consumes.
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

/** One real streaming call → StreamChunks (non-streaming fallback). */
export async function* streamCompletion(
  route: { baseURL: string; apiKey: string; model: string },
  request: { system?: string; messages: Array<{ content: string }> },
): AsyncGenerator<StreamChunk> {
  const url = `${route.baseURL.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${route.apiKey}`,
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        ...(request.system === undefined ? [] : [{ role: 'system', content: request.system }]),
        ...request.messages.map(m => ({ role: 'user', content: m.content })),
      ],
      temperature: 0.2,
      stream: true,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const err = new Error(`provider http ${response.status} ${detail.slice(0, 200)}`) as Error & { status?: number }
    err.status = response.status
    throw err
  }
  if (response.body === null) throw new Error('provider returned an empty body')
  yield { type: 'block-start', index: 0, blockType: 'text' }
  let text = ''
  for await (const line of sseLines(response.body)) {
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
}
