/**
 * 只读工具 —— `read_skill_doc`（参考的 `cat _utils/x.md` 的工具化）。
 *
 * 纪律：`run` **不得抛错**——工具是帮忙的，不是新的门。
 */

import { describe, expect, it } from 'vitest'
import { READ_SKILL_DOC_TOOL, skillDocToolSpec } from '../../src/stages/tools.ts'

const tool = skillDocToolSpec('paper')

describe('read_skill_doc —— 取用与列举', () => {
  it('不给 id → 列出**本阶段可见**的语料（含体量与"什么时候读"）', () => {
    const out = tool.run({})
    expect(out).toContain('writing-rules')
    // `whenToUse` 是给模型的决策依据，形态是"当你要…时"。
    // 第一版我写的是自己记忆里的字符串（'什么时候'），而实际文本里没有那四个字
    // ——断言要落在**真实语义**上，不是我以为的措辞。
    expect(out).toContain('当你要')
    expect(out).toContain('KB')        // 体量——模型据此判断值不值得读
  })

  it('给合法 id → 返回**正文原文**（不是摘要）', () => {
    const out = tool.run({ id: 'writing-rules' })
    expect(Buffer.byteLength(out, 'utf8')).toBeGreaterThan(50_000)
    // 抽查正文特征：它必须是真文档，不是索引
    expect(out.length).toBeGreaterThan(10_000)
    expect(out).not.toContain('本阶段可读的参考语料')
  })
})

describe('read_skill_doc —— 纪律：不抛错，只说可纠正的话', () => {
  it('拼错 id → 回一句"没有这个 id"并列出可读的', () => {
    const out = tool.run({ id: 'writing-rulez' })
    expect(out).toContain("没有 id 为 'writing-rulez'")
    expect(out).toContain('writing-rules')
  })

  it('**存在但本阶段不开放** → 说清它服务于哪些阶段（不是"不存在"）', () => {
    // `tikz-rules` 只服务于 diagram；paper 阶段看不到它
    const out = tool.run({ id: 'tikz-rules' })
    expect(out).toContain('存在，但本阶段')
    expect(out).toContain('diagram')
  })

  it('id 不是字符串 → 当作"列举"，不抛错', () => {
    expect(tool.run({ id: 42 })).toContain('可读的参考语料')
    expect(tool.run({ id: '' })).toContain('可读的参考语料')
  })

  it('超长文档**截断且明说被截断**（静默截断会让模型以为读完了）', () => {
    const tiny = skillDocToolSpec('paper', 1000)
    const out = tiny.run({ id: 'error-prevention' })  // 128KB 的文档
    expect(out).toContain('文档被截断')
    expect(out).toContain('不是到此为止')
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThan(3000)
  })
})

describe('read_skill_doc —— 阶段可见性', () => {
  it('不同阶段看到的语料集不同（一份与本题无关的配方只会占上下文）', () => {
    const paper = skillDocToolSpec('paper').run({})
    const figure = skillDocToolSpec('figure').run({})
    expect(paper).toContain('writing-rules')
    expect(paper).not.toContain('figure-recipes-basic')
    expect(figure).toContain('figure-recipes-basic')
    expect(figure).not.toContain('writing-rules')
  })

  it('没有语料的阶段 → 明说"没有可读的"（不返回空串）', () => {
    expect(skillDocToolSpec('format-profile').run({})).toBe('本阶段没有可读的参考语料。')
  })

  it('工具名与描述点明"读多少"的纪律（它们很长，只读需要的）', () => {
    expect(tool.name).toBe(READ_SKILL_DOC_TOOL)
    expect(tool.description).toContain('read only what you need')
    expect(tool.description).toContain('authoritative, not a summary')
  })
})
