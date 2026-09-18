# D0 —— 真实运行前的姿态记录（W8.10-D1 要求）

| 项 | 值 | 依据 |
|---|---|---|
| 题目 | `bench/problems/2024-B/problem.pdf` | 唯一"路由 × 契约对齐"的题（真值 F3+F4，两族均已契约）；用 2024-C 会被正确拒绝（缺 F2） |
| **模型** | **`deepseek/deepseek-v4-flash`** | **目标模型**（原始目标："让 DeepSeek 建出来的一定不能坏"）。A8 实测该模型在中转上可用（HTTP 200 / 1.0 s） |
| 为什么换掉 W8.9 的模型 | `z-ai/glm-5.3-flash` 已下架（HTTP 503 model_not_found） | A8 |
| 代码来源守卫 | 运行前跑 `probe-provenance.mts`，要求 `ok=true`；运行中会打印 `[CODE-FRESH]` | A1 / §2.1（H1） |
| 预算门 | `PAPER_MAX_OUTPUT_TOKENS_PER_RUN` 未设 = 无上限（A7 已实测该门生效；本轮用无上限以便观察真实行为） | A7 |
| `PAPER_PROBE_REASONING` | `none`（适配器默认，W8.9-D1 实测：不限则 reasoning 吃掉全部预算返回空 content） | W8.9-D1 / B4 待探 |
| 模式 | `--mode strict --fail-soft` | 与 W8.9 三次运行一致，便于对比 |
| 预期 | 可能仍 BLOCKED。**无论结果如何都全量归档**（红线 N7） | §5.2 |

## 与 W8.9 的可比性

W8.9 在同一题上跑过 3 次（全 BLOCKED，模型 `z-ai/glm-5.3-flash`）。
本轮同时改变了**两件事**：模型（→ 目标模型）与 E2 回灌（B 组）。
**归因时须注意**：若本轮成功，无法区分是"目标模型更强"还是"回灌生效"。
若失败，也同理。这个混淆**必须写进报告**，不得把结果归因给单一变量。
