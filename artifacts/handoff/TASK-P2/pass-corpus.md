# TASK-P2 — pass corpus v2（2026-09-04 基线）

> corpus = demo-v2 leaves（executor 权威入口）+ 既有 vitest kill 网。
> 复现：`pnpm run test:p2:demo`；输出 demo-v2/output/（report.md + sha256.txt +
> figures/ 资产 + summary.json），重跑 sha256 确定、工作树零脏（G8）。

## 合法 leaves（DELIVER，FBR 口径）

| leaf | 形态 | 值 | 交付 |
|---|---|---|---|
| POLAR-ICE | legacy 文本结论 | 0.731 m | report.md + sha256 |
| MELT-POND | legacy 文本结论 | 0.042 | report.md + sha256 |
| RIDGE-DENSITY | legacy 文本结论（单位指数） | 2.4 km^-1 | report.md + sha256 |
| FIGURED-ICE | **结构化槽位结论 + line 图** | 0.731 m | report.md（图 data-uri + 溯源附录）+ figures/FIG-1.svg |

- **FBR = 0/4**（旧三题 0/3 回归 + 新图/槽位题 0/1）。
- 每叶 sha256 见 demo-v2/output/<title>/sha256.txt（确定性，重跑一致）。

## 逃逸 leaves（KILLED）

| leaf | 攻击 | 击杀点 |
|---|---|---|
| TOO-GOOD-V2 | 结论槽位 0.732 vs 表 0.731 | v2 槽位逐字守卫 → 渲染拒 → run 不完成 |
| CAPTION-ESCAPE | 图注引用非 Result 数字 0.8 | figure producer 数字守卫 → 拒 |

## 附注
- vitest 层 kill 网（E4/P2-1/P2-3/P2-4 全部攻击）见 redteam.md；任何 KILL 叶
  在实现修订后变绿必须走 decision-log（FBR 纪律，禁 9）。
- probe（P2-2）fake 自检 1.0 记录于 probe/output/。
