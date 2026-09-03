# TASK 5.0-R — diff-review（逐文件审读 + §5 禁止事项自查证据）

审读方式：对照任务书 §5 九条禁止事项逐条自查提交内每个改动文件的意图与实现。

## 提交 1（a0a4f55692）R1+R2 — 逐条自查

| 文件 | 改动 | 禁项对照 |
|---|---|---|
| `src/delivery/gate-registry.ts` | 六桩 → `UNIMPLEMENTED`；新增 `criticalGateImplementationReport()` | 无中间态（§5.2 ✓）；不改 runtimeProfileValid/EXPLORATORY 豁免代码（§5.3 ✓） |
| `src/spec.ts` `runModeSchema` + `src/settings.ts` + `src/legacy.ts` + `src/policy.ts` + `src/cost.ts` + `src/executor.ts`(budget 类型) | RunMode + `exploratory`；budget 类型放宽（exploratory=fast 档 1×） | 未触碰 review 循环/STALE 传播图/FigureSpec（§5.7 ✓）；EXPLORATORY 豁免路径只读未改（§5.3 ✓） |
| `packages/host/apiproxy/src/api/paper.ts` | 视图/start 类型放宽 | 纯类型同步 |
| 测试迁移 6 文件（executor/guards/context/resilience/ir-bridge/provenance-gate/workflow.e2e） | fast/strict → exploratory + EXPLORATORY guard + 注释/命名同步 | 断言未删改（§5.1 针对 redteam15/stale 亦未触碰）；机制测试放在豁免区 ≠ 假装门存在 |
| `tests/executor-guards.spec.ts` | 新增 resolveRunPolicy 纯单测 | 补覆盖，非凑绿 |

## 提交 2（5bb15b8044）R3

| 文件 | 改动 | 禁项对照 |
|---|---|---|
| `tests/ir/redteam15.spec.ts` | build() 链挂载 → `putExecutionRecord + CAPTURE_ATTESTATION` | **断言一字未改**（§5.1 ✓）；不绕过 INV-3-M（§5.6 ✓） |
| `tests/ir/stale-engine.spec.ts` | S-003/004/009 漂移构造改写 + gate 测试 runtimeProfileValid + reason 断言对齐契约 | 断言强度不变/更强（从不可能匹配的 `stale:` 前缀修正为精确 `stale_detection:BLOCKED:stale:` 契约断言——是修复非弱化）；无 it.fails 隐退化；§5.1 的"删改凑绿"不适用（修复无效构造 + 过时断言） |

## 提交 3（本批 R4/R5）

| 文件 | 改动 | 禁项对照 |
|---|---|---|
| `src/executor.ts` + `src/executor-service.ts` | `finalOutputRoot` sink：promotion 真实写盘 | 未绕过 promoter/INV-014（写仍在 writeFinalOutput 回调内）；EXPLORATORY 路径未动（§5.3） |
| `artifacts/handoff/TASK-2.1/verify-report-state.mjs` | RG-09 + RG-07 扩展 | verifier 只读 |
| `artifacts/handoff/TASK-2.1/gate-report.json` | gates_impl + 0 失败基线 + batch_verdict | INV-3-Q 诚实（batch_verdict = HONEST_BLOCKED） |
| `artifacts/handoff/TASK-INDEX.md` | 3.5→PASS / 4.0 六门 UNIMPLEMENTED / 新增 5.0-R 行 | §5.4（新门语义必须同步 gates_impl/TASK-INDEX ✓） |
| `tests/executor.spec.ts` | R5 验收用例 | 断言诚实（真实文件 + 内容 + 哈希） |

## 遗留自查项

- 任务书 §5.5（INV-3-Q：失败必须清零或显式降级）：0 失败达成，无 it.fails 残留需跟踪。
- §5.9（不留半棵树）：每提交前 tsc + 定向测试绿；全量在 R4/R5 提交前复验。
- 工作树无 temp/探针残留（git status 核对）。
