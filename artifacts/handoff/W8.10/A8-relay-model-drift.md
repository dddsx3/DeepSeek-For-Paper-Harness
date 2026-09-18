# A8 / O-L4-02 —— 中转模型清单漂移（实测，2026-09-18）

## 事实

`PAPER_PROBE_MODEL` 配置值 `z-ai/glm-5.3-flash` 在 `y-api-paid` 组下**已无可用通道**：

```
HTTP 503 {"error":{"code":"model_not_found",
  "message":"No available channel for model z-ai/glm-5.3-flash under group y-api-paid (distributor)"}}
```

该模型在 W8.9（2026-09-17）时可用（D1 驱动与三次真实运行都跑在它上面）。
**漂移发生在 W8.9 与 W8.10 之间。**

## 实测可用清单（7 个模型，各 1-token 流式调用）

| 模型 | 结果 | 延迟 |
|---|---|---|
| `deepseek/deepseek-v4-flash` | ✅ HTTP 200 | 1025 ms |
| `deepseek/deepseek-v4-pro` | ✅ HTTP 200 | 2906 ms |
| `moonshotai/kimi-k3` | ✅ HTTP 200 | 1141 ms |
| `tencent/hy3` | ✅ HTTP 200 | 1335 ms |
| `xiaomi/mimo-v2.5` | ✅ HTTP 200 | 15499 ms |
| `z-ai/glm-5.2` | ✅ HTTP 200 | 2466 ms |
| `qwen/qwen3.8-flash` | ❌ HTTP 524（源站超时 125 s） | — |

## 旧记录更正（O-L4-02 / ISSUES-AND-ROOT-CAUSES §X2）

旧记录称"v4-flash 被映射至 hy3"。**实测证伪**：`deepseek/deepseek-v4-flash`
独立可用（1.0 s，HTTP 200），且 `tencent/hy3` 也独立存在（1.3 s）——两者是
**不同的模型条目**，不存在映射关系。（W8.6 冒烟已得出同样结论；本次复测确认。）

## 本轮的直接后果（**须记账**）

任务书 §6.3 逐字："**"让 DeepSeek 建出来的一定不能坏"的目标模型，至今未进入
任何一轮验证。**"

**这个缺口现在可关**：`deepseek/deepseek-v4-flash` 在中转上可用。D 组的真实运行
可以（也应当）跑在**目标模型**上，而不是继续用第三方 stealth 模型。

—— 这条改写了 D 组的含义：从"跑一次看能不能交付"变成"**在目标模型上**跑一次
看能不能交付"。若目标模型通过，§6.3 的缺口关闭；若失败，则失败本身是目标模型的
真实能力信号（而不是另一个第三方模型的信号）。
