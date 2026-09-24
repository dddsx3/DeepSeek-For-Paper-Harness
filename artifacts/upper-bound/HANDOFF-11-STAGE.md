# 11 阶段重塑 —— 交接文档（给下一个 agent）

> **写给谁**：接手"按 11 阶段重塑 DPH 架构"的下一个 agent。
> **读法**：先读 §0 与 §1，再读 §2（已完成）与 §3（剩余）。**§4 与 §5 一定要读**——
> §4 是已经定下来的设计决策（别重新论证），§5 是上一个 agent 的稳定失误模式（别重复）。
> **编制**：2026-09-24　**基线**：`d98d5160f7`（工作树干净，套件 2021 通过 / 3 显式待办）
> **上游**：`HANDOFF.md` 是**改造前**的快照，已被本轮重塑取代；`docs/upper-bound-architecture.md`
> 描述 L0–L6 守卫层（本轮**不动**那一层，只换产出方式）。

---

## §0 三句话

1. **在做什么**：把"一个大阶段里一口气写完八章"改成**参考工作流的 11 个阶段**——每阶段一个技能、
   一组同名产物、一套机器可校验的门禁、一个通行证；阶段之间靠 **JSON 文件**交接。
2. **为什么**：现在八章写在同一次调用里，**出问题只能全盘返修**（重发 40KB、数分钟）；
   而"骗过门禁的错误"（如分析章与求解章不自洽）**没有返修路径**——修订轮只改文本、碰不到容器。
3. **做到哪了**：S0–S5a 完成（切分可行性已证、注册表、门禁、技能适配、语料恢复、工具回路、执行器）。
   **剩余见 §3**，其中第一优先是**确定性阶段的执行体**（阶段 4/5 渲染器 + 10/11 导出）。

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

**测试规模**：全量 **2021 通过 / 3 显式待办**（那 3 条见 §3.1）。`tsc -b tsconfig.host.json` 干净。

---

## §3 剩余工作（按优先级，每项带判据）

### 3.1 🔴 确定性阶段的执行体（**第一优先**，它同时解锁两项台账缺口）

`runner.ts` 的 `StageContext.runDeterministic` 目前是**测试里的假执行体**，主线没有实现。
需要实现四个确定性阶段：

| 阶段 | 要做什么 | 现成可复用的 |
|---|---|---|
| **4 图表生成** | 读 `FIGURE_DECLARATIONS.json` → 渲染 SVG → 写 `figure-manifest.json` | **`figure/producer.ts` 已经是声明驱动渲染器**（模型声明 `chart_type/data_refs/caption`，producer 从 store 取数渲染）——**适配它，不要重写** |
| **5 流程与架构图** | 读 `PROBLEM_ANALYSIS.md` 的 FIGURE_MANIFEST → 用迁移进来的模板渲染 | `stages/assets/diagram-templates/`（5 模板 + themes.css，**已迁移**） |
| **10 格式自检** | 五类检查 + 就地安全修复 → 写报告 | 参考的 `docx-format-check/SKILL.md` 已转写进 `briefing.ts` |
| **11 导出** | 引擎渲染 docx | `stages/assets/docx-engine/`（**已迁移，差三个依赖**） |

**判据**：§2 里那 3 条 `it.skip` 用例转绿（它们要的就是"跑完整条链"）。
**同时解锁**：`adaptation.ts` 里两条 Python 计算缺口的 `option`——把
`setup_style` 的规范（禁 `plt.title` / 禁默认色板 / ≥300DPI / 字号 ≥9pt）做成 TS 门禁
`figure_style_rules`，需要渲染器先吐出元素的字号与配色元数据。

### 3.2 导出引擎的三个依赖

`docx` / `fast-xml-parser` / `temml` —— 本仓库**一个都没有**。
`tests/architecture/stage-assets.spec.ts` 里有**断言钉住"还没装"**：装了依赖那条会红，
**逼你同步台账**。两条路：装依赖，或把引擎里用到它们的地方改成仓库已有的能力。

### 3.3 S6：CLI 接线

`--stages` / `--pause-after` / `--resume` 复用既有热重启。要点：
- `--stages` 走 `runStages`，`callModel` 接 `WorkflowExecutor` 的 provider 调用；
- **语料工具与自检工具同一个开关**（`PaperExecutorOptions.skillDocs`）——工具没挂时简报不列语料索引；
- 暂停/续跑的语义已由 `runtime/stage-checkpoint.ts` 实现，**11 阶段表要与它的 5 阶段表对齐**
  （或把 `stage-checkpoint.ts` 的 `STAGES` 换成引用 `stages/registry.ts` 的 `STAGES`）。

### 3.4 S7：逐阶段与参考并排比对

同名产物（`PROBLEM_ANALYSIS.md` / `MODELING_REPORT.md` / `RESULTS.md` / `paper/main.md` …）
可直接与参考工作区 `C:\Users\35702\Desktop\CUMCM\workspaces\5ba6e7bd5010\` 逐份 diff。

### 3.5 台账里剩下的 3 项 `missing`

见 `stages/adaptation.ts` 的 `missingAdaptations()`（测试断言了数量，改动要同步）。

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
# 全量套件（约 45s，2021 通过 / 3 待办）
npx vitest run packages/paper apps/paper-shell

# 只跑本轮新增的架构测试
npx vitest run packages/paper/paper-foundation/tests/architecture

# 类型检查（改完必跑）
npx tsc -b tsconfig.host.json

# 真实运行前必须重建（否则 CODE-STALE 会拒绝启动）
npm run build:lib:host

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
  gates.ts           16 条门禁（0/1/2）+ 10 条显式未实现
  briefing.ts        七节阶段简报（技能适配层）
  adaptation.ts      适配台账（八类资产 × 五种方式，missing 必须写 option）
  skill-docs.ts      规则语料索引（20 份）
  tools.ts           ToolSpec + read_skill_doc
  docx-profile.ts    国赛样式档解析 + 导出前校核
  assets.ts          图模板与导出引擎的清单
  runner.ts          阶段执行器（provider 无关）
  skill-docs/        20 份语料（809KB，原样迁移）
  assets/            docx-profiles/（样式档+封面档）、diagram-templates/（5+1）、docx-engine/（5）

tests/architecture/
  chain-split-prototype.spec.ts   S0
  interchange.spec.ts             S1a
  stage-registry-handoff.spec.ts  S1b
  gates.spec.ts                   S2
  stage-briefing.spec.ts          S3
  adaptation.spec.ts              S3（台账）
  skill-docs.spec.ts              S4a
  tools.spec.ts                   S4b
  docx-profile.spec.ts            S4c
  stage-assets.spec.ts            S4d
  stage-runner.spec.ts            S5a（**含 3 条 it.skip，是 §3.1 的判据**）
```

**报告**：`artifacts/upper-bound/ROUND-5-REPORT.md`（自检工具）、`ROUND-6-REPORT.md`（按审计修复）、
`FORMAT-AUDIT.md`（格式飘移定位）、`2024B-hot-1/CHECKPOINT-*.md`（热重启四份检查点报告）。
