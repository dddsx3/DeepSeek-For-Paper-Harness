# W3 报告 — P0-4 题面与数据入口（PDF 直读 + 附件摄入 + 数据概况）

> 依据：DPH-PRD-v2 §5.1.1/§5.1.2（PDF 题面直读 + 数据附件摄入含数据概况）、§8 W3。
> 基线：W2 commit `4c96aeb7d5` 之后。本文档随 W3 批次提交。

## 1. W3 退出判据验证（PRD §8 原文）

> 3 道可见题全部进入建模阶段

**达成。** 3 道 dev_visible 题（2024 A/B/C）现在全部**从原始 PDF 直读**、经 `assembleBundle` 组装、进入引擎建模并交付：
- A 题（板凳龙，无附件）：`problem.pdf` → pypdf 提取 → 建模
- B 题（生产决策，无附件）：同
- C 题（种植策略，双 xlsx 附件）：`problem.pdf` + `attachment-1/2.xlsx` → 概况 4 列/2 列（含地块面积/亩 数值列与 53 缺失的"说明"列）→ 建模

## 2. 设计（对应 PRD §5.1 范围 1）

| 组件 | 落点 | 职责 |
|---|---|---|
| 数据概况脚本 | `scripts/summarize-data.py` | csv/xlsx → 紧凑 JSON 概况；**只描述不解读**（格式/编码/行列/列类型/缺失率/量纲疑点），建模仍是模型的事 |
| 打包器 | `apps/paper-shell/src/bundle.ts`（新） | PDF(→pypdf)/明文题面 + 0..n 附件 → 一份 `taskText`（题面 + `## 数据附件概况（自动生成）` 附录）；附件 sha256（采样哈希）+ 字节入返回值 |
| CLI | `apps/paper-shell/src/cli.ts` | `--data <file>`（可多个）→ `assembleBundle`；`run-report.json` 的 `attachments` 台账 |
| 引擎 | （零改动） | 仍然只消费文本——格式读取在 shell 侧 opt-in（F5 闭包：shell 负责读格式，引擎不依赖文件格式） |

**关键工程决策：**
1. **大文件安全**：概况脚本流式抽样（默认 2000 行，整文件解码/读取永不发生）；`sampleHash` 只哈希头 4MB + 尾 64KB。实测 **490MB 的 2024-E 附件 2 CSV 在毫秒级出概况**。
2. **编码探测**：UTF-8 → 失败回退 GB18030（中文赛题附件大量 GBK 编码）。490MB CSV 表头从乱码变正常："方向/时间/车牌号/交叉口"。
3. **量纲疑点启发式**：只标记"数字+≥2 字母单位后缀"或"裸 ≥1e7 纯整数"，显式标"疑点"不标"错误"；地块编号"A1"（1 字母）不误报。
4. **确定性**：概况脚本与 pypdf 对同输入都确定（无时钟/随机），保持 W1 的"同输入+同 seed → 同 IR"承诺。
5. **拒绝优先**（§7 非功能）：不支持扩展、空文件、非 UTF-8、空 PDF 全部以稳定错误码拒绝，零 token。

## 3. 测试与验证

- **bundle.spec.ts 11/11 全绿**（新）：明文透传、PDF 提取（2024-C 含"C 题/种植"）、拒绝路径（`.exe`/非 UTF-8/空附件/不支持附件）、概况合并（含 4 列/量纲疑点/缺失）、sha256+bytes 台账、大文件头尾采样哈希（改尾部标记 → 哈希变）、扩展名闭集
- paper-shell：**38/38 全绿**（27 历史 + 11 新）
- paper-foundation：1145/1145（W2 后未回归）
- 负对照：**18/18 全绿**
- `--data` 端到端：run-report 含 `attachments` 台账（2 个 xlsx 的 basename/sha256/bytes）
- 指标快照刷新：`bench/results/metrics-snapshot-w3.json`，MANIFEST 完整性校验仍过

## 4. 可见题真实数据概况（W3 测量）

| 题 | 附件 | 概况要点 |
|---|---|---|
| 2024-A | 无 | — |
| 2024-B | 无 | — |
| 2024-C | 附件1.xlsx | 4 列：地块名称(text)/地块类型(text)/地块面积-亩(numeric)/说明(text，53 缺失) |
| 2024-C | 附件2.xlsx | 2 列（抽样） |
| 2024-E（留出，仅验证不开发） | 附件2.csv | **490MB**，GB18030，199 行抽样，4 列（方向 numeric / 时间 text / 车牌号 text / 交叉口 text），量纲疑点 0 |

## 5. 遗留与下一步（W4）

1. **docx 是"明文透传"**：列出 `.docx` 但没做 docx 解析——docx 是 zip+xml 二进制，当前会被 `readProblemFile` 的 UTF-8 守卫拒掉。W4 大众档入口一并处理（或 W3 收尾补 docx 解压）。
2. **PDF 扫描件**：pypdf 提取为空时报 `PDF_TEXT_EMPTY`——OCR 不在 v1 范围（PRD kill list 未含 OCR，暂缓）。
3. **M-Bench 可见题留出纪律**：A/B/C 是 dev_visible，概况与调试合法；D/E 及占位题保持只看 sha256、不看内容（MANIFEST 完整性校验保证）。
4. **W4：大众档入口 + 路由**——单页零配置 + 方法族识别与拒绝（非支持域 zero-token 拒绝）。

## 6. W3 模块精读：executor.ts 第 1 周（§9 第 3/12 份，拆 3 周）

- **不变量**：`tierOf()` 是层级唯一读点（`#tierByRun ?? initialTier ?? T1`），W4 降级台账在 executor 内、不在外部（`executor.ts:438`）；EXECUTE 的 `produceFromExecute` 路径对节点输出有 `ir-container-v1` 协议约束，拒绝按失败类（NONE/DRIFT/ESCAPE）各配预算，ESCAPE 零重试。
- **我不同意什么**：`runNode` 里 T2/T3 引导路径与普通路径的 `text` 语义混在一个 `let text: string` 里，靠注释区分"这句是 harness 装配的容器"——建议给返回类型加判别联合（guided vs raw），让"这段代码不是模型写的"成为类型事实而非注释。
- **删掉它会坏在哪**：整个 plan→execute→review→revise→deliver 循环与 tier 降级都在这里——删掉等于重写引擎核心。
- **一句话对外**：引擎的"驾驶舱"——谁在哪一层、失败怎么分类、重试预算多少，全部在这一处裁决。

---

*W3 退出判据：达成（3 道可见题全部从 PDF 进入建模阶段）。W4 进入：大众档最小入口 + 题型路由与明确拒绝。*