# S5b 报告 —— 确定性阶段的执行体（§3.1）+ 导出引擎依赖（§3.2）

> **范围**：`HANDOFF-11-STAGE.md` 的 §3.1 与 §3.2。
> **基线**：`801235a8d2`（2021 通过 / 3 显式待办）　**结果**：**2061 通过 / 0 待办**，`tsc -b tsconfig.host.json` 干净。
> **编制**：2026-09-24

---

## 1 做了什么

### 1.1 四个确定性阶段的执行体（§3.1）

| 阶段 | 新模块 | 判据 |
|---|---|---|
| 4 图表生成 | `stages/figure-render.ts` | 读 `03-code/FIGURE_DECLARATIONS.json` → 复用 `figure/renderer.ts` 取数渲染 → 写 `figures/*.svg` + `figure-manifest.json` |
| 5 流程与架构图 | `stages/diagram-render.ts` | 读 `PROBLEM_ANALYSIS.md` 的 `FIGURE_MANIFEST` + 新增的 `ARCH_DECLARATION` 块 → `figure/architecture.ts` 渲染 → `diagram-manifest.json` |
| 10 格式自检 | `stages/format-check.ts` | 五类检查 + **三类逐字可比的安全修复**（就地改 `paper/main.md`，修复前副本落 `_before/main.md`）→ `DOCX_FORMAT_CHECK_REPORT.md` |
| 11 导出 | `stages/docx-export.ts` | 校核 → SVG→PNG 栅格化 → 迁移进来的引擎渲染 → `paper/main.docx` + `DOCX_EXPORT_REPORT.md` |

总入口 `stages/deterministic.ts`（`deterministicRunner()` 一行接线），`stages/figure-manifest.ts`
（`FIGURE_MANIFEST` 的**唯一**解析器，阶段 4/5 与门禁共用）。

### 1.2 五条门禁从 `2` 变成真判据

`figure_manifest_reconcile`、`figure_declaration_complete`、`diagram_manifest_reconcile`、
`diagram_geometry`、`docx_precheck` —— 它们要的输入（机器可读的清单、声明、SVG 字节）
现在都由阶段 4/5/11 真的产出了。另新增 `figure_style_rules`。

未实现的判据从 10 条降到 **5 条**（`capability_check` / `modeling_coverage` /
`modeling_self_check` / `delivery_audit` / `paper_claim_check`），且这份清单是
`gates.spec.ts` 里的**断言**——实现一条就得删一条。

### 1.3 运行器补齐了两处"这一列的意义没落地"

- `produces` 那一列原本**没人核**：一个什么都没产出的阶段会因为"门禁恰好没查那个文件"
  而拿到 `passed`。新增 `stage_deliverable_missing`（跑门禁**之前**判）。
- 目录型产物对门禁**不可见**（`stageFilesOf` 直接 `continue`）。现在展开目录，
  于是"计划里的图都渲染出来了吗"这类判据才有对象。
- 顺带：`GateInput` 增加 `sizes`（真实字节数）——`docx` 是二进制，按 utf8 读出来的
  长度不是它的体量，而"产物是不是空壳"这个判据只该有一个来源。

### 1.4 §3.2 导出引擎的三个依赖

`docx` / `fast-xml-parser` / `temml` 已装进 `packages/paper/paper-foundation`
（不是仓库根：引擎从自己的目录 `require`，装在包里就够）。**已实测跑通**。
`stage-assets.spec.ts` 里那条"还没装"的断言换成了**从引擎目录能不能解析到它们**
——"装在哪儿"不是判据（pnpm 的工作区布局会变），"引擎 require 得到吗"才是。

### 1.5 台账：两条缺口收敛，一条如实保留

`missing`：3 → **1**。
- 图表规范（`plot_utils.py` 的 `setup_style`）→ `figure_style_rules` 门禁，已闭合；
- 导出引擎 → 依赖已装，已闭合；
- **附件画像器（`data_profile.py`）仍然缺**，但缺的**不是算法而是接线位置**：
  阶段 1 是模型阶段，`runStages` 对它只调 `callModel` 并落盘，没有 harness 侧钩子。
  写一个用不上的 TS 画像器正是"模块做好 ≠ 进了主线"，所以**不假装适配**。

---

## 2 新判据抓到的问题（根因，不是"我改对了"）

新增的门禁第一次跑就撞出四个**真缺陷**，都不是本次新写的代码：

| # | 错误形态 | 根因 | 谁抓到的 |
|---|---|---|---|
| 1 | 纵向架构图**节点越出画布**（四层图最后一层 y=912，viewBox 高 564） | `computeArchitectureLayout` 纵向分支的层间距用了 `nodeW + gapMain`（横向分支的拷贝），应为 `nodeH + gapMain`。既有用例**全用横向**（`direction` 缺省），纵向分支从没被跑过 | `diagram_geometry`（第一次跑纵向） |
| 2 | 数据图**图内出现标题** | `renderer.ts` 的标量路径把 `caption` 画进了 SVG，而模块头的契约写着"本渲染器因此从不输出 caption 到 SVG 内部"——**代码与自己的契约相反**。契约是对的（参考禁 `plt.title`） | `figure_style_rules` |
| 3 | 阶段 3 的逐问代码文件**对门禁不可见**，`code_parity` 判 1 | 注册表写 `code/`（人读友好），拼接时没剥尾斜杠 → 键成了 `code//problem1.py` | 端到端链跑通时撞出 |
| 4 | 阶段 11 的 docx **写到了正文的路径上** | 输出路径错用 `PAPER_MAIN`（`paper/main.md`）。产物"存在且体量够"，但声明的 `paper/main.docx` 没产出 | 新增的"声明的产物齐了没有" |

第 4 条尤其值得记：**在加那条检查之前，这条缺陷是"通过"的**。

## 3 测试侧我自己的失误（4 次，照 §5.1 的模式）

第一次跑就红，全部是"断言写成了我以为的"：

1. 断言 `detail` 含 `没有数据图条目`，实际措辞是 `没有任何数据图条目`（凭记忆写期望值）；
2. 把"中轴漂移"写在 **x** 上——纵向展开的对齐不变量是 **y**，门禁（正确地）给了 0；
3. 断言"门禁 detail 里会出现文件名 `figures/fig_a.svg`"，而门禁的措辞是
   "计划 1 张数据图，全部渲染"——**没有文件名**；
4. "删掉执行体 → 应失败"的用例在**已经跑完整条链的 root** 上测——那里图与清单
   已经躺在磁盘上，于是它（正确地）按 resume 语义通过了。改成只播种阶段 1..3。

对策已照 §5.1 执行：失败信息里带实际值、路径只从被测模块导出、字节与字符不混用。

---

## 4 一处**已知的构建缺口**（留给 S6，不静默绕过）

本包产物是打包过的 `lib/index.js`，而 `src/stages/{assets,skill-docs}`（含 809KB 语料、
图模板、样式档、导出引擎）是静态资源——**构建不会把它们复制到 `lib` 旁边**，
仓库里也没有这个约定（已核实：没有任何 `tsdown.config.ts` 用 `copy`）。

所以 `stages/asset-dir.ts` 做**显式两段解析**：① 模块旁边（src 布局，唯一"资产随产物走"
的正确形态）；② 回退到源码树（lib 布局）。**两处都没有就抛错并点名构建问题**，
不返回空目录——空目录会让"资产没打包"变成"资产是空的"。

`asset-dir.spec.ts` 用临时目录把两种布局都钉住了。但**回退是回退**：
正确形态仍是构建把资源复制过去。这一步没做，因为改根 `tsdown.config.ts` 会波及全部
workspace 包，而按包加配置会丢掉根配置里的 typert 插件——那是 S6 该一起决定的事。

---

## 5 剩下的（§3.3–§3.5，未动）

- **§3.3 S6：CLI 接线**。`runStages` 还没进 `apps/paper-shell/src/cli.ts`，
  所以 `stages/**` 整个子树**不在** `lib/index.js` 里（`grep docx-profiles lib/index.js` = 0）。
  接线时要一起定"资产怎么进产物"（见 §4），以及 `stage-checkpoint.ts` 的 5 阶段表
  与 11 阶段表的对齐。
- **§3.4 逐阶段与参考并排比对**。
- **§3.5** 台账里剩的那 1 项（附件画像器，需先给阶段执行器加 harness 侧后处理钩子）。
- 未实现门禁 5 条，最高优先级仍是 `paper_claim_check`（阶段 7 前提的机械强制手段）。

---

## 6 验证

```bash
npx vitest run packages/paper apps/paper-shell     # 2061 通过 / 0 待办（171 文件）
npx tsc -b tsconfig.host.json                      # 干净
```

**新增/改写的测试**（都带"为什么这条判据重要"的注释）：

- `tests/architecture/stage-runner.spec.ts` —— 20 条，3 条 `it.skip` 转正 + 6 条执行体专项；
  确定性阶段用**真执行体**（不是假夹具），并解压 docx 断言图真的嵌进去了。
- `tests/architecture/gates.spec.ts` —— 38 条，新增对账/风格/几何/校核四组。
- `tests/architecture/asset-dir.spec.ts` —— 5 条，钉住两种布局 + 缺资产抛错。
- `tests/architecture/stage-assets.spec.ts`、`adaptation.spec.ts` —— 断言随事实更新。
