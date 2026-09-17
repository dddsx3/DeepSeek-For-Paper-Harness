# M5（配置一致性）的检查设计（Q1-B4）

> **产物编号**：Q1-B4　**要求**（§3.2-B4）：设计"**校核配置 == 交付配置**"的机械检查。给出：① 比对对象（哪些参数必须一致）；② 不一致时的处置（**拒交付 vs 标注**）；③ **DPH 里对应哪些既有字段**。
> **禁止**：设计成"人工提醒"。**它必须能自动拒或自动标注。**
> **出处**：`[Q-05]`（F1 标题）+ `[P-09]`（`.where` = `code/problem1.py:19,62,139 + RESULTS.md:44-45 + figures/problem_1_results.json.analytic_max_dev_degC`）。

---

## 0. 为什么这是 DPH 最缺的一条（先立问题）

`[P-08][0]`（F1 major）的原文机制：

| 环节 | 配置 | 结果 |
|---|---|---|
| 解析校核（`cross_check()`） | `dt = 0.25` | 最大偏差 **2.9459e-4** ⇒ `assert < 1e-3` **通过** |
| 交付产物（`result1.xlsx`） | `dt = 1.0` | 实测最大偏差 **1.1945e-3** ⇒ **超 1e-3 限** |

**两侧各自都"合法"**：校核确实通过了自己的断言；交付确实产出了表格。**错误只存在于两者的配对关系上**——"用 A 配置的校核结论为 B 配置的交付背书"。

> **这是 DPH 全部 9 道 critical gate + V1–V7 都**无法**表达的一类问题**，理由见 `GATE-MAPPING.md` §2.1：**所有既有门都只看单个产物的内部自洽性**（"这个 Claim 的值与它的 Result 相等吗"、"这个 Result 的 run 有 ExecutionRecord 吗"），而 M5 是**跨产物的关系断言**。

**DPH 的缺口是实测确认的**（不是推测）：

| 检索 | 结果 |
|---|---|
| `solver_config` / `solverConfig` / `numeric_config` / `time_step` / `timestep` / `\bdt\b`（`packages/paper/paper-foundation/src/ir/`） | **0 命中** |
| `ExecutionRecord` 的字段（`ir/schema.ts:415-443`） | `execution_id / run_ref / code_hash / environment_hash / runtime_fingerprint_hash / dependency_lock_hash / input_data_refs / output_refs / output_hash / stdout_hash / stderr_hash / exit_status / seed / started_at / finished_at`——**无数值配置字段** |
| `RunArtifact` 的字段（`ir/schema.ts:208-226`） | `run_id / model_ref / code_ref / input_data_refs / environment / seed / exit_status / stdout_ref / stderr_ref / output_refs / code_hash / input_hash / output_hash`——**无数值配置字段** |
| `environment` 的类型 | `textSchema`（**自由文本**，1–65536 字符） |
| `declaredEnvironmentFingerprint` 的哈希输入（`ir/evidence-freeze.ts:153-155`） | `sha256Hex(canonicalJson({ environment: run['environment'], seed: run['seed'] }))`——**只覆盖 `environment` 与 `seed` 两个字段** |

> **§7-Q4 预登记逐字**："M5 在 DPH 上找不到对应字段 → DPH 的 IR 从未记录'校核配置' → 需新增对象，成本高于预期"
>
> **实测结论：预登记成立。** DPH **没有**任何记录数值求解配置的字段。`environment` 虽可**塞入**（它是自由文本），但那是**把配置藏进字符串**——无法比较、无法哈希出有意义的差异、无法机械断言相等。

---

## 1. 比对对象：哪些参数必须一致

> **设计原则**：只纳入**能改变数值结果**的参数。形态类参数（如输出小数位数）不属于 M5（属 `GATE-MAPPING.md` 的 E-5）。

### 1.1 参数分类（按"是否影响数值解"）

| 类别 | 参数 | 必须一致？ | 理由 |
|---|---|---|---|
| **离散化** | 空间节点数 `N` / 步长 `dr` | ✅ **必须** | 直接决定截断误差。材料侧 F1 major 的核心（`dt`），网格方向实测已收敛（`N200→400` 差 `1.08e-5`） |
| | 时间步 `dt` | ✅ **必须** | **材料侧 F1 major 的直接对象**（`0.25` vs `1.0`） |
| | 时间积分格式（显式/隐式/Crank-Nicolson） | ✅ **必须** | 一阶/二阶格式的误差量级不同 |
| **物理参数** | 物性组（附录 2/3/4） | ✅ **必须** | 材料侧 `P2-C1`/`P4-C3` 的互斥性要求；混用造成成倍偏差（附录 3 vs 4 的 `D` 差 5.39 倍） |
| | 边界条件类型与系数（`h`, `hm`） | ✅ **必须** | 决定表面通量 |
| | 判据阈值（`0.15`） | ✅ **必须** | 决定 `t*` 的定义 |
| | 界面扩散系数取法（先平均 C / 算术平均 D） | ✅ **必须** | 材料侧实测偏差 **3.5%**（`P3-C4` 的 (iii)） |
| **算法选择** | 线性求解器 / 迭代容差 | ✅ **必须** | 迭代未收敛会污染解 |
| | 随机种子 | ✅ 必须（若随机） | DPH 已有 `seed`（`INV-3-A`） |
| **输出形态** | 输出抽样步长（`0.1 cm`） | ❌ **不纳入** | 只影响交付表的分辨率，不影响解的精度。属 E-5 交付形态检查 |
| | 小数位数（4 位） | ❌ **不纳入** | 同上 |
| | 表头/列名/sheet 名 | ❌ **不纳入** | 同上 |

### 1.2 比对的三类对象对（**这是本设计的核心结构**）

> M5 不是"两个值相等"这一种检查，而是**三类关系**。材料侧 F1 major 只暴露了第一类；另两类在材料侧以不同形式出现。

| # | 对象对 | 断言 | 材料侧实例 |
|---|---|---|---|
| **C-1　校核 ↔ 交付** | `cross_check()` 的配置 vs **交付产物**的配置 | 逐字段相等 | `[P-08][0]`（F1 major）：`dt=0.25` vs `dt=1.0` |
| **C-2　声明 ↔ 实际** | 产物侧 JSON/MD 记录的配置 vs **代码实际调用**的配置 | 逐字段相等 | `[P-08][4]`（minor）：`figures/problem_3_results.json` 记 `dt=0.5`，但 `problem3.py:58` 主算例实跑 `run_to_tstar(200, 0.2)` |
| **C-3　跨问/跨段 ↔ 主答案** | 同一模型在不同问/不同归因段使用的配置 | 逐字段相等，**或**在表中显式标注各段配置 | `[P-08][3]`（minor）：归因表 C 行用 `N=200` 而增量按 `N=100` 算（差 0.103%）；B 段 `dt=1.0` 而 A/C 用 `dt=0.5` |

> **C-3 的处置与 C-1/C-2 不同**：C-3 允许"配置不同但**已声明**"（材料侧 `[P-08][3]` 的 `fix` 逐字："归因表加'网格'列，或统一在 N=100 陈述增量"）。故 C-3 的失败条件是"**配置不同且未声明**"，不是"配置不同"。

---

## 2. 处置设计：拒交付 vs 标注（**逐类裁决**）

> **禁止人工提醒**。下面的每一类都有**自动**处置。裁决依据是 DPH 既有的 **fail-soft 分级**（`delivery/delivery-grade.ts`）：`CLEAN` / `MARKED` / `BLOCKED`，其中 `FatalConditions = { emptyContent, executionFailed, referenceCatastrophe }` 是**闭集**，"everything else degrades to MARKED"。

| # | 情形 | 处置 | 机制 | 理由 |
|---|---|---|---|---|
| **D-1** | C-1 不一致（校核配置 ≠ 交付配置） | **标注（MARKED）**，且**标注必须携带两侧配置的具体数值与超限证据** | 归入 `GradeAnnotation{kind:'config_mismatch', reason, location}`，由 `renderDeliveryAppendix` 生成附录表格行 | **不拒交付的理由**：交付产物本身可能是**正确**的（材料侧 `dt=1.0` 的解"网格已收敛，欠收敛的只是时间步"——交付表的偏差 `1.19e-3` 只超限 19%）。**拒交付会否掉一个可用产物**。但**必须标注**，因为"用校核结论为交付背书"是**证据链断裂** |
| **D-2** | C-1 不一致 **且** 交付配置未过任何校核 | **拒交付（BLOCKED）** | 新增 `DeliveryFailure` kind：`config_evidence_missing` | 此时**交付产物没有任何配置下的校核证据**——"未验证的产物"是不可交付的。这是 DPH 的 fail-closed 精神（对照 `delivery-policy.ts` 头注释："`BLOCKED` is only possible if at least one item on the list triggered"） |
| **D-3** | C-2 不一致（声明 ≠ 实际） | **拒交付（BLOCKED）** | 复用既有 `DeliveryFailure` 语义（元数据与实际不符 = `numeric_consistency` 的同族） | **与 D-1 的区别**：C-2 是**元数据错误**（记录的值不是实跑的值）——这是**记录失真**，不是配置选择问题。DPH 的 `ExecutionRecord` 是"the canonical record of one real execution"，**声明与实际不符即记录不可信** ⇒ 必须拒 |
| **D-4** | C-3 不一致 **且** 未声明 | **标注（MARKED）** | `GradeAnnotation{kind:'config_undeclared_span', ...}` | 归因/对比分析**允许**用不同配置（受控算例是合法方法），但必须声明。未声明 ⇒ 表内不自洽 ⇒ 标注 |
| **D-5** | C-3 不一致 **但** 已声明 | **通过（不标注）** | — | 已声明的配置差异是**方法的一部分**（如材料侧 B 段 `dt=1.0` 的理由："附录4 的 D 小 5.39 倍，稳定限宽"）。**这条是防误报的关键**（M7） |
| **D-6** | 配置缺失（IR 中无记录） | **拒交付（BLOCKED）** | `config_evidence_missing`（同 D-2） | **fail-closed**：无记录 ⇒ 无法断言一致性 ⇒ 不得交付。**这条使 M5 的落地成本变成"必须先记录配置"**——这是 §7-Q4 说的"成本高于预期"的准确形态 |

> **D-6 是最重要的一条**：它把"IR 没有配置字段"这一现状变成**可检测的阻塞**，而不是**静默的假绿**。若 M5 只做 D-1..D-5 而不做 D-6，则"配置未记录"的产物会**因为无数据可比而通过**——**这正是材料侧 F1 major 能溜过去的原因**（校核与交付的配置从未被并置记录）。

---

## 3. 在 DPH 的 IR 里能落地的字段路径（**实测**）

> 本节回答 §3.2-B4 的"③ DPH 里对应哪些既有字段"。**结论：既有字段不足，需新增一个对象**（成本已实测）。

### 3.1 既有字段（**实测可得**，不足以承载）

| 候选既有字段 | 位置 | 能否承载 M5？ | 实测理由 |
|---|---|---|---|
| `ExecutionRecord.environment_hash` | `ir/schema.ts:423` | ❌ | 是 `sha256` 指纹（`fingerprintSchema`）——**只能判"是否相同"，无法报"差在哪"**。M5 的标注必须给出两侧的具体数值（D-1 要求） |
| `RunArtifact.environment` | `ir/schema.ts:214` | ⚠️ **可塞入但不可比较** | 类型是 `textSchema`（自由文本）。把 `dt=0.25` 写成 `"dt=0.25"` 后，**机械比较退化为字符串比较**：`"dt=0.25"` vs `"dt=0.250"` vs `"dt = 0.25"` 会被判为不一致（**误报**），而 `"dt=0.25"` vs `"dt=0.25, N=200"` 又无法逐字段对齐（**漏报**） |
| `RunArtifact.code_hash` | `ir/schema.ts:223` | ❌ | 代码哈希相同 ⇒ 配置相同（**充分**），但配置不同也可能代码哈希不同（**必要**）——**不能反推**。且校核代码与交付代码**本来就是两份不同的代码**（材料侧 `cross_check()` vs 交付脚本） |
| `ExecutionRecord.seed` | `ir/schema.ts:440` | ❌ | 只覆盖随机种子（M5 的一个子项） |
| `ExperimentSpec.parameter_sweep[{symbol_ref, values[]}]` | `ir/contract-objects.ts` | ⚠️ **部分** | `parameter_sweep` **正是"配置扫描"的形状**（`symbol_ref` + `values[]`）。若把 `N`/`dt` 建成 `SymbolSpec`（`role=PARAMETER`），则扫描可表达。**但它只表达"扫过哪些值"，不表达"本次交付用的是哪个值"**——缺"选定值"字段 |

> **实测的关键缺口**：既有字段能表达"**配置的指纹**"（`environment_hash`）与"**配置的扫描**"（`parameter_sweep`），但**没有一个字段表达"本次执行**选定**的配置值**"。**这正是 M5 的落点缺口。**

### 3.2 需新增的对象（**最小形态**）

```ts
/**
 * NumericConfig — Q1-B4 (DPH-Q 支线规格, 未实施).
 *
 * 目的: 给"一次数值求解的配置"一个**可比较、可报差异**的 IR 身份。
 * 为什么不能复用 environment: 它是 textSchema, 比较会退化为字符串比较
 * (误报 "dt=0.25" vs "dt=0.250"), 且无法逐字段报差异。
 * 为什么不能只存哈希: 标注(D-1)必须给出两侧的具体数值。
 */
export const numericConfigSchema = zod
  .object({
    config_id: idSchema,
    /** 离散化参数。key 必须是 SymbolSpec 的 token(NFC), value 是数值。 */
    discretization: zod.array(
      zod.object({ symbol_ref: refSchema, value: zod.number() }).strict(),
    ),
    /** 物理/算法参数(物性组、h/hm、阈值、界面取法…)。 */
    physical: zod.array(
      zod.object({ symbol_ref: refSchema, value: zod.number() }).strict(),
    ),
    /** 离散/算法选择的**枚举**选择(显式/隐式格式、求解器名)。 */
    choices: zod.array(
      zod.object({ key: idSchema, value: textSchema }).strict(),
    ),
    /** 物性组标识(如 'appendix-2' / 'appendix-3' / 'appendix-4')。
     *  材料侧的"三套物性混用"正是这个字段的不一致。 */
    property_set: textSchema.nullable(),
  })
  .strict()
```

**挂载点（两处，均为既有字段的类型收窄或引用新增）**：

| 挂载点 | 改动 | 说明 |
|---|---|---|
| `RunArtifact` | 新增 `config_ref: refSchema`（指向 `NumericConfig`） | 使"这次运行用了什么配置"成为**可解析的引用**（进 `IR_REF_FIELDS`，由 G7 `reference_validation` 门保证可解析） |
| `CapabilitySpec.falsifiable_thresholds[].at_config_ref` | **已在本支线 schema 中预留**（`CAPABILITY-SCHEMA.md` §1） | 使"这条阈值是在哪个配置下断言的"成为字段。**这是 M5 能机械化的前提**——否则"校核的配置"本身无处安放 |

> **注意**：`NumericConfig` 的字段**不是**我发明的分类——`discretization` / `physical` / `choices` / `property_set` 四组直接对应 §1.1 的分类表。**这是从材料侧的实测问题反推出的最小字段集**，不是先设计 schema 再找用例。

### 3.3 检查的落点（**不新建门**）

| 检查 | 落点 | 与 N4 的关系 |
|---|---|---|
| **C-1 / C-2 / C-3 的比较** | **G2 `execution` 门**（`delivery/execution-gate.ts`） | G2 已走查"claim 链抵达已提交的 `ExecutionRecord`"。**配置一致性是该走查的下一步**：抵达之后，比对 `config_ref` 指向的 `NumericConfig`。**是扩展，不是新门** |
| **配置缺失（D-6）** | **G2** 同上 | 无 `config_ref` ⇒ 与"无 `ExecutionRecord`"同族 ⇒ 报 `config_evidence_missing` |
| **`config_ref` 可解析** | **G7 `reference_validation`** | 只需在 `IR_REF_FIELDS` 登记 `RunArtifact.config_ref → NumericConfig`。**零新代码** |
| **配置值进指纹** | **`ir/evidence-freeze.ts`** 的 `declaredEnvironmentFingerprint` | 当前哈希输入是 `{environment, seed}`。扩展为 `{environment, seed, config}`（**须改 `-v1` 命名空间为 `-v2`**，否则旧指纹会被静默重解释） |

---

## 4. 为什么这条检查在材料侧**不存在**（诊断，供 DPH 借鉴）

> **诊断的价值**：如果 M5 只是"漏了一条检查"，那补上即可。但若它有**结构性原因**，则 DPH 也必须改结构。

| 环节 | 材料侧的做法 | 为何漏掉 M5 |
|---|---|---|
| 校核 | `cross_check()` 在 `code/problem1.py:19,62,139`，**内嵌在问题 1 的脚本里** | 校核与交付**在同一份代码里**，作者自然认为"用同一份代码 = 同一配置"。**配置是脚本内的常量，不是被记录的对象** |
| 交付 | 同一脚本用 `DT=1.0` 产出 `result1.xlsx` | 交付时改常量是**正常操作**（为了跑得快），改动的**语义后果**（校核失效）不可见 |
| 记录 | `figures/problem_1_results.json.analytic_max_dev_degC` 记了**校核的偏差值**，但**没记它跑在哪个 `dt`** | 记录了**结果**，没记录**结果的前提** |

> **结构性原因**：**配置在材料侧是"代码里的常量"，而不是"IR 里的对象"。** 常量可以在不同位置取不同值，而**没有任何机制把两个位置的值并置**。
>
> **DPH 的诊断**：DPH **同样**没有把配置对象化（实测：`dt`/`N` 在 `ir/` 下 0 命中）。**故 DPH 有与材料侧完全相同的结构缺陷**——只是尚未被一道真题触发（W8.8 的 E2E 全部 BLOCKED，未产出交付物）。
>
> **这解释了为什么 §7-Q4 的预登记是对的**：M5 不是"缺一条检查"，而是"**缺一类对象**"。补检查是治标，对象化配置是治本。

---

## 5. 与既有 DPH 机制的接缝（**实施顺序建议**）

| 步 | 动作 | 依赖 | 可否独立 |
|---|---|---|---|
| 1 | 定义 `NumericConfig` schema + 登记 `IR_KINDS`/`IR_SCHEMAS`/`ID_FIELD_BY_KIND`/`IR_REF_FIELDS` | 无 | ✅ 可独立 |
| 2 | `RunArtifact.config_ref` 字段 + `IR_REF_FIELDS` 登记 | 步 1 | ✅ |
| 3 | G2 扩展：配置一致性走查（C-1/C-2/C-3） | 步 2 | ✅ |
| 4 | `GradeAnnotation` 新增 `config_mismatch` / `config_undeclared_span` kinds | 步 3 | ✅ |
| 5 | `DeliveryFailure` 新增 `config_evidence_missing` kind（闭集扩展，须改 `delivery-policy.ts`） | 步 3 | ✅ |
| 6 | `evidence-freeze` 指纹纳入 `config`（**须升命名空间 `-v1`→`-v2`**） | 步 2 | ⚠️ **会改既有指纹**，须与 golden 文件（`tests/ir/golden/ir-fingerprints-v1.json`）同步 |
| 7 | 生产者：从 `code_ref` 抽取配置（**最难**） | 步 2 | ❌ **需新机制**——配置从哪来？ |

> **步 7 是本设计的真实难点**，必须如实指出：`NumericConfig` 是 IR 对象，但**配置值存在于代码文本里**（`DT=1.0`）。**谁来抽取？**
>
> 三个候选（**未裁决，属 Q1-D1 的规格内容**）：
> 1. **声明式**：要求求解脚本在运行时**输出**一份配置 JSON（如 `figures/problem_1_results.json` 已存在的形态），由 producer 读入 IR。**成本低，但依赖脚本自觉**——"自觉"正是 DPH 一贯要避免的。
> 2. **静态抽取**：从 `code_ref` 的源码文本里解析配置常量。**成本高，且对写法敏感**（正则解析 Python 常量易误报）。
> 3. **执行期捕获**：由 `ExecutionRecord` 的捕获接缝（`src/execution/capture.ts`）在运行时**注入**配置记录。**最可靠**（与 DPH"capture attestation"的既有精神一致），但需 runtime 支持。
>
> **本支线的建议**：**候选 3**（执行期捕获）——它与 DPH 既有的 `ExecutionRecord` 捕获机制同源，且能保证"记录的是**实跑**的值"（这正是 C-2 要断言的）。**但需实测 runtime 是否支持注入**，属实施前的验证项。

---

## 6. 自检

| 检查 | 结果 |
|---|---|
| 是否给出比对对象？ | ✅ §1.1 按"是否影响数值解"分类；§1.2 三类对象对（C-1/C-2/C-3） |
| 是否给出不一致时的处置？ | ✅ §2 六条（D-1..D-6），**每条都有自动处置**（MARKED 或 BLOCKED），无人工提醒 |
| 是否给出 DPH 字段路径？ | ✅ §3.1 五个既有字段的**实测**评估（含 `environment` 是自由文本这一关键事实）+ §3.2 需新增的 `NumericConfig` + §3.3 落点（不新建门） |
| 是否违反"禁止人工提醒"？ | ❌ 未违反。全部处置为 `GradeAnnotation`（自动生成附录）或 `DeliveryFailure`（自动阻塞） |
| 是否记录了难点？ | ✅ §5 步 7（配置从哪来），给出三个候选与建议，**明确标注未裁决** |
| 是否核实 §7-Q4 预登记？ | ✅ **成立**。实测 0 命中；`environment` 是自由文本；成本确认"高于预期"（需新增对象 + 生产者机制） |
