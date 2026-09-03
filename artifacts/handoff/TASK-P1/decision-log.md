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
- 模型容器禁带 Claim（P1-1 白名单）；Claim 由生产组件基于 Result 与模型 interpretation 构建（P1-3）。**已实现并跑通 demo 全链**（produce/interpretation-producer.ts + produce/report-renderer.ts；三个 FORMAL leaf 的 Claim 数值从真实执行字节复制）。关闭。

## D5. 关键数字全集冻结 + 结论区守卫规则（P1-3 实现裁决，run-leaf 实证修正）
- renderV1Report 结论区守卫：结论中任何十进制字面量必须等于某 Result 值或其 uncertainty（机器数，仅由 IR 注入）。单位指数（'km^-1'）与 'x-'/'^-' 有符号片段被边界排除；±uncertainty 字面量计入允许集。超集自由书写 → rendering refusal（fail-closed，永不静默改写）。
- 实证修正：初版把 'km^-1' 的 '-1'/'1.' 当 prose 数字误杀 → 双 lookbehind 边界 + uncertainty 允许集（2026-09-04，RIDGE-DENSITY leaf）。无复签项。

## D6. bridge claims 参数的声明语义（P1-1 接线修正，真链实证）
- ir_canonicalization 的 claims 参数语义是"对象声明 {artifact_id, ir_kind, ir_ref}"；P1-1 接线曾把 Claim 记录 value 当 claims → 全部 unreadable。修正：collectStoredClaims 为每个 canonical 记录派生一条自声明（逐 id 登记核对）。无复签项。

## D7. FORMAL demo 的执行形态（pipeline composition，非 executor 内嵌）
- 任务书 P1-2 描述 "EXECUTE 经 firewall 请求 code-run"（executor 的 EXECUTE 节点内嵌 code-run + interpretation 整链）。为隔离回归面并保持 executor 的 agent 语义，P1-5 demo 采用**显式 pipeline composition**（demo/run-p1-demo.mjs：容器 → code-run → interpretation → render → FORMAL 九门 → 落盘 sha256）作为权威端到端路径；executor produceFromExecute 目前只做容器→store + 审计，**未**内嵌 code-run/interpretation。
- **诚实边界**：executor 内嵌整链 + firewall capability code-run 白名单 = P2 项；真实 provider 遵从率（≥20 次调用）未在本批采集（P1-5 用确定性 fake provider/固定 seed keyless）。已记 known-risks。
- 作者复签栏：☐ 接受 D7（P1 以 pipeline 形态收口，executor 内嵌推 P2）/ ☐ 要求先做 executor 内嵌再收口 P1。推荐接受。

## 状态（2026-09-04）
- D1 已实现待复签；D3 已实现（vacuous v0）待复签；D4/D5/D6 已实现无复签；D7 待复签。
- 作者复签入口：D1 ☐、D3 A/B ☐、D7 ☐。
