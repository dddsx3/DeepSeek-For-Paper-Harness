# TASK-P2 交接 — 对照实验(P2-A)、冻结机制(P2-B)、实测协议(P2-C)

> 头:`62738c4db5`(P1C2)之后。任务书:DeepSeek-For-Paper-Harness-下一步任务书
> (TASK-P2)。三裁决单 **B/B/B 代签入库**(`decision-log.md`)。

## 1. P2-0 前置小修(全部落地)

| 项 | 内容 | 证据 |
|---|---|---|
| F8 | p1c/t35 探针 records.jsonl 逐条落盘(problem_hash/outcome/failure_class/usage,增量 flush);`validateTrail` 不变量 + spec(7 测试,含对已归档 14 行 trail 的实测校验);**既往空 trail 缺口如实注明**(INVALID.md 与 flash summary f8_note),不编造 | `tests/probe/record-trail.spec.ts` |
| 定价表 | `TASK-P2/pricing.json`(配置非代码;**初版为占位估值**,cost≠0 的声称必须注明"按占位价";未配模型恒 0 不猜价 NOT-NOW #10);p1c 探针与 P2-A 执行器接线 loadPricing/costOf | HANDOFF §D-P2-0 |
| legacy 标注 | `CombinationRecord.legacy?: 'legacy-protocol'`;`upgradeVerdict` 对 legacy 记录**无条件拒绝**(18/18 也一样,点估计口径 + 旧协议契约);M1 probe-real 归档已标注(superseded_by 指向 P1C2 统计门记录) | registry.ts + record-trail.spec(3 测试) |
| CI push 实证 | 本批 push 后归档 run URL | 见 §6 |

## 2. P2-A — T3 vs T3.5 配对对照(核心结果)

**执行**:24 对(12 closed + 12 expansion,case-bank 预注册先于执行落库),同模型
z-ai/glm-5.3-flash(已过统计门),严串行,首试口径,断点续跑(run1/run2 的
harness 侧 bug 见 §4 偏差声明;T3 arm 数据 run2 采集,T3.5 arm 数据 run3 采集,
两轮的预注册口径一字未动)。

### 结果(run3,`experiment-output/report.json`)

| | closed(12) | expansion(12) | 合计 | out tokens | per-success | cost(占位价) |
|---|---|---|---|---|---|---|
| **T3** | **12/12** | 0/12 | 12/24 | 4,066 | 339 | ¥0.019 |
| **T3.5** | **12/12** | **7/12** | 19/24 | 43,360 | 2,282 | ¥0.199 |

- **不一致对:b(T3 独过)= 0,c(T3.5 独过)= 7 → McNemar 精确 p = 0.0156(显著)**;
- **T3.5 在 closed case 上零损失**(b=0)——表达力扩展没有牺牲可靠性锚点;
- **表达力单价:+7 case ≈ +39,294 输出 token ≈ 5,613 token/新覆盖 case**
  (第一张 (可靠性, 表达力, 成本) 三元组表;占位价口径);
- **诚实负结果(风险 #4 预期)**:T3.5 的 5 个 expansion 失败 = 4×
  `expansion_off_target`(模型在解析 unit 槽时对 json_path 发 REQUEST_EXPANSION
  ——**槽位纪律是真实短板**)+ 1× `t35_move_forbidden`(ESCAPE);
- **T3.5 资格门未过:LCB₉₅ = 0.610 < 0.80 且 ESCAPE = 1 → registry 不落 T3.5
  资格行(G5 不满足,如实记录)**。T3.5 维持"研究/扩展协议",T3 仍是唯一生产层。

### 论文可写结论

"约束强度 ↑ ⇒ 可靠性门槛可过的模型面更小,但表达力收窄;T3.5 以 6.7× 的输出
token 代价恢复 7/12 的表达力缺口,且零 closed-case 回退;其剩余失败集中在槽位
纪律(4/5)——这是下一轮协议改进的直接靶点。" (n=24 筛选性对照口径,预注册。)

## 3. P2-B — STUDY_MANIFEST 冻结机制(全部落地)

- `apps/paper-shell/src/study-manifest.ts`:buildStudyManifest(git_commit/
  engine 版本/route class(无 URL 无 key)/采样参数/每用户 tier+题目哈希/四硬
  预算/**T3 模板与 T3.5 教学串的 sha256**(canonical builder:
  `expandSelectTeaching`,内容寻址不是承诺)/manifest_hash 自锚;
- `verifyStudyManifest`:**锚失配也继续逐字段核对**(漂移清单完整点名,不隐藏);
- CLI:`paper-shell study manifest verify <file>`(端到端实测:OK / 篡改后
  3 条漂移 exit 1);
- spec 12 条(`apps/paper-shell/tests/study-manifest.spec.ts`):任意字段篡改
  必红(G7,含 sneaky 不改 anchor 的场景);**fixture manifest 已落库**
  (`study-manifest/study-manifest.json`,STUDY-A-PILOT 模板;真实冻结待用户
  名单登记后做,G6 待 G)。

## 4. 偏差声明(D-P2-A.x,全部 harness 侧、非统计口径)

| 偏差 | 内容 | 处置 |
|---|---|---|
| D-P2-A.1(run1) | runT3Arm 把响应信封对象直接传给 admitTemplateFill("[object Object]")+ usage 字段名未归一 → 24 个 T3 首试全部假性失败,**数据无效** | 归档 `experiment-output-INVALID-run1/`(含 INVALID.md);修复后完整重跑 |
| D-P2-A.2(run2) | T3.5 arm 要求双 slot 在同一 session 两次 SELECT(违反机器单选合同)+ expansionPrompt 无题面 + trail usage 字段名读错 → T3.5 arm 24 个数据无效;**T3 arm 12 对有效保留** | T3.5 arm 重跑(run3);T3 数据原样;INVALID.md 补记 |

统计口径(case-bank/README.md 预注册)**从未变更**——三次重跑修的都是执行器
适配层,不是判定规则(禁 P2-A #2/#3 未触)。

## 5. P2-C — pilot-protocol.md 定稿

`pilot-protocol.md` 已定稿:M1(x/5 原始数)/ M2(False Accept,双目复核:
冷却自复核 + 审计轨交叉,裁决单 P-B=B)/ M3(人工分钟数分账 + 占位价成本)/
FalseBlock 逐条裁决表 / n=5 纪律(禁显著性表述)/ 知情同意文本 / manifest
冻结时序(G6 依赖用户名单)。

## 6. Gate 表对照

| Gate | 状态 |
|---|---|
| G1 records 非空且行数==attempts | ✅ validateTrail spec + 已归档 14 行实测 |
| G2 定价表配后 cost≠0 且可手算 | ✅ 机制在(P2-A 报告 cost 按占位价 ≠0);**价格本身为占位**,真实结算待账单校准 |
| G3 CI run URL | 本批 push 后补录(见 TASK-INDEX) |
| G4 题库 ≥24 对 + 配对记录 + McNemar 落档 | ✅ 24 对 + 48 arm 记录 + p=0.0156 |
| G5 T3.5 资格行 | ❌ **未满足(诚实负结果)**:LCB 0.610 + ESCAPE 1 → 不落行 |
| G6 冻结 commit 先于用户 run | ⏳ 机制就绪,真实冻结待用户名单 |
| G7 manifest verify spec 在 CI | ✅ 12 条篡改必红 |
| G8 pilot-protocol 定稿 | ✅ |
| G9 1105 基线零改动全绿 | ✅(新增测试不动既有断言) |
| G10 实测期无静默语义变更 | 实测未开始;机制(verify + Batch B)就绪 |

## 7. 复现命令

```bash
npx tsx artifacts/handoff/TASK-P2/run-paired-experiment.mjs   # 断点续跑;完整后出 report.json
npx tsx apps/paper-shell/src/cli.ts study manifest verify artifacts/handoff/TASK-P2/study-manifest/study-manifest.json
npx vitest run --project=thread-safe packages/paper/paper-foundation/tests/probe/record-trail.spec.ts
npm run test:m1:shell   # 含 study-manifest 12 条
```
