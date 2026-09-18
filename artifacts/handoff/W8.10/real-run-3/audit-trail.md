# real-run-3 审计轨迹（audit trail）

- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- 来源: `apps/paper-shell/src/paper-shell-persist-eXRp4h/paper_audit.json`（sha256 `f12a307b76e440d03f7694b8f43f8e8a0fa8172df9acd946c32d95a7b3494443`）
- audit unit: `{"name":"paper_audit","version":0}`
- 事件数: 29（按 `seq` 升序；源表为 16 位零填充字符串键对象，非数组）
- 原始数组: `audit-trail.json`（本文是同一数组的可读渲染）

> 渲染规则：所有标量逐字；字符串型 `detail` 字段超过 300 字符时截断并**标注已截断**。
> 另需注意：harness 落盘时已按 `packages/paper/paper-foundation/src/executor.ts:1630`
> 的 `finding.detail.slice(0, 400)` 截断，故「原文 400 字符」不等于完整模型输出。

## 事件总表

| seq | ts | actor | runId | eventType | 摘要 |
|---|---|---|---|---|---|
| 1 | 2026-09-18T06:20:36.595Z | paper-shell | null | `production_enabled` | tier=T1 mode=strict route=https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash |
| 2 | 2026-09-18T06:20:36.912Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `workflow_started` | mode=strict |
| 3 | 2026-09-18T06:21:52.980Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=DataArtifact id=DA-RAW |
| 4 | 2026-09-18T06:21:52.984Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=RequirementSpec id=R-OUT |
| 5 | 2026-09-18T06:21:52.988Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=ProblemSpec id=P1 |
| 6 | 2026-09-18T06:23:00.815Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E1Analysis id=e1 chars=4113 |
| 7 | 2026-09-18T06:23:00.819Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=985 |
| 8 | 2026-09-18T06:24:07.590Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E2Normalization id=e2 chars=11818 |
| 9 | 2026-09-18T06:24:07.595Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=true detail="全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点" |
| 10 | 2026-09-18T06:24:07.598Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 9 条假设锚点均有对应 AssumptionSpec" |
| 11 | 2026-09-18T06:24:07.602Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="9 条假设声明在 E1 中均有同名锚点" |
| 12 | 2026-09-18T06:24:07.606Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="EQ-BINOMIAL: 未声明 e1_span；EQ-REJECT: 未声明 e1_span；EQ-… |
| 13 | 2026-09-18T06:24:07.618Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `provider_retry` | attempt=1 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 14 | 2026-09-18T06:24:08.571Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E1Reused id=e1 chars=4113 |
| 15 | 2026-09-18T06:24:08.574Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=1243 |
| 16 | 2026-09-18T06:25:42.789Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E2Normalization id=e2 chars=13262 |
| 17 | 2026-09-18T06:25:42.792Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=true detail="全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点" |
| 18 | 2026-09-18T06:25:42.796Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 9 条假设锚点均有对应 AssumptionSpec" |
| 19 | 2026-09-18T06:25:42.799Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="9 条假设声明在 E1 中均有同名锚点" |
| 20 | 2026-09-18T06:25:42.803Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-… |
| 21 | 2026-09-18T06:25:42.812Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `provider_retry` | attempt=2 code=E1_E2_FIDELITY_VIOLATION w4Class=DRIFT role=executor |
| 22 | 2026-09-18T06:25:44.630Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E1Reused id=e1 chars=4113 |
| 23 | 2026-09-18T06:25:44.633Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E2DriftGuidance id=e2-guidance guidance_chars=1802 |
| 24 | 2026-09-18T06:26:24.393Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=E2Normalization id=e2 chars=13740 |
| 25 | 2026-09-18T06:26:24.396Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B4 逐问推理覆盖 ok=true detail="全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点" |
| 26 | 2026-09-18T06:26:24.400Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 反向（E1 假设须被声明） ok=true detail="E1 的 9 条假设锚点均有对应 AssumptionSpec" |
| 27 | 2026-09-18T06:26:24.403Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 锚点同一性（声明须在 E1 中有同名锚点） ok=true detail="9 条假设声明在 E1 中均有同名锚点" |
| 28 | 2026-09-18T06:26:24.406Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `ir_entry_written` | kind=FidelityFinding id=B3 正向（声明须逐字锚定 E1） ok=false detail="A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-… |
| 29 | 2026-09-18T06:26:24.422Z | paper-executor | `148f8f63-eac0-49b1-9e46-a9eca9995bf3` | `gate_failed` | gate=ir_producer reason=DRIFT guidance budget exhausted |

## 逐事件明细

### seq 1 — `production_enabled`

- ts: `2026-09-18T06:20:36.595Z`
- actor: `paper-shell`
- runId: `null`
- id: `ef30ae4b-e18d-4dea-9c93-53996ecfd6af`
- 原始 detail（JSON，逐字）:

```json
{
  "tier": "T1",
  "mode": "strict",
  "route": "https://api.y-api.bestvirtualgoods.com/v1 + deepseek/deepseek-v4-flash"
}
```

### seq 2 — `workflow_started`

- ts: `2026-09-18T06:20:36.912Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `4655dae2-e24d-443b-86a0-0e107cd7bbc8`
- 原始 detail（JSON，逐字）:

```json
{
  "mode": "strict"
}
```

### seq 3 — `ir_entry_written`

- ts: `2026-09-18T06:21:52.980Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `f7054d47-d730-4cd0-b228-518ffc401201`
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

- ts: `2026-09-18T06:21:52.984Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `c3c1678b-442e-4afe-b73f-19f69dba0c52`
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

- ts: `2026-09-18T06:21:52.988Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `72415166-644f-480a-aebe-2520b6a371bd`
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

- ts: `2026-09-18T06:23:00.815Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `9a81c753-12c4-4716-a725-113b827eeb1a`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Analysis",
  "id": "e1",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "chars": 4113
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Analysis"　·　`id` = "e1"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`chars` = 4113

### seq 7 — `ir_entry_written`

- ts: `2026-09-18T06:23:00.819Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `31fd5248-f22d-4b1c-a752-e8d0244a6dce`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 985
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 985

### seq 8 — `ir_entry_written`

- ts: `2026-09-18T06:24:07.590Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `af2a5cd8-18f0-4d5d-8216-b9689487d875`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "chars": 11818,
  "e1_chars": 4113
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`chars` = 11818　·　`e1_chars` = 4113

### seq 9 — `ir_entry_written`

- ts: `2026-09-18T06:24:07.595Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `5a8cae8b-7921-492b-bfd3-4389f23d3eee`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> 全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点

### seq 10 — `ir_entry_written`

- ts: `2026-09-18T06:24:07.598Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `435f18a4-f3e8-456e-a72b-d7f544e7ace0`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "E1 的 9 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> E1 的 9 条假设锚点均有对应 AssumptionSpec

### seq 11 — `ir_entry_written`

- ts: `2026-09-18T06:24:07.602Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `8ed4e1a7-3cc4-4b94-814e-d5d3d16de75b`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "9 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> 9 条假设声明在 E1 中均有同名锚点

### seq 12 — `ir_entry_written`

- ts: `2026-09-18T06:24:07.606Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `b50c0bfc-36f5-4a4e-b6f6-f5bfb2d62a02`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": false,
  "detail": "EQ-BINOMIAL: 未声明 e1_span；EQ-REJECT: 未声明 e1_span；EQ-ACCEPT: 未声明 e1_span；EQ-PROFIT: 未声明 e1_span；EQ-REVENUE: 未声明 e1_span；EQ-COST: 未声明 e1_span"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = false
detail：

> EQ-BINOMIAL: 未声明 e1_span；EQ-REJECT: 未声明 e1_span；EQ-ACCEPT: 未声明 e1_span；EQ-PROFIT: 未声明 e1_span；EQ-REVENUE: 未声明 e1_span；EQ-COST: 未声明 e1_span

### seq 13 — `provider_retry`

- ts: `2026-09-18T06:24:07.618Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `781083f0-33ba-4234-871c-f73b811e0cb4`
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

- ts: `2026-09-18T06:24:08.571Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `e505bb03-894f-4e86-809c-131f34deb7da`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "chars": 4113
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`chars` = 4113

### seq 15 — `ir_entry_written`

- ts: `2026-09-18T06:24:08.574Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `4daa73c8-c0be-408f-8985-48643ff9c5fb`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 1243
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 1243

### seq 16 — `ir_entry_written`

- ts: `2026-09-18T06:25:42.789Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `31fa7597-9759-423e-bcc2-0227decbb6c0`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "chars": 13262,
  "e1_chars": 4113
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`chars` = 13262　·　`e1_chars` = 4113

### seq 17 — `ir_entry_written`

- ts: `2026-09-18T06:25:42.792Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `a9a8a80d-8a66-4f10-a918-f7daf6c45b0c`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> 全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点

### seq 18 — `ir_entry_written`

- ts: `2026-09-18T06:25:42.796Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `9a2a3a3d-e722-4131-9c7b-8a652fea503e`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "E1 的 9 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> E1 的 9 条假设锚点均有对应 AssumptionSpec

### seq 19 — `ir_entry_written`

- ts: `2026-09-18T06:25:42.799Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `317fdf94-551c-4721-a2aa-8a858e68c05d`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "9 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> 9 条假设声明在 E1 中均有同名锚点

### seq 20 — `ir_entry_written`

- ts: `2026-09-18T06:25:42.803Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `6026d4ea-7ce9-40a8-938d-71f645da889f`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": false,
  "detail": "A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SINGLE-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-DISASSEMBLY-PERFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-LINEAR-COSTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-ASSEMBLY-INDEPENDENCE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SYMMETRIC-COMPONENTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-BETA-PRIOR: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SAMPLING-REPRESENTATIVE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-BINOMIA"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = false
detail（已截断至 300 字符（原文 400 字符）；原文长度恰为 400：harness 落盘时已按 `executor.ts:1630` 的 `slice(0, 400)` 截断，此处不是完整模型输出）：

> A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SINGLE-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-DISASSEMBLY-PERFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-LINEAR-COSTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-ASSEMBLY-INDEPENDENCE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SYMMETRIC-COMPONENTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-BETA-

### seq 21 — `provider_retry`

- ts: `2026-09-18T06:25:42.812Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `019b521a-6e0b-4f50-bd09-80f6e3bdd39c`
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

- ts: `2026-09-18T06:25:44.630Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `70c2e725-bc6a-4937-ad39-385d56e35313`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E1Reused",
  "id": "e1",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "chars": 4113
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E1Reused"　·　`id` = "e1"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`chars` = 4113

### seq 23 — `ir_entry_written`

- ts: `2026-09-18T06:25:44.633Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `297c31f6-b909-411a-83ee-0e464bfba045`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2DriftGuidance",
  "id": "e2-guidance",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "applied": true,
  "guidance_chars": 1802
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2DriftGuidance"　·　`id` = "e2-guidance"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`applied` = true　·　`guidance_chars` = 1802

### seq 24 — `ir_entry_written`

- ts: `2026-09-18T06:26:24.393Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `f2f0dcac-a46c-447a-82f3-9fc91deeb1ac`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "E2Normalization",
  "id": "e2",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "stage": "receive",
  "chars": 13740,
  "e1_chars": 4113
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "E2Normalization"　·　`id` = "e2"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`stage` = "receive"　·　`chars` = 13740　·　`e1_chars` = 4113

### seq 25 — `ir_entry_written`

- ts: `2026-09-18T06:26:24.396Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `4d6909a5-ffd5-471a-9a43-17ac81274861`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B4 逐问推理覆盖",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B4 逐问推理覆盖"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> 全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点

### seq 26 — `ir_entry_written`

- ts: `2026-09-18T06:26:24.400Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `b7e0479f-48b0-460d-98d8-1acadd041ea9`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 反向（E1 假设须被声明）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "E1 的 9 条假设锚点均有对应 AssumptionSpec"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 反向（E1 假设须被声明）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> E1 的 9 条假设锚点均有对应 AssumptionSpec

### seq 27 — `ir_entry_written`

- ts: `2026-09-18T06:26:24.403Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `96218527-0815-4782-bd06-bc29ad292bf6`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 锚点同一性（声明须在 E1 中有同名锚点）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": true,
  "detail": "9 条假设声明在 E1 中均有同名锚点"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 锚点同一性（声明须在 E1 中有同名锚点）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = true
detail：

> 9 条假设声明在 E1 中均有同名锚点

### seq 28 — `ir_entry_written`

- ts: `2026-09-18T06:26:24.406Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `873d4cf3-0cd6-4bc6-a712-cafd9a530ad5`
- 原始 detail（JSON，逐字）:

```json
{
  "kind": "FidelityFinding",
  "id": "B3 正向（声明须逐字锚定 E1）",
  "nodeId": "4333deb3-97a5-402e-ab43-e97ec5c39c7d",
  "ok": false,
  "detail": "A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SINGLE-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-DISASSEMBLY-PERFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-LINEAR-COSTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-ASSEMBLY-INDEPENDENCE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SYMMETRIC-COMPONENTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-BETA-PRIOR: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SAMPLING-REPRESENTATIVE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；EQ-BINOMIA"
}
```

展开（`kind` / `id` / `ok` / `detail`）:

`kind` = "FidelityFinding"　·　`id` = "B3 正向（声明须逐字锚定 E1）"　·　`nodeId` = "4333deb3-97a5-402e-ab43-e97ec5c39c7d"　·　`ok` = false
detail（已截断至 300 字符（原文 400 字符）；原文长度恰为 400：harness 落盘时已按 `executor.ts:1630` 的 `slice(0, 400)` 截断，此处不是完整模型输出）：

> A-BINOMIAL-SAMPLING: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SINGLE-BATCH: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-DISASSEMBLY-PERFECT: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-LINEAR-COSTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-ASSEMBLY-INDEPENDENCE: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-SYMMETRIC-COMPONENTS: e1_span 在 E1 中找不到逐字匹配（疑似改写）；A-BETA-

### seq 29 — `gate_failed`

- ts: `2026-09-18T06:26:24.422Z`
- actor: `paper-executor`
- runId: `148f8f63-eac0-49b1-9e46-a9eca9995bf3`
- id: `71ce5ded-0818-4ff1-9519-9d59fd2efe8c`
- 原始 detail（JSON，逐字）:

```json
{
  "gate": "ir_producer",
  "reason": "DRIFT guidance budget exhausted"
}
```

