/**
 * 技能库文档：论文契约（`skills/paper-contract.md`）。
 *
 * 这是从最小宪法移出来的**知识**：它描述"论文该有什么"，不描述"容器长什么样"。
 * 宪法只留一行索引，正文在这里。模型在写 narrative 之前按需读取。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/knowledge/skills/paper-contract
 */

import { PAPER_LENGTH_REFERENCE } from '../../delivery/prose-contracts.ts'

const analysis = PAPER_LENGTH_REFERENCE.chapters.analysis
const evaluation = PAPER_LENGTH_REFERENCE.chapters.evaluation
const references = PAPER_LENGTH_REFERENCE.chapters.references
const code = PAPER_LENGTH_REFERENCE.chapters.code
const restatement = PAPER_LENGTH_REFERENCE.chapters.restatement

export const PAPER_CONTRACT_SKILL = `# 论文契约

> 本文件描述**论文该有什么**。容器的字段形状见最小宪法；本文件只管内容。
> 每一行都是**机械检查**的，交付前逐条核对，所以第一次产出就要满足。

## 章节骨架

narrative 必须携带**八个非空字符串**。缺任何一个，harness 会渲染一个**可见占位符**
并在交付前拒绝，拒绝信息里点名缺的是哪个键。

| 键 | 章节 | 要求 |
|---|---|---|
| \`title\` | 标题 | 一句话说清建模对象与方法 |
| \`methods\` | 模型建立与求解 | **不是一句话摘要**：把你实际求解的方程/递推写出来 |
| \`conclusion\` | 结论 | 每个子问题给出数值结论，数字用 \`{<result_id>}\` |
| \`restatement\` | 问题重述 | 自己的话，不要粘贴题面。参照 ${String(restatement?.reference ?? 0)} 字，低于 ${String(restatement?.rewriteBelow ?? 0)} 字退回重写 |
| \`analysis\` | 问题分析 | **逐问一段**：该问用哪个方法族、为什么是它、难点在哪。参照 ${String(analysis?.reference ?? 0)} 字，低于 ${String(analysis?.rewriteBelow ?? 0)} 字退回重写 |
| \`evaluation\` | 模型评价与推广 | **四段**：优点 / 局限 / 敏感性 / 推广。参照 ${String(evaluation?.reference ?? 0)} 字，低于 ${String(evaluation?.rewriteBelow ?? 0)} 字退回重写 |
| \`references\` | 参考文献 | ≥3 条完整条目，形如 \`[1] 作者. 题名. 出处. 年.\`，至少一条与你实际用过的方法相关。参照 ${String(references?.reference ?? 0)} 字，低于 ${String(references?.rewriteBelow ?? 0)} 字退回重写 |
| \`code\` | 代码附录说明 | 点名哪个函数解哪个子问题（"问题1 由 solve_q1() 完成 …"）。低于 ${String(code?.rewriteBelow ?? 0)} 字退回重写；harness 会在你这段说明下方附上**真实代码** |

## 摘要（可选，但强烈建议）

摘要是评委读到的第一段。1,000–1,400 字，结构：

1. 一句背景；
2. **每个子问题一小段**：它建了什么模型、得到什么结论；
3. 一句评价。

**每个数字都写成 \`{<result_id>}\` 占位符**——harness 在渲染时替换成 Result 的真实值。

### 一个合格的摘要骨架

\`\`\`
本文研究<对象>的<问题>。针对题面给出的<数据/条件>，建立了<方法族>模型。

针对问题一，把<现象>写成<数学形式>，解得<结论>为 {RES-Q1}。
针对问题二，以<目标>为目标函数、以<约束>为约束建立<模型>，
  用<求解方式>得到最优方案：<方案描述>，其<指标>为 {RES-Q2}。
针对问题三，考虑<不确定性/推广>，通过<方法>得到<结论> {RES-Q3}。

本文的特点是<一句话特点>；局限在于<一句话局限>。
\`\`\`

**每一问都必须出现**，且**每一问都要带数**。只写"建立了模型并求解"的摘要
在评分上等于没写。

## 逐问覆盖（最常见的失败点）

题面问几个子问题，harness 就注册几个独立的 REQUIRED_OUTPUT。**每个子问题**都要有：

- 自己的 ModelSpec（\`problem_refs\` 指向该子问题）；
- E1 里一段带 \`[[REQUIREMENT: R-Qn]]\` 锚点的推理；
- 自己的 Result（jsonPath 读回的真实数字）；
- 一条 CRITICAL 的 NUMERIC Claim。

**一个总数回答四个问题不算回答。** 一段承诺"我们将枚举所有组合"而结果表里只有一个
场景的方法描述，正是评委判定为"未完成"的形态。

自检：把题面的问号数一遍，再把你声明的 CRITICAL Claim 数一遍——**两个数必须相等**。

## 假设的闭环

每条 AssumptionSpec 必须：

- 被**至少一个 ModelSpec** 在 \`assumption_refs\` 里引用；
- 带 \`justification_refs\`：\`MODELING_CHOICE\` 要说明题面或你的分析里什么支持了它；
  \`GIVEN\` 要指向它来自的 DataArtifact。

**没被任何模型用到的假设是噪声，不是严谨。** 列 20 条假设而只有 6 条被用到，
评审会认为你在凑数。

### 假设与方程的**作用域**（一条硬规则，一次真实运行死在这里）

每条 AssumptionSpec / EquationSpec 只带**一个** \`scope_ref\`（它是从哪个子问题
**推导出来**的），而一个 ModelSpec **只能引用**作用域在它自己的 \`problem_refs\`
之内的对象。

**全局假设**（次品事件独立、检测完美、共用的分布定义……）有**两条合法路线，任选一条**：

**路线 a**（推荐）：声明一条并标 \`"shared": true\`：

\`\`\`json
{ "assumption_id": "A-INDEP", "scope_ref": "P1", "shared": true,
  "statement": "各零部件的次品事件相互独立", ... }
\`\`\`

这样**任何**子问题的模型都可以引用它。

**路线 b**：逐个子问题各声明一条、各用不同 id（\`A-INDEP-P1\`、\`A-INDEP-P2\`…）。
两条都通过校验；选哪条看你顺手。**两条都不做**（声明一次却跨作用域引用）才会被拒。

**为什么要有这条规则**：没有它，一个子问题就能"借另一个子问题的假设来给自己
背书"。所以**没声明 \`shared\` 的跨作用域引用仍然会被拒**
（\`reference_scope_mismatch\`）——放宽的只是"你明确说了它对所有子问题成立"
这一种情形，而那是可审计的（字段在 IR 里）。

好的假设长这样：

| 字段 | 值 |
|---|---|
| statement | 各零部件的次品事件相互独立 |
| source_type | \`MODELING_CHOICE\` |
| justification_refs | \`["R-Q1"]\`（题面把它作为"抽样检验"场景陈述，独立性是该场景的前提） |
| risk_level | \`MEDIUM\`（若同批次存在相关性，二项模型会低估方差） |
| testable | \`true\` |

注意 \`risk_level\` 与 \`testable\` 不是形式字段：**它们决定评审信不信你的模型**。
一条 HIGH 风险的假设而不做敏感性分析，是明显的失分点。

## 交付前自检清单

按顺序核一遍，每一条都是机械检查的：

1. 八个 narrative 键**都有非空内容**？
2. 摘要写了？每问一小段？数字都是 \`{<result_id>}\`？
3. **CRITICAL Claim 数 = 子问题数**？
4. 每条假设都被某个模型引用了？都有 justification？
5. 每个 Result 的 jsonPath 都能解析到**有限数值**？
6. 至少一张图？
7. 参考文献 ≥3 条，且至少一条与方法相关？
8. 正文里的数字**全部**有来源（\`{<result_id>}\` 或题面给定并用文字表述）？
9. E1 里每问都有 \`[[REQUIREMENT: R-Qn]]\` 锚点？每条 \`[[ASSUMPTION: id]]\` 都在
   entries 里有同名 AssumptionSpec？

第 9 条是最容易漏的：**E1 与 entries 是双向 1:1**，多声明和少声明都会被拒。
你自己写死的数字必须与 Result **完全相等**，猜错会让整篇报告被拒。

不写摘要时 harness 会退回一个通用生成的摘要，质量明显更低。

## 逐问覆盖（最常见的失败点）

题面问几个子问题，harness 就注册几个独立的 REQUIRED_OUTPUT。**每个子问题**都要有：

- 自己的 ModelSpec（\`problem_refs\` 指向该子问题）；
- E1 里一段带 \`[[REQUIREMENT: R-Qn]]\` 锚点的推理；
- 自己的 Result（jsonPath 读回的真实数字）；
- 一条 CRITICAL 的 NUMERIC Claim。

**一个总数回答四个问题不算回答。** 一段承诺"我们将枚举所有组合"而结果表里只有一个
场景的方法描述，正是评委判定为"未完成"的形态。

## 密度与形态

- **不留连续空行**；
- 任一章节的正文（不含表格与代码块）不少于 120 字；
- 图注、坐标轴标签里**不要写数字**（除非它恰好等于某个被引用的 Result 的值）——写成词，例如 \`final value\` 而不是 \`y(2.0)\`；
- 至少一张图。图的**结构**由你声明，字节与哈希由 harness 渲染与计算。

## 假设的闭环

每条 AssumptionSpec 必须：

- 被**至少一个 ModelSpec** 在 \`assumption_refs\` 里引用；
- 带 \`justification_refs\`：\`MODELING_CHOICE\` 要说明题面或你的分析里什么支持了它；\`GIVEN\` 要指向它来自的 DataArtifact。

**没被任何模型用到的假设是噪声，不是严谨。**

## 参考文献纪律

- 不许编造条目。不确定出处就换一篇你真的知道的。
- 期刊/会议论文场景下，编造引用是比数字错误更严重的缺陷——直接构成学术不端。
- 若某条无法核验，如实标注不确定，不要伪装成确证。
`
