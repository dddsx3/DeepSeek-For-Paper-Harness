/**
 * 结构性不变量 —— **shell 接缝不得静默丢掉工具能力**。
 *
 * ## 它守的缺陷是这一类：能力在中间层被"吞掉"，而整条链看起来正常
 *
 * 事故（本轮接自检工具时发现）：executor 的 `callWithSelfCheck` 会发出
 * `tools: [check_container]`，`real-provider.ts` 也早就会把工具定义转成 wire
 * 形状并发出去。但**中间的接缝**（`cli.ts` 的 `adapterStream`）的签名是
 *
 *     adapter: (r, req: { system?: string; messages: Array<{content: string}> }) => …
 *
 * ——一个**根本装不下 `tools` 的类型**。它把请求重建成 `{system, messages}` 再
 * 转交，工具定义就此消失。同样的原因，`tool-result` 内容块也被拍平成空串。
 *
 * 后果全是**静默**的：请求照样 200，模型只是永远没有工具可调，于是自检工具
 * 存在与不存在完全等价——而审计里连一条 `E2SelfCheck` 都不会有（因为压根没
 * 调用），事后无从分辨"模型不爱用工具"与"工具根本没送到"。
 *
 * ## 为什么是静态检查
 *
 * 要运行时构造它，得让 fake provider 在**经过 shell 接缝**的路径上跑一次真实
 * 运行——那要起一个 OpenAI 兼容端点。而缺陷本身是**类型层**的：接缝的请求类型
 * 装不装得下 `tools`，一眼可判。这与 `executor-fingerprint-sites.spec.ts` 同属
 * 一类：N 个交接点里漏掉 1 个，静态可判，就别用运行时去赌。
 *
 * @module @deepseek-ai/dsh-paper-shell/tests/seam-forwards-tools
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
// 源文件是 CRLF（Windows 检出），而下面按行锚定的正则用 LF 写。先归一化，
// 否则每条正则都会因为行尾多一个 CR 而静默失配——第一版正是这样"找不到函数"的。
const CRLF = new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g')
const lf = (path: string): string => readFileSync(path, 'utf8').replace(CRLF, String.fromCharCode(10))
const CLI = lf(join(here, '..', 'src', 'cli.ts'))
const PROVIDER = lf(join(here, '..', 'src', 'real-provider.ts'))

describe('shell 接缝 —— tools 必须一路到底', () => {
  it('接缝的请求类型装得下 tools（这是唯一会静默失效的地方）', () => {
    // `SeamAdapter` 就是那个曾经装不下的类型。它必须显式声明 `tools`。
    const seam = /type SeamAdapter = \(([\s\S]*?)\n\) => AsyncIterable<unknown>/.exec(CLI)
    expect(seam, 'SeamAdapter must exist in cli.ts').not.toBeNull()
    expect(seam?.[1], 'the seam request type must carry tools').toContain('tools?')
  })

  it('adapterStream 真的把 tools 转交出去（不是只在类型里写着）', () => {
    const body = /async function\* adapterStream\(([\s\S]*?)\n\}\n/.exec(CLI)
    expect(body, 'adapterStream must exist').not.toBeNull()
    expect(body?.[1], 'adapterStream must forward tools to the adapter').toContain('tools: options.tools')
  })

  it('工具结果不会被拍平成空串（丢了它，工具回路就只剩"再问一遍"）', () => {
    // `seamTextOf` 是消息 → wire 文本的唯一转换点。它必须显式处理
    // `tool-result`；否则 `createToolResultMessage` 产出的块会被当作
    // "不认识的类型"丢掉，模型看不到任何判据。
    const fn = /function seamTextOf\(([\s\S]*?)\n\}\n/.exec(CLI)
    expect(fn, 'seamTextOf must exist').not.toBeNull()
    expect(fn?.[1], "seamTextOf must handle the 'tool-result' block").toContain("'tool-result'")
  })

  it('wire 边界把 harness 形状转成 OpenAI 形状（两个形状不同，只应在这里转换）', () => {
    expect(PROVIDER).toContain('function toWireTools(')
    expect(PROVIDER).toContain("type: 'function' as const")
    // 且请求体里发的是转换结果，不是原始定义
    expect(PROVIDER).toContain('tools: toWireTools(request.tools)')
  })

  it('cassette 指纹包含 tools（否则"没工具"的记录会被当作"带工具"的回放来源）', () => {
    const cassette = lf(join(here, '..', 'src', 'cassette.ts'))
    const fp = /export function requestFingerprint\(([\s\S]*?)\n\}\n/.exec(cassette)
    expect(fp, 'requestFingerprint must exist').not.toBeNull()
    expect(fp?.[1], 'the fingerprint must include the tool definitions').toContain('tools: request.tools')
  })
})
