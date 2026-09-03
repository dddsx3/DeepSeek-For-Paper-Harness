# TASK 5.0-R — mutations 击杀报告

本批次未运行独立 mutation 工具批（仓库既有 fault-corpus/mutation 基础设施的击杀基线为 E-01..E-08 = 8/8，见 TASK-2.1 gate-report C8）。本批次的等价"人为变异"击杀全部记录于 `redteam.md`：

1. **RT-D NFC 守卫变异**（symbolTokenSchema refine 恒真）→ RT-D-01 两测试红 → 还原 26/26 绿 —— 证明 redteam15 迁移后守卫被真实覆盖。
2. **stale 引擎直检禁用**（deriveDirectStale → []）→ stale-engine 8/11 红 → 还原 11/11 绿 —— 证明 S-001..S-009 + gate 集成真实覆盖 stale 检测管线。
3. **RG-09 反证**（gate-report `gates_impl` 篡改一 id）→ verifier DRIFT + exit 1 → 还原 PASS。

P1 批次将按任务书要求跑正式 mutation 击杀批（F 序列延续）并在此目录产出逐 fault 报告。
