# DPH 开发进度仪表盘

> 自动区由脚本维护，手写区（轮次日志）每轮收口时由执行者追加一节——格式见 PM-HANDBOOK §10。

<!-- board:auto:start -->
> 生成于 2026-10-27 15:25（本地时间）· 由 `pnpm run progress:board` 再生成；本节之下为手写轮次日志（只增不删）。

| 指标 | 值 |
|---|---|
| 分支 / HEAD | `main` @ `b59a195216 fix(briefing): selfCheckTool 与 skillDocsTool 拆成两个开关——阶段链挂语料工具时不再点名取不到的 check_container（round-5 同类缺陷）` |
| 未推送提交 | 6（常态应为 0，PM-HANDBOOK §7） |
| 工作树脏文件 | 3（收口前必须为 0，PM-HANDBOOK §7） |
| 设计债：已修 / 缓解 / open | 21 / 3 / **11**（共 35，见 [DESIGN-DEBTS.md](./DESIGN-DEBTS.md)） |

### 最近提交（≤15）

- `b59a195216 fix(briefing): selfCheckTool 与 skillDocsTool 拆成两个开关——阶段链挂语料工具时不再点名取不到的 check_container（round-5 同类缺陷）`
- `df76ac70ec feat(audit): P0 两项——审计支持跨路由第二provider(PAPER_AUDIT_BASE_URL/API_KEY,修 adapterStream 不转发 model 的既有静默bug)+非阻断审计findings落交付台账(AUDIT-OBSERVATIONS)；feat(stages): P1 阶段链 read_skill_doc 工具回路(PAPER_STAGE_TOOLS=1 默认关,3轮上限,审计不带工具)`
- `333aec21c8 feat(gates): claim_code_check 升级到符号级判定（AST 符号表+impl_map 声明映射+空壳检测）——修 2024B 命名脱钩循环；文本命中路径保留（库调用只能文本）；简报教 impl_map`
- `c799d88115 docs(survey): 审计者角色调研——三层机制厘清(L1静态/L2回灌/L3阶段末判官)+实证效果(0.60→0.85,三条fatal全是机械门禁盲区)+四处与验证实践的出入(同模型/无工具回路/findings无归宿/无过程监督)；待裁决`
- `0a7cce8185 docs(progress): 暂停快照——2024B 断点现场、恢复命令与待裁决项（用户要求暂停）`
- `de4b807135 docs(survey): claim_code_check 命名脱钩问题的 GitHub 调研与方案评估(S1 待裁决)——9个参考项目实测数据,推荐A(AST符号表+impl_map+空壳检测),B/C/D列为待定`
- `346748ee2e docs(progress): 落实轮台账同步——三通道落地入矩阵，轮次日志，P4 范围补充`
- `8bdb724110 feat(verification): v7-sympy孤儿模块接链为观察级findings(进入L6闭环有归宿,不阻断交付)——纯函数seam+懒降级(无python/sympy绝不崩链)；顺手清executor 28处存量缩进债`
- `300b8118a0 feat(verification): 声明式不变量随机扫描通道(LEAN中间路径a/b)+declared_invariant_scan门禁——DECLARATION可选invariants[]/range，声明即20000点采样验证，直击F-002/F-003单位口径/守恒缺陷形态；未声明即过(P2按需)`
- `3890473aae feat(review): 评审量化 rubric 五维加权分（可选项向后兼容）+review_rubric 门禁+improve 第三终止因 score-plateau——评价机制升级(Ecosystem 调研引入项)`
- `d53c615c24 fix(gates): modeling_coverage 同款接受顶层数组信封（capability_check 修复的姊妹门，2024B-mcgrox-1 stage2 实测第二个假硬失败；教训：修解析模式必须 grep 全部出现点）`
- `9de0324b49 docs(debts): O2/C4-6/DEMO-CORPUS 三条关闭（含验证证据）`
- `48f7b4ad65 fix(cockpit): O2 按运行隔离输出目录+诚实空交付语义（run-*子目录/cockpit-run.json 标记/按 runKey 取报告）——BLOCKED 不再显示上次报告`
- `5e97bf2959 fix(demo): P2/P3 语料升级到现行容器契约（补 narrative 四章/justification_refs/figure 声明/runner EISDIR）——DEMO-CORPUS 关闭，P2 4/4+2/2、P3 5/5+6/6 恢复绿`
- `10fbaf96bb fix(gates): noUncheckedIndexedAccess 下解构守卫替代断言（lint 债清理补丁）`
<!-- board:auto:end -->







## 轮次日志（只增不删）

### 2026-10-27 调研落实轮 —— 两轮调研的方案全部落地

- **目标**：落实 CLAIM-CODE-CONFORMANCE-SURVEY（方案 A）与 AUDITOR-ROLE-SURVEY（P0×2+P1）的裁决结果。
- **结果**：① claim_code_check 符号级判定（AST+impl_map+空壳检测）；② 审计跨路由第二 provider（**顺带修掉 adapterStream 不转发 model 的既有静默 bug**——PAPER_AUDIT_MODEL 此前从未生效）；③ 非阻断审计 findings 落交付台账（AUDIT-OBSERVATIONS.md/json）；④ 阶段链 read_skill_doc 工具回路（PAPER_STAGE_TOOLS=1 默认关：带 tools 强制流式， reintroduces 截断风险）；⑤ selfCheckTool/skillDocsTool 简报开关拆分（修点名取不到的工具同类缺陷）；⑥ 延后项/观察项登记（§E：DEF-1/2、OBS-1~3）。
- **关键提交**：333aec21c8、df76ac70ec、b59a195216。
- **验证**：tsc 干净；scoped 2539/2540（1 失败=P4 类负载 flake，隔离 16/16 过）；gates 129、audit-collector 4、stage-tools 5、P1 demo 全绿。
- **遗留**：PAPER_STAGE_TOOLS 在截断问题解决前保持关闭；审计独立性需配置第二路由才真正生效（.env.example 已文档化）。
- **下一步**：恢复 2024B 链（claim_code_check 现接受 impl_map，收敛概率大幅提升）。

### 2026-10-27 暂停快照 —— 等待用户裁决后重启

- **暂停原因**：stage 3 `claim_code_check` 命名脱钩（合同声明 beta_posterior 等签名，代码用 _beta_params 私有命名）；调研已完成（[CLAIM-CODE-CONFORMANCE-SURVEY.md](./CLAIM-CODE-CONFORMANCE-SURVEY.md)，推荐方案 A），**用户裁决：暂停，等待重启**。
- **已停**：2024B 链循环已停止（无孤儿进程），工作树干净。
- **断点现场**：`runs/2024B-mcgrox-1/stages/` —— stage 1✅(质量0.85)、stage 2✅(0.80) 通行证已签发；stage 3 多轮冒烟通过，卡在两门。
- **恢复命令**：`PROFILE=mcgrox bash runs/2024B-mcgrox-1/scripts/run-loop.sh`（stage-next 断点续传，已过阶段自动跳过）。
- **恢复前若采纳方案 A**：先改 `claim_code_check` 再重启，否则会继续在同一门禁空转。
- **未登记项**（用户要求暂停，未写入台账）：CrossHair / deal / icontract 观察项；B 方案（stub-first）评估。


### 2026-10-27 落实轮 —— 强化机制全量落地 + 2024B 全链真实运行

- **目标**：把调研/梳理阶段的全部强化机制落实为代码；以新活动密钥打通 2024B 全链。
- **结果**：①评审量化 rubric（五维加权+score-plateau 终止因）；②声明式不变量随机扫描通道+declared_invariant_scan 门禁（LEAN 中间路径 a/b）；③v7-sympy 孤儿模块接链为观察级 findings；④C4-6 进 CI/DEMO-CORPUS 关闭/O2 关闭/E4 核实已修；⑤capability/modeling_coverage 两个门禁假硬失败修复（顶层数组信封）。
- **关键提交**：cd5e074c29→8bdb724110。
- **验证**：tsc 干净；scoped 2507/2509（2 失败=1 简报题面词汇已修+1 负载 flake 隔离 16/16 过）；gates.spec 115/115；verification 54/54。
- **链路现场**：stage 1✅(质量0.85)/stage 2✅/stage 3 冒烟✅（前次实验卡死点已破），claim_code_check 门迭代中。
- **遗留**：不变量教学采用率待真实运行观察；V7 观察级→执行级需先攒真阳性率证据。

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
