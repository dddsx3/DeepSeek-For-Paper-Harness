# DPH 项目地图 —— 维护者唯一权威入口

> **编制**：2026-10-27 项目治理轮。**基线**：main 分支 `00d6b1c0bc` 之后。
> **读法**：新接手者按 §0→§1→§2 顺序读（约 15 分钟）；日常查 §4/§5 的命令与规约表；
> 找"现在有什么问题"去 [`DESIGN-DEBTS.md`](./DESIGN-DEBTS.md)。
> 本文回答"项目是什么、哪些东西承重、东西都在哪"；历史演进细节在 §6 的索引文档里。

---

## §0 这是什么（一段话 + TOP-GOAL）

**DeepSeek-For-Paper-Harness（DPH）**：一个面向论文写作场景的独立 agent harness 产品。
它 vendor 了官方 DeepSeek Harness（dsh）的全部平台代码作为技术基座（约 225 个
`@deepseek-ai/dsh-*` 包），在此之上用 `packages/paper/paper-foundation` 等产品代码
实现了一条"题目进、论文初稿出"的流水线。与官方的唯一产品联系是适配 DeepSeek 模型；
CLI 入口（`pnpm dph`）、用户数据目录（`DPH_HOME`，默认 `~/.dph`）、品牌均已独立。

**TOP-GOAL**（`artifacts/handoff/TOP-GOAL-direct-draft.md`，用户原始口径）：
用户上传一道真实竞赛/课程题，系统在**一次运行内**直接产出可用的论文初稿
（DELIVERED），全程不需要用户改代码、改引擎、写提示词。

## §1 设计哲学五支柱（改动前必须理解）

| # | 支柱 | 一句话 | 代码锚点 |
|---|---|---|---|
| 1 | **分工律** | 模型负责想（分析/解释/怀疑），harness 负责算和证（事实/状态/来源/执行/一致性/准入/交付） | `docs/upper-bound-architecture.md` §0 |
| 2 | **零数字通道** | 散文里的数字一概不算；每个数字必须经 `code → jsonPath → Result` 回读。红线 N20："零数字通道是本项目的存在理由" | `src/knowledge/constitution.ts`（铁律 R1）、`src/ir/numeric-config.ts` |
| 3 | **模型面白名单 + 不可能字段规则** | 模型只能声明 5 种 kind（SymbolSpec/AssumptionSpec/EquationSpec/ModelSpec/DataArtifact）；写 `content_hash`、重声明 harness 资产（DA-RAW/R-OUT/P1）一律拒绝——模型"猜不出的 sha256"事故的根治 | `src/produce/ir-producer.ts`（`MODEL_FACE_KINDS` + 拒绝码 `input_asset_domain`/`hash_field_forbidden`/`registered_id_redeclared`） |
| 4 | **失败分类学 + 能力分层** | 失败分五类（NONE/DRIFT/ESCAPE/RUN/TRANSPORT）：NONE=引导重试、DRIFT=字段级纠错回灌、ESCAPE=零预算硬拒；模型按能力探针分 T1（全声明）/T2（三步引导）/T3（闭集填空） | `src/probe/probe.ts`、`src/probe/registry.ts`、`src/produce/guided-steps.ts` |
| 5 | **上限解放架构**（2026-09-22 起的现行时代） | 从"全程监护"改为"最小交规 + 事后严格验证 + 违规才介入"；门禁状态机 DORMANT→WARN→ENFORCE；四档交付 CLEAN/MARKED/DEGRADED/ESCALATE；预算耗尽=ESCALATE 不是 CLEAN | `docs/upper-bound-architecture.md`（权威）、`src/delivery/gate-state.ts`、`src/delivery/delivery-ladder.ts` |

另有一条**过程纪律**贯穿全部轮次：红线 N1–N34（`docs/dph-plan-and-redlines.md` §4，
每条对应一次真实事故）与"七类信号≠原因形态"（`HANDOFF.md` §2，形态 6"修复只做判定侧"
是头号杀手）。**每次真实运行后先问"这条判定事后能否核验"，再谈模型能力。**

## §2 资产四分类（改哪里安全、碰哪里危险）

### 承重层（产品脊柱——改动必须过全量测试 + 构建守卫）

| 路径 | 职责 |
|---|---|
| `packages/paper/paper-foundation/src/executor.ts` | **5300+ 行主编排器**：E1/E2、保真门、生产链、失败分类、L6 闭环。全项目最大单体（见 DESIGN-DEBTS D1） |
| `…/src/ir/`（15 文件） | 规范证据库：schema 是唯一 closed zod 表（`ir/schema.ts`），`ir/store.ts` 是**唯一写者** |
| `…/src/produce/`（17 文件） | 模型面生产者：`ir-producer.ts` 白名单之门；`e1-e2/e1-direct/e2-guidance`（E1/E2 指令与回灌）；`guided-steps.ts`（T2 三步）；`template-fill.ts`（T3） |
| `…/src/delivery/`（37 文件） | 九门交付语义：gate-registry、delivery-policy（四档）、closure、auto-repair、digit-check、figure-consistency、docx-precheck… |
| `…/src/stages/`（35 TS + 90 资产） | **13 阶段链**：`prob-analysis → modeling → code → result-sources → figure-declare → figure → diagram → review → paper → improve → format-profile → format-check → docx-export`（`stages/registry.ts` STAGE_IDS） |
| `…/src/execution/` | 本地进程执行 + capture/replay（哈希取证、生产者≠审计者） |
| `…/src/probe/` + `src/verification/` | 能力探针/组合注册表；三视角对抗评审、语义指纹、符号通道 |
| `packages/paper/paper-bundle` | 挂载守卫（缺 storage/storageDomain/llm 拒绝启动） |
| `apps/paper-shell/src/` | 真实运行 CLI（`run`/`explain`、`--stages --stage-next`、real-provider 串行+退避） |
| `apps/cockpit/server.mjs` | 学生驾驶舱：只读投影 + SSE + 取消（127.0.0.1:3081） |
| `templates/paper-zh/dphpaper.cls` + `scripts/export-docx.py` | 论文模板与 docx 导出 |
| `scripts/run-gates.ts` + `verify-*` + `.github/workflows/paper-harness.yml` | 质量门禁体系与产品 CI（**主门禁**） |

### 高级功能层（依赖承重层，可单独降级/延后）

能力探针与 CombinationRegistry（probe/）、对抗评审与语义指纹（verification/）、
cassette 录制回放（`apps/paper-shell/src/cassette.ts`）、签名技能与签名发布
（`signed-skill.ts`、`release.ts`）、门禁状态机 DORMANT/WARN/ENFORCE、
cockpit SSE 投影、`bench/` 基准题库。

### 上游基座（vendor，**不动**）

`vendor/*`、`packages/*` 中非 paper 部分（core/agent/llm/fs/storage/client-ui…）、
`apps/cli`（bin 名仍是 `dsh`，产品经 `pnpm dph` 脚本入口引导）、`apps/web`、`website/`、
上游 CI（ci.yml 等）。包名 rescope 是既定延后决策（见 `.agents/notes/implemented/process/2026-08-22-independent-product-identity.md`）。

### 可删项（2026-10-27 治理已处理，留档）

已删/已迁：仓库根 5 个 `.tmp-*` 调试残留；1117 个 `paper-shell-persist-*` 运行残留
（已打包 `_archive/paper-shell-persist-residue-2026-10-27.tar.gz`）；`paper-cockpit.exe`/
`sea-prep.blob`/review zip/`tsbuildinfo`/`.dsh-build`/`.workbuddy/tmp`；仓库外 8 个散落
目录（唯一运行证据已归档至 `<工作区根>/_archive/`）；bench 2024-E 大 CSV 出库
（获取方式见 `bench/problems/2024-E/README.md`）。

**明确的例外**（运行时写入但有意入库）：`artifacts/handoff/TASK-P2/study/falseblock.jsonl`
——pilot-protocol §2 定义的研究档案，低频追加，保留 tracked。

## §3 模块耦合地图（"牵一发而动全身"在哪里）

```
storage-domain（dsh 平台持久化，5 个版本化域）
        ▲
paper-bundle（挂载守卫）──► PaperFoundationService（src/index.ts，tsdown 打包入口：
        ▲                   stages/** 必须从这里 re-export，否则不进 lib）
        │
executor.ts ──导入──► produce/* ──► ir/{schema,store,refs}   ← ir 是唯一事实源
    │                                    ▲
    ├──► delivery/*（九门）───────────────┤（type-only 反向边：ir→delivery-policy）
    ├──► execution/{runner,capture,replay,audit}
    ├──► stages/*（13 阶段链 + gates.ts 2450 行门禁电池）
    ├──► probe/*、verification/*、knowledge/{constitution,skill-library}
    └──► workflow/{provider,cost,context,resilience,policy,settings,audit,spec}

apps/paper-shell/src/cli.ts ──spawn/组合──► cockpit/server.mjs（子进程跑 CLI，
    运行发现 = 扫 <runs>/persist/paper-shell-persist-*，见 runs/README.md）
```

三个结构性事实：
1. **executor.ts 是全项目的汇点**（导入约 45 个模块）——改它 = 触碰一切（D1 债务）；
2. **ir/ 是唯一写者边界**：`ir/store.ts` 之外任何代码写 IR 都违规；`ir/schema.ts` 的
   closed zod 表是唯一 schema 权威（INV-1.5-F）；
3. **测试读 `src`、真实运行读 `lib/`**（形态 3 构建陷阱）——改代码必须
   `tsc -b tsconfig.host.json` + `npm run build:lib:host`（守卫 `ok=true`）后才跑真实运行。

## §4 怎么跑（构建 / 测试 / 门禁 / 运行）

| 目的 | 命令 |
|---|---|
| 类型检查 | `npx tsc -b tsconfig.host.json`（vitest **不做**类型检查，两个都要跑） |
| 产品 scoped 测试 | `npx vitest run --project=thread-safe packages/paper/paper-foundation apps/paper-shell`（基线 1405/1406，唯一 flake = xlsx 负载） |
| 产品主门禁（CI 同款） | `pnpm run check:ci`（ci-primary）；静态子集 `check:ci:static` |
| demo（fake，确定性） | `pnpm run test:p2:demo` / `test:p3:demo` / `demo:pw` |
| 真实运行（要 key） | profile 准备好（§5）→ `npx tsx apps/paper-shell/src/cli.ts run <题面> --stages --stage-next --out <runs 下目录>` |
| 真实运行循环 | 参考 `runs/2024B-ingest-1/scripts/run-loop-detached.sh`（脱离进程组的看门狗循环） |
| 驾驶舱 | `启动驾驶舱.cmd` 或 `node apps/cockpit/server.mjs`（127.0.0.1:3081） |
| 构建守卫自检 | `npx tsx artifacts/handoff/W8.9/probe-provenance.mts` → 必须 `ok=true`，否则先 `npm run build:lib:host` |

**环境切换纪律**：CI 永远 fake/replay（`verify-real-api-policy` 钉死 e2e 手动触发）；
真实 key 只存在于 `.env*` 与环境变量；`verify-no-secrets` 门禁扫描全部 tracked 文件。

## §5 生产/测试分离规约（2026-10-27 确立）

| 维度 | 规约 |
|---|---|
| 运行产物 | 一律落仓库根 **`runs/`**（gitignore，规约见 `runs/README.md`）；`PAPER_RUN_DIR` 可整体覆盖；persist 根 = `<runs>/persist/`，cockpit 题目/输出 = `<runs>/cockpit-problems|out/` |
| 决策文档 | `artifacts/handoff/`（入库）：decision-log、HANDOFF、redteam、probe 归档。**新的运行输出不再进 artifacts/**（目录级 gitignore 防线已布） |
| 凭据 | cockpit 配置在 **`$DPH_HOME/cockpit/cockpit-settings.json`**（不入库；模板 `apps/cockpit/cockpit-settings.example.json`）；模型 key 走 **`.env.<profile>`** 机制（见 `.env.example`） |
| 密钥防线 | `verify-no-secrets` 门禁（已接入 ci-static/ci-primary）扫描 tracked 文件；发现即 FAIL |
| CI | 产品主门禁 `paper-harness.yml`（push main + PR）；`ci-master.yml` 已改纯手动（master 是冻结的上游快照）；e2e/探针 job 全部 workflow_dispatch + 显式 key |
| 端口 | Web 127.0.0.1:3080（dsh 基座）、cockpit 127.0.0.1:3081 |

## §6 文档索引（谁回答什么问题）

| 文档 | 角色 |
|---|---|
| **本文** | 项目是什么、东西在哪、怎么跑（唯一权威入口） |
| [`PM-HANDBOOK.md`](./PM-HANDBOOK.md) | **流程宪法**：一切开发行为（分支/门禁/测试/真实运行/交付/推送/TASK 制/demo/安全/事故）的约束 |
| [`DESIGN-DEBTS.md`](./DESIGN-DEBTS.md) | 现在有什么问题、哪些已修（含状态核实） |
| [`PROGRESS.md`](./PROGRESS.md) | 开发进度仪表盘（自动区脚本生成 + 轮次日志） |
| [`FEATURE-MATRIX.md`](./FEATURE-MATRIX.md) | 功能实现全量梳理（✅/🟡/🟠/❌/📋 + 证据锚点 + 路线图） |
| [`ECOSYSTEM-SURVEY.md`](./ECOSYSTEM-SURVEY.md) | 开源同类项目调研：可引入功能 / 应避免缺陷 / 真实缺口 |
| [`LEAN-ASSESSMENT.md`](./LEAN-ASSESSMENT.md) | Lean 形式化引入评估（S1 咨询件：现在不必要，触发条件留档） |
| `docs/upper-bound-architecture.md` | **现行架构权威**（2026-09-22 重写；与旧文档冲突以它为准） |
| `docs/dph-plan-and-redlines.md` | 总书/PRD 仓库内忠实摘录 + 红线 N1–N34 原文 |
| `HANDOFF.md`（根） | 历史交接快照链（2026-09-24 前的有效交接；顶部指针指向最新） |
| `artifacts/upper-bound/2024B-ingest-1/HANDOFF-2026-10-06.md` | **当前最前线交接**（13 阶段链卡在阶段 3 收敛） |
| `artifacts/handoff/ISSUES-AND-ROOT-CAUSES.md` | 驾驶舱真实使用问题台账（2026-09-09 固化快照，追加区续写） |
| `artifacts/upper-bound/2024B-ingest-1/PENDING-FIXES.md` | 防遗漏待修清单（P0 建模缺陷等） |
| `artifacts/handoff/TASK-INDEX.md` | 全部 TASK 的主台账（v2 任务书时代 → PW → 上限解放） |
| `.agents/notes/` | 架构决策记录（ADR 风格，2252 个文件） |

**新接手者阅读顺序**：本文 → PM-HANDBOOK（开工前必读）→ PROGRESS（当前状态）→
DESIGN-DEBTS open 区 → upper-bound-architecture §1–§2 → HANDOFF-2026-10-06 →
dph-plan-and-redlines §4。

## §7 治理史

- **2026-10-27**（治理轮，已推送 GitHub main `98c24d20ac`）：安全快照；清除 4 处泄漏密钥
  （3 把真实 key）+ git 历史重写（`docs/HISTORY-REWRITE-2026-10-27.md`，`.git` 647MB→168MB）；
  新增 `verify-no-secrets` 门禁（ci 静态聚合 + pre-push）；cockpit 凭据迁 DPH_HOME；
  建立 `runs/` 运行产物体系并把 persist/输出/cockpit 目录迁出源码树；bench 大 CSV 出库；
  ci-master 收敛为手动；本文 + DESIGN-DEBTS + PROGRESS 三件套建档；**PM-HANDBOOK 流程宪法生效**。
