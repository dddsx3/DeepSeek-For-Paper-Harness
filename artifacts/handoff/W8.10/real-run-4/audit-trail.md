# real-run-4 审计轨迹（audit trail）

- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- 来源: `apps/paper-shell/src/paper-shell-persist-yQ5BBj/paper_audit.json`（sha256 `ffb68529d96d29c62a5e612f5b6998054a7a49fb046f9bf1869cedc44c0e2a0e`）
- audit unit: `{"name":"paper_audit","version":0}`
- 事件数: 29（按 `seq` 升序；源表为 16 位零填充字符串键对象，非数组）
- 原始数组: `audit-trail.json`（本文是同一数组的可读渲染）

> 渲染规则：所有标量逐字；字符串型 `detail` 字段超过 300 字符时截断并**标注已截断**。
> 另需注意：harness 落盘时已按 `packages/paper/paper-foundation/src/executor.ts:1630`
> 的 `finding.detail.slice(0, 400)` 截断，故「原文 400 字符」不等于完整模型输出。

## 事件总表

| seq | ts | actor | runId | eventType | 摘要 |
|---|---|---|---|---|---|
| 1 | 2026-09-18T15:48:51.700Z | paper-shell | null | `production_enabled` | tier=T1 mode=strict route=https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash |
| 2 | 2026-09-18T15:48:52.734Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `workflow_started` | mode=strict |
| 3 | 2026-09-18T15:49:08.318Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=DataArtifact id=DA-RAW |
| 4 | 2026-09-18T15:49:08.324Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=RequirementSpec id=R-OUT |
| 5 | 2026-09-18T15:49:08.331Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=ProblemSpec id=P1 |
| 6 | 2026-09-18T15:50:49.156Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E1Analysis id=e1 chars=14010 |
| 7 | 2026-09-18T15:50:49.163Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=985 |
| 8 | 2026-09-18T15:52:45.405Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E2Normalization id=e2 chars=17867 |
| 9 | 2026-09-18T15:52:45.417Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=true detail="全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点" |
| 10 | 2026-09-18T15:52:45.422Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=false detail="E1 标记了但 IR 未声明的假设：..." |
| 11 | 2026-09-18T15:52:45.427Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="10 条假设声明在 E1 中均有同名锚点" |
| 12 | 2026-09-18T15:52:45.432Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRA… |
| 13 | 2026-09-18T15:52:45.447Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `provider_retry` | attempt=1 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 14 | 2026-09-18T15:52:46.311Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E1Reused id=e1 chars=14010 |
| 15 | 2026-09-18T15:52:46.316Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=1301 |
| 16 | 2026-09-18T15:55:11.931Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E2Normalization id=e2 chars=23136 |
| 17 | 2026-09-18T15:55:11.939Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=true detail="全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点" |
| 18 | 2026-09-18T15:55:11.943Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=false detail="E1 标记了但 IR 未声明的假设：..." |
| 19 | 2026-09-18T15:55:11.947Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="10 条假设声明在 E1 中均有同名锚点" |
| 20 | 2026-09-18T15:55:11.951Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRA… |
| 21 | 2026-09-18T15:55:11.962Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `provider_retry` | attempt=2 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 22 | 2026-09-18T15:55:14.223Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E1Reused id=e1 chars=14010 |
| 23 | 2026-09-18T15:55:14.227Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=1589 |
| 24 | 2026-09-18T15:56:04.626Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=E2Normalization id=e2 chars=17175 |
| 25 | 2026-09-18T15:56:04.632Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=true detail="全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点" |
| 26 | 2026-09-18T15:56:04.636Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=false detail="E1 标记了但 IR 未声明的假设：..." |
| 27 | 2026-09-18T15:56:04.639Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="10 条假设声明在 E1 中均有同名锚点" |
| 28 | 2026-09-18T15:56:04.643Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRA… |
| 29 | 2026-09-18T15:56:04.660Z | paper-executor | `fe865595-dde3-48c6-a464-7101b364d703` | `gate_failed` | gate=ir_producer reason=DRIFT guidance budget exhausted |

## 逐事件明细

### seq 1 — `production_enabled`

- ts: `2026-09-18T15:48:51.700Z`
- actor: `paper-shell`
- runId: `null`
- id: `2c459068-58d7-4dbb-b812-669701a928f9`
- 原始 detail（JSON，逐字）:

```json
{
  "tier": "T1",
  "mode": "strict",
  "route": "https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash"
}
```

### seq 2 — `workflow_started`

- ts: `2026-09-18T15:48:52.734Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `81f8165f-6e02-4c6b-aef0-34ecec15b10e`
- 原始 detail（JSON，逐字）:

```json
{
  "mode": "strict"
}
```

### seq 3 — `ir_entry_written`

- ts: `2026-09-18T15:49:08.318Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `072e81e8-aef3-4210-bd62-ba52c8d51d71`
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

### seq 4 — `ir_entry_written`

- ts: `2026-09-18T15:49:08.324Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `ca8fb0d4-cace-4370-93a6-e48b33f0f386`
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

### seq 5 — `ir_entry_written`

- ts: `2026-09-18T15:49:08.331Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `2cb94756-a9fd-4829-b0ca-afe3d87d485d`
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

### seq 6 — `ir_entry_written`

- ts: `2026-09-18T15:50:49.156Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `fd86ce30-379e-4855-b4da-3cd4ffcaf378`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Analysis",
  "id": "e1",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "chars": 14010
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Analysis"　·　`id` = "e1"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`chars` = 14010

### seq 7 — `ir_entry_written`

- ts: `2026-09-18T15:50:49.163Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `8bc8b074-dcb7-47e7-8471-a1baa752f0d0`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 985
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 985

### seq 8 — `ir_entry_written`

- ts: `2026-09-18T15:52:45.405Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `73b2ffdb-ee9a-4b6b-9207-dd825c691a47`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "chars": 17867,
  "e1_chars": 14010
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`chars` = 17867　·　`e1_chars` = 14010

### seq 9 — `ir_entry_written`

- ts: `2026-09-18T15:52:45.417Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `1e2e2244-0b2d-4708-b847-949a55c3541e`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": true,
  "detail": "全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = true
detail：

> 全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点

### seq 10 — `ir_entry_written`

- ts: `2026-09-18T15:52:45.422Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `a7282214-d302-4d8f-9272-629a5fb8e25b`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": false,
  "detail": "E1 标记了但 IR 未声明的假设：..."
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = false
detail：

> E1 标记了但 IR 未声明的假设：...

### seq 11 — `ir_entry_written`

- ts: `2026-09-18T15:52:45.427Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `366fd2b7-5edc-4f4e-947f-94dc55706fe5`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": true,
  "detail": "10 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = true
detail：

> 10 条假设声明在 E1 中均有同名锚点

### seq 12 — `ir_entry_written`

- ts: `2026-09-18T15:52:45.432Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `35891fb1-c6f6-47be-ac31-5a9da6778419`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": false,
  "detail": "A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRAINT2: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-PGOOD: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E: e1_span 在 E1 中找不到逐字匹配（疑似改写）"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = false
detail：

> A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRAINT2: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-PGOOD: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E: e1_span 在 E1 中找不到逐字匹配（疑似改写）

### seq 13 — `provider_retry`

- ts: `2026-09-18T15:52:45.447Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `c143a34f-8dea-46e8-9b50-2837c120d14e`
- 原始 detail（JSON，逐字）:

```json
{
  "code": "E1_E2_FIDELITY_VIOLATION",
  "role": "executor",
  "attempt": 1,
  "w4Class": "DRIFT"
}
```

### seq 14 — `ir_entry_written`

- ts: `2026-09-18T15:52:46.311Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `8fce9e38-a1d6-429e-9e88-01fc62cfd1e2`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "chars": 14010
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`chars` = 14010

### seq 15 — `ir_entry_written`

- ts: `2026-09-18T15:52:46.316Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `a3a8d0c4-3482-49c1-89e6-ee4611be7681`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 1301
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 1301

### seq 16 — `ir_entry_written`

- ts: `2026-09-18T15:55:11.931Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `3737e82e-52f9-4e90-b9a3-88c6639d5a9e`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "chars": 23136,
  "e1_chars": 14010
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`chars` = 23136　·　`e1_chars` = 14010

### seq 17 — `ir_entry_written`

- ts: `2026-09-18T15:55:11.939Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `52b591f0-36ca-4b4b-9cae-7ff49995524f`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": true,
  "detail": "全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = true
detail：

> 全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点

### seq 18 — `ir_entry_written`

- ts: `2026-09-18T15:55:11.943Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `e1eb6e76-bed0-46e5-89d9-9c49c92a6f5f`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": false,
  "detail": "E1 标记了但 IR 未声明的假设：..."
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = false
detail：

> E1 标记了但 IR 未声明的假设：...

### seq 19 — `ir_entry_written`

- ts: `2026-09-18T15:55:11.947Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `09ac5e01-9b11-4c8b-986b-075d85065b8b`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": true,
  "detail": "10 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = true
detail：

> 10 条假设声明在 E1 中均有同名锚点

### seq 20 — `ir_entry_written`

- ts: `2026-09-18T15:55:11.951Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `65aa86fa-9683-4852-a2c3-be700b262d74`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": false,
  "detail": "A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRAINT2: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-PGOOD: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E-SOLVED: e1_span 在 E1 中找不到逐字匹配（疑似改写）"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = false
detail：

> A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRAINT2: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-PGOOD: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E-SOLVED: e1_span 在 E1 中找不到逐字匹配（疑似改写）

### seq 21 — `provider_retry`

- ts: `2026-09-18T15:55:11.962Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `367bfca9-8778-4bc5-a95a-f9ed708810c7`
- 原始 detail（JSON，逐字）:

```json
{
  "code": "E1_E2_FIDELITY_VIOLATION",
  "role": "executor",
  "attempt": 2,
  "w4Class": "DRIFT"
}
```

### seq 22 — `ir_entry_written`

- ts: `2026-09-18T15:55:14.223Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `9c3fcf01-614f-4128-9f3f-39820bfe8172`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "chars": 14010
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`chars` = 14010

### seq 23 — `ir_entry_written`

- ts: `2026-09-18T15:55:14.227Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `d9be1500-61e3-4658-90d3-eefc4d68c069`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 1589
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 1589

### seq 24 — `ir_entry_written`

- ts: `2026-09-18T15:56:04.626Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `fae6a035-7312-49f9-bc30-5f62b179ddc1`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "stage": "receive",
  "chars": 17175,
  "e1_chars": 14010
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`stage` = "receive"　·　`chars` = 17175　·　`e1_chars` = 14010

### seq 25 — `ir_entry_written`

- ts: `2026-09-18T15:56:04.632Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `33e8e5cc-d356-425d-ac29-12202ec4f996`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": true,
  "detail": "全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = true
detail：

> 全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点

### seq 26 — `ir_entry_written`

- ts: `2026-09-18T15:56:04.636Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `7df74623-cc63-4962-bf37-348db9d3876c`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": false,
  "detail": "E1 标记了但 IR 未声明的假设：..."
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = false
detail：

> E1 标记了但 IR 未声明的假设：...

### seq 27 — `ir_entry_written`

- ts: `2026-09-18T15:56:04.639Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `a3efe761-def4-45d6-ba68-e1a6873711f6`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": true,
  "detail": "10 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = true
detail：

> 10 条假设声明在 E1 中均有同名锚点

### seq 28 — `ir_entry_written`

- ts: `2026-09-18T15:56:04.643Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `abcbf640-f59e-43a9-a85b-b2e524788dec`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "fd8293ed-6c06-42eb-8ef0-06a103eea9be",
  "ok": false,
  "detail": "A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRAINT2: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-PGOOD: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E-SOLVED: e1_span 在 E1 中找不到逐字匹配（疑似改写）"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "fd8293ed-6c06-42eb-8ef0-06a103eea9be"　·　`ok` = false
detail：

> A-P1-CHOICE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-CONSTRAINT2: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-PGOOD: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-E-SOLVED: e1_span 在 E1 中找不到逐字匹配（疑似改写）

### seq 29 — `gate_failed`

- ts: `2026-09-18T15:56:04.660Z`
- actor: `paper-executor`
- runId: `fe865595-dde3-48c6-a464-7101b364d703`
- id: `bd92f520-e6c4-4df0-8bad-524dacbfb0c7`
- 原始 detail（JSON，逐字）:

```json
{
  "gate": "ir_producer",
  "reason": "DRIFT guidance budget exhausted"
}
```

