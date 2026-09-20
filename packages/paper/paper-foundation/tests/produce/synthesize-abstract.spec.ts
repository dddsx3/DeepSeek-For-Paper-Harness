/**
 * R5④ — 摘要自动生成测试（D4 数字回读）.
 *
 * 判据：摘要由结果+已验证结论槽机械拼接；其中**每一个数字**都必须回读
 * Result/不确定度；含外部数字的结论槽拒绝整段（绝不悄悄改数字）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/produce/synthesize-abstract
 */

import { describe, expect, it } from 'vitest'
import { synthesizeAbstract } from '../../src/produce/synthesize-abstract.ts'

const RESULTS = [
  { result_id: 'RES-N', value: 109, uncertainty: null },
  { result_id: 'RES-T', value: 0.731, uncertainty: 0.012 },
]

describe('synthesize-abstract — R5④ D4 数字回读', () => {
  it('从已验证结论槽机械拼接摘要，数字全部回读 Result', () => {
    const verdict = synthesizeAbstract({
      title: '抽样检验问题',
      results: RESULTS,
      claims: [{ text: '最小样本量为 109。' }, { text: '冰厚均值为 0.731 m。' }],
      methodsNote: '采用精确二项检验',
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.abstract).toContain('抽样检验问题')
      expect(verdict.abstract).toContain('109')
      expect(verdict.abstract).toContain('0.731')
      expect(verdict.abstract).toContain('采用精确二项检验')
    }
  })

  it('确定性：同输入 → 同输出', () => {
    const a = synthesizeAbstract({ title: 't', results: RESULTS, claims: [{ text: '值为 109。' }], methodsNote: undefined })
    const b = synthesizeAbstract({ title: 't', results: RESULTS, claims: [{ text: '值为 109。' }], methodsNote: undefined })
    expect(a.ok && b.ok ? (a.ok && b.ok ? a.abstract === b.abstract : false) : false).toBe(true)
  })

  it('结论槽带外部数字 → 整段拒绝（D4 守卫，绝不改数字）', () => {
    const verdict = synthesizeAbstract({
      title: 't',
      results: RESULTS,
      claims: [{ text: '猜测的值为 42。' }],
      methodsNote: undefined,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('42')
  })

  it('方法叙述带外部数字 → 整段剔除，保留结论（不污染 D4）', () => {
    const verdict = synthesizeAbstract({
      title: 't',
      results: RESULTS,
      claims: [{ text: '最小样本量为 109。' }],
      methodsNote: '阈值 0.05 之外还有 3 个异常',
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.abstract).not.toContain('0.05')
      expect(verdict.abstract).not.toContain('3 个')
      expect(verdict.abstract).toContain('109')
    }
  })
})
