# W2 报告 — P0-3 交付门槛（CLEAN / MARKED / BLOCKED）落地

> 🔴 **2026-09-22 架构改造提示**：本报告是**当时**的实测记录，其中"`strict-tolerance` 是默认档位"已不成立——默认已反转为 `fail-soft`。现行架构见 [`../docs/upper-bound-architecture.md`](../docs/upper-bound-architecture.md)。

> 依据：DPH-PRD-v2 §3.3（fail-soft 交付门槛）+ §8 W2 退出判据。
> 基线：W1 commit `7345763bde` 之后。本文档随 W2 批次提交。

## 1. W2 退出判据验证（PRD §8 原文）

> 构造一篇"有内容但有未过项"的稿 → 能 `MARKED` 交付

**达成。** `tests/delivery/delivery-grade-fail-soft.spec.ts`（3/3 过）：
- 222 字真实中文决策论文草稿 + 4 轮存续 critical 缺陷（"结论缺少数值依据"）→ run 终态 `completed`、manifest 存在、审计 `delivery_graded: MARKED`——**交付发生，没有被门拦住**；
- 干净评审 → `CLEAN`（fail-soft 不发明标注）；
- 空稿 → 仍 `BLOCKED`（致命条件 1：内容为空），错误信息含 `fatal content probe`。

## 2. 设计与实现（对应 PRD §3.3 三个设计要点）

| 组件 | 落点 | 说明 |
|---|---|---|
| 判定函数 | `src/delivery/delivery-grade.ts`（新，~150 行） | 纯函数 `gradeDelivery`：致命清单**封闭**（空内容 / 执行失败 / 引用崩溃），未知失败种类只能落 MARKED 标注、不能造出新的 BLOCKED 理由；`renderDeliveryAppendix` 渲染附录（管道符转义防表格断裂）；`contentExists` 是 200 非空白字符探针 |
| 附录标注 | 同上 | **附录、非正文内联**（设计要点 1）；每项含 检查项/位置/原因 三列 |
| executor 接入 | `src/executor.ts` 主交付路径 | review 未过项 + `evaluateDelivery` 失败项**汇入同一条分级判定**（`gradeDelivery` 是唯一裁判，无平行判定路径——遵守仓内 INV-3-K 禁令）；MARKED 时交付文本 = 正文 + 附录；promoter 收到 `{allowed: true}` 的分级决策（附录已含失败清单，产品不说谎） |
| 审计 | `src/audit.ts` 新事件 `delivery_graded` | 每次 run 的等级（CLEAN/MARKED/BLOCKED）入审计流——MARKED 交付在证据链上与 CLEAN **可区分**（§7 无静默降级） |
| 配置 | `ExecutorConfig.deliveryGradeMode` | `'strict-tolerance'`（默认，历史 fail-closed 逐字节保留）\| `'fail-soft'`（大众档）。两档共用同一引擎与证据链，差别只在门槛（PRD §3.1） |
| CLI | `apps/paper-shell/src/cli.ts` | `--fail-soft` 开关；`run-report.json` 新增 `grade` 字段（M-Bench M1 分档的数据源） |
| 指标侧 | `bench/metrics/compute-metrics.mjs` | `deliveryGrade` 优先读 `grade` 字段，旧报告回退 status 映射 |

## 3. 关键工程决策（为什么这样改）

1. **strict-tolerance 逐字节保留历史行为**：初版实现让 fatal probe 在两种模式下都生效，导致 21 个历史测试失败（短测试稿被判空）。修正后 strict 模式完全不看 fatal probe——有失败即 BLOCKED、无失败即 CLEAN，与 `b34c0b7` 的行为一致。**fail-soft 是显式 opt-in，不是默认改写**——这也符合 PRD"审计能力保留为资产，只是不再是默认门槛"。
2. **门不再决定"是否交付"，但仍全部运行**：`enforceDelivery` 照旧走 9 道门，失败照旧入审计；变化只在终态解释权——分级函数把"未过项"翻译成 MARKED 标注。R1-R4 的事实回答（W1 报告 §3）不受影响：那 4 次全部命中致命条件，fail-soft 下同样 BLOCKED。
3. **`promotionDecision` 只在 MARKED 时替换**：promoter 契约"必须 allowed"未被破坏——MARKED 的 allowed 是分级函数的裁定（附录已携带失败清单），不是绕过；BLOCKED 在此之前已 throw。

## 4. 测试与验证

- paper-foundation：**1145/1145 全绿**（1142 历史测试 + 18 项 delivery-grade 单测 + 3 项 fail-soft 验收 - 重复计入的 18 → 净增 21 项；其中 4 个历史断言更新：2 处 `failed its review gate`→`blocked at delivery grade BLOCKED`（同一失败点的新文案）、2 处审计事件过滤表加 `delivery_graded`）
- paper-shell：27/27 全绿
- 负对照：18/18 全绿（NC-1 的 MARKED/CLEAN 分档与新 `grade` 字段贯通验证）
- 端到端：`--fail-soft` fake run 交付，run-report 含 `"grade": "CLEAN"` + `delivery_graded` 审计事件

## 5. 遗留与下一步（W3）

1. **执行失败/引用崩溃探针当前是占位 `false`**：executor 里 `executionFailed`/`referenceCatastrophe` 尚未从 run 事实推导（需要 execute 阶段的失败信号与 IR 的 Result 解析率——分别依赖 W5 契约层与 W3 数据概况后的引用检查）。判定函数本身已封闭支持，接线是后续工作。**诚实的现状：当前 fail-soft 的 BLOCKED 只由"空内容"一条触发**。
2. **cockpit 尚未暴露门槛开关**：大众档入口（P0-10，W4）会把 fail-soft 设为 UI 默认。
3. **M-Bench 的 `grade` 字段**：W12 真测时 MARKED 率与 CLEAN 率必须分列（预注册表 §C 已冻结此要求，指标侧已支持）。

## 6. W2 模块精读：workflow.ts（§9 第 2/12 份）

- **不变量**：run/node 状态转换全部经 `state-machine.ts` 断言；事件按 `seq` 全序追加（appendPublic/appendInternal）；manifest 只在 `delivery_authorized` 事件存在后可记录（RT125B-03）。
- **我不同意什么**：`nodeRecord.attempts` 的递增与 run `failed` 终态的写法——节点失败与 run 失败在同一层混判，executor 里 run 级 throw 与 node 级 attempt 消耗的边界靠注释维护而非类型。建议后续把"node 级可重试失败"与"run 级终态失败"分成两个显式错误类。
- **删掉它会坏在哪**：事件溯源/崩溃恢复/replay 全靠它——不可删。
- **一句话对外**：运行的"流水账账本"——每个节点每一步谁干了什么，崩溃后能精确续跑。

---

*W2 退出判据：达成（MARKED 交付验证通过）。W3 进入：题面与数据入口（PDF 直读 + 附件摄入 + 数据概况）。*
