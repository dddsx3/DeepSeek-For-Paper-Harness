# 首次真实产出实测报告（baseline-1 ~ baseline-4）

> 2026-09-21。用户批准"开始实测"后的四次完整真实运行（T1 / strict / fail-soft，
> 模型钉 `deepseek/deepseek-v4-pro`，输出预算 150k）。**结论：四次全部落在
> `B-e1-direct`（退化交付），未达 `A-produce-chain`；每次运行都暴露一个真实缺陷，
> 已修 4 类；第 4 次还暴露了一个必须优先修的严重缺陷（见 §4）。**

---

## 1. 四次运行总览

| 运行 | 路径 | 阻断点（逐次后移） | 修法 |
|---|---|---|---|
| baseline-1 | B-e1-direct | B3 正向：`参数为(p)的` vs `参数为p的`（括号）+ 半/全角逗号 → 三次全拒 | `foldForAnchorMatch` 增加标点归一 + 括号剥离；**旧断言"丢括号是内容差异"被真实证据推翻并显式记录** |
| baseline-2 | B-e1-direct | ① 容器被 ```json 围栏包住 → parse_failed（3 次里 2 次）② 代码把 `S-P1` 当裸对象键 → 语法错 → 无产物 → OUTPUT_SET_MISMATCH | ① `parseModelContainer` 剥一层围栏（内容仍须合法）② 教学：键含 `-` 必须加引号；诊断：mismatch 携带退出码 + stderr 尾 |
| baseline-3 | B-e1-direct | attempt 1 结论数字拒绝；attempt 2/3 `conflicting_id`（重试重发整容器，27/42 条同 id 内容不同——多为 `token p_1→p1` 写法差异）→ 重试死循环 | 同 run 内**首次声明为准**：重复 id 跳过并审计（superseded），保留 id 仍硬拒 |
| baseline-4 | B-e1-direct | ① 缺 `__dsh_paper` 版本标记 ② `CONFIG_EMISSION_TOKEN_UNRESOLVED`（链上）③ attempt 3 保真 B3 反向失败（E1 9 条假设未全声明）④ **交付物是题面原文** | ④ 已修（见 §4，结构守卫）；①②③ 待办 |
| baseline-5 | B-e1-direct | 同 ①②③ 量级（链上） | **交付物已恢复正常**：`# 建模分析稿（E1 直通交付）`，19 章，5 处占位 |

**进展是真实的**：保真门从"每次全灭"（baseline-1/2）→ "每次全过"（baseline-3/4），
阻断点从保真层后移到链上（配置发射、结论数字）。但离 A-produce-chain 仍有距离。

## 2. 四次运行的交付物形态

| 运行 | 章节数 | 占位符 | 字节 |
|---|---|---|---|
| baseline-1 | 19 | 5 | 20,426 |
| baseline-2 | 19 | 5 | 18,544 |
| baseline-3 | 20 | 5 | 30,246 |
| baseline-4 | **2** | 0 | 10,435 |

交付包（report.md / sha256.txt / run-report.json / deliverable.zip）与 attempts 归档：
`artifacts/handoff/baseline-{1..4}/`、`baseline-{1..4}.console.log`、`baseline-4.attempts.json`。

## 3. 待办（下一轮，按优先级）

1. **§4 的严重缺陷**（最高优先）。
2. `CONFIG_EMISSION_TOKEN_UNRESOLVED` 的拒绝理由没有进审计（只记了 code），
   模型看得到、事后核不了 → 按"模型可见 ⟺ 已记录"补 reason 到 provider_retry 审计。
3. 缺 `__dsh_paper` 版本标记：教学已写容器形状，但模型仍漏 → 考虑在 E2 提示里
   把容器首字段单独成行强调。
4. `no_placeholders` 预检已能正确拒绝退化稿（baseline-1 实测被拒）——这是**该闸门
   价值的直接证据**：退化稿不得当竞赛论文交付。

## 4. ✅ 严重缺陷已修（baseline-4 发现，baseline-5 验证）

**baseline-4 交付的 `report.md` 是题目原文**（`# 2024 年高教社杯…` + 题面 + 题面表 1），
末尾接 `## 附录：交付标注（自动生成）`（MARKED 附录）。这**不是** E1 分析稿
（E1 本体是 4255 字的合格分析，已落盘在 `paper_artifact_body.json` 的 `E1Analysis`）。

性质：**形态 1 假绿**——交付物看起来是一份文档，实际是题面复制，既不是论文也不是
分析稿。预检闸门会拒绝它（无 12 章骨架），但**交付动作本身就不该promote非论文内容**。

已知线索：
- `e1DirectFallback` 正常渲染 E1 到骨架（e1-direct.ts），baseline-4 的审计里
  `e1_direct_delivery` 也确实记了 `e1_chars: 4255`；
- 交付文本取的是 `current`（delivery-grade.ts 处的 `deliverableText`），来自交付流
  最后一个节点的文本——怀疑 EXECUTE 失败后 review/revise 链把题面文本带到了终点
  （同类现象在历史 persist 目录 `paper-shell-persist-7nqJcf` 也能看到：body 文本即题面）。

**根因**：交付流的 `current` 在 revise 轮被**编辑器输出直接覆盖**，而编辑器拿到的
提示里含 `Task: <题面>`，它把题面当 "corrected text" 返回 → 题面成了交付物。

**修法（已落地）**：新增纯函数 `revisionDestroysDraft(draft, revised)`——修订必须
保留草稿**全部章节标题**且篇幅不得塌缩到一半以下；违反则**拒绝该次修订**（保留上
一版）并审计 `RevisionRejected`（绝不静默）；编辑器指令同时收紧为"返回完整修订稿、
保留全部章节、绝不返回题面"。

**验证**：baseline-5 交付物已恢复为 `# 建模分析稿（E1 直通交付）`（19 章，5 处占位，
不再是题面）；3 条单元测试（题面冒充 → 拒 / 塌缩 → 拒 / 正常修订 → 接受）。

**残留**：5 处占位 → 预检 `no_placeholders` 正确拒绝导出（退化稿不得当论文交付）。
