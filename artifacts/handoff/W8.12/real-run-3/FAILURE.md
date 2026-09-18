# real-run-3 归档（W8.12）

| 项 | 值 |
|---|---|
| status / grade | DELIVERED / MARKED |
| minted_ir_count | 54 |
| usage | in 38363 / out 29496 |
| wall | 387 s |
| sha256 | 4bbf19eb487f7d1e958f4fd0d8cd69104d3c6a5f529ffae8b156939d9b89d940 |

## 终态事件
- **DELIVERED**（首次真实交付）：e1_direct_delivery → delivery_graded(MARKED) → final_output_written → promotion_succeeded → workflow_completed

## E1 直通（若触发）
- 触发：{"nodeId":"7355ded6-6565-44f5-93ee-517bd7bfeaee","gate":"ir_producer","reason":"DRIFT guidance budget exhausted","failedRules":["B3 反向（E1 假设须被声明）","B3 正向（声明须逐字锚定 E1）"],"e1_chars":6191,"assumptions":8}

## 评级
- {"grade":"MARKED","mode":"fail-soft","annotations":10,"fatal":{"emptyContent":false,"executionFailed":false,"referenceCatastrophe":false}}

## 最后一次尝试的 fidelity findings
- [PASS] B4 逐问推理覆盖：全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点
- [PASS] B5 锚点 id 形态（E1 侧）：全部 9 个锚点 id 都是可用名字
- [FAIL] B3 反向（E1 假设须被声明）：E1 标记了但 IR 未声明的假设：A-BINOMIAL-APPROX、A-RECURSION-CONVERGENCE、A-BINOMIAL-APPROX、A-RECURSION-CONVERGENCE、A-INDEPENDENT-DEFECTS、A-LINEAR-COST、A-UNLIMITED-DEMAND、A-SINGLE-PERIOD
- [PASS] B3 锚点同一性（声明须在 E1 中有同名锚点）：0 条假设声明在 E1 中均有同名锚点
- [FAIL] B3 正向（声明须逐字锚定 E1）：EQ-REJ-RULE: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 12.2%，首分歧 @5，span「情形(1):要求当$p=p」vs E1「情形(1)**:要求当$p」〕；EQ-ACC-RULE: e1_span 在 E1 中找不到逐字匹配（疑似改写）〔相似度 11.0%，首分歧 @5，span「情形(2):要求当$p=p」vs E1「情形(2)**:要求当$p」〕

## artifact bodies
已落盘（5 个 body）
