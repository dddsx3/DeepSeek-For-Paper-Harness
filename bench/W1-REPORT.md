# W1 开工报告 — M-Bench 度量系统落地（P0-1 + P0-2）

> 依据：DPH-PRD-v2 §4（度量系统）、§8 W1 硬门禁、§6.1 P0-1/P0-2。
> 代码基线：`b34c0b7b5180f6239c6c49333c0a7822c804602f`（与 PRD 审计一致）。
> 本文档回答红队回合 2 建议攻击点中的 #2 与 #6（按"直接用事实回答"指示）。

## 1. 交付物清单

| PRD 要求 | 落点 | 验证 |
|---|---|---|
| M-Bench 冻结（12 题 + sha256） | `bench/MANIFEST.json` + `bench/problems/`（2024 A–E 原始 PDF/附件入库，5 题 11 文件） | `compute-metrics` 的完整性校验逐文件比对 sha256，全过 |
| 预注册表冻结 | `bench/PREREGISTRATION.md`（题目分层、判定标准 §B、指标判定式 §C、反作弊 §F 先写死） | 运行前冻结；判定标准在第一次 W12 运行前不可回改 |
| 指标可一键计算 | `node bench/metrics/compute-metrics.mjs`（M1/M2/M3a/b/c/M4/M5，逐题+分族+分档，禁跨族汇总，无计价显式 null） | 已对 3 道 dev_visible 题真实产出结果集并计算 |
| 每指标有负对照脚本 | `node bench/negative-controls/run-all.mjs` — **7 组负对照 / 18 项检查** | 全部 PASS（每项都证明了"操作 → 指标变红"的链条成立） |
| T3 退出默认路径（P0-2） | `cli.ts`（CLI 默认 T1）、`invoke.ts defaultShellPolicy`、`cockpit/server.mjs`、`index.html`（T3 标注"固定填充面（回归用）——不读题面，勿用于真题"） | 不带 `--tier` 的 fake run 现在走 T1；`demo:pw`（显式 T3）回归通过；paper 测试 1124/1124 全绿 |

**W1 硬门禁判定：达成。** 7 组负对照（NC-1 分层/禁汇总、NC-2 复述必降、NC-3 静默数字错误必升、NC-4 人工介入必降/假 $0 必报 null、NC-5 骨架缺失必降、NC-6 DataArtifact 拒绝时 M5=0、NC-7 篡改必被检出）全部能把对应指标变红。

## 2. 第一次真实测量（fake provider，T3 路径，dev_visible 3 题）

`bench/results/metrics-snapshot-w1.json`：

| 题 | 族 | 交付等级 | M1 可读初稿 | M2 静默错误 | M4 骨架率 | M5 |
|---|---|---|---|---|---|---|
| 2024-A 板凳龙 | F1 | "CLEAN" | **false** | 2 | 0/10 | false |
| 2024-B 生产决策 | F3 | "CLEAN" | **false** | 3 | 0/10 | false |
| 2024-C 种植策略 | F3 | "CLEAN" | **false** | 3 | 0/10 | false |

**这份"全红"快照本身就是 W1 最有价值的产出**：它用刚建立的度量系统，定量复现了 PRD F2/F6/F7 的三个断言——
- T3 交付稿的结论数字（`0.731 m`）对三道真题全部**无源**（M2>0）——demo 串题的直接量化；
- 交付稿没有论文骨架（M4=0）——"5 个固定标题不是论文结构"的直接量化；
- 没有可用数据图（M5=0）——"标量柱状图拒绝数据集"的直接量化。
- 且注意：这三次 run 的引擎终态是 **DELIVERED（相当于 CLEAN）**——即当前门禁对这种"复述+无源数字"的稿子**一票不拦**。这正是红队#1 担忧的实证雏形：`CLEAN` 标签今天并不保证内容质量，门禁语义要等 W6–W7 验证层与 P0-3 分档门槛补齐。

## 3. 红队#2 的事实回答：F3 的 4 次运行在新门槛下会交付什么

逐次对照 PRD §3.3 的三级门槛（BLOCKED 仅当：内容为空 / 代码执行失败 / 引用无法解析），依据 `REAL-RUN-2024A-behavior-report.md` 附录 B 的逐节点证据：

| 运行 | 旧终态 | 新门槛下的判定 | 依据（事实） |
|---|---|---|---|
| **R1** T3×glm-5.3-flash | BLOCKED（review 4 次未过） | **`BLOCKED`（维持零交付）** | 第 4 轮 review 的终态交付物为**空文本**（"复述→复述→空交付"链）——命中"内容为空"条款 |
| **R2** T2×glm-5.3-flash | BLOCKED（execute ESCAPE） | **`BLOCKED`（维持零交付）** | execute 首步 `ESCAPE refused: unledgered_reference`，**没有产物**——不是"有内容被拦"，是内容从未生成 |
| **R3** T2×v4-pro | BLOCKED（provider-unavailable） | **`BLOCKED`（维持零交付）** | plan 3 attempts 全挂、用量 0/0——传输失败，无内容 |
| **R4** T2×v4-flash | BLOCKED（execute ESCAPE） | **`BLOCKED`（维持零交付）** | 同 R2：execute 死于 ESCAPE，无产物 |

**结论：`MARKED` fail-soft 对 F3 的 0/4 无一改为可交付——PRD §3.3"诚实边界"的每一句都被逐次证据支持。** 4 次失败全部死于"内容生成"（R1 空文本、R2/R4 execute 无产物、R3 模型下架），没有一次是"有内容却被门拦"。放宽门槛不会让这 4 次变成交付，只会让 R1 的中间轮次（"复述题面"的稿子）在第 2-3 轮就流出去——那正是负对照 NC-2/NC-3 判红的那类稿子。**因此 W5 方法族契约（内容从何而来）才是 0→1 的关键路径，P0-3 门槛层是它的交付侧配套。** 这个结论与 PRD §3.3 完全一致，未被本轮事实推翻。

## 4. 红队#6 的事实回答：n=9/12/20 置信区间

Clopper–Pearson 单侧 95% 下界（与仓内 `qualification.ts:38` 的 `STOP_RULE_P80_ZERO_FAIL_N=14` 出处一致，已对 scipy `binomtest` exact 法逐值交叉验证）：

| n | k=0 | k=n/2 | k=n 全成 |
|---|---|---|---|
| 9 | 0.000 | 0.169 | 0.717 |
| 12 | 0.000 | 0.245 | **0.779** |
| 14 | — | — | **0.807** ← p>0.8 的最小规模 |
| 20 | 0.000 | 0.302 | 0.861 |
| 29 | — | — | **0.902** ← p>0.9 的最小规模 |

**裁决**：12 题全成也只授权 p≥0.779 < 0.8。**维持 12 题规模**（PRD 保底 ≥1/12、目标 ≥4/12 都是定性进展指标），但预注册表已写死：W12 不得用这 12 题做任何"成功率"统计表述；若未来要统计结论，扩到 ≥14（p>0.8）或 ≥29（p>0.9）——数字直接取自仓内自己代码的常数，不引入外部标准。

## 5. 遗留与下一步（W2 起）

1. **占位题 7 道**（2023-B/D、2022-B/C、2021-B/C、美赛 2021-B）：族已预注册、`dev_visible: false`；待真实 PDF 获取后入库冻结。**不冒充已冻结**——MANIFEST 显式标 `pending_placeholders`。
2. **`demo:pw`/一键演示仍走 T3**（fake provider 的离线契约是闭集填空）：已在 UI/返回值标注"固定填充面（回归用），非真题默认"。这不是遗漏——fake provider 只服务 T3 槽位，改它属于 W3 PDF 入口之后的工作。
3. **M3b/M3c 待基线**：fake run 无计时/计价，W11 过程可控（P1-2/P1-4）落地后补。
4. **红队#1 的预警已被 W1 快照部分证实**（"CLEAN"标签不保证内容）：分档报告已实装，M1 永远拆 CLEAN/MARKED 两列。
5. **每份 NOTES 模块精读笔记**（§9 代码接管计划）从 W1 起每周 1 份，本周为 `spec.ts`（见下）。

## 6. W1 模块精读：spec.ts（§9 第 1/12 份）

- **不变量**：run/node/artifact 三表的 id 全为 branded UUID；状态机转换受 `state-machine.ts` 约束（run: planning→running→…→failed/completed）；每次 run 携带 `harnessVersion + configHash`（可复现承诺的锚点）。
- **我不同意什么**：`usageSchema.costUsd` 允许 0 且无"未计价"态——$0 与"未配置 pricing"在 schema 上不可区分，这正是 M3c 历史恒显 $0 的根因。指标侧已用 `null` 语义修补，schema 侧应加 `priced: boolean`（W11 计价任务一并改）。
- **删掉它会坏在哪**：所有持久化表结构与 replay 依赖它——不可删，只能演化。
- **一句话对外**：这是运行的"户口本"——谁、什么模式、跑了哪版引擎、花了多少，每个 run 一行可审计记录。

---

*W1 硬门禁（负对照不能变红则不得进 W2）：达成。7 组对照 18 项检查全绿。*
