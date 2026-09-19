/**
 * W8.11-D2 — the closed-set constants the Q-branch spec (`CapabilitySpec`)
 * declares, landed inside `paper-foundation` so W8.12 can build on them.
 *
 * 为什么需要这一层：Q 支线的 `docs/quality/CAPABILITY-SCHEMA.md` 定义了这些
 * 闭集，但它们**只存在于 Markdown 里**——全仓 `*.ts` 零命中。W8.12 落地
 * `CapabilitySpec` 时若现写一份，就会得到**第二个真相源**（本项目反复踩的坑）。
 * 这里一次性建好，并把**取值出处**写进注释，使"规格说的"与"代码认的"可核对。
 *
 * `FAMILIES` 之所以也在这里：它此前只在 `apps/paper-shell/src/route.ts`，
 * 而 `paper-foundation` **不依赖** `apps/paper-shell`（依赖方向相反）——
 * W8.12 一引用就会撞。落进本包后由 `route.ts` 反向导入，保持单一真相源。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/capability-sets
 */

/**
 * The method families the harness routes on.
 *
 * 取值出处：`apps/paper-shell/src/route.ts`（原定义）与
 * `bench/TRUTH-FAMILIES.json`（人工真值标签使用的同一组名字）。
 * 落在本包后，`route.ts` 改为从这里导入——**不保留第二份**。
 */
export const FAMILIES = ['F1', 'F2', 'F3', 'F4'] as const
/** One method family. */
export type Family = (typeof FAMILIES)[number]

/**
 * Closed set: what kind of machine check a capability carries.
 *
 * 取值出处：`docs/quality/CAPABILITY-SCHEMA.md:49-55`（材料侧实测取值
 * `constraint/facts/custom/delivery` 全收，另加 `EXISTENCE`——存在性交付检查，
 * 与 `DELIVERY` 同源但语义独立）。
 */
export const MACHINE_CHECK_KINDS = [
  'CONSTRAINT',
  'FACTS',
  'CUSTOM',
  'DELIVERY',
  'EXISTENCE',
] as const
/** One machine-check kind. */
export type MachineCheckKind = (typeof MACHINE_CHECK_KINDS)[number]

/**
 * Closed set: how a capability is judged.
 *
 * 取值出处：`docs/quality/CAPABILITY-SCHEMA.md:59`。
 */
export const CAPABILITY_JUDGES = ['machine', 'semantic'] as const
/** One capability judge channel. */
export type CapabilityJudge = (typeof CAPABILITY_JUDGES)[number]

/**
 * Closed set: how deeply a capability was verified.
 *
 * 取值出处：`docs/quality/CAPABILITY-SCHEMA.md:63`。
 *
 * **`EXISTENCE` 必须显式携带 disclaimer**（红线 N10：不得把"仅验证交付存在"
 * 读作"内容已验"）。本模块只声明取值；该义务由 W8.12 的 schema 承担。
 */
export const VERIFICATION_DEPTHS = ['EXISTENCE', 'SUBSTANTIVE'] as const
/** One verification depth. */
export type VerificationDepth = (typeof VERIFICATION_DEPTHS)[number]

/**
 * Closed set: the operators a structured falsifiable threshold may use.
 *
 * 取值出处：`docs/quality/CAPABILITY-SCHEMA.md:68-72`。
 *
 * **消费方（M-QUAL 阶段 B 落地后更新）**：`delivery/capability-thresholds.ts`
 * 执行其中 10 个标量算子（LT/LE/GT/GE/EQ/NE/ABS_LT/REL_LT/COUNT_ZERO/
 * MATCHES_EXACT——后者仅在显式 threshold 下可执行，否则 fail-closed）。
 * **3 个系列算子（MONOTONE_INCREASING / MONOTONE_NONINCREASING /
 * MAX_OVER_AXIS）的数据通道尚未落地**——引擎对它们 fail-closed
 * （`capability_threshold_unsupported`），绝不静默通过；当前请用代码发射的
 * 聚合标量 + 普通比较算子表达同类判据（见 bench/quality/cumcm-2026-A 的
 * capability-library）。
 */
export const THRESHOLD_OPERATORS = [
  'LT', 'LE', 'GT', 'GE', 'EQ', 'NE', 'ABS_LT', 'REL_LT',
  'MONOTONE_INCREASING', 'MONOTONE_NONINCREASING',
  'MAX_OVER_AXIS', 'COUNT_ZERO', 'MATCHES_EXACT',
] as const
/** One threshold operator. */
export type ThresholdOperator = (typeof THRESHOLD_OPERATORS)[number]

/**
 * Closed set: the probe ids a capability may reference.
 *
 * 取值出处：`docs/quality/PROBE-TYPOLOGY.md`（P-1 … P-10，该表 `:183-191`
 * 逐行列出每个探针的驱动/观测量/判据）。
 *
 * 该文档在本轮**已入库**（C2 曾记录"尚未提交"，实测 12 份 `docs/quality/*.md`
 * 均已被 git 跟踪）——故这里的取值有可核对的出处，不是凭记忆写的。
 */
export const PROBE_IDS = [
  'P-1', 'P-2', 'P-3', 'P-4', 'P-5',
  'P-6', 'P-7', 'P-8', 'P-9', 'P-10',
] as const
/** One probe id. */
export type ProbeId = (typeof PROBE_IDS)[number]

/**
 * Closed set: the honesty-boundary classes a capability may reference.
 *
 * 取值出处：`docs/quality/HONESTY-BOUNDARY-CLASSES.md` 的小节标题
 * （`### L-1` / `#### L-1b` / `### L-2` / `### L-3` / `### L-4`）。
 *
 * `L-1b` 是 `L-1` 的子类而非独立顶层类（文档里它是 `####` 级小节），
 * 但它在规格里被当作可引用的目标，故与其余并列。
 */
export const BOUNDARY_IDS = ['L-1', 'L-1b', 'L-2', 'L-3', 'L-4'] as const
/** One honesty-boundary class. */
export type BoundaryId = (typeof BOUNDARY_IDS)[number]
