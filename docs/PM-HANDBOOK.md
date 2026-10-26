# DPH 项目管理手册（PM-HANDBOOK）

> **生效**：2026-10-27。**地位**：流程宪法。**与 [`PROJECT-MAP.md`](./PROJECT-MAP.md) 的分工**：
> PROJECT-MAP 回答"项目是什么、东西在哪"；本手册回答"**所有开发行为怎么做、什么算完成、什么不许做**"。
> 冲突裁决顺序：红线 N1–N34（`docs/dph-plan-and-redlines.md` §4）> 本手册 > 其余文档。
>
> **为什么有这本手册**：2026-10-27 治理轮的结论是——本项目的设计哲学与工程质量都不差，
> 差的是过程治理：密钥进过公开历史、运行产物污染源码树、demo 语料与门禁脱节一个月无人察觉、
> 工作树常年不脏不成体统。本手册的每一条都锚定一次真实事故或一条成熟工程实践，不是官僚装饰。

---

## §1 角色与决策权

| 角色 | 职责 | 独占权力 |
|---|---|---|
| **用户（所有者）** | 裁决、验收、预算与凭据管理 | S1 决策签收、真实 key 的保管与轮换、删除级操作授权 |
| **执行者（agent/开发者）** | 实现、验证、归档、上报 | S2 决策（工程实现细节）、S3 决策（机械操作） |

**决策分级**：

| 级别 | 定义 | 程序 |
|---|---|---|
| S1 设计级 | 改变模型可见契约（schema/门禁/协议）、跨模块 API、品牌身份、交付语义 | 列选项+建议 → **用户签收** → decision-log 落档 → 必要时写 ADR。**默认禁止代签**；仅当用户明确说"按建议执行"类授权才可代签，且必须记录授权原话 |
| S2 工程级 | 实现方式、测试组织、脚本、文档结构 | 执行者自决，但必须过 §3 门禁矩阵并更新台账 |
| S3 机械级 | 格式化、错别字、依赖小版本 | 直接做 |

**三条立即停下上报的红线**（不许自作主张绕过）：
1. 即将改写公共 git 历史（force-push / filter 类操作）；
2. 即将触碰安全边界（凭据、密钥、CI 触发器、门禁逻辑的放行方向）；
3. 真实运行失败且归因不清（先走 §5.4 归因检查单，禁止直接归咎"模型不行"）。

## §2 分支与提交纪律

| 分支 | 用途 | 纪律 |
|---|---|---|
| `main` | **唯一产品干线**（trunk-based） | 每个提交都应可发布；收口即推（§7） |
| `master` | 上游 dsh 快照（冻结于 fork 点） | **永不开发、永不手推**；只随官方 release 演进 |
| `digital-assets` | 资产轨 | 独立节奏，不与产品混线 |
| `EXP-*` / `feat-*` | 实验与功能分支 | 预期 >1 天或含真实运行实验时才开；生命周期 ≤1 轮，完成或废弃后删除 |

**提交规则**：
1. 一行式 conventional：`类型(scope): 中文描述`（类型：feat/fix/chore/docs/test/refactor/ci）。
2. **一次提交一个意图**——混合"顺手改了别的"的提交，事后无法归因（形态 6 的温床）。
3. 提交前 `git status` 逐行看一眼：**调试残留（`.tmp-*`、临时脚本）禁止入库**（.tmp 惨案）。
4. 测试与实现同一提交（仓库既有规矩）。
5. **force-push 仅限历史手术**（密钥/大文件泄漏），必须：留 bundle 备份 + 写
   `docs/HISTORY-REWRITE-*.md`（先例：2026-10-27）+ 通知用户。其余场景一律禁止。

## §3 变更门禁矩阵（Definition of Done）

> **收口的定义：下表中你那类改动的每一项都绿，且工作树干净。** 收口未完成不许推、不许交接。

| 改动类型 | 必须通过 |
|---|---|
| 文档（`docs/`、`*.md`） | 链接有效（`pnpm run verify-md-links` 或逐个人工核对）；台账/地图相应行已同步 |
| 产品源码（`packages/paper/**`、`apps/paper-shell/**`、`apps/cockpit/**`） | ① `npx tsc -b tsconfig.host.json` 干净 ② `npx vitest run --project=thread-safe packages/paper/paper-foundation apps/paper-shell` 全绿（flake 按 §4.3 处理）③ `npm run build:lib:host` + 构建守卫 `ok=true` ④ 受影响 snapshot 同提交更新 ⑤ demo 按 §9 判定 |
| 仓库脚本（`scripts/**`） | ① tsc 干净 ② 该脚本自身可运行且自测通过 ③ 接入 `run-gates.ts` 时跑对应聚合模式 |
| CI 工作流（`.github/workflows/**`） | `npx tsx scripts/verify-real-api-policy.ts`（e2e 必须保持手动触发，ADR-004） |
| 依赖（package.json / pnpm-lock） | `pnpm install --frozen-lockfile` 通过；vendor manifest 与 THIRD_PARTY_NOTICES 由 pre-commit 自动再生；确认无新密钥引入 |
| `.gitignore` / git 结构 | 确认不掩盖已跟踪文件的丢失；说明动机写进提交信息 |

**所有改动通用的两项**：`verify-no-secrets` 通过（pre-commit/pre-push 已强制）；提交信息符合 §2。

## §4 测试纪律

### 4.1 三层测试与选用规则

| 层 | 性质 | 何时跑 | CI |
|---|---|---|---|
| **fake（确定性）** | mock provider，结果可复现 | 一切开发的默认；每次源码改动 | ✅ 每次 push |
| **replay（指纹回放）** | cassette 按请求指纹回放，未知指纹 fail-loud | 改 provider 协议/工具注入后 | ✅（CI 断言 replay×2 zip 哈希一致） |
| **real（真实模型）** | 观察性，非确定性 | 仅 §5 的真实运行协议下；**永远不是收口的必要条件** | ❌ 手动 dispatch（ADR-004） |

### 4.2 两个不会过时的陷阱
1. **测试读 `src`、真实运行读 `lib/`**——改完代码不 build 就跑真实运行 = 跑旧代码（形态 3）。构建守卫必须 `ok=true`。
2. **vitest 不做类型检查**——tsc 与 vitest 必须都跑。

### 4.3 flake 处理协议（禁止静默重试）
套件失败 → **隔离重跑该文件** → 过 = 负载 flake，在 DESIGN-DEBTS 登记条目（先例 P4）后放行；
隔离也挂 = 真回归，**禁推、禁收口**。任何"重跑就绿所以没事"的不留痕处理都是违规。

### 4.4 新判据必须有负对照
每个新增门禁/指标必须配"已知能让它变红的操作"的用例 + CI 调用者（核心教训 3：
一个只能上升或持平的指标不是指标）。

## §5 真实运行纪律（生产）

### 5.1 开跑前检查单
- [ ] 构建守卫 `ok=true`（否则先 `npm run build:lib:host`）
- [ ] profile 已选定且**单变量**：一次真实运行只改一个生成侧变量（换中转/换模型/改提示词三选一），否则无法归因
- [ ] 输出目录在 `runs/` 下新建（`run-<date>-<slug>/`），`PAPER_RUN_DIR` 如需覆盖已设置
- [ ] key 来自 `.env.<profile>`，不写入任何将入库的文件
- [ ] 超时/预算变量按题设过（`PAPER_PROBE_TIMEOUT_MS`、`PAPER_DAILY_BUDGET_USD`）

### 5.2 运行中
- 串行纪律（中转并发 1）；长循环用脱离进程组的启动方式（先例：`runs/2024B-ingest-1/scripts/run-loop-detached.sh`）。
- 可取消、可超时是运行时前提（E3/O1 已修，不许退化）。

### 5.3 运行后
- 产物**只进不改**；失败现场原样归档（红线 N7）——不许因为"效果差不归档"。
- 决策/结论写 `artifacts/handoff/`，运行证据留 `runs/`，两者不许混。

### 5.4 运行后三问（每次必答，写进轮次日志）
1. **这条判定事后能否核验？**（E1/容器没落盘 = 不可核验 = 白跑）
2. **归因是 harness 侧缺陷还是模型能力不足？**（25 次运行 10+ 处把 harness 缺陷误读成"模型不行"）
3. **有没有踩七形态之一？**（`HANDOFF.md` §2 对照表；形态 6"修复只做判定侧"是头号杀手）

## §6 交付语义与发布

### 6.1 产品内交付（每次运行）
四档语义是产品的一部分，不是可选项：`CLEAN`（干净交付）/ `MARKED`（带已知缺陷表交付）/
`DEGRADED`（降级交付）/ `ESCALATE`（升级人工——**预算耗尽必须 ESCALATE，不许伪装成 CLEAN**）。
交付物清单：`report.md` + `figures/*.svg` + `deliverable.zip` + `run-report.json` + `audit-trail.json`（sha256 对齐）。

### 6.2 对外发布（打包交付）
1. 版本 tag：产品 `v<x.y.z>`（`dsh-v*` 是上游遗留，只读）；发布前过 §3 全矩阵 + 六个缺口状态写进 release note。
2. 打包黑名单（不变）：`.git/`、`.env*`、测试夹具、`*.tsbuildinfo`、`coverage/`、`node_modules/.cache`。
3. 回归清单沿用《项目修复任务书》§三（全新 VM 双击跑通 + 页面品牌 + 冒烟 + 无密钥残留）。
4. 卸载 = 删目录，零注册表/服务残留。

## §7 推送与远端纪律

1. **收口即推**：门禁全绿 + 台账更新 → 当轮内推送。超过一天未推的已收口工作 = 违规（本地积压是丢失与分叉的根源）。
2. **推送前**：§3 对应门禁、工作树干净、`progress:board` 已刷新、轮次日志已写。
3. **pre-push 钩子**（lefthook）：`verify-no-secrets` + `typecheck`——**禁止 `--no-verify` 绕过**；钩子红了就是真问题。
4. 远端失败（网络/代理）：**不许为了"绕过网络"做任何历史操作**；留待网络恢复（先例：2026-10-27 治理轮推送延后数小时）。
5. `upstream` remote 只读：仅选择性 merge 官方更新，永不自动合入，永不指向本产品分支。
6. LFS 配额意识：大文件走 gitignore + 外部获取说明（先例：bench 2024-E CSV），禁止回退到"先传上去再说"。

## §8 新增功能与维护流程（TASK 制度）

### 8.1 标准流程（八步，缺一不算收口）
```
① 任务书  artifacts/handoff/TASK-<n>/（目标/证据/验收判据，无判据不许开工——PENDING-FIXES 的规矩）
② 计划    涉及 S1 的先走裁决；.agents/notes/proposed 起草 ADR
③ 实现    小步提交，一次一个意图（§2）
④ 验证    §3 门禁矩阵逐项过
⑤ 负对照  关键判据配"能让它变红"的用例（§4.4）
⑥ 文档    PROJECT-MAP / DESIGN-DEBTS / 受影响子系统文档同步
⑦ 台账    TASK-INDEX.md 加行（head commit + local gate 结果 + follow-ups）
⑧ 推送    §7 检查单 → push → CI 绿才算真正收口
```

### 8.2 什么时候必须写 ADR
跨模块 API 变化、IR/容器契约变化、门禁增删与放行方向、品牌/身份、交付语义——写进
`.agents/notes/`（proposed → implemented），格式沿用库内既有 ADR。

### 8.3 维护专项
- **上游同步**：只在需要某个官方修复时做，选择性 merge，同步后跑全矩阵；不做批量跟进。
- **依赖升级**：一次一类（安全补丁优先），过依赖门禁（§3）。
- **语料/夹具同步**：改契约必须同步检查 demo 语料（§9）与测试夹具。

## §9 demo 与语料纪律

1. **demo 绿是源码类收口的必要条件**：现行语料集 = `test:p1:demo`（必须绿）+
   P2/P3 demo（修复语料后恢复为必须，当前豁免记录在 DESIGN-DEBTS DEMO-CORPUS 条）。
2. **语料同步规则（DEMO-CORPUS 惨案的制度化）**：任何改门禁、容器契约、报告结构的提交，
   必须在同一轮确认 demo 语料是否需要更新——**门禁演化快于语料 = 量具失效**（形态 4），
   失效期间它保护不了你，还会掩盖真回归。
3. demo 输出目录不入库（每次重生成）；demo 绿的判据看退出码与 summary，不看"跑过了"。

## §10 进度可视化与可追溯

### 10.1 四件套分工（各回答一个问题）

| 文件 | 回答什么 | 更新方式 |
|---|---|---|
| [`PROJECT-MAP.md`](./PROJECT-MAP.md) | 项目是什么、承重在哪、怎么跑 | 结构变化时更新 |
| [`DESIGN-DEBTS.md`](./DESIGN-DEBTS.md) | 现在有什么问题、什么状态 | 修一条改一条状态行；新问题追加 |
| [`PROGRESS.md`](./PROGRESS.md) | 项目走到哪了 | 自动区 `pnpm run progress:board` 生成；轮次日志每轮手写追加 |
| `artifacts/handoff/`（HANDOFF 链 + TASK-INDEX） | 这轮交接细节与任务台账 | 每轮收口更新（TASK-INDEX 加行） |

### 10.2 每轮收口必须更新的五个文件（缺一 = 未收口）
`TASK-INDEX.md`、`DESIGN-DEBTS.md`、`PROGRESS.md`（board + 轮次日志）、
`artifacts/handoff/<本轮>/summary.md`、（有交接意义时）根 `HANDOFF.md` 顶部指针。

### 10.3 轮次日志格式（PROGRESS.md 手写区，只增不删）
```
### <日期> <轮次名> —— <一句话>
- 目标：
- 结果：
- 关键提交：
- 验证：
- 遗留：
- 需用户手动：
```

### 10.4 新会话/新接手者开工读法
`PROJECT-MAP.md` → `PROGRESS.md`（当前状态+上一轮日志）→ `DESIGN-DEBTS.md` open 区 →
本轮任务的 handoff 文档。**禁止跳过直接改代码**。

## §11 安全纪律

1. **密钥生命周期**：key 只存在于 `.env*`（gitignored）或环境变量 → 运行前注入 →
   永不进代码/文档/日志/运行脚本明文。循环脚本用 `${VAR:?}` 形态（先例：run-*.sh 去密钥改造）。
2. **泄漏应急规程**（发现 tracked 文件含真实 key 时）：去 HEAD → 用户轮换 key →
   历史手术（§2.5 程序）→ 记录。顺序不可乱——轮换永远先于、独立于历史清理。
3. **机器路径**：`C:\Users\<名>`、`D:\...` 绝对路径不入库；测试夹具用中性路径。
4. **公开仓库意识**：GitHub 仓库是公开的——把"会被谁看到"当作每次提交的隐含审查项。
5. `verify-no-secrets` 与 `verify-real-api-policy` 两个门禁的放行方向（S1）不许放宽。

## §12 事故管理

| 级别 | 定义 | 响应 |
|---|---|---|
| P0 | 安全（密钥泄漏/凭据外泄）、公共历史污染、数据丢失 | 立即停下上报用户 → 应急规程（§11.2）→ 事后写 HISTORY-REWRITE/事故记录 |
| P1 | 产品阻断（主链不能跑、门禁大面积误杀、demo 全红） | 当轮处理；DESIGN-DEBTS 登记⛔级 |
| P2 | 质量债（flake、lint 欠账、小缺陷） | 台账登记，按修复顺序排期 |

所有事故归档遵守 N7（原样保留失败现场）+ §5.4 三问（先把归因钉死再动手）。
**事故记录的价值在于形态定位**——每次 P0/P1 收口时在 DESIGN-DEBTS 或 handoff 里注明
它属于七形态的哪一类，重复形态就是系统性问题的证据。

## §13 快速命令卡

```sh
# 类型检查（vitest 抓不到 TS 错误，两个都要跑）
npx tsc -b tsconfig.host.json
# 产品 scoped 测试（flake 按 §4.3 处理）
npx vitest run --project=thread-safe packages/paper/paper-foundation apps/paper-shell
# 真实运行前：构建 + 守卫
npm run build:lib:host && npx tsx artifacts/handoff/W8.9/probe-provenance.mts   # 必须 ok=true
# demo（现行必须绿的语料）
pnpm run test:p1:demo
# 静态门禁（含 verify-no-secrets）
pnpm run check:ci:static
# 进度仪表盘刷新
pnpm run progress:board
# 真实运行（生产，§5 检查单先行）
set -a; source .env.<profile>; set +a
npx tsx apps/paper-shell/src/cli.ts run <题面> --stages --stage-next --out runs/run-<date>-<slug>
# 驾驶舱
node apps/cockpit/server.mjs    # 127.0.0.1:3081；凭据在 $DPH_HOME/cockpit/
```

---

*本手册由 2026-10-27 治理轮起草。修订走 S1 程序：列 diff → 用户签收 → 更新本文件并提交。*
