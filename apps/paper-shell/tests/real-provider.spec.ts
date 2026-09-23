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
import { classifyStream, sseLines, toWireTools } from '../src/real-provider.ts'

describe('real-provider — W8.9-A3 empty stream is its own class', () => {
  it('HTTP 200 with no data lines at all -> EMPTY_STREAM (not UNKNOWN)', () => {
    const out = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: false, sawToolCalls: false })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') {
      expect(out.code).toBe('EMPTY_STREAM')
      expect(out.message).toContain('no choices at all')
    }
  })

  it('choices present but every delta empty -> EMPTY_STREAM (names the shape)', () => {
    const out = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: true, sawToolCalls: false })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') {
      expect(out.code).toBe('EMPTY_STREAM')
      expect(out.message).toContain('choices present, all deltas empty')
    }
  })

  it('the two EMPTY_STREAM shapes are distinguishable in the message', () => {
    const a = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: false, sawToolCalls: false })
    const b = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: true, sawToolCalls: false })
    expect(a.kind === 'error' && a.message).not.toBe(b.kind === 'error' && b.message)
  })

  it('content but no finish chunk stays FINISH_REASON_UNKNOWN (a real protocol gap)', () => {
    // The W8.9 change must NOT swallow this case: text arrived, the stream
    // still ended without a terminal chunk — that is a genuine unknown.
    const out = classifyStream({ inBandError: null, finishReason: null, contentChunks: 7, sawAnyChoice: true, sawToolCalls: false })
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
    const out = classifyStream({ inBandError: null, finishReason: 'length', contentChunks: 3, sawAnyChoice: true, sawToolCalls: false })
    expect(out.kind).toBe('max-tokens')
  })

  it('a normal stop is stop', () => {
    const out = classifyStream({ inBandError: null, finishReason: 'stop', contentChunks: 12, sawAnyChoice: true, sawToolCalls: false })
    expect(out.kind).toBe('stop')
  })

  it('the real run#4 shape still classifies as stop (regression guard)', () => {
    // run#4: 603 tokens of prose, finish_reason=stop, no in-band error.
    const out = classifyStream({ inBandError: null, finishReason: 'stop', contentChunks: 9, sawAnyChoice: true, sawToolCalls: false })
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

describe('real-provider — W12-A1 tools 的 wire 形状', () => {
  // 形状错配是**静默**失效：请求仍然 200，但 `tools` 被对端忽略，于是模型
  // 永远不会调用自检工具，而整条链看起来一切正常（审计里连 `E2SelfCheck`
  // 都不会出现——因为压根没调用）。所以这条钉的是**转换本身**，而不是
  // "传了 tools 这个字段"。
  it('harness 的扁平形状被转成 OpenAI 的 {type, function}', () => {
    const wire = toWireTools([{
      name: 'check_container',
      description: 'validate a candidate container',
      parameters: { type: 'object', properties: { container_json: { type: 'string' } }, required: ['container_json'] },
    }])
    expect(wire).toEqual([{
      type: 'function',
      function: {
        name: 'check_container',
        description: 'validate a candidate container',
        parameters: { type: 'object', properties: { container_json: { type: 'string' } }, required: ['container_json'] },
      },
    }])
  })

  it('不会把 harness 的 name/description 平铺在顶层（那正是会静默失效的写法）', () => {
    const wire = toWireTools([{ name: 'n', description: 'd', parameters: {} }])
    expect(wire[0]).not.toHaveProperty('name')
    expect(wire[0]).not.toHaveProperty('parameters')
    expect(wire[0]?.['function']).toHaveProperty('name', 'n')
  })
})

describe('real-provider — W12-A1b 工具通道带出来的两个协议边界', () => {
  // 这两个都**只在工具通道打开后**才会遇到，而症状都不指向工具：
  // 一个是 `Cannot read properties of null (reading 'length')`，一个是
  // `EMPTY_STREAM`。两条都来自 strict-8 真实运行。

  it('工具调用分片里的 `content: null` 不是错误（真实运行 attempt 3 的死因）', () => {
    // OpenAI 兼容端点在工具调用分片上把 `content` 显式写成 `null`。判据写成
    // `!== undefined` 时 `null` 会通过，随后 `delta.length` 抛异常、整次调用
    // 作废。这里钉的是判据本身：只有 `string` 才算正文。
    const isTextDelta = (delta: unknown): boolean => typeof delta === 'string' && delta.length > 0
    expect(isTextDelta(null)).toBe(false)
    expect(isTextDelta(undefined)).toBe(false)
    expect(isTextDelta('')).toBe(false)
    expect(isTextDelta('hi')).toBe(true)
  })

  it('零正文 + 见到工具调用 = stop，不是 EMPTY_STREAM', () => {
    // 工具调用回合本来就没有正文。若端点**没有**发 finish_reason（协议允许），
    // 只看 `contentChunks === 0` 会把一次成功的工具调用判成空流。
    const toolRound = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: true, sawToolCalls: true })
    expect(toolRound.kind).toBe('stop')
  })

  it('反向守卫：没有工具调用时，零正文 + 无 finish 仍然是 EMPTY_STREAM', () => {
    // 收窄不能把原来的判据放走——那才是这条分类存在的理由。
    const empty = classifyStream({ inBandError: null, finishReason: null, contentChunks: 0, sawAnyChoice: true, sawToolCalls: false })
    expect(empty.kind).toBe('error')
    if (empty.kind === 'error') expect(empty.code).toBe('EMPTY_STREAM')
  })
})
