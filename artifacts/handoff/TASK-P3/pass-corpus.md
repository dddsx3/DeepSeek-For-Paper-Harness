# TASK-P3 — pass-corpus（corpus v3 leaves 表 + sha256 + FBR 双口径）

> 入口：`artifacts/handoff/TASK-P3/demo-v3/run-p3-demo.mjs`（executor 权威
> 路径，strict 真九门；`pnpm run test:p3:demo`）。
> 重跑零脏：summary 已 UUID 脱敏（F1），两次运行 byte-identical
> （G8 字面成立）。

## Legal 5（必须 DELIVER）

| 叶 | 覆盖路径 | report sha256 |
|---|---|---|
| POLAR-ICE（Polar ice thickness） | legacy 逐字结论守卫（P1/P2 回归） | `6271f0c25e6d692a7b19f2baf1e556b26fd17687d097ef5cd708dc5c1f7b42a9` |
| MELT-POND（Melt pond fraction） | 无不确定度 Result（P1/P2 回归） | `96f4ebb416b7444519714c0a37d35cb1c8ae1de19029afc6d58d87f300f3d38c` |
| RIDGE-DENSITY（Ridge density） | km^-1 单位指数（renderer 数字守卫回归） | `8fd36af92a8ac001b535ba8dd341b882de461643dbbfdbac39ae4ff54dc749b9` |
| FIGURED-ICE（Polar ice with figure） | figure 声明制 + 结构化槽位（P2 回归 + P3-4 唯一性键下单图合法） | `3c398379427123a3e40df058d916616e60ca64cb74082cc91240e85d309a52b1` |
| ROUNDED-LEGAL（Rounded ice report） | **P3-2 声明制放行**：rounded {dp:2}、文本 ≈0.73、源 0.731 | `bcc358300dba0eacacb69dd2cb60d817ac55d5cbcaa68e4462e91869c82a3c65` |

## Kill 6（必须 KILLED；任一变绿脚本 exit 非零）

| 叶 | 家族 | kill 层 |
|---|---|---|
| SEMANTIC-OVERCLAIM | P3-1/E5 | 文本守卫（0.99 非绑定值）；reviewer 语义 killer 由 executor-review-semantic.spec 攻击 1 承担（D-P3.5） |
| ROUND-ESCAPE | P3-2/E6 | 无声明 ≈（攻击 1 形态） |
| DUP-FIGURE | P3-4/E7 | 同键二图（攻击 1 形态，零部分写入） |
| TOO-GOOD-V2 | P2 禁9 重演 | 0.732 ≠ 0.731 |
| CAPTION-ESCAPE | P2 禁9 重演 | figure caption 0.8 非引用值 |
| OVER-PROMISE | P1/P2 禁9 重演 | 结论承诺双产出 |

## FBR 双口径

| 口径 | 值 | 判定 |
|---|---|---|
| 结构 FBR（legal 未 DELIVER / legal 总数） | **0/5** | 绿 |
| 语义误杀率（legal 叶中带证据语义 finding 数 / legal 总数） | **0/5** | 绿（fake reviewer 干净 verdict 下由 harness 自身 mint 的语义 finding 计数；真实 reviewer 误杀面为已知风险 P3-1） |

## 图资产溯源

| 图 | sha256(svg) |
|---|---|
| FIG-1（Polar ice with figure / line） | `e2f98dd942ea2527e2143331bb2694826f075868c34674f75846723bec063f04` |

## 提交的运行时证据

- `demo-v3/output/summary.json`（UUID 脱敏；sha256
  `c9462c6885a26c54fba60259b90f7ede52fc3c9e9c37cf883201e25ca229067d`）
- `demo-v3/output/<leaf>/report.md` + `sha256.txt`（5 legal 叶全量）
- `demo-v3/output/Polar ice with figure/figures/FIG-1.svg` + `.sha256`
