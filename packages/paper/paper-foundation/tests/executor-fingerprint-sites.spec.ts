/**
 * 结构性不变量 —— **每一个可能取到 DRIFT 的抛出点都必须带输出指纹**。
 *
 * ## 它守的缺陷是这一类：N 个抛出点里有 1 个忘了做同一件事
 *
 * 事故（2024B × strict × deepseek-v4-pro 的第五次真实运行）：熔断器的键是
 * `class:code:outputFingerprint`，设计意图是"同一个输出被同样地拒两次才算确定性
 * 重复"（W8.6 注释明写 "failure message alone is NOT sufficient"）。当时五条可能
 * 取到 DRIFT 的抛出点里，**生产链那条**（`EXECUTE production chain refused`）漏了
 * 指纹——键退化成与输出无关的 `DRIFT:prose_contract:`，第 2 次尝试必然跳闸，
 * DRIFT 预算（4 次）被砍到 2 次。
 *
 * 落盘证据：两次 E2 输出**并不相同**（17,715 / 17,891 字节，哈希不同），却被判成
 * "确定性重复"，运行因此提前落到兜底路径。同一轮静态检查还抓出**第二处**漏点
 * （T2 引导准入，它的条件赋值同样可能取到 DRIFT）。
 *
 * ## 为什么是静态检查而不是运行时构造
 *
 * 要触发它得让生产链在两次尝试里各拒一次且输出不同，而只要有一处前置门先拒就
 * 走不到那条 throw——第一版运行时测试正是这样空转的（跑通了，但根本没走到）。
 * 这个不变量本身**可静态判定**，所以静态检查它。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/executor-fingerprint-sites
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(here, '..', 'src', 'executor.ts'), 'utf8')
const NL = String.fromCharCode(10)
const LINES = SOURCE.split(NL)

/**
 * 是否是**抛出语句**。
 *
 * 判据必须收窄到语句——第一版用 `line.includes('throw')`，于是我自己注释里的
 * "都必须在 throw 之前设指纹" 被当成了抛出语句，把真正的赋值行切到了块外，
 * 判据又一次被自己的措辞骗了。
 */
const THROW_STATEMENT = /^\s*throw\b/
const CLASS_ASSIGNMENT = '.w4Class ='
const CONSTANT_ESCAPE = "'ESCAPE'"
const FINGERPRINT_CALL = 'outputFingerprint = sha256Hex('

/**
 * 按抛出语句切块，返回每一个"可能取到 DRIFT"的块。
 *
 * 口径刻意**宽**：任何 `.w4Class =` 赋值都可能取到 DRIFT（含条件赋值），
 * 只有常量 `'ESCAPE'` 结尾的是例外（零预算，不参与熔断）。
 * 块内搜索（而不是行窗口）天然覆盖"指纹设在分类之前或之后"两种排布——
 * 容器准入那条设在之前，生产链那条设在之后。
 */
function driftBlocks(): ReadonlyArray<string> {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < LINES.length; i += 1) {
    if (!THROW_STATEMENT.test(LINES[i] ?? '')) continue
    const block = LINES.slice(start, i + 1)
    start = i + 1
    const assignment = block.find(l => l.includes(CLASS_ASSIGNMENT))
    if (assignment === undefined) continue
    if (assignment.trimEnd().endsWith(CONSTANT_ESCAPE)) continue
    out.push(block.join(NL))
  }
  return out
}

describe('熔断器不变量 —— 每个可能取到 DRIFT 的抛出点都带输出指纹', () => {
  it('至少扫到四个这样的抛出点（防止判据失效导致的空断言）', () => {
    // 空集会让下面的断言恒真——先钉住"确实扫到了东西"。
    // 实测五处：分片 / 保真门 / T2 引导准入 / 容器准入 / 生产链。
    expect(driftBlocks().length).toBeGreaterThanOrEqual(4)
  })

  it('每一个都设了 outputFingerprint', () => {
    const offenders = driftBlocks().filter(b => !b.includes('outputFingerprint')).length
    expect(
      offenders,
      `${String(offenders)} 个 DRIFT 抛出点没设输出指纹——熔断键会退化成与输出无关，第 2 次尝试必然跳闸`,
    ).toBe(0)
  })

  it('指纹取自**当次输出**（sha256Hex(…) 调用），不是常量或空串', () => {
    // 参数形态允许不同：分片路径对拼起来的各片取哈希，其余对当次输出取哈希。
    // 判据是"**对内容**取哈希"，不是"参数恰好叫 text"。
    const offenders = driftBlocks().filter(b => !b.includes(FINGERPRINT_CALL)).length
    expect(offenders, `${String(offenders)} 个抛出点的指纹不是对内容取哈希`).toBe(0)
  })
})
