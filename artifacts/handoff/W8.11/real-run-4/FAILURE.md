# real-run-4 失败归档（W8.11-D2）

> 原样归档：本文引用的所有原始文本逐字来自磁盘；磁盘上没有的写「未留存」。

| 项 | 值 |
|---|---|
| runId | `f16b868d-4a67-4dcc-be37-86e2d30d1dc8` |
| status / code / classifier | BLOCKED / gate-failed / truncated |
| minted_ir_count | 3 |
| usage | in 11909 / out 39360 |
| wall | 548.5 s |
| gate | （未留存 gate_failed 事件） |
| gate reason | — |

## 终态失败（逐字）
未留存

## 被拒容器（逐字摘录，若有）
本次未留存被拒容器摘录

## 最后一次尝试的 fidelity findings（逐字）
- [FAIL] B4 逐问推理覆盖：E1 缺少 1 个要求的推理段：R-OUT
- [PASS] B5 锚点 id 形态（E1 侧）：全部 6 个锚点 id 都是可用名字
- [PASS] B3 反向（E1 假设须被声明）：E1 的 6 条假设锚点均有对应 AssumptionSpec
- [PASS] B3 锚点同一性（声明须在 E1 中有同名锚点）：6 条假设声明在 E1 中均有同名锚点
- [FAIL] B3 正向（声明须逐字锚定 E1）：E-PART-INSPECT-COMPARE: 未声明 e1_span；E-PRODUCT-INSPECT-COMPARE: 未声明 e1_span；E-EXPECTED-COST: 未声明 e1_span；E-POSTERIOR-MEAN: 未声明 e1_span；E-POSTERIOR: 未声明 e1_span；E-TYPE1: 未声明 e1_span；E-TYPE2: 未声明 e1_span

## D5 证据（若出现）
- 本轮无 B3 正向失败

## artifact bodies
已落盘（3 个 body，见 artifact-bodies.json）
