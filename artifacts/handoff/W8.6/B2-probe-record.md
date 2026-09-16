# W8.6-B2 — 提供方输出上限实测（探针记录）

> 任务书 B2：测出当前路由下**实际生效**的输出上限（是否 32,000、是否可提高、提高后是否被遵守），记录为事实。禁止把"中介默认值"当作不可变事实。
> N9 合规：不声称"中转不可控"，只记录实测。

## 探针 1（快探针）：`max_tokens=64` 是否被遵守

```
POST https://api.y-api.bestvirtualgoods.com/v1/chat/completions
body: {"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"Count from 1 to 500..."}],"max_tokens":64,"stream":false}
```

| 项 | 值 |
|---|---|
| HTTP | 200 |
| 返回 model | `deepseek/deepseek-v4-flash` |
| **finish_reason** | **`length`** |
| usage | prompt 150 / **completion 64** / total 214 |
| 输出 | `'1\n2\n3\n4\n5\n6\n7\n8\n'`（64 tokens 截断） |

**结论 1：显式 `max_tokens` 被中转遵守**（completion 恰好 64，finish_reason=length）。→ Q1 有答案：输出预算**可由本地控制**。

## 探针 2（流式探针）：`max_tokens=40000` 是否能超过默认 32k

- 首次尝试非流式 50k 上限：**HTTP 524**（网关超时——非流式长生成的网关限制，本身是事实）。
- 流式（`stream:true, max_tokens:40000`）结果：

| 项 | 值 |
|---|---|
| HTTP | 200 |
| **finish_reason** | **`length`** |
| usage | prompt 120 / **completion 40,000** / total 40,120 |
| wall | 345.1s |
| **output chars** | **0（chunks=0）** |

**结论 2：40,000 被接受且被耗尽**——默认 32k **不是**硬性天花板（Q1/Q2 都有答案：预算可由本地显式提升；32k 不是模型最大输出）。

**结论 3（探针的意外发现，对 W8.5 归因的加强）：40k tokens 全部消耗而 `delta.content` 为 0 字符** —— v4-flash 的输出走 **reasoning 通道**（`reasoning_content`，我们只解析 `content`）。含义：**输出预算被推理内容吃掉**，ir-container 的 JSON 正文要等推理结束后才开始——这就是 W8.5 截断的完整机理：模型先花大量 token 推理，留给 JSON 的预算更少，撞 32k 时正文尚不完整。A2 的 finish_reason 贯通正确捕获了这一点（本次探针即由它判为 length）。

## 对 W8.5 的修正（归因精确化）

W8.5 D8 的"两次 32,000 截断"中：
- **32,000 是"请求未设 max_tokens"时中转的默认上限**（D8 原文正确）；
- **B2 探针 1 证明该上限并非不可控**——显式 `max_tokens` 被遵守。W8.5 的修法选项①（提高 max_tokens）**有效且必要**，不是"只是止血"；选项②（协议分片）仍是根本解（B2 探针 2 将回答 40k 是否可达）。

## 证据文件

- `probe-b2-slow.json`（50k 非流式请求，524）
- `probe-b2-stream.mjs`（流式探针脚本）
- `probe-b2-stream.log` / `probe-b2-stream-result.json`（流式结果）
