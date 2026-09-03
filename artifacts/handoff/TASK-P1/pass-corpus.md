# TASK-P1 — pass corpus（2026-09-04 首基线）

> runner：`artifacts/handoff/TASK-P1/demo/run-p1-demo.mjs`（`pnpm run test:p1:demo`）。
> 每 leaf = 完整 FORMAL 产线（容器→真 node 执行→interpretation→v1 报告→九门→落盘）。
> 权威执行：CI（Linux，paper-harness.yml P1-5 step）；本地 tsx 同构复验。

## 合法 fixture（3/3 DELIVER，False Block Rate = 0/3）

| leaf | 量 | 结果值 | 交付 | sha256 |
|---|---|---|---|---|
| POLAR-ICE | mean ice thickness | 0.731 m | report.md 落盘 | 见 `demo/output/POLAR-ICE/sha256.txt` |
| MELT-POND | melt-pond fraction | 0.042 | report.md 落盘 | 见 `demo/output/MELT-POND/sha256.txt` |
| RIDGE-DENSITY | ridge density | 2.4 km^-1 | report.md 落盘 | 见 `demo/output/RIDGE-DENSITY/sha256.txt` |

## 错误 fixture（2/2 KILLED）

| leaf | 攻击面 | 击杀点 |
|---|---|---|
| TOO-GOOD | 结论抄错关键数字（0.732 vs 真实 Result 0.731） | renderV1Report → `conflicting_conclusion_number` |
| OVER-PROMISE | 承诺 2 个 REQUIRED_OUTPUT，只证明 1 个 result | requirement_coverage（A7 count-bound BLOCKED） |

## 口径

- 合法 = 九门（FORMAL，runtimeProfileValid=true，loadCode 真实读码）全 PASS
  且渲染通过且 report.md 真实落盘、sha256.txt 同步。
- FBR = 合法 leaf 中被误拦数 / 总数。首基线 0/3（D5 单位指数修正后达成：
  初版 renderer 曾把 `km^-1` 的 `-1`/`1.` 误当数字 → RIDGE-DENSITY 误杀，
  修正后 3/3）。
