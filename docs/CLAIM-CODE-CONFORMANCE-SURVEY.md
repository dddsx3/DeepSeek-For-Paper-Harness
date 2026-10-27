# 「方法声称 ↔ 代码实现」一致性校验：GitHub 调研与方案评估

> **编制**：2026-10-27。**性质**：S1 调研件——**未实施任何改动，等待用户裁决**。
> **触发**：2024B-mcgrox-1 实跑 stage 3 连续多轮死于 `claim_code_check`（不收敛）。

## 0. 问题实证（不是推测）

**现象**：stage 2（建模）在 `DECLARATION.json` 的 `method_claims_machine` 里声明了 must 签名
（本题为 `beta_posterior`、`clopper_pearson_interval`、`monte_carlo_replication`、
`fixed_point_iteration`、`topological_layer_recursion`）；stage 3 的代码实现了对应算法，但用
自己的命名（实测代码里有 `_beta_params`、`_posterior`，无上述 5 个字符串）。

**门禁判定**：`claim_code_check` 用 `safeSearch()`（正则/子串，`gates.ts:1521`）在**去注释后的
源码文本**里找签名 → 一个都找不到 → 硬失败。连续 6+ 轮 DRIFT 回灌后模型仍未改名。

**归因**：门禁判定在**字面上正确**（名字确实不在代码里），但**判据选错了层次**——用"文本是否
出现某个字符串"来代理"某个方法是否被实现"，两件事只在模型恰好同名时重合。

**开源界的共识（本次调研最硬的结论）**：所有成熟的同类工具都**先解析成 AST/符号表再比较**，
没有一个是文本子串匹配。文本匹配是这条门禁的根因缺陷，不是模型能力问题。

## 1. 候选方案总览

| # | 方案 | 代表实现（★/维护状态） | 解决什么 | 成本 | 与 DPH 契合度 |
|---|---|---|---|---|---|
| **A** | **AST 符号表 + 显式实现映射** | [pydoclint](https://github.com/jsh9/pydoclint)（231★，2026-10 活跃）、[darglint](https://github.com/terrencepreilly/darglint)（483★，2022 归档）、[vulture](https://github.com/jendrikseipp/vulture)（4.9k★） | 命名脱钩：把"名字是否出现"升级为"符号是否存在 + 映射是否声明" | **低**（Python 标准库 `ast`，~100 行） | **高**（与 IR 引用同一"声明→核验"范式） |
| **B** | **Stub-first / Fill-in-the-Middle 生成** | [AlphaCodium](https://github.com/Codium-ai/AlphaCodium)（4.0k★，测试优先流程）；FIM 训练范式（StarCoder/DeepSeek-Coder） | 从源头消除命名漂移：harness 出带契约名的函数骨架，模型只填函数体 | 中（改分片计划契约+简报） | 中（更接近 T2 向导制，但压缩模型自由度） |
| **C** | **符号执行契约验证（SMT）** | [CrossHair](https://github.com/pschanely/CrossHair)（1.3k★，2026-10-26 活跃；已接入 [Hypothesis](https://github.com/HypothesisWorks/hypothesis) 后端） | 绕过命名，直接验**行为**（pre/post 契约找反例） | 高（SMT、逐函数分析耗时） | 中低（数值代码穿透有限，见 §2.3） |
| **D** | **DbC 契约库 + 静态分析** | [deal](https://github.com/life4/deal)（919★，2025-11 活跃）、[icontract](https://github.com/Parquery/icontract)（419★，2026-01 活跃） | 函数级契约（运行时断言 + 部分静态检查） | 中 | 中（与已落地的声明式不变量扫描同族，但下沉到函数级） |
| **E** | 语义模式匹配 | [semgrep](https://github.com/semgrep/semgrep)（17.3k★） | 按模式找代码形态 | 中 | **低**（为任意模型代码写模式不可维护） |

## 2. 详评

### 2.1 方案 A：AST 符号表 + 显式实现映射（推荐）

**机制**（借鉴 pydoclint/darglint 的核心做法，而非照搬其功能）：门禁用 Python `ast` 解析
`code/*.py`，建符号表（所有 `def`/`class` 名，含私有与嵌套）；判定改为两级：

1. **直接命中**：must 签名在符号表里存在 → 通过（现状的正例路径保留）；
2. **映射命中**：模型在 `DELIVERABLES.json`（或 `RESULTS.md` 的机器块）里声明
   `impl_map: {"M4": ["_beta_params", "_posterior"]}`，门禁验证：① 映射里的每个符号在符号表
   里存在；② 该符号的函数体**非空壳**（不是 `pass` / `raise NotImplementedError` / 只有
   docstring —— 即 vulture 式"声明了但没实现"检测）；③ 映射覆盖率 100%（每个 must 组都有归宿）。
   缺映射 → 失败，但失败信息变成"请声明 impl_map"而非"请改名"。

**为什么这是最小且最正确的改动**：
- 它把判据从"文本巧合"换成"**声明 + 可核验的存在性**"——与 DPH 的 IR 引用（声明 id → store
  核验）、executor 的 capture/replay 是**同一个范式**，不是新发明；
- 确定性强、可复算、零误报风险（映射缺失是明确失败而非猜测）；
- 顺带修掉另一个真实缺陷：现在"签名出现"不排除空壳函数（`def beta_posterior(): pass` 能过），
  AST + 空壳检测补上。

**成本**：~100 行 TS（调用 python -c 跑 ast，或纯 TS 正则+缩进解析——推荐前者，与既有
`sympy-v7-check.py`/`invariant-scan.py` 同模式）；+2 个 spec；无新依赖。
**风险**：模型需要学"声明映射"（DRIFT 会教）；映射可能被滥用（声称 `_foo` 实现 `M4` 但
`_foo` 其实干别的）——缓解：要求映射条目带一句 evidence（函数 docstring 首行引用 claim id），
门禁校验 docstring 里出现 claim id（可核验、低成本）。

### 2.2 方案 B：Stub-first 生成

**机制**：stage 3 的分片计划先产出函数骨架（签名+docstring+类型注解，函数体 `raise
NotImplementedError`），模型按骨架填空。FIM 范式在代码模型里是成熟训练目标，AlphaCodium
证明"先结构后内容"的流程工程能显著提升一次通过率。

**收益**：命名漂移从结构上消失；声称与实现天然对齐。
**代价/风险**：① 竞赛建模代码常有模型自发的辅助函数结构，骨架约束过强会伤质量（与上限解放
架构 P2"约束按需"相悖）；② 分片计划契约改动面大（stage 3 简报、shard-declare、code-shard
全部受影响）；③ 骨架本身由模型生成时，命名仍可能漂移（需 A 兜底）。
**结论**：可作为 A 之后的**教学增强**（简报要求"先写函数清单再写实现"），不建议本轮改结构。

### 2.3 方案 C：CrossHair 符号执行

**机制**：函数写 pre/post 契约，CrossHair 用 SMT 探索执行路径找反例；还有 `diff_behavior`
（两实现行为差异）与测试生成能力。

**为什么不解决当前问题**：它验**行为**不验**命名**，而当前阻断是命名/映射问题；且本题代码大量
依赖 scipy/numpy（C 扩展），符号执行对 C 边界内的语义不可穿透，最需要验证的部分恰好是黑盒——
结果大概率是"无法判定"而非"通过/失败"。这与 LEAN-ASSESSMENT 的结论一致：**验证通道要匹配
断言形态**。
**保留价值**：若未来出现"纯 Python 的核心算法函数 + 明确数学契约"的场景，CrossHair 是比 Lean
便宜两个量级的行为级验证通道（触发条件同 LEAN-ASSESSMENT §5）。

### 2.4 方案 D：deal / icontract

**机制**：装饰器写 `@deal.pre/@deal.post`，运行期断言 + deal 的静态分析器可提前发现部分违反。
**与现状的关系**：我们已落地**建模级**声明式不变量扫描（`declared_invariant_scan`）；D 是
**函数级**同族能力。真正的增量在于"契约随代码走、运行即验"。
**风险**：契约由模型写（同样的"声明质量"问题）；装饰器侵入生成代码风格；与"代码只由模型
负责算"的分工有摩擦（契约错误会被误读为代码错误）。
**结论**：观察项，不进本轮。

### 2.5 方案 E：semgrep

为"任意模型代码"写模式不可维护（模型命名/结构自由度大），且模式本质仍是文本/语法匹配的
高级形态，没有解决"声明↔实现"的语义归属问题。**不采用**。

## 3. 推荐（待裁决）

**推荐：只采用 A，本轮落地。**

理由：① 直击根因（判据层次错位）；② 成本最低（无新依赖、~100 行、2 spec）；③ 与 DPH 既有
范式一致（声明→核验），不是引入外来架构；④ 不触碰模型自由度（B 的问题）也不引入不可判定性
（C 的问题）；⑤ 顺带补上空壳检测这一真实漏洞。

**建议的落地形态**（若批准）：
1. `scripts/py-symbols.py`：ast 解析 → `{defs: [{name, file, body_lines, docstring}], classes}`；
2. `gates.ts` 的 `claimCodeCheck` 增加映射通道 + 空壳检测（保留原直接命中路径）；
3. `briefing.ts`（stage 3）加一段：must 签名若与实现命名不同，必须在 `DELIVERABLES.json`
   声明 `impl_map`（含 evidence 引用 claim id）；
4. spec：直接命中/映射命中/映射缺符号/空壳函数/映射缺 evidence 五类用例 + 负对照；
5. 台账：DESIGN-DEBTS 新增条目，FEATURE-MATRIX 更新，demo 语料按 §9 检查。

**不推荐同批做 B/C/D**：B 待 A 验证后再评估；C/D 按 LEAN-ASSESSMENT 的触发条件挂起。

## 4. 需要用户裁决的点（S1）

1. **是否采用 A**（AST 符号表 + 显式 impl_map + 空壳检测）？
2. 若采用：映射声明放 `DELIVERABLES.json` 还是 `RESULTS.md` 机器块？（建议前者——它已是机器读
   契约文件）
3. 是否同时批准 B 的**轻量版**（仅简报教学"先列函数清单"，不改分片结构）？
4. C/D 是否登记为观察项（写入 DESIGN-DEBTS 的 deferred 区）？

## 5. 参考项目清单（本次调研依据，2026-10-27 实测）

| 项目 | ★ | 最近推送 | 与本题的相关性 |
|---|---|---|---|
| [pydoclint](https://github.com/jsh9/pydoclint) | 231 | 2026-10-11 | **A 的直接范本**：AST 比较 docstring↔签名 |
| [darglint](https://github.com/terrencepreilly/darglint) | 483 | 2022-12（归档） | A 的前身；归档说明"文本级检查已到天花板" |
| [vulture](https://github.com/jendrikseipp/vulture) | 4864 | 2026-10-12 | 死代码/未使用符号 → 空壳检测思路 |
| [CrossHair](https://github.com/pschanely/CrossHair) | 1341 | 2026-10-26 | C 的实现；SMT 符号执行 + hypothesis 后端 |
| [deal](https://github.com/life4/deal) | 919 | 2025-11-30 | D；DbC + 静态分析 |
| [icontract](https://github.com/Parquery/icontract) | 419 | 2026-01-29 | D；DbC 装饰器 |
| [hypothesis](https://github.com/HypothesisWorks/hypothesis) | 9113 | 2026-10-26 | 已用于我们的不变量扫描同族方法 |
| [AlphaCodium](https://github.com/Codium-ai/AlphaCodium) | 3968 | 2024-11 | B 的流程工程参考（测试优先） |
| [semgrep](https://github.com/semgrep/semgrep) | 17293 | 2026-10-27 | E；语义模式匹配 |
