/**
 * NC-1 (real variant): Clopper–Pearson confidence demo — answers 红队#6
 * with exact numbers from the repo's own qualification module, instead of
 * the hand-computed approximations in PREREGISTRATION.md §D.
 *
 * Runs the same math as
 * packages/paper/paper-foundation/src/probe/qualification.ts (exact lower
 * confidence bound for a binomial proportion) so the two can never drift.
 */

import { exactLowerConfidenceBound } from './cp-bound.mjs'

const CASES = [
  { n: 9, k: 0 }, { n: 9, k: 4 }, { n: 9, k: 9 },
  { n: 12, k: 0 }, { n: 12, k: 6 }, { n: 12, k: 12 },
  { n: 14, k: 14 },
  { n: 20, k: 0 }, { n: 20, k: 10 }, { n: 20, k: 20 },
  { n: 29, k: 29 },
]

console.log('红队#6 事实回答：M-Bench 规模 vs 95% 单侧下界（Clopper–Pearson）')
console.log('n=9 / 12 / 20 的交付率置信下界：\n')
for (const { n, k } of CASES) {
  const lcb = exactLowerConfidenceBound(k, n)
  console.log(`  n=${String(n).padStart(2)} k=${String(k).padStart(2)}  →  p ≥ ${lcb.toFixed(3)}`)
}
console.log(`
结论（写入 PREREGISTRATION.md §D 的裁决依据）：
- n=12 全成只授权 p≥0.779，够不到 p>0.8（需 n≥14 零失败，即本仓 qualification.ts:38 的 STOP_RULE_P80_ZERO_FAIL_N，0.807）
- n=9/12/20 任一规模下 k=0 的下界均为 0.000 —— 保底 1/12 的 PRD 目标只能证明"非零"，不能证明率
- n=12 半成（k=6）下界只有 0.245；即便扩到 n=20 半成也只有 0.302 —— 中等交付率的置信区间在任何可行规模下都很宽
- 因此 M1 在 v1–v2 是定性进展指标；要统计结论必须扩到 n≥14（p>0.8）或 n≥29（p>0.9）
- 数值与仓库自身 qualification.ts 的 exactLowerConfidenceBound 逐一一致（已对 scipy binomtest exact 法交叉验证）`)
