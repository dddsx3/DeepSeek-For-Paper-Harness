# TASK 1.5R — Summary（交接总结）

> 接手本文件的 agent 请先读 `CONTINUATION.md`（环境约束/workaround）与
> `HANDOVER.md`（12 条 CLOSED 条件）。本文档记录 TASK 1.5R 全部阶段的
> 完成状态、验证结果与产物位置。

## 一句话结论

**TASK 1.5R 全部完成：12/12 CLOSED 条件满足，全包回归 49 文件 / 522 测试
全绿，fault corpus 18/18，targeted mutations 14/14 killed，红队四角色
CRITICAL escape = 0。** External Attack Gate 判据（"store 不能再持有
dangling / wrong-kind 的 IR-internal 边；bridge 只做语义守卫"）已满足，
TASK 1.5 可按 HOLD 解除规则标记 CLOSED 并解锁 TASK 2 —— 但**本任务不启动
TASK 2**（STOP RULE）。

## 各阶段状态

| Phase | 内容 | 状态 | 证据 |
|-------|------|------|------|
| PHASE 0 | R-001..R-013 结构引用攻击（store-level verdict） | ✅ 交接时已完成 | `tests/ir/ref-closure.spec.ts` 13/13 |
| PHASE 1 | Reference Target Algebra 收窄 + 闭合表 + nested extractor | ✅ 交接时已完成 | `src/ir/refs.ts`，refs.spec.ts 13/13 |
| PHASE 2 | Store Boundary Restoration（put 前 validateRefFields） | ✅ 交接时已完成 | `src/ir/store.ts`；192/192 |
| **PHASE 3** | **Bridge 去重（本次会话）** | ✅ **完成** | 见下 |
| PHASE 4 | Fault Corpus R-001..R-018 | ✅ **完成** | `faults/` + `fault-results.json` 18/18 |
| PHASE 5 | 红队 4 角色 + targeted mutations | ✅ **完成** | `redteam.md`；`mutation-results.json` 14/14 killed |
| PHASE 6 | 验收 + Handoff 产物 | ✅ **完成** | 本目录全部文件；gate-report.json 12/12 |

## PHASE 3 — Bridge 去重（本会话核心改动）

**目标**：store 边界已保证 existence+kind 闭合后，删除 bridge 中重复的
结构守卫，仅保留语义守卫（role / source / scope / uniqueness /
minimum-contract）。

**改了什么**（`src/ir/problem-contract.ts` + `src/ir/bridge.ts`）：

1. `PROBLEM_CONTRACT_FAILURE_KINDS` 移除 `unresolved_reference`、
   `reference_kind_mismatch`、`figure_target_not_union`、
   `missing_raw_problem_data_artifact`、`missing_symbol` —— bridge 从此
   不可能再产出结构类失败。
2. `validateProblemContract`：
   - `raw_problem_ref`：存在性/kind 分支（store 已保证）收敛为
     `unbound_data_artifact` 兜底；**role=RAW_PROBLEM 检查保留**（R-014）。
   - `requirement_refs`：存在性/kind 分支收敛为 `unbound_requirement`
     兜底；REQUIRED_OUTPUT 计数 + 同源检查（R-017）保留。
   - `input_data_refs`：存在性/kind 分支收敛为 `unbound_data_artifact`
     兜底；**role=INPUT_DATA 检查保留**（R-015）。
   - **FigureSpec 整段删除**（store 的窄 union 已覆盖；renderer 属 TASK 7）。
3. `validateModelSpecSymbols`：resolver-miss 分支改为
   `unbound_variable_symbol` / `unbound_parameter_symbol`（语义化兜底）；
   role 检查（R-016）与 scope ownership 保留。
4. `bridge.ts`：total-failure sentinel 从 `unresolved_reference` 改为
   `unbound_data_artifact`；`inspectProblemContract` 删除 FigureSpec
   bucketing 与 figure 参数传递；模块注释更新；LF 行尾归一化。

**为什么 role 错用 `unbound_*` / `symbol_role_mismatch` 而不是
`reference_kind_mismatch`**：`reference_kind_mismatch` 是 store 的 failure
class（kind 层），bridge 的 role 错是语义层。把两者混用会让"全闭合 store
下 bridge 不产出 `reference_kind_mismatch`"的断言失去意义 —— PHASE 3 Gate
明确要求该断言成立。

**PHASE 3 Gate 验证**（`tests/ir/bridge-dedup.spec.ts`，9→11 tests）：
- 全闭合链上 `contractFailures` 为空、bridge PASS；
- "结构合法但语义非法"的 store 上，bridge 只产出语义 kind
  （`unbound_data_artifact` / `symbol_role_mismatch` / `cross_source_requirement`）；
- R-014 / R-015 / R-016 / R-017 逐个断言 store 接受 + bridge 阻断；
- **快照闭合证明**：对 `ModelingIr.snapshot()` 全量重跑
  `validateRefFields`，0 问题。

## PHASE 4 — Fault Corpus（18/18）

- `faults/generate.py` 生成 `faults/R-001..R-018.json` + `.verdict.json`。
- 每个 fixture 显式标注 `root_cause: structural | semantic`：
  - R-001..R-013 structural：store 在 `put()` 拒绝；verdict 用
    `expected_ingest_reason_matches` 钉死 store 层根因
    （如 `raw_problem_ref:unresolved_reference`）。
  - R-014..R-017 semantic：store 全部接受，bridge 阻断。
  - R-012 / R-013 / R-018：PASS。
- `run-fault-corpus.mjs`（standalone，18/18）+ `tests/ir/fault-corpus.spec.ts`
  （vitest 常驻回归，18/18）。
- 与 TASK 1.5 的 C-001..C-018 不同：R-001..R-013 的拒绝发生在 store
  （ingest 层），bridge reason 只反映 downstream 的 backbone / contract
  缺失 —— 因此 verdict 以 ingest root-cause 为主断言，这正是
  runner 的 `expected_ingest_reason_matches` 机制存在的意义。

## PHASE 5 — 红队 + Mutation（14/14 killed）

- `run-mutations.mjs`：14 个 targeted mutations，覆盖任务书全部锚点：
  Problem raw（M-01）、requirement refs（M-02）、variable refs（M-03）、
  parameter nested（M-04）、run inputs（M-05）、Figure target set（M-06）、
  isAllowedTarget（M-07）、resolver 调用点（M-08）、RAW role（M-09）、
  INPUT role（M-10）、VARIABLE role（M-11）、PARAMETER role（M-12）、
  source 一致性（M-13）、scope token 唯一（M-14）。
- **M-14 首轮 SURVIVED**：`findDuplicateSymbolTokens` 只被 RT-D-01 间接
  覆盖（重复 token 被 store 的 NFC refine 在 ingest 拦截，store 上无重复
  可达）。按任务书规则（survivor = missing test）新增直接单测后重新击杀。
- `redteam.md`：RT-REF / RT-STORE / RT-BRIDGE / RT-POLICY 四角色全部
  CLOSED，每条攻击对应已落盘回归。

## PHASE 6 — 验收

- 全包回归：`NODE_OPTIONS="--max-old-space-size=4096" pnpm exec vitest run
  --project=thread-safe --maxWorkers=1 --no-file-parallelism
  packages/paper/paper-foundation/` → **49 files / 522 tests green**。
- executor 桥接：8/8。tsc：clean。
- 12 条 CLOSED 条件逐条核对 → `gate-report.json`（12/12 PASS）。
- `known-risks.md`：删除 "ProblemSpec refs intentionally absent" 条目，
  并记录删除；`store.ts` invariant 文档与实现一致（已确认）。

## 环境注意（重要）

- vitest 必须 `--maxWorkers=1`；本会话发现加 `--no-file-parallelism`
  可消除偶发 `0xC0000142` / `3221226505` 崩溃（机器内存上限，见
  CONTINUATION.md §2）。`run-mutations.mjs` 已内置这两个 flag。
- `bridge.ts` / `schema.ts` 原为 CRLF，已按 TASK 1.5 交接建议归一化为 LF
  （mutation anchor 匹配的前提）。
- 所有改动未 commit（用户未要求）；接手者视情况自行提交。

## 产物清单（`artifacts/handoff/TASK-1.5R/`）

`summary.md` · `invariant.md` · `changed-files.txt` · `tests.txt` ·
`gate-report.json` · `fault-results.json` · `mutation-results.json` ·
`redteam.md` · `known-risks.md` · `faults/R-001..R-018.*`（fixture+verdict）·
`faults/generate.py` · `run-fault-corpus.mjs` · `run-mutations.mjs` ·
`mutate.py` · `CONTINUATION.md` · `HANDOVER.md`

## 下一步（不是本任务的）

- TASK 2（Claim → Result → Run 数值绑定）—— 需 TASK 1.5 在
  External Attack Gate 复检 PASS 后解锁，**本任务不启动**。
