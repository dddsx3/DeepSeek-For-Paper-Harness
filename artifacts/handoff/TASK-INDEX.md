# Task Index — DeepSeek-For-Paper-Harness

> Single source of truth for which tasks have shipped, what their handoff
> directory contains, and which follow-ups are pending. Every handoff
> `summary.md` cross-references this file. New tasks MUST add a row on
> landing and update the "head" column to the commit that closed the
> task's local gate.

## Landed tasks

| Task | Head commit | Handoff | Local gate | Follow-ups |
|------|-------------|---------|------------|-------------|
| TASK 1.25  (IR canonical gate + executor) | `ba14aed3ef` | `artifacts/handoff/TASK-1.25/` | PASS (B-001..B-005) | — |
| TASK 1.5   (Reference Closure) | `ba14aed3ef` | `artifacts/handoff/TASK-1.5/` | PASS (18/18) | — |
| TASK 1.5R  (Canonical Closure + RT4-01) | `ba14aed3ef` | `artifacts/handoff/TASK-1.5R/` | PASS (12/12) | — |
| TASK 2     (Claim → Result evidence) | `9812933b0c` | `artifacts/handoff/TASK-2/` | PASS (10/10) | — |
| TASK 2.1   (Evidence Freeze + Audit) | `7721c47095` | `artifacts/handoff/TASK-2.1/` | PASS (C1..C10) | Follow-ups item 12 (legacy test rewrite) |
| TASK 3     (Execution Provenance Gate v1.0) | `bc5e90982b` task book / `9812933b0c` impl | `artifacts/handoff/TASK-3/` | PASS (C1..C10) | — |
| TASK 3.5   (STALE engine) | `e57d8dc168` + 5.0-R | `artifacts/handoff/TASK-2.1/` + `artifacts/handoff/TASK-5.0-R/` | PASS (5.0-R: 4 stale reds closed; S-003/004 drift on forged captures; gate integration aligned to evaluateDelivery contract; kill probes recorded) | S-009 RequirementSpec walk deferred to P1-4 (closure algorithm A7 frozen first) |
| TASK 3.6   (Replay–Delivery staleness) | `23be463651` + 5.0.8 | `artifacts/handoff/TASK-2.1/` | PASS | `delivery_replay_max_age` policy landed (5.0.8); enforcement point = the audit composition |
| TASK 4.0   (Gate registry + producers) | 5.0-R | (registry in `src/delivery/gate-registry.ts`) | PARTIAL → six gates UNIMPLEMENTED (honest BLOCKED in FORMAL/FAST); ir_canonicalization/provenance/stale_detection real | Real v0.1 semantics land in P1 (execution/numeric_consistency/reference_validation/requirement_coverage); figure_data_consistency in P2 |
| TASK 4.2   (fast mode bypass removal) | `79cfd2b4f2` | n/a | PASS (executor line) | Reviewer schema unification DONE (5.0.3c); Oracle Routing follow-up |
| TASK 4.3   (FigureSpec data_hash) | `e57d8dc168` | n/a | PASS (schema) | §15 other fields are the follow-up |
| TASK 5.0   (Second-repair batch: 5.0.5/6/7/8/11 + capture-path rewrites) | (5.0 batch commits) | `artifacts/handoff/TASK-5.0/handoff.md` | PASS (5.0.1 closed under 5.0-R delegation; 5.0.4/5.0.10 DEFERRED on v1.1) | 5.0.9 superseded by P2; 5.0.4 attestation hardening + 5.0.10 numeric tolerance await v1.1 |
| TASK-P1 (生产者轨) | `d823b7cea` | `artifacts/handoff/TASK-P1/` | PARTIAL → DONE（D1/D3/D7 于 2026-09-04 复签闭口；E4a/E4b/E4c 代签选 A 回执入 decision-log） | P2: executor 内嵌整链（D7 义务）；figure vacuous 解除（D3 义务） |
| TASK-P2 (执行器整链 + 图表数据闭环: E4 review v2 / executor 权威链 / figure 真数据闭环 / 报告 v2 槽位 / demo v2 / 遵从率探针) | `9e14845ef8` 起 (head at handoff) | `artifacts/handoff/TASK-P2/` | DONE（P2-1 executor 权威 FORMAL 链 4/4 + demo v2 4/4 DELIVER FBR 0/4 + wrong 2/2 KILLED；figure 门 vacuous→real 语义更替已登记；gates_impl 9 real 保持；探针 fake 自检 1.0，真实段 manual 待 key） | 作者: 无新增复签；真实遵从率实跑（<0.8 降级义务）、SVG→位图、formal RunMode、DF 图型 → 后续任务书 |
| TASK-P3 (语义收口与真实遵从实证: E5 评审语义核对 / E6 表达层声明制 / E7 figure 唯一性 + table / EXECUTE 教学段 + probe v2 实测 / 收口组 / demo v3 + corpus v3) | `4c58664810` 起 (head at handoff) | `artifacts/handoff/TASK-P3/` | DONE（P3-1 语义闭集+证据域 6/6；P3-2 representation 声明制 13/13；P3-4 唯一性键+table 10/10；全量 976/976；demo v3 5/5 DELIVER FBR 0/5 语义误杀 0/5 + 6/6 KILLED 重跑零脏；probe v2 真实实测 0/20 → GMI/MiniMax 组合 EXPLORATORY 降级字面生效，DeepSeek 侧仍部分关闭待 key；E5/E6/E7 代签选 A） | 作者: master CI 全仓 lint 欠账（上游遗留 ~20 处，known-risks P3-7）；DeepSeek 官方端点遵从实测；真实 reviewer 语义误杀率；P4 候选（PNG 位图/多序列 x 轴/DataArtifact 行语义/用户外壳） |
| TASK 5.0-R (补漏批次: six-stub elimination, eleven reds to zero, gates_impl + RG-09, exploratory run mode, real final-output sink) | (5.0-R commits) | `artifacts/handoff/TASK-5.0-R/` | PASS (874/874 tests at close; RG-06/07/09 agree; six stubs -> UNIMPLEMENTED then real via P1) | P1 生产者轨 is the next batch; EXPLORATORY marked informal (R1-4) |

## Pending tasks (not yet started)

| Task | Status | Hard gate before start |
|------|--------|-------------------------|
| TASK 4.4  (numeric tolerance) | DEFERRED | v1.1 task-book amendment separating replay recomputation (exact identity) from cross-source comparison (with tolerance) |
| TASK 4     (Fault Corpus v1) | REJECT (per TASK-4 准入评审) | TASK 4.4 + 3 stale-engine follow-ups + 11 legacy test rewrites |

## Map of handoff assets

```
artifacts/handoff/
├── EXTERNAL-REVIEW.md      ← single status document, updated by every batch
├── TASK-INDEX.md            ← this file
├── TASK-1.25/  (RT125B-01..05)   + summary / invariant / gate-report
├── TASK-1.5/   (RT-A/B, redteam) + summary / known-risks / 18 fault JSON
├── TASK-1.5R/  (RT-01, RT4-01)  + 12/12 mutation report / freeze manifest
├── TASK-2/     (RT-C1..4)       + 20 fault JSON / 8/8 mutation / audit
├── TASK-2.1/   (3.R1..3.R6)     + 10 critical 12 closed + 8 mutations + freeze
├── TASK-3/     (TASKBOOK v1.0 + EX-01..12 + RT-X1..X4)  + handoff + runners
└── TASK-4/     (准入评审, rejected until 4.4 ships)
```

## How to add a new task

1. Land the implementation + tests.
2. Create `artifacts/handoff/TASK-N/` with `summary.md`, `invariant.md`,
   `gate-report.json`, `known-risks.md`, and (if attack work happened)
   `redteam.md` and `faults/`.
3. Add a row to this file under "Landed tasks", with the head commit
   (or "staged" while the change sits uncommitted).
4. Update EXTERNAL-REVIEW's "Status snapshot" with a one-line summary.
5. Reference the task's gate-report CLOSED conditions from
   `summary.md`'s verification matrix.

## Notes for the next reviewer

- The TASK 2.1 audit batch (3.R1..3.R6) is the most recent *fully closed*
  surface. Read it first if you only have time for one task.
- The TASK 3 entry-point is `TASKBOOK.md` v1.0 (frozen before any code was
  written); the implementation lives across the 3.R* commits.
- Mutation runners (`run-mutations.mjs`) and the fault-corpus driver
  (`run-fault-corpus.mjs`) are stable entry-points for verification.
- The real-process smoke (`run-real-execution-smoke.mjs`) is its own job
  with a 30-60s wall-clock budget; it runs the canonical
  backboneIR through capture + replay against a real node child.
| TASK-P3D (供应商解耦: 适配器去隐式默认 / E2E 中立变量族 / e2e.yml 去官方 pin / CI 守卫) | (this batch) | `artifacts/handoff/TASK-P3D/` | DONE（llm-deepseek 与 web-search-deepseek 端点必填、无隐式官方路由；E2E 走 DSH_E2E_LLM_* 变量族；ci.yml 挂 verify-vendor-neutrality 守卫防回潮；llm-deepseek+web-search 395/395、bundle 36/36、keyless e2e 1/1） | 作者: 仓库 Settings 配 DSH_E2E_LLM_*_EXTERNAL secrets 使 E2E 走中转；pi-ai-provider-e2e.yml（手动双供应商验证）未动属 opt-in |
| TASK-PW | 弱模型遵从分层 | DONE | decision-log W-A/W-B/W-C 选 A 入库;W1..W6 落地 93 文件/1025 测试全绿;demo v4 9/9 FBR 0/9;probe v3 fake trusted(禁 7 SKIPPED real) |
| TASK-M1 | 用户外壳与人机协同实测 | (this batch) | `artifacts/handoff/TASK-M1/` | DONE（M1-1 真实 key 三层探针 38 首次尝试:T3 fill 18/18 + 专测 8/8、T1/T2 0/10 → 首测组合 deepseek-v4-flash@T3;M1-2 用户外壳 CLI v0 + 8 单测绿 + zip 确定性 29a4ab58;真实用户模拟 DELIVERED;基线 1025/1025 保持） | M1-3 PNG 后端 / M1-5 pilot 协议未启动;弱模型 T1/T2 轨转持续观察项 |
| TASK-T1 | IR 语义契约冻结 (下一阶段任务书第一阶段) | (this batch) | `artifacts/handoff/TASK-T1/HANDOFF.md` | DONE（新 canonical 对象 AssumptionSpec/EquationSpec/ExperimentSpec 全量落地;ModelSpec assumptions/equations 自由文本→*_refs 引用;SymbolSpec shape/domain/index_set 必填;duplicate-truth-source 与 bypass-reference 两架构 mutation 必红;56 个 fault fixture + 3 个 demo cases 迁移;基线 1025→1040/94 文件全绿） | ir-contract-v1.md 文档与 paper.md 记录未做;两 mutation 未接 runner;ExperimentSpec 无生产者;EquationSpec 无 model_ref(环) 等 3 个决策点待专家复核 |
| TASK-T1-S2 | IR 语义契约收尾 (专家计划书 P0-A / freeze-ir-semantics Commit 1 后半) | `4cdc9f8cb1` | `artifacts/handoff/TASK-T1-S2/HANDOFF.md` | DONE（专家三裁决全落地:①REF-001..005 单向 scope 引用——reference_scope_mismatch 失败码 + IR_SCOPE_FIELDS/validateScopeOwnership + models_by_equation 派生索引(derivation.ts,不入哈希);②SCH-SEM-001 shape/domain UNKNOWN 哨兵(required key + typed UNKNOWN,教学串同步);③DEP 三层指纹(edge DEP-EDGE-v1 / object ASSUMPTION-v1… / closure)+ canonical-sort + 命名空间,revision 化由 append-only 交付;ir-semantics.spec 20 条 invariant;RT-B-01 三条按 REF-003 语义迁移;real-provider 加进程级并发闸(默认 1)+429/5xx 退避,新 relay key(z-ai/glm-5.3-free,第二模型族)入 gitignored .env.local 只服务 Track 2/3;基线 1040→1060/95 文件全绿,demo:pw zip sha 5e775fb8 确定性保持） | P0-B 剩余:fingerprint version + golden fixture;Commit 2(CI 解耦/cassette)与 Commit 3(telemetry/LCB 统计门)未动;P1-C 第二模型族 T3 qualification 待跑 |
| TASK-E | CI/真实API 解耦 + cassette 录放 + P0-B golden(专家 Commit 2) | `85f419fe7d` | `artifacts/handoff/TASK-E/HANDOFF.md` | DONE（e2e.yml 转纯 workflow_dispatch,push CI 永不跑真实 API;REAL_API_POLICY=never 守卫(verify-real-api-policy.ts,只 FAIL "真实 adapter 进 CI" 不 FAIL "无 key")挂进 paper-harness push 门,污染注入实测 exit 1;cassette.ts + CLI --cassette/--replay:按请求指纹回放,未知指纹 loud FAIL,cassette schema 六键无凭证;首盘真实语料 glm-t3-coursework-v3(z-ai/glm-5.3-free T3 strict DELIVERED,含 429 退避);回放×3 与真实跑 zip sha fb4d4e07 完全一致(专家 §14 Replay property CI 化:push 门双回放 sha 相等断言);golden/ir-fingerprints-v1.json 钉死六哈希 + 迁移规则;基线 1060→1066/96;shell 8→15） | CI 远端绿灯待下次 push 验证;cassette 语料按模型族逐盘攒 |
| TASK-Q2 | 统计资格门 + 成本遥测(专家 Commit 3) | `09f6b878ff` | `artifacts/handoff/TASK-E/HANDOFF.md` §3 | DONE（exactLowerConfidenceBound:Clopper-Pearson 精确单侧下界,零失败闭式 alpha^(1/n) 精确复现专家 stop rule(14→p>0.8,29→p>0.9),带失败 beta 分位(80/100=0.7226 经二项尾独立验证;修正了首版 k=n 时返回 1-α 的真 bug);evaluateQualification:LCB≥p_min AND ESCAPE=0 AND 预算=0,8/10 与 80/100 不再同等资格,18/18 诚实只声称 p>0.8;registry upgradeVerdict 升级统计门(legacy 回退点估计);UsageTelemetry 四维硬预算 BLOCK;real-provider stream_options.include_usage + usage chunk(修复 finish_reason 处 break 漏 usage 块的真 bug),cassette 录放 usage → 真实跑与回放 run-report 逐字节相等;demo:pw zip e14d687b 确定性;+23 测试,基线 1066→1089/98;RG-06/07/09 三连 PASS） | P1-C 已完成(2026-09-08 实跑,见 TASK-E HANDOFF §5):z-ai/glm-5.3-free T3 14/14 QUALIFIED,LCB95=0.807;探针两 bug 修复(教学段丢失/网络级错误不退避)后实跑,0/14→14/14 全为探针自身问题;剩 deepseek-v4-flash 统计门复测(旧 18/18 为点估计记录)即达"两族过统计门"判据;pricing 表未配(成本=0 不猜) |
| TASK-P1C | 第二模型族 T3 统计资格实跑(专家 P1-B/C) | (this batch) | `artifacts/handoff/TASK-E/HANDOFF.md` §5 + `output-p1c/` | DONE（z-ai/glm-5.3-free T3 闭集填充 14/14 首试全过,LCB₉₅=0.807≥0.80,ESCAPE=0,零引导预算,零传输重试;真实 usage in 1568/out 4407 tokens;探针(run-p1c-probe.mjs)含 fake 自检 5/5+禁7 SKIPPED;两探针 bug 修复(教学段空串致 t3_number_forbidden 误判 + status 0 网络错误不退避被记 TRANSPORT);fill 拒绝分类消费闭合失败码非正则） | deepseek-v4-flash 侧同 runner 复测后即达专家 §22 "两个模型族过统计门"里程碑 |
| TASK-P1D | T3.5 expand-then-select 原型 + 真实模型实测(专家 P1-D/§4/§5/§13) | (this batch) | `artifacts/handoff/TASK-E/HANDOFF.md` §8 + `output-t35/` | DONE（ExpandSelectSession 三动作闭合状态机(SELECT/REQUEST_EXPANSION/ABSTAIN)+ 原子微生成(生成≠提交;候选 id 无数字序数词,数字扫描零例外)+ 双硬预算 2/slot 4/run(CANDIDATE_SPACE_EXHAUSTED loud);16 invariant 含专家验收 case:snow_depth T3 拒 → T3.5 收编零 ESCAPE;真实实测 z-ai/glm-5.3-free 5/5 轮全走完整循环(expansion-request→SELECT),零 ESCAPE,决策规则一行教学后从"挑贴切度不足 seed"转为主动 REQUEST_EXPANSION;基线 1089→1105/99) | P2-A T3 vs T3.5 成对对照(McNemar/discordant pairs);deepseek-v4-flash 统计门复测仍待跑 |
| TASK-P1C2 | 双模型族统计资格 + 新中转轨(专家 §22 里程碑达成) | (this batch) | `artifacts/handoff/TASK-E/HANDOFF.md` §9 + `output-p1c/`/`output-t35/` 按模型归档 | DONE（测试模型换轨 z-ai/glm-5.3-flash + deepseek/deepseek-v4-pro @ y-api 中转;两族各 14/14 首试 QUALIFIED,LCB₉₅=0.807,零 ESCAPE/预算/传输重试——**专家 §22 "≥2 模型族过统计门"达成**;glm-flash T3.5 5/5 全循环零 ESCAPE(out 967,比 free 更省);cassette 语料库第二盘 glm53flash-t3-coursework-v1(回放三向一致 ef66fe0b),CI replay demo 改遍历全盘;成本对照:deepseek-pro T3 输出 token ≈ glm-flash 的 1/6) | P2-A T3 vs T3.5 成对对照 → P2-B study freeze → P2-C 学生 case-series(里程碑前置已全部满足) |
| TASK-P2 | P2-0 小修 + P2-A 对照实验 + P2-B 冻结机制 + P2-C 实测协议 | (this batch) | `artifacts/handoff/TASK-P2/HANDOFF.md` | DONE（P2-0:F8 trail 逐条落盘+validateTrail spec+缺口如实注明;pricing.json 机制(占位价注明);legacy-protocol 隔离(v4-flash 18/18 点估计记录不可作资格);CI URL 待批末补录。**P2-A:24 对预注册对照(glm-5.3-flash,严串行,首试)——closed 12/12 vs 12/12(零损失,b=0),expansion 0/12 vs 7/12(+7,c=7)→ McNemar 精确 p=0.0156 显著;表达力单价 ≈5,613 out-token/新覆盖 case(占位价);诚实负结果:T3.5 资格门未过(LCB 0.610+ESCAPE 1→不落 registry 行),失败集中槽位纪律(4/5 expansion_off_target)**。P2-B:study-manifest 模块+CLI verify+12 条篡改必红 spec+fixture 落库。P2-C:pilot-protocol 定稿(M1/M2 双目复核/M3/FalseBlock/n=5 纪律/知情同意)。三次执行器偏差 D-P2-A.1/.2 全 harness 侧,统计口径零变更(预注册未触) | 真实 STUDY_MANIFEST 冻结待用户名单+题目登记(G6);T3.5 槽位纪律是协议改进直接靶点;P2-A 结果进论文(n=24 筛选性对照口径) |
| TASK-C1 | 实测驾驶舱(独立壳+共用订阅层)+ B0 三件套 | (this batch) | `artifacts/handoff/TASK-C1/HANDOFF.md` | DONE（cockpit server:127.0.0.1:3081,只读投影 workflow 持久化(runs/nodes/events/artifacts)+SSE 增量流+上传同源守卫(readProblemFile 零复制,JSON/multipart 双形态)+manifest 徽章(verifyStudyManifest 同源)+FalseBlock 裁决表归档+pilot-protocol §2;前端 apps/cockpit/public 纯原生零 CDN 五区(导入/交付/时间线/节点视图+溯源卡/辅助区三按钮),子代理实现主控验收;**read body failed 四洞修复**(OPTIONS 预检/multipart/child spawn node.exe+error 监听/clientError 400)——run2 崩服根因即其中之一;B0:BLOCKED memo 字段+M2 叙事连贯性+20 份 FROZEN-SNAPSHOT 标头;demo-run e2e 两次 DELIVERED+投影/SSE/徽章全实测;G1-G8 ✅,G9 ⏳ 待冻结版打 release,G10 ⏳ 待真人 30 分钟实测 | 首名用户进场走驾驶舱;签名 release 实际打包待 STUDY-A-PILOT 冻结 |
| TASK-C1.5 | 用户实测 5 问题收尾:API 配置全链(服务端 profiles+前端面板)+ launcher 双击防重 + 上传矩阵复测(413/中文文件名)+ 零指示子代理测试两轮 + 5 项 UI 修复(manifest 详情 display bug/开始守卫反馈/编号重排/报告页内预览+按钮行 .dl-row 不可见) | (this batch) | `artifacts/handoff/TASK-C1/HANDOFF.md` §7 | DONE（联调修出服务端 TDZ 真 bug;子代理复测确认 4 项已解决+抓出 .dl-row 真问题已修验;1112+27 回归绿;exe 重建验证异 cwd+双开防重） | 用户复测确认后即可打 release 流程 |
