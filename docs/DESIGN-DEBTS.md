# DPH 设计债与已知问题台账（living document）

> **编制**：2026-10-27 治理轮。方法：把散落在 TOP-GOAL-direct-draft（B1–B8）、
> ISSUES-AND-ROOT-CAUSES（F/E/O/X/Z）、PENDING-FIXES（P0–P4）、TASK-P3/known-risks、
> HANDOFF 七形态中的条目**去重合并**，并对 HEAD（main `00d6b1c0bc` 附近）**逐条核实状态**。
> 后续每修一条：改状态行 + 写验收证据，不改编号。
>
> **状态图例**：`已修（已核实）` = 对 HEAD 代码验证过修复在位 ｜ `open（已核实）` = 对 HEAD
> 验证过仍存在 ｜ `open（快照记录）` = 来源台账记录在案、未对 HEAD 重新验证 ｜ `缓解` = 根因
> 未除但已有守卫。**严重级**：⛔阻断 TOP-GOAL / ◆高 / △中 / ○低。
> **根因层**：L1 引擎/协议 ｜ L2 驾驶舱投影 ｜ L3 遥测/文案 ｜ L4 中转/外部 ｜ L5 操作/环境。
> **形态**：HANDOFF §2 的七类"信号≠原因"（形态 6 = 修复只做判定侧，头号杀手）。

---

## §A 安全与工程治理（本轮新增，2026-10-27）

| 编号 | 严重级 | 状态 | 条目 | 证据 / 验收 |
|---|---|---|---|---|
| SEC-1 | ⛔ | **已修（历史重写待执行）** | 4 个运行脚本泄漏 3 把真实 API key（mhcoding/teamorouter/opencode）入 git 历史 | HEAD 已去密钥（`0d8c495c34`、`8478d6b71f`）；`verify-no-secrets` 门禁接入 ci-static/ci-primary（首跑即抓到后两处）；历史重写在阶段 6 执行。**三把 key 必须手动轮换作废** |
| SEC-2 | ◆ | **已修（已核实）** | cockpit 凭据配置（含真实 key）放源码树 `apps/cockpit/cockpit-settings.json` | 已迁 `$DPH_HOME/cockpit/`，server.mjs 读 DPH_HOME 优先+旧路径兼容（`854d401df3`）；example 模板入库 |
| GOV-1 | ◆ | **已修（已核实）** | 运行产物污染源码树：`apps/paper-shell/src/` 下 1117 个 persist 目录 + 共享 out 目录 | persist/默认 out/cockpit 目录统一迁 `<runs>/`（`00d6b1c0bc`，PAPER_RUN_DIR 可覆盖）；旧残留已归档删除 |
| GOV-2 | ◆ | **已修（已核实）** | 测试硬编码机器路径（`tests/architecture/smoke-repair.spec.ts:34` 的 `D:\deepseek modex\...`） | 已改中性路径（语义不变：仍是"Windows 反斜杠绝对路径"用例） |
| GOV-3 | △ | **已修（已核实）** | master/main CI 分叉：`ci-master.yml` 在 master（冻结的上游快照）上跑 push CI，产品线 main 无此触发 | ci-master 改纯 workflow_dispatch；主门禁 = `paper-harness.yml`（push main） |
| GOV-4 | △ | **已修（已核实）** | 468MB CSV 以 LFS 入库撑爆 .git/lfs（472MB）并耗 GitHub LFS 配额 | `git rm --cached` + gitignore + 本地 LFS 对象回收（.git/lfs 472MB→3.6MB）；获取方式见 `bench/problems/2024-E/README.md` |
| GOV-5 | ○ | **已修（已核实）** | 5 个 `.tmp-*` 调试残留被误提交入库 | 已删（`2140612c8a`） |

## §B 已核实-已修（本轮验证发现此前轮次已修复——旧台账不要倒着读）

| 编号（旧） | 严重级 | 状态 | 条目 | HEAD 证据 |
|---|---|---|---|---|
| E2/B2 | ⛔ | **已修（已核实）** | T2 `unledgered_reference` 被 ESCAPE 零重试（两模型族同点必死，"直出竞赛题"单点最大阻断） | D1 裁决落地：跨步引用不一致归 DRIFT 带回灌，free_id/free_structure/bypass_container 仍 ESCAPE 且测试钉住（`src/executor.ts:1173-1191`） |
| E3/B3/X3 | ◆ | **已修（已核实）** | 模型请求无总时长上限，慢/死不可区分 | `PAPER_PROBE_TIMEOUT_MS`（`apps/paper-shell/src/cli.ts:117`，提交 `62e9ae9814`）+ 空闲看门狗变量族 |
| E5 | △ | **已修（已核实）** | 事件标签恒为 `deepseek-official/placeholder` | display 携带真实 provider/model（`cli.ts:105-108`，TASK-2026-09-09 E5） |
| O1/B6 | ◆ | **已修（已核实）** | 无"取消运行"能力 | cockpit 取消端点杀子进程树、终态 cancelled（`apps/cockpit/server.mjs:643-653`） |
| O3/B5 | ◆ | **已修（已核实）** | 成本恒 $0 不可见 | `apps/cockpit/pricing.usd.json` 定价表 + `PAPER_PRICING_JSON` 注入 + run-report `cost_usd` 落账（`cli.ts:1317`） |
| B4'（图缺失） | ◆ | **已修（已核实）** | CLI 从不写出 `figures/*.svg`（报告链接的图全是空目录） | `cli.ts:1167-1185` 现在写 figures/ + figure-manifest.json |
| Z1/B8 | ◆ | **已修（已核实）** | PDF 题面需人工转 md | 13 阶段链 prob-analysis 含 pypdf + openxpl 摄入（HANDOFF-2026-10-06 §3、`stages/` 资产） |

| AUD-ROUTE | ◆ | L1 | **已修（已核实，2026-10-27）** | `adapterStream` 从不转发 `options.model`——`PAPER_AUDIT_MODEL` 与配额回退换模型一直是**静默空操作**（本轮审计调研顺带发现） | 已修：cli.ts 转发 `{...route, model: options.model}`；测试钉住（stage-cli/seam 套件） |
| AUD-DEST | ◆ | L1 | **已修（已核实，2026-10-27）** | 通过审计的 non-blocking findings 无归宿（`_audit.json` 只在重跑时被读，delivery 不消费）——违反检出必须有归宿铁律 | 已修：`audit-collector.ts` + 链末写 `AUDIT-OBSERVATIONS.md/json`（只收 pass 阶段的 findings，即被接受的观察） |
| CLAIM-LEVEL | ⛔→已修 | L1 | **已修（已核实，2026-10-27）** | `claim_code_check` 用文本子串判定方法已实现——2024B 模型用私有命名（_beta_params vs beta_posterior）连续 6+ 轮假硬失败 | 已修：AST 符号表（scripts/py-symbols.py）+ 三级判定（文本命中→符号命中→`impl_map` 声明映射）+ 空壳检测（non_doc_lines≥2）；简报教 impl_map；129 用例钉住 |

## §C open（已核实或快照在案的现行问题，按杠杆排序）

| 编号（旧） | 严重级 | 层 | 状态 | 条目 | 证据 / 下一步 |
|---|---|---|---|---|---|
| STAGE-3 | ⛔ | L1 | open（快照记录） | **13 阶段链卡在阶段 3 收敛**：模型代码不过冒烟，7 条门禁假阳性是主要摩擦（"判形式不判实质"） | `artifacts/upper-bound/2024B-ingest-1/HANDOFF-2026-10-06.md`（当前最前线） |
| DEMO-CORPUS | ◆ | L1 | **已修（已核实，2026-10-27）** | **TASK-P2/P3 demo 语料落后于门禁演化**：语料冻结于 09-18（`2ddd4dd43a`），`placeholder_chapter` 等新门 09-23 引入（`ed37868092`）→ `test:p2:demo` 0/4、`test:p3:demo` 0/5（legal 全被 DRIFT:placeholder_chapter 熔断）；**P1 demo 全绿**（3/3+2/2+9 门）证明链路本身通。这是"量具失效"（形态 4）的活例：旧自检口径（接手手册 §5"跑 demo 应 5/5+6/6"）已不可用 | 修法：按现行容器契约补齐 fake 语料的 narrative 章节，或在 demo runner 显式标注其对应的历史门禁集；CI 中这两个 job 目前恒红，掩盖真回归 |
| GATE-FP | ⛔ | L1 | open（快照记录） | 门禁假阳性 7 连（真实事故，2024B 实测）——harness 侧缺陷被读成"模型不行"的最大现役来源 | 同上 §"7 条门禁假阳性的坑"；修法纪律=形态 6（让对象以正确形态到达，不是改判定） |
| P0 | ⛔ | L1 | open（快照记录） | 2024B 阶段 8 复核 4 条致命建模缺陷（task_misread×2、cross_problem×2）→ ROLLBACK 待重跑 | `PENDING-FIXES.md` §P0（含独立复算验收判据；用户已选甲路线，待复核） |
| E1/B1 | ⛔ | L1 | **缓解** | T3 闭集模板 × 开放题不适配；demo 数字 `0.731` 曾泄漏进真题交付 | 方法族路由 + `route_mismatch` 检测已建（`cli.ts:1317`）；`0.731` 现仅存在于 T3 演示夹具（`src/produce/template-fill.ts:153`）。**待真实运行回归验证开放题不再走 T3** |
| E4 | ◆ | L1 | **已修（已核实，2026-10-27）** | 空交付未 fail-fast（24.8 分钟产出空文本进评审） | `executor.ts:278-289` `revisionDestroysDraft`：修订文本坍缩<50% 或丢失任一章节标题即拒（按真实事故"编辑模型返回任务书"而建）；空文本必被拒 |
| O2 | ◆ | L2 | **已修（已核实，2026-10-27）** | cockpit 所有运行共享 cockpit-out，BLOCKED 运行的 reportPath 指向上一次 DELIVERED 的报告 | 按 run 隔离输出子目录 + 诚实空交付语义（cockpit-run.json 标记按 runKey 解析；10 项端点冒烟过，含 BLOCKED 不回退旧报告的负对照） |
| P1 | ◆ | L1 | **缓解** | 配图文字溢出被裁 | 渲染层已修（2026-09-28，见 PENDING-FIXES §P1 根因更正）；**待重跑后逐张目视复核** |
| P2 | △ | L1 | open（快照记录） | 阶段 5 通行证缺审计结论（诚实性缺口） | `PENDING-FIXES.md` §P2；修法=补跑 `--stage-regate` |
| P4 | △ | L1 | **缓解** | `execution-producer.spec.ts` 负载下偶发失败（Worker OOM） | 子进程类已加有界重试；残留需改根 `vitest.config.ts`（processBoundTests/maxWorkers） |
| G4 | ◆ | L1 | open | 去 AI 味：一门都没有（内测 1/5） | 路线图 W12（HANDOFF §6） |
| G5 | ◆ | L1 | open | 改进循环：不存在（内测 0/5） | 路线图 W12 |
| G6 | △ | L1 | open | 对抗复核 `v5-adversarial.ts` 有设计未接链 | HANDOFF §6 G6 |
| MQUAL-遗留 | △ | L1 | open | 探针执行器 B1–B7、CE-1/CE-2、F3/F4 阈值库（W10 落地后的遗留） | `artifacts/handoff/W10-MQUAL/W10-REPORT.md` |
| C4-6 | ○ | L1 | **已修（已核实，2026-10-27）** | 架构图 C4-6 对齐自检未在 CI 中运行 | figure-w9.spec（31 用例，含负对照）接入 paper-harness.yml——trunk push 首次真正执行该 spec（PR 路径 ci.yml 本已覆盖） |
| X1/X2 | ◆ | L4 | open | 中转侧：v4-pro 下架；v4-flash 被映射到 hy3 | 外部依赖问题；建议启动冒烟（1-token 探测显示可用模型） |
| P3-1 | ◆ | L1 | open（快照记录） | 真实评审者语义假杀率未测量 | `artifacts/handoff/TASK-P3/known-risks.md` |
| P3-7 | ○ | — | open（快照记录） | master `check:ci:static` 遗留 ~20 条 lint/doc/knip 债 | known-risks P3-7 |

## §D 结构性债务（不是 bug，是"牵一发而动全身"的根源）

| 编号 | 严重级 | 条目 | 说明与建议 |
|---|---|---|---|
| D1 | ◆ | `executor.ts` 5300+ 行单体，导入约 45 个模块，是全项目的汇点 | 一切功能耦合的技术根源。**不建议大爆炸拆分**（真实运行回归成本高）；建议按既有边界渐进抽取：produce/delivery/stages 已是包内子目录，executor 只留编排。每抽一块，先用现有 176 个 spec 文件钉住行为 |
| D2 | △ | `stages/gates.ts` 2450 行门禁电池 | 同 D1 策略；门禁假阳性治理（GATE-FP）时应顺手把判据按阶段拆文件 |
| D3 | ◆ | 全部内部包仍叫 `@deepseek-ai/dsh-*`、CLI bin 仍叫 `dsh` | 既定延后决策（2026-08-22 ADR）：首次对外发版前一次性 rescope。**在那之前不要零碎改名**（会放大与 upstream 同步 diff） |
| D4 | ○ | 文档双轨：根 `HANDOFF.md` 链 vs `docs/upper-bound-architecture.md` | 已由 PROJECT-MAP §6 定序（冲突时以 upper-bound + 代码为准）；HANDOFF 保留为历史快照 |

---

## 修复顺序建议（下一位执行者）

1. **SEC-1 收尾**：轮换 3 把 key（手动）→ 执行历史重写 → force push。
2. **STAGE-3 + GATE-FP**（同一场战役）：阶段 3 收敛是当前最前线，每条假阳性按形态 6
   纪律处理——先问"判定对象是否以需要的形态到达"。
3. **P0 复核**（甲路线重跑 2→8，独立复算验收）。
4. **O2 + E4**（cockpit 按运行隔离子目录；空交付 fail-fast）——都是小改动，可与 2 并行。
5. **P1 目视复核 / P2 regate**（跑完一轮完整流程后按 PENDING-FIXES 验收）。
6. D1/D2 的渐进抽取**只在新功能需要触碰对应区域时顺路做**，不单独立项。

## §E 延后项与观察项（调研批准但暂不实施，附触发条件）

> 依据：[`AUDITOR-ROLE-SURVEY.md`](./AUDITOR-ROLE-SURVEY.md)、
> [`CLAIM-CODE-CONFORMANCE-SURVEY.md`](./CLAIM-CODE-CONFORMANCE-SURVEY.md)、
> [`LEAN-ASSESSMENT.md`](./LEAN-ASSESSMENT.md)。触发条件满足时按 TASK 制重开评估。

| 编号 | 条目 | 状态 | 触发条件 / 依据 |
|---|---|---|---|
| DEF-1 | **分片级过程监督**（每分片交付后跑确定性检查，而非整阶段末一次性判定） | 延后 | 依据 [Let's Verify Step by Step](https://arxiv.org/abs/2305.20050)（过程监督优于结果监督）。触发：阶段内长任务（code 9 分片/40 分钟）收敛轮次仍 >3，或同一类错误在分片间重复出现 |
| DEF-2 | **阶段链工具回路（`read_skill_doc`）** | 延后（本轮只做审计侧 P0） | 阶段链 `toolsMounted=false`（`stage-service.ts:794` 有明确论证：无工具回路时简报不得点名语料）。触发：模型反复因"不知道规范细节"而返工；注意 `check_container` **不适用**于阶段链（阶段链无内存容器面，产物落盘在回合末） |
| OBS-1 | **CrossHair 符号执行契约验证** | 观察 | 依据 [CrossHair](https://github.com/pschanely/CrossHair)。触发：出现"纯 Python 核心算法 + 明确数学契约"的场景，且现有 sympy/不变量扫描通道不够用；数值库（scipy/numpy）代码不可穿透，不作为通用通道 |
| OBS-2 | **deal / icontract 函数级契约** | 观察 | 依据 [deal](https://github.com/life4/deal)、[icontract](https://github.com/Parquery/icontract)。触发：需要"契约随代码走、运行即验"且模型能稳定写出正确契约时 |
| OBS-3 | **Lean 形式化验证** | 观察 | 见 [`LEAN-ASSESSMENT.md`](./LEAN-ASSESSMENT.md) §5 三条触发条件 |
