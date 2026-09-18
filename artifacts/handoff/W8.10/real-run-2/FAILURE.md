# real-run-2 失败归档（W8.10-D2）

> **归档纪律**：本文引用的所有原始文本均逐字来自磁盘，未做美化、总结替代或删减。
> 磁盘上没有的数据一律标注「**未留存**」，不做推测性补写。
> 来源：`apps/paper-shell/src/paper-shell-persist-KoapW9/paper_audit.json`（sha256 `f1ee8ccdee53c5196948a350532355dd286a14c75dbe0e5cdb51c64fab3c50e1`）、
> `apps/paper-shell/src/paper-shell-persist-KoapW9/paper_workflow.json`（sha256 `997a5ce7d566984a3c7132e1b586a8a2a0fb1803b1d152942631080cd96e90bb`）、
> `artifacts/handoff/W8.10/real-run-2/run-report.json`（已有产物，本次未修改）。

## 1. 结论速览

| 项 | 值 | 来源 |
|---|---|---|
| runId | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | run-report.json |
| tier / mode | T1 / strict | run-report.json |
| status | **BLOCKED** | run-report.json；workflow runs.status = `failed` |
| routed_family / route_truth | F4 / F3+F4 | run-report.json |
| route_mismatch | false | run-report.json |
| **失败码 code** | `gate-failed` | run-report.json |
| **classifier** | `none` | run-report.json |
| **失败节点** | `execute`（attempts 3，maxAttempts 3，node state `failed`） | run-report.json memo.failing_node + workflow nodes |
| **失败 gate** | `ir_producer` | audit `gate_failed` 事件 seq 28 |
| minted_ir_count / kinds | 3（DataArtifact, RequirementSpec, ProblemSpec） | run-report.json |
| passed_gates | plan | run-report.json |
| wall_clock_seconds | 281.5（workflow createdAt→updatedAt = 281.480 s） | run-report.json / workflow runs |
| usage | input 16212 / output 16970 / cost_usd 0 | run-report.json（与 workflow 5 条 usage 事件求和一致） |

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

- 节点：`execute`（nodeId `90308349-7ef9-425c-b4a8-8ed371293192`，type `execute`，role `executor`），state `failed`，attempts `3`/`3`，`lastErrorCode` = `null`。
- gate：`ir_producer`，逐字 reason：`DRIFT guidance budget exhausted`（seq 28）。
- 该 gate 的抛出点：`packages/paper/paper-foundation/src/executor.ts:1832`（`gate: 'ir_producer'`）。
- 逐次尝试的 gate 层失败码：attempt 1 = `E1_E2_FIDELITY_VIOLATION`（w4Class `DRIFT`）；attempt 2 = `E1_E2_FIDELITY_VIOLATION`（w4Class `DRIFT`）。

## 4. 原始错误文本

### 4.1 落盘原文（逐字）

- `gate_failed`（seq 28）reason：

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

    - `B4 逐问推理覆盖`（原文 21 字符）：

      ```text
      E1 缺少 1 个要求的推理段：R-OUT
      ```

  - **attempt 2**：

    - `B4 逐问推理覆盖`（原文 21 字符）：

      ```text
      E1 缺少 1 个要求的推理段：R-OUT
      ```

  - **attempt 3**：

    - `B4 逐问推理覆盖`（原文 21 字符）：

      ```text
      E1 缺少 1 个要求的推理段：R-OUT
      ```

    - `B3 正向（声明须逐字锚定 E1）`（原文 127 字符）：

      ```text
      E1: 未声明 e1_span；E2: 未声明 e1_span；E3: 未声明 e1_span；E4: 未声明 e1_span；E5: 未声明 e1_span；E6: 未声明 e1_span；E7: 未声明 e1_span；E8: 未声明 e1_span
      ```

### 4.2 未留存

- **抛出的 Error.message 未留存。** `executor.ts:1834-1837` 构造的 `WorkflowExecutionError` 文本（`node '<id>' exhausted 2 guided retries (DRIFT): EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)`）只作为异常抛出，未写入任何持久化产物：
  - `paper_workflow.json` 只记录状态迁移（`node_state running→failed`、`run_state running→failed`），无 message 字段；对两个持久化文件检索 `exhausted`/`refused` 仅命中 `gate_failed.reason` 一处。
- 每次 attempt 的完整 E2 模型输出文本未留存（只有长度 `chars` 与拒绝理由摘录）。
- 完整 E1 分析文本未留存（只有长度 `chars`）。

### 4.3 代码模板（非落盘原文，仅用于核对措辞）

以下文本**不是**磁盘上的归档数据，而是从源码模板代入本次 nodeId 后的重建，仅供复盘核对措辞：

```text
node '90308349-7ef9-425c-b4a8-8ed371293192' exhausted 2 guided retries (DRIFT): EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)
```

（模板出处：`packages/paper/paper-foundation/src/executor.ts:1834-1837`；`2` = `NONE_RETRY_BUDGET`，定义在 `packages/paper/paper-foundation/src/probe/probe.ts:37`。）

## 5. 被拒容器摘录

**本次未留存被拒容器摘录。**

依据（只读检索，未做任何推断性补写）：

- 本次审计轨迹共 28 个事件，事件类型全集为 `["production_enabled","workflow_started","ir_entry_written","provider_retry","gate_failed"]`，**不含 `container_refused`**。
- 全仓检索 `container_refused` 只命中源码与测试文件，未命中任何 `apps/paper-shell/src/paper-shell-persist-*/` 持久化目录。
- 原因（代码路径，只读）：本次拒绝发生在 E1→E2 fidelity 门（`executor.ts:1634-1660`，抛 `E1_E2_FIDELITY_VIOLATION` / `w4Class=DRIFT`），该门位于 `produceContainerInto`（`executor.ts:1663`）**之前**——这是 W8.10-B1 的重排要求「每个可能拒绝的门都必须坐在 admission 之前」。只有 `produceContainerInto` 返回 `!ok` 时才会写 `container_refused`（`executor.ts:1671-1687`，含 `excerpt_head`/`excerpt_tail`/`output_sha256`/`reason`）。因此本次运行不存在被拒容器，也就不存在可摘录的容器文本。
- 最接近的替代物（已在上文第 4.1 节逐字归档）：`FidelityFinding` 事件的 `detail`——它是**拒绝理由的原文**，但不是被拒容器的内容摘录。

## 6. 逐次尝试的失败分类演变

| attempt | E2 chars | 该 attempt 应用的 guidance | B4 逐问推理覆盖 | B3 反向 | B3 锚点同一性 | B3 正向 | 正向失败锚点数 | w4Class / code |
|---|---|---|---|---|---|---|---|---|
| 1 | 13927 | **未应用** | **FAIL** | PASS | PASS | PASS | —（PASS，无失败锚点） | `DRIFT` / `E1_E2_FIDELITY_VIOLATION` |
| 2 | 13127 | `1118` 字符（seq 14） | **FAIL** | PASS | PASS | PASS | —（PASS，无失败锚点） | `DRIFT` / `E1_E2_FIDELITY_VIOLATION` |
| 3 | 13752 | `1182` 字符（seq 22） | **FAIL** | PASS | PASS | **FAIL** | 8 | （终局，无 retry 事件） |

### 6.1 B3 正向 FAIL 的锚点清单（逐字，按落盘顺序）

- **attempt 1**：B3 正向 **PASS**，无失败锚点。该 attempt 的 detail 原文（逐字）：`10 条 Assumption/Equation 声明全部逐字锚定 E1`
- **attempt 2**：B3 正向 **PASS**，无失败锚点。该 attempt 的 detail 原文（逐字）：`12 条 Assumption/Equation 声明全部逐字锚定 E1`
- **attempt 3**（8 项）：
  `E1`、`E2`、`E3`、`E4`、`E5`、`E6`、`E7`、`E8`

### 6.2 演变读数

- 分类本身**未变化**：三次 attempt 的 `w4Class` 恒为 `DRIFT`，失败码恒为 `E1_E2_FIDELITY_VIOLATION`。变化的是**被点名的具体失败面**（B3 正向：PASS → PASS → 8；数值为 FAIL 时被点名的锚点数，PASS 时记为 PASS）。
- **B4 逐问推理覆盖三次尝试全部 FAIL**，且 detail 三次逐字相同（`E1 缺少 1 个要求的推理段：R-OUT`）。按 W8.10-D1（`executor.ts:1635-1642`），B4 是 **E1 侧缺陷**，被 `e2Fixable = fidelity.filter(f => !f.ok && !f.rule.includes('B4'))` 排除在 E2 回灌之外——即它**不可能被 E2 重试修好**，因此它在这三次运行中是恒定的背景失败，不参与收窄。
- **回灌可作用对象（本 run 的关键读数）**：attempt 2 的 guidance 由 attempt 1 的非 B4 FAIL 构成，attempt 3 的由 attempt 2 的构成。本 run 的对应值为：attempt 2 ← **空（无可回灌条目）**；attempt 3 ← **空（无可回灌条目）**。
  - **本 run 的回灌从未携带任何可作用条目。** 原因（代码路径，`executor.ts:1650`）：条目只在 `e2Fixable.length > 0` 时追加，而 `e2Fixable` 排除了 B4；本 run 前两次 attempt 的 FAIL 只有 B4，故 `priorViolations` 恒为空。
  - 落盘的 `guidance_chars` 为 1118 / 1182。以真实函数实测，「无 violation + 3 个 id」基线为 985 字符；落盘值与之的差异来自 `registeredIds` 列表（其完整文本未留存，故不逐字核验）。
  - 读数：本 run 对**同一个不可能被回灌修好的缺陷（B4）**重试，回灌机制在此 run 上**没有可作用的对象**——失败面不收敛不是回灌失效，而是回灌从未收到指令。
  - 附带观察（逐字来自落盘）：attempt 3 的 B3 正向由 PASS 转为 FAIL，detail 为 `E1: 未声明 e1_span；E2: 未声明 e1_span；…；E8: 未声明 e1_span`（8 项，127 字符，未触达 400 上限）。即最后一次尝试**新增**了一类此前不存在的失败面。
- **终局机制**：三次运行都没有触发 W8.6-A4 同因熔断（每次 attempt 的 E2 文本长度互不相同，指纹不同），最终失败都是 `NONE_RETRY_BUDGET = 2`（`probe.ts:37`）用尽后的 `gate_failed: DRIFT guidance budget exhausted`（`executor.ts:1813-1837`）。即：attempt 3 的失败发生在预算分支，熔断分支（`executor.ts:1857`）未参与。

## 7. usage 与 wall clock

| 项 | run-report.json | workflow runs 记录 | 备注 |
|---|---|---|---|
| input_tokens | 16212 | 16212 | 与 5 条 usage 事件求和一致 |
| output_tokens | 16970 | 16970 | 与 5 条 usage 事件求和一致 |
| cost_usd | 0 | 0 | 未配置计价 |
| wall_clock_seconds | 281.5 | 281.480（createdAt→updatedAt） | 两者一致（四舍五入） |

分 attempt 的 usage 事件（逐字，来自 `paper_workflow.json` 的 `events` 表）：

> 注：`usage` 事件的 `nodeId` 在落盘时恒为 `null`（见下表「nodeId」列），故节点归属**不是**落盘字段。
> 「归属（推导）」列由「该 usage 之前最近的一条 `request_started`」机械推出，仅作阅读辅助。

| workflow seq | nodeId（落盘原文） | 归属（推导） | inputTokens | outputTokens | costUsd |
|---|---|---|---|---|---|
| 7 | `null` | plan / attempt 1 | 1619 | 500 | 0 |
| 13 | `null` | execute / attempt 1 | 2324 | 2528 | 0 |
| 14 | `null` | execute / attempt 1 | 3822 | 4723 | 0 |
| 19 | `null` | execute / attempt 2 | 4204 | 4547 | 0 |
| 24 | `null` | execute / attempt 3 | 4243 | 4672 | 0 |

## 8. 归因注意（沿用 D0，不新增结论）

`artifacts/handoff/W8.10/D0-run-posture.md` 已记录：本轮同时改变了**模型**（→ 目标模型 `deepseek/deepseek-v4-flash`）与 **E2 回灌**（B 组）两件事，失败归因存在混淆，不得把结果归因给单一变量。本文只归档事实，不做归因。

