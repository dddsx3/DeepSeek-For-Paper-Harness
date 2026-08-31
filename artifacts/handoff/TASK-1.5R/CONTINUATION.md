# TASK 1.5R — Continuation Handoff（状态交接）

> 接手前请先读同目录 `HANDOVER.md`（任务规格 / CLOSED 条件 / Gate 定义）。
> 本文件记录 **截至 2026-08-31（PHASE 3..6 完成后）** 的真实进度、环境约束
> 与下一步精确指令。

---

## 0. 一句话结论

**TASK 1.5R 已全部完成**：PHASE 0/1/2（交接时已完成）+ PHASE 3（bridge
去重）+ PHASE 4（fault corpus R-001..R-018）+ PHASE 5（红队 + 14 mutations
killed）+ PHASE 6（验收 + handoff 产物）全部落盘。全包回归
**49 文件 / 522 测试全绿**，fault corpus 18/18，mutation 14/14 killed，
12/12 CLOSED 条件 PASS（见 `gate-report.json`）。
**下一步不是 TASK 2** —— 按 STOP RULE，TASK 1.5R 不启动 TASK 2；TASK 2
需 External Attack Gate 复检 PASS 后另行解锁。

---

## 1. 完成阶段（DONE & VERIFIED）

| Phase | 内容 | 验证 |
|------|------|------|
| PHASE 0 | `tests/ir/ref-closure.spec.ts` — R-001..R-013 结构引用攻击（store-level verdict） | 13/13 绿 |
| PHASE 1 | `src/ir/refs.ts` 收窄 Reference Target Algebra + 闭合表 + nested extractor | 单测 + 全包绿 |
| PHASE 2 | Store Boundary Restoration：`put()` 前 `validateRefFields` | 192/192 → 219/219 |
| **PHASE 3** | **Bridge 去重**：`problem-contract.ts` / `bridge.ts` 删除 store 已保证的 existence/kind 分支；`PROBLEM_CONTRACT_FAILURE_KINDS` 移除 `unresolved_reference` / `reference_kind_mismatch` / `figure_target_not_union` / `missing_raw_problem_data_artifact` / `missing_symbol`；FigureSpec 走查整段删除；role 错改用语义 kind（`unbound_data_artifact` / `symbol_role_mismatch` / `cross_source_requirement`） | `tests/ir/bridge-dedup.spec.ts` 11/11；全包绿 |
| PHASE 4 | Fault Corpus R-001..R-018 → `faults/`（fixture+verdict，`root_cause: structural\|semantic` 显式区分）；`run-fault-corpus.mjs` + `tests/ir/fault-corpus.spec.ts` 双入口 | 18/18 |
| PHASE 5 | 红队 4 角色（RT-REF/RT-STORE/RT-BRIDGE/RT-POLICY）+ 14 targeted mutations | 14/14 killed（`mutation-results.json`）；`redteam.md` |
| PHASE 6 | 全量回归 + 12 条 CLOSED 核对 + 全部 handoff 产物 | 49 文件/522 测试绿；`gate-report.json` 12/12 PASS |

---

## 2. 环境约束与 workaround（⚠️ 必读，否则会以为测试崩了）

**问题**：vitest 默认并行跑会在多 worker 下 OOM
（`Fatal process out of memory: Re-embedded builtins: set permissions`）。
这是**机器内存上限 + 并行 fork 放大**，与代码正确性无关。

**✅ 已验证 workaround**（单 worker + 放宽 old-space + 禁文件并行）：

```bash
NODE_OPTIONS="--max-old-space-size=4096" \
  pnpm exec vitest run --project=thread-safe --maxWorkers=1 --no-file-parallelism <path>
```

**规则**：
1. 任何 vitest 运行都要加 `--maxWorkers=1`；**不要**直接 `vitest run <dir>`
   （默认并行必 OOM）。
2. **`--no-file-parallelism` 是本会话发现的新增稳定 flag**：不加它时，
   从 `spawnSync` 子进程跑 vitest 偶发 `0xC0000142` / `3221226505` 崩溃
   （fork 时序内存压力）。交互式终端跑单文件可能不触发，但 mutation /
   fault runner 内部 spawn 时必须加。`run-mutations.mjs` 已内置。
3. 全量回归（PHASE 6）用上面的命令，否则进程崩溃、误报失败。
4. `corepack pnpm` 代替裸 `pnpm`（本机 PATH 无 pnpm；corepack 可用）。

**其他历史噪音**（与本任务无关，仅记录）：
- 工具/API 调用历史上偶发 `429 group requests-per-minute limit exceeded`
  —— 与测试运行无关，重试即可。
- Git Bash 下 `/tmp` 映射到 `D:\tmp`，tsx 相对路径解析需注意（用工作区内
  临时脚本）。
- `bridge.ts` / `schema.ts` 原为 CRLF，已归一化为 LF（mutation anchor
  匹配的前提）。新文件一律 LF。

---

## 3. 本会话真实改动文件（git 视角）

`git status --short` 在 `packages/paper/paper-foundation/` 下显示若干
modified/untracked。**区分本会话改动 vs 历史（TASK 1.5 / 1.5R 起始）改动**：

### 3.1 本会话改动（PHASE 3..6）
- `src/ir/problem-contract.ts` — **PHASE 3 核心**：failure-kind 集合收窄；
  raw/requirement/run 分支去重；FigureSpec 走查删除；role 错语义化。
- `src/ir/bridge.ts` — **PHASE 3**：total-failure sentinel 改
  `unbound_data_artifact`；`inspectProblemContract` 删 figure bucketing +
  参数；注释更新；**CRLF→LF**。
- `src/ir/refs.ts` — `entries[i]!` 非空断言（`noUncheckedIndexedAccess`）。
- `tests/ir/bridge-dedup.spec.ts` — **新增**：PHASE 3 gate（无结构失败 +
  R-014..R-017 语义攻击 + 快照闭合证明 + M-14 直接单测）。
- `tests/ir/fault-corpus.spec.ts` — **新增**：fault corpus vitest 常驻回归。
- `artifacts/handoff/TASK-1.5R/` — 全部产物（见 §7）。

### 3.2 历史改动（TASK 1.5 / 1.5R 起始会话，非本会话；不要误删）
`src/ir/refs.ts`（闭合表）、`src/ir/store.ts`、`src/ir/schema.ts`、
`src/ir/parse.ts`、`src/ir/index.ts`、`tests/ir/fixtures.ts`、
`tests/ir/ref-closure.spec.ts`、`tests/ir/redteam15.spec.ts`、
`tests/ir/run-fault.ts`、`tests/ir/redteam.spec.ts`、`tests/ir/attack.spec.ts`、
`tests/ir/schema.spec.ts`、`tests/ir/store.spec.ts`、`tests/ir/bridge.spec.ts`、
`tests/ir/refs.spec.ts`、`tests/executor-ir-bridge.spec.ts` 等。

> ⚠️ **未 commit**。所有改动留在工作区（用户未要求 commit）。接手者视
> 情况自行提交。

---

## 4. 已验证的测试矩阵（全部绿）

- 全包：`packages/paper/paper-foundation/` → **49 文件 / 522 测试**。
- executor 桥接：`tests/executor-ir-bridge.spec.ts` → 8/8。
- IR 目录：`tests/ir/` → 12 文件 / 219 测试。
- fault corpus standalone：`node artifacts/handoff/TASK-1.5R/run-fault-corpus.mjs <repo-root>` → 18/18。
- mutations：`node artifacts/handoff/TASK-1.5R/run-mutations.mjs <repo-root>` → 14/14 killed。
- tsc：`tsc --noEmit -p packages/paper/paper-foundation/tsconfig.json` → clean。

---

## 5. 12 条 CLOSED 条件（全部 PASS，逐条见 `gate-report.json`）

1. `IR_REF_FIELDS` 声明全部 TASK 1.5 internal refs ✓
2. `ProblemSpec` 无 dangling raw/requirement refs 可入 store ✓
3. `ModelSpec` variable/parameter symbol refs commit 前闭合 ✓
4. `RunArtifact.input_data_refs` commit 前闭合 ✓
5. `FigureSpec.data_refs` 窄 `Result|DataArtifact`（非 ANY）✓
6. `ModelingIr.snapshot` 无 missing/wrong-kind edge ✓
7. bridge 只做语义 role/source/scope/minimum-contract ✓
8. R-001..R-017 按层级 BLOCKED；R-018 PASS ✓
9. ≥4 红队角色，CRITICAL escape = 0 ✓
10. ≥12 targeted mutations 全 killed（14/14）✓
11. 全包回归绿；TASK 1/1.25/1.5 regressions 绿 ✓
12. `known-risks` 删除 "ProblemSpec refs intentionally absent"；
    `store.ts` invariant 文档与实现一致 ✓

---

## 6. 遗留注意事项

- **M-14 教训**：`findDuplicateSymbolTokens` 的重复 token 会被 store 的
  NFC refine 在 ingest 拦截，所以 store 上永远无重复可达 —— 它的守卫只能
  通过**直接单测**验证（已加进 `bridge-dedup.spec.ts`）。若未来重构
  token 校验，注意别丢掉这个直接测试。
- **fault runner 的 ingest haystack 是 `path:kind:reason`**：needle 写
  `raw_problem_ref:unresolved_reference` 才能同时钉死字段与 failure class。
- **fault-corpus.spec.ts 的 fixture 路径**按 `import.meta.url` 5 级上溯
  到仓库根；移动包布局需同步更新。
- 若重跑 `run-mutations.mjs`，需保证 `--no-file-parallelism`（已内置）；
  首次跑约 2-4 分钟（14 × (vitest ~4s + corpus ~2s)）。

---

## 7. 关键文件速查

| 文件 | 职责 |
|------|------|
| `src/ir/refs.ts` | `IR_REF_FIELDS` 闭合表 + `validateRefFields`（store 边界） |
| `src/ir/store.ts` | `put()` → schema → `validateRefFields` → commit |
| `src/ir/problem-contract.ts` | **语义守卫**（PHASE 3 去重后）：role / source / scope / uniqueness / minimum contract |
| `src/ir/bridge.ts` | 消费 closed graph；只报语义失败；total sentinel `unbound_data_artifact` |
| `tests/ir/ref-closure.spec.ts` | R-001..R-013（store-level） |
| `tests/ir/bridge-dedup.spec.ts` | PHASE 3 gate + R-014..R-017 + 快照闭合 + M-14 |
| `tests/ir/fault-corpus.spec.ts` | fault corpus vitest 常驻回归 |
| `artifacts/handoff/TASK-1.5R/faults/` | R-001..R-018 fixture + verdict（`generate.py` 可重生成） |
| `artifacts/handoff/TASK-1.5R/run-fault-corpus.mjs` | standalone fault runner |
| `artifacts/handoff/TASK-1.5R/run-mutations.mjs` | mutation runner（M-01..M-14） |
| `artifacts/handoff/TASK-1.5R/gate-report.json` | 12 条 CLOSED 逐条证据 |
| `artifacts/handoff/TASK-1.5R/redteam.md` / `known-risks.md` / `invariant.md` / `summary.md` | 审计证据 |
