/**
 * 阶段链的**工具回路**（P1）：opt-in、有界、默认关。
 *
 * 这条回路存在的理由：模型在阶段内看不到磁盘，简报只能给摘要；`read_skill_doc`
 * 让它按需取规范原文。但**默认关**——带工具会强制 provider 离开非流式（见
 * `stage-service.ts` 模块头），而流式截断/断流是本项目实测过的塌方源。
 *
 * 这里测三件事（都是"模块做好 ≠ 进了主线"的反面）：
 * 1. 工具调用**真的被执行**，结果真的进了下一次请求（不是"挂上就完"）；
 * 2. 默认（`PAPER_STAGE_TOOLS` 未设）请求里**没有** `tools` 字段；
 * 3. 到顶最多 {@link STAGE_TOOL_MAX_ROUNDS} 轮工具，然后一次**不带工具**的收尾调用
 *    （到顶不判失败——工具是帮忙的，不是新的门）。
 */

import { CallId, createUserMessage, type FinishReason, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  STAGE_TOOL_MAX_ROUNDS, runStageToolLoop, stageToolsFor, stageToolsMounted,
} from '../../src/stages/stage-service.ts'
import { stageOf } from '../../src/stages/registry.ts'
import type { ToolSpec } from '../../src/stages/tools.ts'

/** 测试会改这个环境开关；每条用例结束后还原，避免跨用例泄漏。 */
const ORIGINAL_TOOL_FLAG = process.env['PAPER_STAGE_TOOLS']

afterEach(() => {
  if (ORIGINAL_TOOL_FLAG === undefined) delete process.env['PAPER_STAGE_TOOLS']
  else process.env['PAPER_STAGE_TOOLS'] = ORIGINAL_TOOL_FLAG
})

/** 按轮次脚本化回答的假 provider（记录每次收到的完整请求）。 */
interface ScriptedProvider {
  readonly calls: GenerateOptions[]
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

function scriptedProvider(script: (round: number) => ReadonlyArray<StreamChunk>): ScriptedProvider {
  const calls: GenerateOptions[] = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      const chunks = script(calls.length - 1)
      return (async function* () {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

/** 基准请求：provider/model/system 与第一条 user 消息（阶段简报）——与生产路径同形。 */
function baseRequest(): GenerateOptions {
  return {
    provider: 'fake',
    model: 'fake-model',
    system: '阶段链系统提示词',
    messages: [createUserMessage({ content: [{ type: 'text', text: '阶段简报' }], source: { kind: 'user' } })],
  }
}

/** 一轮纯文本回答。 */
function textRound(text: string, finish: FinishReason = { kind: 'stop' }): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: finish },
  ]
}

/** 一轮"先说话、再调 `read_skill_doc`"的回答。 */
function toolRound(callId: string, args: string, text = ''): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-start', index: 1, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 1, id: CallId(callId), name: 'read_skill_doc', argumentsDelta: args },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** 一条消息的可见文本（含 tool-result 内层文本）——用来断言"工具结果进了下一次请求"。 */
function textOf(message: GenerateOptions['messages'][number]): string {
  return message.content.map(block => block.type === 'text'
    ? block.text
    : block.type === 'tool-result'
      ? block.content.map(inner => inner.type === 'text' ? inner.text : '').join('')
      : '').join('\n')
}

/** 只数执行次数的工具桩（名字与真实工具一致，便于走同一条分派）。 */
function countingTool(): { readonly spec: ToolSpec; readonly executions: () => number } {
  let executions = 0
  return {
    spec: {
      name: 'read_skill_doc',
      description: '测试桩：只数执行次数',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        executions += 1
        return `STUB-${String(executions)}`
      },
    },
    executions: () => executions,
  }
}

describe('阶段工具回路 —— opt-in、有界、默认关', () => {
  it('第一轮取语料、第二轮给最终文本：工具结果真的进了下一次请求', async () => {
    process.env['PAPER_STAGE_TOOLS'] = '1'
    const code = stageOf('code')
    expect(stageToolsMounted(code)).toBe(true)
    const tools = stageToolsFor(code)
    // 真实工具（不是桩）：名字与阶段可见语料都由 `skillDocToolSpec` 决定。
    expect(tools.map(tool => tool.name)).toEqual(['read_skill_doc'])
    const provider = scriptedProvider(round => round === 0
      ? toolRound('call-1', '{"id":"code-checks-index"}', '先查一下自检清单。')
      : textRound('FINAL-ANSWER'))
    const toolCalls: string[] = []

    const result = await runStageToolLoop({
      provider,
      request: baseRequest(),
      tools,
      onToolCall: (info) => { toolCalls.push(`${String(info.round)}:${info.name}`) },
    })

    expect(result.text).toBe('FINAL-ANSWER')
    expect(result.finish.kind).toBe('stop')
    expect(provider.calls).toHaveLength(2)
    // 模型还没说"够了"之前，每一轮都带着工具（它自己决定不再调）。
    expect(provider.calls[0]?.tools?.map(tool => tool.name)).toEqual(['read_skill_doc'])
    expect(provider.calls[1]?.tools?.map(tool => tool.name)).toEqual(['read_skill_doc'])
    // **工具真的执行了**：结果作为 tool-result 消息出现在第二次请求里，且是对应的 call id。
    const toolResult = provider.calls[1]?.messages.find(message => message.content.some(block => block.type === 'tool-result'))
    expect(toolResult === undefined ? '' : textOf(toolResult)).toContain('自检清单总索引')
    const resultBlock = toolResult?.content.find(block => block.type === 'tool-result')
    expect(resultBlock?.type === 'tool-result' ? String(resultBlock.toolCallId) : '').toBe('call-1')
    expect(toolCalls).toEqual(['0:read_skill_doc'])
  })

  it('默认关：`PAPER_STAGE_TOOLS` 未设 → 请求里没有 `tools` 字段，模型调工具也不执行', async () => {
    delete process.env['PAPER_STAGE_TOOLS']
    const code = stageOf('code')
    expect(stageToolsMounted(code)).toBe(false)
    expect(stageToolsFor(code)).toEqual([])
    // 即便 provider 不守规矩、硬吐 tool-call，没挂工具时也只取文本、不执行任何东西。
    const provider = scriptedProvider(() => toolRound('call-1', '{"id":"code-checks-index"}', '普通回答'))

    const result = await runStageToolLoop({ provider, request: baseRequest(), tools: stageToolsFor(code) })

    expect(result.text).toBe('普通回答')
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]?.tools).toBeUndefined()
    expect('tools' in (provider.calls[0] ?? {})).toBe(false)
  })

  it('到顶：最多 3 轮工具，然后一次**不带工具**的收尾调用（不判失败）', async () => {
    process.env['PAPER_STAGE_TOOLS'] = '1'
    const tool = countingTool()
    // 永不收敛的模型：每轮都调工具——必须被额度截住，而不是无限循环。
    const provider = scriptedProvider(round => toolRound(`call-${String(round)}`, '{}', `第 ${String(round + 1)} 轮`))

    const result = await runStageToolLoop({ provider, request: baseRequest(), tools: [tool.spec] })

    expect(tool.executions()).toBe(STAGE_TOOL_MAX_ROUNDS)
    expect(provider.calls).toHaveLength(STAGE_TOOL_MAX_ROUNDS + 1)
    for (const call of provider.calls.slice(0, STAGE_TOOL_MAX_ROUNDS)) expect(call.tools).toBeDefined()
    // 收尾那轮**不带工具**，并明说"现在就给最终答案"。
    const last = provider.calls[STAGE_TOOL_MAX_ROUNDS]
    expect(last?.tools).toBeUndefined()
    expect(last?.messages.some(message => textOf(message).includes('工具轮次已用完'))).toBe(true)
    // 到顶不判失败：收尾轮的文本原样返回（它可能仍是工具调用块——不再执行）。
    expect(result.text).toBe(`第 ${String(STAGE_TOOL_MAX_ROUNDS + 1)} 轮`)
  })

  it('`finish=error` 不执行工具：结束原因原样交回调用方（由 singleCall 按旧话术抛错）', async () => {
    process.env['PAPER_STAGE_TOOLS'] = '1'
    const tool = countingTool()
    const provider = scriptedProvider(() => [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: CallId('call-1'), name: 'read_skill_doc', argumentsDelta: '{}' },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'E_TEST' } } },
    ])

    const result = await runStageToolLoop({ provider, request: baseRequest(), tools: [tool.spec] })

    expect(tool.executions()).toBe(0)
    expect(provider.calls).toHaveLength(1)
    expect(result.finish.kind).toBe('error')
    expect(result.finish.kind === 'error' ? result.finish.failure.message : '').toBe('boom')
  })

  it('确定性阶段不挂工具（`toolsMounted` 只对 model 阶段为真）', () => {
    process.env['PAPER_STAGE_TOOLS'] = '1'
    const figure = stageOf('figure')
    expect(figure.kind).toBe('deterministic')
    expect(stageToolsMounted(figure)).toBe(false)
    expect(stageToolsFor(figure)).toEqual([])
  })
})
