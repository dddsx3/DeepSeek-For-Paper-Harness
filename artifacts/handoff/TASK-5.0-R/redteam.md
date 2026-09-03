# TASK 5.0-R — redteam（每项修复的攻击用例与击杀证明）

## R3-1 redteam15 迁移（7 红清零）的击杀证明

- **守卫**：SymbolSpec token 的 Unicode NFC 约束（`src/ir/problem-contract.ts` symbolTokenSchema `.refine(v => v === v.normalize('NFC'))`）。
- **击杀**：把该 refine 临时改为恒真 → 跑 `redteam15.spec.ts -t RT-D-01`：
  - `× refuses the second, non-NFC spelling at ingest`
  - `× never lets a second spelling of one token enter canonical state`
  - （`✓ still accepts a genuine NFC token` 保持绿 —— 反向不变）
- **还原**：`git checkout` 后 26/26 全绿。证明 RT-D 守卫被测试真实覆盖（不是被静默跳过）。
- 附：RT-A（尺寸预算）击杀尝试 —— 放大 `MAX_IR_VALUE_NODES` 后测试仍绿，因为该载荷同时被 TASK 1.5R 悬空引用拒绝；故改用 RT-D 作为击杀点（守卫唯一性更强）。

## R3-2 stale-engine（4 红清零）的击杀证明

- **守卫**：整个 STALE 直检管线（`src/ir/stale.ts` deriveDirectStale → EXECUTION_MISMATCH / DEPENDENCY_MISMATCH / CODE_MISMATCH + 传递）。
- **击杀**：把 `computeStaleReport` 的 direct 推导临时置空（禁用全部直检）→ 全套 `stale-engine.spec.ts`：**8 failed | 3 passed**（S-001/002/003/004/007 + transitive + gate 集成全红；仅 S-005 fresh / S-008 no-markFresh / S-006 依赖链外用例幸存）。
- **还原**：11/11 全绿。证明 stale 守卫矩阵被测试真实覆盖。
- 单项击杀（更强粒度）：禁用 environment 比较分支后 S-003 断言的敏感性已在代码评审 + 上述整链击杀中覆盖，未单列。

## RG-09 反证（机器禁令自检）

- 把 `gate-report.json` `gates_impl` 中任一 id 的 implementation 改为与 registry 相反 → verifier：`RG-09 DRIFT: gate 'X' registry=… vs gate-report=…` 并 exit 1。
- 还原后 verifier PASS。证明 RG-09 能抓到声称-代码漂移（R4 验收-攻击）。

## 防再犯

- IR 链挂载一律走 `putExecutionRecord(record, CAPTURE_ATTESTATION)`（INV-3-M）；任何新 spec 的 build()/fixtures 均须照此。
- 涉及不可变 store 的"漂移"测试：构造在捕获字段上表达，不做覆盖 put（duplicate_id 拒）。
- evaluateDelivery 的 failure reason 契约 = `${id}:${status}:${reason}`——测试断言以此为准。
- 六门实现前，任何"fast/strict 交付成功"的集成测试都必须迁移 EXPLORATORY run mode，不得重新引入假装六门存在的桩。
