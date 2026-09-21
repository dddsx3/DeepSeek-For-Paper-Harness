/**
 * W11.5 round-5 — 每个门禁都必须有**产出前**教学（用户口径）。
 *
 * 用户的质疑（成立）：我这几轮加的门禁里，有一部分只是"产出后拦"——模型先写、
 * 门禁再拒、重试才按新规则重写。实质地板、散文要素、空白密度、V1/V2 假设结构
 * 当时都**不在教学里**，每次违规都要烧掉一整次尝试。
 *
 * 这条测试是那个纪律的机械形式：**门禁说了什么，教学必须先说过什么**。
 * 任何人加一条门禁而不加教学，这里就红。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/teaching-contract
 */

import { describe, expect, it } from 'vitest'
import { EXECUTE_PROTOCOL_TEACHING } from '../src/executor.ts'
import { PAPER_LENGTH_REFERENCE } from '../src/delivery/prose-contracts.ts'

describe('W11.5 round-5 — 门禁 ⇔ 教学 一一对应', () => {
  it('教学是一段非空文本，且带 PAPER CONTRACT 清单', () => {
    expect(EXECUTE_PROTOCOL_TEACHING.length).toBeGreaterThan(1000)
    expect(EXECUTE_PROTOCOL_TEACHING).toContain('PAPER CONTRACT')
  })

  it('逐条覆盖现有门禁（缺一条即红）', () => {
    const gates: ReadonlyArray<{ readonly gate: string; readonly taught: string }> = [
      { gate: 'placeholder_chapter（八键必填）', taught: 'EIGHT non-empty strings' },
      { gate: 'prose_contract/analysis（逐问归因）', taught: 'ONE passage per sub-problem' },
      { gate: '实质地板 analysis（软重写线）', taught: 'sent back for a rewrite' },
      { gate: 'prose_contract/evaluation（四要素）', taught: '优点 / 局限 / 敏感性 / 推广' },
      { gate: '实质地板 evaluation（软重写线）', taught: 'it is sent back' },
      { gate: 'prose_contract/references（≥3 且方法相关）', taught: 'at least THREE complete entries' },
      { gate: 'prose_contract/code（点名哪几问）', taught: 'which sub-problems the code solves' },
      { gate: '实质地板 restatement（软重写线）', taught: 'your own words, at least' },
      { gate: 'blank_area（空白/密度）', taught: 'no run of blank lines' },
      { gate: 'figure_required', taught: 'at least ONE figure' },
      { gate: 'required_output_unpaid（逐问覆盖）', taught: 'EVERY sub-problem needs its own Result' },
      { gate: 'assumption_structure（引用 + justification）', taught: 'REFERENCED by a ModelSpec.assumption_refs' },
      { gate: '零数字通道（数字可点名）', taught: '{<result_id>}' },
      { gate: '容器形状（首行版本标记）', taught: '__dsh_paper' },
      { gate: 'E1_E2_FIDELITY_VIOLATION / B4 逐问覆盖', taught: '[[REQUIREMENT: R-Q1]]' },
      { gate: 'E1_E2_FIDELITY_VIOLATION / B3 正向（逐字 span）', taught: 'copied VERBATIM from the E1 text' },
      { gate: 'E1_E2_FIDELITY_VIOLATION / B3 反向与锚点同一性', taught: '[[ASSUMPTION: <id>]]' },
    ]
    const missing = gates.filter(g => !EXECUTE_PROTOCOL_TEACHING.includes(g.taught))
    expect(missing.map(m => m.gate), '门禁没有产出前教学：这些规则只能"事后拦"，每次违规烧掉一次尝试').toEqual([])
  })

  it('教学里的篇幅数字与门禁的软重写线**同源**（round-8 抓到的漂移）', () => {
    // 此前教学说"analysis 至少 600 字"，门禁却在 1200 字才放行——模型按教学写、
    // 按门禁被拒，一次尝试白烧。数字现在单点取自 PAPER_LENGTH_REFERENCE，
    // 这条测试钉住"教学里出现的每一个重写线都是参照值表里的那个数"。
    for (const key of ['analysis', 'evaluation', 'references', 'code', 'restatement'] as const) {
      const chapter = PAPER_LENGTH_REFERENCE.chapters[key]
      expect(chapter, `参照值表缺 ${key}`).toBeDefined()
      if (chapter === undefined) continue
      expect(
        EXECUTE_PROTOCOL_TEACHING.includes(String(chapter.rewriteBelow)),
        `教学没有写出 ${key} 的软重写线 ${String(chapter.rewriteBelow)}`,
      ).toBe(true)
    }
  })
})
