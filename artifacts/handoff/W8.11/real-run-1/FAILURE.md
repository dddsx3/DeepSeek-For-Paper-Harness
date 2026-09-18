# real-run-1 失败归档（W8.11-D2）

> 原样归档：本文引用的所有原始文本逐字来自磁盘；磁盘上没有的写「未留存」。

| 项 | 值 |
|---|---|
| runId | `39131b73-8244-4056-a761-9eb78abb3cab` |
| status / code / classifier | BLOCKED / gate-failed / transport |
| minted_ir_count | 3 |
| usage | in 30585 / out 37361 |
| wall | 470.5 s |
| gate | ir_producer |
| gate reason | "EXECUTE output refused 3 times" |

## 终态失败（逐字）
```text
EXECUTE output refused 3 times
```

## 被拒容器（逐字摘录，若有）
本次未留存被拒容器摘录

## 最后一次尝试的 fidelity findings（逐字）
- [PASS] B4 逐问推理覆盖：全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点
- [FAIL] B5 锚点 id 形态（E1 侧）：以下锚点 id 不是可用名字（占位符或含空格，下游无法逐字引用）：「...」
- [PASS] B3 反向（E1 假设须被声明）：E1 的 16 条假设锚点均有对应 AssumptionSpec
- [PASS] B3 锚点同一性（声明须在 E1 中有同名锚点）：16 条假设声明在 E1 中均有同名锚点
- [FAIL] B3 正向（声明须逐字锚定 E1）：E-profit: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 84.6%，首分歧 @7，span「每件合格品利润$=s-C$」vs E1「每件合格品利润}=s-C.」〕

## D5 证据（若出现）
- 相似度 84.6%，首分歧 @7，span「每件合格品利润$=s-C$」vs E1「每件合格品利润}=s-C.」

## artifact bodies
已落盘（3 个 body，见 artifact-bodies.json）
