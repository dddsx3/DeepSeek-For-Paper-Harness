# 跨阶段方法论索引（题型无关）—— 从参考实现提炼

> 姊妹文档：`FIGURE-METHOD.md`（作图那一层的骨架）。本文管**其余阶段**。
>
> 参考实现里每个阶段都带着一整套"**题型无关的机械闸 + 结构化契约**"。
> 它们的共同设计哲学写在每个脚本的 docstring 里，值得先记住：
>
> - **"宁可漏报，不可误报" / "宁漏勿误"**；
> - **退出码三态**：`0` 通过 / `1` 确凿错（必修、阻断）/ `2` **无据可查（跳过，不阻断）**；
> - **"全软失败"**：合同缺、文件缺、字段缺 → 该条跳过，**绝不误判为失败**；
> - 只有**零歧义铁证**才 HARD FAIL，语义判断一律降 WARN。
>
> 这套哲学是本仓库门禁的同一套（见 `gates.ts` 的 `0/1/2` 与各处"判别力优先"的注释）。

---

## 一、阶段 ↔ 参考资产对照表

| 我的阶段 | 参考 skill | 参考的机械闸（已迁入 `assets/stage-tools/`） | 参考的按题型资料（已迁入 `assets/stage-refs/`） |
|---|---|---|---|
| 1 题面分析 | `comp-prob-analysis` | `capability_check.py`、`data_ingest_check.py`、`data_profile.py`、`bib_authenticity_check.py` | — |
| 2 建模求解 | `comp-modeling` | **`logic_audit.py`**（七查）、**`modeling_coverage_check.py`**、`facts_audit.py --stage modeling` | `stage-refs/modeling/`（`SKILL.md` + `methods_table.md`）、`error_prevention.md`（107KB，**按题型索引**） |
| 3 编程实现 | `comp-code` | **`claim_code_check.py`**（must/forbid 签名）、`facts_audit.py --stage code`、`leakage_audit.py`、`delivery_audit.py`、`cross_problem_check.py`、`data_ingest_check.py` | `stage-refs/code/checks/*`（**按题型**：optimization / prediction / evaluation / physical / consistency / sanity_check）、`error_prevention_code.md` |
| 4 数源声明与铸数 | （comp-code 的一部分） | — | — |
| 5–6 图表 | `paper-figure` | `figure_check.sh`、`recipe_audit.py`、`fig_include_size.py` | `figure_recipes_*.md`（109 个） |
| 7 架构图 | `paper-figure-drawio` / `-html` | `drawio_check.py`、`tikz_check.sh` | `drawio_rules.md`、`tikz_rules.md` |
| 8 逻辑对抗复核 | `comp-review` | （它是**唯一的模型复核**，见第三节） | `stage-refs/review/SKILL.md` |
| 9–11 论文 | `comp-paper-zh` | `paper_claim_check.py`、`writing_check.sh`、`table_slim.py`、`normalize_cjk_quotes.py`、`stats_utils.py` | `writing_rules.md` |
| 12–13 格式与导出 | `format-profile` / `docx-format-check` | — | — |

---

## 二、四个**题型无关的结构化契约**（我原本完全没有，这是最该固化的部分）

参考把"模型口头保证"换成"**机器可核的声明**"。这四个契约是跨题稳定的关键——
它们的**格式固定，内容由每道题自己填**，所以换题不改代码。

### 1. `LOGIC_CONTRACT_MACHINE`（治"数值合法但逻辑错"）

写在 `MODELING_REPORT.md` 的 JSON 块里，或独立 `LOGIC_CONTRACT.json`。八个键：

| 键 | 治什么病 | 要求 |
|---|---|---|
| `bounds` | 方向反 | 凡"反解 / 取界 / 由删失封顶值反算"，必须走**方向推导四步**（不等号 → 代入 → 推界 → 数值验算） |
| `no_double_count` | 重复计量 | 任何"总量 = A + B"结构，若 A 的拟合已吸收 B，登记 `{aggregate, contains}` |
| `must_features` | 漏变量 | 把 `DATA_FACTS` 里 `role=observed` 的真实变量列进来 |
| `train_range` | 外推口吻过硬 | 直接抄实测区间；预测点超出太远 → 强制标"情景模拟" |
| `monotonic` | 目标符号写反 | `dir: better|worse` |
| `constraints_with_margin` | 顶格达标、零裕度 | `kind: le|ge` + 可选 `min_margin`。**优化题务必填** |
| `calibration_anchors` | 锚点比观测乐观 → 系统性高估能力 | `optimistic_dir: low|high`。**单点反解缩放参数务必填** |
| `equivalence_claims` | 声称"退化/等价"却数值对不上 | `{claim, quantity_a, quantity_b, rel_tol=0.02, explanation}`。**写下"退化/等价/一致/吻合"就务必登记** |

配套的**方向探针**（让数据替你验方向）：把被截断的输入朝真值方向推 δ 后重算，把变化符号写进
`results.json` 的 `logic_probes.bounds[].probe_delta_sign`。数学事实：**上界应随输入朝真值方向动而减小（sign<0）**，
下界相反。符号与 `claim` 矛盾 = 方向标反。

### 2. `METHOD_CLAIMS_MACHINE`（治"正文声称的方法，代码里没真实现"）

`MODELING_REPORT.md` 里的 HTML 注释块，一行一个方法：
```
<!-- METHOD_CLAIMS_MACHINE
M1 | must: LpInteger, cat=.Integer, GRB.INTEGER | forbid: linprog, 就近配车
-->
```
`must` = 代码里必须出现的实现铁证（命中任一即可）；`forbid` = 明令禁止的降级替代（**命中即判背叛**）。
`claim_code_check.py` 零方向知识逐条核。参考原话：*"每条走进正文的核心方法都要有一行机器签名"*。

### 3. `CROSS_PROBLEM_LEDGER.json`（治"跨问矛盾"）

```json
{"problems":[{"id":"Q1","conclusions":[
  {"quantity":"峰值浓度","value":3.2,"kind":"peak","imposes":{"on":["Q2"],"must_le":5.0,"note":"为何约束下游"}}]},
 {"id":"Q2","observed":{"峰值浓度":4.1}}]}
```
`cross_problem_check.py` 自动对撞，越界即报。参考原话：*"这是唯一负责'跨问对撞'的环节，别省。"*
另有兜底告警：同名量跨问相对差 > 5% → WARN。

### 4. `DATA_FACTS.json`（题面给定值的权威台账）

`variables[]` 的 `role` 三分：`observed`（真实测量值，下游必须当自变量用）/ `setpoint`（设定值，**禁止当"识别出的真实值"**）/ `assumed`（无数据靠假设）。
`given[]` 铁律：`constant` 数值一字不改、`formula` 结构一字不改、`acts_on`（作用对象）不许挪位。

---

## 三、建模阶段的"七件套"输出规范（题型无关，但内容按题填）

参考要求建模报告里必须有这七件**结构化**的东西（缺任何一项不能结束）。它们的价值在于
**把编码阶段的自由度压到零**——参考原话：*"编码阶段是纯执行者……因此建模阶段必须把所有决策做完"*。

| # | 件 | 关键要求 |
|---|---|---|
| ⓪ | **参数口径表** | 同一物理量全篇**只能有一个定义值和一个语义标签**；换算冲突必须当场统一 |
| ① | **结果约束清单** | 每条用**一行 Python lambda 或显式公式**表达（不许模糊自然语言）；动态派生量禁止简化成常数 |
| ② | **预期行为描述** | 时间尺度 / 稳态特征 / 瞬态特征 / 单调性与对称性 |
| ③ | **异常处理预案** | 每种异常**只给一种**修正方法（不留选择空间）+ 禁止的替代方案 |
| ④ | **方法唯一性声明** | 预处理/滤波/插值/去趋势/异常值/特征工程/求解器参数/随机种子——**逐个定死** |
| ⑤ | **验证检查点** | 编码阶段必须执行的 pass/fail 清单，fail → 跳哪个预案 |
| ⑥ | **结构性验证输入** | 约束活跃性预期 / 决策变量合理区间 / **灵敏度方向表** / 稳定性预期 / 资源利用率预期 |
| ⑦ | **方法声称清单** | 散文表 + `METHOD_CLAIMS_MACHINE` 机器签名 |

参考的硬规则原文：*"如果建模报告没有精确指定某个环节的方法和参数，编码阶段**不得自行选择**。
必须视为建模未完成。"*

---

## 四、`logic_audit.py` 的七查（题型无关的机械闸）

| # | 查什么 | 判据 | 等级 |
|---|---|---|---|
| 1 | 外推 | 预测点超出 `train_range`（或 `DATA_FACTS.variables[].range`）**0.5 倍区间宽** | WARN |
| 2 | 特征完整性 | `must_features[]` 里每个字符串在 `code/*.py` 里**一次都没出现**（词边界） | **FAIL** |
| 3 | 重复计量 | `no_double_count[]` 的 `{aggregate, contains}` 在**同一行**同时出现且有 `+` | **FAIL** |
| 4 | 方向/界 | `bounds` 探针符号与 `claim`（upper/lower）矛盾 | **FAIL** |
| 5 | 裕度 | `constraints_with_margin` 算出的 margin ≤ 1e-9（顶格）或 < `min_margin` | **FAIL** |
| 6 | 自洽 | `equivalence_claims` 两量相对差 > `rel_tol`（默认 0.02）**且无有效解释** | **FAIL**（有解释 → WARN） |
| 7 | 校准锚点 | `calibration_anchors` 的锚点比观测区间更乐观（`low` 且低于下界 / `high` 且高于上界） | WARN |

⚠️ **"有效解释"只认非空字符串**——数字 `0` / `false` / 空列表这类"伪解释"不算解释，仍判 FAIL。

---

## 五、逻辑对抗复核（阶段 8）：参考的**六类缺口**与回滚协议

参考把这一步定位为"**自查看不见的那一类错的唯一防线**"，原话：

> *"建模/编程用的是同一个'心智模型'……**自查时用的还是那个反的脑子，永远看不见**。"*

**六类缺口**（逐条要求"给出具体代码行/具体数值当证据，不泛泛而谈"）：

1. 方向/界反没反（核 `bounds`，代入观测值验不等号）——*"确定性闸抓不到、最需要独立视角"*；
2. 重复计量（"总量 = A + B"，查 A 的拟合是否已吸收 B）；
3. 外推口吻过硬（预测点落在观测区间外，正文却用确定性口吻）；
4. 漏真实变量（`role=observed` 的关键变量是否都进模型）；
5. 跨问矛盾；
6. **任务理解 vs 题目原文** —— *"⛔ 最该由你独立视角兜的一类"*、*"这是'赛题读歪'唯一的独立防线……下游所有确定性闸都只核'是否忠于建模者的理解'，核不了'理解本身对不对'"*。
   **发现"任务读歪/目标搞错"属 `fatal`（方向全错，回炉重来）。**

**结构化结论**（`COMP_REVIEW_VERDICT.json`）：
```json
{"findings":[{"category":"bound_direction|double_count|extrapolation|missing_feature|cross_problem|task_misread",
  "severity":"fatal|major|minor","where":"文件:行 或 数值","evidence":"...","fix":"..."}],
 "fatal_count":0}
```
**回滚规则**：`fatal_count > 0` → **必须回上游修正后重跑，不许进论文撰写**；`major/minor` 不硬拦，
但*"必须在论文里如实标注为'情景模拟/假设'，**禁确定性口吻**"*。

**诚实天花板**（参考自己写的）：*"本复核 AI 与答题同源，有共同盲区，显著降漏网率但非万无一失。"*

---

## 六、跨题迁移的验收（与 `FIGURE-METHOD.md` 同一条纪律）

换题后**不改任何规范与门禁**，只改两样输入（阶段 1 的清单、账本里的 id）。四条验收：

1. **骨架未变**：每阶段的"结构化契约 + 机械闸"一步不少；
2. **规范里没有题目名词**（`figure-migration-stability.spec.ts` 已在管作图那一层，其余阶段同理）；
3. **按题型资料以"查表"方式进入**：`error_prevention.md`（按题型索引）、`stage-refs/code/checks/*`（按题型）、`figure_recipes_*`（按图型）——**它们是被查的资产，不是被写进契约的规则**；
4. **门禁误报率**：同一套门禁在第二道题上仍"只拦真问题"。
