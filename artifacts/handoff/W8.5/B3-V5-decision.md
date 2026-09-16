# W8.5-B3 — V5 接入判定（本轮不接，显式记录）

> 任务书要求：判定 V5（对抗性审查）能否在本轮接入 `gradeInput`；若超出本轮工作量，**显式记录"本轮不接 + 原因 + 归属轮次"**。不得沉默。

## 判定：本轮不接

## 依据（调用链，已读码确认）

1. `v5-adversarial.ts` 的输入是 `AdversarialInput.findings`（`finding_id / target_ref / evidence_refs / reason(span)`），判定函数本身**已就绪且 6/6 单测通过**（W7 交付）。
2. 但 run 侧的 review 通道产出的是 **`ReviewDefect`**（`executor.ts:517` `parseReviewReport`），它是 review 账本内部结构（id/severity/description），**没有** `target_ref / evidence_refs / text_span` 字段，也**没有落成 IR 的 `ReviewerFinding`**：
   - `grep -rln "put('ReviewerFinding'" packages/paper/paper-foundation/src/` → **零结果**（无任何代码路径写入该 kind）。
   - `ir-producer.ts:16` 注释称 ReviewerFinding "produced by the execution-capture and downstream"——注释承诺存在，实现不存在（与本轮锚点 §0.4 同类的"组件存在≠接线"问题）。
3. 要让 V5 进入 gradeInput，需要：
   a. review 通道把缺陷**结构化落成 `ReviewerFinding`**（含可解析 `target_ref`/`evidence_refs` + 论文逐字 span）——这要改 reviewer prompt 协议与解析器；
   b. executor 汇集这些 finding 调 `adjudicateAdversarialReview`（需把 store 的 `refResolves` 与交付文本传入）；
   c. "零发现=无效审查"的语义要接进 grade——**但零 finding 在真实运行中大概率发生**（模型倾向给空 defects），这会使所有运行被判"审查无效"→ 需要先定 fail-soft 语义（"审查无效"是 BLOCKED 还是 MARKED 标注）。
4. (c) 的语义决定影响交付等级，超出"点火轮只拿信号"的范围；且 (a) 是协议改动，会改变 review 通道行为——**若在首次真实运行前动它，运行信号将无法归因**（改了管道再测，测的是新管道）。

## 归属轮次

**W11（端到端贯通）** 与 V6/V7 一并以"验证层完整接入"处理；届时先定审查无效的等级语义（建议：无效审查 = MARKED 标注"对抗审查未生效"，非 BLOCKED——与 fail-soft 精神一致，待决策记录）。

## 本轮已完成的替代验证

- V5 判定函数（6/6 单测，W7）；输入协议的缺口位置与原因（本记录）。
