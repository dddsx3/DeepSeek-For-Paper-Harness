/**
 * BoundaryDeclaration — M-QUAL 阶段 E（DP-8 落地）.
 *
 * 使"是否声明了诚实边界"成为可机械检查的对象
 * （`docs/quality/LIMITS-TEMPLATE.md` §3 的形态）。机制核心是那一条
 * `.refine`：**一个槽位要么携带可判定值（数字 / 引用 / 闭集成员），
 * 要么携带非空的 `UNQUANTIFIED` 原因——没有第三条路**。这使"免责声明"
 * 在类型层就无法表达（红线 N6：边界必须可检查"是否声明了"，而非形容词）。
 *
 * 与 MARKED 附录的关系（DP-8 裁决：**必须分离**）：边界声明由
 * `delivery/boundary-render.ts` **无条件生成**（L-2 无实测、L-3 参数不可验
 * 在任何真实交付中都成立，与 grade 无关）；`renderDeliveryAppendix` 的
 * MARKED 附录是**条件生成**（仅有未通过项时）。两者的渲染通路是两个函数，
 * 不共享"CLEAN 返回空串"的语义。
 *
 * 为什么是新 IR kind 而非扩展 AssumptionSpec（Q1-D1 §1.1）：
 * `AssumptionSpec.testable=false` 能表达"不可检验"，但无法表达
 * "声明在交付物的哪一节"（`must_appear_in`）与"槽位值是多少"
 * （如 L-4 的"代价指标 = 2.22%"）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/ir/boundary-declaration
 */

import { z as zod } from 'zod'
import { BOUNDARY_IDS } from '../capability-sets.ts'

const idSchema = zod
  .string()
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u, 'must not contain control, format, surrogate or separator characters')
  .refine(v => v === v.normalize('NFC'), 'must be in Unicode NFC form')

const refSchema = zod.string().min(1)
const textSchema = zod.string().min(1).max(65_536)

export const boundaryDeclarationSchema = zod
  .object({
    declaration_id: idSchema,
    /** 边界类别（L-1/L-1b/L-2/L-3/L-4，闭集见 capability-sets.ts 单一真相源）。 */
    boundary_class: zod.enum(BOUNDARY_IDS),
    /** 被边界约束的对象：AssumptionSpec / DataArtifact / Result 的引用。 */
    subject_ref: refSchema,
    /** 共享环节(L-1) / 对象(L-2) / 参数(L-3) / 假设(L-4)。 */
    object_text: textSchema,
    /** 槽位值：每个槽位必须携带可判定值，或非空的 UNQUANTIFIED 原因。 */
    slots: zod.array(
      zod
        .object({
          key: idSchema,
          /** 数值槽位（如 L-4 的代价指标 2.22%）。 */
          number_value: zod.number().nullable(),
          /** 引用槽位（指向 IR 对象，如 L-4 的 AssumptionSpec）。 */
          ref_value: refSchema.nullable(),
          /** 闭集成员槽位（L-1 的独立维度：不同模型/输入形态/工具/数据视图）。 */
          enum_value: textSchema.nullable(),
          /** UNQUANTIFIED 的原因（使缺口可见，而非套话）。 */
          unquantified_reason: textSchema.nullable(),
        })
        .strict(),
    ),
    /** 生成位置：交付物的哪个节（外部定位符——节名由渲染器负责解析）。 */
    must_appear_in: refSchema,
  })
  .strict()
  // LIMITS-TEMPLATE §3 的机制核心：没有第三条路。
  .refine(
    v => v.slots.every(s =>
      s.number_value !== null || s.ref_value !== null || s.enum_value !== null ||
      (s.unquantified_reason !== null && s.unquantified_reason.length > 0)),
    { message: 'every slot must carry a decidable value OR a non-empty UNQUANTIFIED reason (免责声明在类型层不可表达, N6)' },
  )
  .refine(
    v => new Set(v.slots.map(s => s.key)).size === v.slots.length,
    { message: 'BoundaryDeclaration.slots contains duplicate keys' },
  )

export type BoundaryDeclaration = zod.infer<typeof boundaryDeclarationSchema>
