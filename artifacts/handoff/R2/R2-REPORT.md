# R2-REPORT — 格式链（第一批：预检框架 + text_profile 派生）

> 路线书 R2 批次第一子批，2026-09-21。**低消耗验证**（单元/作用域测试），
> 未跑完整论文产出（等用户批准）。R0/R1 结论：R1 推送待网络恢复。
>
> **批次边界**：本批做 R2①（text_profile 派生）+ R2②（导出前校核框架与
> 十五类机械检查）+ R2⑥（退出码契约 0/1/2 落地）。**未做**：R2③ 自动修复
> （依赖修复器实现；N30 不变量已在设计上预留）、R2④ OMML、R2⑤ 依赖入
> manifest——登记为下一子批。

---

## R2① text_profile 派生 — ✅（`src/delivery/text-profile.ts` + 4 测试）

- schema 照 §1.2：`page/fonts/headings/body + _derived_from + _matched_items`；中文字号表 12 项（初号 42pt … 小五 9pt）。
- 从纯文本格式要求（如"题目三号黑体居中；一级标题四号黑体；正文小四宋体，单倍行距"）派生结构化 profile。
- **判据达成**：同要求两次派生逐字节一致（确定性）；只把"说了的"填进 profile，
  没说的保持默认并在 `_matched_items` 记 `matched:false`（绝不猜）。
- **修 bug 记录**（正是测试抓到的）：① 字号/字体匹配必须限同一分句（跨 `；。` 会让
  题目的三号漏进正文）；② 捕获组吃进可选 `号` 导致 `三号号` 查表失败；③ 字号表
  `小X` 键漏写 `号`——三个都是测试负对照按纪律抓出来的实现错误。

## R2② DOCX 导出前校核 — ✅ 框架 + 十五类机械检查（`src/delivery/docx-precheck.ts` + 10 测试）

- `DOCX_CHECK_CODES` 闭集 15 类：图片引用数 / figures 文件数 / 图引用可解析 /
  题注独占行 / 标题层级连续 / 表格列对齐 / 表格题注 / 块公式数 / 行内公式数 /
  公式定界符配对 / 引文条数 / 引文号可解析 / 正文字数 / 正文非空 / 章节骨架齐备。
- 每类输出 `{code, status: 0|1|2, detail}`；`docxPrecheckVerdict` 汇总 **0 致命才允许导出**。
- **每类均配 正例 + 负例**（路线书 R2② 判据）：完备稿零致命；悬空图/标题跳级/
  表列数不一/定界符不配对/空正文/缺章节/引文无列表（各负例必红）；无图无表/无引文
  → status 2 **无据可查不误杀**（§5.5.2 增量 3 反假红落地）。

## R2⑥ 方法论落地 — ✅（随 R2② 一并）

- **退出码契约 0/1/2** 以 `CheckExitCode` 类型 + 每类检查语义固化（1=确凿错误阻断导出；
  2=缺上下文注明；只有"合同齐全+确凿违反"才计 1——防老式子误杀）。
- **完成铁律**（增量 4）在 harness 层已有每轮 REPORT + 字节下限形态（W11.5 报告族），
  本批预检的 `detail` 携带统计数，供"没问题也要写报告"的导出前报告直接引用。

## 未做（诚实登记）

| 项 | 说明 | 状态 |
|---|---|---|
| R2③ 自动修复不改语义（N30） | 需要自动修复器实现后才能测"修复前后去格式逐字一致" | 下一子批（随 R5 骨架或独立修复器） |
| R2④ LaTeX → OMML | 依赖 docx 导出链扩展 | 下一子批 |
| R2⑤ 依赖入 manifest（cairosvg/pandoc） | 导出脚本已用 cairosvg（`export-docx.py`）；manifest 化待 R5/R7 | 下一子批 |
| R2② 接入导出管线（0 致命才真正停止导出） | 本批给可判定检查层；接 `export-docx.py` 闸门待 E2E 批准批次 | 待批准 |

## 回归

- paper 域作用域：**136 文件 / 1561 测试通过**（1 项并行负载环境 flake=
  bundle.spec xlsx 子进程，隔离通过且 R2 零触碰其代码）
- tsc 双包 clean；lib 重建 + 来源守卫 ok=true
- 新增测试：docx-precheck 10 / text-profile 4（全配负对照）

## 反例清单

| 断言 | 变红操作 |
|---|---|
| 图引用可解析 | report 引用不在 figures/ 的文件 |
| 公式定界符配对 | 一个未闭合的 `$` |
| 引文可解析 | 正文 [n] 无文献列表 / 越出列表 |
| 章节骨架 | 缺少必需 H1 |
| 断言"说的才填" | 要求文本没提 3/4 级标题字号而 profile 声称有 |
| 确定性 | 同要求两次派生字节不同 |

## 下一子批

R2③ 自动修复器（含 N30 逐字比对测试）→ R2④ OMML → R2⑤ 依赖 manifest →
预检接入 `export-docx.py` 闸门（0 致命才写出）→ 随后 R3 图表链。完整论文产出
运行（闭合 R1 CLI 判据 + 挡位时长实测 + R2 导出链闸门）等待用户批准。
---

## 第二批（R2③ 安全格式修复 + R2② 导出闸门 + R2⑤ 依赖 manifest）— ✅ 完成

**R2③ 自动修复器 + N30**（`src/delivery/format-fix.ts` + 5 测试）：
- `applySafeFormatFixes` 白名单四类演示层变换：CRLF→LF / 行尾空白 / 连续空行折叠（仅正文区）/ 题注独占行拆分；代码块内容逐字保留（fence 感知）。
- `stripFormat` 去格式：剥 markdown 语法 + 空白、代码逐字；与修复器同款换行归一。
- N30 判据机械钉死：`stripFormat(fix(doc)) === stripFormat(doc)`，语料含全部预检负例 + 触发全部四类修复的样本 + 代码块内空行/行尾空白的守卫；幂等（再修不再变）。测试按纪律抓到 1 个实现错误（尾部换行再追加破坏幂等）。

**R2② 导出闸门 + CLI**（`docxExportGate` + `paper-shell docx precheck <report.md> <figures-dir>`）：
- `docxExportGate(verdict)`：`allowed = 非 fatal`——0 致命才允许导出的机械落点。
- CLI 三态实测：完整稿 exit 0（15 项全 ✅）；悬空图/缺章 exit 1；用法错 exit 2。
- 完成铁律（增量 4）：无论通过与否都写出 `docx-precheck-report.md`（含 15 行逐项统计）——"没问题也要写报告"。

**R2⑤ 依赖 manifest**（`src/delivery/export-deps.ts` + 3 测试）：闭集 `EXPECTED_EXPORT_DEPS`（python-docx / cairosvg / pandoc，各带 probe 与用途）+ `probeExportDeps`（每依赖 0/1/2，永不抛）+ `exportDepsSummary`（缺一即 notReady）。

**回归**：paper 域 **138 文件 / 1570 测试全绿**（无 flake）；tsc clean；lib 重建 + 守卫 ok。

**仍待下批**：R2④ LaTeX→OMML（走 pandoc 通道）、预检接 `export-docx.py` 真闸（脚本层 gate 调用 `docxExportGate`）、完整 E2E（等批准）。
