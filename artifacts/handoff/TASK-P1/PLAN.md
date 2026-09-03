# TASK-P1 — 执行计划（plan；源自 P1 任务书，2026-09-03 起）

> 状态：PLAN（5.0-R 准入已达成，等待作者"开始 P1"）。
> 纪律继承：本批执行全程遵守 `DISCIPLINE.md`（AGENTS.md 引用）。

## 1. 准入门槛复核（已实证达成，记录于此）

1. 5.0-R Gate 全绿：874/874、0 失败；RG-09 PASS；`gates_impl` 四方一致；六张裁决单归档 `TASK-5.0-R/v1.1-ratification.md`。CI（Paper gates + E2E）双绿。
2. R1-5（S-003/004 测量源 = IR 内比较）已在 5.0-R 裁决并落地——P1-2 环境指纹直接采用，不回改。
3. R1-3（4.4 拆分：本批精确、容差留 4.4/P3）已裁决——P1-3 numeric 按此冻结。
4. 裁决单 6（E4 三问）已签：维持 4.2 缺陷即失败至 P1；severity 保留 critical；review 轮次只留末轮——P1-5 验收口径据此。
5. 执行方通读：5.0-R 交付包 + postmortem §E + DISCIPLINE.md（本文档生成时即已通读）。
6. 预算声明：P1-1..P1-4 纯确定性工程（0 模型调用）；P1-5 demo 用确定性 fake provider 跑通全链（keyless CI），真实 provider 标 manual/带 key 版——沿用既有 budget 设施（dailyBudgetUsd/warnFraction），预计真实调用成本 ≤1 次短 task × 计划轮次（沿用 executor budget 默认）。

## 2. 出口目标（可机器验证）

1. 生产 IR 写入者 + capture 调用者存在（grep 证据 + 调用链图入 handoff）。
2. 8/9 门真实（figure_data_consistency 维持 UNIMPLEMENTED 且 `gates_impl` 如实登记 8 real + 1 unimplemented）；无新桩。
3. FORMAL 端到端 demo：题目 → 执行 → Result → Claim → 九门（8 真 + 1 如实登记）→ 交付物文件落盘（finalOutputRoot，sha256=审计）；provenance 附录 + 覆盖报告。
4. pass corpus 3/3 合法 fixture 全绿（False Block Rate 首基线 0/3）；1 个错误 fixture 被拦（击杀）。
5. §5 禁止事项零违反（diff-review）。

## 3. 执行序列（每项含验收三件套；依赖关系标注）

1. **P1-1 结构化输出生产者**（typed-JSON → IR 唯一入口；EXECUTE 产出后、delivery 前挂载；bridge `claims` 参数真实化 gate-registry.ts:107）。验收：合法 typed-JSON 全链写入后内容门可读 PASS；攻击①schema 违例拒绝②ExecutionRecord 混入普通 JSON→producer_required③同 id 冲突沿追加式语义裁决④无宽容清洗路径（grep）；回归 executor/IR 全绿。
   - 依赖：无（直接可用 5.0-R store/put 设施）。前置小件：确认 EXECUTE stage 的 schema 约束设施位置（provider seam / PromptSection 结构约束）。
2. **P1-2 执行捕获接线**（EXECUTE 经 firewall 请求 code-run；LocalProcessRunner；capture 首个生产调用者；RunArtifact 由 harness 生成）。验收：真实 node 子进程一次 → record 落 IR → provenance/execution 门 PASS；攻击①②③④（无 record 声称执行/指纹不符 S-003/直接构造 JSON/请求 shell-web 被 firewall 拒）；回归 capture/replay/runner + smoke 改挂生产组件仍绿。
   - 依赖：P1-1（RunArtifact/record 写入管线在）或并行；firewall capability 白名单仅加 code-run 于 EXECUTE（FORBIDDEN_CAPABILITIES 不动）。
3. **P1-3 numeric_consistency v0.1 + 模板报告形态**（结果表由 IR 注入、结论区禁关键数值自由书写）。验收：fixture 数字一致 PASS；mutation 改 Result 值未同步 Claim → BLOCKED；prose 含冲突数字的渲染拒绝/打标测试。冻结"关键数字全集=Result 数值"（P1-3 §67）。依赖：P1-1（Claim/Result 真数据）。
4. **P1-4 内容门 v0.1 批量**（reference_validation 全闭包走查 / requirement_coverage A7 闭包冻结稿先过作者再实现 / execution 门升级为"每条 critical Claim 链可达带合法 record 的 RunArtifact" / stale 接线 loadCode 注入 + stale.ts sync-Promise hack 重写）。验收：每门三件套；攻击四类。依赖：P1-1/2；A7 冻结稿 = G-7。
5. **P1-5 FORMAL demo + CI + pass corpus**（examples/ paper 叶子；fake provider keyless CI job；3 合法 + 1 错误 fixture）。依赖：P1-1..4 全绿。
6. **P1-6 声明同步**（README/handoff 叙事：9 门全真之日 = 指标生效之日 A3；EXPLORATORY informal 已在 5.0-R）。每子项即时同步 gate-report/TASK-INDEX/known-risks（四方纪律）。

## 4. 门禁 G1-G7 与交付清单

任务书 §4（G-1 写入者证据 / G-2 8+1 如实 / G-3 demo 落盘 sha256 / G-4 pass corpus / G-5 vitest 0 + 全链 / G-6 diff-review / G-7 冻结稿签批）。
交付：`artifacts/handoff/TASK-P1/`（summary / decision-log / gate-report / known-risks / redteam / mutations / pass-corpus / demo）+ examples 叶子 + paper-harness.yml 新 job + TASK-INDEX 行 + EXTERNAL-REVIEW 快照 + README 叙事。

## 5. 风险与边界（任务书 §7 摘录）

v1 交付物=模板报告（prose 上限留 P2/P3）；关键数字保守全集 → 误杀由 pass corpus 首测兜底，超预算走 v1.1；真实 provider 遵从率首次成为路径依赖（不达标先降级该 provider 到 EXPLORATORY，本批记录 ≥20 次调用遵从率）；requirement 闭包二义性按 fail-closed 取保守侧。
