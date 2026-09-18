# real-run-1 归档（W8.12）

| 项 | 值 |
|---|---|
| status / grade | BLOCKED / (未交付) |
| minted_ir_count | 3 |
| usage | in 45865 / out 36705 |
| wall | 426.6 s |
| sha256 | — |

## 终态事件
- BLOCKED：ir_canonicalization:BLOCKED:missing IR backbone: ModelSpec,RunArtifact,Result,Claim; no CRITICAL claim in canonical IR; minimum Problem Contract not satisfied (RAW_PROBLEM DataArtifact + REQUIRED_OUTPUT RequirementSpec + SymbolSpec)

## E1 直通（若触发）
- 触发：{"nodeId":"706092b7-313b-4ef1-8b9f-ab41161d004c","gate":"ir_producer","reason":"EXECUTE output refused 3 times","failedRules":["B3 正向（声明须逐字锚定 E1）"],"e1_chars":12041,"assumptions":16}

## 评级
- 未评级

## 最后一次尝试的 fidelity findings
- [PASS] B4 逐问推理覆盖：全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点
- [PASS] B5 锚点 id 形态（E1 侧）：全部 17 个锚点 id 都是可用名字
- [PASS] B3 反向（E1 假设须被声明）：E1 的 16 条假设锚点均有对应 AssumptionSpec
- [PASS] B3 锚点同一性（声明须在 E1 中有同名锚点）：16 条假设声明在 E1 中均有同名锚点
- [FAIL] B3 正向（声明须逐字锚定 E1）：E-N: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 11.8%，首分歧 @0，span「N=\text{」vs E1「定次品率下最小化」〕

## artifact bodies
已落盘（4 个 body）
