# 首次真实产出实测报告（baseline-1 ~ baseline-4）

> 2026-09-21。用户批准"开始实测"后的四次完整真实运行（T1 / strict / fail-soft，
> 模型钉 `deepseek/deepseek-v4-pro`，输出预算 150k）。**结论：四次全部落在
> `B-e1-direct`（退化交付），未达 `A-produce-chain`；每次运行都暴露一个真实缺陷，
> 已修 4 类；第 4 次还暴露了一个必须优先修的严重缺陷（见 §4）。**

---

## 1. 四次运行总览

| 运行 | 路径 | 阻断点（逐次后移） | 修法 |
|---|---|---|---|
| baseline-1 | B-e1-direct | B3 正向：`参数为(p)的` vs `参数为p的`（括号）+ 半/全角逗号 → 三次全拒 | `foldForAnchorMatch` 增加标点归一 + 括号剥离；**旧断言"丢括号是内容差异"被真实证据推翻并显式记录** |
| baseline-2 | B-e1-direct | ① 容器被 ```json 围栏包住 → parse_failed（3 次里 2 次）② 代码把 `S-P1` 当裸对象键 → 语法错 → 无产物 → OUTPUT_SET_MISMATCH | ① `parseModelContainer` 剥一层围栏（内容仍须合法）② 教学：键含 `-` 必须加引号；诊断：mismatch 携带退出码 + stderr 尾 |
| baseline-3 | B-e1-direct | attempt 1 结论数字拒绝；attempt 2/3 `conflicting_id`（重试重发整容器，27/42 条同 id 内容不同——多为 `token p_1→p1` 写法差异）→ 重试死循环 | 同 run 内**首次声明为准**：重复 id 跳过并审计（superseded），保留 id 仍硬拒 |
| baseline-4 | B-e1-direct | ① 缺 `__dsh_paper` 版本标记 ② `CONFIG_EMISSION_TOKEN_UNRESOLVED`（链上）③ attempt 3 保真 B3 反向失败（E1 9 条假设未全声明）④ **交付物是题面原文** | ④ 已修（见 §4，结构守卫）；①②③ 待办 |
| baseline-5 | B-e1-direct | 同 ①②③ 量级（链上） | **交付物已恢复正常**：`# 建模分析稿（E1 直通交付）`，19 章，5 处占位 |
| baseline-7 | B-e1-direct | attempt 3 **跑通全链**（保真全过、代码执行、4 Result + 4 CRITICAL Claim，三闸门转绿）→ 报告渲染拒（结论 29/6/76/12 vs 运行 2/2/15/1） | 见 §7：终结理由入审计 + 内容类拒绝归 DRIFT + 预算按原因 + 重试可再执行 |
| baseline-8 | B-e1-direct | 同上，收敛中（保真 4 条→1 条→全过），仍卡在结论数字（`R-OPT-COST` 缺 `-25`） | 见 §7⑤：结论可**点名** `{<result_id>}`，由 harness 注入值 |
| baseline-6 | B-e1-direct | ① EXECUTE attempt 1 **被 runner 超时杀掉**（exit -1 / SIGTERM / 空 stderr / 无产物）② attempt 2 重声明 RunArtifact 撞 `duplicate_id` → 链上死路 | 见 §5：声明后置 + 超时诊断 + 预算可配；20 章、0 占位 |

**进展是真实的**：保真门从"每次全灭"（baseline-1/2）→ "每次全过"（baseline-3/4），
阻断点从保真层后移到链上（配置发射、结论数字）。但离 A-produce-chain 仍有距离。

## 2. 各次运行的交付物形态

| 运行 | 章节数 | 占位符 | 字节 |
|---|---|---|---|
| baseline-1 | 19 | 5 | 20,426 |
| baseline-2 | 19 | 5 | 18,544 |
| baseline-3 | 20 | 5 | 30,246 |
| baseline-4 | **2** | 0 | 10,435 |
| baseline-6 | 20 | 0 | 38,337 |
| baseline-7 | 20 | 0 | 20,183 |
| baseline-8 | 21 | 0 | 24,334 |

交付包（report.md / sha256.txt / run-report.json / deliverable.zip）与 attempts 归档：
`artifacts/handoff/baseline-{1..4}/`、`baseline-{1..4}.console.log`、`baseline-4.attempts.json`。

## 3. 待办（下一轮，按优先级）

1. **§4 的严重缺陷**（最高优先）。
2. `CONFIG_EMISSION_TOKEN_UNRESOLVED` 的拒绝理由没有进审计（只记了 code），
   模型看得到、事后核不了 → 按"模型可见 ⟺ 已记录"补 reason 到 provider_retry 审计。
3. 缺 `__dsh_paper` 版本标记：教学已写容器形状，但模型仍漏 → 考虑在 E2 提示里
   把容器首字段单独成行强调。
4. `no_placeholders` 预检已能正确拒绝退化稿（baseline-1 实测被拒）——这是**该闸门
   价值的直接证据**：退化稿不得当竞赛论文交付。

## 4. ✅ 严重缺陷已修（baseline-4 发现，baseline-5 验证）

**baseline-4 交付的 `report.md` 是题目原文**（`# 2024 年高教社杯…` + 题面 + 题面表 1），
末尾接 `## 附录：交付标注（自动生成）`（MARKED 附录）。这**不是** E1 分析稿
（E1 本体是 4255 字的合格分析，已落盘在 `paper_artifact_body.json` 的 `E1Analysis`）。

性质：**形态 1 假绿**——交付物看起来是一份文档，实际是题面复制，既不是论文也不是
分析稿。预检闸门会拒绝它（无 12 章骨架），但**交付动作本身就不该promote非论文内容**。

已知线索：
- `e1DirectFallback` 正常渲染 E1 到骨架（e1-direct.ts），baseline-4 的审计里
  `e1_direct_delivery` 也确实记了 `e1_chars: 4255`；
- 交付文本取的是 `current`（delivery-grade.ts 处的 `deliverableText`），来自交付流
  最后一个节点的文本——怀疑 EXECUTE 失败后 review/revise 链把题面文本带到了终点
  （同类现象在历史 persist 目录 `paper-shell-persist-7nqJcf` 也能看到：body 文本即题面）。

**根因**：交付流的 `current` 在 revise 轮被**编辑器输出直接覆盖**，而编辑器拿到的
提示里含 `Task: <题面>`，它把题面当 "corrected text" 返回 → 题面成了交付物。

**修法（已落地）**：新增纯函数 `revisionDestroysDraft(draft, revised)`——修订必须
保留草稿**全部章节标题**且篇幅不得塌缩到一半以下；违反则**拒绝该次修订**（保留上
一版）并审计 `RevisionRejected`（绝不静默）；编辑器指令同时收紧为"返回完整修订稿、
保留全部章节、绝不返回题面"。

**验证**：baseline-5 交付物已恢复为 `# 建模分析稿（E1 直通交付）`（19 章，5 处占位，
不再是题面）；3 条单元测试（题面冒充 → 拒 / 塌缩 → 拒 / 正常修订 → 接受）。

**残留**：5 处占位 → 预检 `no_placeholders` 正确拒绝导出（退化稿不得当论文交付）。

---

## 5. baseline-6：链上死路（超时 + 幻影声明）已修

baseline-6（20 章 / 0 占位 / 38,337 B）交付物形态是合格的，但**仍然落在
`B-e1-direct`**。审计（`paper_audit.json`，126 事件）给出的两个阻断点：

```
provider_retry #43  OUTPUT_SET_MISMATCH  attempt 1
  "runner produced [] but RunArtifact.output_refs declares
   [sampling_results.json, numeric_config.json]；runner exited -1
   （代码很可能有语法/运行错误：先修代码，再核对声明输出）"
provider_retry #81  run_declaration_refused  attempt 2
  "duplicate_id: id '<runId>' is already registered as RunArtifact"
→ e1_direct_delivery: "EXECUTE output refused 3 times"
→ gate_failed: ir_canonicalization（无 Result/Claim）+ stale_detection
   （EXECUTION_MISMATCH）+ requirement_coverage（0/1 CRITICAL result）
```

### 5.1 诊断一：attempt 1 不是语法错，是被**超时杀掉**

`exit -1` + **空 stderr** + **零产物** 三个事实合起来排除了语法错（语法错会带
stderr 尾）。本地用真 runner 复现（`timeoutMs: 400`，子进程 `setTimeout(…, 5000)`）：

```
[trace] runner: spawned pid=632
[trace] runner: child exited exitStatus=-1 signal=SIGTERM
[trace] runner: declared output 'result.json' was not produced
{"exitStatus":-1,"signal":"SIGTERM","files":0,"stdout":"","stderr":""}
```

**与 baseline-6 attempt 1 的签名逐字一致**。而 `produceRun.timeoutMs` 当时硬编码
**60s**——一道 2024-B 的建模程序（抽样方案 + 16 策略枚举 + 多工序递归 + 贝叶斯）
超 60s 完全正常。旧诊断把"被杀"写成"语法/运行错误"，**把模型指向了错误的修法**，
attempt 2 于是带着正确代码撞上第二堵墙。

### 5.2 诊断二：失败的尝试在 store 里留下**幻影 RunArtifact**

`produceRunExecution` 原本**先声明 RunArtifact 再跑代码**（capture 要从 store 读声明）。
于是 attempt 1 被超时杀掉后，store 里留下一份"声称执行成功、带两个产物"的 RunArtifact：
- attempt 2 重声明同 id → `duplicate_id`（假失败：被拒尝试的状态不是权威）；
- `deriveDirectStale` 对"有 RunArtifact 无 ExecutionRecord"判 `EXECUTION_MISMATCH`
  → **永久 STALE**，无论后面重试成功多少次都清不掉。

### 5.3 修法（已落地并测试）

1. **声明后置**（`execution-producer.ts`）：先**预校验**声明（closed schema + 引用闭包，
   `preValidateRunDeclaration`），再跑代码，**跑成了才声明 + 提交 ExecutionRecord**。
   声明里的 `output_hash` 用记录里**实测**的哈希（调用方没预测时）。
   失败的尝试现在**一个字节都不写**，store 原样不动 → 重试不再被毒化，STALE 不再产生。
   `captureExecution` 新增 `runDeclaration` 入口：校验项**逐条不变**（code_hash / 输出集 /
   model 解析），只是声明的来源从 store 换成调用方——模型依旧给不出这些字段。
2. **超时诊断说事实**（`runner.ts` + `capture.ts`）：`ExecutionOutcome` 新增 `signal`；
   被信号杀掉时拒绝理由写成 `runner KILLED the child with SIGTERM after Nms … wall-clock
   budget (Xms) … 超时被杀，不是语法错误`，并给出可执行的修法（缩小计算、**先写产物
   再算昂贵部分**）。runner 的 phase trace 尾巴同时挂进拒绝理由（spawn 成功与否可见）。
3. **预算可配且可见**（`cli.ts`）：`PAPER_CODE_RUN_TIMEOUT_MS`，默认 60s → **300s**；
   生效值写进 `run-report.json` 的 `code_run_timeout_ms`。
4. **教学补一条**（`executor.ts`）：代码必须在 runner 的墙钟预算内跑完，且**先写产物**。

**测试**（`tests/produce/execution-producer.spec.ts`，10 条全过）：真子进程被预算杀掉 →
理由含 `KILLED the child with SIGTERM` / 含预算毫秒数 / **不含**"语法/运行错误"；
失败尝试后 `ir.size` 不变且无 RunArtifact；崩溃一次后重试（baseline-6 形状）**真的跑起来**
并落 1 个 RunArtifact + 1 个 ExecutionRecord、STALE 干净；同 id 再执行 → 在跑之前就被拒。

**仍开放的**：若某次尝试**跑成功了**、却在更后面的阶段（图/结论）失败，则该 run 的声明
已落盘，重试无法再声明同 id（store 追加写，一个 run id 对应一次执行）。这一路目前
**没有真实证据**，先不猜；baseline-7 若撞上，按证据再修。

---

## 6. baseline-7 / baseline-8：链上三闸门转绿，卡在"结论数字"这一处

### 6.1 baseline-7（第七次）

`B-e1-direct` / MARKED，但**链条第一次真的走通了**：attempt 3 通过全部保真检查
（5 条 FidelityFinding 全 ok）、代码真的执行、铸出 4 个 Result + 4 条 CRITICAL
Claim。审计里 **`gate_failed` 一次都没有**——baseline-6 的三个阻断闸门
（`ir_canonicalization` / `stale_detection` / `requirement_coverage`）全部转绿。

真正终结这次运行的是**报告渲染**：

```
provider_retry #90  conflicting_conclusion_number  attempt 3  w4Class DRIFT
  "report render refused: conclusion claim for 'R-OPT-COST' does not state
   the Result value -25 verbatim"
```

本地把模型代码跑了一遍（`results.json` = `{"n1":2,"c1":2,"n2":15,"c2":1}`），
而结论写的是「情形(1)最小样本量为 29，临界值为 6」。**D4 数字闭环拒绝得完全正确**：
论文里的数字必须是运行算出来的。但当时有三件事错了（见 §7 修法）：

1. 终结理由只剩 `"EXECUTE output refused 3 times"`，真正原因（哪个 Result、哪个值）
   永久丢失；`e1_direct_delivery.failedRules` 还是**上一次**尝试的 `B3 正向`，误导。
2. 这条内容类拒绝没进 `DRIFT_CODES`，落到 `TRANSPORT` —— 既没有针对性纠错提示，
   也没有预算，模型永远听不到"哪个数字不对"。
3. DRIFT 预算是**按 run 计**的，被前两次保真尝试花光；即使有预算，attempt 3 已是
   循环上界（3），跑通了也来不及纠正。

### 6.2 baseline-8（第八次，修完上面三条之后）

诊断能力立刻兑现——审计里第一次出现**完整**的拒绝理由：

```
#14  E1_E2_FIDELITY_VIOLATION attempt 1  reason: B3 正向 … E-REJECT-PROB:
     span「=0.05，即：PX>c\mid」vs E1「=0.05，即：\[PX>c\m」相似度 73.0%；
     E-ACCEPT-PROB: span「对于情形2，…」vs E1「对于情形1，…」相似度 81.5% …
#23  E1_E2_FIDELITY_VIOLATION attempt 2  reason: 只剩 1 条 span（收敛中）
#90  conflicting_conclusion_number attempt 3  w4Class DRIFT
     reason: conclusion claim for 'R-OPT-COST' does not state the Result value -25 verbatim
```

attempt 1 → 2 的保真违规从 4 条降到 1 条（**纠错提示确实在收敛**），attempt 3
保真全过、跑通链条、再次卡在结论数字上；attempt 4 模型在改结论时**回退**到保真
违规（B3 反向+正向），而这条原因的预算已在前两次用完 → `DRIFT guidance budget
exhausted` → E1 直通。

**两次运行指向同一个根因**：结论里的数字必须由模型**逐字写出**，而结论是在代码
运行**之前**写的——模型被要求预测自己代码的输出。这不是模型不听话，是契约本身
在要一个不可能的东西：baseline-7 写 29/6/76/12，它自己的代码算出 2/2/15/1；
baseline-8 少写了负号。两次都已经通过了其他所有检查。

## 7. 修法（已落地并测试）

1. **预算按原因计**（`runKey:failure.code`），并给生产型 EXECUTE 单独的尝试上界
   （5）——它的拒绝是**分阶段**到达的（parse→schema→保真→跑码→渲染），每次纠一个。
   其他节点仍用 `policy.maxNodeAttempts`；同因熔断器仍然拦"同一份输出同样被拒"。
2. **终结理由带最后一次拒绝的 code+message**（熔断 / 预算耗尽 / 重试耗尽三条路径
   都带）；保真检查**通过时清掉** `#receiveFailures`，链上拒绝写入自己的
   code+reason —— 交付说明里写的就是真正终结这次运行的原因，不再是上次的。
3. **内容类拒绝归 DRIFT**（`conflicting_conclusion_number` /
   `figure_declaration_invalid` / `figure_data_invalid`）：容器形状正确、内容与 IR
   矛盾，正是 DRIFT 的定义；`driftCorrection` 会把渲染器原文交给模型。
4. **重试可以再执行**（这是最致命的一条）：链上铸出的每个 id 按 attempt 作用域
   （attempt 1 保持原样、字节级不变；重试加 `-a<N>` 后缀），解释块内部引用同步改写，
   报告只渲染本次 `run_ref` 的 Result，交付文本用 `displayIdOf` 去掉后缀。此前
   "跑通了但结论写错"永远无法纠正——重试声明直接撞 `duplicate_id`，只能退到 E1 直通。
5. **数字可以"点名"而不必"抄写"**（契约层面的修正）：结论文本里写
   `{<result_id>}`，harness 在渲染时把该 Result 的值注入进去。数字于是**按构造**
   来自 IR，而不是来自模型的算术。字面数字的规则不变（必须等于绑定值），
   无法解析的名字是**拒绝**（否则会把花括号印进论文）。教学里也写明了
   "结论在运行前写，所以你无法知道输出值——点名，不要猜"。

**测试**：`executor-authoritative.spec`（8 条）新增"重试在一次真实执行之后收敛"
——attempt 1 跑通被拒、attempt 2 再执行并交付，两次真实执行各留一份
RunArtifact+ExecutionRecord，交付文本含真实数字且不含 `-a2`；以及"终结理由带
拒绝码与那个数字"、"provider_retry 的 code/w4Class/reason 可核"。
`report-v2.spec` 新增 5 条（点名渲染 / rounded 渲染 / 名字不在声明集 → 拒 /
散文结论点名 / 点名不放宽字面数字守卫）。全量 1589 条通过。
