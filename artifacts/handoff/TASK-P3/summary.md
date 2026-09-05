# TASK-P3 — summary（交付出口矩阵）

> 批次：语义收口与遵从实证（P3-1..P3-6）。上游：TASK-P2（`9336d639ed`）。
> 本批 HEAD 由 TASK-INDEX P3 行记录；全部提交经 lefthook pre-commit
> （oxlint staged 0 错误）。

## 交付-出口矩阵

| 任务 | 交付 | 出口 | 证据 |
|---|---|---|---|
| P3-1 评审语义核对 v1（E5） | `src/executor.ts`（SEMANTIC_FINDING_KINDS / SemanticContext / semanticContextOf / parseSemanticFinding / canonical-context 注入）+ `tests/executor-review-semantic.spec.ts` | DONE | 6/6 绿（攻击 1/2/3/3b/4 + blue path）；executor-review-v2 六条不回归；known-risks #4 关闭（P1 D1 义务兑现） |
| P3-2 表达层声明制（E6） | `src/produce/report-renderer.ts`（SlotRepresentation / formatRounded / parseRepresentation / 三路校验）+ `tests/produce/report-representation.spec.ts` | DONE | 13/13 绿（ROUNDED-LEGAL 正例 + 攻击 1/2/3/3b/4/4b/4c + 回归三件）；TOO-GOOD-V2 仍红 |
| P3-4 figure 语义核对 + table（E7） | `src/figure/producer.ts`（唯一性键拒重）+ `src/figure/renderer.ts`（table 图型）+ `src/ir/schema.ts`（chart_type 闭集扩 table）+ `tests/delivery/figure-semantic.spec.ts` | DONE | 10/10 绿（攻击 1/2/3/4 + 正例 + 全量绘制回读）；P2 figure 三 spec 14/14 不回归 |
| P3-3 教学段 + probe v2 | `EXECUTE_PROTOCOL_TEACHING`（instruction 内置）+ `probe-v2/run-probe-v2.mjs` + `probe-v2/output/`（真实记录归档） | DONE（实测归档） | fake 自检 1.0/1.0（trusted）；真实 20 次首次尝试 0/20 遵从（GMI + MiniMax-M3 + 教学 v0）；失败分类 declaration-drift 17 / run-failure 2 / transport-error 1；<0.8 降级**字面生效**（组合身份 EXPLORATORY 在册） |
| P3-5 收口组 | ①formal 别名（migrateRunMode，D-P3.1）②F2 gate-registry figure 门注释/PASS reason 真校验描述 ③F3 known-risks #2 口径定稿（原文口径关闭）④F4 gate-report files/total 每提交同步（最终 976/88）⑤F1 demo summary UUID 脱敏 | DONE | legacy.spec formal 别名 +1 绿；无测试红绿翻转（禁8 守住）；demo v3 重跑 sha256 一致 |
| P3-6 demo v3 + corpus v3 + CI | `demo-v3/`（cases + runner + output 脱敏 summary）+ `.github/workflows/paper-harness.yml`（v3 step + probe-v2 manual job）+ `package.json`（test:p3:*）+ 本 handoff 全套 | DONE | demo v3 exit 0：legal 5/5 DELIVER（FBR 0/5；语义误杀 0/5）+ wrong 6/6 KILLED；重跑零脏（G8 字面成立） |

## 门禁自评（任务书 §4）

| Gate | 判定 | 证据 |
|---|---|---|
| G0 tsc 干净 | ✅ | `tsc -b tsconfig.host.json` exit 0（批末复跑） |
| G1 vitest 全绿 | ✅ | 976/976（952→965→975→976 逐提交递增；新增 spec 数与声称一致：6+13+10+1） |
| G2 E5 证据域 | ✅ | 攻击 3（悬挂 ref）/3b（伪造 span）红——parse 拒、不 BLOCK；攻击 4（域外 kind）红 |
| G3 E5 账本复用 | ✅ | 攻击 2 走 E4a 账本残留 BLOCK；executor-review-v2 六条保持 |
| G4 E6 声明制 | ✅ | rounded 红蓝双向有测（正例 dp:2/dp:3 + 攻击 2 dp:2≠0.729）；攻击 1/2/3/4 全红 |
| G5 P3-3 实证 | ✅（如实归档） | probe-v2 ≥20 真实首次 + 失败分类表；0/20 → 降级字面生效；无静默 PASS |
| G6 E7 figure 语义 | ✅ | 攻击 1 同键二图拒（零部分写入）；攻击 4 DataArtifact 拒；P2 figure 三 spec 不回归 |
| G7 收口组 | ✅ | F1–F4 各有 diff 证据（本 handoff known-risks #2 定稿 + 提交记录）；baseline files=88 校正 |
| G8 demo v3 确定 | ✅ | 重跑 exit 0、summary sha256 一致、UUID 脱敏后工作树零脏 |
| G9 kill 不失效 | ✅ | corpus v3 六 kill 全红 + TOO-GOOD-V2/CAPTION-ESCAPE/OVER-PROMISE 重演保持 |
| G10 文档同步 | ✅ | decision-log / known-risks / summary / redteam / pass-corpus / TASK-INDEX / EXTERNAL-REVIEW 本批行齐 |

## 偏差声明（与任务书的差异）

- **D-P3.1（formal 别名二选一）**：选"别名解析"（migration 层 'formal'→strict
  登记闭集不动）；settings `defaultMode` union 不加 'formal'（禁8 保守面，
  见 known-risks P3-5）。
- **D-P3.2（舍入规范 v1）**：只承诺十进制小数位 0..20、单一半进位；负数/
  科学计数 fail-closed 拒（任务书 §7 风险 3 同口径）。
- **D-P3.3（教学段措辞修正）**：首版教学段 "DataArtifact (RAW_PROBLEM
  input)" 措辞致模型把 role 当 kind（0/20 declaration-drift 全因该歧义）；
  修正为 kind/value 显式嵌套说明后重跑（仍 0/20，失败面转为 schema 细节）。
  两次实测原始记录均归档（`probe-v2/output/summary-v0-teaching.json` 为首版）。
  修正属于措辞级（禁10 不违：仍只教 schema 内结构）。
- **D-P3.4（corpus v3 legal 第 5 叶）**：任务书允许 PARAPHRASE-LEGAL 或
  ROUNDED-LEGAL 二选一——本批选 **ROUNDED-LEGAL**（P3-2 放行路径覆盖）；
  PARAPHRASE 覆盖面由 executor-review-semantic blue path（同义改写干净
  review）承担。
- **D-P3.5（SEMANTIC-OVERCLAIM kill 的 killer 层）**：corpus 叶的确定性
  killer 是文本守卫（0.99 非绑定值即拒），reviewer 语义层（fake reviewer
  返回干净 verdict）不是该叶的 kill 机制——语义 killer 由
  executor-review-semantic.spec 攻击 1 承担。两层分工在册。

## 作者 TODO（下一位/下一批）

1. **master CI lint 欠账**：上游遗留 ~20 处风格错误（见 known-risks
   P3-7），push master 后 `check:ci` 预期红一次——清欠走后续任务书。
2. **DeepSeek 官方端点遵从实测**：GMI/MiniMax 已实测（0/20，EXPLORATORY
   降级在册）；DeepSeek 侧待 key（known-risks #3 部分关闭保持）。
3. **真实 reviewer 语义误杀率实测**（known-risks P3-1）。
4. P4 候选（本批范围外，任务书 §7 风险 6 同口径）：PNG 位图、多序列
   x 轴、DataArtifact 行语义、用户外壳。
