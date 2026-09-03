# DSH-Paper-Harness 全局纪律（跨批次、跨执行者持有）

> 来源：5.0-R 补漏任务书 §5、2026-09-03-postmortem §E、5.0-R 批次实测事故。
> 适用：本仓库一切后续任务书批次（P1/P2/…、v2 正式任务）。违规 = 批次失败。
> 每条纪律 = 一次真实事故或一次审计发现的浓缩；末尾注明出处便于回溯。

## A. 诚实优先（为什么我们有这些门）

1. **诚实的红灯优于假绿。** 不删改测试断言凑绿（5.0-R §5.1）；失败必须清零或**显式降级**（`it.fails` + 跟踪 TASK），不得以"known"名义把红留在账上（INV-3-Q）。红着但声称完成 = 虚报；reason 诚实但 status=PASS 的"桩" = 假绿（INV-3-O），两者都是批次失败。
2. **声称必须与代码一致，且由机器自动核对。** gate-report ↔ gate-registry（`criticalGateImplementationReport`/`gates_impl`）↔ TASK-INDEX ↔ known-risks 四方一致；`verify-report-state.mjs` 的 RG-06/07/09 负责自动发现漂移。**任何改动（加测试/改门/改基线）必须先同步 gate-report 的 baseline 与 gates_impl 再推送**，否则 CI 的 report-state 门会红——那不是负担，是成果。

## B. IR 与交付层铁律

3. **ExecutionRecord 只有一条入口**：`putExecutionRecord(record, CAPTURE_ATTESTATION)`（INV-3-M）。禁止绕过（含测试 fixture 与独立脚本）。任何新链挂载照 redteam15/stale-engine/backbone fixtures 的写法。
4. **`evaluateDelivery` 的 failure reason 契约 = `${gateId}:${status}:${reason}`**（自 5.0.5）。测试断言与诊断都以该前缀为准，不写不可能匹配的裸 `stale:` 之类。
5. **store 是不可变的**：覆盖/更新已存在 id 的 put 会被拒（`duplicate_id`）。"漂移/变更"类测试在**构造**上表达（伪造捕获、不同 id），禁止尝试覆盖 put。
6. **六门 UNIMPLEMENTED 期间，任何"fast/strict 交付成功"的测试必须迁移 EXPLORATORY run mode**，不得重新引入假装门存在的桩。fast/strict 的轮次/预算语义用 `resolveRunPolicy`/`evaluateBudget` 纯单测钉住；P1 六门实现后恢复 fast/strict 端到端验收（见 TASK-5.0-R known-risks 6）。
7. **EXPLORATORY 产物是"非正式"的**（manifest `informal: true`）。禁止用 EXPLORATORY 跑正式验收，禁止其产物承载正式交付语义。

## C. 编码与平台（每条都是死过的坑）

8. **子进程事件竞态禁令**：`spawn` 后**立刻**同时挂 stdout/stderr/exit/error 的监听并并发读流。先 await 一个流再挂另一个的监听会永久挂起（一次性 `end`/`exit` 事件；CI 快子进程必现）。`collectRuntimeFacts` 同型。
9. **无长驻顶层 await**：长流程脚本用 `main()` + 看门狗结构，所有出口显式 exit code；不把 180s 的等待交给 tsx 的 TLA 误判。启动器统一 `node --experimental-transform-types`（参数属性 strip-only 不支持）或仓库规定的 launcher。
10. **Windows 本地跑 vitest 子进程会在写完报告后不退出**：runner 必须像 verifier 一样轮询 SETTLE 或主动强杀子进程；**不要在 Windows 本地跑 mutation wrapper**——超时强杀会跳过还原，把源码变异残留进工作树（2026-09-03 实测：audit.ts `exit_status` 守卫被 `if(false)` 残留）。提交前 `git status --short` 必须只含预期文件，任何 stray `src/` 修改都按未还原变异处理。
11. **类型检查跑全图**：改 paper 测试/源码后跑 `tsc -b tsconfig.host.json`（含测试文件），只跑包级 tsc 会漏掉 ~20 个测试文件的类型债（E2E Build 才会暴露）。

## D. 工程习惯

12. **不留半棵树**（postmortem A1 + 5.0-R §5.9）：每个提交 = 一个逻辑单元，提交前该单元 tsc + 定向测试绿；被中途打断时留下可编译状态而非半成品。
13. **推送纪律**：不推会弄红 CI 的中间态（gate-report 未同步前不推）；推送后用 `gh run watch` 盯 Paper gates（Linux 上 fault/mutation/smoke/RG 才是权威），E2E 需要 key + 额度。
14. **击杀证明义务**：每项守卫修复配"变异→测试红→还原"证据（或等价），写进 redteam.md；防止"测试被静默跳过"式假覆盖。

## 出处索引

- 5.0-R 任务书 §5（禁 1-9）；2026-09-03 postmortem §E 提交前清单；gate-registry.ts 头注释（INV-3-K/L）；TASK-5.0-R/known-risks.md（1-10）。
