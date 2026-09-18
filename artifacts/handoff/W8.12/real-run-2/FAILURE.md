# real-run-2 归档（W8.12）

| 项 | 值 |
|---|---|
| status / grade | BLOCKED / (未交付) |
| minted_ir_count | 3 |
| usage | in 22193 / out 28939 |
| wall | 337.4 s |
| sha256 | — |

## 终态事件
- BLOCKED：DRIFT guidance budget exhausted

## E1 直通（若触发）
- 未触发

## 评级
- 未评级

## 最后一次尝试的 fidelity findings
- [PASS] B4 逐问推理覆盖：全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点
- [PASS] B5 锚点 id 形态（E1 侧）：全部 15 个锚点 id 都是可用名字
- [PASS] B3 反向（E1 假设须被声明）：E1 的 14 条假设锚点均有对应 AssumptionSpec
- [PASS] B3 锚点同一性（声明须在 E1 中有同名锚点）：14 条假设声明在 E1 中均有同名锚点
- [FAIL] B3 正向（声明须逐字锚定 E1）：A-LTPD: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 97.4%，首分歧 @18，span「立的次品率参照p1才能定义"90」vs E1「立的次品率参照p₁才能定义"90」〕；E-REJECT-CRIT: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 19.6%，首分歧 @9，span「形(1)拒收判据:在95%信度下」vs E1「形(1)拒收判据**:在95%信」〕；E-ACCEPT-CRI

## artifact bodies
已落盘（4 个 body）
