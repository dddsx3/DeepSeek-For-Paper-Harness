# W8.8 V1 首跑归档（A1 冒烟 + 首次真实运行，含失败）

> 运行基线：`d09720c1e3`（W8.7）。路由：OpenRouter `stealth/union-alpha`（用户提供）。
> 纪律：沿用 W8.5-D8——**失败结果原样归档**，不隐藏。

## 1. A1 冒烟（成功）

| 项 | 值 |
|---|---|
| endpoint | `https://openrouter.ai/api/v1`（Chat Completions 格式） |
| HTTP | **200**，3.45s |
| 实际服务模型 | `stealth/union-alpha`（provider: Stealth） |
| max_tokens 遵守 | ✅（16 → finish=length, completion=16） |
| reasoning_tokens | 0（**非推理通道模型**；思考写入 content 正文） |
| cost | 0（免费 stealth 模型） |

**相对 y-api 的显著提升**：3.4s vs 64s（单次冒烟）。

## 2. V1 首跑（BLOCKED）

| 项 | 值 |
|---|---|
| 命令 | `run bench/problems/2024-B/problem.pdf --mode strict --fail-soft --out bench/results/2024-B-real` |
| 时间 | 2026-09-17 05:21:11Z 启动 |
| runId | `a2fb2466-5dea-4742-a3a4-4413c797bb51` |
| 终态 | **BLOCKED**（execute 3 attempts 耗尽） |
| usage | **1,471 in / 632 out**（仅 1 条记录——见 §4 缺陷二） |
| 路由标记 | `[ROUTE-MISMATCH] F4 ≠ F3+F4`（C2 字段生效） |
| 失败链 | `provider_retry{FINISH_REASON_UNKNOWN} ×2` → `gate_failed` |

## 3. 根因分析（读取 audit + 探针对比）

**探针（短 prompt）**：OpenRouter 流**会发** finish_reason（`stop`）——`or-sse-raw.txt` 逐行解析确认。
**V1（长 prompt）**：流**未发** finish chunk 即结束 → W8.6-A2 的"缺失 = unknown"分支触发 → 归类 NONE → 重试两次同样结果。

初判：**上游在长生成中途中断流**（结合 429 证据：随后探针全部返回 `temporarily rate-limited upstream`）。**真实失败原因是上游限流/中断，但被记成了 `FINISH_REASON_UNKNOWN`（假红变体）**——provider 层的 in-band error 被静默跳过。

## 4. 本次暴露的两个真实缺陷（已修，随本批提交）

| # | 缺陷 | 证据 | 修复 |
|---|---|---|---|
| 一 | **in-band error 被静默跳过**：OpenRouter 限流时会发 `{"error":{...}}` 数据行然后断流；解析器只跳过无法解析的行 → 真实原因（"temporarily rate-limited upstream"）丢失，只剩误导性的 UNKNOWN | `or-sse-raw.txt` vs V1 audit 的对比 | `real-provider.ts`：捕获 in-band error，优先级 error > length > stop > unknown；错误信息含真实 message 与 code |
| 二 | **失败调用的 usage 丢失**：3 次 EXECUTE 调用被计费，但只有 1 条 usage 入账（call() 抛错时丢弃 assembler.usage）——**P4 的 token 预算门看不见最昂贵的失败** | V1 usage 仅 632 out（应为 ~3 次之和） | `ModelCallFailure` 携带 usage；runNode catch 在分类前 `recordUsage` |

## 5. 下一步

1. 等上游限流解除（免费 stealth 模型有明确 rate limit），**重跑 V1**。
2. 若限流持续：记录为阻塞事实，建议用户确认该模型的使用限额或换模型。
3. 重跑后按 §3.3 收口清单执行 V2–V5。

---

## 6. 构建陷阱（W8.8 最重要发现，解释前两次运行的失败链）

**事实**：`apps/paper-shell` 通过 `@deepseek-ai/dsh-paper-foundation` 加载的是
**`lib/index.js`（tsdown 打包产物）**，而 `tsc -b tsconfig.host.json` **只产 .d.ts，不更新 JS 打包物**。

**后果**：W8.6/W8.7 的 executor 全部修复（截断类 / 熔断 / token 预算门 / 分片协议）
**只存在于 src**——CLI 的 vitest 直读 src（测试全绿），但**真实运行经 lib**（旧 executor）。
V1 两次运行因此是"半新半旧"：
- `real-provider.ts`（CLI 直读 src）→ 新的 finish_reason 解析（缺失→FINISH_REASON_UNKNOWN）
- executor（lib 旧版）→ 没有截断类/熔断/预算门，把 error finish 当可重试 NONE → 重试 3 次

这解释了 V1 的误导失败链。**修复**：重建 lib（`tsdown --env.DSH_BUILD_FACE host`），
并把"改 executor 后必须重建 lib 才能真实运行"写入交付纪律。


---

## 7. 决定性证据（run#4 raw SSE 逐字节）

**第一次 EXECUTE 调用**（原始 SSE 完整保留于 `raw-sse-run4-execute.txt`）：
- **流是完整的**：`finish_reason=stop` 到达，usage 603 tokens。
- **但内容是中文分析计划**（"1. **审题与方法适配**…题目核心是抽样检验与离散决策，F4 不适合作为主模型：问题1采用 F3，问题2—3采用 F2…"）——**模型没有输出 ir-container-v1 JSON**。
- 分类为 NONE(parse_failed) **正确**：这不是截断，是模型选择了"先做计划"。

**第 2/3 次调用**：`finishReason=null inBandError=null` 且 **raw 为空**——**空流**（HTTP 200 但无任何 data 行）。这是上游 stealth 模型在本环境下的行为；重试同样空流。

**两个事实，分开记**：
1. **模型读懂了题**：它自己判断"F4 不适合作为主模型"（与 P3 重标的真值方向一致）——问题不在理解，在**遵从**（12 条协议教学 + 契约 banner 之下，模型选择做分析而不是产容器）。
2. **空流是真实的传输层行为**，应成为独立失败类（待修）。

**对 W9 的直接输入**：这恰是 P2 分片协议的用武之地——每片任务小、指令单一。**下一步：重建 lib（含分片代码）→ `--shard-declare` A/B 对照运行**。
