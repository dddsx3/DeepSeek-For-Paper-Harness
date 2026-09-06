# TASK-PW — redteam（每条攻击的 kill 证明）

> 纪律：每条攻击给出 spec 名 + 复现命令；kill 证明 = 攻击用例红（期望拒绝
> 时的拒绝即通过）。全部命令在仓库根执行；P3 的六 kill 叶在 demo-v4 T1 层
> 重演（禁 9：kills 不随版本升级失效）。

## 复现命令（一次跑全）

```bash
npx vitest run --project=thread-safe \
  packages/paper/paper-foundation/tests/executor-tier.spec.ts \
  packages/paper/paper-foundation/tests/guided-steps.spec.ts \
  packages/paper/paper-foundation/tests/template-fill.spec.ts \
  packages/paper/paper-foundation/tests/executor-guided.spec.ts \
  packages/paper/paper-foundation/tests/registry.spec.ts
npx tsx artifacts/handoff/TASK-PW/demo-v4/run-demo-v4.mjs
npx tsx artifacts/handoff/TASK-PW/probe-v3/run-probe-v3.mjs
```

## W4 失败分类五类 — `executor-tier.spec.ts`

| 攻击 | 用例 | kill 证明 |
|---|---|---|
| ESCAPE 映射 | `classifies the five classes with exact codes` | content_hash / input_asset_domain / registered_id_redeclared → ESCAPE（第 1 段精确映射） |
| NONE vs DRIFT | `splits parse_failed by the raw text` | 散文 → NONE；JSON 形 → DRIFT |
| 攻击 1（ESCAPE 零预算） | `attack 1: an ESCAPE (content_hash) is refused with zero budget` | 一次调用、无重试、run failed、escape_refused 入账 |
| 攻击 2（NONE 耗尽降层） | `attack 2: NONE forever spends the budget (3 attempts) then fails and degrades T1→T2` | 2 次引导耗尽 → gate_failed + tier_degraded（T1→T2 入账） |
| NONE ≠ 错 | `NONE ≠ 错: prose first, then a container after the guided retry` | 散文一次 → 引导后容器 → run 完成（可恢复） |
| DRIFT 字段纠错 | `DRIFT: schema-violation first, corrected after the field-level guidance` | schema 错 → 字段级引导点名字段 → 修正后完成（DRIFT 预算 2 独立） |

## W2 T2 引导小步 — `guided-steps.spec.ts` + `executor-guided.spec.ts`

| 攻击 | 用例 | kill 证明 |
|---|---|---|
| 正例 | `three steps admit in order... then the container assembles`；end-to-end `happy path: three steps deliver the SAME report sha256 as the T1 container path` | 三步准入 → 组装 → 与 T1 同 sha256（宣言满足） |
| 攻击 1（跨步键） | `攻击1: step 2 payload carrying step-1 keys is refused as a foreign key`；end-to-end `attack 2: a foreign key in a step is DRIFT` | step_foreign_key 拒；executor 层引导重试 + 引导文本点名 WA 字段（RETRY GUIDANCE 含 DA-RAW） |
| 攻击 2a（自由 id） | `攻击2a: a free data_id (not a harness candidate) is refused` | free_id 拒 |
| 攻击 2b（自由结构） | `攻击2b: a unit outside the closed table is refused` | free_structure 拒（闭表） |
| 攻击 3（未入账引用） | `攻击3: a claim referencing an unledgered result is refused`；end-to-end `attack 3: ... ESCAPE — zero budget` | unledgered_reference 拒；executor 层 ESCAPE 零预算（无 provider_retry） |
| 攻击 4（绕过向导） | `攻击4: a full container smuggled past the wizard is refused`；end-to-end `attack 1: a full container smuggled into a step is ESCAPE` | bypass_container 拒；executor 层 ESCAPE + 零 IR 写入（ModelSpec 计数 0） |
| 步序 | `step out of order is refused (步 1 未准入不进入步 2)` | step_out_of_order 拒 |
| 散文 | `prose (non-JSON) in a step is refused as schema_violation` | schema_violation 拒 |

## W3 T3 模板填充 — `template-fill.spec.ts` + `executor-guided.spec.ts`

| 攻击 | 用例 | kill 证明 |
|---|---|---|
| 攻击 1（自由数字） | `攻击1: a free number in the fill-in is refused (数字零通道保持)`；end-to-end `attack 1: a free number in the T3 fill-in is ESCAPE` | t3_number_forbidden；executor 层 ESCAPE 零预算 |
| 攻击 1b | `攻击1b: even a bound-looking number in prose is refused` | t3_number_forbidden |
| 攻击 2（容器走私） | `攻击2: a container-shaped payload is refused`；end-to-end `attack 2: a container-shaped payload in T3 is ESCAPE` | t3_container_forbidden；executor 层 ESCAPE |
| 攻击 3（自由选择） | `attack 3: a non-candidate slot value is refused as a free choice` | t3_free_choice（json_path 非候选 → demo v4 debug 已实证该码） |
| 攻击 4（非填充形） | `attack 4: prose (non-fill-in shape) is refused as schema_violation` | t3_schema_violation |
| 攻击 5（外部键） | `attack 5: a foreign top-level key is refused` | FILL_SCHEMA.strict() → t3_schema_violation |
| 正例 | `a valid fill-in admits and assembles a W1-model-face container`；end-to-end `happy path: one fill-in delivers the SAME report sha256 as the T1 container path` | 填一次 → 同一信任链 → 同 sha256 |

## W5 组合注册表 — `registry.spec.ts`

| 攻击 | 用例 | kill 证明 |
|---|---|---|
| 攻击 1（结构遵从 <0.8） | `attack 1: structural adherence below 0.8 refuses the upgrade` | upgradeVerdict 拒 |
| 攻击 2（首次成功 <0.8） | `attack 2: first-try success below 0.8 refuses the upgrade` | upgradeVerdict 拒 |
| 攻击 3（重试预算 >0，禁 5） | `attack 3: any spent retry budget refuses the upgrade` | retryBudgetUsed>0 → 拒 |
| 攻击 4（零样本） | `attack 4: zero measured attempts refuses the upgrade` | attempts=0 → 拒 |
| 追加/组合 | `registry is append-only and latest-per-combination wins`；`a different tier or endpoint is a different combination` | append-only 不变性 + 组合按 {provider,model,endpoint,tier} 区分 |

## probe v3 分层自检 — `probe-v3/run-probe-v3.mjs`（脚本级）

| 检查 | kill 证明 |
|---|---|
| 三层 fake 自检 | T1=1.0 / T2=1.0 / T3=1.0（trusted，exit 0）——每层问题走完整执行链 |
| registry 三层记录 | fake/m/<tier> 三层 upgrade=OK（双指标 1.0 且 zero retry budget） |
| 无 key → SKIPPED | real 段 status=SKIPPED（禁 7，显式、永不静默 PASS） |