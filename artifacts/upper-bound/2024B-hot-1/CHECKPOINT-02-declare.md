# 检查点 02 — declare（容器声明与准入 / E2）

> 切片：`artifacts/upper-bound/2024B-hot-1/slices/02-declare/`（**第一轮**，已被 `superseded` 保留）
> run-id：`88423d71-3ea3-4aa6-927e-5c68f91d95eb`
> 载荷 sha256：见 `manifest.json`
> 配置：`--resume <slices>`（播种 analyze）+ `--pause-after declare`

---

## 1. 结论

**检查未通过（failed）——但错的不是模型，是交付链路。**

容器本身**结构完好、准入通过**（§2）。但它写的 `narrative`（论文正文八章）**大面积不达正文契约**
（§3），而这份契约**从未被送到写下它的那一通调用里**（§4）。

按热重启口径：**A（analyze）已完成且检查通过，B（declare）未通过 → 修完从 B 重启**。
旧切片已按 `.superseded-1` 保留（§6）。

---

## 2. 容器本身：准入通过，结构完好

用 harness **自己的判据**跑了一遍（`scripts/.check-container.mts`，直接调
`checkCandidateContainer`）：

```
admissible: true
summary: 解析通过、entries 非空且形状正确、id 无重复、每个子问题都有模型、
         Result 的 locator 都在已声明的输出里、跨子问题引用合法、E1 锚点逐字对得上。
problems: （空）
```

| 项 | 实测 |
|---|---|
| entries | **39** 条：SymbolSpec 8 / **AssumptionSpec 23** / EquationSpec 4 / **ModelSpec 4** |
| 假设锚点 | E1 有 23 条 `[[ASSUMPTION: …]]`，容器声明 23 条 AssumptionSpec — **逐字 1:1** |
| 模型覆盖 | **4 个 ModelSpec**（四问各一个，逐问覆盖满足） |
| code | 有，3,949 字符 |
| run | `outputBasenames: [results.json, numeric_config.json]`，`seed: 0` |
| results | 6 条 |
| figures | **1 张** |
| narrative | 8 个键齐（title/methods/conclusion/restatement/analysis/evaluation/references/code） |

**一个正向观察**：图声明的题注是 `"抽样检验方案的操作特性曲线"` ——**不含任何数字**。
strict-13 里那条"图注含中文序数 `2`"的头号阻断**没有复发**。本轮宪法已点名该陷阱
（`CHINESE ORDINALS ARE THE TRAP`），这可能是它的效果——但 **n=1，不能下结论**，
留作后续核对项。

---

## 3. 问题：`narrative` 大面积不达正文契约

用产出链**同一套判据**跑了一遍（`scripts/.check-declare.mts`，直接调
`proseContractViolations` + `substanceViolations`）：

| 章 | 实测 | 地板 | 判定 |
|---|---|---|---|
| `analysis` 问题分析 | **72 字** | 1200 | ❌ 且没有逐问归因（缺 R-Q1..R-Q4） |
| `evaluation` 模型评价与推广 | **49 字** | 800 | ❌ 缺"优点""局限"两个要素 |
| `references` 参考文献 | **124 字** | 600 | ❌ **且没有任何方法关键词** |
| `code` 代码附录 | **96 字** | 600 | ❌ 没说明实现了哪几问 |
| `restatement` 问题重述 | **32 字** | 200 | ❌ |

**这份容器若直接进产出链，`prose_contract` 必然拒绝**——而且拒绝的形态与
strict-11/strict-13 历轮完全一致（"参考文献与本文所用方法没有可辨的关联"）。

参考文献章原文（144 字符，3 条）：
```
[1] 茆诗松. 概率论与数理统计. 高等教育出版社. 2011.
[2] 盛骤. 概率论与数理统计. 高等教育出版社. 2008.
[3] Montgomery D C. Introduction to Statistical Quality Control. Wiley. 2013.
```
条目数够（3 条），但**没有一条指向本题实际用过的方法**（抽样检验 / 序贯 / 决策 / 优化）。

---

## 4. 根因：要求写在 A 处，执行在 B 处

**模型是在 E2 那一通调用里写 `narrative` 的。而那八章就是论文正文。**

E2 的 prompt 由 `e2NormalizationPrompt(e1Text, constitutionText())` 组成：

- `e1Text` —— E1 的建模分析（好的，7,173 字）
- `constitutionText()` —— `PAPER_CONSTITUTION` + 技能库**索引**

宪法里有什么？它说 `narrative carries EIGHT non-empty strings` ——**只要求"八章非空"**。
它**没有**篇幅地板、没有"参考文献 ≥3 条且至少一条含方法关键词"、没有"评价章四要素"。

那三条写在哪？写在技能库文档 `paper-contract` 里，由 **`produce` 步骤简报**内联。
而那份简报：

- 在**单发路径**上挂在 EXECUTE 节点的 prompt 上（`executor.ts:1485`）；
- 在 **E1/E2 路径**上，E1 的 prompt **显式把它剥掉了**（"E1 要两个东西都不要：容器教学，
  以及为容器而写的本步骤简报"），而 **E2 从来就没拿到过它**。

**所以：写下正文的那一通调用，从未被告知正文会被怎样检查。**

这不是模型的缺陷。模型做的是它被告知的事（"八章非空"）——它写了八章，非空。
然后产出链用一套它没见过的判据把它拒掉。**这是"判定侧写了、传递侧没写"**，
与本项目反复抓到的那一类同源（round-5 的"接缝吞 tools"、round-6 的"白名单漏传"
都是同一个形状）。

---

## 5. 修法（已实现，待重启 B 验证）

在 E2 的 prompt 上拼一份 **produce 简报**（正文契约的载体），并用 E2 自己的话说明
"这八章就是论文正文、这些判据会被机械检查"：

```ts
const proseContractBriefing = this.briefingOf('produce', {
  target: '容器的 `narrative` 八章——**这八章就是论文正文**，不是摘要也不是笔记',
  upstream: 'E1 的建模分析已在上文；代码与数字尚未产生（正文里的数字写 `{<result_id>}` 占位符）。',
  done: '八章各自达到篇幅地板、逐问点名、参考文献 ≥3 条且至少一条指向你实际用过的方法、'
      + '评价章写全四要素（优点 / 局限 / 敏感性 / 推广）。**这些是产出链会逐条机械检查的判据**。',
})
const baseE2Prompt = e2NormalizationPrompt(e1Text, constitutionText())
  + '\n\n' + proseContractBriefing
```

**为什么复用 `produce` 简报而不是新写一份**：判据必须**单一来源**。新写一份 =
两条会漂移的副本，而漂移的那一天没人会发现——正是本轮格式审计抓到的那类问题。

新增回归测试 `tests/architecture/e2-prose-contract.spec.ts`（4 条），判据是
**接线**而不是措辞：
- produce 简报里确实含篇幅地板 / 参考文献规则 / 评价四要素；
- 宪法里**没有**正文契约（方向性守卫：哪天宪法把它吞了，这条会红）；
- `e2NormalizationPrompt(...)` 附近必须出现 `briefingOf('produce'`（静态接线断言）；
- 加契约**不许挤掉**容器 schema。

---

## 6. 顺带修掉的一处：重跑会**覆盖**旧切片

**错误形态**：`writeSlice` 写 `join(root, sliceDirName(index, stage))`——同一阶段重跑时
**直接覆盖**。

**为什么这是缺陷**：用户的口径是"**每一轮切片都保留**"。而"修完问题从检查点重启"
恰恰会产生同一阶段的第二个轮次；覆盖掉第一个，就**失去了"修之前长什么样"的唯一证据**
——事后无法证明修复真的改变了什么。

**修法**：
- `writeSlice` 在目标目录已存在时，先把它整体改名为 `NN-stage.superseded-N`，再写新的；
- `listSlices` 只认规范目录名（`/^\d{2}-[a-z]+$/`），被移开的旧切片**仍在磁盘上**
  但不参与续跑判定（否则同阶段两个轮次会被当成"序号重复"而截断续跑链）。

新增 3 条测试，含"重跑两次 → 两个历史轮次都在"。

---

## 7. 检查结论

```json
{
  "verdict": "failed",
  "note": "容器结构完好、准入通过（39 条、23 假设与 E1 逐字 1:1、4 个模型、1 张图、图注无数字）。但 narrative 八章大面积不达正文契约（analysis 72/1200、evaluation 49/800 且缺优点局限、references 124/600 且无方法关键词、code 96/600、restatement 32/200）。根因不是模型：正文契约只在 produce 简报里，而 E1 显式剥掉了它、E2 从未拿到过——写正文的那通调用没被告知正文会被怎样检查。已修：E2 prompt 拼上 produce 简报 + 4 条接线回归测试。另修 writeSlice 覆盖旧切片的缺陷。按热重启口径从 B 重启。",
  "at": "2026-09-24T00:00:00.000Z"
}
```

**下一阶段**：`declare`（**第二轮**，验证修法）。
**重启命令**（从"A 已完成、B 未开始"）：
```
paper-shell run bench/problems/2024-B/problem-faithful.md \
  --out artifacts/upper-bound/2024B-hot-1 \
  --resume artifacts/upper-bound/2024B-hot-1/slices --pause-after declare
```
`--resume` 会读 `resumePointOf`：`01-analyze` 已检查通过、`02-declare` 未通过 →
续跑点是 analyze → 播种 E1 → **重跑 declare**。旧切片自动移到 `.superseded-1`。
