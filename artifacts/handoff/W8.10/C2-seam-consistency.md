# W8.10-C2 接缝验证：Q 支线 `CapabilitySpec` 规格 ↔ 已落地 IR schema

> **性质**：只读比对。本文件不修改 `packages/` / `apps/` / `docs/` 任何文件，不跑全量测试。
> **比对对象**：
> - 规格侧：`docs/quality/CAPABILITY-SCHEMA.md`（282 行，Q1-B1，E1/E2 接收层**落地之前**所写）
> - 实现侧：`packages/paper/paper-foundation/src/ir/schema.ts`、`ir/problem-contract.ts`、`ir/contract-objects.ts`、`ir/refs.ts`、`ir/store.ts`
> **问题**：W8.12（`CapabilitySpec` 落地）会不会再撞一次 `.strict()`？

---

## 0. 结论（一句话）

**W8.12 落地前必须先做两件事**：(1) 把 `CapabilitySpec` 的 14 个字段中**无现有归属的 12 个**写进**新 kind 的 schema**（而不是塞进现有 kind——塞进现有 kind 会被 `.strict()` 全部拒绝）；(2) 修 `ir/refs.ts` 的**可空引用**与**复合引用路径**两条通路——规格里 `required_output_ref` / `at_config_ref` 的 `null` 值、以及 `subject_ref` 的 `Result:<id>.<field>` 冒号语法，**即使 schema 写对了，也会在 `validateRefFields` 被拒**。

---

## 1. 规格的 14 字段清单（提取基线）

来自 `CAPABILITY-SCHEMA.md:104-132`（zod 定义）与 `:12-28`（§0 逐字段理由表）：

| # | 字段 | 规格行 | 类型 |
|---|---|---|---|
| 1 | `capability_id` | `:104` | `idSchema` |
| 2 | `family` | `:106` | `zod.enum(FAMILIES)` |
| 3 | `scope_ref` | `:108` | `refSchema` → 规格声称指向 `RequirementSpec`（`:107`） |
| 4 | `name` | `:109` | `textSchema` |
| 5 | `criterion` | `:111` | `textSchema` |
| 6 | `judge` | `:113` | `zod.enum(CAPABILITY_JUDGES)`（`:59`） |
| 7 | `machine_check` | `:115` | `zod.enum(MACHINE_CHECK_KINDS).nullable()`（`:49-55`） |
| 8 | `falsifiable_thresholds` | `:117` | `zod.array(falsifiableThresholdSchema)`（`:75-100`） |
| 9 | `source_anchor` | `:120` | `refSchema` → `RequirementSpec` |
| 10 | `required_output_ref` | `:123` | `refSchema.nullable()` → `REQUIRED_OUTPUT` 的 `RequirementSpec` |
| 11 | `verification_depth` | `:125` | `zod.enum(VERIFICATION_DEPTHS)`（`:63`） |
| 12 | `existence_disclaimer` | `:127` | `textSchema.nullable()` |
| 13 | `probe_refs` | `:130` | `zod.array(zod.enum(PROBE_IDS))` |
| 14 | `boundary_refs` | `:132` | `zod.array(zod.enum(BOUNDARY_IDS))` |

嵌套对象 `falsifiableThresholdSchema` 的 6 个子字段（`:75-91`）：`subject_ref`(`:79`) / `operator`(`:81`) / `threshold`(`:83`) / `tolerance`(`:85`) / `unit`(`:87`) / `at_config_ref`(`:90`)。

规格 §1.1（`:159-171`）声明的必改登记点 7 处：`IR_KINDS` / `IrObjectMap`+`IR_SCHEMAS` / `ID_FIELD_BY_KIND` / `IR_REF_FIELDS` / `IR_SCOPE_FIELDS` / `ir/index.ts` 桶导出 / `tests/ir/ir-contract.spec.ts`。

---

## 2. 三类一致性清单

### 2.A 已对齐（规格要求的，实现里已有）

> 判据：字段名 / 常量 / 机制在实现中**确实存在**，且语义与规格所指一致。

| 规格要求 | 实现证据 | 对齐程度 |
|---|---|---|
| `<kind>_id` 命名约定（`capability_id` 的依据，`:14`） | `ir/schema.ts:633-649` `ID_FIELD_BY_KIND`，15 条全为 `<kind>_id`（`assumption_id`/`equation_id`/`experiment_id` 在 `:646-648`） | 完全对齐 |
| `scope_ref` **字段名与 idiom** | `ir/contract-objects.ts:68`（AssumptionSpec）、`:113`（EquationSpec）、`ir/problem-contract.ts:246`（SymbolSpec）；三处均登记进 `ir/refs.ts:157,172,177` | 字段名对齐；**目标 kind 不对齐**（见 2.B-1） |
| `name` 作为 `textSchema` 人读标签 | `ir/schema.ts:233` `Result.name: textSchema` | 完全对齐 |
| `refSchema` / `idSchema` / `textSchema` / `unitSchema` 语义可复用（`:34`） | `ir/schema.ts:99-113` 定义；**均未 export**，三模块各自重声明同一份（`ir/schema.ts:99,109,111,113`、`ir/problem-contract.ts:53-60`、`ir/contract-objects.ts:44-50`） | 语义对齐；**"复用"须理解为"照抄"，不能 import**（见 2.C-6） |
| `.strict()` 关死未知键的约定（`:34`） | 15 个 kind 全部 `.strict()`；护栏测试 `tests/ir/schema.spec.ts:48-57`（断言 `unrecognized_keys`） | 完全对齐 |
| 闭集用 `as const` + `zod.enum`（`:34`） | `ir/schema.ts:243,251,491,505`；`ir/problem-contract.ts:118,128,172,213,228` | 完全对齐 |
| `IR_REF_FIELDS` 是引用策略唯一登记处（`:166`） | `ir/refs.ts:101-187`（表）+ `:192` `deepFreeze`；store 在 `ir/store.ts:346` 唯一调用点 | 完全对齐 |
| `IR_SCOPE_FIELDS` 作为作用域归属校验的登记处（`:167`） | `ir/refs.ts:303-315` 存在，但**仅含 ModelSpec 两条**（见 2.C-5） | 表存在，扩展点**不完整** |
| `requirement_type = REQUIRED_OUTPUT`（`required_output_ref` 的指向目标，`:23`） | `ir/problem-contract.ts:118` `REQUIREMENT_TYPES = ['SUBPROBLEM','REQUIRED_OUTPUT','CONSTRAINT']`；`:140` 用于 schema；门 `delivery/requirement-coverage.ts:78,87` 消费该值 | 目标存在；**引用字段本身不存在**（见 2.B-5） |
| `source_span`（`source_anchor` 可解析性的载体，`:22`、`:118`） | `ir/problem-contract.ts:146` `source_span: zod.tuple([int≥0,int≥0]).optional()`，`:153-156` refine `end >= start` | 载体存在；**但无任何生产者写它**（见 2.C-2） |
| `reference_validation` / `requirement_coverage` 门存在（`:22`、`:23` 声称由它们保证） | `delivery/delivery-policy.ts:62,63`（`CRITICAL_GATE_IDS`）；`delivery/reference-validation.ts:32` 独立重走 `IR_REF_FIELDS`；`delivery/requirement-coverage.ts` | 完全对齐（门名与行为均存在） |

**已对齐合计 11 项**（其中 4 项为"部分对齐"，已在备注中标出）。

### 2.B 规格要求但实现没有（缺口）

> 判据：规格明确要求，实现侧**零命中**（已用 `rg` 全仓 `packages/` + `apps/` 的 `*.ts` 逐名确认）。

| # | 缺口 | 规格出处 | 实现里缺什么 |
|---|---|---|---|
| 1 | **`scope_ref` 的目标 kind 不一致** | `:107` 注释「指向 `RequirementSpec`（与 `AssumptionSpec.scope_ref` 同 idiom）」 | 实现中三个 `scope_ref` **全部指向 `ProblemSpec`**（`ir/refs.ts:157,172,177`）。规格用"同 idiom"一词掩盖了目标差异——idom 是"字段名 + 单值 + 作用域归属"，但目标 kind 从 `ProblemSpec` 换成 `RequirementSpec` 后，`IR_SCOPE_FIELDS` 的 `targetScopeField`（`ir/refs.ts:309`，当前恒为 `'scope_ref'`）无法复用：`RequirementSpec` **没有 `scope_ref` 字段**（`ir/problem-contract.ts:132-151`），它有的是 `source_data_ref`。需在 `IR_SCOPE_FIELDS` 里写 `targetScopeField: 'source_data_ref'` 并让 `validateScopeOwnership` 的 own-scope 语义适配，规格未提 |
| 2 | **`capability_id` / `criterion` / `judge` / `machine_check` / `falsifiable_thresholds` / `source_anchor` / `required_output_ref` / `verification_depth` / `existence_disclaimer` / `probe_refs` / `boundary_refs`**（11 个字段） | `:104-132` | 全仓 `*.ts` **零命中**。`criterion` 仅出现在注释里的英文词 "exit criterion"（`verification/v-structure.ts:8` 等 4 处），`judge` 仅出现在注释（`ir/contract-objects.ts:88` 等 7 处）——**无一是 IR 字段** |
| 3 | **`MACHINE_CHECK_KINDS` / `CAPABILITY_JUDGES` / `VERIFICATION_DEPTHS` / `THRESHOLD_OPERATORS` 四个闭集常量** | `:49-55` / `:59` / `:63` / `:68-72` | 全仓 `*.ts` 零命中。13 个阈值算子（`LT`…`MATCHES_EXACT`）**无任何实现或消费方** |
| 4 | **`PROBE_IDS` / `BOUNDARY_IDS` 两个枚举常量** | `:130`、`:132` | 全仓 `*.ts` 零命中。`docs/quality/PROBE-TYPOLOGY.md`（P-1..P-10）与 `HONESTY-BOUNDARY-CLASSES.md`（L-1/L-1b/L-2/L-3/L-4）**只有 Markdown 散文，没有机器可读枚举**。且这两份文档**尚未提交**（`bench/W8.9-REPORT.md:200` 记录 `docs/quality/` 12 文件未入库），枚举一旦写进 schema 就等于把未提交的文档变成编译期依赖 |
| 5 | **`required_output_ref` 字段本身** | `:123` | 指向目标（`REQUIRED_OUTPUT` 的 `RequirementSpec`）存在，**引用字段不存在**。规格 §0（`:23`）说"由 `requirement_coverage` 门承担覆盖检查"——但该门（`delivery/requirement-coverage.ts`）当前做的是"`ProblemSpec.requirement_refs` 里的 `REQUIRED_OUTPUT` 是否被 ≥N 个 CRITICAL Result 覆盖"，**与 `CapabilitySpec.required_output_ref` 无连接点**，规格高估了门的可复用度 |
| 6 | **`FAMILIES` 在 IR 包内不可用** | `:16`、`:106` | 规格 `:16` 称 `FAMILIES` 位于 `apps/paper-shell/src/contracts/index.ts` —— **出处错误**。实际在 `apps/paper-shell/src/route.ts:32`；`contracts/index.ts:18` 导出的是 `CONTRACTED_FAMILIES`（由 `:12-15` 的 `CONTRACTS` 键推导，**只有 `['F3','F4']`**）。而 `packages/paper/paper-foundation` **不依赖** `apps/paper-shell`（`package.json` 无该依赖；反向依赖成立），`paper-foundation/src/` 中 `FAMILIES`/`MethodFamily` 零命中。`zod.enum(FAMILIES)` 写进 `ir/schema.ts` 需要**倒转包依赖或复制闭集**，规格未提 |
| 7 | **`family` 的族契约覆盖率** | `:16` 理由「能力必须挂在族上，否则无法按族选择 `FamilyContract.validate`」 | 4 个族里**只有 F3/F4 有契约**（`apps/paper-shell/src/contracts/index.ts:12-15`，注释 `:17` 明写 "F1/F2 land later"）。规格 §2.2 的示例实例（`:202`）恰恰用 `"family": "F1"` —— 枚举合法但**无契约可校验**。规格的理由与自身的示例不一致 |

**缺口合计 7 项**（其中 11 个字段缺归属合并计为 1 项）。

### 2.C 实现有但规格未提（规格的盲区）

> 判据：实现中已落地、且**直接决定 W8.12 成败**，但 `CAPABILITY-SCHEMA.md` 全文未提。

| # | 实现事实 | 证据 | 为何是盲区 |
|---|---|---|---|
| 1 | **`e1_span` 已落地**（W8.9-B3） | `ir/contract-objects.ts:91`（AssumptionSpec）、`:130`（EquationSpec），均为 `textSchema.optional()`；消费方 `produce/e1-e2.ts:248-258`（未声明/过短/非逐字三种拒绝），`MIN_E1_SPAN_CHARS = 10`（`:177`） | 规格全文（`rg e1_span docs/quality/CAPABILITY-SCHEMA.md` → **零命中**）**从未提及这个字段**。这正是"E1 接收层落地前所写"的直接后果：规格预测的接缝是 `source_anchor → RequirementSpec + source_span`（题面层），而实际落地的接缝是 `e1_span → E1 分析文本`（推理层）——**两者是不同层的锚点**。`bench/W8.9-REPORT.md:86` 已记录该字段落地时撞 `.strict()`（`schema_violation`） |
| 2 | **`RequirementSpec.source_span` 恒为空** | `ir/problem-contract.ts:146` 为 `.optional()`；`tests/ir/fixtures.ts` 不设该字段；`produce/` 与 `apps/paper-shell/src/` 中 `source_span` **零命中**（无生产者） | 规格 `:118` 把 `source_anchor` 的可解析性押在 `source_span` 上，`:22` 更称由 `reference_validation` 门保证。实际上该门（`delivery/reference-validation.ts:32`）只校验**引用的存在与 kind**，不校验 span 是否存在/是否落在 `raw_problem_ref` 内。`docs/quality/W8.9-DEPENDENCY.md:76` 已承认该退化路径（"`source_anchor` 退化为引用级"），规格本体未回填 |
| 3 | **`RequirementSpec.source_data_ref` 与 `ProblemSpec.raw_problem_ref` 的一致性由 guard 保证，而非由 ref 表** | `ir/problem-contract.ts:449-457`（`cross_source_requirement`） | 规格 `:118` 写「`source_span` 落在其 `raw_problem_ref` 上」，把 `raw_problem_ref` 当作锚点的直接落点。实际锚点链是 `CapabilitySpec.source_anchor → RequirementSpec.requirement_id → RequirementSpec.source_data_ref → DataArtifact`，其中第二跳靠 guard 而非 ref 表。规格未画出这条链，W8.12 若按规格字面实现会指向 `ProblemSpec` 而非 `RequirementSpec` |
| 4 | **`capability` 一词在实现中已是既有术语** | `runtime/profile.ts:9,14,24`（`CapabilityFirewall`、`forbidden_capability`）；`provider.ts:66-67`（`guard.invokeCapability({stage:'MODEL', capability:'llm'})`）；`audit.ts:40`（审计事件 `capability_check`） | 新增 IR kind `CapabilitySpec` + 字段 `capability_id` 会在**同一个包内**引入同形异义词：运行时的 "capability" = 阶段能力防火墙的授权项，规格的 "capability" = 题目能力清单项。规格未做术语消歧 |
| 5 | **`validateScopeOwnership` 只对 `ModelSpec` 触发** | `ir/store.ts:353` `if (kind === 'ModelSpec')` 硬编码单 kind 门；`ir/refs.ts:303-315` 的 `IR_SCOPE_FIELDS` 也只有 ModelSpec 两条 | 规格 `:167` 只写「若 `scope_ref` 需作用域归属校验，追加」——**追加表行不足以生效**，还须改 `ir/store.ts:353` 的 kind 判断。规格漏了这处硬编码 |
| 6 | **`idSchema`/`refSchema`/`textSchema`/`unitSchema` 均为模块私有** | `ir/schema.ts:99,109,111,113`（均无 `export`）；三模块各自重声明（`ir/problem-contract.ts:53-60`、`ir/contract-objects.ts:44-50`） | 规格 `:34` 称「`idSchema` / `refSchema` / `textSchema` 复用既有语义」、`:87` 直接用 `unitSchema`。字面照做会写出一个**不存在的 import**。既有 idiom 是"逐模块重声明同一份定义"（`ir/contract-objects.ts:44-50` 即 W8.9 的做法） |
| 7 | **`IR_REF_FIELDS` 对 `null` 与复合路径零容忍** | `ir/refs.ts:246-250`（single：`const ref = raw as string`，无 null 分支）、`:260-265`（nested：`entry[child] as string`，无 null 分支）；store 的 resolver 是扁平 `Map.get`（`ir/store.ts:346`） | 全仓**无任何 `refSchema.nullable()` 的 IR 字段**（`rg 'refSchema.nullable\(\)' ir/` → 零命中），即这条通路**从未被走过**。规格里 `required_output_ref`（`:123`）与 `at_config_ref`（`:90`）都设计为可空，且 §2.2 示例（`:251`）真的写 `"required_output_ref": null`。详见 §3 的 C-2/C-3 |
| 8 | **`refSchema` 是裸字符串，store 用扁平 id 查表** | `ir/schema.ts:109` `const refSchema = zod.string().min(1)`；`ir/store.ts:346` `ref => this.#objects.get(ref)?.kind` | 规格 §2.2 的 `subject_ref` 示例值为 `"Result:r_q1_h.value"`（`:210`）、`at_config_ref` 为 `"RunArtifact:run_q1_delivery"`（`:215`）——**冒号 + 点号的复合路径语法**。IR 中不存在任何解析该语法的代码（`rg "split\(':'\)"` → 零命中），`Map.get("Result:r_q1_h.value")` 恒为 `undefined`。详见 §3 的 C-3 |
| 9 | **规格 §1.1 把护栏测试描述为"免费得到"，实际不是** | 规格 `:169`；实际 `tests/ir/redteam.spec.ts:436-463` 的 `expected` 是**手写枚举 15 个 kind 的字面量表**，`tests/ir/fixtures.ts:365-384` `validObjectFor` 是穷尽 `switch`（无 `default`），`:387+` `validChain()` 也是手写序列 | 加第 16 个 kind 会在 4 张 `Record<IrKind,…>` 表（`IR_SCHEMAS`/`ID_FIELD_BY_KIND`/`IR_REF_FIELDS`/`IrObjectMap`）产生**编译错误**，并在 `redteam.spec.ts:462`、`schema.spec.ts:26-31`、`schema.spec.ts:34-38` 三处测试失败。失败是**响亮**的（非静默），但**不是免费**的——必须手工编辑 3 个测试/夹具文件 |
| 10 | **`IR_KINDS` 实际为 15 个 kind**（规格称追加后 16） | `ir/schema.ts:62-86`；`ID_FIELD_BY_KIND` `:633-649` 同为 15 条 | 规格 `:163`/`:165` 的行号引用（`ir/schema.ts:62-86`、`:633-649`）**准确**，且 15+1=16 自洽——此处是规格**少数完全对齐**之处，仅作基线记录 |

**盲区合计 10 项**（其中 1 项为"规格此处正确"的正向记录）。

---

## 3. `.strict()` 撞车清单

### C-1 加进**现有 kind** 会被 `.strict()` 拒绝的字段

`.strict()` 使未知键成为 `unrecognized_keys`（`tests/ir/schema.spec.ts:48-57` 固化此行为）→ store 在 `ir/store.ts:304-311` 映射为 `schema_invalid` → **硬拒绝**。

对 14 个规格字段逐个核对"是否已在某个现有 kind 上声明"：

| 规格字段 | 现有 kind 上是否已有同名声明 | 加进现有 kind 的结果 |
|---|---|---|
| `scope_ref` | **有** —— `contract-objects.ts:68`、`:113`、`problem-contract.ts:246` | ✅ 在这 3 个 kind 上**接受** |
| `name` | **有** —— `schema.ts:233`（`Result.name`） | ✅ 在 `Result` 上**接受** |
| `capability_id` | 无 | ❌ **拒绝** |
| `family` | 无 | ❌ **拒绝** |
| `criterion` | 无（仅注释英文词） | ❌ **拒绝** |
| `judge` | 无（仅注释英文词） | ❌ **拒绝** |
| `machine_check` | 无 | ❌ **拒绝** |
| `falsifiable_thresholds` | 无 | ❌ **拒绝** |
| `source_anchor` | 无 | ❌ **拒绝** |
| `required_output_ref` | 无 | ❌ **拒绝** |
| `verification_depth` | 无 | ❌ **拒绝** |
| `existence_disclaimer` | 无 | ❌ **拒绝** |
| `probe_refs` | 无 | ❌ **拒绝** |
| `boundary_refs` | 无 | ❌ **拒绝** |

**结论：14 个字段中 12 个在任何现有 kind 上都会被 `.strict()` 拒绝**（只有 `scope_ref` 与 `name` 各有 3 处/1 处现有归属）。因此 `CapabilitySpec` **必须**是**新 kind**（规格 `:38-45` 的自我判断正确），不能作为 `ProblemSpec` 的嵌套字段或挂到任何现有 kind 上。

### C-2 新 kind 写对了也会被拒的值形态（`validateRefFields` 层）

`.strict()` 只是第一道。第二道是 `ir/refs.ts`，而规格设计里有**两处该层必拒**的形态：

| # | 规格字段 | 规格的设计值 | 为何被拒 |
|---|---|---|---|
| **C-2a** | `required_output_ref`（`:123`，`refSchema.nullable()`） | `null`（非交付类能力，规格 `:123` 明写"非交付类能力为 null"；§2.2 示例 `:251` 就是 `null`） | `ir/refs.ts:246-250` 的 single 分支直接 `const ref = raw as string` 并送入 `checkRef`，**无 null 分支**；store 的 resolver（`ir/store.ts:346`）执行 `this.#objects.get(null)` → `undefined` → `resolution: 'missing'` → `toRefFailure`（`ir/store.ts:440-446`）产出 **`unresolved_reference`** → 对象被拒。schema 层放行（`.nullable()` 合法），**refs 层拒绝**，失败原因还伪装成"引用不存在" |
| **C-2b** | `falsifiable_thresholds[].at_config_ref`（`:90`，`refSchema.nullable()`，nested） | `null`（规格 `:90` 注释允许；§2.2 示例 `:215` 给了非空值但未覆盖 null 情形） | 同 C-2a，走 `ir/refs.ts:260-265` 的 nested 分支（`entry[spec.arity.child] as string`，同样无 null 分支）。nested 分支**还多一层**：即使 `at_config_ref` 为 `null` 被容忍，`subject_ref` 也必须同批解析（见 C-3） |
| **C-2c** | `falsifiable_thresholds[].subject_ref`（`:79`） | `'Result:r_q1_h.value'` / `'run_output:result1.xlsx!C2'`（规格 `:78-79` 注释与 §2.2 `:210-247`） | `ir/schema.ts:109` `refSchema = zod.string().min(1)`，**纯裸字符串**；store resolver 是扁平 `Map.get`（`ir/store.ts:346`）。`"Result:r_q1_h.value"` **永远查不到**（store 的键是 `result_id` 本身，如 `R1`）→ `unresolved_reference` → 拒绝。全仓**无任何冒号/点号引用路径解析器**（`rg "split\(':'\)"` 零命中；唯一相关命中 `produce/interpretation-producer.ts:151` 的 `path.split('.')` 是解释对象内部取字段，与 IR 引用无关）。**规格 §2.2 的整个示例实例按字面 ingest 会全部失败** |

### C-3 常量与依赖缺口（写 schema 时就会卡住）

| # | 缺口 | 后果 |
|---|---|---|
| **C-3a** | `zod.enum(PROBE_IDS)` / `zod.enum(BOUNDARY_IDS)`（规格 `:130,132`）—— 两个常量**全仓不存在** | 无法直接写；须先在 `paper-foundation` 内新建闭集常量，且其取值来源（`PROBE-TYPOLOGY.md` / `HONESTY-BOUNDARY-CLASSES.md`）**尚未提交入库** |
| **C-3b** | `zod.enum(FAMILIES)`（规格 `:106`）—— `FAMILIES` 在 `apps/paper-shell/src/route.ts:32`，**不在** `paper-foundation` | 规格 `:16` 的出处（`apps/paper-shell/src/contracts/index.ts`）错误；且 `paper-foundation` 不依赖 `apps/paper-shell`（`package.json` 无该依赖，反向成立）。须复制闭集或倒转包依赖 |
| **C-3c** | `zod.enum(MACHINE_CHECK_KINDS)` / `CAPABILITY_JUDGES` / `VERIFICATION_DEPTHS` / `THRESHOLD_OPERATORS`（规格 `:49-72`）—— 四个常量**全仓不存在** | 须新建；其中 `THRESHOLD_OPERATORS` 的 13 个算子**无任何消费方**，落地即产生"声明了但无人执行"的悬空闭集（规格 `:282` 自检声称"未引入第二套 gate"，但算子无执行方等于把 gate 推给未来的 Q1-B3 映射表） |
| **C-3d** | `unitSchema`（规格 `:87` 直接使用）—— `ir/schema.ts:113` 定义但**未 export** | 照字面 import 会编译失败；须按既有 idiom 在模块内重声明（`ir/contract-objects.ts:44-50` 是 W8.9 的先例） |
| **C-3e** | `IR_SCOPE_FIELDS` 扩展（规格 `:167`）—— 只加表行**不生效** | `ir/store.ts:353` 硬编码 `if (kind === 'ModelSpec')`；须同时改该分支。且 `scope_ref → RequirementSpec` 时 `targetScopeField` 不能沿用 `'scope_ref'`（`RequirementSpec` 无此字段，应指 `source_data_ref`，`ir/problem-contract.ts:139`） |

### C-4 规格对护栏测试的描述不成立

规格 `:169`：「既有断言"每个 kind 都在两张表里"会自动覆盖新 kind（这是 DPH 的护栏，**免费得到**）」。

实际需要手工编辑的清单：

| 文件:行 | 形态 | 不编辑的后果 |
|---|---|---|
| `ir/schema.ts:608-624` `IR_SCHEMAS` | `Record<IrKind, …>` | **编译错误** |
| `ir/schema.ts:633-649` `ID_FIELD_BY_KIND` | `Record<IrKind, string>` | **编译错误** |
| `ir/refs.ts:101-187` `IR_REF_FIELDS` | `Record<IrKind, …>` | **编译错误** |
| `tests/ir/redteam.spec.ts:436-463` `expected` | **手写 15 项字面量表**，循环断言 `IR_REF_FIELDS[kind].map(f=>f.path)` 等于它 | 断言失败（`:462`） |
| `tests/ir/fixtures.ts:365-384` `validObjectFor` | 穷尽 `switch`，无 `default` | **编译错误**（缺返回路径）+ 需新增 fixture |
| `tests/ir/fixtures.ts:387+` `validChain()` | 手写依赖顺序序列 | `schema.spec.ts:34-38` 断言失败 |
| `tests/ir/schema.spec.ts:26-31` | 遍历 `IR_KINDS` 要求每 kind 有合法 fixture | 需 fixture 到位才通过 |

护栏**确实会抓住遗漏**（这一点规格判断正确，`W8.9` 的 `schema_violation` 实证），但代价是 **4 处编译错误 + 3 个测试文件手工编辑**，不是"免费"。

---

## 4. W8.12 落地前置改动清单（一句话结论的展开）

按依赖顺序：

1. **`ir/refs.ts` 加 null 容忍**（阻塞项）：`validateRefFields` 的 single（`:246-250`）与 nested（`:260-265`）两分支须在 `checkRef` 前短路 `null`/`undefined`，否则规格设计的 `required_output_ref: null` 与 `at_config_ref: null` 必被误报 `unresolved_reference`。**这是 W8.12 最可能重演的 `.strict()` 级事故**（同类：schema 放行、下游拒绝、失败原因误导）。
2. **决定复合引用路径的归属**：`subject_ref` 的 `Result:<id>.<field>` 语法要么在 `refs.ts` 引入路径解析（新能力，规格 T-1/T-2 已列为候选扩展 `:265-266`），要么把 §2.2 的示例改为裸 `result_id` 并在别处携带字段名。**不改则规格示例无法 ingest**。
3. **闭集常量落地**：`MACHINE_CHECK_KINDS` / `CAPABILITY_JUDGES` / `VERIFICATION_DEPTHS` / `THRESHOLD_OPERATORS` / `PROBE_IDS` / `BOUNDARY_IDS` 六个常量在 `paper-foundation` 内新建；`PROBE_IDS`/`BOUNDARY_IDS` 的取值须先让 `PROBE-TYPOLOGY.md` / `HONESTY-BOUNDARY-CLASSES.md` 入库。
4. **`family` 的来源决策**：复制 `FAMILIES` 闭集到 `paper-foundation`（并在 F1/F2 无契约期间接受"枚举合法但无契约"），或倒转包依赖。
5. **`IR_SCOPE_FIELDS` 生效路径**：除加表行外，改 `ir/store.ts:353` 的 kind 判断；`scope_ref → RequirementSpec` 的 `targetScopeField` 须为 `source_data_ref`。
6. **回填规格盲区**：把 `e1_span`（已落地的推理层锚点）与 `source_anchor`（未落地的题面层锚点）在 `CAPABILITY-SCHEMA.md` 中并置说明——当前规格完全不知道 `e1_span` 存在，W8.12 有按规格字面实现出一条**与 W8.9 平行且不连通**的锚点链的风险。

---

## 5. 核对方法留痕

- 规格字段清单：`docs/quality/CAPABILITY-SCHEMA.md:12-28`（§0 表）、`:104-132`（zod 定义）、`:159-171`（§1.1 登记表）。
- 实现基线：`ir/schema.ts`（15 kind / `.strict()` / `ID_FIELD_BY_KIND`）、`ir/problem-contract.ts`（`RequirementSpec.source_span` / `REQUIREMENT_TYPES`）、`ir/contract-objects.ts`（`AssumptionSpec`/`EquationSpec` + `e1_span`）、`ir/refs.ts`（`IR_REF_FIELDS` / `IR_SCOPE_FIELDS` / `validateRefFields`）、`ir/store.ts`（`#admit` 提交边界）。
- 逐名核对：对 `capability_id` / `criterion` / `judge` / `machine_check` / `source_anchor` / `required_output_ref` / `verification_depth` / `probe_refs` / `boundary_refs` / `existence_disclaimer` / `falsifiable_thresholds` / `subject_ref` / `at_config_ref` / `PROBE_IDS` / `BOUNDARY_IDS` / `MACHINE_CHECK_KINDS` / `CAPABILITY_JUDGES` / `VERIFICATION_DEPTHS` / `THRESHOLD_OPERATORS` / `CapabilitySpec` 逐个 `rg` 全仓 `packages/` + `apps/` 的 `*.ts`，除表中标注者外均零命中。
- 未执行：任何写操作；`npm test`（按任务约束）。
