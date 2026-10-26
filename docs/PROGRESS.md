# DPH 开发进度仪表盘

> 自动区由脚本维护，手写区（轮次日志）每轮收口时由执行者追加一节——格式见 PM-HANDBOOK §10。

<!-- board:auto:start -->
> 生成于 2026-10-26 17:36（本地时间）· 由 `pnpm run progress:board` 再生成；本节之下为手写轮次日志（只增不删）。

| 指标 | 值 |
|---|---|
| 分支 / HEAD | `main` @ `f867f65fe7 chore(pm): 仪表盘刷新（手册轮收口）` |
| 未推送提交 | 1（常态应为 0，PM-HANDBOOK §7） |
| 工作树脏文件 | 5（收口前必须为 0，PM-HANDBOOK §7） |
| 设计债：已修 / 缓解 / open | 14 / 3 / **15**（共 32，见 [DESIGN-DEBTS.md](./DESIGN-DEBTS.md)） |

### 最近提交（≤15）

- `f867f65fe7 chore(pm): 仪表盘刷新（手册轮收口）`
- `8bbb645b69 fix(hooks): pre-push typecheck 用 pnpm 启动在无 pnpm 机器上被 lefthook 静默跳过(127)——改 npm 启动使门禁真正生效；手册 §7 记录该事故并立钩子自检纪律`
- `a53abe66e9 docs(pm): PM-HANDBOOK 流程宪法生效——分支/门禁矩阵/测试三层/真实运行协议/交付发布/推送纪律/TASK八步/demo语料同步/进度四件套/安全/事故管理；pre-push 增加密钥扫描；新增 progress:board 仪表盘生成器与治理轮轮次日志`
- `98c24d20ac docs(history): 2026-10-27 历史重写记录（4个密钥字面量替换+CSV路径清除；commit-map与备份bundle位置存档）`
- `e69faf77ff chore(runs): demo 运行输出目录出库（每次重生成，不再让 demo 跑一次脏一次工作树）`
- `2c4d8fd698 docs(debts): 台账补 DEMO-CORPUS 条目——P2/P3 demo 语料冻结早于 placeholder_chapter 门禁（09-18 vs 09-23），量具失效实锤；P1 demo 全绿佐证链路本身通`
- `99a376c9c4 fix: cli.ts 补 resolve 导入；清 ported-code-gates.spec.ts 未使用的 GATES 导入（tsc 恢复全绿）`
- `bb807e144c docs(governance): 新增 PROJECT-MAP 维护者地图与 DESIGN-DEBTS 设计债台账（对HEAD逐条核实状态）；README/HANDOFF 接入新入口`
- `860ebdcb8a feat(runs): 运行时状态迁出源码树——persist/输出/cockpit 目录统一落 runs/(PAPER_RUN_DIR 可覆盖)；.env profile 机制成文；artifacts 分层防线；ci-master 改手动触发`
- `38df7c4f46 chore(security): cockpit 凭据配置迁出源码树到 DPH_HOME（兼容旧路径读取），新增 example 模板入库`
- `693dbdc2ff feat(gates): 新增 verify-no-secrets 门禁接入 ci 静态聚合；再清除两处 opencode key（门禁首跑即抓到）`
- `88bcbed719 chore(cleanup): 删除5个误入库的.tmp调试残留；测试夹具去机器路径；bench 2024-E 大CSV出库(留获取说明)`
- `c4bdd56350 chore(runs): 归档 2024B-ingest-1 阶段3实验现场；.gitignore 新增 runs/ 运行产物目录规则（不入库）`
- `59d0b6207c chore(security): 移除运行脚本中的明文 API key（改由环境变量提供，历史重写另行清除）`
- `37077fc598 docs(handoff): 2026-10-06 交接 —— 阶段 3 收敛中，防线全建成，7 条假阳性的坑`
<!-- board:auto:end -->




## 轮次日志（只增不删）

### 2026-10-27 功能梳理与生态调研轮 —— 三份决策文档落库

- **目标**：功能进度全量梳理；GitHub 开源同类项目调研；Lean 形式化引入评估。
- **结果**：`FEATURE-MATRIX.md`（✅/🟡/🟠/❌/📋 五态全量梳理，TOP-GOAL 0.5/3）；`ECOSYSTEM-SURVEY.md`（AI-Scientist/STORM/PaperQA2 等 7 家，确认 DPH 真实缺口：引用真实性、评审量化分、分析广度）；`LEAN-ASSESSMENT.md`（S1 咨询件：**现在不必要**——Lean 与 sympy 是竞品、对真实缺陷史覆盖为零、三面相冲；留触发条件与四条低成本中间路径，待用户签收）。
- **验证**：improve/format 阶段机制已进 registry、v7-sympy 在库、去AI味无实现——均对 HEAD 逐条核实；外部结论以 2026-10 检索为据。
- **遗留**：Lean 评估为 S1 咨询件待用户签收；调研确认的三个缺口未排期（引用真实性依赖检索通道）。
- **需用户手动**：签收/驳回 LEAN-ASSESSMENT 的结论。

### 2026-10-27 项目治理轮 —— 从野蛮生长到可约束开发

- **目标**：把 DPH 从"文档散落、密钥泄漏、运行产物污染源码树、无分离无台账"整理成可稳定维护的项目。
- **结果**：SEC-1/SEC-2/GOV-1~5 全部落地（见 DESIGN-DEBTS §A/§B）；git 历史重写清除 4 处真实密钥与 491MB CSV（`.git` 647MB→168MB）；`runs/` 运行产物体系与 `.env.<profile>` 凭据机制确立；`verify-no-secrets` 门禁接入 ci 静态聚合与 pre-push；PROJECT-MAP + DESIGN-DEBTS + 本仪表盘三件套建档；PM-HANDBOOK 流程宪法生效。
- **关键提交**：`59d0b6207c`→`98c24d20ac`（11 个治理提交，详见各提交行）。
- **验证**：tsc 全绿；scoped vitest 2465/2467（2 个 = P4 已对账 flake，隔离 20/20 过）；P1 demo 全绿；构建守卫 ok=true。
- **遗留（open 债 15 条中最高杠杆）**：STAGE-3 阶段 3 收敛与 GATE-FP 门禁假阳性（同一场战役）、P0 建模缺陷复核、DEMO-CORPUS 语料补齐、O2/E4 小修。
- **需用户手动**：轮换 3 把已泄漏 key（mhcoding/teamorouter/opencode）。
