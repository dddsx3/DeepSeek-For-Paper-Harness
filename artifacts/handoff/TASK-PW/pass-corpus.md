# TASK-PW — pass-corpus（corpus v4 leaves 表 + sha256 + FBR 双口径）

> 入口：`artifacts/handoff/TASK-PW/demo-v4/run-demo-v4.mjs`（executor 权威
> 路径，strict 真九门；`npx tsx artifacts/handoff/TASK-PW/demo-v4/run-demo-v4.mjs`）。
> corpus v4 = T1 全叶（P3 corpus v3 原容器，FBR 0/5 独立成立）+ T2/T3 正例
> （两层各自新增，均与"harness 组装容器的 T1 一次性 twin" byte-identical）。

## Leaves 9（必须 DELIVER）

| 叶 | 层 | 覆盖路径 | report sha256 |
|---|---|---|---|
| POLAR-ICE | T1 | legacy 逐字结论守卫（P1/P2 回归） | `6271f0c25e6d692a7b19f2baf1e556b26fd17687d097ef5cd708dc5c1f7b42a9` |
| MELT-POND | T1 | 无不确定度 Result（P1/P2 回归） | `96f4ebb416b7444519714c0a37d35cb1c8ae1de19029afc6d58d87f300f3d38c` |
| RIDGE-DENSITY | T1 | km^-1 单位指数（renderer 数字守卫回归） | `8fd36af92a8ac001b535ba8dd341b882de461643dbbfdbac39ae4ff54dc749b9` |
| FIGURED-ICE | T1 | figure 声明制 + 结构化槽位（P2/P3-4 回归） | `3c398379427123a3e40df058d916616e60ca64cb74082cc91240e85d309a52b1` |
| ROUNDED-LEGAL | T1 | P3-2 声明制放行（rounded {dp:2}、文本 ≈0.73、源 0.731） | `bcc358300dba0eacacb69dd2cb60d817ac55d5cbcaa68e4462e91869c82a3c65` |
| POLAR-ICE-T2 | T2 | 三步向导 → 组装 → 同信任链（run 声明 → Result 声明 → claims 引用） | `a5a3d6699ae663e3c476b041a75116c11532079d07ede9d38c00d381ff5c98e4`（= 其 T1 twin） |
| MELT-POND-T2 | T2 | 三步向导 → 组装 → 同信任链 | `a2e61e01ed77c42cf764f37a79b23fd1c67aa3b2a897f3408a49f08a3db2a054`（= 其 T1 twin） |
| POLAR-ICE-T3 | T3 | 闭集填充一次 → 组装 → 同信任链 | `5f6f0dd32d53909bda3dd2a8477b2b5915944c8684a05059ae98fdd3bd9bee97`（= 其 T1 twin） |
| ROUNDED-LEGAL-T3 | T3 | 闭集填充一次 → 组装 → 同信任链 | `3a6dcfd576c04b46550402552351653da298397fa6d8b913b90b816acb73efc2`（= 其 T1 twin） |

## FBR 双口径

| 口径 | 值 | 判定 |
|---|---|---|
| 结构 FBR（未 DELIVER / 总数） | **0/9** | 绿（T1 5/5 + T2 2/2 + T3 2/2） |
| 层间等价（T2/T3 与各自 T1 twin 同 sha256） | **0/4 不一致** | 绿（byte-identical；demo 的 tierRegistry 断言的 TIER_MISMATCH 计数 = 0） |

## 层注册演示（demo v4 的 tierRegistry 输出语义）

| 条目 | 含义 |
|---|---|
| `T1:<id>` | 该叶在 T1（一次性完整声明）注册 |
| `T2:<id>` | 该叶在 T2（三步向导）注册 |
| `T3:<id>` | 该叶在 T3（闭集填充）注册 |
| `<id>-T1EQ` | 向导/填充组装容器的 T1 一次性 twin —— 与 T2/T3 叶同 sha256（断言通过） |

> 禁 7 说明：demo v4 与 probe v3 都是 fake（确定性地层），真实层资质
> （FORMAL 判定、≥0.8 adherence、降级链）属于 probe v3 real 段 —— 无 key
> 时显式 SKIPPED，本 demo 从不冒充真实层测量。