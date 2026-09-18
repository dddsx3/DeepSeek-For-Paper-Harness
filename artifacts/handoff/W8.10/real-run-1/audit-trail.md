# real-run-1 审计轨迹（audit trail）

- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- 来源: `apps/paper-shell/src/paper-shell-persist-49bCAV/paper_audit.json`（sha256 `c9053665319465fbcda84d6e0120fec9b45ced9f0435a1df805d87da3e9eb4e1`）
- audit unit: `{"name":"paper_audit","version":0}`
- 事件数: 28（按 `seq` 升序；源表为 16 位零填充字符串键对象，非数组）
- 原始数组: `audit-trail.json`（本文是同一数组的可读渲染）

> 渲染规则：所有标量逐字；字符串型 `detail` 字段超过 300 字符时截断并**标注已截断**。
> 另需注意：harness 落盘时已按 `packages/paper/paper-foundation/src/executor.ts:1630`
> 的 `finding.detail.slice(0, 400)` 截断，故「原文 400 字符」不等于完整模型输出。

## 事件总表

| seq | ts | actor | runId | eventType | 摘要 |
|---|---|---|---|---|---|
| 1 | 2026-09-18T05:48:41.686Z | paper-shell | null | `production_enabled` | tier=T1 mode=strict route=https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash |
| 2 | 2026-09-18T05:48:42.519Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `workflow_started` | mode=strict |
| 3 | 2026-09-18T05:52:55.513Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E1Analysis id=e1 chars=5253 |
| 4 | 2026-09-18T05:54:13.720Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E2Normalization id=e2 chars=10699 |
| 5 | 2026-09-18T05:54:13.726Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=DataArtifact id=DA-RAW |
| 6 | 2026-09-18T05:54:13.731Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=RequirementSpec id=R-OUT |
| 7 | 2026-09-18T05:54:13.736Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=ProblemSpec id=P1 |
| 8 | 2026-09-18T05:54:13.741Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=false detail="E1 缺少 1 个要求的推理段：R-OUT" |
| 9 | 2026-09-18T05:54:13.744Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 10 条假设锚点均有对应 AssumptionSpec" |
| 10 | 2026-09-18T05:54:13.747Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="10 条假设声明在 E1 中均有同名锚点" |
| 11 | 2026-09-18T05:54:13.752Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A1-BATCH: 未声明 e1_span；A2-POINT-DEFECT: 未声明 e1_span；… |
| 12 | 2026-09-18T05:54:13.762Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `provider_retry` | attempt=1 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 13 | 2026-09-18T05:54:14.874Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E1Reused id=e1 chars=5253 |
| 14 | 2026-09-18T05:54:14.879Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=1509 |
| 15 | 2026-09-18T05:56:11.948Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E2Normalization id=e2 chars=14696 |
| 16 | 2026-09-18T05:56:11.952Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=false detail="E1 缺少 1 个要求的推理段：R-OUT" |
| 17 | 2026-09-18T05:56:11.956Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 10 条假设锚点均有对应 AssumptionSpec" |
| 18 | 2026-09-18T05:56:11.960Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="10 条假设声明在 E1 中均有同名锚点" |
| 19 | 2026-09-18T05:56:11.964Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A1-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A2-POINT-DEFE… |
| 20 | 2026-09-18T05:56:11.975Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `provider_retry` | attempt=2 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 21 | 2026-09-18T05:56:13.683Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E1Reused id=e1 chars=5253 |
| 22 | 2026-09-18T05:56:13.687Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=2107 |
| 23 | 2026-09-18T05:57:07.441Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=E2Normalization id=e2 chars=10806 |
| 24 | 2026-09-18T05:57:07.446Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=false detail="E1 缺少 1 个要求的推理段：R-OUT" |
| 25 | 2026-09-18T05:57:07.449Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 10 条假设锚点均有对应 AssumptionSpec" |
| 26 | 2026-09-18T05:57:07.453Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="10 条假设声明在 E1 中均有同名锚点" |
| 27 | 2026-09-18T05:57:07.457Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A2-POINT-DEFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A5-EXC… |
| 28 | 2026-09-18T05:57:07.473Z | paper-executor | `edca6fcf-ba03-45f9-aae5-779b2604396a` | `gate_failed` | gate=ir_producer reason=DRIFT guidance budget exhausted |

## 逐事件明细

### seq 1 — `production_enabled`

- ts: `2026-09-18T05:48:41.686Z`
- actor: `paper-shell`
- runId: `null`
- id: `5c88727a-8eaf-4c8d-b8df-97f445e0ffcb`
- 原始 detail（JSON，逐字）:

```json
{
  "tier": "T1",
  "mode": "strict",
  "route": "https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash"
}
```

### seq 2 — `workflow_started`

- ts: `2026-09-18T05:48:42.519Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `a5d8dea2-4dfb-4783-a60f-652f6a26cfb4`
- 原始 detail（JSON，逐字）:

```json
{
  "mode": "strict"
}
```

### seq 3 — `ir_entry_written`

- ts: `2026-09-18T05:52:55.513Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `324d92eb-62c1-4975-9a6d-bbe6aa4395eb`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Analysis",
  "id": "e1",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "chars": 5253
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Analysis"　·　`id` = "e1"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`chars` = 5253

### seq 4 — `ir_entry_written`

- ts: `2026-09-18T05:54:13.720Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `a2dc9221-8ae8-4a74-8abf-22aa7c40d7ea`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "chars": 10699,
  "e1_chars": 5253
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`chars` = 10699　·　`e1_chars` = 5253

### seq 5 — `ir_entry_written`

- ts: `2026-09-18T05:54:13.726Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `6e8506a7-02da-4a20-a280-527242d84d5c`
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

- ts: `2026-09-18T05:54:13.731Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `33c4e3d9-ab1a-42ba-b816-91e3ff50290f`
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

- ts: `2026-09-18T05:54:13.736Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `220936e3-f1c0-4149-a2c2-97ecbe1730e7`
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

- ts: `2026-09-18T05:54:13.741Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `ec8757af-099c-41dd-b862-03e9d408e383`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": false,
  "detail": "E1 缺少 1 个要求的推理段：R-OUT"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = false
detail：

> E1 缺少 1 个要求的推理段：R-OUT

### seq 9 — `ir_entry_written`

- ts: `2026-09-18T05:54:13.744Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `323e00e8-10e1-4a74-b856-2549238a9df0`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": true,
  "detail": "E1 的 10 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = true
detail：

> E1 的 10 条假设锚点均有对应 AssumptionSpec

### seq 10 — `ir_entry_written`

- ts: `2026-09-18T05:54:13.747Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `9c1100c1-b020-416e-8d12-80dc281cdf5d`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": true,
  "detail": "10 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = true
detail：

> 10 条假设声明在 E1 中均有同名锚点

### seq 11 — `ir_entry_written`

- ts: `2026-09-18T05:54:13.752Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `a55c8596-aa41-4898-adb9-a26894162e7f`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": false,
  "detail": "A1-BATCH: 未声明 e1_span；A2-POINT-DEFECT: 未声明 e1_span；A3-INDEPENDENT: 未声明 e1_span；A4-DEFECT-CAUSE: 未声明 e1_span；A5-EXCHANGE-LOSS: 未声明 e1_span；A6-DISASSEMBLE-RECOVER: 未声明 e1_span；A7-REPEAT: 未声明 e1_span；A8-SCALE: 未声明 e1_span；A9-SAMPLING-ESTIMATE: 未声明 e1_span；A10-CONFIDENCE-LEVEL: 未声明 e1_span；EQ-OC: 未声明 e1_span；EQ-REJECT: 未声明 e1_span；EQ-ACCEPT: 未声明 e1_span；EQ-OBJ: 未声明 e1_span"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = false
detail（已截断至 300 字符（原文 371 字符））：

> A1-BATCH: 未声明 e1_span；A2-POINT-DEFECT: 未声明 e1_span；A3-INDEPENDENT: 未声明 e1_span；A4-DEFECT-CAUSE: 未声明 e1_span；A5-EXCHANGE-LOSS: 未声明 e1_span；A6-DISASSEMBLE-RECOVER: 未声明 e1_span；A7-REPEAT: 未声明 e1_span；A8-SCALE: 未声明 e1_span；A9-SAMPLING-ESTIMATE: 未声明 e1_span；A10-CONFIDENCE-LEVEL: 未声明 e1_span；EQ-OC: 未声明 e1

### seq 12 — `provider_retry`

- ts: `2026-09-18T05:54:13.762Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `5fd20c3f-1745-4c4f-9f1f-b52a3d4265b1`
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

- ts: `2026-09-18T05:54:14.874Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `00a7cd6e-d1e9-4276-8fc3-c4813af69886`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "chars": 5253
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`chars` = 5253

### seq 14 — `ir_entry_written`

- ts: `2026-09-18T05:54:14.879Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `bf61348c-175a-4186-818f-a6c96959357f`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 1509
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 1509

### seq 15 — `ir_entry_written`

- ts: `2026-09-18T05:56:11.948Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `13218fed-4bb8-4754-a213-e7da4b03cbd6`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "chars": 14696,
  "e1_chars": 5253
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`chars` = 14696　·　`e1_chars` = 5253

### seq 16 — `ir_entry_written`

- ts: `2026-09-18T05:56:11.952Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `b0097195-3d9a-43c1-aaea-6983dc9345fb`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": false,
  "detail": "E1 缺少 1 个要求的推理段：R-OUT"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = false
detail：

> E1 缺少 1 个要求的推理段：R-OUT

### seq 17 — `ir_entry_written`

- ts: `2026-09-18T05:56:11.956Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `e22ba3e3-ec3b-405c-8184-e4add0d0f3bf`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": true,
  "detail": "E1 的 10 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = true
detail：

> E1 的 10 条假设锚点均有对应 AssumptionSpec

### seq 18 — `ir_entry_written`

- ts: `2026-09-18T05:56:11.960Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `a8452150-6132-42d2-b75b-0a12267f9abb`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": true,
  "detail": "10 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = true
detail：

> 10 条假设声明在 E1 中均有同名锚点

### seq 19 — `ir_entry_written`

- ts: `2026-09-18T05:56:11.964Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `afd84e01-bd36-4588-9915-a71c41172fcb`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": false,
  "detail": "A1-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A2-POINT-DEFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A3-INDEPENDENT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A4-DEFECT-CAUSE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A6-DISASSEMBLE-RECOVER: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A7-REPEAT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A8-SCALE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A9-SAMPLING-ESTIMATE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A10-CONFIDENCE-LEVEL: e1_span 在 E1 中找不到逐字匹配（疑似改写）"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = false
detail（已截断至 300 字符（原文 400 字符）；原文长度恰为 400：harness 落盘时已按 `executor.ts:1630` 的 `slice(0, 400)` 截断，此处不是完整模型输出）：

> A1-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A2-POINT-DEFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A3-INDEPENDENT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A4-DEFECT-CAUSE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A6-DISASSEMBLE-RECOVER: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A7-REPEAT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A8-SCALE: e1_span 在 E1 中找不到逐字匹配（疑似改写）

### seq 20 — `provider_retry`

- ts: `2026-09-18T05:56:11.975Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `ce1f8d86-d810-4d37-a694-faa5b5c6cf8d`
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

- ts: `2026-09-18T05:56:13.683Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `206661c1-6748-4d46-a053-230b4b9d6213`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "chars": 5253
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`chars` = 5253

### seq 22 — `ir_entry_written`

- ts: `2026-09-18T05:56:13.687Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `cd909c10-6a4c-4478-8330-7651d0afb2a2`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 2107
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 2107

### seq 23 — `ir_entry_written`

- ts: `2026-09-18T05:57:07.441Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `df831ce0-1681-4239-b5ba-0e4e4bacad53`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "stage": "receive",
  "chars": 10806,
  "e1_chars": 5253
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`stage` = "receive"　·　`chars` = 10806　·　`e1_chars` = 5253

### seq 24 — `ir_entry_written`

- ts: `2026-09-18T05:57:07.446Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `dcc36565-682e-460c-8546-8f2722914f01`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": false,
  "detail": "E1 缺少 1 个要求的推理段：R-OUT"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = false
detail：

> E1 缺少 1 个要求的推理段：R-OUT

### seq 25 — `ir_entry_written`

- ts: `2026-09-18T05:57:07.449Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `e462052c-8701-44cf-8799-517520043f4d`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": true,
  "detail": "E1 的 10 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = true
detail：

> E1 的 10 条假设锚点均有对应 AssumptionSpec

### seq 26 — `ir_entry_written`

- ts: `2026-09-18T05:57:07.453Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `f5cb7570-1a8c-4091-bd0b-0f3d0ce72659`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": true,
  "detail": "10 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = true
detail：

> 10 条假设声明在 E1 中均有同名锚点

### seq 27 — `ir_entry_written`

- ts: `2026-09-18T05:57:07.457Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `384b2d09-2392-4064-9ca7-9ba7d741f810`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "bf71b45d-cf5a-4e9e-a3ce-a015b787a398",
  "ok": false,
  "detail": "A2-POINT-DEFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A5-EXCHANGE-LOSS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A8-SCALE: e1_span 在 E1 中找不到逐字匹配（疑似改写）"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "bf71b45d-cf5a-4e9e-a3ce-a015b787a398"　·　`ok` = false
detail：

> A2-POINT-DEFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A5-EXCHANGE-LOSS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A8-SCALE: e1_span 在 E1 中找不到逐字匹配（疑似改写）

### seq 28 — `gate_failed`

- ts: `2026-09-18T05:57:07.473Z`
- actor: `paper-executor`
- runId: `edca6fcf-ba03-45f9-aae5-779b2604396a`
- id: `5aee7a92-2c31-40b1-a3c9-f4191cef8188`
- 原始 detail（JSON，逐字）:

```json
{
  "gate": "ir_producer",
  "reason": "DRIFT guidance budget exhausted"
}
```

