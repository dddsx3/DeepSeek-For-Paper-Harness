# TASK-E + TASK-Q2 — CI/真实API 解耦 + 统计资格门 + 成本遥测(专家计划 Commit 2 & 3)交接文档

> 头:`4cdc9f8cb1`(TASK-T1-S2)之后两个批次,实现专家计划书 §2(P0-C)+ §6(P1-B
> 前半)与 P0-B 剩余。本文件合并两个 commit 的交接:`85f419fe7d`(TASK-E +
> golden)与 `09f6b878ff`(TASK-Q2)。

## 1. TASK-E(CI 与真实 API 解耦,专家 §2.1 / 选项 E)

### 1.1 e2e.yml 转纯 manual

push/PR/nightly 触发全部移除,只留 `workflow_dispatch`。原因记录在文件头:**push CI
不持有 key 是永久事实,不该造成常红检查**;"无 key 即 FAIL"与"真实 adapter 进了
CI"是两种错误,只有后者值得 FAIL(专家 ADR-004)。concurrency 的 PR-cancel 逻辑
随之删除(manual 无可取消对象)。

### 1.2 REAL_API_POLICY=never 守卫(scripts/verify-real-api-policy.ts)

- **正面**:pin 三个不变量——e2e.yml 触发块 manual-only(含 push/PR/schedule/
  pull_request_target 任一出现即 FAIL)、paper-harness.yml 中非 dispatch-gated
  job 不得读任何 provider key secret、`REAL_API_POLICY=never` 环境下任何真实路由
  变量已配置即 FAIL(边界已被穿透,无需等到调用发生);
- 已挂进 paper-harness.yml push 门(带 `REAL_API_POLICY: never` env);
- 本地实测:正向 PASS;`PAPER_PROBE_API_KEY=sk-leak-test` 污染注入 → exit 1,
  报"the deterministic boundary is breached"。

### 1.3 Cassette 录制/回放(apps/paper-shell/src/cassette.ts + CLI `--cassette`/`--replay`)

- 录制:每次 seam 调用的请求指纹(sha256 over provider/model/system/messages,
  content 数组形式与字符串形式归一)→ 组装响应文本 + **usage**(TASK-Q2 后);
- 回放:**按指纹**(非调用序号——同引擎重试/降层会改变调用顺序,指纹才是请求的
  身份);未知指纹 loud FAIL("cassette miss",禁7 式显式拒绝,绝不猜、绝不落网络);
- 卫生:cassette schema 恒为 `request_fingerprint/provider/model/
  response_sha256/response_text/usage?` 六键,凭证/头/用户隐私零进入(spec 钉死);
- 模式互斥:`--cassette`(录制,仅真实跑)与 `--replay`/`--fake` 互斥,replay
  是离线模式不要求路由、不记 production_enabled。

**关键实证(专家 §14 Replay property)**:
`z-ai/glm-5.3-free` 真实 T3 strict 跑(DELIVERED,5 exchanges,经一次 429 退避)
→ 录成 `artifacts/handoff/TASK-E/cassettes/glm-t3-coursework-v3.json` → 三次回放:
report sha `b99f8923`、**zip sha `fb4d4e07` 与真实跑完全一致**,usage(in 2239 /
out 9227)逐字复现。**same cassette → same IR → same gate → same ZIP sha256 +
same telemetry 全链成立。**

CI 新步骤:paper-harness.yml push 门跑两次回放并断言 zip sha 相等(无 key 无
网络即可复现专家 property)。

## 2. P0-B 剩余(golden fixture)

`tests/ir/golden/ir-fingerprints-v1.json` + `golden-fingerprints.spec.ts`(6 条):
canonical backbone 链的 environment/edge/closure/freeze/manifest/chain 六个哈希
被钉死为常量。**迁移规则**(spec 头部):任何故意的指纹语义变更(新命名空间、
edge 集新增字段)必须在同一 commit 里显式更新 golden 并在 commit message 里点名;
非故意漂移(改了 canonical 序列化而没察觉)会被测试当场击杀。fingerprint
versioning 由命名空间字符串内嵌于哈希输入交付(`DEP-EDGE-v1` 等,语义空间不可能
碰撞)。`emit-golden.ts` 是一次性生成器(仅在故意语义变更时运行)。

## 3. TASK-Q2(统计资格门 + 成本遥测,专家 §3.1/§6)

### 3.1 exactLowerConfidenceBound(qualification.ts)

Clopper-Pearson 精确单侧下界,零依赖纯函数:

- **零失败闭式** `alpha^(1/n)`:14 次全成功证 p>0.80、29 次证 p>0.90——**专家
  stop rule 的数字被精确复现**(0.05^(1/13)=0.794<0.8<0.807=0.05^(1/14);
  0.899<0.9<0.902)。首次实现曾用 beta 分位退化出 1-α,被测试击杀后修正——
  任何 p<1 都有 p^n 概率产生 n 次全成功,下界必须为此定价;
- **带失败** beta 分位路径(Lentz 连分分数值,二分反解,精确到 1e-12);
  80/100 = **0.7226**(经二项尾独立验证 P(X≥80|0.7226)=0.0496≈α;专家计划书
  引的 "~0.71" 是近似值,精确值进测试注释)。

### 3.2 evaluateQualification + registry 统计门

资格 = `LCB₉₅(p) ≥ p_min` AND `ESCAPE=0` AND `retryBudget=0`。专家核心示例落地:
**8/10(LCB 0.493)与 80/100(LCB 0.723)不再同等资格**;18/18 诚实地只声称
"p>0.8"而非"p≥0.9"。`upgradeVerdict` 消费:新记录(successes/escapeCount)走统计
门;legacy 归档形状回退点估计(旧记录可加载,但只有新探针能定资格)。

### 3.3 UsageTelemetry(usage-telemetry.ts)

每 run 账目:model_calls/retried_calls/in/out/cache_hit/retry tokens/路由分组/
成本(按 provider/model 的 per-1M 定价,未定价=0 不猜)/硬预算四维
(MODEL_CALLS/INPUT/OUTPUT/COST,超限即 exceeded 列出——BLOCK 语义,不静默续跑)。

### 3.4 真实链路接线

- real-provider 请求体加 `stream_options: {include_usage: true}`,解析终块
  `choices:[]` 上的 usage 块,发 runtime `{type:'usage'}` chunk(input=未缓存
  输入,cached 单列)——**修复了一个真 bug:usage 块在 finish_reason 之后到达,
  原实现在 finish 处 break 会漏掉它**;
- executor 既有 recordUsage/BlockAssembler 原生吃 usage chunk,零引擎改动;
- shell run-report/console 输出 usage 摘要;demo:pw zip 因 usage 字段
  `5e775fb8`→`e14d687b`(两次重跑一致,确定性保持);
- cassette 录/放 usage(见 §1.3),真实跑与回放的 run-report 因此完全相等。

## 4. 验证矩阵(全部实测)

| 项 | 结果 |
|---|---|
| paper-foundation | 1040→1060→1066→**1089/1089(98 文件;+49 测试)** |
| shell | 8→15/15(cassette 7 条) |
| RG-06/07/09 | PASS 三连(baseline 三次同步) |
| P1/P2/P3 demo + demo:pw | corpus 全绿;pw zip e14d687b 确定性 |
| 守卫 | 正向 PASS;污染注入 exit 1 |
| cassette property | 真实跑 = 回放(zip fb4d4e07、usage 逐字)×3 次 |
| 统计数学 | 14/29 stop rule 精确复现;80/100=0.7226 二项尾独立验证 |
| 新 key 实跑 | z-ai/glm-5.3-free T3 strict DELIVERED(含一次 429 退避,并发闸工作) |
| tsc -b(host + shell + foundation) | 0 |

## 5. 未完成 / 下一批

- **P1-C(进行中)**:z-ai/glm-5.3-free 的 T3 资格探针真实批次(≥14 次首试,
  统计门出裁决)——cassette 与 usage 遥测已备好采集面。
- P1-D:T3.5 expand-then-select 原型(专家 §4/§5)。
- P2-A/B/C:T3 vs T3.5 对照、study freeze、case-series(里程碑判据:≥2 模型族
  过统计门 + ≥1 个 T3.5 零 ESCAPE 收编 case,之后才进学生实测)。
- CI 实跑验证:e2e.yml/守卫/replay demo 的远端绿灯需要一次 push(本批未 push)。

## 6. 决策记录

1. **replay 也走 usage 复现**:cassette 不只录文本还录 token 账目,使回放成为
   真实跑的完整复现(run-report 逐字节相等),而不是"语义近似"——专家 §14 要求
   确定性推进到模型边界,这是最彻底的形态。
2. **专家 "~0.71" vs 精确 0.7226**:实现取精确值并以二项尾定义式独立验证;
   测试注释记录差异来源(计划书用了近似)。裁决语义(80/100 不过 0.8 门)不变。
3. **零失败 LCB 用闭式 alpha^(1/n) 而非 beta 分位退化**:两者数学等价推导的
   分支上,闭式无数值误差且直接对上 stop rule 数字,选闭式并保留 beta 路径给
   带失败情形。
