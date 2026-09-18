# real-run-3 失败归档（W8.11-D2）

> 原样归档：本文引用的所有原始文本逐字来自磁盘；磁盘上没有的写「未留存」。

| 项 | 值 |
|---|---|
| runId | `31175241-f959-43e9-873f-0dc880e963b7` |
| status / code / classifier | BLOCKED / gate-failed / none |
| minted_ir_count | 32 |
| usage | in 11804 / out 22376 |
| wall | 436.3 s |
| gate | ir_producer |
| gate reason | "DRIFT guidance budget exhausted" |

## 终态失败（逐字）
```text
DRIFT guidance budget exhausted
```

## 被拒容器（逐字摘录，若有）
- attempt 3 `store_refused`: "entry 'AssumptionSpec' could not be admitted: reference_kind_mismatch: 'S-P1' resolves to SymbolSpec, expected Result,DataArtifact (append-only store; a duplicate id is a conflict, not an update)"

## 最后一次尝试的 fidelity findings（逐字）
- [PASS] B4 逐问推理覆盖：全部 1 个 REQUIRED_OUTPUT 在 E1 中有推理锚点
- [PASS] B5 锚点 id 形态（E1 侧）：全部 9 个锚点 id 都是可用名字
- [PASS] B3 反向（E1 假设须被声明）：E1 的 8 条假设锚点均有对应 AssumptionSpec
- [PASS] B3 锚点同一性（声明须在 E1 中有同名锚点）：6 条假设声明在 E1 中均有同名锚点
- [PASS] B3 正向（声明须逐字锚定 E1）：14 条 Assumption/Equation 声明全部逐字锚定 E1

## D5 证据（若出现）
- 相似度 96.4%，首分歧 @14，span「注的最差情况为p1=20%(即标」vs E1「注的最差情况为p₁=20%(即标」
- 相似度 96.0%，首分歧 @17，span「(X≥k|p=p0)≤0.05}」vs E1「(X≥k|p=p₀)≤0.05}」
- 相似度 96.2%，首分歧 @18，span「(X≤k|p=p1)≤0.10}」vs E1「(X≤k|p=p₁)≤0.10}」
- 相似度 96.4%，首分歧 @14，span「注的最差情况为p1=20%(即标」vs E1「注的最差情况为p₁=20%(即标」
- 相似度 96.0%，首分歧 @17，span「(X≥k|p=p0)≤0.05}」vs E1「(X≥k|p=p₀)≤0.05}」
- 相似度 96.2%，首分歧 @18，span「(X≤k|p=p1)≤0.10}」vs E1「(X≤k|p=p₁)≤0.10}」

## artifact bodies
已落盘（4 个 body，见 artifact-bodies.json）
