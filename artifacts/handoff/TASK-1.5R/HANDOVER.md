# TASK 1.5R — 交接文档（源自 TASK 1.5 External Attack Gate HOLD）

> 本文档是给 **TASK 1.5R 实施 agent** 的完整交接。内容分为两部分：
> 第 1 部分是对「TASK 1.5 推进 → External Attack Gate HOLD → TASK 1.5R 任务书下达」整轮对话的**零遗漏、零篡改复盘**；
> 第 2 部分是**待做事务清单**，严格按任务书 `D:\TASK_1.5R_Canonical_Reference_Closure_Agent特制单任务书.docx` 提炼，不擅自增删任何约束。
>
> 下一个 agent 读完本文档即可独立开工，无需回看原对话。

---

## 第 1 部分：整轮对话复盘（零遗漏 / 零篡改）

### 1.1 一句话结论

TASK 1.5 暂不准入 TASK 2，**External Attack Gate = HOLD / FAIL-CLOSED**。阻断根因**唯一但级别高**：TASK 1.5 为了让 bridge / fault / mutation 更容易触达，部分放宽了 TASK 1 已建立的 **canonical store 边界**（`refs.ts` 中 `ProblemSpec: []`、`FigureSpec.data_refs: 'ANY'`），导致 canonical `ModelingIr` 可以持有 dangling / wrong-kind 的 IR-internal 边，而只在后续 delivery bridge 才被拒绝。下一阶段不是 Claim→Result→Run，而是一个很窄的修复门 **TASK 1.5R — Canonical Reference Closure / Store Boundary Restoration**。TASK 1.5R 不重做 TASK 1.5，只恢复职责分层。

### 1.2 External Attack Gate 判定（用户原话，逐项未改）

**用户认可的（作为有效交付证据，未独立重跑完整仓库）：**

- 包内交付质量本身是好：
  - `DataArtifact` / `RequirementSpec` / `SymbolSpec` 已成为 **closed canonical kinds**；
  - 旧的 nested requirement / embedded symbol semantics 被**真正删除**（不是断开）；
  - FORMAL / FAST 的 **Problem Contract 确实接回了既有 `ir_canonicalization` 主链**。
- 验证结果（认可为有效证据，但用户未冒充在本环境独立重跑）：
  - **47 files / 488 tests green**
  - **18/18 fault corpus**
  - **14/14 targeted mutations**
  - **4 类红队，当前 CRITICAL open = 0**

**阻断项（原话核心，未改）：**

> 阻断项只有一个根因，但级别足够高：TASK 1.5 为了让 bridge / fault / mutation 更容易触达，部分放宽了 TASK 1 已建立的 canonical store 边界。
> 当前 `refs.ts` 中 `ProblemSpec: []`，因此 `raw_problem_ref` 和 `requirement_refs` 可以在 `ModelingIr.put()` 时**不做 existence / kind closure**；`FigureSpec.data_refs` 还被放宽成了 `ANY`，真正的 `Result | DataArtifact` 限制等到 `validateProblemContract()` 才执行。包内 `known-risks.md` 明确承认这是为了测试可达性而做的设计选择，而且 `redteam15.spec.ts` 还有测试**明确期望 500 个未注册 requirement refs 可以被 canonical store 接受**。这与 `store.ts` 自己宣称的"canonical reference 在 ingest 时闭合"的信任模型冲突。

### 1.3 阻断根因的精确代码证据（TASK 1.5 当前状态，供 1.5R 直接定位）

下列位置是 TASK 1.5R 必须改变的**最小精确靶点**，未做任何推断改写：

1. **`packages/paper/paper-foundation/src/ir/refs.ts:52`**
   ```ts
   ProblemSpec: [],
   ```
   `ProblemSpec` 的 `raw_problem_ref` 与 `requirement_refs` 完全不在 `IR_REF_FIELDS` 中 → `store.ts:260` 的 `validateRefFields(kind, parsed.data, ...)` 对 `ProblemSpec` 调用时会因 `IR_REF_FIELDS['ProblemSpec']` 为空数组而**一个检查都不执行**。

2. **`packages/paper/paper-foundation/src/ir/refs.ts:80-83`**
   ```ts
   FigureSpec: [
     { path: 'data_refs', arity: 'many', target: 'ANY' },
     { path: 'claim_refs', arity: 'many', target: 'Claim' },
   ],
   ```
   `data_refs` 被声明为 `ANY`（合法 kind union `Result | DataArtifact` 被推迟到 contract guard）。`refs.ts:43-49` 的模块注释明确写了"generic table 只能声明一个 target per field，所以 union 委托给 `validateProblemContract`"——这正是 HOLD 判定的来源设计选择。

3. **`packages/paper/paper-foundation/src/ir/refs.ts:8-19`** 模块头注释把 `raw_problem_ref` 列为"external locator，not resolved here"——但 TASK 1.5R 任务书 §3 已明确 `raw_problem_ref` 是 **IR-internal reference**（必须 existence+kind 闭合），旧注释需随之修正，不能再把它当 external locator。

4. **`packages/paper/paper-foundation/src/ir/store.ts:15`**（信任模型注释，与放行行为冲突，必须修复或使行为一致）
   ```
   *     A reference that resolved at ingest time can therefore never dangle
   *     later, which is why this TASK needs no staleness machinery of its own
   ```
   TASK 1.5R 全量 CLOSED 条件第 11 条要求：`known-risks.md` 删除"ProblemSpec refs intentionally absent"这一条，且 `store.ts` 的 invariant 文档与实现重新一致。这条注释是"文档与实现不一致"的具体位置。

5. **`packages/paper/paper-foundation/src/ir/store.ts:260`**（调用点，本身正确，只是被空数组短路）
   ```ts
   for (const problem of validateRefFields(kind, parsed.data, ref => this.#objects.get(ref)?.kind)) {
     failures.push(toRefFailure(problem))
   }
   ```

6. **`packages/paper/paper-foundation/tests/ir/redteam15.spec.ts:98-99`**（把漏洞固化为预期行为，PHASE 2 必须改）
   ```ts
   const refs = Array.from({ length: 500 }, (_, i) => 'R' + i)
   expect(ir.put('ProblemSpec', { problem_id: 'P1', raw_problem_ref: 'x', requirement_refs: refs }).accepted).toBe(true)
   ```
   该测试位于 `RT-A-02`（typed vs JSON ingress 同预算）用例组中。任务书 PHASE 2 明确要求："删除'500 dangling requirement refs accepted'之类把漏洞固化为预期行为的断言"。

7. **`packages/paper/paper-foundation/src/ir/problem-contract.ts`** 中存在对 `raw ref missing` / `requirement missing` / `figure wrong kind` 的重复基础守卫——这些与 store 将承担的职责重叠。TASK 1.5R §PHASE 3 要求删除或标记为 unreachable（保留 role / source / scope 语义层）。具体函数：`validateProblemContract`、`validateModelSpecSymbols`、`findDuplicateSymbolTokens`、`minimumProblemContractSatisfied`。

8. **`packages/paper/paper-foundation/artifacts/handoff/TASK-1.5/known-risks.md:37-56`** 第 3 条「ProblemSpec reference fields are absent from `IR_REF_FIELDS`」——书面承认"declaring them 会让 store 提前拒绝，使 C-002/C-003/C-005 与突变 M-02 不可达，所以选 testability over redundant enforcement"。这条 reasoning 正是 HOLD 的根因，PHASE 3 / CLOSED 条件要求移除。

### 1.4 TASK 1.5 已完成工作的复盘（已落盘，1.5R 必须保留，不重做）

下表是 TASK 1.5 已交付且**不应被 1.5R 破坏**的内容（1.5R 只改 reference 边界分层，不动这些产出的语义）：

- **ontology 主体保留**：`DataArtifact`(RAW_PROBLEM/INPUT_DATA, strict sha256)、`RequirementSpec`(SUBPROBLEM/REQUIRED_OUTPUT/CONSTRAINT)、`SymbolSpec`(VARIABLE/PARAMETER) 作为 closed canonical kinds；旧的 nested subproblem/required-output/constraint、embedded meaning/unit 已真正删除（schema.ts、store.ts 已无残留定义）。
- **bridge 主线已接回**：`evaluateIrBridge` 在 FORMAL/FAST 下要求 `contractSatisfied`；`IrBridgeDecision` 自带 `contractFailures / contract / contractSatisfied`；`inspectProblemContract` 跨对象走查。
- **语义守卫保留且有效**（1.5R 必须继续保留，只是不再承担 existence/kind）：
  - RAW_PROBLEM / INPUT_DATA 的 **role** 检查；
  - VARIABLE / PARAMETER 的 **role** + ModelSpec scope ownership；
  - Requirement `source_data_ref == ProblemSpec.raw_problem_ref` 的 **source consistency**；
  - same-scope symbol token **uniqueness**（NFC）；
  - ProblemSpec 至少引用一个 **REQUIRED_OUTPUT**；
  - 既有 5-kind backbone + FORMAL/FAST minimum contract。
- **门禁基线保留**：IR 178/178、paper 488/488、fault corpus 18/18、mutation 14/14、tsc host/client 双过。1.5R 不得让这些回归（CLOSED 条件第 11 条：TASK 1/1.25/1.5 regressions 全绿）。

### 1.5 本轮对话已知工程坑（1.5R agent 直接复用，避免重蹈）

- **不要为 mutation 可达性保留 production fail-open**：这正是本次 HOLD 的根因。反过来，1.5R 改测试（删除 500-dangling 预期）而**不是**改信任边界来迁就测试。
- **删除型变异回滚**：TASK 1.5 的 `run-mutations.mjs` 对"删除一行"的变异无法用字符串替换回滚，已用 `mutate.py` 的 byte-exact 备份机制解决；1.5R 若新增删除型变异，沿用同一 helper。
- **行尾**：仓库 `.gitattributes` 声明 LF，但部分文件是 CRLF；CRLF 会使 `mutate.py` 的 anchor 匹配失败。统一归一化为 LF。
- **spawn execPath**：`run-fault-corpus.mjs` / `run-mutations.mjs` 用 `process.execPath` 而非裸 `'node'`，否则在受限 PATH 下 `spawnSync` 报 ENOENT；并加 repoRoot 存在性校验（Git Bash 的 `$(pwd)` 展开为 `/d/...` 会导致路径错误伪装成 18 个真实回归）。
- **`chainThrough(kind)` 取代 `slice(0,N)`**：TASK 1.5 曾在 fixtures 中插入 4 个 kind，导致 `validChain().slice(0,3)` 语义漂移；改为按 kind 取前缀。1.5R 若再动 validChain 顺序，沿用 `chainThrough`。

---

## 第 2 部分：待做事务清单（严格按 TASK 1.5R 任务书）

> 下列每条均来自任务书原文，未擅自增删。括号 `[PHASE x]` 标注其所属阶段；`(Gate)` 为对应阶段的验收闸。

### 2.0 全局硬约束（任何 PHASE 不得违反）

- **STOP RULE**：禁止继续 TASK 2。任何修复若依赖"bridge 最后会挡住"来解释 canonical store 中的非法 reference，都视为**未修复**。
- **唯一目标**：把 TASK 1.5 新增的 Problem/Data/Symbol references 真正纳入 `ModelingIr` commit boundary；bridge 只保留跨对象语义、role/source consistency、FORMAL/FAST completeness。
- **前置**：TASK -1 / 0 / 1 / 1.25 已 CLOSED；TASK 1.5 ontology 主体保留。
- **核心原则**：Canonical store 是信任边界（不是 staging area）；bridge 是 delivery policy（不是 canonical state 的基础 reference sanitizer）。
- **解锁规则**：仅当 TASK 1.5R External Attack Gate = PASS，TASK 1.5 才可标记 CLOSED 并解锁 TASK 2。

### 2.1 Hard Scope（允许修改的文件）

| 文件 | 用途 |
|---|---|
| `src/ir/refs.ts` | 扩展 target algebra / nested reference extraction；声明所有 internal refs |
| `src/ir/store.ts` | commit 前执行完整 structural reference closure；必要时调整 failure path |
| `src/ir/problem-contract.ts` | 删除与 store 重复的 existence/kind repair；保留 role/source/scope/uniqueness 语义守卫 |
| `src/ir/bridge.ts` | 只消费 canonical closed graph；保留 minimum contract 与 semantic failures |
| `src/ir/schema.ts` | 原则上不改 ontology；仅 reference path 形状需要时做最小类型支持 |
| `tests/ir/*` + executor bridge tests | 新增 store-boundary attacks、bridge semantic regression、mutation |
| `artifacts/handoff/TASK-1.5R/*` | 审计证据 |

（注：上表为文件清单，未改其语义。原文为"允许修改"段落，此处直列。）

### 2.2 禁止事项（任何 PHASE 不得做）

- 不做 TASK 2 claim slot / numeric binding。
- 不做 TASK 3 文件存在性、真实 hash bytes、execution/repro/unit gates。
- 不做 STALE/update/replace。
- 不改 reviewer authority。
- 不以"为了让 mutation 可达"为理由保留 production fail-open。
- 不允许把 ProblemSpec/ModelSpec/RunArtifact/FigureSpec 的 internal ref 再标成 external locator。
- 不允许使用 `ANY` 表达已知的窄 union。

### 2.3 目标 Reference Policy（逐字段职责分层 — 实施的总蓝图）

| 对象字段 | Store commit 前必须证明 | Bridge 仍负责 |
|---|---|---|
| `ProblemSpec.raw_problem_ref` | exists + kind=DataArtifact | role=RAW_PROBLEM；source consistency；minimum contract |
| `ProblemSpec.requirement_refs[]` | exists + kind=RequirementSpec | 至少一个 REQUIRED_OUTPUT；same raw source |
| `RequirementSpec.source_data_ref` | exists + kind=DataArtifact | role/source semantic if needed |
| `SymbolSpec.scope_ref` | exists + kind=ProblemSpec | same-scope token uniqueness |
| `ModelSpec.variable_refs[]` | exists + kind=SymbolSpec | role=VARIABLE + scope ownership |
| `ModelSpec.parameter_refs[].symbol_ref` | exists + kind=SymbolSpec | role=PARAMETER + scope ownership |
| `RunArtifact.input_data_refs[]` | exists + kind=DataArtifact | role=INPUT_DATA |
| `FigureSpec.data_refs[]` | exists + kind∈{Result,DataArtifact} | 无基础 kind repair；后续 renderer policy 非本任务 |
| Claim/Result/etc. existing refs | 保持 TASK 1 现有行为 | 不回归 |

### 2.4 推荐实现形状（约束，非可选）

- 不要为修一个 union 写特殊 case 到 executor。优先把 reference policy 本身升级成能表达"单 target / target set / nested path"。
- 推荐概念（名称可不同）：
  - `type IrRefTarget = 'ANY' | IrKind | readonly IrKind[]`
  - `interface IrRefFieldSpec { path; arity/extractor: deterministic, closed; target: IrRefTarget }`
- `validateRefFields(...)` 必须：① 确定性提取每个被引 id；② 拒绝 missing id；③ 拒绝 kind 不在 allowed target set；④ 报告稳定 field/index path；⑤ 绝不调用用户代码 / 绝不 throw。
- `FigureSpec.data_refs` 应声明 `[Result, DataArtifact]`，不是 `ANY`。
- `parameter_refs[].symbol_ref` 必须在 store 层可枚举，不能因嵌套对象而跳过。
- role（RAW_PROBLEM / INPUT_DATA / VARIABLE / PARAMETER）不是 kind；可继续用 semantic validator，但 existence/kind 不能延后。

### 2.5 PHASE 0 — 先写失败证明，不改 production

**动作**：先把外审 blocker 变成 regression。以下测试在**当前 TASK 1.5 应失败**（即当前会错误 accepted），修复后全绿：

| ID | 攻击 | 修复后期望 |
|---|---|---|
| R-001 | `ProblemSpec.raw_problem_ref` 指向不存在 id | `put()` accepted=false / `unresolved_reference` |
| R-002 | `ProblemSpec.requirement_refs` 指向不存在 id | `put()` BLOCKED |
| R-003 | `ProblemSpec.requirement_ref` 指向 Claim | `reference_kind_mismatch` |
| R-004 | `ModelSpec.variable_refs` 指向不存在 SymbolSpec | `unresolved_reference` |
| R-005 | `ModelSpec.variable_refs` 指向 Result | `reference_kind_mismatch` |
| R-006 | `parameter_refs[].symbol_ref` 不存在 | `unresolved_reference` + nested path |
| R-007 | `parameter_refs[].symbol_ref` 指向 DataArtifact | `reference_kind_mismatch` |
| R-008 | `RunArtifact.input_data_refs` 指向不存在 id | `unresolved_reference` |
| R-009 | `RunArtifact.input_data_refs` 指向 Result | `reference_kind_mismatch` |
| R-010 | `FigureSpec.data_refs` 指向 ModelSpec | `reference_kind_mismatch` |
| R-011 | `FigureSpec.data_refs` 指向不存在 id | `unresolved_reference` |
| R-012 | `FigureSpec.data_refs` → Result | PASS |
| R-013 | `FigureSpec.data_refs` → DataArtifact | PASS |

**Gate**：必须先证明至少 **R-001 / R-002 / R-004 / R-008 / R-010** 在旧实现上暴露 acceptance gap；若测试一开始就全绿，说明攻击构造错了，**STOP**。

### 2.6 PHASE 1 — Reference Target Algebra

**动作**：
- 扩展 `IrRefTarget` 支持窄 target set；`ANY` 仅保留 genuinely-any 的 evidence refs。
- 扩展 ref extraction 支持 `parameter_refs[].symbol_ref`，并保留稳定 path/index。
- 把 `ProblemSpec.raw_problem_ref` / `requirement_refs`、`ModelSpec.variable_refs` / `parameter_refs`、`RunArtifact.input_data_refs`、`FigureSpec.data_refs` 全部写进 closed policy。
- `deepFreeze` 新 policy；新增 mutation 防止运行时把 target set 改成 `ANY`。

**Gate**：R-001..R-013 的 existence/kind 层全部由 `ModelingIr.put()` / `ingestJson()` 决定，而不是 `evaluateIrBridge()`。

### 2.7 PHASE 2 — Store Boundary Restoration

**动作**：
- `ModelingIr` 的注释与真实行为必须再次一致：任何 IR-internal missing / wrong-kind reference 都无法 commit。
- 保持 append-only：不引入 forward-reference repair queue。生产者必须按依赖拓扑 ingest。
- 保持 totality：nested extractor / target-set logic throw → `internal_error` refusal。
- 保持 duplicate-id + reference failures 可同时汇报。
- 更新 tests：删除"500 dangling requirement refs accepted"之类把漏洞固化为预期行为的断言（即 §1.3 第 6 点的 `redteam15.spec.ts:98-99`）。

**Gate**：构造一个 snapshot 后扫描所有已声明 IR ref：不存在任何 missing / wrong-kind edge。测试必须**直接读取 `ModelingIr.snapshot` 证明闭合**，而非只看 bridge verdict。

### 2.8 PHASE 3 — Bridge De-duplication

**动作**（store 已保证 existence/kind 后）：
- 保留：RAW_PROBLEM / INPUT_DATA role；VARIABLE / PARAMETER role + ModelSpec scope ownership；Requirement source_data_ref == ProblemSpec.raw_problem_ref；same-scope symbol token uniqueness；ProblemSpec 至少引用一个 REQUIRED_OUTPUT；FORMAL/FAST minimum contract + 既有 5-kind backbone。
- 删除或标记 unreachable：bridge 对 raw ref missing、requirement missing、figure wrong kind 等 store 已阻断的重复分支（即 §1.3 第 7 点的重叠守卫）。

**Gate**：bridge fault fixtures 要改成"结构合法但语义非法"的攻击，确保 semantic guard 真正 load-bearing。

### 2.9 PHASE 4 — Fault Corpus R-001..R-018

| ID | 场景 | 期望 |
|---|---|---|
| R-001..R-013 | 上表 structural reference attacks | store-level expected verdict |
| R-014 | RAW_PROBLEM ref 指向 DataArtifact(role=INPUT_DATA) | store 接受 kind；bridge semantic BLOCKED |
| R-015 | Run input 指 DataArtifact(role=RAW_PROBLEM) | store 接受 kind；bridge semantic BLOCKED |
| R-016 | VARIABLE ref 指 SymbolSpec(role=PARAMETER) | store 接受 kind；bridge semantic BLOCKED |
| R-017 | Requirement source 与 Problem raw source 不同 | store refs 全合法；bridge semantic BLOCKED |
| R-018 | 完整 Problem Contract + backbone | PASS |

**约束**：这组 corpus 必须显式区分 **structural vs semantic root cause**，避免以后又为了测试 bridge 而把 structural guard 拆掉。

### 2.10 PHASE 5 — 红队与 Mutation

**四角色必须攻击**：
- **RT-REF**：missing / wrong-kind / nested-path / duplicate-index / target-set mutation。
- **RT-STORE**：typed vs JSON ingress、prototype/accessor、resolver throw、snapshot scan。
- **RT-BRIDGE**：证明 bridge 不再是 structural sanitizer；结构非法应在它之前死。
- **RT-POLICY**：把 Figure target-set 改 ANY、删 ProblemSpec refs、删 nested extractor、删 role checks。

**Mutation 最少 12 个**（每个锚点对应一个 load-bearing guard）：Problem raw、requirement refs、variable refs、parameter nested refs、run inputs、Figure target set、nested path index、resolver missing、resolver mismatch、RAW role、INPUT role、symbol role/source semantic。
**要求**：12/12 killed。

### 2.11 全量 CLOSED 条件（逐条验收，全部满足才可标记 PASS）

- [ ] `IR_REF_FIELDS` / successor policy 声明所有 TASK 1.5 internal references。
- [ ] `ProblemSpec` 不再能以 dangling raw/requirement refs 进入 `ModelingIr`。
- [ ] `ModelSpec.variable` / `parameter` symbol refs 在 commit 前 existence/kind closed。
- [ ] `RunArtifact.input_data_refs` 在 commit 前 existence/kind closed。
- [ ] `FigureSpec.data_refs` 用窄 `Result|DataArtifact` target set，不用 `ANY`。
- [ ] `ModelingIr.snapshot` 中不存在任何 declared missing / wrong-kind internal edge。
- [ ] bridge 只负责 semantic role/source/scope/minimum-contract，不作为 structural repair。
- [ ] R-001..R-017 全部按层级 BLOCKED；R-018 PASS。
- [ ] ≥4 红队角色，CRITICAL escape = 0。
- [ ] ≥12 targeted mutations，全部 killed。
- [ ] `packages/paper` full regression green；TASK 1/1.25/1.5 regressions 全绿。
- [ ] `known-risks` 删除"ProblemSpec refs intentionally absent"这一条；`store.ts` invariant 文档与实现重新一致。

### 2.12 固定 Handoff 产物（落盘位置：`artifacts/handoff/TASK-1.5R/`）

- `summary.md`
- `invariant.md`
- `changed-files.txt`
- `tests.txt`
- `gate-report.json`
- `fault-results.json`
- `mutation-results.json`
- `redteam.md`
- `known-risks.md`
- `faults/R-001..R-018.*`（每例含 fixture 与 verdict）

### 2.13 Agent 执行总指令（任务书原文复述，未改）

> You are implementing TASK 1.5R only: Canonical Reference Closure.
> The External Attack Gate has HOLDed TASK 1.5 because canonical ModelingIr can currently contain dangling or wrong-kind IR-internal references that are only rejected later by the delivery bridge.
> Goal: restore the TASK 1 store boundary. Every IR-internal reference must pass existence + allowed-kind validation before commit. The bridge may enforce semantic role/source/scope and minimum-contract policy, but it must not be the first line of structural reference validity.
>
> Hard rules:
> 1. Do not start TASK 2.
> 2. First write R-001.. structural regression tests against the current implementation; prove the gap before changing production.
> 3. Never weaken production validation for mutation-test reachability. Change the test, not the trust boundary.
> 4. FigureSpec.data_refs must use a narrow Result|DataArtifact target set, never ANY.
> 5. parameter_refs[].symbol_ref must be enumerated and validated at store commit.
> 6. Preserve append-only, totality, deep-freeze, global id uniqueness, and fail-closed audit behavior.
> 7. Remove duplicate bridge existence/kind checks once they are structurally unreachable; keep semantic role/source/scope checks.
> 8. Every exploit becomes a regression.
> 9. Stop after producing TASK-1.5R handoff. Do not implement Claim→Result→Run.
>
> First action: PHASE 0. Add the external-review regressions and demonstrate which currently fail.

### 2.14 给 1.5R agent 的开工建议（基于本对话教训，非任务书约束，供参考）

- 第一个提交物应是 PHASE 0 的 R-001..R-013 测试（先全红），再改 `refs.ts` 让 R-001/R-002/R-004/R-008/R-010 转绿，证明 gap 真实存在。
- 改 `refs.ts` 时同步修正 §1.3 第 3 点的模块头注释（不要再称 `raw_problem_ref` 为 external locator）。
- 改完 `refs.ts` 后，先跑 paper 全量回归确认 TASK 1.5 既有 488 测试仍绿（CLOSED 条件第 11 条），再动 `problem-contract.ts` / `bridge.ts` 去重。
- 删除 `redteam15.spec.ts:98-99` 的 500-dangling 预期时，注意该用例属于 RT-A-02 组（sized 预算），只删 dangling 接受那一行，保留 oversized 拒绝断言。
- 复用 `artifacts/handoff/TASK-1.5/` 下的 `run-fault-corpus.mjs`、`mutate.py` 作为 1.5R 的 runner 基底，按 §PHASE 4/5 替换 fixture 与突变清单。
