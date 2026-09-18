# W8.10-B4 —— `reasoning_effort` 角色区分探针（只读探测）

> **本轮不改任何默认值（红线 N14）。** 生产适配器 `reasoningEffort()` 仍然对
> 所有调用返回 `'none'`。本文只报告实测结果与建议。

## 结论（放最前）

**问题**：同一个 E1 prompt，在 `reasoning_effort=none` 与 `default`（不限）下，
产出质量有差别吗？

**答：不是"有差别"，是"不限就没有产出"。** 两次独立运行中，不限 reasoning 的
E1 调用都**把全部输出预算烧在推理通道上，`content` 返回空串**——即使把预算提到
中转的硬上限 65536 tokens，仍然一个字符的正文都没有：

| 运行 | `reasoning_effort=none` | `default`（不限） |
|---|---|---|
| 第 1 次 | content **10350** 字符，11 条假设锚点，4 条要求锚点 | content **0** 字符；24000 tokens 全部耗在 reasoning |
| 第 2 次 | content **8806** 字符，18 条假设锚点，1 条要求锚点 | content **0** 字符；24000 tokens 全耗推理；**提到 65536 上限仍是 0 字符**（推理 211610 字符） |

**是否应改为按调用角色区分 reasoning_effort？——不建议以"放开 E1 的推理"为方向，
但建议把该决策从适配器级上移为显式角色级。**

具体建议（**本轮不改**）：

1. **不要让 E1 走 `default`。** 数据是单向的：在 `deepseek/deepseek-v4-flash` +
   本中综上，E1 放开推理 = 零产出，不是"质量更高的产出"。W8.9-D1 对 E2 的结论
   （不限则 reasoning 吃掉全部预算返回空 content）**在 E1 上同样成立**，而且更严重
   ——E1 的 prompt 只有 7747 字符（比 E2 的 5574 字符长不了多少），却能把 65536
   tokens 全部吃掉。所以"E1 被压制推理会损害质量源头"这个担忧，**方向是反的**：
   压制 E1 的推理恰恰是 E1 能产出正文的前提。
2. **值得改的是"角色区分"这件事本身，而不是它的取值。** 当前 `reasoningEffort()`
   读一个进程级环境变量，E1/E2/plan 三个调用一视同仁。本次探测显示 E1 与 E2 对
   推理通道的敏感度**同向且同级**（都不限即空），因此"按角色区分"在**当前证据下
   没有收益**；但它有**结构性价值**：一旦将来换到推理不会失控的模型，或需要给
   reviewer/editor 这类窄任务单独调参，角色级开关是唯一能表达该意图的位置。
   建议记为**待触发项**，触发条件：目标模型更换，或 E1 在 `none` 下出现"推理不足"
   的实证（本次未出现，见下）。
3. **`none` 不是没有代价——它有真实的质量方差。** 两次 `none` 运行的假设锚点数
   是 11 与 18，正文长度 10350 与 8806，要求锚点 4 与 1。B4 逐问覆盖两次都通过
   （都有 `[[REQUIREMENT: R-OUT]]`），但**锚点密度差异近 2 倍**。这个方差是
   `temperature=0.2` 下的模型固有随机性，与 `reasoning_effort` 无关（两次都设了
   `none`）。若要压方差，该动的是 temperature 或采样次数，**不是**放开推理。

---

## 两次产出的对比表

两次运行各自包含 A（`none`）/ B（不限）两个 arm。B 在两次运行中都因预算耗尽
返回空 content，故对 B 追加一次"中转上限"重跑（B2，`max_tokens=65536`）。

| arm | HTTP | finish | content 字符 | 假设锚点 | 要求锚点 | 逐问覆盖 | 占位符回抄 | completion tokens | reasoning 字符 | 耗时 |
|---|---|---|---|---|---|---|---|---|---|---|
| **第 1 次 · A `reasoning_effort=none`** | 200 | stop | **10350** | **11** | **4** | **1/1 覆盖** | no | 6761 | 0 | 61 s |
| 第 1 次 · B `default` | 200 | length | **0** | 0 | 0 | 0/1（缺 R-OUT） | no | 24000 | 95815 | 387 s |
| 第 1 次 · B2 上限重跑 | 400 | – | 0 | 0 | 0 | 0/1 | no | 0 | 0 | 1.6 s（中转拒绝：`max_tokens` 上限 65536） |
| **第 2 次 · A `reasoning_effort=none`** | 200 | stop | **8806** | **18** | **1** | **1/1 覆盖** | no | 5890 | 0 | 310 s |
| 第 2 次 · B `default` | 200 | length | **0** | 0 | 0 | 0/1（缺 R-OUT） | no | 24000 | 88481 | 355 s |
| **第 2 次 · B2 上限重跑（65536）** | 200 | length | **0** | 0 | 0 | 0/1（缺 R-OUT） | no | **65536** | **211610** | 527 s |

三个对比维度的读法：

1. **长度**：`none` = 8806–10350 字符；`default` = **0**。不是"更长/更短"，是"有没有"。
2. **`[[ASSUMPTION]]` 锚点数**：`none` = 11 / 18（两次同一 arm，差异来自采样随机性）；
   `default` = 0（因为正文为空，锚点无从谈起）。
3. **逐问覆盖数**：`none` 两次都 **1/1**（`[[REQUIREMENT: R-OUT]]` 存在，B4 通过）；
   `default` 两次都 **0/1**（缺 R-OUT，B4 必然失败）。

> 注：B2 的 65536 是**中转的硬上限**，不是我们选的值。第 1 次的 B2 之所以是 HTTP 400，
> 是因为探针当时按 96000 申请；探针已据此改为钳到 65536，第 2 次因此拿到了真实的
> "上限处仍为空"证据。这个 400 本身也是一条可用事实：`max_tokens` 上限 = 65536。

### `default` 的推理通道在做什么（不是"想得更久"，是"出不来"）

第 2 次 B2 的 211610 字符推理里，`Let me reconsider` 出现 **94** 次、`Hold on` **25**
次、`hmm` **430** 次。推理轨迹在"不检测零配件但拆解 → 次品件无限回流 → 期望成本发散"
这一处反复自我确认，**从未收敛到写正文**：

> "Hmm, but wait, let me reconsider ONE more time. … OK. Confirmed."
> "Hmm, but actually, hold on. Let me reconsider whether this is the intended modeling."

也就是说：不限 reasoning 时，E1 并不是"想得更深然后写出更好的分析"，而是**卡在
自我质询循环里，正文永远不开始**。E1 的产出预算全部被推理通道占用（`finish_reason=length`）。

---

## 探针怎么做的（可复现）

- **探针**：`artifacts/handoff/W8.10/probe-b4-e1-reasoning.mts`
- **跑法**：`./node_modules/.bin/tsx artifacts/handoff/W8.10/probe-b4-e1-reasoning.mts`
  （需仓库根 `.env.local`；`tsx` 而非 `node --experimental-strip-types`——后者无法解析
  `executor.ts` 的 TypeScript parameter property，报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`）
- **模型**：`deepseek/deepseek-v4-flash`（目标模型）。探针内先做一次可用性预检，
  预检失败即中止，不做无意义的对比。**`.env.local` 的 `PAPER_PROBE_MODEL` 已过期**：
  它写着 `z-ai/glm-5.3-flash`，但本次 `/models` 列表里该模型仍在且实测 HTTP 200 可用
  （与任务书给的"已下架/503"不符——按实测为准）；探针因此**不读**该变量，改用
  `PAPER_B4_MODEL` 覆盖，默认目标模型。候选模型实测（1-token 调用）：
  `deepseek/deepseek-v4-flash` 200、`deepseek/deepseek-v4.1-flash` 200、
  `z-ai/glm-5.3` 200、`z-ai/glm-5.3-flash` 200。
- **题面**：`bench/problems/2024-B/problem.pdf`，经**仓库自己的** `assembleBundle()`
  （`apps/paper-shell/src/bundle.ts`，pypdf）提取为 1910 字符，**不是**手抄题面。
  路由 `classifyProblem()` 判定 F4（`方法组件：F4×4，F3×3；主族 F4`），
  与 `D0-run-posture.md` 记录一致。
- **E1 prompt（7747 字符）**：与 `executor.ts` 的构造**逐字同构**——
  `renderSections([task, plan, instruction]) + '\n\n' + e1AnalysisInstruction(['R-OUT'])`，
  其中 `task` = `Task: ${taskText}`（题面 + routeBanner + contractBanner）、
  `instruction` = `EXECUTE_PROTOCOL_TEACHING`、要求 id = `R-OUT`
  （`executor.ts:947/975` 注册的保留 id）。`plan` 由真实 plan 节点调用生成一次
  （537/466 字符），**在两个 arm 之间固定不变**，保证 A/B 的唯一差异是 `reasoning_effort`。
  system prompt 也照抄生产适配器（`executor.ts:401` 的 executor 角色）。
- **两个 arm**：A = `reasoning_effort: "none"`（= 生产默认）；B = **不传该字段**。
  其余参数（`temperature: 0.2`、`stream: true`、`max_tokens: 24000`、
  `stream_options.include_usage`）与 `real-provider.ts` 的请求体一致。
- **同一 prompt 的证据**：落盘文件里记录了 E1 prompt 的 sha256 与全文，两个 arm
  共用同一个字符串。

## 原始产出落盘

| 文件 | 内容 |
|---|---|
| `artifacts/handoff/W8.10/probe-b4-e1-reasoning-output.txt` | **第 2 次运行**：E1 prompt 全文 + 三个 arm 的 `reasoning_content` 与 `content` 逐字原文 |
| `artifacts/handoff/W8.10/probe-b4-e1-reasoning-output.run1.txt` | **第 1 次运行**（保留作独立复现；其 B2 因按 96000 申请而 HTTP 400，见上） |
| `artifacts/handoff/W8.10/probe-b4-e1-reasoning.mts` | 探针本体 |

## 失败记录（原样）

本次**两次运行的 A arm 均成功**，结论有真实产出支撑；B arm 的"空 content"是
**探测到的现象**（正是本探针要回答的问题），不是探针故障。以下是过程中真实发生的失败：

1. **第 1 次 B2：HTTP 400** —
   `{"error":{"message":"max_tokens must be an integer between 1 and 65536.","type":"atria_api_error","param":"","code":"invalid_request"}}`
   原因：探针按 96000 申请，超过中转上限。已改为钳到 65536 后重跑。
2. **`node --experimental-strip-types` 不可用** —
   `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode`
   （`executor.ts` 的 `ExecutionFailureError` 构造函数）。改用 `tsx`。
3. **`import` 绝对路径在 Windows 下报错** —
   `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'd:'`。改为相对路径 import。
4. **中转延迟很高**：单次 E1 调用 61 s – 527 s（preflight 单次 89 s），
   探针把调用超时设到 1800 s 以免误判为失败。

## 与 W8.9-D1 的关系（同一机理，E1 侧确认）

W8.9-D1 的结论是"E2 的 5574 字符长 prompt 在不限 reasoning 时返回空 content"。
本次把同一实验做到了 **E1** 上，结论是**同一个**，而且更强：

- E1 的 prompt 只有 **7747** 字符（比 W8.9-D1 测的那个 5574 字符 E2 prompt 只长
  约 39%），却同样能把 **65536** tokens 全烧在推理上；
- 本次 E1 产出（8806 字符）若继续喂给 E2，E2 的 prompt 会膨胀到 **13916** 字符
  （实测：`e2NormalizationPrompt(e1Content, EXECUTE_PROTOCOL_TEACHING)`），
  即真实流水线里 E2 面对的输入比 W8.9-D1 的 fixture 场景**长 2.5 倍**；
- 因此"适配器级压制推理会伤到 E1 这个质量源头"这一担忧，**实测不成立**——
  相反，**压制是 E1 能产出正文的必要条件**。

**归因边界（必须写明）**：本探针只测了 `deepseek/deepseek-v4-flash` 一个模型。
"不限 reasoning → 空 content"是**该模型 × 该中转**的性质，不能外推为所有模型的性质。
若将来更换目标模型，这条结论必须重测——这正是上面建议 2 的触发条件。
