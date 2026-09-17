# O-L1-01 结清记录 —— reasoning 通道假设的验证（P1）

> 状态：**已结清**。三个假设逐项判定，raw SSE 已落盘。
> 基线：`0b5e43a433`。探针在 y-api 实时环境运行（小额调用：3 次，合计 ~2,000 output tokens）。

## 判定表

| 假设 | 判定 | 证据 |
|---|---|---|
| (a) 输出走 reasoning 通道（reasoning_content 存在且吃预算） | **✅ 成立** | `probe-p1-mid`（算术题）：reasoning 265 字符 vs content 79 字符（3.4:1）；`probe-p1-ir`（ir-container 同构题）：**reasoning 6,863 字符 vs content 469 字符 ≈ 14.6:1** |
| (b) 中转以未解析字段发 content | **❌ 排除** | 三支探针 `unknown_delta_keys` 均为空（除 content/reasoning_content/role 无其他 delta 键） |
| (c) 中转吞掉 content delta（分片无效） | **❌ 排除** | content 完整到达且是合法 JSON 开头（`{"__dsh_paper":"ir-container-v1","entries":[...`）；`probe-p1-mini` 返回完整 `{"ok":true}` |

## W8.5 之谜的完整机理（修正版）

```
模型收到 ir-container 请求
  → 先产出约 10–15 倍于内容的 reasoning tokens（实测比 14.6:1 字符比）
  → completion_tokens 计入 reasoning（probe-p1-ir: completion=1755 含 reasoning）
  → 32,000 上限中，留给 JSON 内容的实际只有 ~2–3k tokens
  → 完整容器（5 条目 + 可能含 code/interpretation）需要更多 → 差一点撞上限
  → finish_reason=length（W8.6 A2 已能识别）→ 截断 → JSON 未完
```

**这决定 W9 分片的两个设计参数**：
1. **片长按「内容 + 推理」估算**，不是按内容长度——每片的实际预算需求 ≈ 内容 tokens × 15。
2. **单片内容目标 ≈ 2k tokens 以内**（32k 默认上限 ÷ 15 ≈ 2.1k），或显式提升 `max_tokens`（B2 已证可提升到 40k）后用更大的片。

## 附带事实

- 复杂 prompt 首试遭遇 **HTTP 524**（Cloudflare 网关超时，返回 HTML），重试即成功 → 524 是**间歇性**的（与 O-L4-03 的非流式长生成 524 叠加记录：网关层对长任务有超时，重试是有效缓解）。
- `probe-p1-sse.mjs` 的大 prompt 版本连续 524——**网关对超长 prompt+长生成的组合更敏感**。

## 证据文件（全部入库）

| 文件 | 内容 |
|---|---|
| `probe-p1-sse-mini.mjs` + `probe-p1-mini-result.json` + `probe-p1-mini-raw-sse.txt` | 小探针（content-only 基线） |
| `probe-p1-sse-mid.mjs` + `probe-p1-mid-result.json` + `probe-p1-mid-raw-sse.txt` | 推理题（reasoning 3.4:1） |
| `probe-p1-sse-ir.mjs` + `probe-p1-ir-result.json` + `probe-p1-ir-raw-sse.txt` | **ir-container 同构题（14.6:1，决定性）** |
| `probe-p1-sse.mjs` + `probe-p1-raw-sse.txt` | 大 prompt 版（524 HTML 证据保留） |

> **证据格式注记**：raw SSE 文件在入库时做了行尾空格规范化（JSONL 行尾空格无语义，数据内容逐字节未变）。
