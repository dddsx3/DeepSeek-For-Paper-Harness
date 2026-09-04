# TASK-P3 — redteam（每条攻击的 kill 证明）

> 纪律：每条攻击给出 spec 名 + 复现命令；kill 证明 = 攻击用例红（期望拒绝
> 时的拒绝即通过）。全部命令在仓库根执行。

## 复现命令（一次跑全）

```bash
npx vitest run --project=thread-safe \
  packages/paper/paper-foundation/tests/executor-review-semantic.spec.ts \
  packages/paper/paper-foundation/tests/produce/report-representation.spec.ts \
  packages/paper/paper-foundation/tests/delivery/figure-semantic.spec.ts
npx tsx artifacts/handoff/TASK-P3/demo-v3/run-p3-demo.mjs
```

## P3-1 评审语义核对 v1（E5）— `executor-review-semantic.spec.ts`

| 攻击 | 用例 | kill 证明 |
|---|---|---|
| 攻击 1 | `attack 1: prose claiming an unsupported co...` | 散文声称"优于全部基线"而结果表无对比 → 语义 critical（claim_without_evidence）→ outcome rejected / gate-failed |
| 攻击 2（E4a 复用） | `attack 2 (E4a reuse): reworded prose with...` | 改写措辞 + `resolved:[]` → 账本残留仍 BLOCK（唯一离场是显式 resolved） |
| 攻击 3（幻觉防线） | `attack 3: a semantic finding whose ref_ids...` | ref_ids 悬挂（GHOST）→ parse 层拒 → 不 BLOCK（resolved/completed） |
| 攻击 3b | `attack 3b: a fabricated text_span (not in ...)` | 编造 text_span 不在交付文本 → 丢弃 → 不 BLOCK |
| 攻击 4 | `attack 4: a domain-external "semantic" kind...` | 域外 kind（style_issue）→ 不在闭集 → 丢弃 → 不 BLOCK；severity 由 kind 固定，reviewer 不可选 |
| 正例 | `blue path: a clean review of the same prose...` | 干净 review → DELIVER（completed） |

## P3-2 表达层声明制（E6）— `report-representation.spec.ts`

| 攻击 | 用例 | kill 证明 |
|---|---|---|
| 攻击 1 | `attack 1: ≈0.73 with NO representation declaration...` | 无声明 ≈ → 文本守卫拒（默认零容差不动，禁2/禁6） |
| 攻击 2 | `attack 2: declared rounded {dp:2} but the text states 0.729` | 声明 dp:2 但文本 0.729 ≠ 0.731 的规范舍入 0.73 → 拒（绑定校验） |
| 攻击 3 | `attack 3: with_uncertainty referencing a Result whose ±...` | 引用无 ± 记录的 Result → 拒 |
| 攻击 3b | `attack 3b: with_uncertainty stating a ± value that disagrees...` | text ±0.5 ≠ 表内 ±0.012 → 拒（± 绑定校验） |
| 攻击 4 | `attack 4: negative dp in the declaration...` | dp:-1 → 声明校验拒（fail-closed） |
| 攻击 4b | `attack 4b: an out-of-set representation kind...` | significant_figures → 闭集外拒 |
| 攻击 4c | `attack 4c: scientific-notation source values...` | 1e-7 源值 rounded 路径拒（D-P3.2 fail-closed） |
| 正例 | `≈0.73 with rounded {dp:2} against source 0.731 renders` | ROUNDED-LEGAL → 渲染通过 |
| 回归 | `TOO-GOOD-V2 re-run: 0.732 vs table 0.731...` | 仍红（禁9） |
| 回归 | `a rounded declaration does not license numbers of OTHER slots...` | 槽位隔离：他槽借用 0.73 → 拒 |

## P3-4 figure 语义核对 + table（E7）— `figure-semantic.spec.ts`

| 攻击 | 用例 | kill 证明 |
|---|---|---|
| 攻击 1 | `attack 1: a second figure with the same (refs, chart_type, style)...` | 同键二图 → 生产期拒 + store 零 FigureSpec（零部分写入，禁5） |
| 键序 | `the same refs in a different order is still the same key...` | sorted refs → 乱序同键仍拒 |
| 正例 | `positive: line + bar over the same refs are different keys...` | line+bar 同源 → 合法且过 figure 门 |
| 攻击 2 | `attack 2: a table caption carrying a refs-external number...` | caption 0.8 非引用值 → 拒 |
| 攻击 3 | `attack 3: pie stays outside the closed chart_type set` | pie → 白名单拒（回归保持） |
| 攻击 4 | `attack 4: a figure referencing a DataArtifact is refused...` | DataArtifact ref → render-input 层拒（禁4，D-P2.3 不回潮） |
| 回读 | `every series row reads its source ref back...` | 逐 series 回读源 ref，值与 store 一致（全量绘制核对） |

## P3-6 corpus v3 kill 叶 — `demo-v3/run-p3-demo.mjs`（脚本级）

| kill 叶 | kill 证明 |
|---|---|
| SEMANTIC-OVERCLAIM | 文本 0.99 非绑定值 → 容器/报告层拒 → run 不 completed → KILLED |
| ROUND-ESCAPE | ≈0.73 无声明（P3-2 攻击1 形态）→ 拒 → KILLED |
| DUP-FIGURE | 同键二图（P3-4 攻击1 形态）→ 生产拒 → KILLED |
| TOO-GOOD-V2 | 0.732 ≠ 0.731（P2 kill 重演，禁9）→ KILLED |
| CAPTION-ESCAPE | caption 0.8（P2 kill 重演，禁9）→ KILLED |
| OVER-PROMISE | 结论承诺双产出（P1/P2 kill 重演，禁9）→ KILLED |

任一 kill 叶变绿 → 脚本 exit 非零（脚本级执行，不依赖 CI 配置）。
