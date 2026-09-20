# R5-REPORT — 论文成型链补齐（首次真实产出前的全链验证）

> 2026-09-21。用户裁决：**首次真实产出不是测试，而是 baseline**——所以先把
> "正式论文产出"的每个环节接上并用**零模型 dry-run** 走通，再花那次机会。
> 本批全部为低消耗验证（单元/作用域测试 + 无模型 dry-run），**未跑真实产出**。

---

## 交付的缺口与补齐

| 缺口（真实运行会暴露） | 补齐 | 判据 |
|---|---|---|
| 骨架 10 节，与路线书 D3（12 章 + 摘要 + AI 声明 + 参考文献 + 附录）不符 | `PAPER_SECTIONS` → **12 节**（摘要/问题重述/问题分析/模型假设/符号说明/模型建立与求解/**结果对比与校核**/模型评价与推广/**AI 声明**/参考文献/**数据附录**/代码附录）+ `PAPER_SECTION_TITLES` 供闸门复用 | 骨架测试 12 节全渲染 |
| 摘要/结果/AI 声明/数据附录 全是 `_(模型待写入)_` | 渲染器自动生成：**摘要**（`synthesize-abstract`：数字全部回读 Result/不确定度，外部数字整段拒绝）、**结果对比与校核**（结果表 + 结论 + 校核声明）、**AI 声明**（固定文本无数字）、**数据附录**（执行输出文件表，按名排序确定性） | 4 条摘要测试（含外部数字拒绝负例）+ 确定性 |
| 散文章节（问题分析/评价/参考文献/代码附录）真实运行会留空槽 | narrative 支持 `restatement/analysis/evaluation/references/code` 五个散文章节；**新增预检类 `no_placeholders`（第 16 类）**：稿子仍带占位 → 致命，不得导出 | 预检 16 类；教学行同步（容器须提供散文章节） |
| precheck 只认 H1，而渲染骨架章节是 H2 | `skeleton_present` 改为 **H1/H2 都算章节存在**，默认清单直接取 `PAPER_SECTION_TITLES` | 预检正例/负例 |
| 交付包无法带 docx（二进制） | `zipMixedFiles`（文本 + 任意字节，STORE 确定性）；论文交付契约 `docs/paper-deliverables-contract.json`（5 项：report.md / paper.docx / run-report.json / figure-manifest.json / result.json） | zip 混合字节 + 契约 verify |
| 导出链无闸门 | CLI **`docx export`**：依赖探测（`required` 区分硬前置/可选）→ **precheck 0 致命才允许** → 真导出器 `scripts/export-docx.py` → 产物存在且 >1000B 才算成功 | 三态实测（拒绝/成功/用法） |
| 依赖探测误报 | probe 从"按空格切分的字符串"改为 **argv 数组**（引号曾被打散 → 三个依赖全部误报"无法判定"，实测抓到）；pandoc 标记 `required:false`（只服务 OMML 通道），避免假闸 | 探测实测：python-docx ✅ / cairosvg ✅ / pandoc 缺但不阻断 |

## 无模型 dry-run（`artifacts/handoff/R5/paper-chain-dryrun.mts`）— **6/6 全通**

```
[1] 渲染 12 章主稿（真 renderer，数字来自 Result）      → report.md 12 章
[2] docx precheck（16 类）                              → 0 致命，允许导出
[3] docx export（依赖 → 闸门 → export-docx.py）          → paper.docx 40,491 B
[4] DELIVERABLES 契约 verify（5 项）                     → OK
[5] 交付包 zip（含二进制 docx）                          → deliverable.zip 51,082 B（8 成员）
[6] 汇总                                                → 链条全通
```

产物在 `artifacts/handoff/R5/dryrun-out/`（report.md / paper.docx / deliverable.zip / figure-manifest.json / docx-precheck-report.md）。

**这次 dry-run 抓到的三个真问题**（都不是"装饰性测试"）：
1. **数据附录把 run id 写进了论文**（`file:///runs/<runId>/result.json`）——既泄漏又破坏跨运行字节确定性（T1/T2 等价性测试当场变红）；改为只列文件名。
2. **依赖探测引号被空格切分**，三个依赖全部误报"无法判定"。
3. **pandoc 缺失会让今天的导出被拒**（假闸）——加 `required` 区分。

## 回归

- paper 域 **139 文件 / 1574 测试全绿**（含 T1/T2/T3 等价性、骨架 12 节、摘要 D4 守卫、预检 16 类）
- tsc 双包 clean；lib 重建 + 来源守卫 ok=true

## 仍未接（诚实登记）

| 项 | 说明 |
|---|---|
| R2④ LaTeX → OMML | pandoc 通道；本机 pandoc 缺失（探测已登记） |
| R3 图表链（TikZ/图版质量门/表数据核对） | 下批 |
| 挡位时长实测 | 需真实运行（等批准） |
| 真实运行里散文章节的产出质量 | dry-run 用的是合成散文；真实运行由模型产出，质量受 §5.5 复核链约束 |

## 首次真实产出的前置条件（已就绪清单）

1. 生产链产出 12 章主稿（骨架 + 自动摘要 + 自动节 + narrative 散文）✅
2. 预检 16 类 0 致命才允许导出 ✅
3. docx 导出链可用（python-docx + cairosvg 本机在）✅
4. 交付契约 5 项可校验 ✅
5. 交付包可含 docx/图（二进制）✅
6. 数字回读（D4）在摘要与结论两处机械守卫 ✅
