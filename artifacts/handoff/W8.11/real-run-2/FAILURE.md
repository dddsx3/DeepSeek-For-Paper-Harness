# real-run-2 失败归档（W8.11-D2）

> 原样归档：本文引用的所有原始文本逐字来自磁盘；磁盘上没有的写「未留存」。

| 项 | 值 |
|---|---|
| runId | `af1fb14a-8d70-467b-8d07-af5da6fc0cdc` |
| status / code / classifier | BLOCKED / gate-failed / none |
| minted_ir_count | 3 |
| usage | in 11653 / out 20105 |
| wall | 354 s |
| gate | ir_producer |
| gate reason | "DRIFT guidance budget exhausted" |

## 终态失败（逐字）
```text
DRIFT guidance budget exhausted
```

## 被拒容器（逐字摘录，若有）
- attempt 3 `schema_violation`: "entry 'ModelSpec' violates its closed IR schema — parameter_refs.0: Invalid input: expected object, received string"

## 最后一次尝试的 fidelity findings（逐字）
- [PASS] B4 逐问推理覆盖：全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点
- [PASS] B5 锚点 id 形态（E1 侧）：全部 15 个锚点 id 都是可用名字
- [PASS] B3 反向（E1 假设须被声明）：E1 的 14 条假设锚点均有对应 AssumptionSpec
- [PASS] B3 锚点同一性（声明须在 E1 中有同名锚点）：14 条假设声明在 E1 中均有同名锚点
- [PASS] B3 正向（声明须逐字锚定 E1）：21 条 Assumption/Equation 声明全部逐字锚定 E1

## D5 证据（若出现）
- 相似度 97.7%，首分歧 @33，span「,或成品次品率p3是给定的独立参」vs E1「,或成品次品率p₃是给定的独立参」
- 相似度 97.4%，首分歧 @18，span「k,使得当p=p0时,P(X≥k」vs E1「k,使得当p=p₀时,P(X≥k」
- 相似度 97.1%，首分歧 @19，span「',使得当p=p0时,P(X≤k」vs E1「',使得当p=p₀时,P(X≤k」
- 相似度 13.6%，首分歧 @3，sp","","","","","全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点","全部 15 个锚点 id 都是可用名字","E1 的 14 条假设锚点均有对应 AssumptionSpec","14 条假设声明在 E1 中均有同名锚点","A-ASSEMBLY-INDEPENDENT: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 97.7%，首分歧 @33，span「,或成品次品率p3是给定的独立参」vs E1「,或成品次品率p₃是给定的独立参」
- 相似度 96.3%，首分歧 @6，span「使得当p=p0时,P(X≥k」vs E1「使得当p=p₀时,P(X≥k」
- 相似度 95.2%，首分歧 @6，span「使得当p=p0时,P(X≤k」vs E1「使得当p=p₀时,P(X≤k」

## artifact bodies
已落盘（4 个 body，见 artifact-bodies.json）
