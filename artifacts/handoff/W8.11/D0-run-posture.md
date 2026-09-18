# W8.11 D0 —— 真实运行前的姿态记录

| 项 | 值 | 依据 |
|---|---|---|
| 题目 | `bench/problems/2024-B/problem.pdf` | 唯一"路由 × 契约对齐"的题（真值 F3+F4，两族均已契约）。**不得用 2024-C**（缺 F2，会被正确拒绝——空跑） |
| 模型 | `deepseek/deepseek-v4-flash` | 目标模型（W8.10 起已换掉 `z-ai/glm-5.3-flash`） |
| 代码来源守卫 | 运行前 `probe-provenance.mts` = **`ok=true`**（132201 ms newer） | A0 门 |
| 预算门 | `PAPER_MAX_OUTPUT_TOKENS_PER_RUN` 未设 = 无上限 | A7 已实测该门生效（W8.10）；本轮不设上限以便观察真实行为 |
| `PAPER_PROBE_REASONING` | `none` | W8.10-B4 实测：不限则 reasoning 吃掉全部预算、E1 产出为零 |
| 模式 | `--tier T1 --mode strict --fail-soft` | 与 W8.10 四次运行一致，便于对比 |
| **本轮新增的生成侧变量** | **A1（E1 锚点 id 形态约束）** | §0.7 单变量声明：A 组是唯一改生成行为的改动 |
| **本轮新增的观测侧** | **B2（E1/E2 落盘）** | 只写 artifact body 域，不进任何模型可见通道（红线 N17） |
| 预期 | 可能仍 BLOCKED。**无论结果如何都全量归档**（红线 N7） | §A2 |

## 与 W8.10 的可比性

W8.10 在同一题上跑过 4 次（全 BLOCKED，失败面收敛为两条 fidelity 规则）。
本轮**同时改变**：A1（E1 指令措辞）与 B2（落盘，观测侧不影响生成）。
**归因时须注意**：若 B3 反向由 FFF 转 PPP，那是 A1 的功劳；若 B3 正向仍 FAIL，
**B2 现在能给出可核验的证据**（E1 全文与容器都落盘了），这是 W8.10 做不到的。
