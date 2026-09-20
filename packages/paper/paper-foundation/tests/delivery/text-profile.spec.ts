/**
 * R2① — text_profile 派生测试。
 *
 * 判据（路线书 R2①）：同要求两次派生结果一致（确定性）；只把"说了的"
 * 写进 profile，没说的保持默认并在 `_matched_items` 记为 matched:false
 * （绝不猜用户没给的要求）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/text-profile
 */

import { describe, expect, it } from 'vitest'
import { deriveTextProfile } from '../../src/delivery/text-profile.ts'

const FORMAT_REQUIREMENTS = [
  '格式要求：A4 纸，页边距上 25mm、下 25mm、左 30mm、右 25mm。',
  '题目三号黑体居中；一级标题四号黑体；正文小四宋体，单倍行距。',
].join('\n')

describe('text-profile — R2① 派生（确定性 + 只填说了的）', () => {
  it('同要求两次派生逐字节一致（判据）', () => {
    expect(deriveTextProfile(FORMAT_REQUIREMENTS)).toEqual(deriveTextProfile(FORMAT_REQUIREMENTS))
  })

  it('把说了的写进 profile（题目三号=16pt 黑体居中 / 正文小四=12pt 宋体 单倍）', () => {
    const p = deriveTextProfile(FORMAT_REQUIREMENTS)
    expect(p.page.size).toBe('A4')
    expect(p.page.margins).toEqual({ top: '25mm', right: '25mm', bottom: '25mm', left: '30mm' })
    expect(p.fonts.cn_heading).toBe('黑体')
    expect(p.fonts.cn_body).toBe('宋体')
    expect(p.headings.find(h => h.level === 1)?.size_pt).toBe(16)
    expect(p.headings.find(h => h.level === 1)?.align).toBe('center')
    expect(p.body.size_pt).toBe(12)
    expect(p.body.line_spacing).toBe(1)
    // 用户只给了 题目/一级标题 的字号——二级起未提及，诚实记 unmatched
    expect(p._matched_items.filter(m => m.matched === false).map(m => m.item).sort())
      .toEqual(['headings.level3', 'headings.level4'])
  })

  it('没说的保持默认但不伪装已覆盖（matched:false 记账）', () => {
    const p = deriveTextProfile('只要正文格式：小四宋体。')
    expect(p.body.size_pt).toBe(12)
    // 行距/题目字号没人说 → 默认但有记录
    expect(p._matched_items.find(m => m.item === 'body.line_spacing')?.matched).toBe(false)
    expect(p._matched_items.find(m => m.item === 'headings.level1')?.matched).toBe(false)
  })

  it('schema 闭集字段齐全（page/fonts/headings/body/_derived_from/_matched_items）', () => {
    const p = deriveTextProfile(FORMAT_REQUIREMENTS)
    expect(p._derived_from).toBe(FORMAT_REQUIREMENTS)
    expect(p.headings).toHaveLength(4)
    expect(p.fonts.latin).toBe('Times New Roman')
  })
})
