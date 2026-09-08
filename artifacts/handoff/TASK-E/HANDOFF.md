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

## 5. P1-C — 第二模型族 T3 统计资格(2026-09-08 实跑,run-p1c-probe.mjs)

**裁决:QUALIFIED。z-ai/glm-5.3-free(中转第二模型族)T3 闭集填充 14/14 首试全过,
LCB₉₅ = 0.807 ≥ 0.80,ESCAPE = 0,零引导预算。** 严格串行 14 次调用,零传输重试;
真实 usage:in 1,568 / out 4,407 tokens(费用未配价,=0 不猜)。归档
`output-p1c/summary.json` + `records.jsonl`。

探针的两处实现 bug(修前 0/14 → 修后 14/14,**全部是探针自身问题,非模型判决**):
1. **教学段丢失**:`promptFor('', problem)` 把 T3 模板教学段传成空串——模型根本
   没看到闭集候选就被判 `t3_number_forbidden`(模型在无指令下输出的自然语言带
   数字)。修复:传 `templateFillPrompt(defaultTemplateCandidates())`(executor
   同款教学面)。
2. **网络级错误不退避**:`fetch failed`(status 0)不走重试,被记成 TRANSPORT
   失败。修复:status 0 与 429/5xx 同退避族(1.5s 起指数,最多 4 次),预算内
   重试不计失败;耗尽才记 TRANSPORT(且明确 TRANSPORT 不算模型的失败类别)。

另:fill 拒绝分类从正则猜测改为**消费 admitTemplateFill 的闭合失败码**
(`t3_container_forbidden`/`t3_number_forbidden` = ESCAPE;`t3_schema_violation`/
`t3_free_choice` = NONE 族)——失败分类永远是闭合枚举,不是字符串匹配。

**里程碑对照(专家 §22)**:IR 契约冻结 ✓ + 无 key 普通 CI 全绿 ✓ +
**第二模型族过 T3 统计资格门 ✓**(第一个模型族 deepseek-v4-flash 的 T3 统计门
复测待跑——它手上只有 18/18 的旧点估计记录)。距"两个模型族"判据还差
deepseek 侧的一次新协议重测;之后 T3.5 零 ESCAPE 收编 case,即达成学生实测
前置里程碑。

## 6. 未完成 / 下一批

- **deepseek-v4-flash 的 T3 统计门复测**:它手上的 18/18 是点估计记录;统计门
  落地后需用新协议重跑一次 14+(与 P1-C 同 runner,换路由即可)——达成专家
  §22"两个模型族过统计门"判据的最后一块。
- P1-D:T3.5 expand-then-select 原型(专家 §4/§5)。
- P2-A/B/C:T3 vs T3.5 对照、study freeze、case-series(判据:≥2 模型族过统计
  门 + ≥1 个 T3.5 零 ESCAPE 收编 case,之后才进学生实测)。
- CI 实跑验证:e2e.yml/守卫/replay demo 的远端绿灯需要一次 push(本批未 push)。
- pricing 表未配:成本字段恒 0(不猜价);配价后 P1-C 一次 14 跑的真实成本即可
  精确入账。

## 7. 决策记录

1. **replay 也走 usage 复现**:cassette 不只录文本还录 token 账目,使回放成为
   真实跑的完整复现(run-report 逐字节相等),而不是"语义近似"——专家 §14 要求
   确定性推进到模型边界,这是最彻底的形态。
2. **专家 "~0.71" vs 精确 0.7226**:实现取精确值并以二项尾定义式独立验证;
   测试注释记录差异来源(计划书用了近似)。裁决语义(80/100 不过 0.8 门)不变。
3. **零失败 LCB 用闭式 alpha^(1/n) 而非 beta 分位退化**:两者数学等价推导的
   分支上,闭式无数值误差且直接对上 stop rule 数字,选闭式并保留 beta 路径给
   带失败情形。

## 8. TASK-P1D — T3.5 expand-then-select(专家 §4/§5,2026-09-08)

### 8.1 实现(`src/produce/expand-select.ts` + 16 条 invariant)

受限状态机:模型每步只能输出三个闭合动作之一(`SELECT{candidate_id}` /
`REQUEST_EXPANSION{slot, reason}` / `ABSTAIN{reason}`,zod strict union,发明第
四动作即 `t35_move_forbidden` 拒)。关键机制:

- **候选 id 无数字**:harness 铸造的 id 用序数词(`cand-jp-a`、`cand-x-one`),
  于是无条件数字扫描**零例外条款**——本层任何表面(模型写的、harness 铸的)
  都不携带数字,数字零通道保持严格;
- **生成 ≠ 提交**:`admitExpansion` 只把候选放进池(且做闭合内容校验:slot
  形状规则、去重、无数字),canonical 状态只由后续 SELECT 关闭;
- **双硬预算**:MAX_EXPANSIONS_PER_SLOT=2 / PER_RUN=4,耗尽 = 
  `CANDIDATE_SPACE_EXHAUSTED` loud BLOCK(专家 §5.1);
- 失败码闭集:`t35_move_forbidden` / `t35_number_forbidden` /
  `t35_unknown_candidate` / `t35_budget_exhausted`。

### 8.2 专家 P1-D 验收(§13)已满足

`expand-select.spec.ts` 第一组就是专家写的验收条件:**T3 静态池装不下的
`snow_depth` case——T3 `t3_free_choice` 拒;T3.5 走 expansion → validate →
select → PASS,全程 ESCAPE=0**。另 15 条:发明动作拒、container 走私死在数字
扫描、未知候选拒、ABSTAIN 诚实终态、双预算耗尽 loud、生成不提交、去重、
形状规则、id 铸造。

### 8.3 真实模型实测(z-ai/glm-5.3-free,5 轮严串行,run-t35-probe.mjs)

- 第一跑(无决策规则教学):5/5 直接 SELECT seed 候选(mean_thickness 贴切度
  不足但零违规)——模型能操作协议但不会主动判断"池内无答案";
- 加一行**决策规则**("仅当候选真正回答问题才 SELECT;否则必须
  REQUEST_EXPANSION")后重跑:**5/5 轮全走完整循环**——
  `expansion-request`(合法理由码 NO_VALID_CANDIDATE)→ harness 原子生成
  `cand-x-one`(snow_depth)→ `SELECT(cand-x-one)` 提交。**零 ESCAPE**。
  usage:in 1,620 / out 5,263 tokens。

**实证结论**:弱模型在正确的教学面下可以操作 T3.5 状态机完成 T3 无法覆盖
的 case 且零违规——专家 §22 里程碑的"T3.5 零 ESCAPE 收编一个 case"达成。
(注:该 case 的收编由状态机 + 模型协作完成;P2-A 的 T3 vs T3.5 成对对照
实验是下一批。)

## 9. TASK-P1C2 — 双模型族统计资格 + 新中转(y-api,2026-09-08)

### 9.1 测试模型切换(作者指令)

真实测试模型族换轨:**z-ai/glm-5.3-flash**(原 glm-5.3-free 调用量低、适配
价值低);deepseek 侧以 **deepseek/deepseek-v4-pro** 补"第二模型族"资格。两
模型走新中转 `https://api.y-api.bestvirtualgoods.com/v1`(与 tokenrouter 不同
站,key 亦不同,入 gitignored `.env.local`;探针输出已改为**按模型归档**,
`output-p1c/<model-slug>/`、`output-t35/<model-slug>/`,多模型跑不互覆)。

### 9.2 两族资格结果(各 14 次首试,严串行,统计门裁决)

| 模型族 | 模型 | 首试 | LCB₉₅ | 裁决 | usage(in/out) |
|---|---|---|---|---|---|
| z-ai (GLM) | z-ai/glm-5.3-flash | **14/14** | 0.807 | **QUALIFIED (T3)** | 1568 / 2727 |
| DeepSeek | deepseek/deepseek-v4-pro | **14/14** | 0.807 | **QUALIFIED (T3)** | 1540 / 462 |

**专家 §22 里程碑的"≥2 个不同模型族通过 T3 统计资格门"正式达成**(两族零
ESCAPE、零引导预算、零传输重试)。顺带的成本观察:同一 T3 协议下 deepseek-pro
输出 token 仅为 glm-flash 的约 1/6(462 vs 2727)——"用 harness 换模型成本"
叙事的第一手对照数据(M3 成本指标的雏形)。

### 9.3 T3.5 探针(glm-5.3-flash)

5/5 轮全走完整循环(`expansion-request`(合法理由码)→ harness 铸造
`cand-x-one` → `SELECT` 提交),**零 ESCAPE**,usage in 1620 / out 967。与
glm-5.3-free 的结果一致:一行决策规则教学后,弱模型能稳定操作 expand-then-
select 状态机。

### 9.4 cassette 语料库扩容

新增第二盘:`glm53flash-t3-coursework-v1.json`(glm-5.3-flash @ y-api 真实
T3 strict 全链,5 exchanges,含 usage)。回放×2 与真实跑三向一致:zip sha
`ef66fe0b`、usage(in 1946 / out 3037)逐字复现。CI replay demo 改为**遍历
cassettes/ 全部盘**,每盘一对回放断言 sha 相等(本地模拟已验:free 盘
`fb4d4e07`×2、flash 盘 `ef66fe0b`×2)。语料库按"模型+中转"逐盘攒——专家
§2.1 选项 E 的形态。

### 9.5 当前里程碑状态(专家 §22)

- [x] IR 契约冻结(TASK-T1/T1-S2:REF 规则 + UNKNOWN 哨兵 + 三层指纹 + golden)
- [x] 无 key 普通 CI 全绿(paper-harness.yml 连续绿灯,e2e 转纯 manual)
- [x] **≥2 模型族过 T3 统计资格门(glm-5.3-flash + deepseek-v4-pro,各 14/14)**
- [x] **T3.5 零 ESCAPE 收编静态 T3 无法覆盖的 case**(snow_depth,机器 +
  真实模型协作,glm free/flash 双验证)
- [ ] 剩:P2-A(T3 vs T3.5 成对对照实验)→ P2-B(STUDY_MANIFEST 冻结)→
  P2-C(3–5 人 case-series)——按专家序,学生实测的前置里程碑已全部达成。
