# TASK-P3 — decision-log（语义收口与遵从实证）

> 上游：TASK-P2 HEAD `d873ac40f`，handoff 完整、无待复签项（G0 ✓）。
> 本文沿用 5.0-R/P1/P2 惯例：先签批、后实现；偏差必记；禁用事项 §5 编号沿用。

## §9 三张裁决单签批回执

### E5：reviewer 语义核对的范围与证据域 —— **选 A**（代签）
- 代签人：审计方（作者委托，沿用 E4 代签先例）；日期：2026-09-04。
- 落地映射：reviewer prompt v3（结果表 + REQUIRED_OUTPUTs + Claim 摘要上下文）、
  ReviewDefect 增 `evidence`、三类闭集 `claim_without_evidence` /
  `number_rewrite_mismatch` / `scope_overclaim`、无证据 finding 在 parse 层拒、
  severity 与账本/editing 全走 E4a/E4b，零新裁决机制（P3-1 + 攻击 1–4 红测）。

### E6：表达层放开方式（声明制 vs 逐字） —— **选 A**（代签）
- 代签人：审计方；日期：2026-09-04。
- 落地映射：conclusion slot 增 `representation` 闭集
  （verbatim | rounded{dp} | with_uncertainty{uncertainty_refs}）＋确定性校验器；
  默认零容差不动、方法性数字禁入结论不放开（P3-2 + 攻击 1–4 红测 + ROUNDED-LEGAL 叶）。

### E7：图资产唯一性 —— **选 A**（代签）
- 代签人：审计方；日期：2026-09-04。
- 落地映射：唯一性键 (sorted data_refs, chart_type, style_profile) 生产期拒重
  （零部分写入），line+bar 同源合法；DF `table` 图型扩展（P3-4 + 攻击 1–4 红测 +
  DUP-FIGURE kill 叶）。

## 准入状态

| # | 门槛 | 状态 |
|---|---|---|
| G0 | P2 handoff 完整、无待复签 | ✓（TASK-INDEX P2 行 DONE；TASK-P2/decision-log 无 ☐） |
| G1 | E5/E6/E7 签批 | ✓（本段，三张均选 A 代签入库） |
| G2 | 基线全绿 | 见本批末次证据（tsc 0 / vitest 全绿 / demo v2 exit 0 / probe fake 1.0） |
| G3 | 探针 key 状态 | **KEY ABSENT** —— 执行环境 `DEEPSEEK_API_KEY` 未设置且仓库无 `.env`；按 §7 风险 1 / D-P2.5 先例，P3-3 走显式 SKIPPED、known-risks #3 只记**部分关闭**，义务随批次移交，不声称关闭（禁 6/禁 7）。 |

## 偏差声明（D-P3.x，随实现逐条登记）

- D-P3.1：formal RunMode —— 见 P3-5 收口组（二选一后在此定稿）。
- D-P3.2（如需要）：舍入规范 v1 只承诺十进制小数位，负数/科学计数/有效位 fail-closed 拒
  （任务书 §7 风险 3 已列，实现同口径）。
- D-P3.3（如需要）：教学段只教 ir-container-v1 结构，不示范 schema 外自由格式（禁 10）。
