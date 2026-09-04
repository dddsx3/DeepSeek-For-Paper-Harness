# TASK-P3 — 下一位 Agent 接手手册（HANDOFF）

> 本文件是 **agent → agent** 的交接说明，独立于任务书 §6 的交付清单。
> 目标：下一位 agent 无需向我追问，即可从当前精确状态继续推进到 P3 全批收口。
> 上游：TASK-P2 HEAD `d873ac40f4`（已推远端，工作树本应干净）。
> 当前时间：2026-09-04。本批推进中曾遇模型提供商 429 限流，只影响 agent 自身工具调用，**不影响 fake-provider 单测**（单测走本地内存 fake provider，无外部调用）。

---

## 0. 接手后前 5 条命令（按顺序复制执行）

```bash
# ① 回到仓库根，确认 HEAD 与远端一致
cd "<repo>"
git rev-parse HEAD            # 期望 d873ac40f40b32b63737b838899ca868fd4eb6ed
git status --short            # 见 §2，先处理两处 TASK-P2 噪声改动

# ② 还原两处无关的 TASK-P2 噪声改动（见 §2 警告），保持工作树只含 P3 意图
git checkout -- artifacts/handoff/TASK-P2/demo-v2/output/summary.json \
              artifacts/handoff/TASK-P2/probe/output/summary.json

# ③ 跑 P3-1 已就绪的语义红测（fake provider，离线，不受 429 影响）
npx vitest run executor-review-semantic --reporter=dot
#   若前台输出为空（已知 vitest 前台偶发失声），改用后台 + JSON：
#   npx vitest run executor-review-semantic --reporter=json --outputFile=/tmp/p31.json
#   然后 Read /tmp/p31.json

# ④ 全量类型检查（host 链含测试文件）
npx tsc -b tsconfig.host.json

# ⑤ 全量单测，确认 946 → 952（P3-1 新增 1 文件 6 测试），无回归
npx vitest run --reporter=dot
```

---

## 1. 接手状态速览

| 项 | 状态 |
|---|---|
| P2 全批 | ✅ 已收口并推送（`d873ac40f4`，双 CI 绿，946/946） |
| P3 任务书 | ✅ 已读，E5/E6/E7 三张裁决单均**选 A 代签入库**（`artifacts/handoff/TASK-P3/decision-log.md`） |
| 门禁 G0/G1 | ✅ 达标（P2 handoff 完整；三裁决代签完成） |
| 门禁 G2（基线全绿） | ⚠️ 上批末次证据在册，但 P3-1 新改动**尚未跑测验证**（被 429 打断） |
| 门禁 G3（探针 key） | ❌ `DEEPSEEK_API_KEY` 缺位 → **P3-3 显式 SKIPPED、known-risks #3 只记部分关闭**（禁 7） |
| P3-1 代码 | ✅ `executor.ts` 已实现（E5 全量落地），新测试 `executor-review-semantic.spec.ts` 已写，**待跑测 + 提交** |
| P3-2 / P3-3 / P3-4 / P3-5 / P3-6 | ⬜ 未开工 |

**一句话**：P3-1 的代码与测试已就绪，只差"跑测验证 → 提交"这一跳；其余 P3-2~P3-6 按任务书从零实现。

---

## 2. 仓库状态（已核验，`git status --porcelain`）

当前工作树**非干净**，含 3 类改动：

| 文件 | 状态 | 处置 | 说明 |
|---|---|---|---|
| `packages/paper/paper-foundation/src/executor.ts` | M（+194/-9） | **保留，属 P3-1** | P3-1 E5 实现，详见 §5 |
| `packages/paper/paper-foundation/tests/executor-review-semantic.spec.ts` | ?? 新增 | **保留，属 P3-1** | P3-1 语义红测，6 个用例 |
| `artifacts/handoff/TASK-P3/`（整目录） | ?? 新增 | **保留** | 本批 handoff + decision-log |
| `artifacts/handoff/TASK-P2/demo-v2/output/summary.json` | M | ⚠️ **还原（非 P3）** | 重跑 demo-v2 留下的 UUID 噪声（节点 id 变），与 P3 无关 |
| `artifacts/handoff/TASK-P2/probe/output/summary.json` | M | ⚠️ **还原（非 P3）** | 重跑 probe 留下的时间戳噪声，与 P3 无关 |

> ⚠️ **警告**：TASK-P2 两处 `summary.json` 改动是 P2 提交后的重跑残留（只改了 UUID 与时间戳），**不是 P3 工作**。提交 P3 前务必 `git checkout --` 还原（见 §0 ②），否则会污染 P3 提交并破坏 G8「工作树零脏」。P3-6 的 demo-v3 会改用**脱敏写法**（UUID→固定占位，F1 同步点），届时这两个 TASK-P2 文件不应再被触碰。

---

## 3. P3 门禁准入状态（任务书 §2 / §4）

| Gate | 判定 | 当前状态 |
|---|---|---|
| G0 | P2 handoff 完整、无待复签 | ✅ TASK-INDEX P2 行 DONE；decision-log 无 ☐ |
| G1 | E5/E6/E7 签批 | ✅ 三张均选 A 代签（decision-log §9） |
| G2 | 基线全绿 | ⚠️ 上批末次证据在册；P3-1 新改动待跑测确认 |
| G3 | 探针 key 声明 | ❌ 缺位 → P3-3 SKIPPED、#3 部分关闭（禁 7，义务随批移交） |
| G4–G10 | 各项实证/审计 | ⬜ 随 P3-2~P3-6 实现后逐条达标 |

**G3 关键纪律**：无 key 时 P3-3 探针**不得静默 PASS**，必须显式 SKIPPED 且不声称 #3 关闭。该义务随批次移交，不消失。

---

## 4. P3-1 ~ P3-6 任务清单（含依赖顺序建议）

> 任务编号沿用仓内 TaskCreate（#23–#28）。建议实现顺序：**P3-1 → P3-2 → P3-4 → P3-3 → P3-5 → P3-6**（语义/表达/图三块相互独立，教学段依赖前三者成形，收口组与 demo 最后）。

### #23 P3-1 评审语义核对 v1（E5）— **代码+测试就绪，待跑测提交**
- 任务书 §3 P3-1。E5 选 A 已代签。
- 已实现：见 §5。
- 待办：跑测（§0 ③）→ host tsc（§0 ④）→ 提交（遵守 §7 纪律）。

### #24 P3-2 表达层声明制（E6 舍入/不确定度）— ⬜ 未开工
- 任务书 §3 P3-2。E6 选 A 已代签。
- 实现点：conclusion slot 增 `representation` 闭集 `verbatim | rounded{dp} | with_uncertainty{uncertainty_refs}`；确定性校验器（rounded 文本数字==源值按 dp 规范舍入，单一半进位；负数/科学计数 v1 拒 fail-closed）；`with_uncertainty` 的 ref 必须指向声明 Result 且 ± 一致；方法性数字仍禁入结论（禁 3）。
- 红测：攻击 1（无声明 ≈ 拒）/ 2（dp:2 但 0.729 拒）/ 3（错误 ref ± 对不上拒）/ 4（科学计数/负 dp 拒）。正例 ROUNDED-LEGAL。
- 回归：verbatim 与 legacy 守卫既有测试不回归；TOO-GOOD-V2 仍红。

### #25 P3-4 figure 语义核对 v1 + `table` 图型（E7）— ⬜ 未开工
- 任务书 §3 P3-4。E7 选 A 已代签。
- 实现点：唯一性键 `(sorted data_refs, chart_type, style_profile)`，同键第二个 FigureSpec 生产期拒（零部分写入）；renderer 逐 series 回读源 ref（无未绘 ref、无越权数值）；`chart_type` 闭集扩至 `{line,scatter,bar,table}`，table=每 data_ref 一行（量名/值/单位/不确定度），**table 仍只吃 Result（禁 4）**。
- 红测：攻击 1（同键二图拒）/ 2（caption/行内 refs 外数字拒）/ 3（pie 越界拒）/ 4（引用 DataArtifact 拒，D-P2.3 不回潮）。正例：line+bar 同源合法、table 合法。
- 回归：P2 figure-consistency 7 / figure-producer 6 / stale-figure 1 不回归；FIGURED-ICE 叶保持 DELIVER。

### #26 P3-3 EXECUTE 教学段 + probe v2（key 缺位→SKIPPED）— ⬜ 未开工
- 任务书 §3 P3-3。
- 实现点：EXECUTE stage instruction 内置 ir-container-v1 协议精讲（run 块只许 `outputBasenames/seed`；interpretations/figures 声明制、数值只经 jsonPath；结果须可解析为有限数；**不教 schema 外自由格式，禁 10**）；probe v2 实跑 ≥20 次真实首次尝试（同题复跑不计入首次，沿用探针纪律）；失败模式分类表归档；遵从率 <0.8 时 EXPLORATORY 降级字面生效（配置+记录）。
- **key 缺位处理**：无 key → 脚本显式 SKIPPED + 写入 `artifacts/handoff/TASK-P3/probe-v2/` 的「未关闭声明」；#3 只记部分关闭（禁 7）。
- 回归：探针脚本可重跑。

### #27 P3-5 收口组（formal 别名 + F1–F4 同步）— ⬜ 未开工
- 任务书 §3 P3-5。**禁 8：只动文本/字段/别名，不得改变任何门语义或测试判定。**
- 实现点：① formal RunMode 别名（二选一，须在 decision-log 记 D-P3.x 并同步 known-risks D-P2.1 词条）；② F2：gate-registry.ts figure 门注释/PASS reason 改真校验描述（清除 vacuous 残留）；③ F3：known-risks #2 口径二选一后定稿；④ F4：TASK-2.1/gate-report.json `files` 校正为实测值；⑤ F1：demo summary 写入前对 run node id 脱敏（P3-6 新 demo 直接脱敏写法）。
- 正例：每处同步点有 diff 证据；攻击=任何改动使测试红绿翻转或门语义变化→违禁 8。

### #28 P3-6 demo v3 + corpus v3 + CI/文档 + handoff — ⬜ 未开工
- 任务书 §3 P3-6。
- 实现点：demo v3（executor 权威入口，corpus v3 全叶实跑，输出脱敏 summary.json + sha256，重跑零脏）；corpus v3 legal 5（P2 四叶 + PARAPHRASE-LEGAL 或 ROUNDED-LEGAL，FBR 0/5）+ kill 6（SEMANTIC-OVERCLAIM / ROUND-ESCAPE / DUP-FIGURE / TOO-GOOD-V2 / CAPTION-ESCAPE / OVER-PROMISE）；FBR 双口径（结构 0/5 + 语义误杀率 0/5）；CI 指 v3；decision-log/known-risks/summary/redteam/pass-corpus/TASK-INDEX/EXTERNAL-REVIEW 同步。
- 攻击：任一 kill 叶变绿→脚本 exit 非零（kill 不因版本失效，脚本级执行）。

---

## 5. P3-1 深度说明（最推进项，务必精读）

### 5.1 已改文件 `packages/paper/paper-foundation/src/executor.ts`
新增内容（均在 P2 已落地的 E4 账本/severity 机制之上扩展，**零新裁决框架**）：

1. **闭集常量与类型**（~行 62–82）：
   - `SEMANTIC_FINDING_KINDS = ['claim_without_evidence','number_rewrite_mismatch','scope_overclaim'] as const`
   - `SemanticFindingKind` 类型
   - `semanticSeverity(kind)`：`number_rewrite_mismatch`→`major`，其余→`critical`（severity 由 kind 固定，reviewer 不可选）
   - `ReviewEvidence { text_span: string; ref_ids: string[] }`
2. **`ReviewDefect` 接口扩展**：新增可选 `semantic?: SemanticFindingKind` 与 `evidence?: ReviewEvidence`（仅三类语义 finding 带）。
3. **`SemanticContext` 接口**：`{ results, requiredOutputs, claims }` —— reviewer 被允许看到的**唯一**上下文（来自 store，无文件系统/网络）。
4. **`semanticContextOf()` 私有方法**（~行 1103）：从 `ModelingIr.snapshot()` 派生 results/requiredOutputs/claims；无 store 或 snapshot 为 null 时返回 `undefined`（此时语义 finding 因无法核验而被丢弃，不信任）。
5. **`reviewSections()` 改造**（~行 1191）：接收 `semanticContext` 参数；注入 `canonical-context` 段（结果表/REQUIRED_OUTPUTs/Claim 摘要）；prompt 增加语义三类闭集 + 证据域约束说明；首轮/后续 JSON shape 样例补 `semantic`+`evidence`。
6. **`parseReviewReport()` 改造**（~行 1300）：接收 `{ context, delivered }`；遇到 `raw.semantic !== undefined` 走 `parseSemanticFinding()`；域外/无证据 finding **在 parse 层直接丢弃**（不升级、不 BLOCK，对应禁 1 / 攻击 3 / 攻击 4）。
7. **`parseSemanticFinding()` 私有方法**（~行 1356）：返回 `null`（丢弃）的条件——kind 不在闭集 / 无 canonical context / 缺 evidence / text_span 空或不在 delivered 文本中 / ref_ids 非数组或空或含非字符串 / ref_ids 有任一不在 context 域内。全部通过则构造 `ReviewDefect`（severity 由 `semanticSeverity` 定）。
8. **`renderSemanticContext()`**：把 context 渲染成 reviewer 可引用的文本块。

调用点（~行 338）：review 节点与 parse 已传入 `semanticContextOf()` / `{ context, delivered }`。

### 5.2 新测试 `packages/paper/paper-foundation/tests/executor-review-semantic.spec.ts`
- 复用 `validChain()` + `backbone()`（**无 FigureSpec**，避免 figure vacuous 门 BLOCK，沿用 executor-review-v2 的 `noFigureBackbone` 思路）。
- 模式：`mode: 'exploratory'`，`createExploratoryProfile()`，fake provider 脚本化 reviewer 输出。
- **6 个用例**（均红，对应任务书攻击 1–4 + 正例）：
  1. `attack 1`：散文声称无支撑对比 → 语义 critical BLOCK（`outcome.status==='rejected'`, `code==='gate-failed'`）
  2. `attack 2` (E4a 复用)：改写措辞 + `resolved:[]` 无真实 resolved 记录 → 账本残留仍 BLOCK
  3. `attack 3`：ref_ids 悬挂（`GHOST`）→ parse 拒，不 BLOCK（`resolved`/`completed`）
  4. `attack 3b`：编造的 text_span（不在交付文本中）→ 丢弃，不 BLOCK
  5. `attack 4`：域外 kind（`style_issue`）→ 不在闭集，丢弃，不 BLOCK
  6. `blue path`：干净 review → DELIVER（`completed`）

### 5.3 模式语义已确认（关键，避免误判测试失败）
- `src/executor.ts` ~行 391–403（E4c）：**`exploratory` 与 `strict/formal` 同样零容差**——任何未 resolved 的 defect 都 BLOCK（仅 `fast` 模式允许 minor 残留放行）。
- 因此 P3-1 测试用 `exploratory` 且期望 BLOCK 是**正确**的；若误改为 `fast` 反而会因 minor 放行逻辑改变预期。勿动测试模式。

### 5.4 P3-1 待验证/回归
- 跑测（§0 ③）→ 期望 6/6 通过。
- 回归：executor-review-v2 六条保持；P1/P2 kill 网全量重放（§0 ⑤ 全量 vitest 应仍绿）。
- 提交前更新测试计数基线（946 → 952，见 §7）。

---

## 6. 必踩的坑 / 经验（来自 P2 + P3-1，避免重蹈）

1. **schemastery 空数组坑**：`s.array(s.string())` 无 default → schema 归一为空数组，`?? ['node','python']` 失效。P2-1 已修为「显式空=用内置默认」。新写 schema 数组字段时注意，勿再踩。
2. **vitest 前台偶发失声**（RC1 空输出）：在 Windows 本地前台跑大批量 vitest 可能返回空。可靠做法：**后台 bash + `--reporter=json --outputFile`**，再 Read JSON。单文件小测通常前台 OK，但全量 5min×多次建议后台。
3. **provider stream 判定**：plan/execute 的协议判定用 `messages` joined 文本（非 `system`）。写 fake provider 测试时注意路由键。
4. **fake provider 单测与 429 无关**：单测走内存 fake provider，无外部 API 调用，不受模型提供商限流影响。若你自身工具调用遇 429，等重置窗口（约 14:43 UTC+8）再继续，不要因此怀疑测试。
5. **figure vacuous 门**：backbone 含 `FigureSpec` 时 fast 模式会被 figure 门 BLOCK。语义/表达类测试用**无 FigureSpec** 的 backbone（参考 `noFigureBackbone`/`backbone()`）。
6. **fault-corpus / ref-closure 旧图无 `data_hash`**：全量下 R-010/011/013 会失败。P2 已给 JSON fixture 补 `data_hash:'sha256:0{64}'`。新增 figure 测试务必带合法 `data_hash`。
7. **CRLF 警告**：`executor.ts` 工作副本有 CRLF→LF 提示，提交时无碍（Git 自动处理），忽略即可。

---

## 7. 全局纪律提醒（DISCIPLINE.md / 工作记忆，违反即事故）

1. **诚实红灯 > 假绿**：禁止删改测试断言凑绿；失败必须清零或用 `it.fails` + 跟踪；reason 诚实但 PASS 的桩 = 违禁。
2. **声称-代码四方一致**：`gate-report ↔ gate-registry/gates_impl ↔ TASK-INDEX ↔ known-risks` 由 verifier RG-06/07/09 自动查。**新增/改动测试数或门，必须先同步 gate-report baseline 再 push**。P3-1 新增 1 文件 6 测试 → 基线 946→952（先 `find artifacts -name gate-report.json` 定位 paper-harness 基线文件再更新）。
3. **ExecutionRecord 只走 `putExecutionRecord` + `CAPTURE_ATTESTATION`**（INV-3-M）；`store` 不可变（覆盖 put=duplicate_id，漂移在构造表达）。
4. **六门 UNIMPLEMENTED 期间 fast/strict 不可交付**；机制测试走 `EXPLORATORY` run mode（manifest `informal=true`）。
5. **提交前 `git status` 全量核对**：本批尤其要确认 §2 的两处 TASK-P2 噪声已还原，勿带入 P3 提交。
6. **禁事项族**（任务书 §5，编号 禁1–禁10）：无 evidence 语义 finding 不得 BLOCK（禁1）；默认零容差不得放宽（禁2）；方法性数字仍禁入结论（禁3）；DataArtifact 行语义未设计前任何图型不得引用（禁4）；同键重复图资产不得入库（禁5）；遵从率<0.8 仍标 FORMAL 违禁（禁6）；无 key 探针不得静默 PASS（禁7）；收口组只动文本/字段/别名（禁8）；既有 kill 不得因新层失效（禁9）；教学 instruction 不得示范 schema 外格式（禁10）。

---

## 8. 需向作者确认 / 决策点（实现到对应任务时处理）

- **P3-5 ① formal 别名二选一**：要么 settings 层把 `'formal'` 解析为 strict 同义并显式登记，要么文档明示「不引入别名、formal 仅存在于 delivery 层语义」。选哪个都要在 decision-log 记 `D-P3.x` 并同步 known-risks D-P2.1 词条。**建议默认选前者（别名解析），与 P2 D-P2.1 收口一致**——但属作者裁决，先写 decision-log 占位。
- **P3-3 key 可用性**：执行环境 `DEEPSEEK_API_KEY` 当前缺位。若接手时仍缺，按 G3 走 SKIPPED + #3 部分关闭；若作者提供了 key，可实跑 probe v2（≥20 次真实首次尝试）并归档失败模式分类。

---

## 9. 参考文件索引

| 文件 | 用途 |
|---|---|
| `D:/DeepSeek-For-Paper-Harness-下一步任务书（P3-语义核对与遵从率实证）.md` | P3 任务书（目标/准入/必须实现/门禁/禁事项/交付清单/裁决单） |
| `artifacts/handoff/TASK-P3/decision-log.md` | E5/E6/E7 选 A 代签回执 + G3 key 缺位标注 + D-P3.x 占位 |
| `packages/paper/paper-foundation/src/executor.ts` | P3-1 实现（§5.1 各锚点） |
| `packages/paper/paper-foundation/tests/executor-review-semantic.spec.ts` | P3-1 语义红测（§5.2，6 用例） |
| `packages/paper/paper-foundation/tests/executor-review-v2.spec.ts` | E4 账本回归（P3-1 须保持不回归） |
| `DISCIPLINE.md` | 跨批次全局纪律（诚实红灯/声称-代码一致/IR 入口/平台编码禁令） |
| `.workbuddy/memory/2026-09-04.md` | 本批推进 checkpoint 日志（P2 收口→P3 启动细节） |
| `<repo>/.workbuddy/memory/MEMORY.md` | 项目长期记忆（纪律/任务书批次状态） |

---
*本手册由上一 agent 于 P3-1 代码+测试就绪、其余未开工时点撰写，确保下一位 agent 从精确状态无缝接手。*
