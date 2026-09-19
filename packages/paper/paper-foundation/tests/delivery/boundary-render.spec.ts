/**
 * M-QUAL 阶段 E — boundary-render（DP-8：边界无条件渲染，与 MARKED 附录分离）.
 *
 * @module @deepseek-ai/dsh-paper-foundation/tests/delivery/boundary-render
 */

import { describe, expect, it } from 'vitest'
import { renderBoundaryAppendix } from '../../src/delivery/boundary-render.ts'
import { renderDeliveryAppendix } from '../../src/delivery/delivery-grade.ts'
import { boundaryDeclaration } from '../ir/fixtures.ts'
import type { BoundaryDeclaration } from '../../src/ir/boundary-declaration.ts'

describe('boundary-render — DP-8 分离（无条件 vs 条件）', () => {
  it('CLEAN 等级下 MARKED 附录为空串，而边界附录照常渲染（规格判据）', () => {
    const declarations = [boundaryDeclaration() as unknown as BoundaryDeclaration]
    expect(renderDeliveryAppendix('CLEAN', [])).toBe('')
    expect(renderBoundaryAppendix(declarations)).not.toBe('')
    expect(renderBoundaryAppendix(declarations)).toContain('## 附录：局限与边界声明')
  })

  it('无声明 → 渲染空串（不为没有声明的交付伪造一节）', () => {
    expect(renderBoundaryAppendix([])).toBe('')
  })
})

describe('boundary-render — 槽位投影（文本是对象的投影）', () => {
  it('数值槽位原样投影，UNQUANTIFIED 槽位以可见缺口渲染（N6）', () => {
    const declaration = boundaryDeclaration({
      slots: [
        { key: 'self_check_1', number_value: 2.9459e-4, ref_value: null, enum_value: null, unquantified_reason: null },
        { key: 'cost_metric', number_value: null, ref_value: null, enum_value: null, unquantified_reason: '简化模型偏差未量化' },
      ],
    }) as unknown as BoundaryDeclaration
    const rendered = renderBoundaryAppendix([declaration])
    expect(rendered).toContain('0.00029459')
    expect(rendered).toContain('**UNQUANTIFIED**（简化模型偏差未量化）')
    expect(rendered).toContain('### L-2')
  })

  it('引用槽位以行内代码投影（可回指 IR 对象）', () => {
    const declaration = boundaryDeclaration({
      boundary_class: 'L-4',
      object_text: '仿射收缩假设',
      slots: [
        { key: 'assumption_ref', number_value: null, ref_value: 'ASM-1', enum_value: null, unquantified_reason: null },
        { key: 'cost_metric', number_value: 0.0222, ref_value: null, enum_value: null, unquantified_reason: null },
      ],
    }) as unknown as BoundaryDeclaration
    const rendered = renderBoundaryAppendix([declaration])
    expect(rendered).toContain('`ASM-1`')
    expect(rendered).toContain('0.0222')
    expect(rendered).toContain('### L-4')
  })

  it('多条声明逐节渲染，节序与输入一致', () => {
    const l2 = boundaryDeclaration() as unknown as BoundaryDeclaration
    const l3 = boundaryDeclaration({
      declaration_id: 'BD-2',
      boundary_class: 'L-3',
      object_text: '附录 2/3/4 物性经验公式',
    }) as unknown as BoundaryDeclaration
    const rendered = renderBoundaryAppendix([l2, l3])
    const l2At = rendered.indexOf('### L-2')
    const l3At = rendered.indexOf('### L-3')
    expect(l2At).toBeGreaterThanOrEqual(0)
    expect(l3At).toBeGreaterThan(l2At)
  })
})
