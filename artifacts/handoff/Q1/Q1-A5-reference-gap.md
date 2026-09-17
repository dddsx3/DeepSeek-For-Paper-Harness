# 引用缺口登记（Q1-A5）

> **产物编号**：Q1-A5　**要求**（§3.1-A5）：登记 `[Q-13]` 引用的 `CROSS_PROBLEM_LEDGER.json`（`[F-27]`）在工作区内**不存在**这一事实，并把它作为 DPH 侧的一条**反面样例**（"报告声称 > 实物存在"）。
> **禁止**：忽视该缺口，或假定文件"大概在别处"。

---

## 1. 缺口登记条目

| 字段 | 值 |
|---|---|
| **缺口编号** | **G-1** |
| **声称者** | `[F-09]`（`MODELING_REPORT.md`）第 **1487** 行（实测定位） |
| **声称原文（逐字）** | `| 机器块可解析性 \| `LOGIC_CONTRACT_MACHINE`（12 顶层键）与 `CROSS_PROBLEM_LEDGER.json`（5 顶层键）均为合法 JSON \|` |
| **声称内容** | ① 该文件存在；② 它是合法 JSON；③ 它有 **5 个顶层键** |
| **实测结果** | 全工作区（`[F-01]`，255 文件，排除 `.git`）按文件名 `CROSS_PROBLEM_LEDGER` 搜索 → **0 命中** |
| **同表另一半的对照** | 同一行声称的 `LOGIC_CONTRACT_MACHINE`（12 顶层键）→ **实测成立**：块位于 `[F-09]` 行 **995–1242**，HTML 注释内嵌 JSON，顶层键实测 **n=12**，与声称**逐字一致** |
| **缺口的性质** | **非对称**：同一句声称中，一半为真（机块）、一半为假（台账）。因此**不是"整句编造"，而是"部分声称未对账"** |
| **严重度** | **minor**（不使数值作废；但它使"机器块可解析性"这一校核项的**覆盖范围被高估**——声称校核了 2 个对象，实际只校核了 1 个） |
| **处置（本支线）** | **N9：禁止引用 `[F-27]`**。本支线所有产物**不得**引用该文件；任何"跨问题台账"类需求须由 DPH 侧的 `IR_KINDS` 对象（`Claim` / `Result` / `ModelSpec` 的引用关系）承担 |
| **出处** | `[Q-13]` / `[F-27]` / §0.5-D-1 |

---

## 2. 与 DPH `fake` 基线的类比（任务书要求）

> **类比目标**：`bench/results/2024-A|B|C` 的 `provider_mode = 'fake'` 基线（合成 provider，非真实模型）。

| 维度 | 材料侧 G-1 | DPH `fake` 基线 |
|---|---|---|
| **共同结构** | **声称的能力 > 实际的产物**：报告声称"校核了 2 个机器块"，实物只有 1 个 | **声称的产出 > 实际的来源**：`fake` 运行产生了 `deliverable.zip` / `report.md` / `run-report.json`，形态与真实运行**不可区分**，但内容来自合成 provider |
| **可区分性机制** | ❌ **无**。报告是自由文本，声称与实物之间没有机械连接；读者若不去 `find`，永远发现不了 | ✅ **有**。`provider_mode` 是**必填字段**（`bench/metrics/compute-metrics.mjs:176-180`），由目录约定（`/-real(-shard)?$/`）机械派生；`bench/PREREGISTRATION.md:93` 红线 N2 明确要求"fake 与 real 结果必须机械可区分" |
| **谁更安全** | 更危险：缺口由**人工复核**才发现（且本例中是在**本支线的出处核验**阶段才发现的） | 更安全：缺口由**字段**暴露，聚合时按 `(family, provider_mode)` 分键，`fake` 与 `real` **不可能被混算** |
| **教训** | 自由文本中的声称**必须有对应的存在性断言**，否则"声称"会静默地超出"实物" | — |

> **这正是任务书 §7-Q7 预登记的情形**："复核中发现更多类似 §0.5-D-1 的引用缺口 → 说明该工作流的'报告↔实物'一致性本身有漏网 → 反过来印证 DPH'用哈希 + 断言把声称钉死'的价值。"
>
> **本支线的实测结论支持该预登记**：G-1 是**在出处核验阶段（读报告时顺手 `find`）发现的**，而非由任何自动化检查发现。材料侧的 `AUDIT_REPORT.md`（`[F-08]`）报 `fatal: 0, warn: 2`，**未包含此缺口**——说明该缺口**穿透了材料侧的全部自动审计**。

---

## 3. DPH 侧的对应能力（正面样板）

| DPH 机制 | 如何把"声称"钉死到"实物" | 文件 |
|---|---|---|
| **`content_hash`** | 每个 `DataArtifact` 携带 `sha256:<64 hex>`，声称引用某数据时必须给出可校验的哈希 | `packages/paper/paper-foundation/src/ir/schema.ts`（`DataArtifact`） |
| **`reference_validation` 门** | 独立重走 `IR_REF_FIELDS`，每个引用必须解析到**声明类型的**目标；解析失败即 FAIL（不是静默跳过） | `packages/paper/paper-foundation/src/delivery/reference-validation.ts` |
| **`stale_detection` 门** | S-001..S-009 的 STALE 证据走查，含 S-007 **字节校验**（`ctx.loadCode`） | `packages/paper/paper-foundation/src/ir/stale.ts` |
| **`buildEvidenceFreeze` / `auditEvidenceFreeze`** | 证据冻结与审计，`canonicalJson` + `sha256Hex` + 依赖闭包指纹 | `packages/paper/paper-foundation/src/ir/evidence-freeze.ts` |
| **`.strict()` 模式** | zod schema 的 `.strict()` 使**未声明的键是硬拒绝**（`schema_invalid`），绝不静默忽略 | `ir/schema.ts` 全部 schema |
| **`producer_unimplemented`** | 注册表知道但实现缺失的门，报为**闭集失败类型**，"never a silent PASS" | `delivery/gate-registry.ts` 头注释逐字 |

> **对比结论**：DPH 的机制能防住 G-1 类缺口——**只要该声称是一个 IR 对象**（有 `ref` 字段、有 `content_hash`）。G-1 之所以发生，是因为它的声称**只存在于论文自由文本中**，而材料侧**没有"论文自由文本 ↔ IR 对象"的双向对账**。
>
> 这直接指向 Q1-B3 映射表中的一个"全新"条目：**自由文本中的声称必须能回指到 IR 对象**（详见 Q1-B3 与 Q1-D1）。

---

## 4. 本支线的自检（防止自己复制这个缺口）

> **纪律**：本支线全部产物的每一处文件引用，都必须在写完后**实测存在**。下面是本支线对自己做的对账（**即 G-1 的教训应用于自身**）。

| 本支线引用的文件 | 存在性（实测） |
|---|---|
| `[F-01]` 下 14 个带 sha256 的文件（§0.5-A） | ✅ 14/14 指纹逐位匹配 |
| `packages/paper/paper-foundation/src/delivery/gate-registry.ts` | ✅ 存在（496 行） |
| `packages/paper/paper-foundation/src/delivery/delivery-policy.ts` | ✅ 存在（`CRITICAL_GATE_IDS` 9 项） |
| `packages/paper/paper-foundation/src/verification/v-structure.ts`（V1–V4） | ✅ 存在 |
| `packages/paper/paper-foundation/src/verification/v5-adversarial.ts`（V5） | ✅ 存在 |
| `packages/paper/paper-foundation/src/verification/v6-model-choice.ts`（V6） | ✅ 存在 |
| `packages/paper/paper-foundation/src/verification/v7-sympy.ts`（V7） | ✅ 存在 |
| `packages/paper/paper-foundation/src/delivery/delivery-grade.ts`（`MARKED`） | ✅ 存在 |
| `apps/paper-shell/src/contracts/f3.ts` / `f4.ts` / `types.ts` / `index.ts` | ✅ 存在 |
| `bench/problems/2024-B/problem-faithful.md` | ✅ 存在（4092 B） |
| `bench/TRUTH-FAMILIES.json` | ✅ 存在（2024-B = `F3+F4`） |
| `bench/negative-controls/README.md` | ✅ 存在 |
| `bench/metrics/compute-metrics.mjs` | ✅ 存在 |
| `[F-27]` `CROSS_PROBLEM_LEDGER.json` | ❌ **不存在（本登记条目 G-1）**——**本支线全部产物中除本文件外，不得出现对该文件的引用** |

> **复现命令**（供日后核验本登记未被误改）：
> ```bash
> cd "C:\Users\35702\Desktop\CUMCM\workspaces\5ba6e7bd5010"
> find . -name "*CROSS_PROBLEM_LEDGER*"          # 期望：0 命中
> sed -n '1487p' MODELING_REPORT.md               # 期望：含 CROSS_PROBLEM_LEDGER.json（5 顶层键）
> ```
