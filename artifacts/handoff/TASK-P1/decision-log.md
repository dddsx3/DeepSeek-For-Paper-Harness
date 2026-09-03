# TASK-P1 — decision-log（冻结稿与执行记录）

> 作者 2026-09-03 委托连续执行；本文件记录需要作者复签的冻结决策（偏离即回读）。

## D1. requirement 覆盖闭包 A7 v0（P1-4，task book §P1-4）
- 冻结：ProblemSpec 的每个 REQUIRED_OUTPUT 需被"distinct reaching CRITICAL result"支付；判据沿 Claim(CRITICAL)→result_refs→Result→run→model→problem_refs。N 个 REQUIRED_OUTPUT 需 ≥N distinct reaching results（文本↔结果一一对应在 IR v1 不可判定 → 取保守 COUNT 界，fail-closed；对应缺口记 known-risks，P3 收窄）。多子问题 = 多 ProblemSpec 各自闭合。SUBPROBLEM/CONSTRAINT 不参与 v0（reviewer 域）。
- 推荐默认已实现（delivery/requirement-coverage.ts）。作者复签栏：☐ 批准 / 修改：____

## D2. numeric 一致性精确比较（P1-3，R1-3 已在 5.0-R 冻结）
- 精确 `a===b` + 单位相等，无容差/单位注册表（4.4/P3）。已实现。无复签项。

## D3. figure_data_consistency 与 P1-5 FORMAL demo 的矛盾（task book P1 §2.2 vs §P1-5）
- 任务书 G-2 要求 figure 门维持 UNIMPLEMENTED（8 real + 1），但 P1-5 要求 FORMAL run 交付；FORMAL 下任何 UNIMPLEMENTED 门都 producer_unimplemented BLOCKED → demo 永不交付。
- 执行方裁决（作者委托连续执行）：figure 门实现为 **vacuous v0**：store 无任何 FigureSpec → PASS（无数据可查，P2 前无约束）；store 有 FigureSpec → 维持 BLOCKED（P2 语义未定义，fail-closed）。gates_impl 同步标 real（8+1→9 real 会偏离任务书 G-2 计数）。
- **需要作者复签**：A) 接受 vacuous v0（9 real，demo 可交付，P2 实现真校验）；B) 维持 UNIMPLEMENTED（demo 改 EXPLORATORY/延迟 FORMAL）。推荐 A。作者：☐ A / ☐ B / 修改：____

## D4. Claim 生产（P1-3 数字闭环前置）
- 模型容器禁带 Claim（P1-1 白名单）；Claim 由生产组件基于 Result 与模型 interpretation 构建（P1-3）。未在本批实现到 demo 全链——数字闭环端到端依赖 demo 的 interpretation 步骤（P1-5 demo 范围）。记录为剩余项。
