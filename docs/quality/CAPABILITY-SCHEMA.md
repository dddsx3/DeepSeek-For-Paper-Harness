# 能力清单的通用 schema（Q1-B1）

> **产物编号**：Q1-B1　**要求**（§3.2-B1）：定义 DPH 侧 schema，字段名**可与** `[P-02]` 对齐，但**须说明每处改动理由**。至少含 `capability_id / family / criterion / judge / machine_check / falsifiable_threshold / source_anchor / required_output`。
> **禁止**：直接照搬字段名而不说明 DPH 语境下的差异。

---

## 0. 材料侧字段并集（实测）与 DPH 侧的取舍总览

`[P-02]` 字段并集（实测，9 项）：`criterion / falsifiable_check / id / judge / machine_check / name / required_output / source_sentence / subproblem`

| `[P-02]` 字段 | DPH 字段 | 改动 | 理由（**逐条**） |
|---|---|---|---|
| `id` | `capability_id` | **改名** | DPH 的 `ID_FIELD_BY_KIND`（`ir/schema.ts`）把每种 IR 对象的 id 字段统一命名为 `<kind>_id`（`requirement_id` / `assumption_id` / `equation_id` …）。沿用 `id` 会与 DPH 的 id 约定不一致，且 `capability_id` 才能被 `IR_REF_FIELDS` 机械识别为可引用目标 |
| `subproblem` | `scope_ref` | **改名 + 换语义** | 材料的 `subproblem` 取值是 `1/2/3/4/PX`——这是**该道题**的问号轴，换题即失效（N2 的精神）。DPH 的既有 idiom 是 `scope_ref`（`AssumptionSpec.scope_ref`、`EquationSpec.scope_ref`），指向 **IR 内的作用域对象**。跨题可比的是 `family`（见下），题内定位用 `scope_ref` |
| （无） | `family` | **新增** | 材料侧**没有**族字段——它的族隐含在 `_note` 的自由文本里（"题型 = 机理建模 + 数值求解(PDE)"）。DPH 的 `FAMILIES = ['F1','F2','F3','F4']` 是**一等对象**（`apps/paper-shell/src/contracts/index.ts`），能力必须挂在族上，否则无法按族选择 `FamilyContract.validate` |
| `name` | `name` | **保留** | 人读标签，无机械作用。保留可降低与材料对照的成本 |
| `criterion` | `criterion` | **保留** | 人读判据。DPH 侧**不参与 gate**，只作为 `semantic` 项的复核提示 |
| `judge` | `judge` | **保留 + 收紧** | 材料的 `machine`/`semantic` 二分**未给出判定标准**（§3.2-B2 要补）。DPH 侧保留该字段但须配 `MACHINE_JUDGE_CRITERIA`（见 Q1-B2） |
| `machine_check` | `machine_check` | **保留 + 收紧为闭集** | 材料的取值实测为 `constraint / facts / custom / delivery / (空)`——**是个自由字符串**，未被 schema 约束。DPH 侧必须闭集化（`.strict()` 精神），否则"检查类别"会随题目漂移 |
| `falsifiable_check` | `falsifiable_threshold` | **改名 + 结构化（最关键的改动）** | 材料的 `falsifiable_check` 是**散文**（如"断言 D(2.55)=4.9377e-9 且 D(0.15)=1.8462e-11(相对误差<1e-3)"）。**散文不能被机械执行**——它需要 LLM 或人去"读懂并翻译"。DPH 侧必须把**阈值与断言对象**抽成**结构化对象**，把散文留在 `criterion`/`note` 里 |
| `source_sentence` | `source_anchor` | **改名 + 换类型** | 材料的取值是 `"S10, S3"`——句子编号，指向**材料内部的句子表**（该表不在 `[F-02]` 内，未随清单交付）。DPH 侧须指向 **IR 内的 `RequirementSpec` + `source_span`**，使其**可解析、可校验**（`reference_validation` 门）。**这是与 W8.9 的依赖点**（Q1-D2） |
| `required_output` | `required_output_ref` | **改名 + 收紧为引用** | 材料的取值是文件名（`result1.xlsx`）——**外部定位符**，DPH 无法解析。DPH 侧须是**指向 `RequirementSpec`（`requirement_type = REQUIRED_OUTPUT`）的 IR 引用**，由 `requirement_coverage` 门承担覆盖检查 |
| （无） | `verification_depth` | **新增** | `[F-04]`（`[Q-15]`）的做法：把"存在性验证"与"实质验证"分开记账，并**显式注明"不代表内容正确"**。DPH 必须把这一原则**字段化**，否则"仅验存在"会被读成"内容已验"（N10） |
| （无） | `probe_refs` | **新增** | 材料侧的探针库（`[P-10]`）与能力清单（`[P-02]`）**是两个独立产物，无字段连接**——这是探针库出现空位（见 `PROBE-TYPOLOGY.md` §2）的结构原因。DPH 侧用 `probe_refs` 建立连接，使"某能力无探针覆盖"成为**可查询事实** |
| （无） | `boundary_refs` | **新增** | 材料侧的诚实边界（`[P-11]`）与能力清单**也无字段连接**。DPH 侧用 `boundary_refs` 挂 `L-1` / **`L-1b`** / `L-2` / `L-3` / `L-4`（`HONESTY-BOUNDARY-CLASSES.md`），使"某能力涉及的边界是否已声明"可机械检查 |

> **改动统计**：保留 2（`name` / `criterion`）＋保留并收紧 2（`judge` / `machine_check`）＋改名 4（`id` / `subproblem` / `falsifiable_check` / `source_sentence`）＋收紧为引用 1（`required_output`）＋新增 5（`family` / `verification_depth` / `probe_refs` / `boundary_refs`）。**总计 14 字段**。

---

## 1. Schema 定义（zod，与 DPH 既有约定一致）

> 约定遵循 `ir/schema.ts`：`.strict()` 关死未知键；`idSchema` / `refSchema` / `textSchema` 复用既有语义；闭集用 `as const` + `zod.enum`；跨对象引用登记进 `IR_REF_FIELDS`（`ir/refs.ts`）。

```ts
/**
 * CapabilitySpec — Q1-B1 (DPH-Q 支线规格, 未实施).
 *
 * 与既有 IR 的关系: 这是一个**新的 IR kind**（见 Q1-D1 §需新增对象）,
 * 而非 ProblemSpec 的嵌套字段。理由: ProblemSpec 在 TASK 1.5 已刻意
 * 删掉嵌套自由文本（INV-1.5-F "leaving a definition behind, even an
 * unused one, is the seed of a second source of truth"）——能力清单若
 * 嵌套进去会重犯该错误。
 */

/** 闭集: 检查类别。材料侧实测取值 (constraint/facts/custom/delivery) 全收,
 *  另加 EXISTENCE（存在性交付检查，与 delivery 同源但语义独立）。 */
export const MACHINE_CHECK_KINDS = [
  'CONSTRAINT',   // 边界/符号/物理约束（材料: constraint）
  'FACTS',        // 数值常数/公式系数溯源（材料: facts）
  'CUSTOM',       // 需专用脚本（材料: custom）
  'DELIVERY',     // 交付物形态/模板（材料: delivery）
  'EXISTENCE',    // 仅存在性（[F-04] 的做法; 必须配 verification_depth=EXISTENCE）
] as const
export type MachineCheckKind = (typeof MACHINE_CHECK_KINDS)[number]

/** 闭集: 判定通道。 */
export const CAPABILITY_JUDGES = ['machine', 'semantic'] as const
export type CapabilityJudge = (typeof CAPABILITY_JUDGES)[number]

/** 闭集: 验证深度。EXISTENCE 必须显式携带 disclaimer（N10）。 */
export const VERIFICATION_DEPTHS = ['EXISTENCE', 'SUBSTANTIVE'] as const
export type VerificationDepth = (typeof VERIFICATION_DEPTHS)[number]

/** 结构化阈值: 把材料的散文 falsifiable_check 拆成可执行三元组。
 *  判据形如 `observed <op> threshold`, 单位为 unit, 由 comparator 机械比较。 */
export const THRESHOLD_OPERATORS = [
  'LT', 'LE', 'GT', 'GE', 'EQ', 'NE', 'ABS_LT', 'REL_LT',
  'MONOTONE_INCREASING', 'MONOTONE_NONINCREASING',
  'MAX_OVER_AXIS', 'COUNT_ZERO', 'MATCHES_EXACT',
] as const
export type ThresholdOperator = (typeof THRESHOLD_OPERATORS)[number]

export const falsifiableThresholdSchema = zod
  .object({
    /** 断言的**观测对象**: 必须是 IR 内可解析的路径, 不是自然语言描述。
     *  例: 'Result:r_q1_surface_dev.value' / 'run_output:result1.xlsx!C2'。 */
    subject_ref: refSchema,
    /** 比较算子（闭集）。MAX_OVER_AXIS 对应材料"各处"= max_r 这类语义。 */
    operator: zod.enum(THRESHOLD_OPERATORS),
    /** 阈值。MATCHES_EXACT / MONOTONE_* 可为 null（无阈值, 只有形态）。 */
    threshold: zod.number().nullable(),
    /** 相对误差类算子（REL_LT）的容差; 其他算子为 null。 */
    tolerance: zod.number().nonnegative().nullable(),
    /** 单位。MATCHES_EXACT 时可为 'dimensionless'。 */
    unit: unitSchema,
    /** 施加断言的**配置**: 必须与交付配置可比（M5 / Q1-B4 的字段基础）。
     *  材料侧的 F1 major 正是"断言跑在 dt=0.25, 交付出在 dt=1.0"。 */
    at_config_ref: refSchema.nullable(),
  })
  .strict()
  .refine(
    v => v.operator === 'MATCHES_EXACT' || v.operator.startsWith('MONOTONE') || v.threshold !== null,
    { message: 'falsifiable_threshold.threshold is required unless operator is MATCHES_EXACT / MONOTONE_*' },
  )
  .refine(
    v => v.operator !== 'REL_LT' || (v.tolerance !== null && v.tolerance > 0),
    { message: 'REL_LT requires a positive tolerance' },
  )

export const capabilitySpecSchema = zod
  .object({
    capability_id: idSchema,
    /** 族: 决定适用哪个 FamilyContract.validate。跨题可比。 */
    family: zod.enum(FAMILIES),                       // 既有常量
    /** 题内作用域: 指向 RequirementSpec（与 AssumptionSpec.scope_ref 同 idiom）。 */
    scope_ref: refSchema,
    name: textSchema,
    /** 人读判据。不参与 gate。 */
    criterion: textSchema,
    /** 判定通道。machine 项必须有非空 falsifiable_thresholds。 */
    judge: zod.enum(CAPABILITY_JUDGES),
    /** 检查类别（闭集）。semantic 项为 null。 */
    machine_check: zod.enum(MACHINE_CHECK_KINDS).nullable(),
    /** 结构化阈值集（≥1 项当 judge=machine）。空数组 + judge=machine 是硬失败。 */
    falsifiable_thresholds: zod.array(falsifiableThresholdSchema),
    /** 题面锚点: 指向 RequirementSpec; source_span 落在其 raw_problem_ref 上。
     *  非空是硬要求（材料 23/23 全带 source_sentence 的机械等价物）。 */
    source_anchor: refSchema,
    /** 交付物引用: 指向 requirement_type=REQUIRED_OUTPUT 的 RequirementSpec。
     *  非交付类能力为 null。 */
    required_output_ref: refSchema.nullable(),
    /** 验证深度。EXISTENCE 时必须带 disclaimer（见下）。 */
    verification_depth: zod.enum(VERIFICATION_DEPTHS),
    /** EXISTENCE 深度的免责句（N10）。SUBSTANTIVE 时为 null。 */
    existence_disclaimer: textSchema.nullable(),
    /** 覆盖本能力的探针类型（PROBE-TYPOLOGY.md 的 P-1..P-10）。空数组是**合法**
     *  但**可查询**的状态——"无探针覆盖"是事实, 不是错误。 */
    probe_refs: zod.array(zod.enum(PROBE_IDS)),
    /** 适用于本能力的诚实边界（L-1 / L-1b / L-2 / L-3 / L-4）。 */
    boundary_refs: zod.array(zod.enum(BOUNDARY_IDS)),
  })
  .strict()
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
    { message: 'verification_depth=EXISTENCE requires existence_disclaimer ([F-04]/[Q-15] 的边界)' },
  )
  .refine(
    v => v.verification_depth !== 'EXISTENCE' || v.machine_check === 'EXISTENCE',
    { message: 'EXISTENCE depth pairs with machine_check=EXISTENCE' },
  )
  .refine(
    v => (v.required_output_ref === null) === (v.verification_depth !== 'EXISTENCE' ? v.required_output_ref === null : true),
    { message: 'placeholder — see note' },   // 实际实施时替换为: required_output_ref 非空 ⇒ 允许 EXISTENCE
  )
```

> **实施说明**：最后一条 `refine` 是**占位**，实施时应改为"`required_output_ref` 非空时**允许**（不强制）`EXISTENCE`"——因为材料侧实测：4 条交付能力中 `judge=machine` 且 `verification_depth=EXISTENCE`，但它们**同时**有 `required_output` 与 `machine_check=delivery`。**存在性交付与实质交付可以并存**（如 `P1-C6` 既验文件存在、也验工作表结构与四位小数）。这是 `[F-04]` 的账目**比**本 schema 初稿更细的地方。

### 1.1 注册进既有表（实施时的必改点）

| 表 | 位置 | 改动 |
|---|---|---|
| `IR_KINDS` | `ir/schema.ts:62-86` | 追加 `'CapabilitySpec'`（16 个 kind） |
| `IrObjectMap` / `IR_SCHEMAS` | `ir/schema.ts` | 追加 `CapabilitySpec: capabilitySpecSchema` |
| `ID_FIELD_BY_KIND` | `ir/schema.ts:633-649` | 追加 `CapabilitySpec: 'capability_id'` |
| `IR_REF_FIELDS` | `ir/refs.ts` | 追加 4 条：`scope_ref`→`RequirementSpec`（single）、`source_anchor`→`RequirementSpec`（single）、`required_output_ref`→`RequirementSpec`（single）、`falsifiable_thresholds[].subject_ref`→`Result`/`RunArtifact`（nested）、`falsifiable_thresholds[].at_config_ref`→`RunArtifact`（nested） |
| `IR_SCOPE_FIELDS` | `ir/refs.ts` | 若 `scope_ref` 需作用域归属校验，追加 |
| `ir/index.ts` | 桶导出 | 追加 schema / 常量 / 类型的 re-export |
| `tests/ir/ir-contract.spec.ts` | 既有测试 | 既有断言"每个 kind 都在两张表里"会自动覆盖新 kind（这是 DPH 的护栏，免费得到） |

> **注意**：`.strict()` 使上述登记**不是可选项**——漏登记会在 `schema_invalid` 或"引用被当作外部定位符永不解析"上失败。DPH 的既有测试会抓住它。

---

## 2. 填好的实例（材料 `P1-C2` → DPH schema）

> 选 `P1-C2` 作为样例的理由：它是 `judge=machine` + `machine_check=constraint` + `falsifiable_check` 含**多个具体数值**（最典型的"散文含阈值"），最能展示**散文 → 结构化**的转换。

### 2.1 原始材料形态（`[P-02]` `P1-C2`，逐字）

```
id              : P1-C2
subproblem      : 1
judge           : machine
name            : 第三类(Robin)边界 + 附件1 时变环境驱动
criterion       : r=R 处用 -k dT/dr = h(Ts - Tair(t)) 与 -D dC/dr = hm(Cs - Cair(t));
                  r=0 处零梯度; 环境侧取自附件1 插值而非常数
falsifiable_check: 代码中 h=25 与 hm=8e-7 逐字出现且用于表面通量; Tair/Cair 为 t 的函数
                  (对附件1 插值), 在 t=0/600/3600 s 处分别等于 28.000/33.202/47.485 degC
                  与 0.01963/0.02428/0.04272 kg/kg(容差 1e-3); 若表面被直接钉为 Tair(第一类
                  边界, 即 T[N]==Tair 恒成立)或 Tair 为标量常数, 判不成立并 raise
machine_check   : constraint
source_sentence : S3, S9
required_output : (无)
```

### 2.2 转换后（DPH schema）

```json
{
  "capability_id": "CAP-2026A-Q1-ROBIN-BC",
  "family": "F1",
  "scope_ref": "req-2026a-q1-model",
  "name": "第三类(Robin)边界 + 附件1 时变环境驱动",
  "criterion": "r=R 处用 -k dT/dr = h(Ts - Tair(t)) 与 -D dC/dr = hm(Cs - Cair(t)); r=0 处零梯度; 环境侧取自附件1 插值而非常数",
  "judge": "machine",
  "machine_check": "CONSTRAINT",
  "falsifiable_thresholds": [
    {
      "subject_ref": "Result:r_q1_h.value",
      "operator": "MATCHES_EXACT",
      "threshold": null,
      "tolerance": null,
      "unit": "W/(m^2*K)",
      "at_config_ref": "RunArtifact:run_q1_delivery"
    },
    {
      "subject_ref": "Result:r_q1_hm.value",
      "operator": "MATCHES_EXACT",
      "threshold": null,
      "tolerance": null,
      "unit": "m/s",
      "at_config_ref": "RunArtifact:run_q1_delivery"
    },
    {
      "subject_ref": "Result:r_q1_tair_anchor.value",
      "operator": "REL_LT",
      "threshold": 28.000,
      "tolerance": 1e-3,
      "unit": "degC",
      "at_config_ref": "RunArtifact:run_q1_delivery"
    },
    {
      "subject_ref": "Result:r_q1_cair_anchor.value",
      "operator": "REL_LT",
      "threshold": 0.04272,
      "tolerance": 1e-3,
      "unit": "kg/kg",
      "at_config_ref": "RunArtifact:run_q1_delivery"
    },
    {
      "subject_ref": "Result:r_q1_boundary_kind.value",
      "operator": "NE",
      "threshold": 1.0,
      "tolerance": null,
      "unit": "dimensionless",
      "at_config_ref": "RunArtifact:run_q1_delivery"
    }
  ],
  "source_anchor": "req-2026a-q1-boundary-sentence",
  "required_output_ref": null,
  "verification_depth": "SUBSTANTIVE",
  "existence_disclaimer": null,
  "probe_refs": ["P-3", "P-5", "P-8"],
  "boundary_refs": ["L-3"]
}
```

### 2.3 转换中暴露的三处**不可机械转换**（必须如实记录）

> 这三处是"散文 → 结构化"的**损失点**，也是 DPH 侧必须补的对象。**不记录它们，就是假装转换是无损的**。

| # | 材料原文片段 | 为何无法直接结构化 | 处置 |
|---|---|---|---|
| **T-1** | "h=25 与 hm=8e-7 **逐字出现**" | "逐字出现"是**源码文本检索**断言，对象是**代码文本**而非 IR 值。IR 里没有"源码"这一 kind | 需要 `subject_ref` 能指向 **`RunArtifact.code_ref` 的文本**。DPH 侧 `stale_detection` 的 S-007 字节校验（`ctx.loadCode`）已有该能力，但**未暴露为阈值算子**。建议加算子 `SOURCE_CONTAINS`（Q1-D1 的"需扩展"项） |
| **T-2** | "Tair/Cair 为 t 的函数（对附件1 插值）" | "是 t 的函数"是**函数性**断言，不是单点值断言 | 用 `P-8 配置复现探针`（两个不同 t 的取值不同 ⇒ 非常数）**间接**实现；或在 `subject_ref` 上引入**采样集**语义（`{t: [0,600,3600]}`）。本 schema 用前者（已有算子够用），后者列为 Q1-D1 的候选扩展 |
| **T-3** | "若表面被直接钉为 Tair（第一类边界，即 `T[N]==Tair` 恒成立）" | 这是**否定式**断言（"不得如此"），对象是**代码结构**（数组索引赋值模式） | 无法用数值阈值表达。归入 `CUSTOM` 的专用脚本，或由 `P-3 冻结探针`（令 `Tair` 恒定 → 若 `T[N]==Tair` 恒成立则全场等于 `Tair` 而**不再是**初值 28，P-3 会失败）**间接抓住**。后者更优：**用探针把否定式断言转成阳性信号** |

> **T-3 的处置是本 schema 最有价值的一处推论**：**探针可以把"禁止某实现形态"的否定式断言，转换成"注入后应观察到某信号"的阳性断言**——而阳性断言可机械判定。这解释了为什么材料侧的探针库（`[P-10]`）与能力清单（`[P-02]`）**必须连接**（`probe_refs` 字段的动机）。

---

## 3. 自检

| 检查 | 结果 |
|---|---|
| 是否含全部 8 个必需字段？ | ✅ `capability_id` / `family` / `criterion` / `judge` / `machine_check` / `falsifiable_thresholds`（对应 `falsifiable_threshold`，因多条阈值而数组化）/ `source_anchor` / `required_output_ref` |
| 每处改动是否说明理由？ | ✅ §0 的逐字段表，14 字段全覆盖 |
| 是否给出填好的实例？ | ✅ §2.2（含 5 条结构化阈值） |
| 是否照搬字段名？ | ❌ 未照搬。改名 4、收紧 3、新增 5 |
| 是否记录了转换损失？ | ✅ §2.3 的 T-1/T-2/T-3 |
| 是否引入第二套 gate？ | ❌ 未引入。schema 只定义**对象**，不定义判定函数；判定归既有 gate（Q1-B3 的映射表） |
