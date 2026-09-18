## 汇总（两个样本合并）

待检条目总数：81（AssumptionSpec 39 + EquationSpec 42）

| 类别 | 条数 | 占比 |
|---|---|---|
| 精确匹配（harness 的裸 includes 即通过） | 56 | 69.1% |
| 未声明 e1_span（字段缺失） | 19 | 23.5% |
| 标点/全角/markdown 差异（折叠后匹配） | 4 | 4.9% |
| 标点/全角/markdown + 空白差异（全部折叠后匹配） | 1 | 1.2% |
| 真改写（折叠标点与空白后仍不匹配） | 1 | 1.2% |

**harness 失败条目（B3 正向未通过）的归因**

- harness 报"找不到逐字匹配（疑似改写）"的条目：6
  - 其中**纯机械差异**（空白/标点/全角/markdown 折叠后即命中）：**5**
  - 其中**真改写**（折叠后仍不命中）：**1**
- harness 报"未声明 e1_span"的条目：19（不是改写，是字段缺失——另一类失败）
- harness 报"e1_span 过短"的条目：0

**机械差异占 harness 全部失败条目的比例**：5 / 25 = 20.0%
**机械差异占"疑似改写"条目的比例**：5 / 6 = 83.3%

**harness 判定 × 实际类别 交叉表**

| harness 判定 | 精确匹配（harness 的裸 includes 即通过） | 标点/全角/markdown + 空白差异（全部折叠后匹配） | 标点/全角/markdown 差异（折叠后匹配） | 真改写（折叠标点与空白后仍不匹配） | 未声明 e1_span（字段缺失） |
|---|---|---|---|---|---|
| PASS | 56 | 0 | 0 | 0 | 0 |
| e1_span 在 E1 中找不到逐字匹配（疑似改写） | 0 | 1 | 4 | 1 | 0 |
| 未声明 e1_span | 0 | 0 | 0 | 0 | 19 |

## 样本 fresh-1 — 本次新跑的 E1 全文

- E1 来源：本次探针第 1 次真实 E1 调用（与生产同构的 prompt）
- E1 长度：19190 字符
- E2 输出：HTTP 200，finish=reused-from-disk，51403 字符，JSON 可解析=是
- 待检条目（AssumptionSpec + EquationSpec）：35

| id | kind | span 前 60 字符 | 精确? | 空白归一化? | 标点归一化? | 折叠后 8-gram 覆盖 | 原始 LCS 比 |
|---|---|---|---|---|---|---|---|
| ASSUMPTION_A1 | AssumptionSpec | `批量 $N$ 足够大，抽样比 $n/N \le 0.1$，用二项分布近似超几何分布` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A2 | AssumptionSpec | `检测本身**无误差**（检测出的次品确实是次品，检测通过的确实合格）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A3 | AssumptionSpec | `备择次品率 $p_1$ 的选择（情形 1 取 0.20、情形 2 取 0.05）是建模选择，需做敏感性分析` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A4 | AssumptionSpec | `只做一次抽样（不采用二次/序贯抽样）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A5 | AssumptionSpec | `各决策变量在生产过程中全局固定（同一批次内不随时间变化）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A6 | AssumptionSpec | `检测无误差（与问题 1 的 A2 一致）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A7 | AssumptionSpec | `拆解不损坏零配件，拆解出的零配件 1、零配件 2 均可完整回收并重新进入流程（题目给定）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A8 | AssumptionSpec | `市场需求充足，所有合格品都能售出；不合格品退回率 100%（消费者一定会退回次品）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A9 | AssumptionSpec | `调换损失 $L$ 是"除调换次品之外的损失"，即企业除了重新给一件合格品外，还额外损失 $L$` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A10 | AssumptionSpec | `零配件次品率、成品次品率相互独立` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A11 | AssumptionSpec | `$y=0$ 时，退回的次品与厂内检测出的次品同样适用拆解决策 $z$` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A12 | AssumptionSpec | `多道工序之间，半成品的次品率定义按附录（1）——"将正品零配件（或者半成品）装配后的产品次品率"` | 否 | （已通过） | 是 | 0.829 | 0.542 |
| ASSUMPTION_A13 | AssumptionSpec | `不合格半成品的拆解决策独立于不合格成品的拆解决策（各有自己的 $z$）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A14 | AssumptionSpec | `不合格半成品拆解后，其组成零配件全部可回收（不区分零配件是否损坏）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A15 | AssumptionSpec | `成品退回后的处理与厂内检测出的不合格成品处理一致（同一 $z_f$）` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A16 | AssumptionSpec | `各次品率的抽样独立进行，后验分布独立` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A17 | AssumptionSpec | `先验分布取 $\text{Beta}(1,1)$（均匀先验），表示抽样前对次品率无信息` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A18 | AssumptionSpec | `抽样检测的费用按问题 1 的方案计算，计入总成本（这一点题目说"检测费用由企业自行承担"` | 是 | （已通过） | （已通过） | 1 | 1 |
| ASSUMPTION_A19 | AssumptionSpec | `观测次品数 $x$ 取 $\text{round}(n p)$ 作为代表性抽样结果` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_1 | EquationSpec | `$$P_{p=p_0}(X \ge c) \le 0.05$$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_2 | EquationSpec | `$$P_{p=p_0}(X \le c') \ge 0.90$$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_3 | EquationSpec | `$$n \approx \left( \frac{z_{1-\alpha}\sqrt{p_0(1-p_0)} + z_{` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_4 | EquationSpec | `$$q = 1 - (1 - p_1')(1 - p_2')(1 - p_f)$$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_5 | EquationSpec | `$$C_1 = \begin{cases} \frac{c_1 + d_1}{1-p_1} & x_1 = 1 \\ c` | 否 | （已通过） | 是 | 1 | 0.977 |
| EQ_6 | EquationSpec | `$$C_2 = \begin{cases} \frac{c_2+d_2}{1-p_2} & x_2=1 \\ c_2 &` | 否 | （已通过） | 是 | 1 | 0.975 |
| EQ_7 | EquationSpec | `$C_{\text{asm}} = C_1 + C_2 + a$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_8 | EquationSpec | `$n_f = \frac{1}{1-q}$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_9 | EquationSpec | `$$\text{TC} = \underbrace{\text{新购零配件成本}}_{\text{扣除回收}} + a\` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_10 | EquationSpec | `$$V_i = \begin{cases} \frac{c_i + d_i}{1-p_i} & x_i = 1 \\ c` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_11 | EquationSpec | `$A_j = \sum_{i \in S_j} V_i + a_j$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_12 | EquationSpec | `$q_j = 1 - \prod_{i \in S_j}(1-\pi_i)\cdot(1 - p_{h,j})$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_13 | EquationSpec | `$$V_{h,j} = \left(A_j + d_{h,j}\right)\cdot n_j + r_j \cdot ` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_14 | EquationSpec | `$q_f = 1 - (1-\pi_{h,1})(1-\pi_{h,2})(1-p_f)$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_15 | EquationSpec | `$A_f = V_{h,1}^{\text{eff}} + V_{h,2}^{\text{eff}} + a_f$` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ_16 | EquationSpec | `$$\text{TC}(d) = \mathbb{E}_{p \sim \text{Beta}(\alpha+x,\be` | 是 | （已通过） | （已通过） | 1 | 1 |

**分类计数**：精确匹配（harness 的裸 includes 即通过）=32；标点/全角/markdown + 空白差异（全部折叠后匹配）=1；标点/全角/markdown 差异（折叠后匹配）=2

**逐条明细**

### ASSUMPTION_A1（AssumptionSpec，41 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…### 2.4 假设与检验⏎⏎- **A1**：批量 $N$ 足够大，抽样比 $n/N \le …`
- diff 摘要：对齐后前 41 字符一致，第 42 个字符起不同：span 侧无字符（E1 多出 "（"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…/N \le 0.1$，用二项分布近似超几何分布（有放回/无放回差异可忽略）。 - **A2**…`

### ASSUMPTION_A2（AssumptionSpec，34 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…有放回/无放回差异可忽略）。⏎- **A2**：检测本身**无误差**（检测出的次品确实是次品，…`
- diff 摘要：对齐后前 34 字符一致，第 35 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…*（检测出的次品确实是次品，检测通过的确实合格）。题目未提检测误判率，必须显式假设。若引入误判率…`

### ASSUMPTION_A3（AssumptionSpec，53 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…斯方案——可作为稳健性讨论。⏎- **A3**：备择次品率 $p_1$ 的选择（情形 1 取 0…`
- diff 摘要：对齐后前 53 字符一致，第 54 个字符起不同：span 侧无字符（E1 多出 "："）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…形 2 取 0.05）是建模选择，需做敏感性分析：$p_1$ 变化时 $n$ 如何变化。 - *…`

### ASSUMPTION_A4（AssumptionSpec，18 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`… 变化时 $n$ 如何变化。⏎- **A4**：只做一次抽样（不采用二次/序贯抽样）。序贯抽样可…`
- diff 摘要：对齐后前 18 字符一致，第 19 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`只做一次抽样（不采用二次/序贯抽样）。序贯抽样可进一步减少平均检测次数，可作为扩展讨…`

### ASSUMPTION_A5（AssumptionSpec，28 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…⏎### 3.5 假设清单⏎⏎- **A5**：各决策变量在生产过程中全局固定（同一批次内不随时…`
- diff 摘要：对齐后前 28 字符一致，第 29 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…量在生产过程中全局固定（同一批次内不随时间变化）。 - **A6**：检测无误差（与问题 1 的…`

### ASSUMPTION_A6（AssumptionSpec，20 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…（同一批次内不随时间变化）。⏎- **A6**：检测无误差（与问题 1 的 A2 一致）。⏎- …`
- diff 摘要：对齐后前 20 字符一致，第 21 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`检测无误差（与问题 1 的 A2 一致）。 - **A7**：拆解不损坏零配件，拆解出的…`

### ASSUMPTION_A7（AssumptionSpec，44 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…问题 1 的 A2 一致）。⏎- **A7**：拆解不损坏零配件，拆解出的零配件 1、零配件 2…`
- diff 摘要：对齐后前 44 字符一致，第 45 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…配件 2 均可完整回收并重新进入流程（题目给定）。 - **A8**：市场需求充足，所有合格品都…`

### ASSUMPTION_A8（AssumptionSpec，41 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…并重新进入流程（题目给定）。⏎- **A8**：市场需求充足，所有合格品都能售出；不合格品退回率…`
- diff 摘要：对齐后前 41 字符一致，第 42 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…不合格品退回率 100%（消费者一定会退回次品）。 - **A9**：调换损失 $L$ 是"除调…`

### ASSUMPTION_A9（AssumptionSpec，47 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…%（消费者一定会退回次品）。⏎- **A9**：调换损失 $L$ 是"除调换次品之外的损失"，即…`
- diff 摘要：对齐后前 47 字符一致，第 48 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…即企业除了重新给一件合格品外，还额外损失 $L$。这个理解必须明确，否则成本结构会错。 - **…`

### ASSUMPTION_A10（AssumptionSpec，16 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…须明确，否则成本结构会错。⏎- **A10**：零配件次品率、成品次品率相互独立。⏎- **A1…`
- diff 摘要：对齐后前 16 字符一致，第 17 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`零配件次品率、成品次品率相互独立。 - **A11**：$y=0$ 时，退回的次…`

### ASSUMPTION_A11（AssumptionSpec，34 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…品率、成品次品率相互独立。⏎- **A11**：$y=0$ 时，退回的次品与厂内检测出的次品同样…`
- diff 摘要：对齐后前 34 字符一致，第 35 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…的次品与厂内检测出的次品同样适用拆解决策 $z$。 ### 3.6 验证方式 - 对每种情形的 …`

### ASSUMPTION_A12（AssumptionSpec，48 字符）

- harness 判定（裸 includes）：**e1_span 在 E1 中找不到逐字匹配（疑似改写）**
- 本探针类别：**标点/全角/markdown + 空白差异（全部折叠后匹配）**
- 读数：仅排版差异：标点/全角半角/markdown 强调符号不同，字母数字未变
- 相似度：折叠后 8-gram 覆盖 **0.829**；原始 8-gram 覆盖 0.756；折叠后 LCS 比 0.604；原始 LCS 比 0.542
- 在 E1 中的落点（按通过该级时的归一化文本）：`…含装配成本)也较便宜.###4.4假设-A12:多道工序之间,半成品的次品率定义按附录(1)--…`
- diff 摘要：对齐后前 0 字符一致，第 1 个字符起不同："道" (U+9053)  ←→  "多" (U+591A)
  - span 侧：`多道工序之间，半成品的次品率定义按附录（1）——…`
  - E1 侧：`道工序之间，半成品的次品率定义按附录 (1)——…`

### ASSUMPTION_A13（AssumptionSpec，35 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…xt{层}})$ 的依据。⏎- **A13**：不合格半成品的拆解决策独立于不合格成品的拆解决策…`
- diff 摘要：对齐后前 35 字符一致，第 36 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…独立于不合格成品的拆解决策（各有自己的 $z$）。 - **A14**：不合格半成品拆解后，其组…`

### ASSUMPTION_A14（AssumptionSpec，33 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…策（各有自己的 $z$）。⏎- **A14**：不合格半成品拆解后，其组成零配件全部可回收（不区…`
- diff 摘要：对齐后前 33 字符一致，第 34 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…，其组成零配件全部可回收（不区分零配件是否损坏）。 - **A15**：成品退回后的处理与厂内检…`

### ASSUMPTION_A15（AssumptionSpec，34 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…（不区分零配件是否损坏）。⏎- **A15**：成品退回后的处理与厂内检测出的不合格成品处理一致…`
- diff 摘要：对齐后前 34 字符一致，第 35 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…内检测出的不合格成品处理一致（同一 $z_f$）。 --- ## 五、问题 4：次品率由抽样检测…`

### ASSUMPTION_A16（AssumptionSpec，18 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…⏎⏎### 5.4 假设⏎⏎- **A16**：各次品率的抽样独立进行，后验分布独立。⏎- **…`
- diff 摘要：对齐后前 18 字符一致，第 19 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`各次品率的抽样独立进行，后验分布独立。 - **A17**：先验分布取 $\text…`

### ASSUMPTION_A17（AssumptionSpec，43 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…样独立进行，后验分布独立。⏎- **A17**：先验分布取 $\text{Beta}(1,1)$…`
- diff 摘要：对齐后前 43 字符一致，第 44 个字符起不同：span 侧无字符（E1 多出 "（"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…1,1)$（均匀先验），表示抽样前对次品率无信息（或用供应商标称值作为先验均值，做敏感性对比）。…`

### ASSUMPTION_A18（AssumptionSpec，44 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…先验均值，做敏感性对比）。⏎- **A18**：抽样检测的费用按问题 1 的方案计算，计入总成本…`
- diff 摘要：对齐后前 44 字符一致，第 45 个字符起不同：span 侧无字符（E1 多出 "，"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…入总成本（这一点题目说"检测费用由企业自行承担"，但在问题 2、3 的成本表中，"检测成本"指的…`

### ASSUMPTION_A19（AssumptionSpec，41 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…\times d_i$）。⏎- **A19**：观测次品数 $x$ 取 $\text{round…`
- diff 摘要：对齐后前 41 字符一致，第 42 个字符起不同：span 侧无字符（E1 多出 "（"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…t{round}(n p)$ 作为代表性抽样结果（也可报告 $x$ 在 2.5%–97.5% 分…`

### EQ_1（EquationSpec，31 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…观测到的次品率落在拒绝域的概率 ≤ 5%，即⏎⏎$$P_{p=p_0}(X \ge c) \le…`
- diff 摘要：对齐后前 31 字符一致，第 32 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…p_0}(X \ge c) \le 0.05$$ 即 $c$ 是最小的整数，使得 $\sum_{…`

### EQ_2（EquationSpec，32 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…过某个阈值 $c'$ 的概率 ≥ 90%，即⏎⏎$$P_{p=p_0}(X \le c') \g…`
- diff 摘要：对齐后前 32 字符一致，第 33 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…_0}(X \le c') \ge 0.90$$ 即 $c'$ 是最大的整数使 $\sum_{k…`

### EQ_3（EquationSpec，109 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…明显优质批）。用二项分布精确计算或正态近似：⏎⏎$$n \approx \left( \frac…`
- diff 摘要：对齐后前 109 字符一致，第 110 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…}{p_1 - p_0} \right)^2$$ **方案 B（仅按字面最小样本，单边检验）**…`

### EQ_4（EquationSpec，41 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…**（这是本题最容易出错的地方，必须仔细）：⏎⏎$$q = 1 - (1 - p_1')(1 -…`
- diff 摘要：对齐后前 41 字符一致，第 42 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…1')(1 - p_2')(1 - p_f)$$ 其中 $p_i'$ 是零配件 $i$ **进入…`

### EQ_5（EquationSpec，86 字符）

- harness 判定（裸 includes）：**e1_span 在 E1 中找不到逐字匹配（疑似改写）**
- 本探针类别：**标点/全角/markdown 差异（折叠后匹配）**
- 读数：仅排版差异：标点/全角半角/markdown 强调符号不同，字母数字未变
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 0.987；折叠后 LCS 比 1；原始 LCS 比 0.977
- 在 E1 中的落点（按通过该级时的归一化文本）：`…装配一件产品的零配件期望成本: - 零配件 1:$C1 = \begin{cases} \fra…`
- diff 摘要：对齐后前 0 字符一致，第 1 个字符起不同："：" (U+FF1A, 全角)  ←→  "$" (U+24)
  - span 侧：`$$C_1 = \begin{cases} \f…`
  - E1 侧：`：$C_1 = \begin{cases} \f…`

### EQ_6（EquationSpec，79 字符）

- harness 判定（裸 includes）：**e1_span 在 E1 中找不到逐字匹配（疑似改写）**
- 本探针类别：**标点/全角/markdown 差异（折叠后匹配）**
- 读数：仅排版差异：标点/全角半角/markdown 强调符号不同，字母数字未变
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 0.986；折叠后 LCS 比 1；原始 LCS 比 0.975
- 在 E1 中的落点（按通过该级时的归一化文本）：`…到一个进入装配的合格件. - 零配件 2 同理:$C2 = \begin{cases} \fra…`
- diff 摘要：对齐后前 0 字符一致，第 1 个字符起不同："：" (U+FF1A, 全角)  ←→  "$" (U+24)
  - span 侧：`$$C_2 = \begin{cases} \f…`
  - E1 侧：`：$C_2 = \begin{cases} \f…`

### EQ_7（EquationSpec，32 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…nd{cases}$⏎- 每装配一件产品的成本：$C_{\text{asm}} = C_1 + …`
- diff 摘要：对齐后前 32 字符一致，第 33 个字符起不同：span 侧无字符（E1 多出 "（"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…t{asm}} = C_1 + C_2 + a$（装配成本 $a$）。 **情形 A：$y = …`

### EQ_8（EquationSpec，21 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…t{回收节省})}{1-q}$$⏎⏎解释：装配 $n_f = \frac{1}{1-q}$ 件产…`
- diff 摘要：对齐后前 21 字符一致，第 22 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`$n_f = \frac{1}{1-q}$ 件产品（几何级数：第一次装配 1 件，若次品则…`

### EQ_9（EquationSpec，155 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…所以统一公式（每出厂/交付 1 件合格品）：⏎⏎$$\text{TC} = \underbrac…`
- diff 摘要：对齐后前 155 字符一致，第 156 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…ot z\cdot\frac{q}{1-q}$$ 其中 $n_f = \frac{1}{1-q}…`

### EQ_10（EquationSpec，86 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…测成本 $d_i$，决策 $x_i$）：⏎   $$V_i = \begin{cases} \f…`
- diff 摘要：对齐后前 86 字符一致，第 87 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`… & x_i = 0 \end{cases}$$ （获得一个进入装配的零配件 $i$ 的期望成本…`

### EQ_11（EquationSpec，34 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…  装配一个半成品 $j$ 的成本（不含检测）：$A_j = \sum_{i \in S_j} …`
- diff 摘要：对齐后前 34 字符一致，第 35 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…m_{i \in S_j} V_i + a_j$。 装配后不合格率：$q_j = 1 - \pr…`

### EQ_12（EquationSpec，56 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`… + a_j$。⏎   ⏎   装配后不合格率：$q_j = 1 - \prod_{i \in …`
- diff 摘要：对齐后前 56 字符一致，第 57 个字符起不同：span 侧无字符（E1 多出 "，"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…pi_i)\cdot(1 - p_{h,j})$，其中 $\pi_i = 0$ 若 $x_i=1…`

### EQ_13（EquationSpec，93 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…取决于 $x_i$）。稳态方程：⏎       $$V_{h,j} = \left(A_j + …`
- diff 摘要：对齐后前 93 字符一致，第 94 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…}{1-q_j} - \text{回收节省}$$ 其中 $n_j = \frac{1}{1-q_…`

### EQ_14（EquationSpec，45 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…测决策 $y$、拆解决策 $z_f$。⏎⏎   $q_f = 1 - (1-\pi_{h,1})…`
- diff 摘要：对齐后前 45 字符一致，第 46 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…1})(1-\pi_{h,2})(1-p_f)$。 $A_f = V_{h,1}^{\text{…`

### EQ_15（EquationSpec，57 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…_{h,2})(1-p_f)$。⏎   ⏎   $A_f = V_{h,1}^{\text{ef…`
- diff 摘要：对齐后前 57 字符一致，第 58 个字符起不同：span 侧无字符（E1 多出 "，"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…h,2}^{\text{eff}} + a_f$，其中 $V_{h,j}^{\text{eff}…`

### EQ_16（EquationSpec，87 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…$。决策的目标函数变为**后验期望成本**：⏎⏎$$\text{TC}(d) = \mathbb…`
- diff 摘要：对齐后前 87 字符一致，第 88 个字符起不同：span 侧无字符（E1 多出 " "）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…n-x)}[\text{TC}(d; p)]$$ 对每个决策 $d$ 计算后验期望成本，取最小。…`

## 样本 fresh-2 — 本次新跑的 E1 全文

- E1 来源：本次探针第 2 次真实 E1 调用（与生产同构的 prompt）
- E1 长度：4367 字符
- E2 输出：HTTP 200，finish=stop，17401 字符，JSON 可解析=是
- 待检条目（AssumptionSpec + EquationSpec）：9

| id | kind | span 前 60 字符 | 精确? | 空白归一化? | 标点归一化? | 折叠后 8-gram 覆盖 | 原始 LCS 比 |
|---|---|---|---|---|---|---|---|
| A-BINOMIAL-SAMPLING | AssumptionSpec | `抽样为有放回或总体远大于样本` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-SAMPLE-SIZE | AssumptionSpec | `假设每个次品率均通过问题1的最优抽样方案获得` | 是 | （已通过） | （已通过） | 1 | 1 |
| E-BINOM-REJECT | EquationSpec | `P(X > c \mid p=p_0) \le 0.05` | 是 | （已通过） | （已通过） | 1 | 1 |
| E-BINOM-ACCEPT | EquationSpec | `P(X \le c' \mid p=p_0) \ge 0.90` | 是 | （已通过） | （已通过） | 1 | 1 |
| E-Q1 | EquationSpec | `q_1 = 1-p_1` | 是 | （已通过） | （已通过） | 1 | 1 |
| E-Q2 | EquationSpec | `q_2 = 1-p_2` | 否 | 否 | 否 | 0 | 0.636 |
| E-PF | EquationSpec | `p_f = 1 - q_1 q_2 (1-p_a)` | 是 | （已通过） | （已通过） | 1 | 1 |
| E-P-SEMI | EquationSpec | `p_{\text{半成品}} = 1 - \prod_{i \in \text{上游}} q_i \cdot (1-p_` | 是 | （已通过） | （已通过） | 1 | 1 |
| E-POSTERIOR-MEAN | EquationSpec | `E[p] = (1+x)/(2+n)` | 是 | （已通过） | （已通过） | 1 | 1 |

**分类计数**：精确匹配（harness 的裸 includes 即通过）=8；真改写（折叠标点与空白后仍不匹配）=1

**逐条明细**

### A-BINOMIAL-SAMPLING（AssumptionSpec，14 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…: A-BINOMIAL-SAMPLING]] 抽样为有放回或总体远大于样本，$X$ 服从二项分…`
- diff 摘要：对齐后前 14 字符一致，第 15 个字符起不同：span 侧无字符（E1 多出 "，"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`抽样为有放回或总体远大于样本，$X$ 服从二项分布；若总体有限且样本占比大，…`

### A-SAMPLE-SIZE（AssumptionSpec，22 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…MPTION: A-SAMPLE-SIZE]] 假设每个次品率均通过问题1的最优抽样方案获得，样…`
- diff 摘要：对齐后前 22 字符一致，第 23 个字符起不同：span 侧无字符（E1 多出 "，"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`假设每个次品率均通过问题1的最优抽样方案获得，样本量取问题1的结果（如 $n=30$），观测…`

### E-BINOM-REJECT（EquationSpec，28 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`… $c$，使得在 $p=p_0$ 下：⏎  $$P(X > c \mid p=p_0) \le …`
- diff 摘要：对齐后前 28 字符一致，第 29 个字符起不同：span 侧无字符（E1 多出 "$"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…> c \mid p=p_0) \le 0.05$$ 即 $\sum_{k=c+1}^{n} \…`

### E-BINOM-ACCEPT（EquationSpec，31 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…$c'$，使得在 $p=p_0$ 下：⏎  $$P(X \le c' \mid p=p_0) \…`
- diff 摘要：对齐后前 31 字符一致，第 32 个字符起不同：span 侧无字符（E1 多出 "$"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`… c' \mid p=p_0) \ge 0.90$$ 即 $\sum_{k=0}^{c'} \b…`

### E-Q1（EquationSpec，11 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…*关键递推**：⏎- 零配件1经检测后合格率：$q_1 = 1-p_1$（若检测，不合格被丢弃）…`
- diff 摘要：对齐后前 11 字符一致，第 12 个字符起不同：span 侧无字符（E1 多出 "$"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`q_1 = 1-p_1$（若检测，不合格被丢弃）；若不检测，进入装配的…`

### E-Q2（EquationSpec，11 字符）

- harness 判定（裸 includes）：**e1_span 在 E1 中找不到逐字匹配（疑似改写）**
- 本探针类别：**真改写（折叠标点与空白后仍不匹配）**
- 读数：真改写：折叠后只有 0% 的 8 字片段命中，E1 里没有这句话
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0.667；原始 LCS 比 0.636
- diff 摘要：对齐后前 2 字符一致，第 3 个字符起不同："1" (U+31)  ←→  "2" (U+32)
  - span 侧：`q_2 = 1-p_2`
  - E1 侧：`q_1 = 1-p_1$（若检测，不合格被丢弃）；若…`
- 最接近的 E1 单行（相似度 0.636）：`- 零配件1经检测后合格率：$q_1 = 1-p_1$（若检测，不合格被丢弃）；若不检测，进入装配的零配件1合格率仍为 $q_1$。`

### E-PF（EquationSpec，25 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…。⏎- 装配后成品次品率（未检测前）：⏎  $$p_f = 1 - q_1 q_2 (1-p_a…`
- diff 摘要：对齐后前 25 字符一致，第 26 个字符起不同：span 侧无字符（E1 多出 "$"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…_f = 1 - q_1 q_2 (1-p_a)$$ 即：两个零配件均合格且装配成功才算合格品。…`

### E-P-SEMI（EquationSpec，72 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…零配件/半成品合格率与装配次品率递推：⏎  $$p_{\text{半成品}} = 1 - \pr…`
- diff 摘要：对齐后前 72 字符一致，第 73 个字符起不同：span 侧无字符（E1 多出 "$"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`… \cdot (1-p_{\text{装配}})$$ - 检测决策：检测则丢弃不合格品，提高后续…`

### E-POSTERIOR-MEAN（EquationSpec，18 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…组合，计算期望利润时对次品率取其后验期望（即 $E[p] = (1+x)/(2+n)$），或更精…`
- diff 摘要：对齐后前 18 字符一致，第 19 个字符起不同：span 侧无字符（E1 多出 "$"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`E[p] = (1+x)/(2+n)$），或更精细地，对次品率分布做数值积分求期望利…`

## 样本 fresh-3 — 本次新跑的 E1 全文

- E1 来源：本次探针第 3 次真实 E1 调用（与生产同构的 prompt）
- E1 长度：10634 字符
- E2 输出：HTTP 200，finish=length，205012 字符，JSON 可解析=否（SyntaxError: Unterminated string in JSON at position 205012 (line 9044 column 16)）
- 待检条目（AssumptionSpec + EquationSpec）：0

| id | kind | span 前 60 字符 | 精确? | 空白归一化? | 标点归一化? | 折叠后 8-gram 覆盖 | 原始 LCS 比 |
|---|---|---|---|---|---|---|---|

**分类计数**：

**逐条明细**

## 样本 archived — 存档的真实 E1 全文

- E1 来源：probe-b4-e1-reasoning-output.txt (ARM A reasoning_effort=none, 真实 E1 调用存档)
- E1 长度：8806 字符
- E2 输出：HTTP 200，finish=reused-from-disk，30210 字符，JSON 可解析=是
- 待检条目（AssumptionSpec + EquationSpec）：37

| id | kind | span 前 60 字符 | 精确? | 空白归一化? | 标点归一化? | 折叠后 8-gram 覆盖 | 原始 LCS 比 |
|---|---|---|---|---|---|---|---|
| A-BATCH-INFINITE | AssumptionSpec | `批量足够大（或 N ≥ 10n），抽样用二项分布而非超几何近似` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-ALT-POINT | AssumptionSpec | `情形 (1) 的备择次品率取 p₁ = 20%（p₀ 的 2 倍），情形 (2) 取 p₁' = 5%（或 0），用于约` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-TEST-EXACT | AssumptionSpec | `检测本身完美（无漏检/误检），检出即真实次品` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-COST-IGNORE | AssumptionSpec | `问题 1 只最小化检测次数 n，暂不计单件检测费用对方案的影响` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-EXACT-TEST2 | AssumptionSpec | `检测精确：通过检测的零配件/成品次品率为 0` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-RECYCLE-LOSSLESS | AssumptionSpec | `拆解不损坏零配件，回收的零配件与新件同质（题目给定）` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-RETURN-REPAIR | AssumptionSpec | `退回的不合格品无条件调换：企业损失 L（不含退回品本身价值），退回品按步骤(3)处理（拆解或丢弃）` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-STEADY-STATE | AssumptionSpec | `以"单位上市合格品"为成本基准的稳态流分析；拆解回流件再次进入同一决策流程` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-PI-DEF | AssumptionSpec | `成品合格率 π = (1−q₁)(1−q₂)(1−p₃)，其中 q_i = 0 若检测否则 p_i` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-DEMAND-EXO | AssumptionSpec | `市场需求充足，售价 s 固定不随决策变化；决策只影响成本与退货率，不影响销量` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-HIER-DEFECT | AssumptionSpec | `半成品/成品次品率是"用正品零配件（或半成品）装配后的次品率"，因此高层级合格率 = ∏(1−q_lower)·(1−p` | 否 | （已通过） | 是 | 1 | 0.986 |
| A-RECYCLE-LEVEL | AssumptionSpec | `不合格成品拆解回收的是其组成半成品（各 1 件，不损坏），不合格半成品拆解回收组成零配件` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-STEADY-STATE3 | AssumptionSpec | `稳态流分析，以单位上市成品为基准` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-EXACT-TEST3 | AssumptionSpec | `各级检测精确，通过者次品率为 0` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-CONJUGATE | AssumptionSpec | `次品率先验取 Beta(1,1)（均匀）或 Jeffreys Beta(0.5,0.5)；后验为 Beta(α+x, β` | 否 | （已通过） | 是 | 1 | 0.985 |
| A-INDEP-RATES | AssumptionSpec | `各零配件/半成品/成品次品率后验独立（抽样独立）` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-SAMPLE-COST | AssumptionSpec | `每件抽样检测成本等于该件的检测成本（表 1、表 2 中的 t_i），计入决策总成本` | 是 | （已通过） | （已通过） | 1 | 1 |
| A-RISK-NEUTRAL | AssumptionSpec | `企业风险中性，最小化后验期望成本（非 CVaR 等）` | 是 | （已通过） | （已通过） | 1 | 1 |
| EQ-BINOM-CDF | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-CASE1-CONST | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-CASE2-CONST | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-SPRT-BOUND | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-SPRT-LR | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-QI | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-PBAD | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-PI | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-E1 | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-U | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-COST | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-PROFIT | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-HIER-S1 | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-HIER-FINAL | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-NI | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-POSTERIOR | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-POST-MEAN | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-POST-OBJECTIVE | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |
| EQ-NS | EquationSpec | `（字段缺失）` | 否 | 否 | 否 | 0 | 0 |

**分类计数**：精确匹配（harness 的裸 includes 即通过）=16；标点/全角/markdown 差异（折叠后匹配）=2；未声明 e1_span（字段缺失）=19

**逐条明细**

### A-BATCH-INFINITE（AssumptionSpec，31 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…ION: A-BATCH-INFINITE]] 批量足够大（或 N ≥ 10n），抽样用二项分布…`
- diff 摘要：对齐后前 31 字符一致，第 32 个字符起不同：span 侧无字符（E1 多出 "；"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`… N ≥ 10n），抽样用二项分布而非超几何近似；若 N 已知应改用超几何精确计算。 [[ASS…`

### A-ALT-POINT（AssumptionSpec，66 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…SUMPTION: A-ALT-POINT]] 情形 (1) 的备择次品率取 p₁ = 20%（…`
- diff 摘要：对齐后前 66 字符一致，第 67 个字符起不同：span 侧无字符（E1 多出 "；"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`… p₁' = 5%（或 0），用于约束第二类错误；题目未给，属建模选择。 [[ASSUMPTIO…`

### A-TEST-EXACT（AssumptionSpec，22 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…UMPTION: A-TEST-EXACT]] 检测本身完美（无漏检/误检），检出即真实次品。⏎…`
- diff 摘要：对齐后前 22 字符一致，第 23 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`检测本身完美（无漏检/误检），检出即真实次品。 [[ASSUMPTION: A-COST-I…`

### A-COST-IGNORE（AssumptionSpec，31 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…MPTION: A-COST-IGNORE]] 问题 1 只最小化检测次数 n，暂不计单件检测费…`
- diff 摘要：对齐后前 31 字符一致，第 32 个字符起不同：span 侧无字符（E1 多出 "（"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…小化检测次数 n，暂不计单件检测费用对方案的影响（题目说"检测费用由企业承担"但未给数值，故目标…`

### A-EXACT-TEST2（AssumptionSpec，22 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…MPTION: A-EXACT-TEST2]] 检测精确：通过检测的零配件/成品次品率为 0。⏎…`
- diff 摘要：对齐后前 22 字符一致，第 23 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`检测精确：通过检测的零配件/成品次品率为 0。 [[ASSUMPTION: A-RECYCL…`

### A-RECYCLE-LOSSLESS（AssumptionSpec，26 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…N: A-RECYCLE-LOSSLESS]] 拆解不损坏零配件，回收的零配件与新件同质（题目给…`
- diff 摘要：对齐后前 26 字符一致，第 27 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…不损坏零配件，回收的零配件与新件同质（题目给定）。 [[ASSUMPTION: A-RETURN…`

### A-RETURN-REPAIR（AssumptionSpec，49 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…TION: A-RETURN-REPAIR]] 退回的不合格品无条件调换：企业损失 L（不含退回…`
- diff 摘要：对齐后前 49 字符一致，第 50 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…本身价值），退回品按步骤(3)处理（拆解或丢弃）。 [[ASSUMPTION: A-STEADY…`

### A-STEADY-STATE（AssumptionSpec，37 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…PTION: A-STEADY-STATE]] 以"单位上市合格品"为成本基准的稳态流分析；拆解…`
- diff 摘要：对齐后前 37 字符一致，第 38 个字符起不同：span 侧无字符（E1 多出 "（"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…基准的稳态流分析；拆解回流件再次进入同一决策流程（d₁,d₂,d₃ 对回流件同样适用）。 [[A…`

### A-PI-DEF（AssumptionSpec，49 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…[ASSUMPTION: A-PI-DEF]] 成品合格率 π = (1−q₁)(1−q₂)(1…`
- diff 摘要：对齐后前 49 字符一致，第 50 个字符起不同：span 侧无字符（E1 多出 "；"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…p₃)，其中 q_i = 0 若检测否则 p_i；附录(1) 明确 p₃ 是"正品零配件装配后的…`

### A-DEMAND-EXO（AssumptionSpec，38 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…UMPTION: A-DEMAND-EXO]] 市场需求充足，售价 s 固定不随决策变化；决策只…`
- diff 摘要：对齐后前 38 字符一致，第 39 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…不随决策变化；决策只影响成本与退货率，不影响销量。 **各情况的定性预判**（数值由代码算）： …`

### A-HIER-DEFECT（AssumptionSpec，70 字符）

- harness 判定（裸 includes）：**e1_span 在 E1 中找不到逐字匹配（疑似改写）**
- 本探针类别：**标点/全角/markdown 差异（折叠后匹配）**
- 读数：仅排版差异：标点/全角半角/markdown 强调符号不同，字母数字未变
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 0.984；折叠后 LCS 比 1；原始 LCS 比 0.986
- 在 E1 中的落点（按通过该级时的归一化文本）：`…DEFECT]] 各层级次品率按附录(1)定义:半成品/成品次品率是"用正品零配件(或半成品)装…`
- diff 摘要：对齐后前 69 字符一致，第 70 个字符起不同：")" (U+29)  ←→  "）" (U+FF09, 全角)
  - span 侧：`…1−q_lower)·(1−p_assembly）`
  - E1 侧：`…1−q_lower)·(1−p_assembly)，不合格事件在各层级独立叠加。 [[ASSUM…`

### A-RECYCLE-LEVEL（AssumptionSpec，44 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…TION: A-RECYCLE-LEVEL]] 不合格成品拆解回收的是其组成半成品（各 1 件，…`
- diff 摘要：对齐后前 44 字符一致，第 45 个字符起不同：span 侧无字符（E1 多出 "；"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…1 件，不损坏），不合格半成品拆解回收组成零配件；回收件回到对应层级的入口，适用同一层的检测决策…`

### A-STEADY-STATE3（AssumptionSpec，16 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…TION: A-STEADY-STATE3]] 稳态流分析，以单位上市成品为基准。⏎[[ASSU…`
- diff 摘要：对齐后前 16 字符一致，第 17 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`稳态流分析，以单位上市成品为基准。 [[ASSUMPTION: A-EXACT-…`

### A-EXACT-TEST3（AssumptionSpec，16 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…MPTION: A-EXACT-TEST3]] 各级检测精确，通过者次品率为 0。⏎⏎**检验方…`
- diff 摘要：对齐后前 16 字符一致，第 17 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`各级检测精确，通过者次品率为 0。 **检验方法**：穷举 2^15；对最优方案…`

### A-CONJUGATE（AssumptionSpec，65 字符）

- harness 判定（裸 includes）：**e1_span 在 E1 中找不到逐字匹配（疑似改写）**
- 本探针类别：**标点/全角/markdown 差异（折叠后匹配）**
- 读数：仅排版差异：标点/全角半角/markdown 强调符号不同，字母数字未变
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 0.983；折叠后 LCS 比 1；原始 LCS 比 0.985
- 在 E1 中的落点（按通过该级时的归一化文本）：`…SUMPTION: A-CONJUGATE]] 次品率先验取 Beta(1,1)(均匀)或 Je…`
- diff 摘要：对齐后前 64 字符一致，第 65 个字符起不同：")" (U+29)  ←→  "）" (U+FF09, 全角)
  - span 侧：`…0.5)；后验为 Beta(α+x, β+n−x）`
  - E1 侧：`…0.5)；后验为 Beta(α+x, β+n−x)。 [[ASSUMPTION: A-INDEP…`

### A-INDEP-RATES（AssumptionSpec，24 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…MPTION: A-INDEP-RATES]] 各零配件/半成品/成品次品率后验独立（抽样独立）…`
- diff 摘要：对齐后前 24 字符一致，第 25 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`各零配件/半成品/成品次品率后验独立（抽样独立）。 [[ASSUMPTION: A-SAMPLE…`

### A-SAMPLE-COST（AssumptionSpec，41 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…MPTION: A-SAMPLE-COST]] 每件抽样检测成本等于该件的检测成本（表 1、表 …`
- diff 摘要：对齐后前 41 字符一致，第 42 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…（表 1、表 2 中的 t_i），计入决策总成本。 [[ASSUMPTION: A-RISK-N…`

### A-RISK-NEUTRAL（AssumptionSpec，26 字符）

- harness 判定（裸 includes）：**PASS**
- 本探针类别：**精确匹配（harness 的裸 includes 即通过）**
- 读数：逐字命中，harness 的裸 includes 本应通过
- 相似度：折叠后 8-gram 覆盖 **1**；原始 8-gram 覆盖 1；折叠后 LCS 比 1；原始 LCS 比 1
- 在 E1 中的落点（按通过该级时的归一化文本）：`…PTION: A-RISK-NEUTRAL]] 企业风险中性，最小化后验期望成本（非 CVaR …`
- diff 摘要：对齐后前 26 字符一致，第 27 个字符起不同：span 侧无字符（E1 多出 "。"）
  - span 侧：`(span 在该处已结束)`
  - E1 侧：`…风险中性，最小化后验期望成本（非 CVaR 等）。 **检验方法**：后验均值下重跑穷举；在可信…`

### EQ-BINOM-CDF（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-CASE1-CONST（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-CASE2-CONST（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-SPRT-BOUND（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-SPRT-LR（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-QI（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-PBAD（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-PI（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-E1（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-U（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-COST（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-PROFIT（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-HIER-S1（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-HIER-FINAL（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-NI（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-POSTERIOR（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-POST-MEAN（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-POST-OBJECTIVE（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`

### EQ-NS（EquationSpec，0 字符）

- harness 判定（裸 includes）：**未声明 e1_span**
- 本探针类别：**未声明 e1_span（字段缺失）**
- 读数：该条根本没写 e1_span（不是改写——字段缺失，harness 的报错文本也是"未声明"）
- 相似度：折叠后 8-gram 覆盖 **0**；原始 8-gram 覆盖 0；折叠后 LCS 比 0；原始 LCS 比 0
- diff 摘要：(无 span，无 diff 可比)
  - span 侧：`(无 span)`
  - E1 侧：`(无 span)`
