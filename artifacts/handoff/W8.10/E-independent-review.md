# W8.10-E 独立复核（E1 / E2 / E3）

> **性质**：**独立复核**，目的是**证伪**而非确认。凡与声称不符者，无论好坏，逐条标出。
> **环境**：Windows 10.0.26200，Git Bash，Node v24.13.0，`pnpm@11.7.0`，仓库根 `D:\deepseek modex\deepseek-harness`。
> **HEAD**：`e5ffdae03f`（W8.10-B）。工作区有 3 个未提交的 paper 作用域改动（见 §E1.5）。
> **未跑真实 API**（无 key 需要）。**未修改** `packages/`、`apps/`、`bench/` 下任何被跟踪文件。
> **原始输出**：`artifacts/handoff/W8.10/logs/`（文件名在每节内标注）。

---

## 摘要：三条硬判据的实测结论

| 判据 | 声称 | 实测 | 判定 |
|---|---|---|---|
| **H12 / E1** 测试实数 | W8.9 报告：`1301/1301`（119 文件） | 全量 `npm test` = **15246 passed / 68 failed / 64 skipped（15378）**，**958 文件** | ❌ **W8.9 报告不准确**（见 §E1.2、§E1.3） |
| **E2** 构建守卫 | 守卫 `ok=true`；`tsc -b` 通过 | `ok=true`；`tsc -b` exit 0（`--force` 亦 0） | ✅ 成立，但**守卫覆盖面比声称窄**（§E2.3） |
| **E3** 负对照作用域（N5） | README 声明"仅测指标函数、不测管线"仍在 | 声明**逐字仍在** | ✅ 成立，但 `run-all.mjs` **两项检查不成立**（§E3.3） |

**最重要的三条产出**（详见后文）：

1. **`1301/1301` 是 `packages/paper/paper-foundation` + `apps/paper-shell` 的作用域子集，不是全仓测试套件。** 该数字本身自洽（见 §E1.4 的可复现推算），但 W8.9 把它填在判据 **H9「测试实跑并报告实际数字」** 下且**去掉了作用域限定词**——W8.6/W8.7 报告是分开写的（"paper 1196/1196（110 文件）；shell 61/61"），W8.9 合并成"119 文件全绿"后读起来像全仓。
2. **全仓测试套件当前不是绿的**：`npm test` 有 **68 条失败 / 34 个文件**。其中 **49 条是负载诱发的超时**（隔离重跑全绿），**19 条可稳定复现**。19 条里**没有一条由 W8.10 的改动引起**（§E1.6）。
3. **负对照 `18/18` 里的 NC-2 是空转的**：其 fixture 的 `recitalOverlap` 实测为 **0**（题面只有 5 个空白分隔 token，而 n-gram 的 `n=8`，结构上不可能形成 8-gram），M1 翻负的真实原因是**骨架全缺**，不是"复述稿的 n-gram 判定翻负"。NC-7 的 3 项检查中 **2 项是同义反复**，且含一个**硬编码本机绝对路径**（§E3.3）。

---

## E1 — 测试实数（判据 H12）

### E1.1 实跑命令与原始输出

命令（原始日志：`logs/e1-npm-test.log`；去 ANSI 版本：`logs/e1-npm-test.clean.log`）：

```
npm test          # == vitest run
```

原始尾部输出（**未截断**）：

```
 Test Files  34 failed | 919 passed | 5 skipped (958)
      Tests  68 failed | 15246 passed | 64 skipped (15378)
   Start at  21:35:54
   Duration  311.31s (transform 753.28s, setup 347.80s, import 2036.08s, tests 3371.71s, environment 704.86s)

EXIT=1
```

**实测数字（全量 `npm test`）**：

| 项 | 实测 |
|---|---|
| 测试**用例**通过 / 总数 | **15246 / 15378** |
| 用例失败 | **68** |
| 用例跳过（skip） | **64** |
| 测试**文件**总数 | **958**（919 passed / 34 failed / 5 skipped） |
| 退出码 | **1** |
| 墙钟 | 311.31s（约 5.2 分钟） |

### E1.2 与 W8.9 声称的 `1301/1301`（119 文件）**不符**

W8.9 报告原文（`bench/W8.9-REPORT.md`）：

- 第 29 行：`| **H9** | 构建绿、测试实跑并报告实际数字 | ✅ | **1301/1301**（119 文件）；基线 1189 → **+112 条测试**；tsc -b tsconfig.host.json 通过 |`
- 第 162 行：`**测试基线**：1189 → **1301**（+112），119 文件全绿。tsc -b tsconfig.host.json 通过。`

**判定：W8.9 报告不准确。** 理由：

1. `1301/1301` **不是**全量 `npm test` 的数字（实测 15378 用例 / 958 文件，差一个数量级）。
2. W8.9 把该数字置于判据 **H9「测试实跑并报告实际数字」** 之下，且**未标注作用域**。前序轮次的报告是分开标注的——`bench/W8.7-REPORT.md:60`：`paper **1196/1196**（110 文件；+8 分片 +3 预算）；shell 61/61`；`bench/W8.8-REPORT.md:59`：`paper **1198/1198**（+2 幂等测试）；shell 61/61`。W8.9 将两者合并为"119 文件全绿"，**作用域限定词在这一轮丢失**。
3. 附带：W8.9 声称的基线 **1189** 与 W8.8 自己的报告数字对不上——W8.8 报的是 `1198`（paper）+ `61`（shell）= **1259**。1189 与 1259 相差 70，**我无法从任何提交或报告复现 1189**（`grep -rn 1189` 只命中 W8.9 报告本身）。**此差异未解决，标记为待查。**

### E1.3 `119` 文件的来源已定位（作用域假设被证实）

我实测了三种作用域，全部在 HEAD 工作区：

| 作用域（vitest 参数） | 原始输出 | 文件数 | 用例数 |
|---|---|---|---|
| `npx vitest run packages/paper apps/paper-shell`（= `packages/paper/*` + `apps/paper-shell`） | `logs/e1-paper-scope.log` | **120** | **1328** |
| `npx vitest run packages/paper/paper-foundation apps/paper-shell` | `logs/e1-pf-shell-scope.log` | **119** | **1319** |
| `npx vitest run packages/paper/paper-foundation` | （见下） | **110** | **1231** |

`logs/e1-pf-shell-scope.log` 原始尾部：

```
 Test Files  119 passed (119)
      Tests  1319 passed (1319)
   Duration  12.67s (transform 78.53s, setup 59.94s, import 151.06s, tests 34.01s, environment 19ms)
```

**`119` 与 `packages/paper/paper-foundation` + `apps/paper-shell` 的作用域精确相等。** 这不是巧合：

```
git ls-tree -r 11b10efeff --name-only   # W8.9 提交
  paper-foundation/tests/**/*.spec.ts = 110
  apps/paper-shell/tests/**/*.spec.ts =   9
  pf+shell                            = 119   ← 与声称的 119 完全一致
```

### E1.4 `1301` 的可复现推算（该数字本身自洽）

把 HEAD 工作区的 119 文件作用域数字，减去 W8.9 提交之后新增的用例名：

```
1328  (paper/* + shell, HEAD 工作区)
 -   9  (paper-bundle/tests/bundle.spec.ts = 9 条，不在 pf+shell 作用域内)
= 1319  (pf+shell, HEAD 工作区)
 -  18  (W8.9 提交 → 工作区 的新增用例名净额)
= 1301  ← 与 W8.9 声称的数字精确相等
```

18 的来源（逐文件实测，见 `logs/` 与下列命令）：

| 文件 | W8.9 提交 `c8fcffd37f` | HEAD 提交 `e5ffdae03f` | 工作区 | 净增 |
|---|---|---|---|---|
| `packages/paper/paper-foundation/tests/executor-e1e2.spec.ts` | 23 | 35 | 35 | +12 |
| `packages/paper/paper-foundation/tests/executor-truncation.spec.ts` | 4 | 10 | 10 | +7 |
| `apps/paper-shell/tests/invoke.spec.ts` | 8 | 8 | 8 | +1 −1 = 0 |
| **合计** | | | | **+18** |

（`executor-e1e2.spec.ts` 实测 `Tests 35 passed`，`executor-truncation.spec.ts` 实测 `Tests 11 passed`；名字法给 35/10，差值来自 `.each` 展开。）

**结论**：`1301` **不是编造的**，它是一个真实测量值，但**属于 `paper-foundation + paper-shell` 作用域**。问题不在数字，在**标注**：它被填进"全仓测试实跑"的判据位且丢了作用域限定词。

### E1.5 Windows 跳过项核验（预期行为，已确认）

`vitest.config.ts` 的 `windowsUnsupportedPackages` 应排除 6 个需 POSIX bash 的包路径 + 4 个 `subprocess-*` spec。核验：

```
git 跟踪的 spec 文件（tests/ 或 scripts/，非 node_modules）: 994
win32 排除                                                  :  36
预期参与运行                                                : 958
npm test 实际观测到的文件数                                  : 958
MATCH: true
```

逐一抽查被排除项在 `npm test` 日志中出现次数均为 **0**：`packages/shell/bash-local`、`bash-sandbox`、`tool-bash`、`packages/hooks/*`、`packages/terminal/terminal-bash`、`packages/sandbox/sandbox-local`、`packages/subprocess/subprocess`、`subprocess-local/{local,process-inspector,spawn,terminal}.spec.ts`。

**跳过数（skip）= 64 条**，分布在 21 个文件（`install-lefthook.spec.ts` 6 条、`change-scope.spec.ts` 3 条、其余多为 pwsh/凭据/平台条件跳过）。**这是预期的**，非缺陷。

### E1.6 68 条失败的归因（隔离重跑实验）

方法：把全量运行中失败的文件**逐个分组隔离重跑**，观察是否复现。

| 批次 | 文件数 | 隔离结果 | 原始日志 |
|---|---|---|---|
| batch 1（超时型） | 7 | **7 passed / 100 tests passed, 3 skipped**，EXIT=0 | `logs/e1-isolation-batch1.log` |
| batch 2 | 9 | 6 failed / 3 passed；**13 条失败** | `logs/e1-isolation-batch2.log` |
| batch 3 | 18 | 6 failed / 12 passed；**6 条失败** | `logs/e1-isolation-batch3.log` |

batch 1 覆盖了全量运行中失败最集中的 7 个文件（`oxlint-contract` 7 条、`tool-ralph/integration` 6 条、`change-scope` 4 条、`test-invariants` 3 条、`publint-all` 2 条、`workflow-worker-thread` 5+2 条 = 29 条），**隔离后全部通过**。这是典型的**负载诱发超时**特征。

**归因结果**：

```
全量 68 条失败
 ├─ 49 条：负载诱发超时（隔离重跑全绿）        ← 环境/调度问题，非代码缺陷
 └─ 19 条：可稳定复现（分布在 12 个文件）
      ├─ 7 条  本机未安装 pwsh（PowerShell 7）
      │        sandbox-windows-acl/runner.spec.ts ×6
      │        pwsh-sandbox/sandbox.spec.ts ×1
      ├─ 3 条  e2b 环境擦洗断言（TERM/NPM_TOKEN/DPH_STALE）
      │        e2b/subprocess-e2b/terminal.spec.ts ×2、subprocess.spec.ts ×1
      ├─ 2 条  sdk/server/plugin-apply（jsonrpc 形状）
      ├─ 1 条  subagent-claude-code（`DSH_INTERNAL` 泄漏进 options.env）
      ├─ 1 条  app-boot（.env 设 skill root 未按预期拒绝）
      ├─ 1 条  verify-dsh-package-licenses（`dsh-agent` 声明 BSD-3-Clause）
      ├─ 1 条  apps/cli/source-launch.compat（期望 `scripts.dsh`，实际已改名 `dph`）
      ├─ 1 条  ui-brand-official（SVG viewBox 为 undefined）
      ├─ 1 条  ui-settings-models（owner copy 不符）
      └─ 1 条  typert cordis-catalog（生成区与提交区不一致）
    小计核验：7 + 3 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1 = 19 ✓
```

**对账已闭合**：全量 34 个失败文件**全部**被三个隔离批次覆盖，无遗漏；49 + 19 = **68**，与全量运行的失败总数精确相等。

**关键结论：19 条可复现失败中没有一条由 W8.10 引起。** W8.10 两个提交（`b2b739fdba`、`e5ffdae03f`）共改 28 个文件，其中**代码/测试只有 6 个**，全部在 paper 作用域内（`apps/paper-shell/src/{cli,invoke}.ts`、`apps/paper-shell/tests/invoke.spec.ts`、`packages/paper/paper-foundation/src/{executor.ts,produce/e2-guidance.ts}`、`packages/paper/paper-foundation/tests/{executor-e1e2,executor-truncation}.spec.ts`）+ `bench/metrics/compute-metrics.mjs`；其余 22 个是 `artifacts/` 归档产物。**19 条失败文件与这 6 个代码文件无一相交。**

**本机 pwsh 缺失的独立确认**：

```
$ which pwsh
which: no pwsh in (...)
$ pwsh -NoLogo -NoProfile -Command '$true'
bash: pwsh: command not found
$ ls /c/Program\ Files/PowerShell
ls: cannot access '/c/Program Files/PowerShell': No such file or directory
```

`vitest.config.ts` 明确写着"pwsh-requiring 的套件**故意保留在 Windows 上运行**（PowerShell 随 Windows 出货）"。**本机只有 Windows PowerShell 5.1（`powershell.exe`），没有 PowerShell 7（`pwsh`）**——所以这 7 条是**本机环境缺口**，不是仓库缺陷；但它们也说明 `18/18 全绿`式的表述不能覆盖这类主机差异。

### E1.7 隔离重跑中两条独立缺陷（与 W8.10 无关，但值得记账）

- `packages/typert/generator/tests/cordis-catalog.spec.ts`：提交的 `docs/subsystems/*.md` 生成区**落后于源码**（diff 显示 `diagnostics.ts`/`provider.ts` 的两段 JSDoc 已从提交的文档区消失）。`npm run verify-cordis-catalog` 独立复现，报 `1 partition violation: ctx.paperRuntimeGuard ... invisible to the rendering projection`（`logs/e3-verify-cordis-catalog.log`）。生成器头部注释**已预告**这个失败形态（"reads like a snapshot regression rather than a missing regeneration"）。**需重新生成目录。**
- `apps/cli/tests/source-launch.compat.spec.ts`：断言 `package.json` 的 `scripts.dsh === 'node --import tsx/esm apps/cli/src/bin.ts'`，实测 `scripts.dsh = undefined`（仓库已改名为 `dph`，`scripts.dph` 值正确）。**测试未随改名更新。**

---

## E2 — 构建守卫

### E2.1 `probe-provenance.mts` → `ok = true`

命令与**原始完整输出**（`logs/e2-probe-provenance.log`，未截断）：

```
$ npx tsx artifacts/handoff/W8.9/probe-provenance.mts
ok = true
  PASS @deepseek-ai/dsh-paper-foundation: entry lib/index.js is 391030 ms newer than the newest source
EXIT=0
```

**要求 `ok=true` 已达成。** 无需 `npm run build:lib:host`（未执行，以免在测试运行期间改写 `lib/`）。

### E2.2 `npx tsc -b tsconfig.host.json` → 通过

命令与**原始完整输出**（`logs/e2-tsc-host.log`；`cat -A` 确认文件除追加的 `EXIT=0` 外**完全为空**，即零诊断）：

```
$ npx tsc -b tsconfig.host.json
EXIT=0
```

**为排除"增量构建缓存导致空转"的可能**，我强制全量重编译（`logs/e2-tsc-host-force.log`）：

```
$ npx tsc -b tsconfig.host.json --force
EXIT=0
```

两次均为 **exit 0、零诊断**。已核验 `tsconfig.host.json` 设 `"noEmit": true`，因此该命令**不会改写 `lib/`**——它只做类型检查（`lib/` 的生成在 `tsdown` 那一步）。`tsconfig.host.json` 的 `include` 含 `./packages/paper/paper-foundation`、`./packages/paper/paper-bundle`、`./apps/paper-shell`，**paper 侧被覆盖**。

### E2.3 守卫是"活的"——但覆盖面比声称窄（**本轮的重要产出**）

**（a）守卫本身经负对照验证为有效。** 我用**合成临时包**（不触碰任何受保护文件）验证 `checkProvenance` 真的会拒绝（`logs/probe-guard-negative-control.mts`）：

```
CASE 1 (entry older than src) -> ok = false | entry lib/index.js is 60000 ms OLDER than the newest source — the built entry is stale
CASE 2 (entry newer than src) -> ok = true  | entry lib/index.js is 0 ms newer than the newest source
CASE 3 (entry missing)         -> ok = false | built entry missing: lib/nope.js — the package has never been built
```

三种情形判定均正确，**守卫不是恒真**。CLI 接线也已核验：`apps/paper-shell/src/cli.ts:365-378` 在 `!provenance.ok` 且非 `--fake`/`--replay` 时 `return 4`（fail-closed），并打印 `[CODE-STALE] 拒绝启动真实运行`。

**（b）覆盖缺口：`SHELL_PROVENANCE_TARGETS` 只有 1 个目标，而 CLI 通过包 exports 加载 6 个 workspace 包。**

`apps/paper-shell/src/code-provenance.ts` 末尾：

```ts
export const SHELL_PROVENANCE_TARGETS: ReadonlyArray<ProvenanceTarget> = [
  { name: '@deepseek-ai/dsh-paper-foundation', dir: 'packages/paper/paper-foundation', entry: 'lib/index.js' },
]
```

而 `apps/paper-shell/src/cli.ts` 的 import 列表含 6 个 workspace 包。我把**守卫自己的规则**应用到全部 6 个（`logs/probe-guard-scope.mts`）：

```
declared guard targets: @deepseek-ai/dsh-paper-foundation

PASS @deepseek-ai/cordis                    covered=false entry lib/index.js is 1108092519 ms newer than the newest source
PASS @deepseek-ai/dsh-storage               covered=false entry lib/index.js is 1108092894 ms newer than the newest source
PASS @deepseek-ai/dsh-storage-json          covered=false entry lib/index.js is 1108103460 ms newer than the newest source
PASS @deepseek-ai/dsh-storage-domain        covered=false entry lib/index.js is 1108103431 ms newer than the newest source
PASS @deepseek-ai/dsh-paper-foundation      covered=true  entry lib/index.js is 391030 ms newer than the newest source
PASS @deepseek-ai/dsh-llm                   covered=false entry lib/index.js is 1108093194 ms newer than the newest source
```

**判读（不夸大）**：

- 6 个包**当前全部满足**守卫规则，所以**此刻没有假阴性**。
- 但 **5 个包在守卫之外**（`covered=false`）。W8.8 那次事故的教训是"改了 src 却没重建 lib"——这条事故类别对 `dsh-storage*`、`dsh-llm`、`cordis` 同样成立，而守卫**不会**抓到它们。
- 这**不违反** W8.9-A1 的判据文本（A1 的原文范围是"每个将被加载的 workspace 包"——若按字面读，1 个目标**不满足**该范围；若按 `SHELL_PROVENANCE_TARGETS` 注释里"the workspace packages the paper-shell CLI loads through their built entries"读，则该注释与 `cli.ts` 的实际 import 面**不一致**）。**此处存在文档/实现与范围声明之间的缺口，建议下一轮补齐或在注释中显式记账。**

---

## E3 — 负对照作用域（红线 N5）

### E3.1 声明**仍在**（逐字核验）

文件：`bench/negative-controls/README.md`（git 状态：**clean**，自 `bb6966e0fb`(W8.5) 起未修改）。相关原文**逐字摘录**：

```
> **必须先读这一句**：本目录的负对照在**合成 fixture** 上运行。
> 它验证的是**指标函数对已知恶化的反应性**（"这个操作会不会让指标变红"），
> **不验证管线在真实输入下的行为**（真实运行的行为由 `bench/results/` 的真实运行归档回答）。
```

```
## 它不证明什么（后续报告禁止的表述）

- ❌ 不证明"管线已验证"——管线在真实输入下的行为只有真实运行能回答。
- ❌ 不证明"引擎可靠"——fixture 是构造的，不是赛题。
- ❌ 不替代留出集运行（W12）——预注册与逐题报告才是交付率的证据。
```

```
| 手段 | 回答的问题 |
|---|---|
| 负对照（本目录） | 指标函数会不会动？ |
| 真实运行归档（`bench/results/`） | 真实输入下发生了什么？ |
| 预注册 + 逐题报告（W12） | 交付率是多少、哪族虚高？ |

三者不可互相替代。"18/18 全绿"只说明第一行。
```

**判定：作用域声明完整保留，未被稀释。** 结论明确：**不得**把"负对照全绿"读作"管线已验证"（红线 N5）。README 末句已把这一点写死（`"18/18 全绿"只说明第一行`）。

### E3.2 负对照实跑：18/18

命令与原始输出（`logs/e3-negative-controls.log`，节选，尾部完整）：

```
$ node bench/negative-controls/run-all.mjs
M-Bench 负对照（W1 硬门禁）——每个控制必须把指标变红：
... (NC-1..NC-7 逐项 PASS，见日志全文)
18 passed, 0 failed
EXIT=0
```

`18/18` **可复现**。但下面两条使"18 项检查"的**证据强度低于其字面**。

### E3.3 **发现两项检查不成立**（本轮最有价值的产出之一）

#### 缺陷 A：NC-2 是**空转的**——它没有测到它声称的规则

`run-all.mjs` 的 NC-2 标题是"复述题面必降"，注释写着"复述稿 m1_readable_draft=false（n-gram 命中禁线）"。其 fixture：

```js
const problemText = '问题：测量平均厚度 mean_thickness。给定数据范围 0.731 与时长 42.2。'
const recitalDraft = base.problemText + '\n' + base.problemText   // 纯复述：题面 ×2
```

我用**完全相同的 fixture** 复算（`logs/probe-nc2-defect.mts`）：

```
--- NC-2 exactly as run-all.mjs builds it ---
recitalOverlap(draft, problem) = 0
m1_readable_draft = false
m2_recital_overlap = 0   <-- the n-gram value
skeleton missing   = 10 / 10
silent errors      = 0
=> M1 false because: skeleton missing

whitespace tokens in problemText = 5 (n-gram n = 8)
```

**根因**：`recitalOverlap` 的 `grams()` 按**空白**切词（`text.split(/\s+/)`）并以 `n = 8` 取 8-gram。该 `problemText` 只有 **5 个**空白分隔 token——**结构上不可能形成任何 8-gram**，两个集合均为空集，函数在 `g1.size === 0` 处直接 `return 0`。于是：

- `m2_recital_overlap = 0`（**"零复述"**，与"复述稿"完全相反）；
- M1 之所以为 `false`，是因为 `skeleton.missing.length = 10`（骨架全缺），**与复述规则无关**。

**该检查即使把 n-gram 规则整条删掉也照样 PASS**——它测的是骨架，不是 n-gram。

**对照实验**（同一脚本，构造一个够长的纯复述稿，其余全部干净）：

```
--- control: a recital draft long enough to form 8-grams ---
recitalOverlap = 0.3877551020408163
m1_readable_draft = false | m2_recital_overlap = 0.388 | skeleton missing = 0
=> on a fixture where ONLY recital is degraded, the rule DOES fire: true
```

**判读**：n-gram 规则**本身是活的**（0.388 ≥ 0.30 禁线，M1 翻负），但 **NC-2 没有验证它**。README 第 10 行声称"NC-2：复述稿的 n-gram 判定会翻负"——**这一条与实测不符**。NC-2 是 7 组中的 1 组，其 2 项检查里的第 2 项（`复述稿 m1_readable_draft=false`）**因错误的原因而通过**。

#### 缺陷 B：NC-7 的 3 项检查里 **2 项是同义反复**，且含硬编码本机路径

`run-all.mjs` 的 `nc7()`：

```js
const actual = await sha256File('bench/problems/2024-B/problem.pdf'.replace('bench/', 'D:/deepseek modex/deepseek-harness/bench/'))
check('篡改模拟：哈希不匹配可被检出', actual !== '0'.repeat(64), '篡改检测依赖逐字节比对，此处验证哈希函数活性')
const tampered = { ok: false, failures: [{ file: 'problems/2024-B/problem.pdf', expected: '0'.repeat(64), actual }] }
check('校验器对不匹配条目报告 ok=false', tampered.ok === false)
```

- **检查 2 是同义反复**：`actual !== '0'.repeat(64)` 断言"某文件的 sha256 不是 64 个 0"。**恒真**，与篡改检测无关。
- **检查 3 是同义反复**：断言一个**手写的对象字面量** `{ ok: false }` 的 `.ok === false`。它**没有调用任何校验器**，`verifyManifestIntegrity` 根本没被喂给篡改输入。所谓"篡改模拟"是**手工构造的假失败对象**。
- **检查 1 是真的**（未篡改 bench → `verifyManifestIntegrity().ok === true`）。所以 NC-7 实际只有 **1 项**有效检查，**2 项为占位**。
- **硬编码路径**：`'bench/problems/...'.replace('bench/', 'D:/deepseek modex/deepseek-harness/bench/')` 把**本机绝对路径**烧进了脚本。我把同一表达式放到另一 checkout 根下模拟（`logs/probe-nc7-portability.mts`）：

```
as written in run-all.mjs  : D:/deepseek modex/deepseek-harness/bench/problems/2024-B/problem.pdf
same expression elsewhere  : /home/ci/paper-harness/bench/problems/2024-B/problem.pdf

nc7() calls sha256File() with no try/catch, then asserts `actual !== "0".repeat(64)`.
  on another checkout -> THREW ENOENT: ENOENT: no such file or directory, open 'D:\home\ci\paper-harness\bench\problems\2024-B\pr
  => nc7() rejects -> top-level await rejects -> script exits non-zero,
     the "18 passed, 0 failed" summary line never prints.
```

`nc7()` 是 `await` 的顶层调用且**无 try/catch**——在任何**不是** `D:/deepseek modex/deepseek-harness` 的 checkout 上（CI、其他开发者、CI 容器），该脚本会**以未捕获异常退出**，`18 passed, 0 failed` 这行**根本不会打印**。

**并且：负对照没有任何 CI 调用者。** 全仓检索：

```
$ grep -rn "negative-controls\|negative_controls" .github/ .gitlab-ci.yml scripts/ package.json lefthook.yml
(无输出)
```

即 `bench/negative-controls/run-all.mjs` **从未在 CI 中运行**，`18/18` 只在本机手工跑过。这与 README 把"18/18 全绿"当作可引用结论的用法之间存在张力：**没有任何自动机制阻止它退化为恒绿或恒红**。

### E3.4 关于 N5 的最终判读

- README 的作用域声明（"仅测指标函数、不测管线"）**原文完整、未被删除或弱化**。
- 因此：**不得**把"负对照全绿"读作"管线已验证"。**这一条红线在本轮复核后仍然成立且应当继续成立。**
- 但需追加两条**新的**诚实边界（本轮的净产出）：
  1. `18/18` 中的 **NC-2 第 2 项**与 **NC-7 第 2、3 项**不能计入"已验证的指标反应性"，实际有效检查数为 **15**（18 − 3）。README 第 9 行的"7 组控制（18 项检查）"应据此修订或在 `run-all.mjs` 内标注。
  2. `18/18` **不是** CI 门禁，也**不可移植**（NC-7 硬编码路径）。它的绿色只在本机特定路径下成立。

---

## 附：本次复核产生的全部原始证据文件

| 文件 | 内容 |
|---|---|
| `logs/e1-npm-test.log` | 全量 `npm test` 原始输出（含 ANSI） |
| `logs/e1-npm-test.clean.log` | 同上，去 ANSI，便于检索 |
| `logs/e1-paper-scope.log` | `vitest run packages/paper apps/paper-shell` → 120 文件 / 1328 用例 |
| `logs/e1-pf-shell-scope.log` | `vitest run packages/paper/paper-foundation apps/paper-shell` → **119 文件 / 1319 用例** |
| `logs/e1-isolation-batch1.log` | 隔离重跑批 1（7 文件全绿 → 负载超时结论） |
| `logs/e1-isolation-batch2.log` | 隔离重跑批 2（13 条可复现失败） |
| `logs/e1-isolation-batch3.log` | 隔离重跑批 3（6 条可复现失败） |
| `logs/e2-probe-provenance.log` | E2 守卫探针原始输出（`ok = true`） |
| `logs/e2-tsc-host.log` | `tsc -b tsconfig.host.json`（空输出，EXIT=0） |
| `logs/e2-tsc-host-force.log` | 同上 `--force`（空输出，EXIT=0） |
| `logs/e3-negative-controls.log` | 负对照实跑（18 passed, 0 failed） |
| `logs/e3-verify-cordis-catalog.log` | cordis 目录漂移的独立复现 |
| `logs/probe-guard-negative-control.mts` | **守卫负对照**（合成临时包，证守卫会拒绝） |
| `logs/probe-guard-scope.mts` | **守卫覆盖面探针**（6 个 CLI 依赖包，1 个被覆盖） |
| `logs/probe-nc2-defect.mts` | **NC-2 空转的证明 + n-gram 规则活性的对照实验** |
| `logs/probe-nc7-portability.mts` | **NC-7 硬编码路径的不可移植性证明** |

**未做**：未修改 `packages/`、`apps/`、`bench/` 下任何被跟踪文件；未跑真实 API 调用；未执行 `npm run build:lib:host`（因 `tsconfig.host.json` 为 `noEmit`，无需重建，且避免在测试运行期间改写 `lib/`）。

**工作区状态说明**：复核前后 `git status` 在受保护目录下的改动**完全一致**——仅有 3 个**复核开始前就已存在**的未提交文件（`packages/paper/paper-foundation/src/executor.ts`、`src/produce/e1-e2.ts`、`tests/executor-e1e2.spec.ts`）。本复核**未新增、未删除、未修改**其中任何一个。所有新增产物均在 `artifacts/handoff/W8.10/` 下。
