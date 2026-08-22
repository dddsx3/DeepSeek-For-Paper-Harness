# `@deepseek-ai/dsh-harness-foundation`

[English](README.md) | 中文

Harness 扩展的第二阶段基础包。本包拥有版本化的工作流运行记录、共享 `storage-domain` 声明、该域之上的仓储层、角色设置 schema，以及基于 `ctx.llm` 的受限诊断服务。

本包刻意复用 harness 既有的 LLM 词汇与存储服务：不新建第二套消息协议、不新建第二个持久化后端，诊断也不创建普通 Session。凭据字段只保存引用；凭据值由既有 credentials seam 在提供方边界解析。

## 范围

- `workflowRunDomainSpec`：运行、节点、事件、产物与清单的第 1 版持久记录。
- `DomainWorkflowRunRepository`：对共享 storage-domain 服务的类型化访问。
- `HarnessDiagnosticsService`：可取消、有界的提供方探测，只返回状态、路由、模型、延迟和一个稳定代码。
- `HarnessFoundationService`：工作流域的生命周期持有者。
- `WorkflowEngine`：持久化的运行/节点状态转换与进程恢复对账。
- `replayWorkflow`：连续事件日志回放，转换校验失败即拒。
- `WorkflowEngineService`：Cordis 生命周期服务，启动时回放并恢复活动运行。
- `WorkflowExecutor` / `HarnessExecutorService`：驱动运行走完 plan、execute、按模式限轮的复核循环与带清单的交付；fast 模式在修订轮次用尽后仍交付，strict 模式在缺陷仍存在时让运行失败。
- `resolveRunPolicy`：按模式限定的修订轮数与节点尝试上限。
- `classifyFailure` / `backoffDelayMs`：提供方失败被分派为重试、阻断或修订，指数退避且永不低于提供方要求的等待时间。
- `resolveModelPrice` / `computeCostUsd` / `evaluateBudget`：成本由 token 数按配置价格表算出，并对照日预算上限判定，strict 模式上限更高。
- `compactPrompt` / `estimateTextTokens`：提示词分段按仓库既有的每 4 字符 1 token 密度定价，并按声明优先级裁剪，使请求适配模型窗口。
- `HarnessAuditService`：位于独立 `harness_audit` 域的持久审计追踪，按追加序号排序，并按保留期清理。
- `redactSensitiveText` / `redactSensitiveValue` / `redactSensitiveDetail`：凭据遮蔽，在任何内容变为持久或诊断输出之前施加。
- `SignedSkillProvider`：可选的签名包来源，通过既有 `ctx.skills` 提供方接口注册。
- `SkillCatalogService`：技能包的持久安装、版本历史、回滚与冲突检测。
- `CatalogSkillProvider`：通过 `ctx.skills` 提供目录的活跃版本。

`harness.*` apiproxy 域（`api/harness.ts`）暴露运行控制（`harness.runs.*`）、带 `afterSeq` 游标的可续传事件读取，以及目录操作（`harness.skills.*`），并使用结构化的 `harness-*` 错误代码；引擎服务命名为 `harnessWorkflow`，以避开上游已占用的 `workflowEngine`。持久事件同时通过 `harness/run-event` Cordis 事件在进程内推送，该事件已列入 `API_REMOTE_FORWARDED_EVENTS`，因此远程消费者可经既有下行通道以 `host/remote-event` 帧收到它们。

请求在发出前会被适配到该角色的上下文窗口：优先级最低的分段先让位（可重新生成的计划、缺陷清单、草稿、任务陈述，指令永不裁剪），被裁剪的分段保留首尾；当每个可裁剪分段都触底后，提示词以能做到的最短形式发出，而不是静默丢弃必需分段。一旦发生裁剪，未裁剪的完整提示词会存为运行产物，请求携带其引用，使完整文本无需重发即可追回。

节点只重试重试能修复的失败；凭据、路由与请求合法性类失败立即让运行失败，而尝试次数用尽的节点转入暂停待人工复核而非失败，因此恢复后的运行可从该节点继续。一旦当日预算用尽，运行拒绝发起新的模型调用：转入暂停并记录该拒绝。审计明细与提供方文本在入库前被遮蔽，因此没有凭据值进入追踪。

引擎只负责状态事实与恢复。签名包必须通过清单、文件哈希、兼容性、信任根与 Ed25519 校验才能加载；未签名包仅在开发态配合 `allowUnsigned` 加载，生产构建一律拒绝。目录安装会拒绝会导致同一工具被声明两次、或互斥标签组同时激活的技能组合。提供方重试策略、用户界面、事件传输与迁移逻辑属于后续阶段。

本包运行在上游 TypeScript/Cordis 插件架构之上；不计划引入 FastAPI、Electron 或 Python 伴随进程。
