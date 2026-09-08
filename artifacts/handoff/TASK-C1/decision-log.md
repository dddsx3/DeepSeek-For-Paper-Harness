# TASK-C1 decision log

## D-C1 裁决单签批(2026-09-08,代签,沿用 P-A/P-B/P-C 先例)

| 单 | 裁决 | 理由 |
|---|---|---|
| **C-A 舱体形态** | **B(挂进现有面)+ 风险#1 预设降级映射落地为「独立壳 + 事件订阅层共用」** | 实测盘点:`apps/web` 的 `client-web` bootstrap 是通用 harness UI 壳(boot-page/loader),无 per-page 扩展点;把驾驶舱五区塞进通用壳 = 改产品面代码,违反禁全批(舱体只投影)。降级映射正是任务书预设的兜底:**独立本地壳,但事件订阅、守卫、verify、文案全部同源复用**(引擎零改动),实测后如产品面开放扩展点可再迁移。 |
| **C-B 实时进度技术** | **B(SSE 优先,断线自动降级轮询)** | 事件驱动的真实时;实现为单端点 `GET /api/runs/:id/events/stream`(afterSeq 增量),EventSource 断线自动重连即天然降级,无需轮询代码路径。 |
| **C-C 溯源卡范围** | **B(Claim/Result/Figure 三类)** | 图表是学生最怀疑的对象;数字零通道的用户可见化必须覆盖到图。 |

## D-C1.0 舱体架构(独立壳的边界声明)

- cockpit server(`apps/cockpit/server.mjs`)是**投影层**:只读 workflow 引擎的
  run/node/event/artifact 记录(经 `PaperWorkflowEngine` 只读 API)与审计流,
  不写任何引擎状态;唯一的写路径是 FalseBlock 裁决表(`TASK-P2/study/falseblock.jsonl`,
  pilot-protocol §2 的字段,且是研究档案不是引擎状态)。
- 题面守卫**零复制**:server 直接 import `readProblemFile`(apps/paper-shell)。
- manifest 徽章**零复制**:直接 import `verifyStudyManifest`(apps/paper-shell)。
- 文案零第二套:全部出自 shell 的 `blockMessage` 人话表。
- 禁 C1-0 自查:门逻辑/失败分类/哈希计算不出现在 cockpit 代码;舱只投影。
