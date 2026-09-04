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
| G3 | 探针 key 状态 | **批初 KEY ABSENT → 批中作者提供 GMI key（`api.gmi-serving.com` + MiniMaxAI/MiniMax-M3）** —— probe v2 真实段已实跑归档（20 次首次尝试，0/20，见下方 P3-3 收口）。注意：该 key **不是** `DEEPSEEK_API_KEY`（DeepSeek 官方端点侧仍无 key），#3 的 DeepSeek 子项保持部分关闭（禁 6/禁 7 口径不变）。 |

## 偏差声明（D-P3.x，随实现逐条登记）

- D-P3.1：**formal RunMode 别名定稿——选别名解析**。`migrateRunMode` 将
  'formal'（大小写不敏感）登记为 strict 同义；RunMode 闭集
  {fast, strict, exploratory} 不动（禁8）；settings `defaultMode` union
  不加 'formal'（保守面，known-risks P3-5）。legacy.spec 有别名回归用例。
- D-P3.2：舍入规范 v1 只承诺十进制小数位 0..20、单一半进位（`formatRounded`
  同一函数做校验与格式化）；负数/非有限/科学计数 fail-closed 拒
  （任务书 §7 风险 3 同口径）。
- D-P3.3（教学段措辞修正）：首版教学段 "DataArtifact (RAW_PROBLEM input)"
  措辞致模型把 role 当 kind（首轮实测 0/20 全为 declaration-drift 且根因
  即此歧义）；修正为 kind/value 显式嵌套说明。修正仅措辞级、仍只教
  schema 内结构（禁10 不违）。两轮实测原始记录均归档：
  `probe-v2/output/summary-v0-teaching.json`（首版）、
  `probe-v2/output/summary.json` + `records.jsonl`（修正版）。
- D-P3.4（corpus v3 legal 第 5 叶二选一）：选 **ROUNDED-LEGAL**
  （P3-2 放行路径覆盖）；PARAPHRASE 覆盖面由 executor-review-semantic
  blue path 承担。
- D-P3.5（SEMANTIC-OVERCLAIM kill 叶的 killer 层分工）：corpus 叶的确定性
  killer 是文本守卫；reviewer 语义 killer 由 executor-review-semantic.spec
  攻击 1 承担。两层分工如实记录，不混称。

## P3-3 实测与降级收口（G5）

- **组合身份**：`https://api.gmi-serving.com/v1` + `MiniMaxAI/MiniMax-M3` +
  ir-container-v1 + EXECUTE_PROTOCOL_TEACHING v0。
- **实测**：20 次真实首次尝试，首次遵从率 **0/20**；失败分类
  declaration-drift 17 / run-failure 2 / transport-error 1（分类表随
  records.jsonl 归档）。fake 自检 20/20 = 1.0（trusted）。
- **降级字面生效（禁6）**：adherence 0 < 0.8 → 该组合记 **EXPLORATORY
  降级**（probe summary `downgrade.downgraded=true` + combinationIdentity
  在册 + 本条 decision-log 记录）。配置路径：该组合不得以 FORMAL/strict
  交付语义对外声称；后续部署用此组合必须以 exploratory 起步。
- **口径边界（禁7）**：本实测不覆盖 DeepSeek 官方端点（CI secret 无
  key）；known-risks #3 的 DeepSeek 侧子项保持部分关闭，义务随批移交。

## known-risks 收口记录（G10）

- **#2**：F3 二选一定稿——按 P1 原文口径（runnerCommand 组合注入、模型
  不可选）标记**关闭**；沙箱能力层独立在册为 P3-6 残余（demo 用临时目录 +
  内存后端）。
- **#4**：P1 D1 附带义务兑现（P3-1 三类闭集 + 证据域 + E4 账本复用）→
  **关闭**。
- **#5**：**收窄至声明制域**（P3-2；未声明 ≈ 一律拒，禁2/禁6 不动）。
- **#6**：**按声明收窄**（verbatim | rounded | with_uncertainty 三路之外
  无路径；方法性数字入结论保持禁止，禁3）。
- **#3**：见上方 P3-3 实测——**部分关闭保持**（GMI/MiniMax 侧实测归档；
  DeepSeek 侧待 key）。
