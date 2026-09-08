# 中间态状态文档 — DeepSeek-For-Paper-Harness

> 用途:本文件是给**业界专家咨询**用的中间态快照:当前项目状态、已完成与未完成项、
> 以及需要外部意见的开放问题。对应仓库工作树(TASK-T1-S2 已落地待提交;HEAD =
> `23776c5206` TASK-T1,2026-09-07)。
>
> 定位:项目是独立产品(基于 dsh 基座),核心是一个「论文写作 agent 执行链」:
> LLM 负责模型/解释/narrative,harness 负责事实、状态、来源、执行、一致性、准入、交付。

---

## 0. 本批新增(TASK-T1 + TASK-T1-S2,任务书第一阶段 + 专家计划书 P0-A)

作业已按「下一阶段工程任务书」完成第一阶段(TASK-T1:三个新 canonical 对象
AssumptionSpec/EquationSpec/ExperimentSpec 接入全链,ModelSpec 自由文本改引用,
SymbolSpec 补 shape/domain/index_set,基线 1025→1040),随后按专家计划书
《LLM Harness 下一步最可行推进计划书 v1》把 **P0-A(Commit 1 freeze-ir-semantics)
收尾**(TASK-T1-S2):专家对 TASK-T1 三个决策点的裁决全部落地——

1. **引用环(专家 §1.1)**:维持 EquationSpec 无 model_ref 单向引用;新增
   REF-001..005 规则体系——跨 scope 引用(store 边界 `reference_scope_mismatch`
   失败码)、派生反向索引 `models_by_equation`(`src/ir/derivation.ts`,重算式
   非存储、不参与任何哈希)、六条验收测试;
2. **UNKNOWN 哨兵(专家 §1.2,SCH-SEM-001)**:shape/domain 改为 required key +
   typed UNKNOWN——"模型不知道"是合法 canonical 状态,UNKNOWN→BLOCK 归 G002 门;
3. **三层指纹(专家 §1.3)**:edge(DEP-EDGE-v1,业务漂移门)/ object(命名空间
   完整性)/ closure(复现审计)分职责;ref 数组 canonical-sort 入哈希
   (DEP-005);revision 化由 append-only 不可变交付(同 id 永不变内容);
4. 20 条 invariant(`tests/ir/ir-semantics.spec.ts`),基线 1040→**1060/95 文件**;
5. **新 relay key(z-ai/glm-5.3-free,第二模型族)**:real-provider 加进程级
   并发信号量(默认上限 1 严格串行)+ 429/5xx 指数退避;key 入 gitignored
   `.env.local`,只服务 Track 2/3(探针/实测),CI 保持 fake/replay。

交接细节见 `artifacts/handoff/TASK-T1-S2/HANDOFF.md`。

## 0.5 后续三批(专家三个 commit 全部落地,2026-09-08)

- **TASK-E(CI/真实API 解耦,Commit 2,`85f419fe7d`)**:e2e.yml 转纯 manual;REAL_API_POLICY=never
  守卫挂 push 门("真实 adapter 进 CI"才 FAIL);cassette 录制/回放(按请求指纹,miss 即拒);
  首盘真实语料 glm-t3-coursework-v3——**z-ai/glm-5.3-free(第二模型族)真实 T3 strict DELIVERED**,
  回放与真实跑 zip sha `fb4d4e07` 完全一致(专家 §14 property CI 化);golden fixture 钉死六哈希。
- **TASK-Q2(统计资格门+成本遥测,Commit 3,`09f6b878ff`)**:Clopper-Pearson 精确 LCB
  (零失败闭式精确复现专家 stop rule 14/29;80/100=0.7226 独立验证);资格 =
  LCB≥p_min AND ESCAPE=0 AND 预算=0(8/10≠80/100);UsageTelemetry 四维硬预算;
  real provider usage chunk 全链(修复两个真 bug:零失败 LCB 退化值、finish 后漏 usage 块);
  **真实跑与回放 run-report 逐字节相等**;基线 1089/1089(98 文件)。

下一批按专家序是 **P1-C:第二模型族 T3 资格探针真实批次**(≥14 次首试,统计门出裁决)
→ P1-D(T3.5 expand-then-select)→ P2-A/B/C。

**P1-C 已实跑(2026-09-08)**:z-ai/glm-5.3-free **T3 14/14 首试全过,LCB₉₅=0.807 ≥
0.80,QUALIFIED**(ESCAPE=0、零预算、零传输重试;usage in 1568/out 4407)。探针
自身两个 bug 修复后实跑(修复前 0/14 全是探针问题:教学段空串 + 网络错误不退避)。
**§22 里程碑前置全部达成(2026-09-08,TASK-P1C/P1C2)**:①两模型族过 T3 统计门——
z-ai/glm-5.3-flash 14/14 与 deepseek/deepseek-v4-pro 14/14(各 LCB₉₅=0.807,零 ESCAPE,
经 y-api 中转严串行);②T3.5 零 ESCAPE 收编 snow_depth case(free/flash 双验证 5/5 全循环)。
测试模型族已换轨 glm-5.3-flash(旧 free 退役);下一步 P2-A 成对对照 → study freeze → 学生实测。

---

## 1. 一句话现状

弱模型(deepseek-v4-flash)在三层协议中 **T3(闭集填充)真实遵从率 1.0**,已据此
落地**用户外壳 CLI v0**(跑通真实用户模拟 + 确定性 ZIP 导出),基线 1025/1025 测试
保持全绿;下一批是 M1-3(PNG 位图后端)与 M1-5(pilot 协议),尚未启动。

---

## 2. 已完成(按批次)

| 批次 | 内容 | 状态 |
|---|---|---|
| TASK 1.25 / 1.5 / 1.5R / 2 / 2.1 / 3 / 3.5 / 3.6 / 4.0 / 4.2 / 4.3 / 5.0 / 5.0-R | 核心执行链 + 证据冻结 + 门禁注册表 + 修复批次 | DONE(见 TASK-INDEX) |
| TASK-P1 | 生产者轨(Result/Claim 从真实输出铸造) | DONE |
| TASK-P2 | executor 权威整链 + 报告 v2 槽位 + demo v2 | DONE |
| TASK-P3 | 语义闭集 + 表达层声明制 + demo v3 + 真实遵从率探针(0/20 锚点) | DONE |
| TASK-P3D | 供应商解耦(E2E 中立变量族、无隐式官方路由) | DONE |
| TASK-PW | 弱模型遵从分层(T1/T2/T3)+ 组合注册表 + demo v4 | DONE(93 文件 / 1025 测试) |
| **TASK-M1(本批)** | 真实 key 三层遵从率实证 + 用户外壳 CLI v0 + 真实用户模拟 | **DONE(本批)** |

### 本批(TASK-M1)交付明细

- **M1-1 真实遵从率实证**(作者提供测试 key,38 次首次尝试,串行低并发):
  - T1 0/10、T2 0/10(模型高置信写错结构/跨步引用不入账)——符合任务书预判;
  - **T3 fill-in 准入 18/18(1.0)、端到端专测 8/8**;
  - 首测组合定层:**deepseek/deepseek-v4-flash @ T3**(弱模型被 T3 最小面救回)。
- **M1-2 用户外壳 CLI**(`apps/paper-shell/`):
  - 命令面 `run` / `explain` / `--version`;非法 tier/mode → exit 2;缺路由 → exit 1;
  - 产线 opt-in 显式开启 + `production_enabled` 审计(F5/M-B 闭环);
  - 路由走 `PAPER_PROBE_*`/`DEEPSEEK_*`/`DSH_E2E_LLM_*` 中立变量族(无硬编码厂商);
  - **确定性 ZIP 导出**:重跑同 sha256 `29a4ab58…`(G2);
  - 8 个单测全绿(三攻击守卫 + 四类 BLOCKED 人话分类)。
- **真实用户模拟**:用测试 key 从干净状态跑 `course-work.md @ T3 strict` → **DELIVERED**,
  报告 v2 带 IR 注入数值,归档于 `artifacts/handoff/TASK-M1/shell-out-real/`。
- **CI 集成**:`paper-harness.yml` 新增离线 shell demo + spec job;workspace 成员 +
  lockfile + 发布文件策略 + `demo:pw` / `demo:pw:real` / `test:m1:shell` 脚本。

### 本批 CI 实测(2026-09-07 push `739fdb209c`)

| 工作流 | 结果 | 说明 |
|---|---|---|
| Paper harness gates | ✅ success | 含新增 M1 shell demo + spec job;基线 RG-06/07/09 一致 |
| E2E (real provider API) | ❌ failure | **既有环境问题,非本批引入**:CI 不持有真实 provider key(与 TASK-PW W6 同款失败),llm-deepseek / llm-pi-ai / paper-foundation workflow.e2e 等 key-less 段 |

---

## 3. 未完成项 / 开放项

### 3.1 下一批任务(任务书已定,未启动)

| 项 | 内容 | 现状 |
|---|---|---|
| **M1-3** | PNG 位图后端:deterministic SVG→PNG + FigureSpec 信任链 + corpus PNG 叶 | 未启动 |
| **M1-5** | pilot 协议:真实批次三段守则(先 small 后 scale) | 未启动 |

### 3.2 任务书级 DEFERRED(等 v1.1 修订)

| 项 | 内容 |
|---|---|
| 5.0.4 | 认证/attestation 加固 |
| 5.0.10 | 数值容差(numeric tolerance) |
| TASK 4.4 | numeric tolerance 任务本(依赖 5.0.10 的修订拆分) |
| TASK 4 | Fault Corpus v1(REJECT,等待 4.4) |

### 3.3 持续观察项

- 弱模型 T1/T2 轨:**每次真实批次重测,不强求救回**(T3 可用即可交付)。

### 3.4 已知仓库欠账(与本批无关,审计时可对照)

- `check:ci:static` 中部分 docs/catalog/knip 类 gate 在 master 上既有失败
  (type-equiv JSDoc 漂移、module-graph 陈旧、config/persistence catalog 陈旧、
  knip 依赖未用等)——经核对为**本批之前已存在**,非 TASK-M1 引入
  (TASK-P3 行已注「master CI 全仓 lint 欠账 ~20 处」)。本批只新增了
  `apps/paper-shell` 的约束校验项并修复为绿。

---

## 4. 需要业界专家意见的开放问题

1. **T3 救回策略是否可持续**:对弱模型用「闭集填充」把遵从率从 0/20 救到 1.0,
   代价是表达自由大幅收窄(数字由引擎零通道注入)。作为产品首测组合定层,是否
   合理?长期是否应投入 T2 的 locator 引导修复(把「跨步候选继承」做进向导)?
2. **PNG 位图后端路线**(M1-3):deterministic SVG→PNG(无外部渲染器、字节可复现)+
   FigureSpec 数据哈希信任链。是否认可这条「先 SVG 后位图、哈希绑定」的路线?
   有没有更稳的确定性位图方案建议?
3. **pilot 协议**(M1-5):真实批次三段式(先 small 后 scale)的守则怎么写才既能
   快速出数据又不浪费 key 额度?样例规模与重试预算的取舍?
4. **CI/E2E 欠账优先级**:E2E real-provider 段在 CI 里永远 key-less(仓库不持有
   key)。是否应像 paper 层一样,把真实段改为「manual + SKIPPED 禁7 式显式跳过」,
   而不是让 push 型 E2E 工作流常年红?
5. **下一批优先级**:M1-3 与 M1-5 哪个先做、是否并行;以及 v1.1 修订项
   (5.0.4 / 5.0.10 / 4.4)应在哪一批排期。

---

## 5. 验证入口(专家可自行复现)

```bash
# 基线(paper-foundation 子集)
npm run test:task3:report-state        # PASS 1025/1025
# 外壳单测(三攻击 + 人话分类)
npm run test:m1:shell                  # 8/8
# 离线确定性 demo(fake provider,zip 重跑同 sha256)
npm run demo:pw                        # DELIVERED,zip sha256=29a4ab58…
# 真实 provider demo(需自备 key 环境变量)
npm run demo:pw:real
# 全仓 CI 静态门禁
npm run check:ci:static                # 已知 docs/catalog/knip 类欠账(3.4)
```

审计材料位置:`artifacts/handoff/TASK-M1/`(SUMMARY / gate-report / probe-real /
samples / shell-out / shell-out-real),`artifacts/handoff/TASK-INDEX.md`,
`artifacts/handoff/EXTERNAL-REVIEW.md`。

## 0.9 TASK-C1(实测驾驶舱,2026-09-08)

驾驶舱落地:独立壳 + 共用订阅层(C-A 降级映射),server 只读投影 + 一个研究档案写路径(FalseBlock);五区前端零框架零 CDN;上传/徽章/文案全部同源复用 shell 资产;demo-run e2e 实测 DELIVERED、SSE/投影/徽章/申诉全链通。
**read body failed 事故已根治**(四洞:OPTIONS/multipart/spawn node.exe/clientError,见 HANDOFF §3)。B0 三件套顺手完成。G10(30 分钟真人实测)与 G9(release 打包)是剩余两格,待 STUDY-A-PILOT 冻结与真人到场。
