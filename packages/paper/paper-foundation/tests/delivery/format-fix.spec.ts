/**
 * R2③ — 安全格式修复 + N30 不变量测试.
 *
 * 判据（路线书 R2③ / 红线 N30）：修复前后正文（去格式）逐字比对差异为空。
 * 语料 = 预检的完备稿 + 全部负例 + 带代码块的样本——N30 必须在**会触发
 * 修复**的文档上成立，而不是在空白文档上自洽。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/format-fix
 */

import { describe, expect, it } from 'vitest'
import { applySafeFormatFixes, n30Holds, stripFormat } from '../../src/delivery/format-fix.ts'

/** 触发全部四类修复的样本：CRLF、行尾空白、3+ 空行、行内题注、代码块内容。 */
const FIXABLE = [
  '# 问题重述\r\n',
  '本题研究抽样检验。   \r\n',
  '见文献 [1] 与 [2]。图 1：采样方案',
  '',
  '',
  '',
  '```js',
  'const a = 1',
  '',
  '',
  'const b = 2',
  '```',
  '表 1：参数表   ',
  '',
].join('\n')

describe('format-fix — N30 不变量（修复不改语义）', () => {
  it('stripFormat 剥掉语法与空白、保留代码块逐字', () => {
    const md = '## 标题\n\n正文含 $x$ 与 `code`。\n\n```\nconst a = 1\n```\n'
    const stripped = stripFormat(md)
    expect(stripped).not.toContain('#')
    expect(stripped).toContain('标题')
    expect(stripped).toContain('x')
    expect(stripped).toContain('const a = 1') // 代码逐字（含内部空白）
  })

  it('会触发修复的语料：修复前后 stripFormat 逐字节一致（N30）', () => {
    expect(n30Holds(FIXABLE)).toBe(true)
    const before = stripFormat(FIXABLE)
    const after = stripFormat(applySafeFormatFixes(FIXABLE))
    expect(after).toBe(before)
  })

  it('题注独占行：行内「图 N：…」被拆到自己的行且字符零增删', () => {
    const fixed = applySafeFormatFixes('正文内容图 1：采样方案')
    const lines = fixed.split('\n')
    expect(lines.some(l => l.startsWith('图 1：'))).toBe(true)
    expect(n30Holds('正文内容图 1：采样方案')).toBe(true)
  })

  it('代码块内部不被演示层修复触碰（空行/行尾空白保留）', () => {
    const md = '```\nconst a = 1   \n\n\nconst b = 2\n```'
    const fixed = applySafeFormatFixes(md)
    expect(fixed).toContain('const a = 1   ') // 代码内的行尾空白原样
    expect(fixed).toContain('\n\n\n') // 代码块内的连续空行原样（3 个）
  })

  it('三次连续修复是幂等（再修不再变）', () => {
    const once = applySafeFormatFixes(FIXABLE)
    expect(applySafeFormatFixes(once)).toBe(once)
  })
})
