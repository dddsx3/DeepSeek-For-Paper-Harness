# real-run-2 审计轨迹（audit trail）

- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- 来源: `apps/paper-shell/src/paper-shell-persist-KoapW9/paper_audit.json`（sha256 `f1ee8ccdee53c5196948a350532355dd286a14c75dbe0e5cdb51c64fab3c50e1`）
- audit unit: `{"name":"paper_audit","version":0}`
- 事件数: 28（按 `seq` 升序；源表为 16 位零填充字符串键对象，非数组）
- 原始数组: `audit-trail.json`（本文是同一数组的可读渲染）

> 渲染规则：所有标量逐字；字符串型 `detail` 字段超过 300 字符时截断并**标注已截断**。
> 另需注意：harness 落盘时已按 `packages/paper/paper-foundation/src/executor.ts:1630`
> 的 `finding.detail.slice(0, 400)` 截断，故「原文 400 字符」不等于完整模型输出。

## 事件总表

| seq | ts | actor | runId | eventType | 摘要 |
|---|---|---|---|---|---|
| 1 | 2026-09-18T06:04:12.352Z | paper-shell | null | `production_enabled` | tier=T1 mode=strict route=https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash |
| 2 | 2026-09-18T06:04:12.669Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `workflow_started` | mode=strict |
| 3 | 2026-09-18T06:05:42.347Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E1Analysis id=e1 chars=4189 |
| 4 | 2026-09-18T06:06:52.152Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E2Normalization id=e2 chars=13927 |
| 5 | 2026-09-18T06:06:52.157Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=DataArtifact id=DA-RAW |
| 6 | 2026-09-18T06:06:52.161Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=RequirementSpec id=R-OUT |
| 7 | 2026-09-18T06:06:52.165Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=ProblemSpec id=P1 |
| 8 | 2026-09-18T06:06:52.169Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=false detail="E1 缺少 1 个要求的推理段：R-OUT" |
| 9 | 2026-09-18T06:06:52.172Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 5 条假设锚点均有对应 AssumptionSpec" |
| 10 | 2026-09-18T06:06:52.175Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="5 条假设声明在 E1 中均有同名锚点" |
| 11 | 2026-09-18T06:06:52.178Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=true detail="10 条 Assumption/Equation 声明全部逐字锚定 E1" |
| 12 | 2026-09-18T06:06:52.187Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `provider_retry` | attempt=1 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 13 | 2026-09-18T06:06:53.224Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E1Reused id=e1 chars=4189 |
| 14 | 2026-09-18T06:06:53.228Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=1118 |
| 15 | 2026-09-18T06:07:56.756Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E2Normalization id=e2 chars=13127 |
| 16 | 2026-09-18T06:07:56.760Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=false detail="E1 缺少 1 个要求的推理段：R-OUT" |
| 17 | 2026-09-18T06:07:56.763Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 5 条假设锚点均有对应 AssumptionSpec" |
| 18 | 2026-09-18T06:07:56.766Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="5 条假设声明在 E1 中均有同名锚点" |
| 19 | 2026-09-18T06:07:56.769Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=true detail="12 条 Assumption/Equation 声明全部逐字锚定 E1" |
| 20 | 2026-09-18T06:07:56.779Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `provider_retry` | attempt=2 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 21 | 2026-09-18T06:07:59.187Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E1Reused id=e1 chars=4189 |
| 22 | 2026-09-18T06:07:59.191Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=1182 |
| 23 | 2026-09-18T06:08:54.108Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=E2Normalization id=e2 chars=13752 |
| 24 | 2026-09-18T06:08:54.112Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=false detail="E1 缺少 1 个要求的推理段：R-OUT" |
| 25 | 2026-09-18T06:08:54.116Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 5 条假设锚点均有对应 AssumptionSpec" |
| 26 | 2026-09-18T06:08:54.120Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="5 条假设声明在 E1 中均有同名锚点" |
| 27 | 2026-09-18T06:08:54.124Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="E1: 未声明 e1_span；E2: 未声明 e1_span；E3: 未声明 e1_span；E4:… |
| 28 | 2026-09-18T06:08:54.140Z | paper-executor | `6b10cd1f-9138-4f71-8803-34dc227d8fe5` | `gate_failed` | gate=ir_producer reason=DRIFT guidance budget exhausted |

## 逐事件明细

### seq 1 — `production_enabled`

- ts: `2026-09-18T06:04:12.352Z`
- actor: `paper-shell`
- runId: `null`
- id: `26de4989-81bb-43c9-96e8-bd5291b20459`
- 原始 detail（JSON，逐字）:

```json
{
  "tier": "T1",
  "mode": "strict",
  "route": "https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash"
}
```

### seq 2 — `workflow_started`

- ts: `2026-09-18T06:04:12.669Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `f65346a5-f472-4c82-b01f-00246e7749a4`
- 原始 detail（JSON，逐字）:

```json
{
  "mode": "strict"
}
```

### seq 3 — `ir_entry_written`

- ts: `2026-09-18T06:05:42.347Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `321117b9-2049-4194-a3e5-df5b6540f6da`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Analysis",
  "id": "e1",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "chars": 4189
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Analysis"　·　`id` = "e1"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`chars` = 4189

### seq 4 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.152Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `f6eae552-4d35-44e5-acf1-d83793ecea5c`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "chars": 13927,
  "e1_chars": 4189
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`chars` = 13927　·　`e1_chars` = 4189

### seq 5 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.157Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `db9de394-c34e-4423-a6b9-b209bcb1a7a0`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "DataArtifact",
  "id": "DA-RAW",
  "stage": "input-registration"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "DataArtifact"　·　`id` = "DA-RAW"　·　`stage` = "input-registration"

### seq 6 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.161Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `631640c3-ba71-4936-936d-e82dd1329afa`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "RequirementSpec",
  "id": "R-OUT",
  "stage": "input-registration"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "RequirementSpec"　·　`id` = "R-OUT"　·　`stage` = "input-registration"

### seq 7 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.165Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `143df5a3-326e-4d88-ad29-bbc1cebe2026`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "ProblemSpec",
  "id": "P1",
  "stage": "input-registration"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "ProblemSpec"　·　`id` = "P1"　·　`stage` = "input-registration"

### seq 8 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.169Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `28da3575-9830-4fa6-8665-cc85e45588b7`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": false,
  "detail": "E1 缺少 1 个要求的推理段：R-OUT"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = false
detail：

> E1 缺少 1 个要求的推理段：R-OUT

### seq 9 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.172Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `d7ab742a-4986-4043-b40c-5e37c1e83044`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "E1 的 5 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> E1 的 5 条假设锚点均有对应 AssumptionSpec

### seq 10 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.175Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `378b9fa3-1dbb-41e1-b171-52ea486aae95`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "5 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> 5 条假设声明在 E1 中均有同名锚点

### seq 11 — `ir_entry_written`

- ts: `2026-09-18T06:06:52.178Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `ad739284-711d-4679-9e23-d7cd48ea12ae`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "10 条 Assumption/Equation 声明全部逐字锚定 E1"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> 10 条 Assumption/Equation 声明全部逐字锚定 E1

### seq 12 — `provider_retry`

- ts: `2026-09-18T06:06:52.187Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `ff5cbc74-4b2f-4047-8d44-4384fe9a9433`
- 原始 detail（JSON，逐字）:

```json
{
  "code": "E1_E2_FIDELITY_VIOLATION",
  "role": "executor",
  "attempt": 1,
  "w4Class": "DRIFT"
}
```

### seq 13 — `ir_entry_written`

- ts: `2026-09-18T06:06:53.224Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `65db0a6b-895c-4970-b361-56973b9f765b`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "chars": 4189
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`chars` = 4189

### seq 14 — `ir_entry_written`

- ts: `2026-09-18T06:06:53.228Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `cfafcc1b-d435-4220-acf1-613c79ff2cf4`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 1118
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 1118

### seq 15 — `ir_entry_written`

- ts: `2026-09-18T06:07:56.756Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `bc0e9aaa-dfe4-4d42-8b48-2f8e0e27cacc`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "chars": 13127,
  "e1_chars": 4189
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`chars` = 13127　·　`e1_chars` = 4189

### seq 16 — `ir_entry_written`

- ts: `2026-09-18T06:07:56.760Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `fa0868d7-4db8-47d7-a8a4-d85e743ae06f`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": false,
  "detail": "E1 缺少 1 个要求的推理段：R-OUT"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = false
detail：

> E1 缺少 1 个要求的推理段：R-OUT

### seq 17 — `ir_entry_written`

- ts: `2026-09-18T06:07:56.763Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `f77651f0-a57d-43bd-b547-190449d7874e`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "E1 的 5 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> E1 的 5 条假设锚点均有对应 AssumptionSpec

### seq 18 — `ir_entry_written`

- ts: `2026-09-18T06:07:56.766Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `ad8e95c5-fead-48b6-9c52-8d2e74ba6425`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "5 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> 5 条假设声明在 E1 中均有同名锚点

### seq 19 — `ir_entry_written`

- ts: `2026-09-18T06:07:56.769Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `fd1af51d-93d0-41c8-bfbd-0092c0091f1f`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "12 条 Assumption/Equation 声明全部逐字锚定 E1"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> 12 条 Assumption/Equation 声明全部逐字锚定 E1

### seq 20 — `provider_retry`

- ts: `2026-09-18T06:07:56.779Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `9a8712ec-86fc-4c53-8015-60cbadb2a6b0`
- 原始 detail（JSON，逐字）:

```json
{
  "code": "E1_E2_FIDELITY_VIOLATION",
  "role": "executor",
  "attempt": 2,
  "w4Class": "DRIFT"
}
```

### seq 21 — `ir_entry_written`

- ts: `2026-09-18T06:07:59.187Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `71e26a43-c25e-4f38-a3e0-aa7226277b41`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "chars": 4189
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`chars` = 4189

### seq 22 — `ir_entry_written`

- ts: `2026-09-18T06:07:59.191Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `851ec7fa-c45b-48dc-b419-f605f8f49f1c`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 1182
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 1182

### seq 23 — `ir_entry_written`

- ts: `2026-09-18T06:08:54.108Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `849b932b-d3ba-4188-9b19-77e7992435ac`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "stage": "receive",
  "chars": 13752,
  "e1_chars": 4189
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`stage` = "receive"　·　`chars` = 13752　·　`e1_chars` = 4189

### seq 24 — `ir_entry_written`

- ts: `2026-09-18T06:08:54.112Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `c067a81e-d121-440d-ad6e-41005d61bd43`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": false,
  "detail": "E1 缺少 1 个要求的推理段：R-OUT"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = false
detail：

> E1 缺少 1 个要求的推理段：R-OUT

### seq 25 — `ir_entry_written`

- ts: `2026-09-18T06:08:54.116Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `eefde998-4aab-4fe1-a6cb-f1d309946bed`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "E1 的 5 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> E1 的 5 条假设锚点均有对应 AssumptionSpec

### seq 26 — `ir_entry_written`

- ts: `2026-09-18T06:08:54.120Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `7f716753-e362-45aa-a270-2d01ac4048c8`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": true,
  "detail": "5 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = true
detail：

> 5 条假设声明在 E1 中均有同名锚点

### seq 27 — `ir_entry_written`

- ts: `2026-09-18T06:08:54.124Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `b124f063-a85c-41bc-8a01-12c399bea7a5`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "90308349-7ef9-425c-b4a8-8ed371293192",
  "ok": false,
  "detail": "E1: 未声明 e1_span；E2: 未声明 e1_span；E3: 未声明 e1_span；E4: 未声明 e1_span；E5: 未声明 e1_span；E6: 未声明 e1_span；E7: 未声明 e1_span；E8: 未声明 e1_span"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "90308349-7ef9-425c-b4a8-8ed371293192"　·　`ok` = false
detail：

> E1: 未声明 e1_span；E2: 未声明 e1_span；E3: 未声明 e1_span；E4: 未声明 e1_span；E5: 未声明 e1_span；E6: 未声明 e1_span；E7: 未声明 e1_span；E8: 未声明 e1_span

### seq 28 — `gate_failed`

- ts: `2026-09-18T06:08:54.140Z`
- actor: `paper-executor`
- runId: `6b10cd1f-9138-4f71-8803-34dc227d8fe5`
- id: `beebf10b-4532-41c3-8984-37db50ec897b`
- 原始 detail（JSON，逐字）:

```json
{
  "gate": "ir_producer",
  "reason": "DRIFT guidance budget exhausted"
}
```

