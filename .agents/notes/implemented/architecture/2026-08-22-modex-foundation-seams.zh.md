# Agent Note: Harness foundation reuses storage and LLM seams

Status: implemented

[English](2026-08-22-harness-foundation-seams.md) | 中文

## 问题

第二阶段实现需要持久化的工作流运行记录、角色设置和受限的提供方诊断，同时不得在 harness 内引入第二套消息协议、第二个持久化介质或第二份凭据文档。

## 决策

Harness 重建运行在上游 TypeScript/Cordis 插件架构之上（`packages/*/*`、Zod schema、storage-domain 持久化、`ctx.llm` 与 `ctx.skills` seam）。FastAPI、Electron 或 Python 伴随进程方案经评估后被否决：它会复制一份上游运行时，并产生第二个持久状态来源。该决策对后续所有阶段关闭了产品形态问题。

`@deepseek-ai/dsh-harness-foundation` 是位于 `packages/harness/harness-foundation` 的宿主包。其版本化 Zod 记录在 `src/spec.ts` 中声明一次，并通过既有 `storage-domain` 设施打开。`DomainWorkflowRunRepository` 暴露类型化的运行、节点、事件、产物与清单操作，同时不让后端细节泄漏给工作流消费者。

角色设置使用既有的 settings namespace 机制，且只保存凭据引用。`HarnessProviderService` 通过 `ctx.llm.resolveModelInfo()` 解析角色、通过 `ctx.llm.stream()` 派发，因此 DeepSeek 始终是适配器自有的实现。`HarnessDiagnosticsService` 执行一次受限且可取消的请求，不创建普通 Session，只返回路由、模型、延迟和一个稳定状态代码。`WorkflowEngine` 拥有持久化的运行/节点状态转换与恢复对账；`replayWorkflow` 在恢复前校验事件历史的连续性，`WorkflowEngineService` 在启动时执行该恢复。`SignedSkillProvider` 是既有 `ctx.skills` 注册表上的可选来源；它在暴露技能前校验清单兼容性、声明的文件哈希、信任根选择与分离式 Ed25519 签名。`SkillCatalogService` 在自有的 `harness_skills` 域上拥有持久安装、版本历史与回滚，拒绝活跃工具或互斥标签组相撞的技能组合，且仅在开发态配合 `allowUnsigned` 接受未签名包，生产构建绝不接受。`CatalogSkillProvider` 通过 `ctx.skills` 提供目录的活跃版本。`harness.*` apiproxy 域暴露运行控制（`list/get/start/pause/resume/cancel`）、可续传的事件读取（`events`，在持久日志上使用 `afterSeq` 游标）与目录操作，并使用结构化的 `harness-*` 错误代码；两个 Harness 服务都保持为可选组合。`WorkflowExecutor` 驱动 plan、execute、按模式限轮的复核循环（`resolveRunPolicy`：fast 在一轮修订后交付，strict 允许三轮并在缺陷仍存在时失败）以及带清单的交付；每次模型调用都走共享提供方 seam，每条事实都走引擎，因此执行始终可回放。持久事件以 `harness/run-event` 在进程内推送，并通过 `API_REMOTE_FORWARDED_EVENTS` 允许清单转发给远程消费者（`host/remote-event` 帧）。

重试、成本与审计是执行器组合的独立 seam，而不是状态机内部的逻辑。`classifyFailure` 判定一个提供方失败应当重试、阻断，还是需要内容修订；`backoffDelayMs` 带抖动指数增长，且永不低于提供方要求的等待时间；尝试次数用尽的节点转入暂停待人工复核而非失败，因此恢复后的运行可从该节点继续。成本由 token 数按配置价格表算出，而非信任提供方返回的字段；`evaluateBudget` 在当日上限用尽后暂停运行，strict 模式上限更高，因为它复核更多。`HarnessAuditService` 拥有独立的 `harness_audit` 域并按追加序号排序，因为两次操作可能落在同一毫秒，而无法说明先后的追踪不构成证据；每个明细映射都先经过 `redactSensitiveDetail`。上下文预算是第四个被组合的 seam：`compactPrompt` 按仓库既有的每 4 字符密度为带标签的提示词分段定价，并按声明的优先级顺序裁剪，因此可重新生成的计划先让位，随后是缺陷清单、草稿，最后是任务陈述，而指令永不被裁剪。触及保留下限的分段会被退役，使下一优先级层级让位，而不是让遍历预算空转在同一分段上；仍然无法容纳的提示词会以模块能做到的最短形式发出——并报告一个高于预算的估算值——而不是丢弃必需分段。被省略的内容会存为运行产物并从请求中引用，这正是大体量内容无需重发即可追回的方式。预算、退避、保留期、价格以及上下文占用比例都是经校验的服务配置，而非常量。

自更新是第五个被组合的 seam，被拆成一个纯校验器与一个持久记录器。`verifyReleaseManifest` 判定单份清单——schema、harness 版本下限、信任根，以及覆盖"去掉签名块后的稳定 JSON 载荷"的分离式 Ed25519 签名；`verifyReleaseArtifacts` 先核对每个产物的大小再核对其 SHA-256，因此被截断的下载在做哈希之前就被拒绝。更新源是调用方提供的读取器，而不是本包自行打开的 URL，这既把"更新是否可达"的决定权留给部署方，也让测试无需联网。`isInRollout` 把灰度解析为"安装身份 + 版本号"的纯函数（SHA-256 分桶到万分位），因此已进入灰度的安装重启后仍在灰度内，而不是每次启动重新抽签；被暂缓的安装仍可能被下一个版本纳入。`HarnessReleaseService` 在自有的 `harness_releases` 域上拥有持久那一半：它铸造一个稳定的安装 id，拒绝暂存任何未通过校验或尚未被灰度覆盖的版本，记录当前激活版本及其被替换者，并在启动对账时把"已激活但从未确认健康"的版本回滚到其前任——坏版本无法把一台安装困在自己身上。暂存、激活与回滚通过可选的审计服务进入审计追踪。该服务刻意不做的是移动文件或重启进程：它只决定并记录应当激活什么，机械动作由调用它的安装器完成，因为校验失败与文件拷贝失败是两类问题，恢复方式也不同。

## 曾考虑的替代方案

- 新增第二个 Python 服务与数据库会复制上游运行时，并产生两个持久状态来源。
- 定义新的 Harness 消息或提供方接口会重复 `dsh-llm` 已拥有的 `GenerateOptions`、`StreamChunk` 与 `LlmFailure`。
- 把凭据值存入 Harness 设置记录会违反既有 credentials seam，并使普通设置读取变得不安全。
- 让发布服务自己拷贝产物并重启进程，会把安装器的机械动作塞进一个"负责判定应当激活什么"的服务里；两类关注点的失败方式不同，应当分开。

## 后果

本包要求组合中已存在 storage-domain、settings、credentials 与 LLM 服务。工作流状态机、传输端点、重试策略与内容迁移属于后续阶段。新域标记为版本 1，并通过共享存储后端拒绝不兼容的介质。交付形态是一个 profile 层：位于 `packages/harness/harness-bundle` 的 `@deepseek-ai/dsh-harness`，其 `cordis.patch.yml` 在 `dsh-base` 与某个模式组合包之上插入组合、技能目录、目录 provider 与 invariant 伴生插件。由于这些行在各自的注入项上挂起，缺少存储的 profile 会挂载它们却永不激活，因此 bundle 插件在加载时点名缺失的服务，而不是让这种沉默无人解释。该层随包交付的默认值刻意是"不作为"的——不配价格表、不配信任根、`allowUnsigned: false`——因此花钱与更新都必须由部署方显式选择开启。

## Testing

两个编译面均无错误构建，且本包满足仓库的每文件 100% 覆盖率门禁：schema、存储、提供方、诊断、设置、工作流、回放、上下文预算、成本、弹性、遮蔽、审计、技能目录、发布校验、发布状态以及 apiproxy harness 域的测试套件均无需网络访问即可运行。bundle 自己的套件用加载器的 entry-list schema 解析随包交付的 `cordis.patch.yml`，因此 patch 里被改名的行会在构建时失败，而不是等到某个 profile 加载时才暴露。发布状态套件在内存存储后端上跑完暂存、激活、确认与回滚，并重新打开同一份介质，以证明安装 id 能跨重启存活、且未经证实的版本会在下次启动时回滚。包自有的 invariant 伴生插件会检查未声明的域表，以及持久值是否符合其声明的 schema。

`tests/workflow.e2e.ts` 是真实 API 验收套件，在缺少 `$DEEPSEEK_API_KEY` 时自动整体跳过，因此无密钥的流水线依然通过。它断言持久事实而非模型措辞——清单、产物、累计用量、审计追踪，以及事件日志回放与记录一致——并刻意省略 strict 模式用例：其四轮复核会花费四倍调用，去验证单元测试已覆盖的同一批事实。
