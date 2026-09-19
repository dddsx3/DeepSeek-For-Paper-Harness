/**
 * M-QUAL 阶段 E — BoundaryDeclaration schema（"没有第三条路"的 refine）.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/ir/boundary-declaration
 */

import { describe, expect, it } from 'vitest'
import { boundaryDeclarationSchema } from '../../src/ir/boundary-declaration.ts'
import { boundaryDeclaration } from './fixtures.ts'

describe('BoundaryDeclaration — schema', () => {
  it('a fully-quantified declaration parses', () => {
    expect(boundaryDeclarationSchema.safeParse(boundaryDeclaration()).success).toBe(true)
  })

  it('an UNQUANTIFIED slot with a non-empty reason parses (缺口可见，非套话)', () => {
    const ok = boundaryDeclaration({
      slots: [
        { key: 'cost_metric', number_value: null, ref_value: null, enum_value: null, unquantified_reason: '简化模型与严格模型的偏差未量化' },
      ],
    })
    expect(boundaryDeclarationSchema.safeParse(ok).success).toBe(true)
  })

  it('rejects a slot with no decidable value and no reason — 免责声明在类型层不可表达 (构造性反例)', () => {
    const attack = boundaryDeclaration({
      slots: [
        { key: 'cost_metric', number_value: null, ref_value: null, enum_value: null, unquantified_reason: null },
      ],
    })
    const parsed = boundaryDeclarationSchema.safeParse(attack)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some(i => i.message.includes('decidable value OR a non-empty UNQUANTIFIED reason'))).toBe(true)
    }
  })

  it('rejects an empty-string UNQUANTIFIED reason (空原因 = 套话)', () => {
    const attack = boundaryDeclaration({
      slots: [
        { key: 'cost_metric', number_value: null, ref_value: null, enum_value: null, unquantified_reason: '' },
      ],
    })
    expect(boundaryDeclarationSchema.safeParse(attack).success).toBe(false)
  })

  it('rejects duplicate slot keys and unknown keys (.strict())', () => {
    const dupe = boundaryDeclaration({
      slots: [
        { key: 'a', number_value: 1, ref_value: null, enum_value: null, unquantified_reason: null },
        { key: 'a', number_value: 2, ref_value: null, enum_value: null, unquantified_reason: null },
      ],
    })
    expect(boundaryDeclarationSchema.safeParse(dupe).success).toBe(false)
    expect(boundaryDeclarationSchema.safeParse({ ...boundaryDeclaration(), extra: 1 }).success).toBe(false)
  })

  it('rejects an unknown boundary class (闭集 L-1..L-4)', () => {
    expect(boundaryDeclarationSchema.safeParse(boundaryDeclaration({ boundary_class: 'L-9' })).success).toBe(false)
  })
})
