/**
 * 国赛样式档与封面档 —— **迁移**（数据原样）与**适配**（用法改成本机默认画像）。
 */

import { describe, expect, it } from 'vitest'
import {
  DOCX_PROFILES_DIR,
  defaultDocxCover,
  defaultDocxProfile,
  docxPrecheckFatal,
  resolveDocxProfile,
} from '../../src/stages/docx-profile.ts'

describe('迁移 —— 数据原样，不改写', () => {
  it('国赛正文样式档：A4 / 2.5cm 边距 / SimHei 标题 / SimSun 正文 / 12pt 1.5 倍行距', () => {
    const p = defaultDocxProfile()
    expect(p.page.size).toBe('A4')
    expect(p.page.margin_top_cm).toBe(2.5)
    expect(p.fonts.chinese_heading).toBe('SimHei')
    expect(p.fonts.chinese_body).toBe('SimSun')
    expect(p.body.font_size_pt).toBe(12)
    expect(p.body.line_spacing).toBe(1.5)
    expect(p.body.first_line_indent_chars).toBe(2)
  })

  it('三线表线宽与参考文献悬挂缩进都在（国赛格式的硬特征）', () => {
    const p = defaultDocxProfile()
    expect(p.table['top_border_pt']).toBeDefined()
    expect(p.references['hanging_indent_cm']).toBeDefined()
  })

  it('封面档：承诺书正文与 9 个表单字段都在', () => {
    const c = defaultDocxCover()
    expect(c.preface.title).toBe('承诺书')
    expect(c.preface.body_text).toContain('全国大学生数学建模竞赛')
    expect(c.preface.form_fields.map(f => f.key)).toEqual(
      expect.arrayContaining(['problem', 'team_id', 'school', 'member1', 'member2', 'member3']),
    )
  })

  it('**没有 modex 字样**（迁移时逐份核查过）', () => {
    for (const t of [JSON.stringify(defaultDocxProfile()), JSON.stringify(defaultDocxCover())]) {
      expect(/modex/i.test(t)).toBe(false)
    }
  })
})

describe('适配 —— 画像缺失/非法时回退到**国赛默认**，不回退到"无格式"', () => {
  it('缺失 → 默认，且**说明用了默认**（回退必须是可见的事实）', () => {
    const r = resolveDocxProfile(null)
    expect(r.source).toBe('default')
    expect(r.fallbackReason).toContain('没有产出')
    expect(r.profile.page.size).toBe('A4')  // 仍然有完整格式
  })

  it('非法 JSON → 默认，且**明说"不是用户没提要求，是要求没被解析出来"**', () => {
    const r = resolveDocxProfile('{ 坏的')
    expect(r.source).toBe('default')
    expect(r.fallbackReason).toContain('不是合法 JSON')
    expect(r.fallbackReason).toContain('不是"用户没提要求"')
  })

  it('合法画像 → 采纳，并记下**哪些键真的生效了**', () => {
    const r = resolveDocxProfile(JSON.stringify({ body: { font_size_pt: 14, line_spacing: 2 } }))
    expect(r.source).toBe('explicit')
    expect(r.appliedKeys).toEqual(['body'])
    expect(r.profile.body.font_size_pt).toBe(14)
    // 未覆盖的字段仍是国赛默认 —— **只覆盖顶层键**，不做深合并
    expect(r.profile.page.size).toBe('A4')
    expect(r.profile.fonts.chinese_heading).toBe('SimHei')
  })

  it('画像里没有可识别字段 → 默认，并说明原因', () => {
    const r = resolveDocxProfile(JSON.stringify({ 随便一个键: 'x' }))
    expect(r.source).toBe('default')
    expect(r.fallbackReason).toContain('没有一个可识别的字段')
  })

  it('画像目录从模块自身解析（路径单一来源）', () => {
    expect(DOCX_PROFILES_DIR).toContain('docx-profiles')
  })
})

describe('导出前校核 —— 判据是代码，不是让模型自己看', () => {
  it('占位符 → 致命', () => {
    const fatal = docxPrecheckFatal('正文 {<R-N1>} 还有 TODO', [])
    expect(fatal.length).toBeGreaterThanOrEqual(1)
    expect(fatal[0]).toContain('未填充占位')
  })

  it('图片链接指向不存在的文件 → 致命', () => {
    const fatal = docxPrecheckFatal('![图 1：x](figures/fig_a.png)', ['fig_b.png'])
    expect(fatal.some(f => f.includes('图片链接'))).toBe(true)
  })

  it('表格列数不一致 → 致命（参考的 table_columns 校核）', () => {
    const md = ['| a | b |', '|---|---|', '| 1 | 2 | 3 |'].join('\n')
    expect(docxPrecheckFatal(md, []).some(f => f.includes('列数不一致'))).toBe(true)
  })

  it('干净的正文 → 零致命（反向守卫）', () => {
    const md = ['# 标题', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '![图 1：x](figures/fig_a.png)'].join('\n')
    expect(docxPrecheckFatal(md, ['fig_a.png'])).toEqual([])
  })
})
