# TASK 5.0-R — summary（批次判定）

**基准 HEAD**：`917ad7f13`（任务书基线）→ 本批交付 HEAD 见 git log。
**作者裁决**：六张 v1.1 裁决单整体委托执行方按推荐执行（`v1.1-ratification.md`），含决策 1 修正（RunMode 增加 `exploratory`，作者二次批准）。

## 目标逐条（任务书 §2）

1. **九个 critical 门零"无条件 PASS 桩"** — DONE。六个曾恒 PASS 的 producer（runtime_integrity / execution / numeric_consistency / reference_validation / requirement_coverage / figure_data_consistency）改为 `UNIMPLEMENTED`：FORMAL/FAST 下以 `producer_unimplemented` 诚实 BLOCKED（INV-3-O 字面恢复）；ir_canonicalization / provenance / stale_detection 保持真实。登记表 `criticalGateImplementationReport()` 机器可读。
2. **测试套件 0 失败** — DONE。基线 71 文件 / 871 测试 / 11 失败 → **874 / 874 全绿**（redteam15 7 红经 attest-aware 挂载清零、断言未改；stale-engine 4 红经测量源裁决 + 契约对齐清零；新增 R5 写盘验收等 3 测试）。每项修复附击杀证明（redteam.md）。
3. **RG-09 上线** — DONE。verify-report-state.mjs：加载 registry 登记表 ↔ gate-report `gates_impl` 逐 id 对比；UNIMPLEMENTED>0 时 `batch_verdict` 不得声称 PASS/DONE；RG-07 扩到含 TASK 5.0-R。人为篡改 gates_impl → verifier 红（验收攻击成立，见下验证）。
4. **四方一致** — DONE。gate-report（baseline 874/0 + gates_impl + batch_verdict）↔ gate-registry（登记表）↔ TASK-INDEX（3.5→PASS / 4.0→六门 UNIMPLEMENTED / 新增 5.0-R 行）↔ known-risks（本文件 + TASK-2.1 item 22 指针）。verifier RG-06/07/09 自动发现漂移。
5. **交付写盘语义落地（R5 选项 A）** — DONE。executor 新增 `finalOutputRoot`（ExecutorOptions / service Config / schema），promotion 成功后真实写 `<root>/<runId>/final/<basename>`，审计 path 为真实磁盘路径；未挂 sink 时保持审计-only 并显式标注 "(no sink mounted)"；写失败 → promotion_failed + run failed + gate-failed。验收测试：注入临时 root 的真实 run 后文件存在、内容 = 交付文本、sha256 格式合法（executor.spec "5.0-R R5"）。
6. **§5 禁止事项零违反** — 自查见 diff-review.md；六门无中间态；runtimeProfileValid/EXPLORATORY 豁免路径未动；redteam15/stale 断言未删改（S-003/004/009 只改构造与契约对齐，断言强度不变或更强）。

## 实测证据

- `tsc -p packages/paper/paper-foundation` 干净；`tsc -b tsconfig.host.json` 0 错误。
- 全量 vitest：**874 / 874 通过，0 失败**（repo-default worker 配置）。
- verifier（RG-06 + RG-07 + RG-09）：**PASS**。
- 击杀证明（redteam.md）：RT-D NFC 守卫变异 → 2 红；stale 引擎 direct-detection 禁用 → 8 红；两处还原后全绿。
- RG-09 反证：把 gate-report `gates_impl` 任一 id 改为相反值 → verifier 报 DRIFT 并 exit 1（已人工验证后还原）。

## 门禁（任务书 §4）

G-1 ✓（0 失败，含击杀）｜G-2 ✓（RG-09 + gates_impl，6 UNIMPLEMENTED 如实）｜G-3 ✓（verifier 实跑 PASS）｜G-4 ✓（包级 + host tsc 干净）｜G-5 ✓（fault-corpus / mutations / replay-smoke / report-state 本地绿；CI 推送后复核）｜G-6 ✓（diff-review.md）｜G-7 ✓（六张裁决单归档 + R5 选项 A 落地代码引用）。

## 剩余项 / 交接 P1

- FORMAL/FAST 交付被六门 UNIMPLEMENTED 诚实阻断——**P1（IR 生产者轨）** 把 execution / numeric_consistency / reference_validation / requirement_coverage 升级为读真实 IR 的真门；figure_data_consistency 留 P2。
- EXPLORATORY 仍是唯一可交付 run mode（已标记非正式，R1-4），P1 让 FORMAL 出现第一条真路径。
- 5.0.4（attestation hardening）/ 5.0.10（numeric tolerance）继续 v1.1 待批。
