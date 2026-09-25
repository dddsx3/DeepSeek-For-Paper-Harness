# CHECKPOINT — 2024B 真实运行实验（11 阶段链，`--stages`）

> **口径 #7**：每阶段写检查点报告（改了什么 / 错误形态 / 根因）。
> **运行**：`bench/problems/2024-B/problem-faithful.md`，deepseek-v4-pro，`--stages --stage-next` 逐阶段人工放行。
> **产物**：`artifacts/upper-bound/2024B-stages-1/stages/`（各阶段目录 + PASSED + `_gate-report.json` + `_rejected-answer.txt`）
> **日期**：2026-09-25

## 1 走到了哪

| 阶段 | 结果 | 证据 |
|---|---|---|
| 1 prob-analysis | ✅ passed（缺口 `capability_check` 如实记账） | ~7 分钟产出 280KB；门禁全过 |
| 2 modeling | ✅ passed（缺口 `modeling_coverage`、`modeling_self_check`） | 同上 |
| 3 code | ✅ 通过过一次（177 results 全标量 / 18 图 / 4 个逐问文件）；后续重跑稳定被 max-tokens 截断 | 见 §3.3 |
| 4 figure | **渲染 18/18 张 SVG**（声明驱动、数全部来自 Result 投影）；门禁拒签，两条都是真问题（见 §3.2） | `04-figure/figures/` |
| 5–11 | 未到（等 3/4 收口） | — |

**结论：架构成立**。声明驱动渲染、门禁、通行证、暂停/续跑、检查人放行/否决——每一环都在真实运行中被验证**真的在干活**，包括"拒绝"的那几环。

## 2 实验暴露并已修复的问题（全部有留档证据）

| # | 错误形态 | 根因 | 修复 |
|---|---|---|---|
| 1 | `The operation was aborted due to timeout`（阶段 1 在 ~5 分钟、阶段 3 在 ~15 分钟被杀） | **墙钟上限误杀慢但健康的生成**：高质量产出时长不可预测 | 无令牌看门狗 `PAPER_IDLE_TIMEOUT_MS`（每收到 chunk 重置，持续 240s 无字节才失败）；连接超时信号**不得**留在响应上（会连流式 body 一起掐断，实测 10s 处被杀） |
| 2 | `terminated`（十几分钟的流被中转掐断） | 阶段链 `callModel` 无重试，一次传输失败整阶段作废 | 传输级重试 3 次（5s/15s/45s）；`max-tokens` **不重试** |
| 3 | 回答 270KB、四个独立围栏块、**没有 JSON 信封** | 映射规则只写在 runner.ts 模块头——**模型看不见** | 简报 `answerFormOf` 显式教回答形态（与解析规则同源，测试钉住） |
| 4 | 信封解析失败（散文里的 `{` 被当起点；信封后拖尾巴） | 单一解析规则扛不住"先推理后产出" | 候选阶梯：整个回答 → 契约锚（最后一个 `"files"`）+ **括号配平** → 首尾大括号；全失败时逐级点名 |
| 5 | `EISDIR ... 03-code\code` | 模型把注册表的 `code/`（dir）当信封键回声 | runner 认出目录回声（前缀下有真文件则忽略，没有则点名）；简报教"目录不单独作键" |
| 6 | `results[0] 的 value 不是有限数`（34/38 是对象值） | 渲染器/IR 只画标量，简报没说 | 简报补"`value` 必须是单个有限数，结构化的量拆成多条" |
| 7 | 阶段 1 清单 `fig_x\|问题1…（折线图）` 18 条全部不识别 | 解析器按整行裸名匹配 | 条目身份取 `\|` 之前；题注不进对账键 |
| 8 | 三张 table 图的**题注进了 SVG** | 标量路径修了、`renderTableSvg` 漏了 | 两条路径一条契约（W9-B4） |
| 9 | 两个图名与计划不符（两次重跑同处） | 编码时合理改进图，靠"求模型守约"不解决 | **`plan_deviations` 申报制**：申报了放行并留痕，静默改名必拒 |

**观测能力是这一切的前提**：`_rejected-answer.txt`（被拒回答留档）与 `_gate-report.json`（门禁逐条结论留档）缺了任何一个，上面 9 条里至少 5 条无法定位根因。

## 3 未收口的问题（下一步）

### 3.1 🔴 阶段 3 的输出体量（max-tokens 截断，2 次 + 收窄契约后仍截断）

- 显式请求 65536 也无效（中转有自己的天花板）；**推理令牌计入输出预算**——该模型每次先产出数百 KB 可见推理。
- 已做：声明 `results` 收窄到"只登记被 `data_refs` 引用的量"。仍不够。
- **建议的解（是一次注册表设计变更，未擅自做）**：把阶段 3 拆成 **3a 代码**（main.py + problem\*.py + RESULTS.md + DELIVERABLES.json）与 **3b 图声明**（FIGURE_DECLARATIONS.json）——与 §4.1"阶段 2 = 两次调用"同一逻辑。另一个值得评估的方向：参考侧的数是**代码写出的** `all_results.json`（模型从不转录数值），把"数从哪来"从模型转录改成 harness 侧执行 + 解析，能同时消掉体量问题与"投影是否如实"的审计缺口。
- 注意 `PAPER_MAX_OUTPUT_TOKENS_PER_RUN` / `PAPER_PROBE_MAX_OUTPUT_TOKENS` 这两个旋钮与推理预算的关系需要一次实测（W8.9-D1 的方法）。

### 3.2 阶段 1 与阶段 3 的图名对齐

`plan_deviations` 已就位；若模型继续既不沿用清单名也不申报，下一步是给阶段 1 的清单加"允许在编码阶段修订"的语义，或把清单的**所有权**移到阶段 3（阶段 1 只写"要回答哪些问题"，图计划由阶段 3 一次性立约）。

### 3.3 待跑

阶段 4 重渲染（对账 + 风格应已过：表格题注已在渲染器侧修掉）→ 阶段 5 架构图（首次吃真实 `ARCH_DECLARATION`）→ 6–11。命令：

```bash
node node_modules/tsx/dist/cli.mjs apps/paper-shell/src/cli.ts run \
  bench/problems/2024-B/problem-faithful.md --mode strict --tier T1 \
  --out artifacts/upper-bound/2024B-stages-1 --stages --stage-next
```

## 4 本轮代码提交（全部已推送）

`181de5c63c`（看门狗/留档/阶梯/回答形态/stage-next）→ `16d5cb6e4b`（目录回声+重试）→ `e77889e8ee`（标量规则）→ `b7c426ac5d`（`--stage-rollback`）→ 清单解析+`_gate-report.json` → `plan_deviations` 机制 → 表格图题注 → 声明收窄。

**token 消耗**：约 12 次模型调用（阶段 1 ×1、阶段 2 ×1、阶段 3 ×~8 次、阶段 4 为确定性零调用），其中阶段 3 的多次重跑是本实验的实验成本——正是"每阶段停"把损失限制在一个阶段之内，而不是整轮返修。
