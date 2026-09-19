/**
 * CapabilitySpec — M-QUAL 阶段 B（DP-1 第二步落地）.
 *
 * "该族该有的能力及如何判定"的载体（`docs/quality/CAPABILITY-SCHEMA.md`
 * §1 的 14 字段形态）。它回答的问题不是"这份建模好不好"，而是
 * **"这份建模有没有犯这类题最典型的退化"**（QUALITY-MECHANISM-SPEC §0）：
 * 每条能力先声明"这道题该证明什么"（`criterion`，人读，不进门），再给
 * "机械判据"（`falsifiable_thresholds`，结构化，可执行）。
 *
 * 为什么是新 IR kind 而非嵌套/复用（Q1-D1 §1.1 实测裁决）：
 *   - 不嵌套 `ProblemSpec`：TASK 1.5 已刻意删掉嵌套自由文本
 *     （INV-1.5-F "leaving a definition behind … is the seed of a second
 *     source of truth"）；
 *   - 不合并 `RequirementSpec`：二者来源不同（题面 vs 族知识）、跨题性
 *     不同（题内 vs 跨题）、判定通道不同（覆盖计数 vs 算子断言）——
 *     裁决是**分层 + 引用**（`source_anchor` → RequirementSpec）；
 *   - 不并入 `FamilyContract.validate`：那是 shell 层的前置指导函数，
 *     本对象是 IR 里的 canonical 状态（后置判定的输入）。
 *
 * 与 {@link ./capability-sets.ts} 的关系：闭集常量（judge / machine_check /
 * verification_depth / operators / probes / boundaries）**只有这一份**，
 * W8.11-D2 已落在 `capability-sets.ts`，本 schema 直接引用——不复制
 * （避免第二真相源）。
 *
 * 阈值算子的执行语义在 `delivery/capability-thresholds.ts`（E-1 容差 /
 * E-2 沿轴 / E-3 集合关系的落点，G5 `numeric_consistency` 门的扩展，
 * 不新增 gate id）。**诚实边界**：系列算子（MONOTONE_* / MAX_OVER_AXIS）
 * 的数据通道尚未落地——引擎对它们 fail-closed（`threshold_unsupported`），
 * 绝不静默通过；本阶段请用代码发射的聚合标量（如 max-over-nodes）+
 * 普通比较算子表达同类判据。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/ir/capability-spec
 */

import { z as zod } from 'zod'
import {
  BOUNDARY_IDS,
  CAPABILITY_JUDGES,
  FAMILIES,
  MACHINE_CHECK_KINDS,
  PROBE_IDS,
  THRESHOLD_OPERATORS,
  VERIFICATION_DEPTHS,
} from '../capability-sets.ts'

const idSchema = zod
  .string()
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u, 'must not contain control, format, surrogate or separator characters')
  .refine(v => v === v.normalize('NFC'), 'must be in Unicode NFC form')

const refSchema = zod.string().min(1)
const textSchema = zod.string().min(1).max(65_536)
const unitSchema = zod.string().min(1)

/**
 * 结构化阈值：把参考侧散文 `falsifiable_check` 拆成可执行对象。
 * 判据形如 `observed <op> threshold`（tolerance 按 operator 语义参与），
 * `subject_ref` 必须是 IR 内可解析的路径（复合形式 `<Kind>:<id>.<field>`），
 * 不是自然语言描述。
 */
export const falsifiableThresholdSchema = zod
  .object({
    /** 断言的**观测对象**：解析到 Result 的复合引用（引擎读其标量 value）。 */
    subject_ref: refSchema,
    /** 比较算子（闭集，`capability-sets.ts` 单一真相源）。 */
    operator: zod.enum(THRESHOLD_OPERATORS),
    /** 阈值。MATCHES_EXACT / MONOTONE_* 可为 null（见引擎的 fail-closed 语义）。 */
    threshold: zod.number().nullable(),
    /** ABS_LT / REL_LT 的容差；其他算子为 null。 */
    tolerance: zod.number().nonnegative().nullable(),
    /** 单位（与 Result.unit 同约定）。 */
    unit: unitSchema,
    /** 施加断言的**配置**（M5 / Q1-B4 的字段基础）：解析到 RunArtifact。
     *  2026-A 的 F1 major 正是"断言跑在 dt=0.25，交付出在 dt=1.0"。 */
    at_config_ref: refSchema.nullable(),
  })
  .strict()
  .refine(
    v => v.operator === 'MATCHES_EXACT' || v.operator === 'MONOTONE_INCREASING' || v.operator === 'MONOTONE_NONINCREASING' || v.threshold !== null,
    { message: 'falsifiable_threshold.threshold is required unless operator is MATCHES_EXACT / MONOTONE_*' },
  )
  .refine(
    v => (v.operator !== 'REL_LT' && v.operator !== 'ABS_LT') || (v.tolerance !== null && v.tolerance > 0),
    { message: 'REL_LT / ABS_LT require a positive tolerance' },
  )

export type FalsifiableThreshold = zod.infer<typeof falsifiableThresholdSchema>

export const capabilitySpecSchema = zod
  .object({
    capability_id: idSchema,
    /** 族：决定适用哪个 FamilyContract（跨题可比）。闭集 `FAMILIES`。 */
    family: zod.enum(FAMILIES),
    /** 题内作用域：指向 RequirementSpec（与 AssumptionSpec.scope_ref 同 idiom）。 */
    scope_ref: refSchema,
    /** 人读标签。 */
    name: textSchema,
    /** 人读判据。不参与 gate（semantic 项的复核提示）。 */
    criterion: textSchema,
    /** 判定通道。machine 项必须有非空 falsifiable_thresholds。 */
    judge: zod.enum(CAPABILITY_JUDGES),
    /** 检查类别（闭集）。semantic 项为 null。 */
    machine_check: zod.enum(MACHINE_CHECK_KINDS).nullable(),
    /** 结构化阈值集（judge=machine 时 ≥1 项）。空数组 + machine 是硬失败。 */
    falsifiable_thresholds: zod.array(falsifiableThresholdSchema),
    /** 题面锚点：指向 RequirementSpec（能力锚定到它回应的题面要求）。
     *  非空是硬要求——参考侧 23/23 全带 source_sentence 的机械等价物。 */
    source_anchor: refSchema,
    /** 交付物引用：指向 requirement_type=REQUIRED_OUTPUT 的 RequirementSpec。
     *  非交付类能力为 null。 */
    required_output_ref: refSchema.nullable(),
    /** 验证深度（存在性/实质分离，N10）。EXISTENCE 必须带 disclaimer。 */
    verification_depth: zod.enum(VERIFICATION_DEPTHS),
    /** EXISTENCE 深度的免责句（N10：不得把"仅验存在"读成"内容已验"）。 */
    existence_disclaimer: textSchema.nullable(),
    /** 覆盖本能力的探针类型（P-1..P-10，闭集见 capability-sets.ts）。
     *  空数组合法但可查询（"无探针覆盖"是事实，不是错误）。 */
    probe_refs: zod.array(zod.enum(PROBE_IDS)),
    /** 适用于本能力的诚实边界（L-1/L-1b/L-2/L-3/L-4）。 */
    boundary_refs: zod.array(zod.enum(BOUNDARY_IDS)),
  })
  .strict()
  // 三条硬 refine（T-1 测试对每条配构造性反例）：
  .refine(
    v => v.judge !== 'machine' || v.falsifiable_thresholds.length > 0,
    { message: 'judge=machine requires >=1 falsifiable_threshold (散文不算阈值)' },
  )
  .refine(
    v => v.judge !== 'semantic' || v.machine_check === null,
    { message: 'judge=semantic must not declare machine_check' },
  )
  .refine(
    v => v.verification_depth !== 'EXISTENCE' || v.existence_disclaimer !== null,
    { message: 'verification_depth=EXISTENCE requires a non-null existence_disclaimer ([F-04]/[Q-15] 的边界, N10)' },
  )
  // 第四条（Q1-B1 的占位 refine 按其 §1 实施说明落定）：EXISTENCE 深度必须
  // 与 machine_check=EXISTENCE 配对；required_output_ref 非空**允许**（不
  // 强制）EXISTENCE——存在性交付与实质交付可以并存（材料侧 P1-C6 实测）。
  .refine(
    v => v.verification_depth !== 'EXISTENCE' || v.machine_check === 'EXISTENCE',
    { message: 'EXISTENCE verification_depth pairs with machine_check=EXISTENCE' },
  )

export type CapabilitySpec = zod.infer<typeof capabilitySpecSchema>
