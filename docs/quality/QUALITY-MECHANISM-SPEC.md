# QUALITY-MECHANISM-SPEC — 质量识别的机械化（Q1-D1）

> **产物编号**：Q1-D1　**要求**（§3.4-D1）：含机制完整描述、与 DPH 既有 IR/gate 的接缝、需新增对象（若有）、**首批需改动文件清单（预估，不实施）**。
> **禁止**（N5）：**本轮实施代码改动**。本文件是**规格**，不是补丁。
> **基线**：DPH `8915028361`（W8.8）　**编制**：2026-09-17　**出处规则**：`[F-nn]` 文件 / `[P-nn]` 字段 / `[Q-nn]` 行号

---

## §0 一句话

**质量不可直接量化，但"降维/退化"可枚举。识别质量 = 检测其缺失。**

机制的四步（`[P-01]` + `[P-03]` + `[P-10]` + `[P-11]`）：

```
① 枚举该族题型的"降维高发区"                 ← FAMILY-DEGRADATION-LISTS.md
② 为每条能力写死一个结构化可证伪阈值（含算子 + 阈值 + 触发即 raise）
                                             ← CAPABILITY-SCHEMA.md
③ 用探针做差分/变异实验（注入已知错误，看是否被抓）
                                             ← PROBE-TYPOLOGY.md
④ 显式列出诚实边界（不可判定项），不做假绿     ← HONESTY-BOUNDARY-CLASSES.md
```

**这个反转是关键**：不回答"这份建模好不好"，而回答"**这份建模有没有犯这类题最典型的退化**"。

---

## §1 机制完整描述

### 1.1 对象模型（4 个新 IR 对象 + 3 个扩展）

> **设计纪律**：**能扩展既有对象的一律扩展**（N4 禁止第二套 gate；同理，不新增与既有对象语义重叠的对象）。下面的"新对象"仅在**既有对象无法承载**时才提出，并逐条给出"为何不能复用"。

| # | 对象 | 类型 | 必要性 | 为何不能复用既有对象 |
|---|---|---|---|---|
| **O-1** | **`CapabilitySpec`** | **新 IR kind**（第 16 个） | 能力清单的载体 | `ProblemSpec` 在 TASK 1.5 已**刻意删除**嵌套自由文本（`ir/schema.ts` 头注释逐字："leaving a definition behind, even an unused one, is the seed of a second source of truth"，INV-1.5-F）。能力清单若嵌套进去会重犯该错误。**且** `RequirementSpec` 描述"题面要求什么"，`CapabilitySpec` 描述"该族该有的能力及如何判定"——**语义不同**（§1.3 讨论与 Q5 预登记的关系） |
| **O-2** | **`NumericConfig`** | **新 IR kind**（第 17 个） | 数值配置的载体（M5） | **实测**：`dt`/`N`/`solver_config` 在 `ir/` 下 **0 命中**；`RunArtifact.environment` 是 `textSchema`（自由文本），比较会退化为字符串比较（误报 `"dt=0.25"` vs `"dt=0.250"`，漏报无法逐字段对齐）；`ExecutionRecord.environment_hash` 只存指纹（无法报"差在哪"，而标注必须给出两侧具体数值）。详见 `CONFIG-CONSISTENCY-CHECK.md` §3.1 |
| **O-3** | **`BoundaryDeclaration`** | **新 IR kind**（第 18 个） | 诚实边界"是否声明了"的可检查载体（N6） | 边界的**对象**是 IR 对象（`AssumptionSpec`/`DataArtifact`/`Result`），但边界的**声明**需要"槽位值 + 生成位置"。`AssumptionSpec.testable=false` 可表达"不可检验"，但**无法表达"声明在交付物的哪一节"与"槽位值是多少"**（如 L-4 的"代价指标 = 2.22%"） |
| **O-4** | **`CapabilityProbe`** | **扩展 `ExperimentSpec`**（**非新对象**） | 探针的载体 | **探针就是一次 `parameter_sweep` + `expected_invariants`**（`ir/contract-objects.ts` 的 `ExperimentSpec` 已有这两个字段）。**否决新建**（见 `GATE-MAPPING.md` §3） |
| **O-5** | **`falsifiable_thresholds`** | **扩展 `CapabilitySpec` 的字段** | 结构化阈值 | 材料侧的 `falsifiable_check` 是**散文**（不能被机械执行）。散文 → 结构化三元组 `{subject_ref, operator, threshold, tolerance, unit, at_config_ref}` 是本机制的核心改动 |
| **O-6** | **`verification_depth` + `existence_disclaimer`** | **扩展 `CapabilitySpec` 的字段** | 存在性/实质分离（`[F-04]`/`[Q-15]`） | 材料的做法是"交付能力不出现在裁定文件里"（`[F-03]` 19 条 vs `[F-02]` 23 条）。**DPH 侧不可照抄**：`requirement_coverage` 门要求每个 `REQUIRED_OUTPUT` 被支付，若从 IR 消失则判"未覆盖"⇒ **阻塞**。故必须**字段化**（`JUDGE-CRITERIA.md` §4.3 的 A-1） |
| **O-7** | **`probe_refs` + `boundary_refs`** | **扩展 `CapabilitySpec` 的字段** | 连接探针库与边界类 | 材料侧的探针库（`[P-10]`）与能力清单（`[P-02]`）**无字段连接**——这是探针库出现**空位**的结构原因（`PROBE-TYPOLOGY.md` §2 识别出两处空位）。字段化后，"某能力无探针覆盖"成为**可查询事实** |

**对象计数**：新 kind **3 个**（`CapabilitySpec` / `NumericConfig` / `BoundaryDeclaration`），扩展 **4 处**（`ExperimentSpec` 复用 + 3 个字段组）。**IR kind 从 15 → 18。**

### 1.2 数据流（端到端）

```
                        ┌──────────────────────────────────────┐
   题面 ──► RequirementSpec ──► CapabilitySpec（按族枚举）        │
                        │   ├ criterion（人读，不进 gate）        │
                        │   ├ falsifiable_thresholds（结构化）    │
                        │   ├ source_anchor ──► RequirementSpec   │
                        │   ├ probe_refs ──► ExperimentSpec       │
                        │   └ boundary_refs ──► BoundaryDeclaration│
                        └──────────────────────────────────────┘
                                        │
   求解 ──► RunArtifact ──► NumericConfig（本次配置）              │
              │                 │                                │
              │                 └──► 比对：校核配置 vs 交付配置（M5）│
              ▼                                                  │
        ExecutionRecord ──► 探针执行（ExperimentSpec 的 sweep）    │
              │                                                  │
              ▼                                                  │
           Result ──► Claim（CRITICAL）                          │
              │                                                  │
              ▼                                                  │
    ┌─────────────────────────────────────────────┐              │
    │ 9 道 critical gate（既有，扩展 E-1..E-5）      │◄─────────────┘
    │  + V1–V7（既有，V5 扩展 CE-1/2/3）            │
    └─────────────────────────────────────────────┘
              │
              ▼
    GradeDecision（CLEAN / MARKED / BLOCKED）
              │
              ├──► renderDeliveryAppendix（MARKED 附录，条件生成）
              └──► BoundaryDeclaration 渲染（**无条件生成**）
```

### 1.3 与 `RequirementSpec` 的关系（**§7-Q5 预登记的裁决**）

> §7-Q5 预登记逐字："能力清单与 DPH 的 `RequirementSpec` 语义重叠 → 两者都在描述'题目要求什么' → 可能是同一对象的两种表述，应合并而非新增"

**实测裁决**：**不合并，但必须建立引用关系。**

| 维度 | `RequirementSpec` | `CapabilitySpec` |
|---|---|---|
| 描述什么 | **题面要求什么**（"问题 1 要求设计抽样方案"） | **该族该有的能力及如何判定**（"抽样方案须给出 `n` 与 `c` 的具体数值，且不得抄题面"） |
| 来源 | **题面**（`source_data_ref` + `source_span`） | **族的知识**（`FAMILY-DEGRADATION-LISTS.md` 的枚举） |
| 跨题性 | **题内**（每道题一组） | **跨题**（同一族复用） |
| 判定通道 | `requirement_coverage` 门（覆盖计数） | `falsifiable_thresholds`（算子断言） |
| 数量关系 | 1 题 → N 条 | 1 族 → M 条（**M 与 N 无固定关系**） |

> **裁决理由**：若合并，则 `RequirementSpec` 需同时承载"题面原句"与"族的知识"——**这两个来源不同**（前者来自题面，后者来自族契约）。合并会使 `RequirementSpec.source_span` 的语义失效（族的知识**不在题面里**）。
>
> **但预登记的直觉是对的**：二者确实**都在描述要求**。**故用 `source_anchor` 建立引用**：`CapabilitySpec.source_anchor → RequirementSpec`（能力锚定到它回应的题面要求）。**这是"分层"而非"合并"**——`RequirementSpec` 是题面层，`CapabilitySpec` 是族层，`source_anchor` 是层间的引用。

### 1.4 与既有 `FamilyContract` 的关系（**避免重复**）

> **关键发现**：DPH **已有** `FamilyContract`（`apps/paper-shell/src/contracts/{types,f3,f4,index}.ts`），其字段与 `CapabilitySpec` 有**部分重叠**：

| `FamilyContract` 字段 | `CapabilitySpec` 对应 | 关系 |
|---|---|---|
| `family` | `family` | 同 |
| `candidate_models` | — | `FamilyContract` 独有（**候选模型集**，能力清单不涉及） |
| `required_assumptions` | — | `FamilyContract` 独有（**必需假设集**） |
| `validate(input) → ContractFinding[]` | `falsifiable_thresholds` | **重叠区**：两者都是"该族的专项验证规则" |
| `figure_types` | — | `FamilyContract` 独有 |
| `not_applicable` | — | `FamilyContract` 独有 |
| `cost_hours` | — | `FamilyContract` 独有 |
| — | `source_anchor` | `CapabilitySpec` 独有（**锚到题面**） |
| — | `judge` / `machine_check` | `CapabilitySpec` 独有（**判定通道分流**） |
| — | `verification_depth` | `CapabilitySpec` 独有（**存在性/实质分离**） |

> **故 `CapabilitySpec` 与 `FamilyContract.validate` 的关系必须明确**（否则是第二套判定函数，违反 N4）：

| | `FamilyContract.validate` | `CapabilitySpec.falsifiable_thresholds` |
|---|---|---|
| 位置 | `apps/paper-shell/src/contracts/*.ts`（**shell 层**，TypeScript 函数） | IR（**canonical 状态**） |
| 输入 | 一个 `Record<string, unknown>`（声明对象） | `subject_ref` 指向的 IR 对象 |
| 判定 | 返回 `ContractFinding[]`（`ok: boolean`） | 算子比较（`raise` 或 pass） |
| 何时跑 | 建模时（**前置**，指导模型） | 交付时（**后置**，判定产物） |
| 覆盖 | F3/F4 的 **5 条**（实测 `f3.ts` 5 条、`f4.ts` 5 条） | 全族（2024-B 上 38 条阈值） |

> **裁决**：**二者是"前置指导"与"后置判定"的分工，不是重复。** 但**必须建立映射**（避免同一件事被两处判定）：`FamilyContract.validate` 的每条 `rule` 应能对应到一个 `CapabilitySpec`。**若某 `rule` 无对应能力，说明契约有孤儿规则；若某能力无对应 `rule`，说明它是新增检查**（须按 `GATE-MAPPING.md` 的三类计数登记）。

---

## §2 与 DPH 既有 IR / gate 的接缝

### 2.1 接缝清单（**逐点，含文件路径**）

| # | 接缝 | 既有载体 | 改动类型 | 详见 |
|---|---|---|---|---|
| **S-1** | 新 kind 注册 | `ir/schema.ts` 的 `IR_KINDS` / `IrObjectMap` / `IR_SCHEMAS` / `ID_FIELD_BY_KIND`；`ir/index.ts` 桶导出 | **扩展**（5 处表） | `CAPABILITY-SCHEMA.md` §1.1 |
| **S-2** | 新引用登记 | `ir/refs.ts` 的 `IR_REF_FIELDS` / `IR_SCOPE_FIELDS` | **扩展**（`source_anchor`→`RequirementSpec`、`required_output_ref`→`RequirementSpec`、`at_config_ref`→`RunArtifact`、`config_ref`→`NumericConfig`） | `CAPABILITY-SCHEMA.md` §1.1 |
| **S-3** | 容差层 | `delivery/numeric-consistency.ts`（**实测**：头注释逐字 "comparison is EXACT — no tolerance layer"） | **扩展**（E-1） | `GATE-MAPPING.md` §2 |
| **S-4** | 沿轴聚合算子 | 同上（`MAX_OVER_AXIS` 无表达） | **扩展**（E-2） | 同上 |
| **S-5** | 集合关系断言 | 同上（`NE` / 互斥无表达） | **扩展**（E-3） | 同上 |
| **S-6** | 源码文本断言 | `ir/stale.ts` 的 S-007 字节校验 + `GateContext.loadCode`（**已存在**） | **扩展**（E-4，把"新鲜度"扩到"内容包含/排除"） | 同上 |
| **S-7** | 交付形态断言 | `delivery/requirement-coverage.ts`（已做存在性计数） | **扩展**（E-5，细化到形态） | 同上 |
| **S-8** | 配置一致性 | `delivery/execution-gate.ts`（已走查 claim 链抵达 `ExecutionRecord`） | **扩展**（N-1：抵达后比对 `config_ref`） | `CONFIG-CONSISTENCY-CHECK.md` §3.3 |
| **S-9** | 复核独立性 | `verification/v5-adversarial.ts`（已有 `MIN_ADVERSARIAL_FINDINGS = 1`，即 CE-4） | **扩展**（CE-1/CE-2/CE-3） | `REVIEW-INDEPENDENCE.md` §2 |
| **S-10** | 边界声明渲染 | `delivery/delivery-grade.ts` 的 `renderDeliveryAppendix`（对 `CLEAN` 返回 `''`） | **扩展 + 一处修正**：边界声明必须**无条件生成**（与条件生成的 MARKED 附录**分离**） | `LIMITS-TEMPLATE.md` §2.1 |
| **S-11** | 审计事件 | `src/executor.ts:640-729` 的 `delivery_graded` | **扩展**（边界声明随 `GradeAnnotation` 进入审计） | 同上 |
| **S-12** | 族契约映射 | `apps/paper-shell/src/contracts/{index,f3,f4}.ts` | **扩展**（建立 `FamilyContract.validate` 的 `rule` ↔ `CapabilitySpec` 映射，防孤儿规则/重复判定） | §1.4 |

### 2.2 **不**接缝的地方（**明确不做**，防 N4）

| 不做 | 理由 |
|---|---|
| **不新增 critical gate id** | E-1..E-5 全部是既有门的**语义细化**；N-1 复用 `execution`/`runtime_integrity` 的 id 语义。**`CRITICAL_GATE_IDS` 保持 9 项**（`GATE-MAPPING.md` §4 的结论） |
| **不为"论文文本"建门** | 违反 `ir/schema.ts` 的 INV-010（"LLM free text is not the source of truth for core mathematical state"）。**文本是阈值的投影，不是阈值的来源**（`GATE-MAPPING.md` §3） |
| **不为"探针执行"建门** | 探针 = `ExperimentSpec` 的 `parameter_sweep` + `expected_invariants`（既有对象） |
| **不为"边界声明"建门** | 边界 = `BoundaryDeclaration` + 既有 `AssumptionSpec.testable/risk_level/sensitivity_refs` |
| **不改 `ProblemSpec`** | TASK 1.5 已定其形状（只有 `problem_id`/`raw_problem_ref`/`requirement_refs`）；能力清单**不嵌套**进去（O-1 的理由） |

---

## §3 首批需改动文件清单（**预估，不实施**）

> **纪律**（N5）：本轮**不实施**任何代码改动。本清单是**预估**，供主线在 W9 后决策。
> **统计**：**新增文件 8**、**修改文件 12**、**测试文件 5**。全部改动**不涉及 `[F-01]`**（N1）。

### 3.1 新增文件（8）

| # | 文件（预估路径） | 内容 | 依赖 |
|---|---|---|---|
| **N-1** | `packages/paper/paper-foundation/src/ir/capability-spec.ts` | `capabilitySpecSchema` + 闭集常量（`MACHINE_CHECK_KINDS` / `CAPABILITY_JUDGES` / `VERIFICATION_DEPTHS` / `THRESHOLD_OPERATORS`） | 无 |
| **N-2** | `packages/paper/paper-foundation/src/ir/numeric-config.ts` | `numericConfigSchema`（`discretization` / `physical` / `choices` / `property_set`） | 无 |
| **N-3** | `packages/paper/paper-foundation/src/ir/boundary-declaration.ts` | `boundaryDeclarationSchema` + `BOUNDARY_CLASSES`（`L-1` / `L-1b` / `L-2` / `L-3` / `L-4`）+ 槽位 `.refine` | 无 |
| **N-4** | `packages/paper/paper-foundation/src/delivery/config-consistency.ts` | M5 的走查：C-1/C-2/C-3 比较 + D-1..D-6 处置 | N-2 |
| **N-5** | `packages/paper/paper-foundation/src/delivery/review-independence.ts` | CE-1/CE-2/CE-3 的断言 | 无 |
| **N-6** | `packages/paper/paper-foundation/src/delivery/boundary-render.ts` | `BoundaryDeclaration` → Markdown（**无条件生成**，与 `renderDeliveryAppendix` 分离） | N-3 |
| **N-7** | `apps/paper-shell/src/contracts/capability-map.ts` | `FamilyContract.validate` 的 `rule` ↔ `CapabilitySpec` 映射 + 孤儿规则检测 | N-1 |
| **N-8** | `docs/quality/README.md`（**本支线产物的索引**） | 8 份规格文档的导航 + 交叉引用 | — |

### 3.2 修改文件（12）

| # | 文件 | 改动 | 风险 |
|---|---|---|---|
| **M-1** | `packages/paper/paper-foundation/src/ir/schema.ts` | `IR_KINDS` 15→18；`IrObjectMap` / `IR_SCHEMAS` / `ID_FIELD_BY_KIND` 各 +3 | ⚠️ **高**（`.strict()` + 既有测试断言"每 kind 都在两张表里"会立刻抓漏登记） |
| **M-2** | `packages/paper/paper-foundation/src/ir/refs.ts` | `IR_REF_FIELDS` +5 条；`IR_SCOPE_FIELDS` 可能 +1 | ⚠️ **中**（漏登记 ⇒ 引用被当外部定位符永不解析，静默） |
| **M-3** | `packages/paper/paper-foundation/src/ir/index.ts` | 桶导出 +3 kind | 低 |
| **M-4** | `packages/paper/paper-foundation/src/ir/evidence-freeze.ts` | `declaredEnvironmentFingerprint` 纳入 `config`；**命名空间 `-v1`→`-v2`** | ⚠️ **高**（会改既有指纹，须同步 `tests/ir/golden/ir-fingerprints-v1.json`） |
| **M-5** | `packages/paper/paper-foundation/src/delivery/numeric-consistency.ts` | E-1 容差层 + E-2 `MAX_OVER_AXIS` + E-3 集合关系 | ⚠️ **中**（R1-3 是**冻结**决策"comparison is EXACT"，改它须显式复核该冻结） |
| **M-6** | `packages/paper/paper-foundation/src/delivery/execution-gate.ts` | S-8 配置一致性走查 | 中 |
| **M-7** | `packages/paper/paper-foundation/src/delivery/requirement-coverage.ts` | E-5 交付形态断言 | 中 |
| **M-8** | `packages/paper/paper-foundation/src/delivery/delivery-policy.ts` | `DeliveryFailure` 闭集 +1（`config_evidence_missing`）；`CRITICAL_GATE_IDS` **不变**（9 项） | ⚠️ **中**（闭集扩展须谨慎；头注释仍写"eight critical gates"而列表是 9——**顺带修正该散文计数**） |
| **M-9** | `packages/paper/paper-foundation/src/delivery/delivery-grade.ts` | `GradeAnnotation` kinds +2（`config_mismatch` / `config_undeclared_span`）；`renderDeliveryAppendix` 与边界渲染**分离** | 中 |
| **M-10** | `packages/paper/paper-foundation/src/verification/v5-adversarial.ts` | S-9 独立性断言（CE-1/2/3） | 低（V5 已有独立性语义，此处是**加强**） |
| **M-11** | `packages/paper/paper-foundation/src/ir/stale.ts` | S-6 把 S-007 从"字节校验"扩到"内容包含/排除" | 低 |
| **M-12** | `apps/paper-shell/src/contracts/index.ts` | 导出 `capability-map.ts` | 低 |

### 3.3 测试文件（5）

| # | 文件 | 覆盖 | 纪律 |
|---|---|---|---|
| **T-1** | `packages/paper/paper-foundation/tests/ir/capability-spec.spec.ts` | `capabilitySpecSchema` 的 3 条 `.refine`（`judge=machine` 须有阈值；`semantic` 不得有 `machine_check`；`EXISTENCE` 须有 disclaimer） | **每条 refine 配一个构造性反例**（`v-structure.ts:8` 的既有纪律） |
| **T-2** | `packages/paper/paper-foundation/tests/ir/numeric-config.spec.ts` | `NumericConfig` 往返 + `RunArtifact.config_ref` 解析 | 同上 |
| **T-3** | `packages/paper/paper-foundation/tests/delivery/config-consistency.spec.ts` | D-1..D-6 六种处置**各一个反例** | 同上 |
| **T-4** | `packages/paper/paper-foundation/tests/delivery/review-independence.spec.ts` | CE-1..CE-4 四个反例 | 同上 |
| **T-5** | `packages/paper/paper-foundation/tests/delivery/boundary-render.spec.ts` | 边界渲染**无条件生成**（对照 `renderDeliveryAppendix` 对 `CLEAN` 返回 `''`） | 同上 |

### 3.4 改动风险排序（**给主线的优先级建议**）

| 优先级 | 改动 | 理由 |
|---|---|---|
| **P0** | N-2 + N-4 + M-6 + M-8 + T-3（**M5 全套**） | **唯一一处新增检查形态**（`GATE-MAPPING.md` §2.1 的 N-1，**不新增 gate id**），且它抓的是**实质错误**（材料侧 F1 major）。且**不依赖 W8.9**（`W8.9-DEPENDENCY.md` §2.2 阶段 1）。**⚠️ 须先裁决 DP-4（§8.1）**——若配置抽取落为散文解析，M5 即与自身诊断矛盾 |
| **P1** | N-1 + M-1 + M-2 + M-3 + T-1（**`CapabilitySpec` 落地**） | 机制的对象基础；但**改 `IR_KINDS` 风险高**，须先跑既有 IR 契约测试 |
| **P2** | M-5（E-1..E-3）+ M-7（E-5）+ M-11（E-6） | 既有门的语义细化；**M-5 触及冻结决策 R1-3，须显式复核** |
| **P3** | N-3 + N-6 + M-9 + M-10 + T-5（**边界 + 独立性**） | 依赖 W8.9 的 E1 文本（部分）；独立性可先做 CE-1/CE-3（不依赖 W8.9） |
| **P4** | N-7（族契约映射）+ M-12 | 防重复判定；**可与 P1 并行** |

---

## §4 退出判据对账（§5.1 H1–H8）

| # | 判据 | 状态 | 证据 |
|---|---|---|---|
| **H1** | 23 条能力全字段提取完成 | ✅ | `artifacts/handoff/Q1/Q1-A1-capabilities.md`（251 行，全字段，含 `judge` 分布 15/8、字段并集 9 项实测复算） |
| **H2** | F1/F3/F4 三张降维高发区清单（各 ≥5 条） | ✅ | `docs/quality/FAMILY-DEGRADATION-LISTS.md`（F1 **5+6=11** 条含 `[P-01]` 原文五条 + 6 条反推；F3 **9** 条；F4 **10** 条；另 6 条跨族） |
| **H3** | 探针类型学 ≥6 类，每类含可复现构造 | ✅ | `docs/quality/PROBE-TYPOLOGY.md`（**10 类**，每类含构造/预期信号/失败信号/代价/可复现性；含四轴分类与两处空位识别） |
| **H4** | schema + 检查到既有 gate 的映射表（三类计数）+ 存在性/实质分离标记 | ✅ | `docs/quality/CAPABILITY-SCHEMA.md`（14 字段，逐字段改动理由）+ `docs/quality/GATE-MAPPING.md`（**已有门 6 / 需扩展 9 / 新增 gate id 0**，含 5 个扩展点 E-1..E-5 与 1 处**新增检查形态** N-1）+ `docs/quality/JUDGE-CRITERIA.md`（`verification_depth` + `existence_disclaimer`） |
| **H5** | **在 2024-B 上独立产出 ≥10 条能力清单，≥65% machine，全部 machine 条含阈值** | ⚠️ **按字面判据达成，但必须成对读** | `artifacts/handoff/Q1/Q1-C1-2024B-capabilities.md`：**16 条**、**14/16 = 87.5%（标注值）**、**37 条结构化阈值**、16/16 `source_anchor` 指向题面行号 S1–S17。**⚠️ 实证值仅 5/16 = 31.2%**（`Q1-C2` 的 `checks_implemented`），**且条件于 `M-1` 简化模型**（其代价指标为 `UNQUANTIFIED`）。**成立的命题是"当被要求时可写出 87.5% 标注为 `machine` 的检查"；不成立的是"F3/F4 的可机械率 = 87.5%"**——详见 `Q1-C1` §2.1/§2.2 |
| **H6** | ≥3 条 machine 检查双向实跑（合格通过 / 退化被抓） | ✅ | `artifacts/handoff/Q1/q1-c2-checks.py` + `Q1-C2-run-record.json`（**5 条检查** × 双向：合格 **5/5 通过**、4 类退化**全部 raise**；`H6_met: true`） |
| **H7** | 规格文档 + 与 W8.9 的依赖声明 + 复核独立性设计 | ✅ | 本文件 + `docs/quality/W8.9-DEPENDENCY.md`（3 项依赖 + 降级路径 + 三阶段顺序）+ `docs/quality/REVIEW-INDEPENDENCE.md`（3 维独立 + 3 条证明 + 4 个构造性反例） |
| **H8** | 全程未修改 `[F-01]`（以 §0.5-A 的 sha256 前 16 位复核） | ✅ | 见 §5 |

---

## §5 H8 复核：`[F-01]` 未被修改（**实测**）

> **复核方式**：对 §0.5-A 中 14 个带 sha256 的文件重算指纹，与任务书的值逐位比对。

| 文件 `[F-nn]` | 任务书值 | 实测值 | 一致 |
|---|---|---|---|
| `[F-02]` `CAPABILITY_CHECKLIST.json` | `4b4ade14aa2b1429` | `4b4ade14aa2b1429` | ✅ |
| `[F-03]` `bench/quality/cumcm-2026-A/capability-library.json` | `d405c9213ea6bb7e` | `d405c9213ea6bb7e` | ✅ |
| `[F-04]` `CAPABILITY_AUDIT.md` | `011e71a0b89e4ff9` | `011e71a0b89e4ff9` | ✅ |
| `[F-05]` `COMP_REVIEW.md` | `70e3beefb32e1cbc` | `70e3beefb32e1cbc` | ✅ |
| `[F-06]` `bench/quality/cumcm-2026-A/`（自产基准语料） | `a6fefe0415d6de97` | `a6fefe0415d6de97` | ✅ |
| `[F-07]` `PAPER_MODELING_QUALITY_REPORT.md` | `d5655e1e47cf4296` | `d5655e1e47cf4296` | ✅ |
| `[F-08]` `AUDIT_REPORT.md` | `1c5abec38464fc23` | `1c5abec38464fc23` | ✅ |
| `[F-09]` `MODELING_REPORT.md` | `451b7fe8bb4331d7` | `451b7fe8bb4331d7` | ✅ |
| `[F-10]` `PROBLEM_ANALYSIS.md` | `63392814c1090c87` | `63392814c1090c87` | ✅ |
| `[F-11]` `bench/quality/cumcm-2026-A/problem-faithful.md` | `bcac23bc92a15408` | `bcac23bc92a15408` | ✅ |
| `[F-12]` `bench/quality/cumcm-2026-A/problem-faithful.md` | `6fc53139e8a599ef` | `6fc53139e8a599ef` | ✅ |
| `[F-14]` `checkpoint_revision_report.md` | `3484c843ec0eadf9` | `3484c843ec0eadf9` | ✅ |
| `[F-15]` `DATA_PROFILE.json` | `63250d567d47dbc7` | `63250d567d47dbc7` | ✅ |
| `[F-16]` `DELIVERABLES.json` | `591c907b4a61f08e` | `591c907b4a61f08e` | ✅ |

**结论**：**14/14 逐位一致**。`[F-01]` **未被修改**（H8 达成）。**无 §5.3 的出处漂移**——本支线全部出处标注有效。

> **补充复核**（§0.5-A 中无 sha256 的项）：`[F-27]` `CROSS_PROBLEM_LEDGER.json` 的**不存在性**已实测（`find` 0 命中，见 `Q1-A5`）；`[F-13]`/`[F-17]`–`[F-20]` 任务书本就未给指纹，本支线未依赖其内容。

---

## §6 §7 预登记对账（**逐条，含未成立的**）

> **纪律**：预登记是**假设**，实测可能推翻。**未成立必须如实报告**（否则预登记失去意义）。

| # | 预登记 | 实测 | 判定 |
|---|---|---|---|
| **Q1** | 2024-B 的可机械率远低于 65% | 标注值 **87.5%**（14/16）；**实证值 31.2%**（5/16，条件于 `M-1`） | ⚠️ **被识别为口径问题，既未证实也未证伪**。87.5% 是"被要求后的产出"（H5 要求 ≥65% machine），与材料侧 65.2% 的"自发产出"**不是同口径**；**实证值 31.2% 低于 65%** ⇒ **§7-Q1 在实证口径下成立**。详见 `Q1-C1` §2.2/§3 |
| **Q2** | `machine_check` 大量落在"需扩展"而非"已有门可覆盖" → 与"禁止第二套 gate"产生张力 | 实测 **需扩展 9 / 已有门 6 / 新增 gate id 0**（60%:40%） | ⚠️ **比例成立，张力不成立**。预登记的"需扩展多"成立；但张力被**消解**——9 条全部归到 **5 个扩展点**（对既有门的语义细化），**新增检查形态仅 1 处**（N-1），且它**不新增 gate id**（复用既有 id 语义）。**张力不是"语义 vs 自洽"，而是"单产物 vs 跨产物"** |
| **Q3** | 探针在 F3/F4 上难以构造 | 实测 **6/10 可移植**（P-3/P-4/P-5/P-8/P-9/P-10）；受限 3（P-1/P-2/P-7）；不可移植 1（P-6） | ⚠️ **过于悲观，但机理正确**。受限的 3 类**全部是"方向类"探针**——正是预登记说的"正确方向不唯一"。**修正形态**："方向类受限，恒等式/存在性类可移植" |
| **Q4** | M5 在 DPH 上找不到对应字段 → 需新增对象，成本高于预期 | 实测 **0 命中**（`dt`/`N`/`solver_config` 在 `ir/`）；`environment` 是自由文本；`ExecutionRecord` 无数值配置字段 | ✅ **成立**。成本确认"高于预期"（需新增 `NumericConfig` + 生产者机制，且生产者的抽取方式**未裁决**——`CONFIG-CONSISTENCY-CHECK.md` §5 步 7） |
| **Q5** | 能力清单与 `RequirementSpec` 语义重叠 → 应合并而非新增 | 实测：二者**来源不同**（题面 vs 族知识），合并会使 `source_span` 语义失效 | ❌ **"应合并"未成立，但"重叠"成立**。裁决：**分层 + 引用**（`source_anchor` 连接），不合并（§1.3） |
| **Q6** | 参考实现的降维条目里有 DPH 体系不认可的（如依赖 Vision OCR 的事实提取） | 实测：`PX-C3` 依赖"400 DPI 栅格化核验原始 PDF 矢量数学层"——DPH **无此环节**（无 OCR/PDF 解析的 canonical 对象） | ✅ **成立**。处置：`PX-C3` 的"逐字匹配"在 DPH 侧须由 **`DataArtifact.content_hash` + 源码文本断言**（E-4）承担，**而非** OCR 核验 |
| **Q7** | 复核中发现更多类似 §0.5-D-1 的引用缺口 | 实测：**未发现新的同类缺口**。`[F-27]` 是唯一一处 | ❌ **未成立**（本轮范围内）。但 `Q1-A5` §2 已记录**该缺口穿透了材料侧的全部自动审计**（`AUDIT_REPORT.md` 报 `fatal: 0, warn: 2`，未含此缺口）——**这本身印证了 DPH 用哈希+断言钉死的价值** |

**对账统计**：成立 **2**（Q4、Q6）＋ 部分成立 **2**（Q2、Q3）＋ 未成立 **3**（Q1、Q5、Q7）。

---

## §7 本支线的诚实边界（**自应用**）

> 本支线要求他物声明边界（N6），**故自身也必须声明**。按 `HONESTY-BOUNDARY-CLASSES.md` 逐类：

### L-1 同源复核风险

| 槽位 | 值 |
|---|---|
| `{{共享环节}}` | **题面解读**（材料侧 `[F-01]` 与 2024-B 的题面均为我单通道解读） |
| `{{独立维度}}` | **不同输入形态**（材料侧是 PDE 求解产物，2024-B 是统计/决策产物）+ **不同工具**（`q1-c2-checks.py` 是我独立实现的复算器，非材料侧代码） |
| `{{证明方式}}` | CE-3（复核 `Result` 不得与生成 `Result` 逐位相同）：`Q1-C2` 的 `B-07` 检查断言"交付值须由参数复算（rel < 1e-6）"，**且方向 B2 的 +0.01% 编造被 raise**——证明复算器**不是**复制器 |

### L-2 无实测数据

| 槽位 | 值 |
|---|---|
| `{{对象}}` | 本支线对"2024-B 该有哪些能力"的判断 |
| `{{自证手段 1}}` | 与题面逐句对撞 \| S1–S17 \| `Q1-C1` §0 |
| `{{自证手段 2}}` | 退化底座追溯 \| 16/16 条目可追溯 \| 各条 `退化底座` 行 |
| `{{自证手段 3}}` | 双向实跑 \| 5 检查 × 2 方向 \| `Q1-C2-run-record.json` |

> **不主张**本清单"完备"或"与评分标准一致"——**2024-B 的官方评分细则不在任何可用材料中**。

### L-3 参数真伪不可判定

| 槽位 | 值 |
|---|---|
| `{{参数}}` | 材料侧的三套物性公式；2024-B 的表 1/表 2 全部数值 |
| `{{来源}}` | 题面附录（材料侧经 400 DPI 核验）；`bench/problems/2024-B/problem-faithful.md` |
| `{{可验证部分}}` | 与原始文本逐字一致 + 物理方向一致性（材料侧）／单位一致性（2024-B，`B-16`） |

### L-4 假设真伪不可判定

| 槽位 | 值 |
|---|---|
| `{{假设}}` | **`M-1` 简化模型**（拆解回收件按原次品率重新进入；忽略回收件的状态相关性） |
| `{{代价指标}}` | **UNQUANTIFIED** |

> **如实说明**：`Q1-C2` 的 5 条检查验证的是"**交付指标与 `M-1` 一致**"，**不验证** `M-1` 本身是否正确。`M-1` 与"2024-B 的严格模型"之间的偏差**未量化**——故标 `UNQUANTIFIED`。**这正是 N6 要求的形态**（使缺口可见，而非写成免责声明）。

---

## §8 给主线的决策点（**需主线裁决，本支线不自作主张**）

> 依 §5.4："本支线产物为规格。是否并入 DPH 主链、以何种顺序并入，**由主线在 W9 之后另行决策**。"

### 8.1 承重决策（**DP-4 必须先裁决**）

> **为何 DP-4 是承重的**：`CONFIG-CONSISTENCY-CHECK.md` §3 的诊断是"M5 缺的**不是一条检查，而是一类对象**"。**若配置抽取落为"从模型散文里解析 `dt`/`N`/`solver_config`"，那 M5 就只是又一条散文检查——与它自己的诊断直接矛盾。**
>
> 三个候选（`CONFIG-CONSISTENCY-CHECK.md` §5 步 7）中，**只有"执行期捕获"给的是证据而非声明**——这与 M5 的"声明 vs 实际"（C-2）同构。**故 DP-4 不裁决，DP-1/DP-2 都可能返工。**

| # | 决策点 | 本支线的建议 | 依据 |
|---|---|---|---|
| **DP-4** | **`NumericConfig` 的配置从哪来（生产者机制）？** | **候选 3（执行期捕获）**——与 DPH 既有的 `ExecutionRecord` 捕获机制同源，且能保证"记录的是**实跑**的值"（这正是 C-2 要断言的）。**但须先做 spike：实测 runtime 是否支持注入**（估 1 天）。**若 spike 失败，须回头重估 M5 的可行性，而非降级为散文解析。** | `CONFIG-CONSISTENCY-CHECK.md` §5 步 7 |

> **M5 的额外性价比（本支线低估、经复核后补记）**：**M5 的 C-2（声明 ↔ 实际）正是 `W8.9-A1`（"真实运行的代码来源与新鲜度可断言"）所需的语义化形式**——声明 `dt=0.5` 而实跑 `dt=0.2` 就是"声明不新鲜"。**故 M5 的机制可复用于 build trap 守卫，而 A1 是 W8.9 的硬判据**（`DPH-W8.9-任务书.md` §4.1-H1）。这让 M5 的性价比高于本支线原先的估计（它同时服务 W9 的质量机制与 W8.9 的 A1）。

### 8.2 其余决策点（**DP-4 裁决后再动**）

| # | 决策点 | 本支线的建议 | 依据 |
|---|---|---|---|
| **DP-2** | 是否实施 M5（唯一新增检查形态）？ | **是，最高优先**。它不依赖 W8.9，且抓的是实质错误 | `W8.9-DEPENDENCY.md` §2.2 |
| **DP-1** | 是否采纳 3 个新 IR kind（`IR_KINDS` 15→18）？ | **是**，但分步：先 `NumericConfig`（P0，风险可控），再 `CapabilitySpec`（P1，改 `IR_KINDS` 风险高） | `QUALITY-MECHANISM-SPEC.md` §3.4 |
| **DP-3** | 是否接受"不新增 critical gate id"（9 项不变）？ | **是**。9 条检查全部归到既有门的扩展点；N-1 是**新增检查形态**而非新增 gate id | `GATE-MAPPING.md` §4 |
| **DP-5** | 是否采纳 `JUDGE-CRITERIA.md` 的 18/5 分流（vs 材料 15/8）？ | **是**，三条提升（`P4-C1`/`P4-C4`/`PX-C1`）的理由见该文件 §2.2 | `JUDGE-CRITERIA.md` §2.2 |
| **DP-6** | 是否实施拆条（`P1-C4`/`P3-C4`/`P4-C2` 的混合判据）？ | **本轮不实施**，只记录规则（R1–R4） | `JUDGE-CRITERIA.md` §3 |
| **DP-7** | `EXISTENCE` 深度的适用范围？ | **比材料侧窄**：交付表格归 `SUBSTANTIVE`（形态可验），`EXISTENCE` 只留给图/成稿/代码文件 | `JUDGE-CRITERIA.md` §4.4 |
| **DP-8** | 边界声明与 `MARKED` 附录是否分离？ | **必须分离**：边界**无条件生成**，MARKED **条件生成** | `LIMITS-TEMPLATE.md` §2.1 |

> **实施顺序（修正）**：**DP-4 spike（1 天）→ DP-2（M5 全套）→ DP-1（`CapabilitySpec` 落地）**。理由：DP-4 决定 M5 能否成立；M5 是唯一新增检查形态且不依赖 W8.9；`CapabilitySpec` 改 `IR_KINDS` 风险最高，应在其后。

---

## §9 产物索引

| 产物 | 路径 | 对应条例 |
|---|---|---|
| 23 条能力全字段提取 | `artifacts/handoff/Q1/Q1-A1-capabilities.md` | Q1-A1 |
| 契约机块（解析后 JSON） | `artifacts/handoff/Q1/Q1-contract-machine.json` | `[P-14]` 附带 |
| 引用缺口登记 | `artifacts/handoff/Q1/Q1-A5-reference-gap.md` | Q1-A5 |
| 2024-B 独立能力清单 | `artifacts/handoff/Q1/Q1-C1-2024B-capabilities.md` | Q1-C1（**H5**） |
| 双向实跑脚本 + 运行记录 | `artifacts/handoff/Q1/q1-c2-checks.py` + `Q1-C2-run-record.json` | Q1-C2（**H6**） |
| 探针在 2024-B 上的可行性 | `artifacts/handoff/Q1/Q1-C3-probes-on-2024B.md` | Q1-C3 |
| 降维高发区三族清单 | `docs/quality/FAMILY-DEGRADATION-LISTS.md` | Q1-A2（**H2**） |
| 探针类型学 | `docs/quality/PROBE-TYPOLOGY.md` | Q1-A3（**H3**） |
| 诚实边界分类 | `docs/quality/HONESTY-BOUNDARY-CLASSES.md` | Q1-A4 |
| 能力清单 schema | `docs/quality/CAPABILITY-SCHEMA.md` | Q1-B1（**H4**） |
| judge 分流标准 | `docs/quality/JUDGE-CRITERIA.md` | Q1-B2（**H4**） |
| 检查到 gate 的映射 | `docs/quality/GATE-MAPPING.md` | Q1-B3（**H4**） |
| M5 配置一致性检查设计 | `docs/quality/CONFIG-CONSISTENCY-CHECK.md` | Q1-B4 |
| 边界模板 | `docs/quality/LIMITS-TEMPLATE.md` | Q1-B5 |
| 与 W8.9 的依赖声明 | `docs/quality/W8.9-DEPENDENCY.md` | Q1-D2（**H7**） |
| 复核独立性设计 | `docs/quality/REVIEW-INDEPENDENCE.md` | Q1-D3（**H7**） |
| **本规格文档** | `docs/quality/QUALITY-MECHANISM-SPEC.md` | Q1-D1（**H7**） |

---

## §10 一句话收口

**本支线证明了"质量识别 = 退化检测"这条路不只是一道题的运气**：在 2026-A（F1/PDE）之外，于 2024-B（F3+F4/统计+决策）上**独立**产出了 16 条能力清单（**87.5% 标注为 machine**、37 条结构化阈值），并**实跑**了 5 条检查（合格 5/5 通过、4 类退化全部 raise）。

**但四处必须如实记账**（**第 1 条最重**）：

1. **87.5% 是标注值，不是实证值。** 被实跑证明可执行的只有 **5/16 = 31.2%**，且条件于 `M-1` 简化模型（其代价指标为 `UNQUANTIFIED`）。**成立的命题是"当被要求时可写出 87.5% 标注为 machine 的检查"；不成立的命题是"F3/F4 的可机械率 = 87.5%"**——写清单的人知道自己在被要求给阈值，所以给出了阈值。**这是与 T3 同族的度量有效性问题**（`Q1-C1` §2.2）。
2. **本支线的 `semantic` 部分（2024-B 上 2 条）依赖 W8.9 的 E1 文本**；无 E1 则不可校验（`W8.9-DEPENDENCY.md` §2.1）。**但 `machine` 部分不依赖 W8.9。**
3. **`[P-11][0]` 的同源缺陷未被解决**——E1/E2 拆分只是移动了共享点（从"复核 AI 同源"变为"E2 与 E1 共享题面解读"）；**任何声称"复核完全独立"的设计都是错的**（`REVIEW-INDEPENDENCE.md` §3）。**且材料侧的共享环节已出现可疑活动**（`[F-08]` 的"53 个数字未登记"），故仅声明共享点不够，必须给检出手段（**L-1b**）。
4. **M5 的可行性挂在 DP-4 上**——若配置抽取落为散文解析，M5 即与它自己的诊断（"缺一类对象，不是缺一条检查"）矛盾（`QUALITY-MECHANISM-SPEC.md` §8.1）。
