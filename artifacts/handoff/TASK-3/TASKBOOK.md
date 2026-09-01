# TASK 3 — Execution Provenance Gate（冻结版任务书 v1.0）

> **冻结状态**：本文档是 TASK 3 的边界契约。自提交（commit 见仓库历史）起，
> §1 Hard Scope / §2 禁止 / §3 冻结接口 / §4 不变量 / §7 fault corpus /
> §8 mutation 标准为**冻结内容**——实施 agent 不得在实施过程中修改边界；
> 若实施中发现冻结项不可行，必须停下并向任务书作者报告，由作者出 v1.1，
> 不得边开发边定义。
>
> 本文基于 2026-09-02 仓库实测事实编写：HEAD `2775ccf3e0`，paper-foundation
> 63 files / 775 tests 全绿，`CRITICAL_GATE_IDS` 已保留 `'execution'` 与
> `'provenance'`（delivery-policy.ts:49-50），`IR_KINDS` 现有 11 种 kind，
> TASK 2.1 的 `environment_hash` / `dependency_lock_hash` 指纹函数已在
> `evidence-freeze.ts` 落地。

---

## 0. 当前缺口（唯一核心问题）

系统已证明"**声明的证据链可信**"（TASK 2 结构绑定 + TASK 2.1 冻结审计），
但尚未证明"**Result 真的是代码执行产生的**"：

- **RISK-3.1 Result 可伪造**：agent 手写 `Result(value=0.731)` + 指向任意
  `code_hash` 的 `RunArtifact`，全部现有 gate 依然 PASS——因为所有 gate
  只推理声明态，不接触现实。
- **RISK-3.2 执行环境不可验证**：`environment_hash` /
  `dependency_lock_hash` 只证明声明未变，不证明执行时环境真实一致。
- **RISK-3.3 执行输出未纳入证据链**：stdout / stderr / 产物文件 /
  exit_status / runtime facts / seed / 执行时间戳均无证据地位。

TASK 3 闭合最后一环：

```
Claim --(TASK 2)--> Result --(1.5R closure)--> RunArtifact
                                                  |
                                            ExecutionRecord   ← 新增 canonical kind #12
                                                  |
                                       ExecutionVerifier (Replay)  ← 新增
                                                  |
                                          ExecutionAuditReport  ← 新增（独立审计）
                                                  |
                                  delivery gate `provenance`（已保留的 critical id）
```

## 1. Hard Scope（允许修改，闭表）

| 允许修改 / 新增 | 用途 |
|---|---|
| `src/ir/schema.ts` | 新增 `ExecutionRecord` 为第 12 种 canonical kind（IR_KINDS / IR_SCHEMAS / ID_FIELD_BY_KIND / IrObjectMap 同步） |
| `src/ir/refs.ts` | `IR_REF_FIELDS.ExecutionRecord`：`run_ref → RunArtifact`；`input_refs → DataArtifact`；`output_refs` 为 external locator（不入表，理由见 §3 决策 D6） |
| `src/ir/index.ts` | 导出新 schema / 类型 / execution 层符号 |
| `src/execution/`（**新目录**） | `capture.ts`（ExecutionProducer + hash pipeline）、`replay.ts`（Replay Verifier）、`audit.ts`（ExecutionAuditor，模式沿 `evidence-freeze.ts`）、`runner.ts`（ExecutionRunner seam + 默认本地进程 runner + 测试用确定性 fake） |
| `src/delivery/delivery-policy.ts` | **仅当**需要导出 `PROVENANCE_GATE_ID` 常量（复用已保留的 `'provenance'` id，不新增列表项） |
| `src/executor.ts` / `executor-service.ts` | **TASK 3 明确解除 TASK 2 的禁令**：允许接线 `enforceExecutionProvenance()`（在 `authorizeDelivery` 之前），并把 `provenance` gate 加入交付 gates 列表 |
| `tests/ir/*`、`tests/execution/*`（新）、`tests/executor-*` | schema/store 闭包、capture、replay、audit、E2E、红队、mutation |
| `artifacts/handoff/TASK-3/*` | 完整 handoff 包（§12） |

**不得触碰**：`packages/**` 其它包、`storage/**`、已有 11 种 kind 的 schema
语义（只增不改）、TASK 1.5R 闭合表既有行、TASK 2 的 discriminated union、
TASK 2.1 的 freeze/audit 语义。

## 2. 明确禁止

1. **禁止 tolerance / rounding / coercion**：`Result.value` 重算比对沿用
   TASK 2 冻结的 exact identity（`a === b`，`-0/+0` 塌缩，NaN 不可达）。
2. **禁止 repair / fallback**：执行证据缺失或漂移 → FAIL，绝不补写、绝不
   降级、绝不用声明态"修复"执行态。
3. **禁止解析 Claim.text / Result.name 之外的自由文本恢复数值**（呈现层
   原则延续）。
4. **禁止第二套 gate 系统**：provenance 门必须走既有 delivery-policy
   critical machinery（复用 `'provenance'` id）；禁止平行判定函数决定交付。
5. **禁止削弱前序不变量**：INV-1.5R-*、INV-2-A..H、INV-2.1-A..C 全部保持；
   全量回归（63 files / 775 tests 起步）不得转红。
6. **禁止新增 DataArtifact role**（output 产物保持 external locator +
   bytes hash，理由见 §3 决策 D6）；禁止改 DATA_ARTIFACT_ROLES 闭集。
7. **禁止 auditor 执行任何"信任生产者"的操作**：auditor 只读快照与记录、
   只通过 runner seam 重放；禁止 auditor 采信 capture 侧未重导的任何 hash。
8. **禁止在生产 runner 中无边界执行**：默认 runner 必须带 timeout、独立
   cwd（临时目录）、不继承交互式 stdin；生产配置必须显式启用。
9. **禁止把 capture 与 audit 实现为同一可变单例**（Producer ≠ Auditor，
   模块级分离 + 无共享可变状态）。

## 3. 冻结接口与架构决策

### D1 — ExecutionRecord 是 canonical IR kind（第 12 种）

进 `ModelingIr`（append-only、深冻结、store 闭包），不建平行 store。
理由：复用 TASK 1/1.5R 的存在性+kind 闭包与审计纪律；`run_ref` /
`input_refs` 在 commit 时闭合；freeze/audit 模式直接扩展。

### D2 — ExecutionRecord schema（冻结字段表）

```ts
export const executionRecordSchema = zod.object({
  execution_id: idSchema,              // 全局唯一
  run_ref: refSchema,                  // → RunArtifact（store 闭包）
  code_hash: sha256Schema,             // code_ref 字节的真实 sha256，须等于 RunArtifact.code_hash
  environment_hash: sha256HexSchema,   // = TASK 2.1 同一推导：sha256(canonicalJson({environment, seed}))
  runtime_fingerprint_hash: sha256HexSchema, // runner 实测运行时事实的 hash（D4）
  dependency_lock_hash: sha256HexSchema,     // = TASK 2.1 同一推导（D5）
  input_refs: zod.array(refSchema),    // → DataArtifact（store 闭包），须集合等价于 RunArtifact.input_data_refs
  output_refs: zod.array(refSchema),   // external locators，须集合等价于 RunArtifact.output_refs
  output_hash: sha256HexSchema,        // sha256(canonicalJson({ locator: sha256(bytes) }))
  stdout_hash: sha256HexSchema,        // 实际捕获 stdout 字节 sha256
  stderr_hash: sha256HexSchema,        // 实际捕获 stderr 字节 sha256
  exit_status: zod.number().int(),     // 由 runner 进程产生，禁止手填（Phase 1 强制路径）
  seed: zod.union([zod.number().int(), textSchema]).nullable(), // 须等于 RunArtifact.seed
  started_at: isoSchema,
  finished_at: isoSchema,              // 语义校验：finished_at > started_at（audit 类别）
}).strict()
  .refine(去重 input_refs / output_refs)
```

`sha256Schema = /^sha256:[0-9a-f]{64}$/`（对齐 DataArtifact.content_hash）；
`sha256HexSchema = /^[0-9a-f]{64}$/`。

### D3 — ExecutionRunner seam（执行唯一入口）

```ts
export interface ExecutionRequest {
  code: string                       // 从 code_ref 读到的字节（文本）
  entryArguments: readonly string[]  // runner 配置注入，模型不可控
  seed: string | number | null
  timeoutMs: number
  cwdSandbox: boolean                // 必须为 true（生产）
  environmentFactsCommands: readonly string[] // D4 的实测命令
}
export interface ExecutionOutcome {
  exitStatus: number
  stdout: string; stderr: string
  outputFiles: ReadonlyArray<{ locator: string; bytes: Uint8Array }>
  runtimeFacts: Readonly<Record<string, string>>
  startedAt: string; finishedAt: string
}
export interface ExecutionRunner { run(req: ExecutionRequest): Promise<ExecutionOutcome> }
```

- `capture.ts` 只接受 `ExecutionOutcome`（由 runner 产生）→ 构造
  ExecutionRecord（hash pipeline 全自动）。**不存在**绕过 runner 手填
  `exit_status` 的公共路径——这是 §5.2 禁令的机制化。
- 测试默认注入**确定性 fake runner**（同输入同输出，无进程）。
- 生产默认 `LocalProcessRunner`（node child_process）：timeout、独立临时
  cwd、捕获 stdout/stderr/产物文件、执行 environmentFactsCommands。

### D4 — 环境真实性 = 双重指纹

- **声明指纹**（对齐 TASK 2.1）：`environment_hash` /
  `dependency_lock_hash` 直接复用 `evidence-freeze.ts` 的推导函数——证明
  "声明与冻结一致"。
- **实测指纹**：runner 执行 `environmentFactsCommands`（如
  `['python','--version']` / `['node','-p','process.version']`），对输出
  canonical JSON 求 hash 得 `runtime_fingerprint_hash`。Replay 时重测并
  比对——**capture 与 replay 的真实环境漂移 ⇒ ENVIRONMENT_MISMATCH**。
  （声明==现实的深度 pinning——依赖清单约定——超出本任务，记 known-risks，
  由 runner 配置演进承担。）

### D5 — dependency_lock_hash 语义

沿用 TASK 2.1 推导（`input_data_refs + parameter_refs + assumptions`）。
capture 侧从 RunArtifact 所指 ModelSpec 重导；replay 侧同样重导比对。
（真实依赖锁文件的 hash 纳入属 TASK 4+，known-risks 记录。）

### D6 — output_refs 为 external locator + bytes hash

不新增 `DataArtifact.role=OUTPUT_DATA`：改 3 角色闭集需穿透全部消费者，
收益（引用闭包）与成本不成比例；且 output 的真实性已由
`output_hash`（bytes 级）+ replay 重导保证。产物文件字节由 capture 落盘
（runner 返回 bytes），replay 重读重导。

### D7 — Result.value 重算契约

输出文档（`output_refs[0]`）必须是 JSON。`Result.source_location` 的
`#fragment` 为该 JSON 的键路径（缺省回退 `Result.name` 顶层键）。
Replay 提取该键的 number，与 canonical `Result.value` exact equality。
提取失败（键缺失 / 非有限数）⇒ `OUTPUT_MISMATCH`。

### D8 — 交付门

- gate id：**`'provenance'`**（已在 `CRITICAL_GATE_IDS` 保留，零新增）。
- 判定：FORMAL/FAST 交付前，遍历 canonical snapshot 中**每一条**从
  CRITICAL Claim 链可达的 RunArtifact；任一缺失合法 ExecutionRecord 或
  任一校验失败 ⇒ BLOCKED（不可被合法 run 掩盖，快照驱动，非 artifact
  子集）。EXPLORATORY 豁免（对齐 backbone 豁免语义）。
- 接线：`WorkflowExecutor` 在 `authorizeDelivery` 之前执行
  provenance gate；gates 列表加入 `'provenance'`。
- 每次交付不强制重放（成本）；replay 由独立 auditor 调用（§Phase 3），
  且 PHASE 验收必须含真实重放通过。known-risks 记录"交付时点与最近
  replay 之间的陈旧窗口"。

### D9 — ExecutionAuditReport（冻结形状，对齐任务书 + 加法扩展）

```ts
interface ExecutionAuditReport {
  audit_id: string                       // 确定性：'EAUD-' + sha256(manifest|store digest)
  status: 'PASS' | 'FAIL'
  execution_checked: number              // 检查的 run 数（CRITICAL 链可达）
  failures: ReadonlyArray<{
    run_id: string                       // 加法扩展（对齐 2.1 的 claim_id 模式）
    execution_id: string | null
    category: 'CODE_MISMATCH' | 'ENVIRONMENT_MISMATCH' | 'OUTPUT_MISMATCH'
            | 'NON_ZERO_EXIT' | 'MISSING_EXECUTION'
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
    reason: string                       // 加法扩展（稳定审计文案）
  }>
  manifest_hash: string                  // 带外锚（沿 2.1 RT-E4 模式）
}
```

类别映射（闭集就 5 个，多余攻击全部归约）：
seed 漂移与依赖漂移 ⇒ `ENVIRONMENT_MISMATCH`（seed 在 2.1 推导内）；
伪造 stdout/exit ⇒ `OUTPUT_MISMATCH` / `NON_ZERO_EXIT`；重放分歧 ⇒
`OUTPUT_MISMATCH`。严重度沿 2.1 策略：CRITICAL 链 run 的
MISSING_EXECUTION / CODE_MISMATCH / OUTPUT_MISMATCH / NON_ZERO_EXIT ⇒
CRITICAL；ENVIRONMENT_MISMATCH ⇒ HIGH；非关键链 ⇒ MEDIUM（不翻盘）。
`status = FAIL ⇔ ∃ failure(severity ≠ 'MEDIUM')`。

## 4. 不变量（INV-3-A..H）

| ID | 不变量 |
|----|--------|
| INV-3-A | CRITICAL Claim 链可达的每个 RunArtifact 必须有 `run_ref` 闭合、指纹与冻结一致、`input_refs`/`output_refs`/`seed` 与 RunArtifact 集合等价的 ExecutionRecord |
| INV-3-B | 执行关键字段（exit_status / 各 hash / 时间戳）只可能由 runner capture 路径产生；伪造记录必被 replay 重导揭穿 |
| INV-3-C | Replay 契约：同 code bytes + 同声明指纹 + 同实测指纹 + 同输入 + 同 seed ⇒ 同 exit_status(=0)、同 stdout/stderr/output bytes hash、同 Result.value（exact） |
| INV-3-D | FORMAL/FAST 交付要求关键链 run 的 `exit_status === 0` 且 `seed !== null`（null seed 在关键链上不可交付） |
| INV-3-E | ExecutionAuditReport 用闭集类别 + 闭集严重度 + fail-closed 判定；auditor total（never throws） |
| INV-3-F | Producer ≠ Auditor：capture 与 audit 模块分离、无共享可变状态、manifest_hash 带外锚定；auditor 禁止采信未重导的 hash |
| INV-3-G | provenance 门快照驱动、穷举关键链 run、单一合法 run 不得掩盖非法 run；EXPLORATORY 豁免但不豁免 schema/store 闭包 |
| INV-3-H | 全链路无 repair / fallback / coercion；任何意外（runner 崩溃、时钟倒挂、缺文件）归约到闭集失败，绝不异常逃逸成交付 PASS |

## 5. PHASE 划分与 Gate

| Phase | 内容 | Gate |
|---|---|---|
| **PHASE 0** | 零改动拓扑侦察：RunArtifact 字段 producer/consumer 全景；executor 交付路径现状；baseline 复跑留档；产出 `phase-0-topology.md` + schema diff 提案 | **本任务书（v1.0）获用户批准后方可动 production** |
| **PHASE 1** | `ExecutionRecord` 第 12 kind：schema/refs/index + fixtures（`executionRecord()` 工厂 + 链扩展）+ schema/store 闭包测试 | happy fixtures 全绿 + ≥12 个 invalid fixtures 全红（含手填 exit_status 经由 capture-only 路径被拒、时间倒挂、重复 refs、sha256 格式错、run_ref 悬空） |
| **PHASE 2** | `src/execution/`：runner seam + capture hash pipeline + 确定性 fake runner；`input_refs/output_refs/seed` 与 RunArtifact 一致性校验 | capture 单测全绿；手写 record 绕过 capture 的路径不存在（代码评审 + 攻击证明） |
| **PHASE 3** | `replay.ts`：重放引擎 + runtime facts 重测 + `Result.value` 提取（D7）+ 逐项比对 | replay PASS 用例（确定性 fake + 真实 LocalProcessRunner 冒烟）+ 每类漂移 FAIL 用例 |
| **PHASE 4** | `audit.ts`（ExecutionAuditReport）+ provenance 交付门 + executor 接线 + execution 侧 freeze manifest（沿 2.1 带外锚模式） | audit 单测全绿；E2E：无记录 run 交付被拒、含伪造记录交付被拒、合法链交付 PASS |
| **PHASE 5** | 攻击套件 EX-01..EX-12（§7）+ 红队 4 角色（RT-X1 Capture Forger / RT-X2 Replay Saboteur / RT-X3 Provenance Omission / RT-X4 Gate&Workflow） | 全部攻击被拦截；CRITICAL escape = 0 |
| **PHASE 6** | Mutations P-01..P-08（§8） | **8/8 killed, 0 survived** |
| **PHASE 7** | 全量回归 + CLOSED C1..C10 逐条 + handoff 包（§12） | 12 项 CLOSED 全 PASS |

## 6. Replay PASS 条件（冻结，全部满足）

1. `code_hash` 一致（replay 重导 code_ref 字节）；
2. `environment_hash` 一致（声明指纹）；
3. `dependency_lock_hash` 一致；
4. `runtime_fingerprint_hash` 一致（实测指纹，D4）；
5. `exit_status === 0`（重放实测）；
6. `output_hash` 一致（重导产物字节）；
7. `stdout_hash` / `stderr_hash` 一致（重导流字节）；
8. 每条关键链 `Result.value` 与重放输出提取值 exact 相等（D7）。

## 7. Fault Corpus（EX-01..EX-12）

| ID | 攻击 | 期望 |
|----|------|------|
| EX-01 | Fake Result：改 `Result.value`（重放输出不变） | `OUTPUT_MISMATCH` / audit FAIL |
| EX-02 | Fake Run：`run_ref` 指向无 ExecutionRecord 的 run | `MISSING_EXECUTION` |
| EX-03 | Code Substitution：`code_ref` 不变但字节变 | `CODE_MISMATCH` |
| EX-04 | Dependency Drift：`dependency_lock_hash` 漂移 | `ENVIRONMENT_MISMATCH` |
| EX-05 | Fake Execution Log：伪造 stdout bytes / exit_status | `OUTPUT_MISMATCH` / `NON_ZERO_EXIT` |
| EX-06 | Replay Divergence：同 code+env 不同输出 | `OUTPUT_MISMATCH` |
| EX-07 | Seed Mismatch：record.seed ≠ RunArtifact.seed | `ENVIRONMENT_MISMATCH`（+ schema 一致性校验） |
| EX-08 | Partial Record：缺 stdout_hash / output_hash 的执行记录 | schema / audit 拒绝 |
| EX-09 | Time Inversion：`finished_at < started_at` | audit 拒绝（fail-closed） |
| EX-10 | Duplicate Execution：同 run 两条 record hash 不同 | audit 取证失败 ⇒ FAIL（快照穷举） |
| EX-11 | Omission：关键链某 run 完全无记录但其余合法 | `MISSING_EXECUTION`，交付 BLOCKED（不得掩盖） |
| EX-12 | EXPLORATORY 越权：无记录 + EXPLORATORY 模式携带非法 record | 非 FORMAL/FAST 不触发门，但 schema/audit 仍 fail-closed |

（EX-01..EX-06 为任务书强制项；EX-07..EX-12 为实施补强，冻结于本表。）

## 8. Mutation 标准（P-01..P-08，全部 killed）

| ID | 变异 |
|----|------|
| P-01 | Disable code hash check |
| P-02 | Disable output hash check |
| P-03 | Ignore exit status（NON_ZERO_EXIT 不触发） |
| P-04 | Ignore environment/runtime fingerprint check |
| P-05 | Skip replay（重放恒 PASS） |
| P-06 | Accept fake execution record（capture-only 路径旁路 / 记录完整性检查禁用） |
| P-07 | Ignore seed mismatch |
| P-08 | Ignore dependency drift |

要求 8/8 killed、0 survived；survivor = 缺测试（沿 1.5R 规则），补直接
单测，禁止以"守卫本来就没用"辩护。允许实施补强 P-09+，但 8 项为底线。

## 9. Independent Execution Auditor（沿 TASK 2.1 模式）

- read-only / no repair / no generation / no trust producer；
- `ExecutionProducer ≠ ExecutionAuditor`（模块分离 + 无共享可变状态 +
  带外 `manifest_hash` 锚）；
- auditor 通过 runner seam 调 replay（执行是审计的仪器，不是对生产者的
  信任）；auditor 输出的每个 hash 都是自己重导的。

## 10. 验收标准（CLOSED C1..C10，冻结）

| 编号 | 条件 | 证据归属 |
|---|---|---|
| C1 | ExecutionRecord 完整（第 12 kind、闭包、全部冻结字段） | schema/refs 测试 + store.spec 扩展 |
| C2 | 代码真实性验证（code bytes hash 重导一致） | replay 测试 + EX-03 |
| C3 | 环境真实性验证（声明指纹 + 实测指纹双重） | replay 测试 + EX-04/07 |
| C4 | 输入输出绑定（input_refs/output_refs/seed 与 RunArtifact 等价；output bytes hash） | capture/audit 测试 |
| C5 | Replay 成功（§6 全条件 PASS） | PHASE 3 gate + gate-report |
| C6 | Result 重算一致（D7 exact） | PHASE 3 测试 + EX-01 |
| C7 | 执行攻击全部拦截（EX-01..EX-12 + 4 红队角色） | PHASE 5 报告，CRITICAL escape = 0 |
| C8 | Mutation 全杀死 | P-01..P-08 = 8/8 killed |
| C9 | Independent Auditor 完成（INV-3-E/F） | audit 测试 + producer≠auditor 证明 |
| C10 | Regression 保持绿色 | 全量 ≥ 63 files / 775 tests 起步只增不减；TASK 1/1.25/1.5/1.5R/2/2.1 全绿 |

## 11. 时间计划（沿用规划书）

- **Week 1**：接口冻结（本文档）+ ExecutionRecord schema + invariant 文档
- **Week 2**：Execution Capture（runner seam、capture wrapper、hash pipeline）
- **Week 3**：Replay Verification（replay engine、provenance auditor、attack suite）
- **Week 4**：完整验证（gate report、mutation report、red team report、TASK 4 readiness review）

## 12. Handoff 包（冻结清单）

```
artifacts/handoff/TASK-3/
├── TASKBOOK.md                      ← 本文件（冻结版 v1.0）
├── phase-0-topology.md
├── summary.md / invariant.md / known-risks.md
├── gate-report.json（C1..C10 逐条）
├── execution-results.json / fault-results.json / mutation-results.json
├── redteam.md + redteam-rt-x1..x4.md
├── changed-files.txt / tests.txt / baseline-summary.txt
├── run-fault-corpus.mjs / run-mutations.mjs / generate.py（如需）
└── execution-freeze-manifest.json + hash report（带外锚）
```

## 13. Agent Directive（可直接复制）

```
Implement TASK 3 only: Execution Provenance Gate.

Goal: close the last gap — prove that every Result reachable from a
CRITICAL Claim's chain was actually produced by a reproducible execution
of the declared code, in a verified environment, with captured outputs.

Hard rules:
1. Do not weaken TASK 1.5R / TASK 2 / TASK 2.1 invariants or regressions.
2. ExecutionRecord is canonical IR kind #12; the store owns reference
   closure; capture owns producer-generated fields; replay owns re-derivation;
   the provenance delivery gate ('provenance', already reserved in
   CRITICAL_GATE_IDS) owns FORMAL/FAST completeness over ALL critical-chain
   runs.
3. No tolerance, no rounding, no coercion, no repair, no fallback —
   Result.value recomputation is exact identity.
4. Producer != Auditor: capture and audit are separate modules with no
   shared mutable state; the auditor re-derives every hash itself and
   anchors the execution manifest out-of-band (manifest_hash).
5. Replay PASS requires ALL of: code_hash, environment_hash,
   dependency_lock_hash, runtime_fingerprint_hash, exit_status==0,
   output_hash, stdout/stderr hashes, and exact Result.value equality.
6. One valid run must never mask an invalid one; the gate walks the
   canonical snapshot, not the artifact subset. EXPLORATORY is exempt
   from the gate, never from schema/store closure.
7. Every exploit becomes a regression before the fix.
8. Run EX-01..EX-12, four red-team roles, P-01..P-08 mutations (8/8
   killed), full regression and typecheck.
9. Produce the exact TASK-3 handoff package and stop.

First action: PHASE 0 zero-edit topology reconnaissance. No production
edits before the RunArtifact producer/consumer map and the frozen schema
delta are written down.
```

---

*冻结版本 v1.0 — 由实施 agent 依仓库实测事实起草，待任务书作者批准。
批准后 PHASE 0 立即启动；任何边界变更走 v1.1，不打断审计纪律。*
