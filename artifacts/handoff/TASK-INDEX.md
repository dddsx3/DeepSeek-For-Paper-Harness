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
| TASK-T1-S2 | IR 语义契约收尾 (专家计划书 P0-A / freeze-ir-semantics Commit 1 后半) | (this batch) | `artifacts/handoff/TASK-T1-S2/HANDOFF.md` | DONE（专家三裁决全落地:①REF-001..005 单向 scope 引用——reference_scope_mismatch 失败码 + IR_SCOPE_FIELDS/validateScopeOwnership + models_by_equation 派生索引(derivation.ts,不入哈希);②SCH-SEM-001 shape/domain UNKNOWN 哨兵(required key + typed UNKNOWN,教学串同步);③DEP 三层指纹(edge DEP-EDGE-v1 / object ASSUMPTION-v1… / closure)+ canonical-sort + 命名空间,revision 化由 append-only 交付;ir-semantics.spec 20 条 invariant;RT-B-01 三条按 REF-003 语义迁移;real-provider 加进程级并发闸(默认 1)+429/5xx 退避,新 relay key(z-ai/glm-5.3-free,第二模型族)入 gitignored .env.local 只服务 Track 2/3;基线 1040→1060/95 文件全绿,demo:pw zip sha 5e775fb8 确定性保持） | P0-B 剩余:fingerprint version + golden fixture;Commit 2(CI 解耦/cassette)与 Commit 3(telemetry/LCB 统计门)未动;P1-C 第二模型族 T3 qualification 待跑 |
