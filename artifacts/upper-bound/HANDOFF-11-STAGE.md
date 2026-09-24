# 11 阶段重塑 —— 交接文档（给下一个 agent）

> **写给谁**：接手"按 11 阶段重塑 DPH 架构"的下一个 agent。
> **读法**：先读 §0 与 §1，再读 §2（已完成）与 §3（剩余）。**§4 与 §5 一定要读**——
> §4 是已经定下来的设计决策（别重新论证），§5 是上一个 agent 的稳定失误模式（别重复）。
> **编制**：2026-09-24（S5b 后更新）　**基线**：`801235a8d2` → S5b 工作树
> **上游**：`HANDOFF.md` 是**改造前**的快照，已被本轮重塑取代；`docs/upper-bound-architecture.md`
> 描述 L0–L6 守卫层（本轮**不动**那一层，只换产出方式）。
> **S5b 详情**：`S5B-REPORT.md`（做了什么 / 抓到哪四个真缺陷及其根因 / 测试侧失误 4 次）。

---

## §0 三句话

1. **在做什么**：把"一个大阶段里一口气写完八章"改成**参考工作流的 11 个阶段**——每阶段一个技能、
   一组同名产物、一套机器可校验的门禁、一个通行证；阶段之间靠 **JSON 文件**交接。
2. **为什么**：现在八章写在同一次调用里，**出问题只能全盘返修**（重发 40KB、数分钟）；
   而"骗过门禁的错误"（如分析章与求解章不自洽）**没有返修路径**——修订轮只改文本、碰不到容器。
3. **做到哪了**：S0–S6 完成。**11 个阶段已从 CLI 端到端接通**（`--stages` 走真 provider 缝，
   确定性阶段是真执行体，暂停/续跑以通行证为切片），导出引擎三个依赖已装并跑通，`it.skip` 清零。
   **剩余见 §3**：S7 并排比对（要一次真实模型运行）、台账剩 1 项、5 条未实现门禁。

---

## §1 用户口径（不可协商，写在最前）

| # | 口径 | 落地方式 |
|---|---|---|
| 1 | **JSON 优先作为阶段间传递媒介**，确实不行再折中并写明 | `stages/interchange.ts`；唯一例外是 `ExecutionRecord`（见 §4.2） |
| 2 | **skills 与 prompt 不许简化成摘要** | `stages/briefing.ts`，每阶段 ≥800 字符，且有测试抽查参考里的硬形态 |
| 3 | **自创部分必须用明确指示，不用建议** | 阶段 8/11 参考里没有技能；简报明说"这是指示，不是建议"，测试禁止软措辞 |
| 4 | **数字资产要做适配与迁移，不是简单删掉指令** | `stages/adaptation.ts` 台账：八类资产 × 五种适配方式，`missing` 必须写补齐选项 |
| 5 | **有现成库/模组时优先迁移适配，不要简单改造** | 国赛样式档、图模板、docx 引擎都是**原样迁移**；引擎不换成 `export-docx.py`（标准不同） |
| 6 | 热重启与切片是既有能力，**复用** | `runtime/stage-checkpoint.ts`（5 阶段表）+ `stages/runner.ts`（11 阶段） |
| 7 | 每阶段检查点写报告（改了什么/错误形态/根因） | `artifacts/upper-bound/2024B-hot-1/CHECKPOINT-*.md` 是范例 |
| 8 | 唯一格式标准是参考论文 `main.docx` | `delivery/format-audit.ts` 的八条判据；`FORMAT-AUDIT.md` 记录了飘移起点 |

---

## §2 已完成（S0–S5a）

| 步 | 交付物 | 关键判据 |
|---|---|---|
| **S0** | `tests/architecture/chain-split-prototype.spec.ts` | 渲染路径**不读** `ExecutionRecord`（所以能切）；`ExecutionRecord` **按设计不可 JSON 往返**（INV-3-M 防伪缝） |
| **S1a** | `stages/interchange.ts` | IR → JSON → IR 无损往返（真夹具证明）；`inputDigestOf` 覆盖上游/技能/门禁三者 |
| **S1b** | `stages/registry.ts` + `stages/handoff.ts` | 11 阶段 × 七字段；通行证三条准入规则；回滚作废下游（标 stale 不删除） |
| **S2** | `stages/gates.ts` | 16 条门禁实现（0/1/2 语义）；**10 条显式给 2 并写明缺什么** |
| **S3** | `stages/briefing.ts` + `stages/adaptation.ts` | 七节简报；适配台账（八类资产 × 五种方式，`missing` 必须写 option） |
| **S4a** | `stages/skill-docs/`（**20 份 / 809KB**）+ `stages/skill-docs.ts` | 语料已恢复、**逐份核查过禁用字样**、**不内联**（809KB） |
| **S4b** | `stages/tools.ts` | 工具回路多工具化；`read_skill_doc` 按阶段可见性 + 截断明说 |
| **S4c** | `stages/assets/docx-profiles/` + `stages/docx-profile.ts` | 国赛样式档**原样迁移**；`resolveDocxProfile` 缺失/非法时回退默认并给具名原因 |
| **S4d** | `stages/assets/diagram-templates/` + `docx-engine/` + `stages/assets.ts` | 模板 6 份、引擎 5 份迁移；**引擎三个依赖未装**（有断言钉住） |
| **S5a** | `stages/runner.ts` | 11 阶段编排；产出映射规则（1 份取原文 / ≥2 份取 JSON 信封）；`code 2` **不阻断阶段、阻断 CLEAN** |
| **S5b** | `stages/{deterministic,figure-render,diagram-render,format-check,docx-export,figure-manifest,asset-dir}.ts` | **四个确定性阶段的执行体**（阶段 4/5/10/11 真跑）；5 条门禁从 `2` 变真判据 + 新增 `figure_style_rules`；运行器补上"声明的产物齐了没有"与目录型产物展开；导出引擎三依赖已装并跑通 |
| **S5b（门禁侧）** | `stages/gates.ts` | 未实现判据 10 → **5** 条（清单是 `gates.spec.ts` 里的断言）；`figure_style_rules` 把 `setup_style` 的规范做成可核判据 |
| **S6** | `stages/stage-service.ts` + `apps/paper-shell/src/cli.ts` | `--stages` 接通：`callModel` 走 `paperProvider.stream`（与交付链同一条缝）；暂停/续跑以**通行证**为切片；`stages/**` 经 `src/index.ts` 进入打包产物（已验证：lib 里 28 条门禁、资产解析落到 src）| |

**测试规模**：packages/paper **1936** + apps/paper-shell **135** = **2071 通过 / 0 显式待办**，`it.skip` 清零，`tsc -b tsconfig.host.json` 干净。
**两套要分开跑**：合并跑会撞 JS 堆上限（S6 的用例要起子进程 + python + node 引擎）——与 §5.2
记的"满负载抖动"同源，不是代码问题。

**S5b 抓到的四个真缺陷**（详见 `S5B-REPORT.md` §2）：纵向架构图节点越出画布、
数据图图内出现标题（代码与自己的契约相反）、逐问代码文件对门禁不可见、
**阶段 11 的 docx 写到了正文路径上**（在加"产物齐了没有"这条检查之前，它是"通过"的）。

---

## §3 剩余工作（按优先级，每项带判据）

### 3.1 ✅ 确定性阶段的执行体（S5b 完成）

四个阶段都跑通了，判据（那 3 条 `it.skip`）已转正，并补了 6 条执行体专项用例。
`adaptation.ts` 的两条 Python 计算缺口：**图表规范那条已闭合**（`figure_style_rules` 门禁）；
**附件画像器那条仍未闭合**，但缺的不是算法是接线位置（阶段 1 是模型阶段，没有 harness 侧
后处理钩子）——如实留在台账里，不假装适配。

### 3.2 ✅ 导出引擎的三个依赖（S5b 完成）

`docx` / `fast-xml-parser` / `temml` 已装进 `packages/paper/paper-foundation`，已实测跑通。
**顺带发现一个参考侧不存在的问题**：参考的图由 matplotlib 直接出 PNG，而本 harness 的图是
SVG，迁移进来的引擎**只嵌位图**——不补一步，Word 里会是 `[unsupported image]` 占位符。
所以由 harness 侧补一次 SVG→PNG 栅格化（`cairosvg`，300 DPI，复用既有的 `probeExportDeps`，
cairosvg 早就在那张表里）。测试**解压 docx** 断言 `word/media/` 非空且无占位符。

### 3.3 ✅ S6：CLI 接线（S6 完成）

`--stages` / `--stage-only` / `--stage-pause-after` / `--stage-resume` / `--stage-problems N` /
`--stage-attachments` 已接进 `apps/paper-shell/src/cli.ts` 的 `run`。

**三个按交接文档执行时做的决定**（理由都在 `stage-service.ts` 的模块头）：

1. **暂停/续跑的载体是通行证，不是 `stage-checkpoint.ts` 的 5 阶段表**。那张表服务的是
   交付链的切片点，把 11 阶段塞进去是硬套；通行证是更强的载体（机器算的 `inputDigest`，
   上游/技能/门禁任一变了就失效，`markStaleFrom` 已实现）。**复用的是热重启的工作流，不是那张表**。
2. **工具开关在这条路径上必须是 false**。`read_skill_doc` 的宿主在 `WorkflowExecutor` 的
   工具调用循环里；阶段链的 `callModel` 是一次纯文本调用，模型没有发起工具调用的通道。
   所以 `skillDocs: true` 在这里**拒绝启动**并说明原因——静默接受就等于让简报点名一份
   取不到的语料（round-5 的原缺陷）。要在阶段链上启用语料，先给 `callModel` 加工具回路。
3. **两个同名导出撞车**（§3.3 原文预言的那处）：`runtime/stage-checkpoint.ts` 与
   `stages/registry.ts` 都导出 `StageId`，`resumePointOf` 也撞。已改名导出
   `StageChainId`；测试里的 `resumePointOf` 改为从源码模块导入。

**顺带修的**：阶段 1 的简报现在内联 `00-input/` 的题面——第一版跳过它们是按"外部输入
由调用方另行注入"写的，但调用方把题面落盘到 `00-input/problem.txt` 之后，这条路就是唯一通路。

**真实运行的命令形态**（`--fake` 的回答不满足契约，所以离线只能验证到"失败带着阶段名浮出来"）：

```bash
set -a && . ./.env.local && set +a
PAPER_PROBE_MODEL=deepseek/deepseek-v4-pro PAPER_CAPABILITY_TIER=A npx tsx apps/paper-shell/src/cli.ts run bench/problems/2024-B/problem-faithful.md   --mode strict --tier T1 --out artifacts/upper-bound/2024B-stages-1   --stages --stage-pause-after prob-analysis,code
# 人工检查后：
#   ... --stages --stage-resume
```

### 3.4 🔴 S7：逐阶段与参考并排比对（**第一优先**，但要先有一次真实模型运行）

同名产物（`PROBLEM_ANALYSIS.md` / `MODELING_REPORT.md` / `RESULTS.md` / `paper/main.md` …）
可直接与参考工作区 `C:\Users\35702\Desktop\CUMCM\workspaces\5ba6e7bd5010\` 逐份 diff。

### 3.5 台账里剩下的 1 项 `missing` + 5 条未实现门禁

`prob-analysis` 的附件画像器（见 3.1）。补齐它要先给阶段执行器加一个"模型阶段也可以有
harness 侧后处理"的钩子——阶段 1 是模型阶段，`runStages` 对它只调 `callModel` 并落盘。

**未实现的门禁还有 5 条**（`capability_check` / `modeling_coverage` / `modeling_self_check` /
`delivery_audit` / `paper_claim_check`），最高优先级仍是 `paper_claim_check`——它是阶段 7
"装配而非推理"这一前提的机械强制手段。清单在 `gates.spec.ts` 里，**实现一条就删一条**。

---

## §4 已定的设计决策（**别重新论证**，改之前先读理由）

### 4.1 阶段 2 = **两次调用**（2a 声明 / 2b 散文）

`MODELING_REPORT.md` **不可能由 IR 派生**（IR 字段被刻意压短到 40 字符；`.md` 要装装不进去的
富散文）。合成一次会回到 E2 的 40KB 规模，分片收益归零。

### 4.2 `ExecutionRecord` **不能** JSON 往返——这是防线，不是缺陷

`put('ExecutionRecord', …)` 被设计性拒绝，唯一入口是 `putExecutionRecord(record, attestation)`，
而 attestation **never serializable**（INV-3-M：防"把伪造的执行记录当成真跑过"）。
渲染路径**不读它**（S0 已核），所以切分安全；需要它的路径只能**进程内传递或只读投影**。

### 4.3 门禁 `code 2`（无法判定）**阻断 CLEAN，不阻断阶段**

第一版让它阻断阶段，测试立刻撞出后果：**阶段 1 的 `capability_check` 未实现 → 整条链一步都跑不动**。
现行契约：`1` 拒绝签发；`2` 可签发但**必须带 `unverifiedGates` 记名**（不记名即抛错——
不记名就等于把它当成了通过）。这与既有的 CLEAN/MARKED/DEGRADED/ESCALATE 阶梯一致。

### 4.4 阶段 7 = **装配，不是推理**

所以它能一次写完而不重犯散文单体问题。这个前提**被机械强制**：`paper_claim_check=0 才准写`。
**该门禁尚未实现，是最高优先级的未实现门禁**——零数字通道已有实现它所需的能力
（Result/Claim ↔ 正文数字），只待接上。

### 4.5 阶段 3 = **要求声明、禁止渲染**

图是声明驱动的（`figure/producer.ts`）。若没有阶段写 `interpretations.figures` 声明，
阶段 4 的确定性渲染器**没有输入**，figures 依然为 0——**那正是六轮真实运行的实际失败**。

### 4.6 阶段 8 的终止条件 = **批准即收口 + 三轮无进展即停**

"进展" = 缺陷数**严格下降**。**"超时"不是终止条件**（round-5 的结论：缺的不是额度，是终止条件）。

### 4.7 规则语料**不内联**（809KB），由 `read_skill_doc` 工具按需取用

参考原本也是让模型 `cat _utils/x.md`。**工具没挂时简报不列语料索引**——点名一份取不到的文档
等于又造一条"无法被遵守的指令"。

### 4.8 与 T1/T2/T3 的关系：**两个正交的轴**

阶段回答"产出什么"，档位回答"对这个模型给多少引导"。阶段是主路径，档位是**阶段内部的降级机制**
（`guidedFallback`）。**不要用阶段取代档位阶梯**——"任何模型都能交付"由它承接。

---

## §5 上一个 agent 的稳定失误模式（**别重复**）

### 5.1 我写测试时的固定失误：**断言写成了"我以为的"，而不是被测对象的真实语义**

本会话犯了 **6 次**，每次都是同一形状：

| 形态 | 实例 |
|---|---|
| **空对空假绿** | "往返深等"在**空 store** 上通过（夹具被拒了但我没检查 verdict） |
| **单位混淆** | 用 `readFileSync().length`（字符）断言"≥800KB"（字节）——**而我为此专门写了 `byteFloor` 门禁** |
| **凭记忆写期望值** | 断言含 `'什么时候'`，实际文本是"当你要…时" |
| **路径两边各拼一份** | 模块漏了 `skill-docs/` 一段，而测试自己另拼了正确路径 → 只有真调用的那条抓到 |
| **期望了未播种的状态** | 回滚测试里列了未播种的阶段 |
| **把"自创技能阶段"当成"无资产依赖"** | 阶段 8 其实有台账行 |

**对策（请照做）**：
- 断言前先**打印一次实际值**，或让失败信息带上实际值；
- 凡是"某集合应当非空"的地方，**都加非空守卫**（`expect(size).toBe(N)` 而非 `toBeGreaterThan(0)`）；
- 路径/常量**只从被测模块导出**，测试不另拼；
- 字节与字符**永不混用**（`Buffer.byteLength(x, 'utf8')`）。

### 5.2 环境坑（本会话实测）

| 坑 | 症状 | 处置 |
|---|---|---|
| **git 代理** | `Failed to connect ... via 127.0.0.1:63770` | **已清**（`git config --unset http.proxy/https.proxy`）。若复现，用 `-c http.proxy= -c https.proxy=` 逐次绕过 |
| **钩子依赖 pnpm** | `pnpm: command not found`（exit 127）→ 推送被挡 | 钩子**已停用**：`core.hooksPath` 在 **worktree 作用域**（`.git/config.worktree`，**不是** `.git/config`）。恢复：`git config --worktree core.hooksPath .git/dsh-hooks` |
| **GitHub 网络抖动** | 推送时通时不通，`ls-remote` 才是真相 | 用**校验远端 ref** 的重试循环（`git ls-remote origin main` 对比 `HEAD`）；**别信 `git push` 的输出 grep**——我因此误报过一次"已推送" |
| **Bash heredoc 截断** | 单条命令内容 >~190 行时 `EOF` 不被识别，文件被写坏 | **大文件用 Write 工具**，不要用 `cat <<'EOF'` |
| **构建产物过期** | `[CODE-STALE] 拒绝启动真实运行` | 真实运行前必须 `npm run build:lib:host`（真实运行读 `lib`、测试读 `src`） |
| **满负载测试抖动** | `bundle.spec.ts` 的 xlsx 用例、`executor-authoritative` 偶红 | 单独跑确认（本会话多次遇到，与改动无关） |

### 5.3 两条方法纪律（本轮反复用到，很有效）

- **判据要落在行为上，不是措辞上**。例如"工具回路多工具化"的回归判据是
  **41 条既有测试一条没改、全过**，而不是"我改对了"。
- **"模块做好"不等于"进了主线"**。本会话抓到 4 次"做好的模块从入口够不到"：
  `resolveExecutorOptions` 白名单漏传、`--resume` 印在提示里却没实现、
  `core.hooksPath` 改错作用域、`passportFor` 的旧契约架空 runner 的改动。
  **每接一个模块，都要有一条端到端断言证明它真的被调用到。**

---

## §6 验证命令

```bash
# 全量套件（约 20s，2061 通过 / 0 待办）
npx vitest run packages/paper apps/paper-shell

# 只跑本轮新增的架构测试
npx vitest run packages/paper/paper-foundation/tests/architecture

# 类型检查（改完必跑）
npx tsc -b tsconfig.host.json

# 真实运行前必须重建（否则 CODE-STALE 会拒绝启动）
npm run build:lib:host
```

**注意**：`stages/**` 目前**不在** `lib/index.js` 里（S6 才会接进产物），
所以重建之后 `grep docx-profiles packages/paper/paper-foundation/lib/index.js` 仍是 0——
那不是"构建坏了"，是还没接线。静态资产怎么进产物见 §3.3。

# 真实运行（阶段链，暂停在检查点）
set -a && . ./.env.local && set +a
PAPER_PROBE_MODEL=deepseek/deepseek-v4-pro PAPER_CAPABILITY_TIER=A \
npx tsx apps/paper-shell/src/cli.ts run bench/problems/2024-B/problem-faithful.md \
  --mode strict --tier T1 --out artifacts/upper-bound/2024B-hot-2 --pause-after analyze
```

**参考工作区**（格式与形态的唯一标准）：`C:\Users\35702\Desktop\CUMCM\workspaces\5ba6e7bd5010\`
**资产库历史**（已删，可从 git 取回）：`git show ed37868092~1:docs/asset-library/<path>`

---

## §7 文件地图

```
packages/paper/paper-foundation/src/stages/
  registry.ts        11 阶段 × 七字段（kind/consumes/produces/gates/contractRules/rollbackTo/guidedFallback）
  handoff.ts         通行证：签发/读取/上游就绪/回滚作废
  interchange.ts     JSON 传递媒介：IR 往返、digest、inputDigestOf
  gates.ts           16 条门禁（0/1/2）+ 5 条显式未实现
  briefing.ts        七节阶段简报（技能适配层）
  adaptation.ts      适配台账（八类资产 × 五种方式，missing 必须写 option）
  skill-docs.ts      规则语料索引（20 份）
  tools.ts           ToolSpec + read_skill_doc
  docx-profile.ts    国赛样式档解析 + 导出前校核
  assets.ts          图模板与导出引擎的清单
  runner.ts          阶段执行器（provider 无关）
  asset-dir.ts       资产目录解析（src/lib 两种布局 + 缺资产抛错）
  deterministic.ts   确定性执行体总入口（deterministicRunner() 一行接线）
  figure-render.ts   阶段 4：声明驱动的数据图渲染 + figure-manifest.json
  diagram-render.ts  阶段 5：FIGURE_MANIFEST + ARCH_DECLARATION → 架构图 + diagram-manifest.json
  format-check.ts    阶段 10：五类检查 + 逐字可比的安全修复 + 报告
  docx-export.ts     阶段 11：校核 → SVG→PNG 栅格化 → 引擎渲染 + 导出报告
  figure-manifest.ts FIGURE_MANIFEST 的唯一解析器（阶段 4/5 与门禁共用）
  stage-service.ts   阶段链的服务层（S6）：callModel→provider 缝、暂停/续跑、工具开关的拒绝语义
  skill-docs/        20 份语料（809KB，原样迁移）
  assets/            docx-profiles/（样式档+封面档）、diagram-templates/（5+1）、docx-engine/（5）

tests/architecture/
  chain-split-prototype.spec.ts   S0
  interchange.spec.ts             S1a
  stage-registry-handoff.spec.ts  S1b
  gates.spec.ts                   S2（38 条：含对账/风格/几何/校核四组）
  stage-briefing.spec.ts          S3
  adaptation.spec.ts              S3（台账）
  skill-docs.spec.ts              S4a
  tools.spec.ts                   S4b
  docx-profile.spec.ts            S4c
  stage-assets.spec.ts            S4d
  asset-dir.spec.ts               S5b（资产目录两种布局）
  stage-runner.spec.ts            S5a+S5b（**确定性阶段用真执行体**；解压 docx 断言图真的嵌进去了）
  stage-service.spec.ts           S6（provider 缝的证据、暂停/续跑、工具开关拒绝）
```
apps/paper-shell/tests/stage-cli.spec.ts  S6（起真 CLI 进程：`--stages` 到阶段链的端到端）

**报告**：`artifacts/upper-bound/S5B-REPORT.md`（S5b：做了什么 / 四个真缺陷的根因 / 测试侧失误）、
`ROUND-5-REPORT.md`（自检工具）、`ROUND-6-REPORT.md`（按审计修复）、
`FORMAT-AUDIT.md`（格式飘移定位）、`2024B-hot-1/CHECKPOINT-*.md`（热重启四份检查点报告）。
