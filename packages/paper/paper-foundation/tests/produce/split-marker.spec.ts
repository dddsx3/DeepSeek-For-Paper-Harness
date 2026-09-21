import { describe, expect, it } from 'vitest'
import { parseModelContainer } from '../../src/produce/ir-producer.ts'

describe('W11.5 baseline-r9 — 标记被写成独立对象（真实运行实测）', () => {
  it('`{"__dsh_paper":"ir-container-v1"}` + 真正的容器 → 合并后接受', () => {
    const split = [
      '{"__dsh_paper":"ir-container-v1"}',
      '{"entries":[{"kind":"SymbolSpec","value":{"symbol_id":"S-1"}}],"code":"console.log(1)"}',
    ].join('\n')
    const verdict = parseModelContainer(split)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.container.entries).toHaveLength(1)
      expect(verdict.container.code).toBe('console.log(1)')
    }
  })

  it('标记对象后面跟的不是对象 → 仍然拒绝（不放宽解析）', () => {
    expect(parseModelContainer('{"__dsh_paper":"ir-container-v1"}\n不是 JSON').ok).toBe(false)
  })

  it('两个完整对象拼在一起（第二个没有标记）→ 仍然拒绝', () => {
    expect(parseModelContainer('{"a":1}\n{"entries":[]}').ok).toBe(false)
  })
})

describe('W11.5 baseline-r9 — 信封噪声（真实运行的两种形态）', () => {
  const container = '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"SymbolSpec","value":{"symbol_id":"S-1"}}],"code":"x"}'

  it('末尾多一个 `}` → 取完整对象，接受', () => {
    const verdict = parseModelContainer(`${container}}`)
    expect(verdict.ok).toBe(true)
  })

  it('对象完整、后面跟着写给自己的批注 → 接受', () => {
    const verdict = parseModelContainer(`${container}\n\nNote: claim criticality must be CRITICAL.`)
    expect(verdict.ok).toBe(true)
  })

  it('尾随文本里出现第二个容器 → 仍然拒绝（不许静默用旧的那份）', () => {
    const second = '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"SymbolSpec","value":{"symbol_id":"S-2"}}]}'
    expect(parseModelContainer(`${container}\n${second}`).ok).toBe(false)
  })

  it('字符串值里的 `}` 不会让扫描提前收尾（代码/narrative 里满是花括号）', () => {
    const withBraces = '{"__dsh_paper":"ir-container-v1","entries":[{"kind":"SymbolSpec","value":{"symbol_id":"S-1"}}],"code":"function f() { return {a: 1}; }"}'
    const verdict = parseModelContainer(`${withBraces}\n(trailing note)`)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.container.code).toContain('return {a: 1}')
  })
})
