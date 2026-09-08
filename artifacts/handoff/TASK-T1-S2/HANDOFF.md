> ⚠ FROZEN-SNAPSHOT(任务书 B0-3):本文件是该批次收口时的**历史冻结快照**,不反映仓库当前状态;现行台账见 TASK-INDEX.md 与 INTERIM-STATUS.md。

# TASK-T1-S2 — IR 语义契约收尾(专家计划书 P0-A / Commit 1 后半)交接文档

> 头:`23776c5206`(TASK-T1 Sprint 1)之后,本批实现《LLM Harness 下一步最可行
> 推进计划书 v1》P0-A 的三个裁决项(§1.1/§1.2/§1.3),即专家"三个 commit"里的
> **Commit 1(freeze-ir-semantics)收尾**。三个 TASK-T1 决策点全部按专家裁决落地。

## 1. 本批完成

### 1.1 P0-A① 引用环裁决落地(REF-001..005,专家 §1.1)

专家裁决:保持 `EquationSpec.scope_ref → ProblemSpec` 单向引用,**不回滚**
TASK-T1 拿掉 `model_ref` 的决策。落地三件:

| 项 | 位置 | 内容 |
|---|---|---|
| REF-003 跨 scope 拒绝 | `src/ir/refs.ts` + `src/ir/store.ts` | 新增 `IR_SCOPE_FIELDS` 表 + `validateScopeOwnership()`;ModelSpec 的 `equation_refs`/`assumption_refs` 只能指向其 `problem_refs` 同 scope 的对象;新失败码 `reference_scope_mismatch` |
| REF-005 派生反向索引 | `src/ir/derivation.ts`(新) | `modelsByEquation(store)`:反向导航是查询不是事实——每次调用从快照重算,不入 canonical、不参与任何哈希 |
| REF-001 结构钉死 | 既有 strict schema + 新测试 | `EquationSpec` 加 `model_ref` = unrecognised key 必拒(引用环不可表示) |

专家 6 条验收测试(方程先于模型 append / 缺失引用拒 / 跨 scope 拒 / 反查一致 /
反查不影响指纹 / 顺序不改语义)全部落在 `tests/ir/ir-semantics.spec.ts`。

**注意(语义收紧,旧测试迁移)**:REF-003 使「`problem_refs: []` 的孤儿
ModelSpec 继续持有 P1-scoped 方程/假设」从 store-合法变为 store-拒绝——这正
是规则意图(无 scope 的模型不能再借用任何 scoped 对象)。`redteam15.spec.ts`
RT-B-01 三条(symbol-guard bypass 场景)按此迁移:override 同时清空
`equation_refs`/`assumption_refs`,bridge 层断言不变。

### 1.2 P0-A② UNKNOWN 哨兵(SCH-SEM-001,专家 §1.2)

专家裁决:不在"必填/可选"间二选一——**required key + typed UNKNOWN sentinel**。
落地:

- `SYMBOL_SHAPES` / `SYMBOL_DOMAINS` 各加 `UNKNOWN` 值(problem-contract.ts);
- 字段结构永远存在(schema 完整性),值可显式 UNKNOWN(语义未知是合法
  canonical 状态);UNKNOWN→BLOCK 的决定权留给 G002 门,schema parser 不提前 BLOCK;
- executor 教学串(EXECUTE_PROTOCOL_TEACHING)同步:闭集候选加入 UNKNOWN,
  并明示"不确定就诚实答 UNKNOWN,不要编造"——弱模型 T1/T3 面不因怕编错而炸。

### 1.3 P0-A③ 依赖指纹三层拆分(DEP-001..005,专家 §1.3)

专家裁决:hash(引用集合) 方向正确,但要 (a) canonical-sort (b) 命名空间
(c) 三层指纹分职责 (d) 引用锚 immutable revision。落地(evidence-freeze.ts):

| 指纹 | 语义 | 命名空间 | 用途 |
|---|---|---|---|
| `dependencyEdgeFingerprint` | 我依赖谁(引用集合) | `DEP-EDGE-v1` | **业务漂移门**(freeze manifest 的 dependency_lock_hash 即此) |
| `objectFingerprint` | 对象是什么 | `ASSUMPTION-v1`/`EQUATION-v1`/`MODEL-v1` | 完整性/篡改检测 |
| `dependencyClosureFingerprint` | 依赖内容整体 | `DEP-CLOSURE-v1` | 复现审计/调试 |

- 所有 ref 数组 canonical-sort 后入哈希(REF-004/DEP-005:输入顺序永不改指纹);
- **revision 化由 append-only 交付**:store 无 mutation 路径,同 id 对象内容
  永不可变,"A42@rev2" 即不同 id 的新对象——引用天然锚 immutable revision,
  无需新增 revision 字段(这是对本仓比专家设想更强的既有不变量,已在
  `ir-semantics.spec.ts` DEP-003 钉死:换 id 即换引用即翻指纹)。

### 1.4 Invariant 测试(20 条,`tests/ir/ir-semantics.spec.ts`)

三个 describe:REF 六验收 + 结构钉死(9 条)/ SCH-SEM-001(5 条)/ DEP 五条 +
命名空间 + freeze 确定性(6 条)。每条都是 invariant kill:重新引入
`model_ref`、把 UNKNOWN 改回可选、哈希未排序数组,必有测试红。

### 1.5 新 API key(第二模型族)接入纪律

- `apps/paper-shell/src/real-provider.ts`:**进程级并发信号量**(默认上限 1 =
  严格串行,`PAPER_PROBE_MAX_CONCURRENCY` 可放宽但需实测余量)+ **429/5xx
  指数退避**(1.5s 起,最多 4 次)。信号量横跨重试全程——退避中不占第二个槽。
- key 落 `.env.local`(`.gitignore` 扩为 `.env` + `.env.*` + `!.env.example`),
  `PAPER_PROBE_*` 中立变量族路由(P3D)。**只服务 Track 2/3(探针/实测),CI
  永远 fake/replay**——专家 §2.1/ADR-004 纪律。
- 连通性已实测:单路串行调 `z-ai/glm-5.3-free` 正常回包。
- `.env.example` 补第二模型族样例与并发纪律说明。

## 2. 本批验证结果(全部实测)

| 项 | 结果 |
|---|---|
| paper-foundation vitest(thread-safe) | **1060 passed / 1060(95 文件;基线 1040→1060,+20 invariant)** |
| RG-06/07/09 | PASS(gate-report baseline 已同步 1060/95) |
| P1 demo | legal 3/3、wrong 2/2 KILLED、gates_impl 9/9 real |
| P2 demo v2 | 4/4 + wrong 2/2 |
| P3 demo v3 | 5/5 + wrong 6/6(FBR 0/5、语义误杀 0/5) |
| paper-shell 单测 | 8/8(并发闸改造后无回归) |
| demo:pw(fake,t3) | DELIVERED;report sha `a0e4c492` 不变,zip sha `5e775fb8` 三次重跑一致(确定性保持) |
| tsc -b / typecheck | 通过 |
| 新 key 冒烟 | z-ai/glm-5.3-free 串行单调用正常 |

## 3. 未完成 / 下一步(按专家 §12 序)

- **P0-B canonical serialization 冻结**:fingerprint version 字段、golden
  fixture、migration 行为(本批已交付命名空间 + canonical-sort,即 P0-B 的
  前半;剩余是版本化与 golden 固定)。
- **Commit 2(decouple-real-api-ci)**:REAL_API_POLICY=never、真实 E2E 出
  push 门、cassette 录制(趁 key 有效先攒语料)、replay property test
  (同 cassette → 同 ZIP sha256)。
- **Commit 3(model-qualification-v2)**:token/cost telemetry、LCB95 统计门
  (stop rule 14/29)、registry 升级。
- 之后再 P1-C(第二模型族 T3 qualification——新 key 就是为此准备的)与
  P1-D(T3.5 expand-then-select)。

## 4. 决策记录(供专家复核)

1. **REF-003 的作用面**:store commit 边界(而非 bridge)。理由:引用闭合
   已在 store(refs.ts 注释明言),scope 所有权是引用语义的一部分,放 bridge
   会出现"store 收了、bridge 才拒"的两阶段真值。代价是 RT-B-01 三条旧测试
   的场景(孤儿 ModelSpec 保留 scoped 引用)现在被 store 直接拒——语义上
   这正是规则要杀的形态,已按"测什么就 seed 什么"迁移。
2. **revision 化不新增字段**:append-only + 无 mutation 路径已保证同 id 不可
   变,`A@rev1 ≠ A@rev2` 的专家要求由"id 即 revision"满足。若未来引入修订
   概念(如 QUESTIONED 假设的继承者),需按专家 ModelEquationLink 模式加新
   对象,而非开 mutation 口子。
3. **UNKNOWN 是枚举成员而非 optional**:TS 类型上 `SymbolShape` 含
   `'UNKNOWN'`,下游(未来的 G002)必须显式处理它,编译器不会放过 fallthrough。

## 5. 复现命令

```bash
npx vitest run --project=thread-safe packages/paper/paper-foundation  # 1060/1060
npx vitest run --project=thread-safe packages/paper/paper-foundation/tests/ir/ir-semantics.spec.ts  # 20/20
npm run test:task3:report-state  # RG-06 PASS
npm run test:m1:shell            # 8/8
npm run demo:pw                   # zip sha 5e775fb8 确定性
# 新 key 冒烟(需 .env.local):
set -a; source .env.local; set +a  # Windows Git Bash
```
