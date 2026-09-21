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

describe('W11.5 round-5 — 门禁 ⇔ 教学 一一对应', () => {
  it('教学是一段非空文本，且带 PAPER CONTRACT 清单', () => {
    expect(EXECUTE_PROTOCOL_TEACHING.length).toBeGreaterThan(1000)
    expect(EXECUTE_PROTOCOL_TEACHING).toContain('PAPER CONTRACT')
  })

  it('逐条覆盖现有门禁（缺一条即红）', () => {
    const gates: ReadonlyArray<{ readonly gate: string; readonly taught: string }> = [
      { gate: 'placeholder_chapter（八键必填）', taught: 'EIGHT non-empty strings' },
      { gate: 'prose_contract/analysis（逐问归因）', taught: 'ONE passage per sub-problem' },
      { gate: '实质地板 analysis 600', taught: '600 characters' },
      { gate: 'prose_contract/evaluation（四要素）', taught: '优点 / 局限 / 敏感性 / 推广' },
      { gate: '实质地板 evaluation 500', taught: '500 characters' },
      { gate: 'prose_contract/references（≥3 且方法相关）', taught: 'at least THREE complete entries' },
      { gate: 'prose_contract/code（点名哪几问）', taught: 'which sub-problems the code solves' },
      { gate: '实质地板 restatement 200', taught: 'at least 200 characters' },
      { gate: 'blank_area（空白/密度）', taught: 'no run of blank lines' },
      { gate: 'figure_required', taught: 'at least ONE figure' },
      { gate: 'required_output_unpaid（逐问覆盖）', taught: 'EVERY sub-problem needs its own Result' },
      { gate: 'assumption_structure（引用 + justification）', taught: 'REFERENCED by a ModelSpec.assumption_refs' },
      { gate: '零数字通道（数字可点名）', taught: '{<result_id>}' },
      { gate: '容器形状（首行版本标记）', taught: '__dsh_paper' },
    ]
    const missing = gates.filter(g => !EXECUTE_PROTOCOL_TEACHING.includes(g.taught))
    expect(missing.map(m => m.gate), '门禁没有产出前教学：这些规则只能"事后拦"，每次违规烧掉一次尝试').toEqual([])
  })
})
