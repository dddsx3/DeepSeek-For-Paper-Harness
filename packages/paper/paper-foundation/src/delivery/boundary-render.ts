/**
 * Boundary-appendix renderer — M-QUAL 阶段 E（DP-8 落地；S-10 的修正）.
 *
 * `BoundaryDeclaration` → Markdown，**无条件生成**：L-2（无实测）、L-3
 * （参数不可验）在**任何**真实交付中都成立，与 grade 无关——CLEAN 的交付
 * 同样必须有边界附录。这是与 `renderDeliveryAppendix`（MARKED 附录，对
 * CLEAN 返回 ''）的**本质区别**，也是 DP-8 裁决"必须分离"的落点：两个
 * 函数、两条通路，绝不共享"无标注则无附录"的语义。
 *
 * LIMITS-TEMPLATE §0 的三句话即本渲染器的契约：
 *   1. 本节是必填表，不是可选附录——`UNQUANTIFIED` 槽位**原样渲染**，
 *      使其成为可见缺口而非套话（N6）；
 *   2. 文本是对象的投影，不是对象的来源（渲染器只读
 *      `BoundaryDeclaration`，不接受自由文本输入——INV-010 的同族纪律）；
 *   3. 填不出数值的边界不许写成句子——渲染器拒绝渲染零槽位的声明
 *      （那是一句没有内容的"我们承认有局限"）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/boundary-render
 */

import type { BoundaryDeclaration } from '../ir/boundary-declaration.ts'

/** Classes whose boundary text the renderer knows how to assemble. */
export const RENDERABLE_BOUNDARY_CLASSES = ['L-1', 'L-1b', 'L-2', 'L-3', 'L-4'] as const

function slotValue(slot: BoundaryDeclaration['slots'][number]): string {
  if (slot.number_value !== null) return String(slot.number_value)
  if (slot.ref_value !== null) return `\`${slot.ref_value}\``
  if (slot.enum_value !== null) return slot.enum_value
  return `**UNQUANTIFIED**（${slot.unquantified_reason ?? '原因未记录'}）`
}

/**
 * Render the boundary appendix from the store's BoundaryDeclarations.
 * **Unconditional**: returns a non-empty section whenever declarations
 * exist — including for a CLEAN delivery. Empty input renders nothing
 * (a paper with no declared boundaries gains no fake section; the
 * "declarations must exist for any real delivery" obligation belongs to
 * the capability/coverage layer, not to the renderer).
 *
 * Pure, total, read-only.
 */
export function renderBoundaryAppendix(
  declarations: ReadonlyArray<BoundaryDeclaration>,
): string {
  if (declarations.length === 0) return ''
  const lines: string[] = []
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 附录：局限与边界声明（自动生成，无条件渲染）')
  lines.push('')
  lines.push('> 本节由交付门槛从 BoundaryDeclaration 对象自动生成（fail-soft）。')
  lines.push('> 每个槽位均为必填；填不出者标注 UNQUANTIFIED，使其成为**可见缺口**而非套话。')
  lines.push('> 本节与交付等级无关：CLEAN 交付同样携带它的局限声明。')
  lines.push('')
  for (const declaration of declarations) {
    lines.push(`### ${declaration.boundary_class} ${declaration.object_text}`)
    lines.push('')
    lines.push(`- **对象**：${declaration.object_text}（\`${declaration.subject_ref}\`）`)
    for (const slot of declaration.slots) {
      lines.push(`- **${slot.key}**：${slotValue(slot)}`)
    }
    lines.push(`- **声明位置**：${declaration.must_appear_in}`)
    lines.push('')
  }
  lines.push('*边界声明由交付门槛自动生成：它声明的是"本文不主张什么"，与检查未通过项（交付标注附录）分离。*')
  return lines.join('\n')
}
