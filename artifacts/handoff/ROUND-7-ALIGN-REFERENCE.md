# ROUND-7 — 对齐参照物的结构 + 让离线预检真的走到产线链

> 2026-09-21。**零真实运行**（用户口径：论文形态对齐参照物之前不得开实测）。
> 本轮所有结论都由 **离线预检（`--fake`，零 token）** 得出——它现在真的走完整条
> `A-produce-chain` 并产出 `CLEAN` 交付包。

## 一、这一轮修的是什么（用户口径：对齐参照物结构）

参照物 `CUMCM/workspaces/5ba6e7bd5010/paper/main.md` 的骨架是**每个子问题独立成章**：
「6 问题一：预热平衡阶段的常物性耦合场求解」「7 问题一模型的独立校核」「8 问题二：…」。
本轮之前只有 `A-produce-chain` 有这一形态，兜底稿仍是扁平 12 章。

| # | 缺陷（离线预检实测） | 修法 |
|---|---|---|
| 1 | **兜底稿没有逐问章**——E1 直通路径用另一个渲染器，不装配逐问章 | 逐问章装配抽成 `produce/per-question.ts`，两条交付路径共用 |
| 2 | **拆分器吞正文**：旧判据 `/^#{0,6}\s*问题\s*([0-9]+)/` 把正文句子 `问题1的核心是…` 当成标题，整段推理被吞掉、拆分结果为空 | 标题判据收紧（必须是 markdown 标题行，或**整行**就是标题：序号后只能是行尾/分隔符/短标题，且不含句末标点）；同一问的多个段落**合并**而不是取第一段 |
| 3 | **锚点印进论文**：`[[REQUIREMENT: R-Q1]]` / `[[ASSUMPTION: A1]]` 随 E1 段落进了正文 | `stripHarnessAnchors()` 在渲染边界剥掉（门禁读 E1 原文，不受影响） |
| 4 | **同一段 E1 出现两次**（问题分析章 + 逐问章） | 问题分析章改放 E1 的**统一框架段** + 模型自写的逐问归因；逐问章放该问的分析 + 该问的模型 + 该问的结果 |
| 5 | **逐问章没有自己的数值**：一次容器只有一次运行，`Result.run_ref → RunArtifact.model_ref → ModelSpec.problem_refs` 把所有结果都算到第一问 | 归属改为**结论自报的 `Claim.model_refs` 优先**，出处链只兜底（`requirement-coverage`、`V4`、逐问章装配三处同口径）；教学同步写明"每条 CRITICAL 结论的 model_refs 必须指向该问的模型" |
| 6 | **一个聚合 ProblemSpec 让逐问覆盖无法成立** | harness 改为**每个子问题一个 ProblemSpec**（`P<n> ↔ 问题n`，`requirement_refs: ['R-Qn']`），`requirement_coverage` 因此变成逐问判据 |
| 7 | **以表格为正文的章被判"0 字，几乎是空的"**——假设表/符号表/方程表/模型表/结果表全被自己的门拒掉（链在交付前死） | `blank_area` 改为：表格算内容（数单元格实质字符、记表格行数），章边界只认 `##`（`### 方程` 是父章的小节）；判据变为"既无 120 字正文、又一行表格都没有"才算空白 |
| 8 | **摘要出现"不属于任何 Result 的数字"**——兜底稿把引擎原文（"只有 1076 字"）抄进摘要，被数字门当成结论数字 | 摘要是无数字的说明，引擎原文逐字引用留在交付附录（标注区） |
| 9 | **`--fake` 根本没走产线链**：E2 提示词首句是 "You are NORMALIZING a modeling analysis…"，`includes('modeling analysis')` 把容器提示词判成了 E1 提示词，于是每次都 `parse_failed` 兜底 | 假 provider 先按容器特征词匹配；夹具扩成"每问一个模型 + 每问一条 CRITICAL 结论 + 逐问叙事" |
| 10 | **PDF 导出在真机上恒失败**：`shutil.which('pandoc')` 看不到 winget 用户级安装（`LOCALAPPDATA/Pandoc/pandoc.exe`）；且 pandoc 默认代码高亮要 `Shaded` 环境，CUMCM 模板没加载，xelatex 直接死 | `find_tool()` 先查 PATH 再查已知安装位；pandoc 加 `--no-highlight` |
| 11 | **一次真实运行不产出 Word 版**（用户对齐目标是 `main.docx`） | 交付段接上 `docx precheck`（15 类，0 致命才导出）+ `export-docx.py`，与 PDF 同口径（失败报错不静默） |

## 二、离线预检现在证明什么（零 token）

命令（**离线、零模型调用**）：

```
npx tsx apps/paper-shell/src/cli.ts run bench/problems/2024-B/problem-faithful.md --fake --fail-soft --out <dir>
```

结果：`[DELIVERED]`、`path -> A-produce-chain`、`grade CLEAN`，交付包内容

```
report.md  23,522 B      paper.pdf   303,390 B     paper.docx  52,033 B
sha256.txt  run-report.json  audit-trail.json  artifact-bodies.json
data/result.json  figures/F-COST.svg  figure-manifest.json
```

论文形态（`report.md`，逐章标题）：

```
摘要 / 问题重述 / 问题分析（统一框架 + ### 逐问归因） / 模型假设 / 符号说明
模型建立与求解（### 方程 / ### 模型 / ### 图）
  问题1：…（该问分析 + M1 目标 + EQ-1 + 该问结果表：RES-N1、RES-C1）
  问题2：…（该问分析 + M2 目标 + EQ-2 + 该问结果表：RES-C2）
  问题3：…   问题4：…
结果对比与校核 / 模型评价与推广 / AI 声明 / 参考文献 / 数据附录 / 代码附录
```

**逐问章终于带上"该问自己的数值"**，而且没有一章是空的——这正是参照物的分工
（分析章讲口径与方法，逐问章给该问的模型与结果）。

## 三、还没做到（诚实登记）

| 项 | 状态 |
|---|---|
| 目录（TOC）、公式/图表编号 | 未实现（参照物有） |
| 附录 A–D 分节（参照物把代码分到 A/B/C/D） | 未实现；现在是单节代码附录 |
| 逐问独立校核章（参照物「7 问题一模型的独立校核」） | 未实现；现在只有「模型校核」一节 |
| 摘要篇幅 | 参照物 1,374 字；当前由模型写 conclusion，未设参考值 |
| 单问题论文的逐问章 | 不适用（单问题就是整篇 R-OUT） |
| 真实运行验证 | **未做**（用户口径：形态对齐前不开实测）。本轮全部结论来自离线预检 |

## 四、回归

- `packages/paper/paper-foundation` + `apps/paper-shell`：**1629 测试全绿**（新增
  `tests/produce/per-question.spec.ts` 12 项、`blank_area` 4 项回归）。
- lint：改动文件与基线**同数**（238 errors，全部为仓库既有的 advisory 类）。
- 全仓 `vitest run`：15,688 项中 28 项失败，全部在**无关包**（sandbox/pwsh/e2b/
  client/acp-snapshot 等，平台相关；单独运行 `apps/paper-shell/tests/bundle` 全绿）。
