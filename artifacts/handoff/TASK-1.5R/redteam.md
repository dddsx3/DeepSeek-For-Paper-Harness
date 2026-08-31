# TASK 1.5R — PHASE 5 红队报告（Red Team Report）

> 四角色攻击规格（HANDOVER.md §2.10）：RT-REF / RT-STORE / RT-BRIDGE /
> RT-POLICY。每条发现都对应一个已落盘的回归测试；CRITICAL escape = 0。

## 角色与结论总览

| 角色 | 攻击面 | 结论 | 关闭证据 |
|------|--------|------|----------|
| RT-REF | reference graph：missing / wrong-kind / nested-path / duplicate-index / target-set | CLOSED | `ref-closure.spec.ts`（R-001..R-013）+ `bridge-dedup.spec.ts` + `fault-corpus.spec.ts` |
| RT-STORE | typed vs JSON ingress、prototype/accessor、resolver throw、snapshot scan | CLOSED | `refs.spec.ts` + `store.spec.ts` + `redteam.spec.ts` + PHASE 3 快照闭合证明 |
| RT-BRIDGE | bridge 不再是 structural sanitizer；结构非法应在它之前死 | CLOSED | `bridge-dedup.spec.ts`（PHASE 3 语义攻击 + 无结构失败断言）|
| RT-POLICY | 把 Figure target-set 改 ANY、删 ProblemSpec refs、删 nested extractor、删 role checks | CLOSED | `run-mutations.mjs` M-01..M-14（14/14 killed）|

## RT-REF — Reference Graph Attacker

攻击者尝试把 dangling / wrong-kind 边注入 canonical state。

- **missing（不存在 id）**：`ProblemSpec.raw_problem_ref` /
  `requirement_refs` / `ModelSpec.variable_refs` /
  `parameter_refs[].symbol_ref` / `RunArtifact.input_data_refs` /
  `FigureSpec.data_refs` 指向未注册 id → **store `put()` 拒绝**
  （`unresolved_reference`）。回归：R-001 / R-002 / R-004 / R-006 / R-008 /
  R-011。
- **wrong-kind（kind 错）**：同上字段指向已注册但 kind 不符的对象 →
  store 拒绝（`reference_kind_mismatch`）。回归：R-003 / R-005 / R-007 /
  R-009 / R-010。
- **nested-path（嵌套索引）**：`parameter_refs[1].symbol_ref` 的拒绝必须
  带稳定索引路径（`parameter_refs.0.symbol_ref`），审计可定位单个条目。
  回归：R-006 / R-007（断言 path 精确）。
- **duplicate-index**：同一字段内重复引用 → zod `.refine` 去重拒绝
  （`schema_invalid`）。既有 schema.spec / store.spec 覆盖。
- **target-set（窄 union）**：`FigureSpec.data_refs` 声明
  `Result | DataArtifact` 而非 `ANY`；Claim 指向 figure → store 拒绝。
  回归：R-010 / R-011 / R-012 / R-013 + `refs.spec.ts`
  `delegates the Figure data_ref union to the contract guard`。

## RT-STORE — Store Boundary Attacker

- **typed vs JSON ingress**：`put()` 与 `ingestJson()` 走同一
  `#admit()` 管线（scan → schema → validateRefFields → commit），结构攻击
  两条路径都被拒。回归：`redteam15.spec.ts` RT-A-02（120k refs 两路都拒）。
- **prototype/accessor**：`scanIrValue` 拒绝携带原型链/accessor 的 payload；
  `ModelingIr.snapshot()` 通过 `#constructed` WeakSet 验证真实身份，bridge
  不读可被 shadow 的 `get()/list()`。回归：`redteam.spec.ts`、
  `bridge.spec.ts`（bridge is a reader）。
- **resolver throw**：`put()` 对任何内部 throw 报 `internal_error` 拒绝，
  永不 fail-open。回归：`store.spec.ts` totality 用例。
- **snapshot scan**：PHASE 2 Gate 要求"直接读 `ModelingIr.snapshot` 证明
  闭合"。回归：`bridge-dedup.spec.ts` *every declared ref in a closed
  snapshot resolves with an allowed kind*（对全 15 条记录重跑
  `validateRefFields`，0 问题）。

## RT-BRIDGE — Bridge 职责边界 Attacker

PHASE 3 后 bridge 只消费 canonical closed graph。

- **结构非法必须在 bridge 之前死**：R-001..R-013 的攻击对象在
  `put()` 即被拒，bridge 永远看不到 missing/wrong-kind 边。回归：
  `bridge-dedup.spec.ts` —— 在"结构合法但语义非法"的 store 上，
  bridge 的 `contractFailures` **只含语义 kind**
  （`unbound_data_artifact` / `symbol_role_mismatch` /
  `parameter_role_mismatch` / `cross_source_requirement`），
  绝不包含 `unresolved_reference` / `reference_kind_mismatch`。
- **语义守卫 load-bearing**：R-014（RAW_PROBLEM 槽位绑 INPUT_DATA
  工件）、R-015（run 输入绑 RAW_PROBLEM 工件）、R-016（VARIABLE 槽位绑
  PARAMETER 符号及反向）、R-017（Requirement source 与 problem raw source
  不一致）、scope ownership（符号属于别的 ProblemSpec → `unbound_*_symbol`）。
  回归：`bridge-dedup.spec.ts` + `fault-corpus.spec.ts`（R-014..R-017）。
- **orphan ModelSpec**：`problem_refs` 不指向任何已注册 ProblemSpec 的
  ModelSpec 仍被 `validateModelSpecSymbols` 走查（RT-B-01）。回归：
  `redteam15.spec.ts` RT-B-01。
- **minimum contract 绑定 ProblemSpec**：无 REQUIRED_OUTPUT 引用 /
  orphan REQUIRED_OUTPUT 不被计入。回归：`redteam15.spec.ts` RT-C-01 /
  RT-C-02。

## RT-POLICY — Policy Mutation Attacker

通过删除/弱化守卫验证每个 guard 是 load-bearing。14/14 killed：

| ID | 守卫 | 结果 |
|----|------|------|
| M-01 | ProblemSpec.raw_problem_ref 闭合 DataArtifact | killed |
| M-02 | ProblemSpec.requirement_refs 闭合 RequirementSpec | killed |
| M-03 | ModelSpec.variable_refs 闭合 SymbolSpec | killed |
| M-04 | parameter_refs 嵌套 extractor 遍历每项 | killed |
| M-05 | RunArtifact.input_data_refs 闭合 DataArtifact | killed |
| M-06 | FigureSpec.data_refs 窄 union（非 ANY）| killed |
| M-07 | isAllowedTarget kind-union 成员检查 | killed |
| M-08 | store 在 commit 前调用 validateRefFields | killed |
| M-09 | raw_problem_ref role=RAW_PROBLEM（R-014）| killed |
| M-10 | input_data_refs role=INPUT_DATA（R-015）| killed |
| M-11 | variable_refs role=VARIABLE（R-016）| killed |
| M-12 | parameter_refs role=PARAMETER（R-016）| killed |
| M-13 | Requirement source == raw source（R-017）| killed |
| M-14 | SymbolSpec same-scope token 唯一 | killed |

M-14 首次运行 **SURVIVED**：`findDuplicateSymbolTokens` 只被
`redteam15.spec.ts` RT-D-01 间接覆盖，而重复 token 的 decomposed 拼写被
store 的 NFC refine 在 ingest 拦截，store 上永远无重复可达。按任务书规则
（survivor = missing test，不是"守卫本来就对"），新增直接单测
（`bridge-dedup.spec.ts` *M-14 — findDuplicateSymbolTokens is directly
load-bearing*）后重新击杀。

## CRITICAL escape 统计

- 尝试的 CRITICAL 级别逃逸：0 存活。
- 所有结构攻击在 store 边界被拒；所有语义攻击在 bridge 被拒；无任何
  攻击能同时通过 store 与 bridge 进入 DELIVERABLE。
