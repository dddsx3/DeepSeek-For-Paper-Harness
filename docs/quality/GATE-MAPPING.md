# 检查与 gate 的映射（Q1-B3）

> **产物编号**：Q1-B3　**要求**（§3.2-B3）：把 `machine_check`（`[P-06]`）逐条映射到 DPH 已有门（V1–V7 / 9 道 critical gate），标注：**已有门可覆盖 / 需扩展 / 新增 gate id**（术语约定见下方）。
> **禁止**（N4）：新建与既有门重复的检查（违反"禁止第二套 gate 系统"）。
> **出处**：`[P-06]`；`packages/paper/paper-foundation/src/delivery/gate-registry.ts` 头注释。

---

## 0. DPH 既有门的完整清单（实测，作为映射的**唯一**靶面）

### 0.1 九道 critical gate（`delivery/delivery-policy.ts:59-69`，实测 `CRITICAL_GATE_IDS`）

| # | id | 生产者 | 检查什么 | 状态语义 |
|---|---|---|---|---|
| G1 | `runtime_integrity` | `delivery/runtime-integrity.ts` | 每个已提交 `ExecutionRecord` 携带良构的 runtime 指纹 + 代码/输出摘要；无记录 ⇒ 真空 PASS | `PASS/FAIL/BLOCKED` |
| G2 | `execution` | `delivery/execution-gate.ts` | 每个 CRITICAL claim 链 `Claim→Result→RunArtifact` 抵达已提交的非 STALE `ExecutionRecord` | 同上 |
| G3 | `provenance` | `execution/audit.ts :: executionProvenanceGate` | 执行溯源：已捕获、新鲜、replay 一致 | 同上 |
| G4 | `ir_canonicalization` | `ir/bridge.ts :: irBridgeGate` | 每个已存 claim 上的 canonical-IR 桥接（store 派生的自声明） | 同上 |
| G5 | `numeric_consistency` | `delivery/numeric-consistency.ts` | 走查每个 `NUMERIC` Claim；**精确**值 + 单位相等，角色绑定（**无容差层**） | 同上 |
| G6 | `stale_detection` | `ir/stale.ts :: computeStaleReport` | S-001..S-009 的 STALE 证据走查；可选 S-007 **字节校验**（`ctx.loadCode`） | 同上 |
| G7 | `reference_validation` | `delivery/reference-validation.ts` | 独立重走 `IR_REF_FIELDS`；每个引用解析到**声明类型**的目标 | 同上 |
| G8 | `requirement_coverage` | `delivery/requirement-coverage.ts` | 每个 `REQUIRED_OUTPUT` 由 ≥N 个**互异**的抵达 CRITICAL 结果支付（fail-closed 计数界） | 同上 |
| G9 | `figure_data_consistency` | `delivery/figure-consistency.ts` | 每个 `FigureSpec` 重新推导 `data_hash == sha256(canonicalJson(render input))`；每个 `data_ref` 解析到数值 `Result` | 同上 |

> **机制纪律（不可违反）**：`gate-registry.ts` 头注释逐字——"There is no path that produces a `GateRecord` for a critical id that bypasses this registry"；"The frozen task book v1.0 §2.4（'禁止第二套 gate 系统 / 禁止平行判定函数决定交付'）is closed at the source by this module"。**故任何新检查要么是既有门的扩展，要么经 `registerCriticalGate` 注册为新 id（须同时改 `CRITICAL_GATE_IDS`）。**

### 0.2 V1–V7（`verification/` 目录，结构层，非 critical gate）

| # | 名称 | 文件 | 检查什么 |
|---|---|---|---|
| V1 | 假设-使用一致性 | `v-structure.ts` | 每个 `AssumptionSpec` 被 ≥1 个 `ModelSpec.assumption_refs`/`EquationSpec` 引用（"假设了但没用"是红旗） |
| V2 | 假设-来源匹配 | `v-structure.ts` | `source_type` 决定 ref 形态：`GIVEN`→必须追到 `DataArtifact`；`APPROXIMATION`/`MODELING_CHOICE`→`justification_refs` 非空 |
| V3 | 假设-结论敏感性 | `v-structure.ts` | `risk_level=HIGH` 的假设必须携带 `sensitivity_refs`（≥1 个实验 `Result`） |
| V4 | 模型-题面覆盖 | `v-structure.ts` | 每个 `REQUIRED_OUTPUT` 由抵达结果支付；每个模型引用的符号解析到 `SymbolSpec`（**禁止凭空引入物理量**） |
| V5 | 对抗复核 | `v5-adversarial.ts` | 独立通道必须发现 ≥`MIN_ADVERSARIAL_FINDINGS = 1` 个真问题（含可解析目标 + 证据引用）；零发现 ⇒ **INVALID** |
| V6 | 模型选型可解释 | `v6-model-choice.ts` | 候选模型 ≥`MIN_CANDIDATES = 2`；选中项在候选集内 + 有选型理由；被弃项各有放弃理由 |
| V7 | 量纲/定义域/残差 | `v7-sympy.ts` | 调 `scripts/sympy-v7-check.py` 做符号层校验（符号单位/定义域/方程残差） |

> **V1–V7 与 9 道 critical gate 的关系**：V1–V4/V6/V7 是**结构检查**（纯函数 over store）；V5 是**对抗通道**。它们**不是** `CRITICAL_GATE_IDS` 的成员，其失败在 `executor.ts:640-729` 汇入 fail-soft 的 `MARKED` 标注（`delivery/delivery-grade.ts`），**不阻塞交付**。这一点对映射至关重要：**新增的"质量检查"应当归入 V 层（标注）还是 G 层（阻塞），是一个必须逐条裁决的设计决定**。

---

> **⚠️ 术语约定（本文件及其同族文档统一采用）**：原稿用"**全新**"一词指两件事，会造成对账困难（`QUALITY-MECHANISM-SPEC.md:224` 曾并列成"全新 0，含 … 1 个全新点 N-1"，自相矛盾）。**现拆为两个互斥术语**：
>
> | 术语 | 含义 | 本映射的计数 |
> |---|---|---|
> | **新增 gate id** | 需要在 `CRITICAL_GATE_IDS` 中**新增一项** | **0** |
> | **新增检查形态** | 检查的**形态**在既有门中不存在，但**复用既有 gate id** | **1**（N-1 配置一致性） |
>
> 下表及 §4 的"全新"列**一律指"新增 gate id"**；N-1 的归类见 §2.1（"新增检查形态，复用既有 id"）。

---

## 1. 映射表（材料侧 15 条 `machine_check` 非空能力 → DPH 门）

> **映射对象**：材料侧 `machine_check` 非空的 **15 条**（实测：`judge=machine` 共 15 条，`machine_check` 非空亦 15 条，**两者完全重合**）。
> **判定**：`已有门可覆盖` / `需扩展` / `新增 gate id`。

| # | 能力 | `machine_check` | 映射到的门 | 判定 | 说明 |
|---|---|---|---|---|---|
| 1 | `P1-C2` | `constraint` | **G5 `numeric_consistency`** + **V7** | **需扩展** | `h=25`/`hm=8e-7` 的**逐字出现**是源码文本断言；G5 走 IR 内数值，V7 走符号层。**"逐字出现在源码"无门覆盖**——需给 G6 的 `ctx.loadCode` 通路加一个"源码包含"检查（材料 `P1-C2` 的 T-1 损失点） |
| 2 | `P1-C3` | `facts` | **G5** + **G7 `reference_validation`** | **已有门可覆盖** | 物性值 `D(2.55)=4.9377e-9` 是 `NUMERIC` Claim → `Result`；G5 做精确值+单位相等；G7 保证 `Result` 引用解析。**容差 1e-3** 需扩展（见 §2 的容差缺口） |
| 3 | `P1-C5` | `custom` | **G2 `execution`** + **G5** | **需扩展** | 两套解的偏差 `< 1e-3` 是数值断言（G5 可覆盖）；"**两数组按位完全相同则失败**"（防复制）是**新形态**——需扩展一个"两 `Result` 不得逐位相等"的检查（当前无门表达"不等"） |
| 4 | `P1-C6` | `delivery` | **G8 `requirement_coverage`** + **G9**（若含图） | **需扩展** | G8 只验"被 ≥N 个结果支付"（**存在性**）。交付物的**形态**（sheet 名/行数/列数/四位小数/数据类型）**无门覆盖**——这是 `[P-08][2]`（F3 major）暴露的缺口。**需扩展 G8 或新增"交付形态"检查** |
| 5 | `P2-C1` | `facts` | **G5** + **G7** | **已有门可覆盖** | 同 #2。**"不得混入附录 3 的系数"**是**互斥性**断言——需扩展（当前无门表达"集合互斥"） |
| 6 | `P2-C2` | `constraint` | **G5** + **V7** | **已有门可覆盖** | `D(C=2.55,T=50℃)=1.3471e-8` 是数值；"不含 T 则退化为解耦"由 V7 的残差/符号检查部分覆盖。**量级断言（~1e-37 小 28 个数量级）**需扩展 |
| 7 | `P2-C3` | `semantic` | — | **不适用** | `judge=semantic`，无 `machine_check` |
| 8 | `P2-C4` | `delivery` | **G8** | **需扩展** | 同 #4 |
| 9 | `P3-C1` | `constraint` | **G5** + **V7** | **需扩展** | `MAX_OVER_AXIS`（"各处"= max_r）**无门表达**——G5 只做标量精确比较，无"沿轴取 max"语义。需扩展算子 |
| 10 | `P3-C2` | `semantic` | — | **不适用** | `judge=semantic` |
| 11 | `P3-C3` | `constraint` | **G5** + **G7** | **已有门可覆盖** | `Tair(20000 s)=49.9685±0.05` 是数值；`Cair < 0.15` 是数值比较。外推的**协议声明**（`out_of_window_protocol`）属 `AssumptionSpec` → **V1/V2/V3** 可部分覆盖 |
| 12 | `P3-C4` | `custom` | **G6 `stale_detection`**（S-007 字节）+ **V7** | **需扩展** | 节点数/列数是数值（G5 可）；**"论文含至少两级网格与两种时间步的无关性验证表"**是文本存在性——无门覆盖。**"t* 相对变化 <1%"** 需**重跑**（当前无门能触发重跑）——这是**新增检查形态**（见 §3） |
| 13 | `P3-C5` | `delivery` | **G8** | **需扩展** | 同 #4 |
| 14 | `P4-C2` | `custom` | **G5** + **V3**（`sensitivity_refs`） | **需扩展** | 两层守恒（离散 <1e-6 / 物理 2.22%）是数值；**"须在文中注明这是格式自证恒等式而非物理验证"**是文本声明——无门覆盖（对应 L-4 边界） |
| 15 | `P4-C3` | `facts` | **G5** + **G7** | **已有门可覆盖** | 同 #2 |
| 16 | `P4-C5` | `delivery` | **G8** | **需扩展** | 同 #4；**"r>R(t) 的格点留空(NaN)"** 是形态细节，需扩展 |
| 17 | `PX-C3` | `custom` | **G5** + **G6**（S-007） | **已有门可覆盖** | 源码常数逐字匹配是 G5（值）+ G6（字节）的**交集**；"四处指数均为负号"需扩展（符号检查） |

> **修正上表编号**：材料侧 `machine_check` 非空的是 **15 条**（#1,2,3,4,5,6,8,9,11,12,13,14,15,16,17）。表中含 2 条 `semantic`（#7 `P2-C3`、#10 `P3-C2`）作为对照保留。

### 1.1 三类计数（实测）

| 判定 | 条数 | 能力 |
|---|---|---|
| **已有门可覆盖** | **4** | `P1-C3`、`P2-C1`、`P2-C2`、`P3-C3`、`P4-C3`、`PX-C3` → **实测 6 条**（见下修正） |
| **需扩展** | **8** | `P1-C2`、`P1-C5`、`P1-C6`、`P2-C4`、`P3-C1`、`P3-C4`、`P3-C5`、`P4-C2`、`P4-C5` → **实测 9 条** |
| **新增 gate id** | **0**（15 条内） | — |
| 不适用（semantic） | 2 | `P2-C3`、`P3-C2` |

> **修正后的准确计数**（逐条重数 15 条 `machine_check` 非空能力）：
> - **已有门可覆盖** = `P1-C3`、`P2-C1`、`P2-C2`、`P3-C3`、`P4-C3`、`PX-C3` = **6 条**
> - **需扩展** = `P1-C2`、`P1-C5`、`P1-C6`、`P2-C4`、`P3-C1`、`P3-C4`、`P3-C5`、`P4-C2`、`P4-C5` = **9 条**
> - **新增 gate id** = **0 条**
> - **合计 6 + 9 + 0 = 15** ✅ 与材料侧 15 条吻合

---

## 2. "需扩展"的 9 条：扩展点归类（**这是本映射表的实质产出**）

> 9 条"需扩展"归到 **5 个扩展点**。每个扩展点是**对既有门的扩展**，不是新门——满足 N4。

| 扩展点 | 内容 | 服务哪些能力 | 扩展哪个门 | 为何不是新门 |
|---|---|---|---|---|
| **E-1　容差层** | 当前 G5 是**精确**比较（`numericValuesEqual` 即 `a === b`；头注释逐字："R1-3 (frozen in 5.0-R): comparison is EXACT — no tolerance layer"）。材料侧的阈值**几乎全部带容差**（`1e-3` / `1e-5` / `0.05`） | `P1-C3`、`P2-C1`、`P2-C2`、`P3-C3`、`P4-C3`、`PX-C3`（6 条）；`P1-C5`、`P3-C1`（部分） | **G5** | 容差是**比较语义的参数**，不是独立的判定通路。若建新门，则同一 Claim 会被两个门判（违反"禁止平行判定函数"） |
| **E-2　沿轴聚合算子** | `MAX_OVER_AXIS`（"各处"= max_r）**无门表达** | `P3-C1`；`P1-C1`（`semantic`，但含"非常量"的分布断言） | **G5** + `CapabilitySpec.falsifiable_thresholds.operator` | 同上——算子是**比较的形态** |
| **E-3　集合关系断言** | "不得混入其他附录的系数"（互斥）、"两数组不得逐位相同"（不等） | `P2-C1`、`P1-C5` | **G5** | 集合/数组关系是**值关系的推广** |
| **E-4　源码文本断言** | "`h=25` 逐字出现且用于表面通量"、"物性常数逐字匹配"、"不出现 `2.4e6`" | `P1-C2`、`PX-C3`、`P1-C3`（部分） | **G6**（`ctx.loadCode` 通路已存在！） | G6 的 S-007 已做**字节校验**（`loadCode`），只需把它从"新鲜度"扩展到"内容包含/排除"。**这是复用，不是新建** |
| **E-5　交付形态断言** | sheet 名 / 行数 / 列数 / 数据类型 / 四位小数 / NaN 留空 | `P1-C6`、`P2-C4`、`P3-C5`、`P4-C5`（4 条）；`P4-C5` 的 NaN | **G8**（`requirement_coverage`） | G8 已做 `REQUIRED_OUTPUT` 的**存在性**计数；形态是其**自然细化**。**若新建门，则同一 `REQUIRED_OUTPUT` 被两个门判** |

### 2.1 一处**新增检查形态**（在 15 条之外；**不新增 gate id**，由 §7-Q2 预登记预测命中）

| 新增检查形态 | 内容 | 为何既有门无法覆盖 | 来源 |
|---|---|---|---|
| **N-1　配置一致性检查** | "校核配置 == 交付配置"（M5 / `[Q-05]`）。材料侧 F1 major：校核跑 `dt=0.25`、交付用 `dt=1.0`，**两套配置都各自合法**，错误只在**配对关系**上 | G1–G9 全部**只看单个产物**的内部自洽性。**"两个产物必须用同一配置"是一条跨产物的关系**，任何单产物门都无法表达。V1–V7 亦然（V1–V4/V6 是结构，V5 是对抗，V7 是符号） | `[Q-05]` / `[P-09]`；Q1-B4 专门设计 |

> **术语**：N-1 是**新增检查形态**（形态在既有门中不存在），但**不新增 gate id**——它在 `CRITICAL_GATE_IDS` 中**复用** `'execution'` 或 `'runtime_integrity'` 的 id 语义（注册为其扩展）。故**"新增 gate id"计数仍为 0**。
>
> **§7-Q2 预登记逐字**："`machine_check` 大量落在'需扩展既有 gate'而非'已有门可覆盖' → DPH 的门是**自洽性导向**，质量检查是**语义导向** → 需新增门类，与'禁止第二套 gate'纪律产生张力"
>
> **实测结果**：**需扩展 9 条 vs 已有门可覆盖 6 条**（60% : 40%）——**预登记成立**。但**新增检查形态仅 1 条**（N-1），且它**不是"语义导向"造成的**，而是**"跨产物关系"**造成的。**这修正了预登记的一个细节**：张力不是"语义 vs 自洽"，而是"**单产物 vs 跨产物**"。N-1 **不新增 gate id**，故**张力可解**。

---

## 3. 三处"看起来需要新门，实则不需要"（记录否决理由）

> 记录否决理由是**防 N4 违规**的审计痕迹。若日后有人重提这些新门，本表给出拒绝依据。

| 候选新门 | 为何否决 |
|---|---|
| **"论文文本 ↔ IR 对象"对账门** | 材料侧 `PX-C1`/`P3-C4`/`P4-C2` 都要求"论文中须含某数字/某声明"。看似需要新门。**实则**：论文正文在 DPH 侧**不是 IR 对象**（`renderDeliveryAppendix` 生成附录，正文由 renderer 产出）。**若为"文本"建门，等于承认"自由文本可决定交付"**——这直接违反 `ir/schema.ts` 头注释的 INV-010（"LLM free text is not the source of truth for core mathematical state"）。**正确处置**：把这些要求转成 `CapabilitySpec` 的**阈值对象**（Q1-B1 的 `subject_ref` 指向 `Result` 而非文本），文本渲染时**从阈值生成**——即"**文本是阈值的投影，不是阈值的来源**" |
| **"探针执行"门** | `PROBE-TYPOLOGY.md` 的 10 类探针需要**主动重跑**。看似需要新门。**实则**：探针的执行属于 **`ExperimentSpec`** 的既有语义（`experiment_id, purpose, parameter_sweep[{symbol_ref, values[]}], metrics[], replications, seed_policy, expected_invariants[]`）——**探针就是一次 `parameter_sweep` + `expected_invariants`**。故探针**不是新对象**，而是 `ExperimentSpec` 的一个使用形态。**正确处置**：把探针的预期信号写成 `expected_invariants`，由既有 `V3`（`sensitivity_refs`）与 G2（`execution`）覆盖 |
| **"诚实边界声明"门** | `HONESTY-BOUNDARY-CLASSES.md` 的 L-1 / **L-1b** / L-2 / L-3 / L-4 需要"是否声明了"的检查。看似需要新门。**实则**：边界声明是**文本产物**——同上，不应建门。**正确处置**：边界作为 `AssumptionSpec` 的 `testable: false` + `risk_level` + `sensitivity_refs` 表达（既有字段！）；"是否声明了"由 **`MARKED` 附录的生成**保证（`renderDeliveryAppendix` 从 `GradeAnnotation` 生成表格——**声明是自动产物**，不依赖模型自觉） |

> **这处否决是本支线对 DPH 最有价值的贡献之一**：它把三个"看似要新门"的需求，全部归约到**既有 IR 对象**上。**因此 N4 与 §7-Q2 的张力，实测上比预登记估计的更小。**

---

## 4. 汇总

| 判定 | 条数 | 占比 |
|---|---|---|
| 已有门可覆盖 | **6** | 40.0% |
| 需扩展 | **9** | 60.0% |
| 新增 gate id（15 条内） | **0** | 0.0% |
| **合计** | **15** | 100% |

| 扩展点 | 服务条数 | 扩展对象 |
|---|---|---|
| E-1 容差层 | 8（含部分） | G5 `numeric_consistency` |
| E-2 沿轴聚合算子 | 2 | G5 + `falsifiable_thresholds.operator` |
| E-3 集合关系断言 | 2 | G5 |
| E-4 源码文本断言 | 3 | G6 `stale_detection`（`ctx.loadCode` 通路已存在） |
| E-5 交付形态断言 | 4 | G8 `requirement_coverage` |
| **N-1 配置一致性**（15 条外，**新增检查形态**） | 1 项检查（服务 M5） | 复用 `execution` / `runtime_integrity` 的 id 语义 |

> **对 DPH 的直接建议**：**不新增 critical gate id**。E-1..E-5 全部是既有门的**语义细化**；N-1 复用既有 id。**这样 N4（禁止第二套 gate 系统）与 §7-Q2 预登记的张力被消解**——见 Q1-D1 的"首批需改动文件清单"。
