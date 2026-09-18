# real-run-3 失败归档（W8.10-D2）

> **归档纪律**：本文引用的所有原始文本均逐字来自磁盘，未做美化、总结替代或删减。
> 磁盘上没有的数据一律标注「**未留存**」，不做推测性补写。
> 来源：`apps/paper-shell/src/paper-shell-persist-eXRp4h/paper_audit.json`（sha256 `f12a307b76e440d03f7694b8f43f8e8a0fa8172df9acd946c32d95a7b3494443`）、
> `apps/paper-shell/src/paper-shell-persist-eXRp4h/paper_workflow.json`（sha256 `4178ae9af37e1a2ccae290d82d6d04a12f7fe573e71cb9da26261554887be38d`）、
> `artifacts/handoff/W8.10/real-run-3/run-report.json`（已有产物，本次未修改）。

## 1. 结论速览

| 项 | 值 | 来源 |
|---|---|---|
| runId | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | run-report.json |
| tier / mode | T1 / strict | run-report.json |
| status | **BLOCKED** | run-report.json；workflow runs.status = `failed` |
| routed_family / route_truth | F4 / F3+F4 | run-report.json |
| route_mismatch | false | run-report.json |
| **失败码 code** | `gate-failed` | run-report.json |
| **classifier** | `none` | run-report.json |
| **失败节点** | `execute`（attempts 3，maxAttempts 3，node state `failed`） | run-report.json memo.failing_node + workflow nodes |
| **失败 gate** | `ir_producer` | audit `gate_failed` 事件 seq 29 |
| minted_ir_count / kinds | 3（DataArtifact, RequirementSpec, ProblemSpec） | run-report.json |
| passed_gates | plan | run-report.json |
| wall_clock_seconds | 347.5（workflow createdAt→updatedAt = 347.521 s） | run-report.json / workflow runs |
| usage | input 13744 / output 17324 / cost_usd 0 | run-report.json（与 workflow 5 条 usage 事件求和一致） |

## 2. 失败码

```json
{
  "code": "gate-failed",
  "classifier": "none",
  "humanized": "模型没有给出可用结构（引擎引导了几次仍未对齐），这次运行被判为失败。"
}
```

`humanized` 为 run-report.json 中逐字原文（未润色）。`classifier` 为 `none`，表示本次未落到分类器分支。

## 3. 失败层（哪个节点 / 哪个 gate）

- 节点：`execute`（nodeId `4333deb3-97a5-402e-ab43-e97ec5c39c7d`，type `execute`，role `executor`），state `failed`，attempts `3`/`3`，`lastErrorCode` = `null`。
- gate：`ir_producer`，逐字 reason：`DRIFT guidance budget exhausted`（seq 29）。
- 该 gate 的抛出点：`packages/paper/paper-foundation/src/executor.ts:1832`（`gate: 'ir_producer'`）。
- 逐次尝试的 gate 层失败码：attempt 1 = `E1_E2_FIDELITY_VIOLATION`（w4Class `DRIFT`）；attempt 2 = `E1_E2_FIDELITY_VIOLATION`（w4Class `DRIFT`）。

## 4. 原始错误文本

### 4.1 落盘原文（逐字）

- `gate_failed`（seq 29）reason：

```text
DRIFT guidance budget exhausted
```

- 每次 attempt 的 `provider_retry` 事件：

```json
[
  {
    "code": "E1_E2_FIDELITY_VIOLATION",
    "role": "executor",
    "attempt": 1,
    "w4Class": "DRIFT"
  },
  {
    "code": "E1_E2_FIDELITY_VIOLATION",
    "role": "executor",
    "attempt": 2,
    "w4Class": "DRIFT"
  }
]
```

- 每次 attempt 的拒绝理由（`FidelityFinding.detail`，逐字，落盘上限 400 字符）：

  - **attempt 1**：

    - `B3 正向（声明须逐字锚定 E1）`（原文 138 字符）：

      ```text
      EQ-BINOMIAL: 未声明 e1_span；EQ-REJECT: 未声明 e1_span；EQ-ACCEPT: 未声明 e1_span；EQ-PROFIT: 未声明 e1_span；EQ-REVENUE: 未声明 e1_span；EQ-COST: 未声明 e1_span
      ```

  - **attempt 2**：

    - `B3 正向（声明须逐字锚定 E1）`（原文 400 字符，已在落盘时截断）：

      ```text
      A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SINGLE-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-DISASSEMBLY-PERFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-LINEAR-COSTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-ASSEMBLY-INDEPENDENCE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SYMMETRIC-COMPONENTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-BETA-PRIOR: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SAMPLING-REPRESENTATIVE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-BINOMIA
      ```

  - **attempt 3**：

    - `B3 正向（声明须逐字锚定 E1）`（原文 400 字符，已在落盘时截断）：

      ```text
      A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SINGLE-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-DISASSEMBLY-PERFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-LINEAR-COSTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-ASSEMBLY-INDEPENDENCE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SYMMETRIC-COMPONENTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-BETA-PRIOR: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SAMPLING-REPRESENTATIVE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-BINOMIA
      ```

### 4.2 未留存

- **抛出的 Error.message 未留存。** `executor.ts:1834-1837` 构造的 `WorkflowExecutionError` 文本（`node '<id>' exhausted 2 guided retries (DRIFT): EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)`）只作为异常抛出，未写入任何持久化产物：
  - `paper_workflow.json` 只记录状态迁移（`node_state running→failed`、`run_state running→failed`），无 message 字段；对两个持久化文件检索 `exhausted`/`refused` 仅命中 `gate_failed.reason` 一处。
- 每次 attempt 的完整 E2 模型输出文本未留存（只有长度 `chars` 与拒绝理由摘录）。
- 完整 E1 分析文本未留存（只有长度 `chars`）。

### 4.3 代码模板（非落盘原文，仅用于核对措辞）

以下文本**不是**磁盘上的归档数据，而是从源码模板代入本次 nodeId 后的重建，仅供复盘核对措辞：

```text
node '4333deb3-97a5-402e-ab43-e97ec5c39c7d' exhausted 2 guided retries (DRIFT): EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)
```

（模板出处：`packages/paper/paper-foundation/src/executor.ts:1834-1837`；`2` = `NONE_RETRY_BUDGET`，定义在 `packages/paper/paper-foundation/src/probe/probe.ts:37`。）

## 5. 被拒容器摘录

**本次未留存被拒容器摘录。**

依据（只读检索，未做任何推断性补写）：

- 本次审计轨迹共 29 个事件，事件类型全集为 `["production_enabled","workflow_started","ir_entry_written","provider_retry","gate_failed"]`，**不含 `container_refused`**。
- 全仓检索 `container_refused` 只命中源码与测试文件，未命中任何 `apps/paper-shell/src/paper-shell-persist-*/` 持久化目录。
- 原因（代码路径，只读）：本次拒绝发生在 E1→E2 fidelity 门（`executor.ts:1634-1660`，抛 `E1_E2_FIDELITY_VIOLATION` / `w4Class=DRIFT`），该门位于 `produceContainerInto`（`executor.ts:1663`）**之前**——这是 W8.10-B1 的重排要求「每个可能拒绝的门都必须坐在 admission 之前」。只有 `produceContainerInto` 返回 `!ok` 时才会写 `container_refused`（`executor.ts:1671-1687`，含 `excerpt_head`/`excerpt_tail`/`output_sha256`/`reason`）。因此本次运行不存在被拒容器，也就不存在可摘录的容器文本。
- 最接近的替代物（已在上文第 4.1 节逐字归档）：`FidelityFinding` 事件的 `detail`——它是**拒绝理由的原文**，但不是被拒容器的内容摘录。

## 6. 逐次尝试的失败分类演变

| attempt | E2 chars | 该 attempt 应用的 guidance | B4 逐问推理覆盖 | B3 反向 | B3 锚点同一性 | B3 正向 | 正向失败锚点数 | w4Class / code |
|---|---|---|---|---|---|---|---|---|
| 1 | 11818 | `985` 字符（seq 7） | PASS | PASS | PASS | **FAIL** | 6 | `DRIFT` / `E1_E2_FIDELITY_VIOLATION` |
| 2 | 13262 | `1243` 字符（seq 15） | PASS | PASS | PASS | **FAIL** | 9+（下界） | `DRIFT` / `E1_E2_FIDELITY_VIOLATION` |
| 3 | 13740 | `1802` 字符（seq 23） | PASS | PASS | PASS | **FAIL** | 9+（下界） | （终局，无 retry 事件） |

### 6.1 B3 正向 FAIL 的锚点清单（逐字，按落盘顺序）

- **attempt 1**（6 项）：
  `EQ-BINOMIAL`、`EQ-REJECT`、`EQ-ACCEPT`、`EQ-PROFIT`、`EQ-REVENUE`、`EQ-COST`
- **attempt 2**（9 项，**这是下界**：末项在落盘时被 400 字符上限截断，其后的锚点未留存）：
  `A-BINOMIAL-SAMPLING`、`A-SINGLE-BATCH`、`A-DISASSEMBLY-PERFECT`、`A-LINEAR-COSTS`、`A-ASSEMBLY-INDEPENDENCE`、`A-SYMMETRIC-COMPONENTS`、`A-BETA-PRIOR`、`A-SAMPLING-REPRESENTATIVE`、`EQ-BINOMIA…（截断）`
- **attempt 3**（9 项，**这是下界**：末项在落盘时被 400 字符上限截断，其后的锚点未留存）：
  `A-BINOMIAL-SAMPLING`、`A-SINGLE-BATCH`、`A-DISASSEMBLY-PERFECT`、`A-LINEAR-COSTS`、`A-ASSEMBLY-INDEPENDENCE`、`A-SYMMETRIC-COMPONENTS`、`A-BETA-PRIOR`、`A-SAMPLING-REPRESENTATIVE`、`EQ-BINOMIA…（截断）`

### 6.2 演变读数

- 分类本身**未变化**：三次 attempt 的 `w4Class` 恒为 `DRIFT`，失败码恒为 `E1_E2_FIDELITY_VIOLATION`。变化的是**被点名的具体失败面**（B3 正向：6 → 9 → 9；数值为 FAIL 时被点名的锚点数，PASS 时记为 PASS）。
- **B4 逐问推理覆盖三次尝试全部 PASS**（`全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点`）。本 run 的审计事件顺序显示输入资产注册（`DataArtifact`/`RequirementSpec`/`ProblemSpec`，seq 3-5）发生在 `E1Analysis`（seq 6）**之前**——这正是 W8.10-D1 的修复形态（`executor.ts:1411-1422`：注册必须先于 E1，否则 E1 被告知「harness registered no requirement ids」，B4 必然失败）。对比 real-run-1/2 的同位置事件顺序（E1→E2→注册），可见本 run 跑在 D1 修复之后。
- **本 run 的 attempt 1 就已携带 guidance**（seq 7，985 字符），此时**尚无任何 prior violation**（该 attempt 之前不存在任何 `provider_retry` 事件，也不存在任何 FAIL 的 `FidelityFinding`）。
  - 该 985 字符长度与「只有 registeredIds、无 violation」形态**精确吻合**：以真实函数 `e2DriftGuidance({ priorViolations: [], registeredIds: ['DA-RAW','P1','R-OUT'] })` 实测得 985 字符，与落盘的 `guidance_chars: 985` 逐字相等。ids 取自本 run seq 3-5 的三条注册事件。
  - 机制（代码，只读）：`e2-guidance.ts:140-142` 的 `if (!hasViolations && !hasRegistered) return ''`——只要 `registeredIds` 非空，guidance 就非空。D1 修复把注册提前到 E1 之前（`executor.ts:1411-1422`），于是注册 id 列表在首次 attempt 就进入了 E2 prompt。
  - 副作用：real-run-3 的首次 E2 调用**不再**与 W8.9 的 prompt 逐字节相同（`e2PromptWithGuidance` 会追加非空 guidance，`e2-guidance.ts:187`）。W8.10-B1 注释所声明的「Empty on the first attempt」在本 run 的 D1 修复组合下不成立。
  - 对比：real-run-1/2 的 attempt 1 **无** `E2DriftGuidance` 事件（首次出现分别在 seq 14），即首次 guidance 为空；两者的注册事件都排在 `E2Normalization` **之后**（run-1 seq 5-7 晚于 seq 4；run-2 seq 5-7 晚于 seq 4），与 D1 修复前的顺序一致。
- **最后两次 attempt 的 B3 正向 detail 落盘后逐字相同**（均 400 字符，均被 400 上限截断）。注意这是**截断后的视图相同**，不是模型输出相同：两次 E2 文本长度不同（13262 vs 13740 字符），故 W8.6-A4 同因熔断的指纹（`sha256(E2 text)`）不同，熔断未触发。终局是预算耗尽（见下条）。
- **终局机制**：三次运行都没有触发 W8.6-A4 同因熔断（每次 attempt 的 E2 文本长度互不相同，指纹不同），最终失败都是 `NONE_RETRY_BUDGET = 2`（`probe.ts:37`）用尽后的 `gate_failed: DRIFT guidance budget exhausted`（`executor.ts:1813-1837`）。即：attempt 3 的失败发生在预算分支，熔断分支（`executor.ts:1857`）未参与。

## 7. usage 与 wall clock

| 项 | run-report.json | workflow runs 记录 | 备注 |
|---|---|---|---|
| input_tokens | 13744 | 13744 | 与 5 条 usage 事件求和一致 |
| output_tokens | 17324 | 17324 | 与 5 条 usage 事件求和一致 |
| cost_usd | 0 | 0 | 未配置计价 |
| wall_clock_seconds | 347.5 | 347.521（createdAt→updatedAt） | 两者一致（四舍五入） |

分 attempt 的 usage 事件（逐字，来自 `paper_workflow.json` 的 `events` 表）：

> 注：`usage` 事件的 `nodeId` 在落盘时恒为 `null`（见下表「nodeId」列），故节点归属**不是**落盘字段。
> 「归属（推导）」列由「该 usage 之前最近的一条 `request_started`」机械推出，仅作阅读辅助。

| workflow seq | nodeId（落盘原文） | 归属（推导） | inputTokens | outputTokens | costUsd |
|---|---|---|---|---|---|
| 7 | `null` | plan / attempt 1 | 1684 | 1717 | 0 |
| 13 | `null` | execute / attempt 1 | 2458 | 2461 | 0 |
| 14 | `null` | execute / attempt 1 | 4066 | 4010 | 0 |
| 19 | `null` | execute / attempt 2 | 4143 | 4473 | 0 |
| 24 | `null` | execute / attempt 3 | 1393 | 4663 | 0 |

## 8. 归因注意（沿用 D0，不新增结论）

`artifacts/handoff/W8.10/D0-run-posture.md` 已记录：本轮同时改变了**模型**（→ 目标模型 `deepseek/deepseek-v4-flash`）与 **E2 回灌**（B 组）两件事，失败归因存在混淆，不得把结果归因给单一变量。本文只归档事实，不做归因。

