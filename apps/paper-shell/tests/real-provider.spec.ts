/**
 * W8.9-A3 — empty-stream classification tests.
 *
 * 事故（W8.8 runs #3/#4）：HTTP 200 + 空 SSE（无任何 `data:` 内容行）曾落在
 * `FINISH_REASON_UNKNOWN`，与"协议真有问题"不可区分——即"假红"的相邻形态
 * （把上游的空流归因成 harness/模型的错）。
 *
 * 本组测试用**构造性输入**钉住 `classifyStream` 的边界，每条对应一个
 * 真实观测到的线上形态。
 */

import { describe, expect, it } from 'vitest'
import { classifyStream, sseLines } from '../src/real-provider.ts'

describe('real-provider — W8.9-A3 empty stream is its own class', () => {
  it('HTTP 200 with no data lines at all -> EMPTY_STREAM (not UNKNOWN)', () => {
    const out = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: false })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') {
      expect(out.code).toBe('EMPTY_STREAM')
      expect(out.message).toContain('no choices at all')
    }
  })

  it('choices present but every delta empty -> EMPTY_STREAM (names the shape)', () => {
    const out = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: true })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') {
      expect(out.code).toBe('EMPTY_STREAM')
      expect(out.message).toContain('choices present, all deltas empty')
    }
  })

  it('the two EMPTY_STREAM shapes are distinguishable in the message', () => {
    const a = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: false })
    const b = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: true })
    expect(a.kind === 'error' && a.message).not.toBe(b.kind === 'error' && b.message)
  })

  it('content but no finish chunk stays FINISH_REASON_UNKNOWN (a real protocol gap)', () => {
    // The W8.9 change must NOT swallow this case: text arrived, the stream
    // still ended without a terminal chunk — that is a genuine unknown.
    const out = classifyStream({ inBandError: null, finishReason: null, contentChunks: 7, sawAnyChoice: true })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.code).toBe('FINISH_REASON_UNKNOWN')
  })

  it('in-band error wins over everything (W8.8 rate-limit shape)', () => {
    const out = classifyStream({
      inBandError: { message: 'temporarily rate-limited upstream', code: 429 },
      finishReason: null,
      contentChunks: 0,
      sawAnyChoice: false,
    })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.code).toBe('PROVIDER_429')
  })

  it('length wins over EMPTY_STREAM (truncation is TRANSPORT, 纪律 2)', () => {
    const out = classifyStream({ inBandError: null, finishReason: 'length', contentChunks: 3, sawAnyChoice: true })
    expect(out.kind).toBe('max-tokens')
  })

  it('a normal stop is stop', () => {
    const out = classifyStream({ inBandError: null, finishReason: 'stop', contentChunks: 12, sawAnyChoice: true })
    expect(out.kind).toBe('stop')
  })

  it('the real run#4 shape still classifies as stop (regression guard)', () => {
    // run#4: 603 tokens of prose, finish_reason=stop, no in-band error.
    const out = classifyStream({ inBandError: null, finishReason: 'stop', contentChunks: 9, sawAnyChoice: true })
    expect(out.kind).toBe('stop')
  })
})

describe('real-provider — sseLines framing', () => {
  async function collect(chunks: string[]): Promise<string[]> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    const out: string[] = []
    for await (const line of sseLines(stream)) out.push(line)
    return out
  }

  it('splits data: lines and drops non-data lines', async () => {
    const lines = await collect(['data: {"a":1}\n\n: keep-alive\n\ndata: {"b":2}\n\n'])
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('handles a payload split across byte boundaries', async () => {
    const lines = await collect(['data: {"a"', ':1}\n'])
    expect(lines).toEqual(['{"a":1}'])
  })

  it('handles CRLF line endings', async () => {
    const lines = await collect(['data: {"a":1}\r\n'])
    expect(lines).toEqual(['{"a":1}'])
  })

  it('yields a trailing data: line that arrives without a newline', async () => {
    const lines = await collect(['data: {"tail":true}'])
    expect(lines).toEqual(['{"tail":true}'])
  })

  it('[DONE] passes through as a line for the caller to skip', async () => {
    const lines = await collect(['data: [DONE]\n'])
    expect(lines).toEqual(['[DONE]'])
  })
})
