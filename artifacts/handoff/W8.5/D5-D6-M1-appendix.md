# W8.5-D5/D6 — M1 人工判定 + 附录归档（按预注册 §B 逐条）

> runId `1a2b4f86-c315-4f5a-a985-b0f4d764e0ea` | 2024-C | 终态 BLOCKED
> 判定依据：`bench/PREREGISTRATION.md` §B（不修改标准）

## D5 — M1 逐条判定

| # | 标准 | 满足？ | 证据 |
|---|---|---|---|
| 1 | 交付发生（CLEAN 或 MARKED，非 BLOCKED） | **❌ 不满足** | `run-report.json: status=BLOCKED`；artifacts table = 0（execute 从未产出） |
| 2 | 读题可见（≥2/3 小问回应） | **❌ 不满足** | 无交付物可判 |
| 3 | 数字有源 | **N/A**（无交付物） | — |
| 4 | 非复述（n-gram < 30%） | **N/A**（无交付物） | — |

**M1 判定 = `false`**（标准 1 未满足即判负，与 fail-soft 的诚实边界一致：内容不存在时无一档能交付）。

## D6 — 附录归档

**本次无 MARKED 交付，故无附录**。原因归档（D8 文档）：
- execute 3 次尝试全部被 ir_producer 拒绝（NONE → DRIFT → 耗尽），从未产出任何模型声明的 IR 条目 → 内容不存在 → `BLOCKED`（PRD §3.3 的"内容为空"致命条件，fail-soft 设计上不豁免）。
- 因此 `renderDeliveryAppendix` 未被调用（无交付文本）；`delivery_graded` 审计事件记录 grade=BLOCKED。

**对任务书 D6 的诚实回答**：本轮运行无法检验"MARKED 附录在真实运行中写下什么"——因为没有任何未过项被标注的机会（内容从未生成）。该检验必须留到**首次产出内容的真实运行**（W9+）。这是本轮拿到的信号之一：**当前瓶颈在内容生成，不在标注链路**。
