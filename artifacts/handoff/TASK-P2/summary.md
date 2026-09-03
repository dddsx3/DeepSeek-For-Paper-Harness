# TASK-P2 — handoff summary（executor 整链与图表数据闭环，2026-09-04）

> 前置：P1 复签闭口 + E4 三裁决选 A 已入库；准入 G0-G4 满足（G4：探针 key 预算
> 本批无 key → 真调用 manual job，无 key 显式 SKIPPED，义务保持）。

## 交付-出口矩阵（对 P2 §3/P2 §6 清单）

| 主线 | 交付 | 证据 |
|---|---|---|
| P2-1 executor 整链（D7 义务） | produceFromExecute+produceRun 内嵌 code-run/capture/dry-pass interpretation/Result→v2 报告；runner 部署注入 allow-list；S-007 loadCode 进 delivery | executor-authoritative.spec 4 绿；demo-v2 executor 唯一入口 4/4 DELIVER |
| E4a/b/c（前置裁决） | review loop v2 + manifest.advisory_defects | executor-review-v2.spec 6 绿 |
| P2-3 figure 数据闭环（D3 义务，D3-closed） | schema data_hash 必填+chart_type 闭集；声明制 producer（数值仅来自 store）；固定确定性 renderer；门真比较；STALE FigureSpec 传播 | figure-consistency 7 / producer 6 / stale-figure 1；**gates_impl 语义更替：figure_data_consistency 由 vacuous→real 已登记** |
| P2-4 报告 v2 | 结构化结论槽位（逐字一致+白名单）+ 图嵌入 data-uri + 溯源附录；v1 文本守卫兜底（禁6） | report-v2.spec 6；TOO-GOOD v2 重演红 |
| P2-5 pass corpus v2 | 4 legal（含图/槽位叶）FBR 0/4 + 2 逃逸叶 KILLED | demo-v2/output + summary.json 提交入库 |
| P2-2 遵从率探针（#3 部分关闭） | probe 脚本 + fake 自检 1.0 trusted；真实 ≥20 次 manual（key） | probe/output/（SKIPPED 显式） |
| P2-6 CI/文档 | npm test:p2:demo / test:p2:probe；paper-harness.yml demo v2 step + probe manual job；decision-log/known-risks/summary/redteam/pass-corpus/EXTERNAL-REVIEW/TASK-INDEX | 本批 |

## 偏差声明（decision-log 内详）
- 图渲染器为仓库内等价物（SVG，非 python/PNG）；executor"FORMAL 门集"=strict/fast
  真九门（RunMode 无 formal）。均记 D-P2.2/D-P2.1。

## 测试与回归
- 全量 vitest（含真 spawn）见 gate-report baseline（本批末次同步值）；host tsc 0；
  verifier RG-06/07/09 待末次 CI。
- demo-v2 sha256 确定性；probe fake 1.0。

## 作者 TODO / 复签
- 无新增复签项（E4 已代签；本批决策为偏差声明记录）。
- 真实 provider 遵从率实跑（≥20 次、<0.8 降级义务）、SVG→位图后端、formal
  RunMode 别名、DF 图型扩展 → 后续任务书候选。

## P3 输入
- figure 语义核对（data_refs 与图一一对应）、A7 对应性缺口、容差层、DF 扩展。
