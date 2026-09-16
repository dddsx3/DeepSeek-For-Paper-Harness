# W8.5-D8 — 首次真实运行失败分析（BLOCKED，原样归档）

> runId `1a2b4f86-c315-4f5a-a985-b0f4d764e0ea` | 2026-09-16 13:24:55Z → 13:43:08Z | 1088.7s | T1 strict | deepseek/deepseek-v4-flash

## 失败层级与码

| 项 | 值 |
|---|---|
| 终态 | `BLOCKED`（run status=failed） |
| 失败码 | `gate-failed`（classifier: transport — 人类措辞映射为传输类，见下方观察 3） |
| 失败节点 | execute（`exhausted 3 attempts`） |
| 原始错误 | `EXECUTE output was not a schema-valid ir-container-v1 (BLOCKED)` |
| audit 证据 | `gate_failed {gate: ir_producer, reason: EXECUTE output refused 3 times}` |

## 逐次尝试链（provider_retry 事件）

| # | usage in/out | 失败分类 (W4) | 码 |
|---|---|---|---|
| plan | 1,346 / 913 | — | succeeded |
| execute #1 | 2,995 / **32,000** | **NONE** | `parse_failed` |
| execute #2 | 3,406 / 10,756 | **DRIFT** | `schema_violation` |
| execute #3 | 1,038 / **32,000** | 耗尽（3 attempts） | 未再分类 |

**总用量:8,785 in / 75,669 out**（costUsd=0，pricing 未配置——M3c 契约:输出 null + `pricing_configured:false`）。

## 与 §8 预登记的比对

| # | 预登记 | 是否发生 |
|---|---|---|
| P1 | execute 被拒（schema/引用/逃逸类） | **✅ 发生**（NONE→DRIFT→耗尽，与 T2 历史失败同源） |
| P2 | usage 非零但交付物空 | 部分:usage 非零且无交付物——但原因是 execute 从未产出，不是 fail-fast 未生效 |
| P6 | provider 中途超时 | 未发生（每次请求都返回） |

## 观察（只陈述事实）

1. **两次 32,000 output tokens 上限截断**（attempt #1/#3）——经查 `real-provider.ts:96-110`，**请求体不设 `max_tokens`**，故 32,000 是**中转/模型侧默认输出上限**（非本仓参数）。模型在 ir-container-v1 长协议输出上被该上限截断，截断的输出大概率 `parse_failed`（JSON 不完整）。**这是本轮最重要的事实**：不是"模型不会"，是**输出预算/协议长度不匹配**（且预算不是本地可控参数——需在请求或协议层解决）。
2. **plan 一次成功**（913 out）——模型能读题面（1346 in 含题面+概况+banner）。说明题面/附件摄入链路在真实输入下工作。
3. **失败措辞映射**：`parse_failed/NONE` 经 `blockMessage` 落到"调用/传输失败"，对用户指向"重试一次"——该建议**不准确**（重试不会解决协议不匹配）。记入 L1–L5 诊断改进（P1-5 范围）。
4. **execute 从未产出过任何 artifact**（artifacts table=0）——IR 只含输入侧资产（DA-RAW/R-OUT/P1 三条），无任何模型声明。fail-soft 无从交付（内容不存在=BLOCKED，与 PRD §3.3 的诚实边界一致）。

## 结论（对下轮）

- 该失败**不是**门禁放不放宽的问题——是 EXECUTE 协议在真实模型上的**输出长度**问题（32k 上限截断）。
- 可选修法（留 W9 决策，不在本轮范围）：① 提高 max_tokens；② 把 ir-container-v1 分片声明（先符号/假设，后模型/代码）；③ 压缩协议教学段的长度。
