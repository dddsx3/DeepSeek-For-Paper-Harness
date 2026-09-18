/**
 * Negative controls — DPH-PRD-v2 §4.3 (P0-1, W1 hard gate).
 *
 * Each control is a KNOWN operation that must make a specific indicator
 * worse. Running `node bench/negative-controls/run-all.mjs` executes all
 * controls against synthetic fixtures; any control that FAILS to turn its
 * indicator red is itself a failure (the metric is dead, per §4.3).
 *
 * A green run = every control DID degrade its metric = the W1 gate passes.
 */

import { computeProblemMetrics, aggregatePerFamily, recitalOverlap, silentNumericErrors, skeletonPresence, figureUsability, forbiddenBlendedTotal, M4_SECTIONS } from '../metrics/compute-metrics.mjs'

let failures = 0
let passes = 0

function check(name, condition, detail) {
  if (condition) {
    passes += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** A healthy baseline fixture: enough of a paper, numbers all sourced,
 *  no recital, zero manual interventions, priced usage. */
function healthyFixture() {
  const report = {
    status: 'DELIVERED',
    usage: { input_tokens: 1000, output_tokens: 20000, cost_usd: 0.014 },
    figures_from_data: true,
  }
  const meta = { manual_interventions: 0, wall_clock_seconds: 600, resultNumbers: ['0.731', '42.2'] }
  const draft = M4_SECTIONS.map(s => `## ${s}`).join('\n') + '\n结论: mean_thickness is 0.731 m，采样 42.2 秒。图 1 展示时序。'
  const problemText = '问题：测量平均厚度 mean_thickness。给定数据范围 0.731 与时长 42.2。'
  return { report, meta, draft, problemText }
}

/** NC-1 (M1 / blended-total guard): prove the per-family split exists and
 *  that one lucky family cannot hide inside a blended total. */
function nc1() {
  console.log('NC-1: M1 分层与禁汇总（红队 S-2 虚高攻击）')
  const base = healthyFixture()
  // Two families: F1 has a readable draft, F3 has only blocked runs.
  const f1Record = computeProblemMetrics('A', 'F1', base.report, base.draft, base.problemText, base.meta)
  const f3Record = computeProblemMetrics('B', 'F3', { status: 'BLOCKED' }, '', base.problemText, { ...base.meta })
  const perFamily = aggregatePerFamily([f1Record, f3Record])
  check('F1 族报告 clean_readable=1', perFamily.F1.clean_readable === 1, JSON.stringify(perFamily.F1))
  check('F3 族报告 blocked=1（不被 F1 平均掉）', perFamily.F3.blocked === 1, JSON.stringify(perFamily.F3))
  const blended = forbiddenBlendedTotal([f1Record, f3Record])
  check('混合总成功率会虚高（0.5 > 族内真相）', blended === 0.5, `blended=${blended} — 这正是被禁止的报告方式`)
  // MARKED split: a MARKED delivery must never count as CLEAN.
  const marked = computeProblemMetrics('C', 'F1', { status: 'MARKED', usage: {} }, base.draft, base.problemText, base.meta)
  check('MARKED 交付计入 marked 而非 clean', marked.m1_grade_split.marked === true && marked.m1_grade_split.clean === false)
}

/** NC-2 (M1): flip the baseline to BLOCKED — delivery rate must drop. */
function nc2() {
  console.log('NC-2: M1 把 T3 设为默认路径（复述题面必降）')
  const base = healthyFixture()
  const good = computeProblemMetrics('A', 'F1', base.report, base.draft, base.problemText, base.meta)
  // T3 default in practice produces template recital: replace the draft
  // with problem statement text (what REAL-RUN-2024A R1 actually produced
  // before its final empty delivery) and mark it delivered.
  const recitalDraft = base.problemText + '\n' + base.problemText
  const recital = computeProblemMetrics('B', 'F1', { status: 'DELIVERED', usage: {} }, recitalDraft, base.problemText, base.meta)
  check('正常稿 m1_readable_draft=true', good.m1_readable_draft === true)
  check('复述稿 m1_readable_draft=false（n-gram 命中禁线）', recital.m1_readable_draft === false, `overlap=${recital.m2_recital_overlap}`)
}

/** NC-3 (M2): inject an unsourced number into the conclusion — silent
 *  errors must go up and the problem must flip M1 to negative. */
function nc3() {
  console.log('NC-3: M2 关闭 numeric_consistency 门（静默数字错误必升）')
  const base = healthyFixture()
  const clean = computeProblemMetrics('A', 'F1', base.report, base.draft, base.problemText, base.meta)
  const poisonedDraft = base.draft.replace('结论:', '结论: 最优螺距为 551.7 mm，')
  const poisoned = computeProblemMetrics('B', 'F1', base.report, poisonedDraft, base.problemText, base.meta)
  check('注入前 m2_silent_errors=0', clean.m2_silent_errors === 0)
  check('注入后 m2_silent_errors>0 且 M1 翻负', poisoned.m2_silent_errors > 0 && poisoned.m1_readable_draft === false, `errors=${poisoned.m2_silent_errors}`)
}

/** NC-4 (M3a): add a manual intervention — zero-manual rate must flip. */
function nc4() {
  console.log('NC-4: M3a 请求级 deadline 缺失（人工介入必降）')
  const base = healthyFixture()
  const noIntervention = computeProblemMetrics('A', 'F1', base.report, base.draft, base.problemText, base.meta)
  const withIntervention = computeProblemMetrics('B', 'F1', base.report, base.draft, base.problemText, { ...base.meta, manual_interventions: 1 })
  check('无人介入 m3a_zero_manual=true', noIntervention.m3a_zero_manual === true)
  check('一次人工判断即 m3a_zero_manual=false', withIntervention.m3a_zero_manual === false)
  // M3c: unpriced run must print null, never a fake $0.
  const unpriced = computeProblemMetrics('C', 'F1', { status: 'DELIVERED', usage: { input_tokens: 5, output_tokens: 6, cost_usd: 0 } }, base.draft, base.problemText, base.meta)
  check('无计价配置 → m3c_cost_usd=null（禁止假 $0）', unpriced.m3c_cost_usd === null && unpriced.m3c_pricing_configured === false)
}

/** NC-5 (M4): drop the skeleton layer — completeness must collapse. */
function nc5() {
  console.log('NC-5: M4 移除骨架层（完整率必降）')
  const base = healthyFixture()
  const full = computeProblemMetrics('A', 'F1', base.report, base.draft, base.problemText, base.meta)
  const noSkeleton = computeProblemMetrics('B', 'F1', base.report, '结论: 0.731 m', base.problemText, base.meta)
  check('全章节 m4_skeleton_ratio=1', full.m4_skeleton_ratio === 1)
  check('无骨架 m4_skeleton_ratio<1 且 M1 翻负', noSkeleton.m4_skeleton_ratio < 1 && noSkeleton.m1_readable_draft === false, `ratio=${noSkeleton.m4_skeleton_ratio}`)
}

/** NC-6 (M5): keep the DataArtifact refusal — figure usability stays 0. */
function nc6() {
  console.log('NC-6: M5 保留 DataArtifact 拒绝（图表可用率必为 0）')
  const base = healthyFixture()
  const usable = computeProblemMetrics('A', 'F1', { ...base.report, figures_from_data: true }, base.draft, base.problemText, base.meta)
  // Current renderer.ts:83-88 behavior: figure with data_ref refused,
  // so report.figures_from_data can never be true today.
  const refused = computeProblemMetrics('B', 'F1', { ...base.report, figures_from_data: false }, base.draft, base.problemText, base.meta)
  check('数据图接线时 m5_figure_usable=true', usable.m5_figure_usable === true)
  check('维持拒绝时 m5_figure_usable=false（负对照：当前真实现状）', refused.m5_figure_usable === false)
}

/** NC-7 (integrity): mutate one bench file byte — manifest check must go red. */
async function nc7() {
  console.log('NC-7: 反作弊——篡改 bench 题面（完整性校验必红）')
  const { verifyManifestIntegrity, sha256File, benchRoot } = await import('../metrics/compute-metrics.mjs')
  const { readFile, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const good = await verifyManifestIntegrity()
  check('未篡改时 integrity ok', good.ok === true, `failures=${good.failures.length}`)

  // 真篡改：改 manifest 里某个文件的一个字节，校验必须变红，然后**总是**还原。
  // W8.11-E2 修掉的三处：① `actual !== '0'.repeat(64)` 恒真（没测任何东西）；
  // ② 断言的是手写对象字面量（根本没调校验器）；③ 硬编码本机绝对路径
  // （换 checkout 会 ENOENT，脚本崩溃在打印结果之前）。
  const target = 'problems/2024-B/problem.pdf'
  const full = join(benchRoot, target)
  const before = await readFile(full)
  const beforeHash = await sha256File(full)
  try {
    const mid = Math.floor(before.length / 2)
    const mutated = Buffer.from(before)
    mutated[mid] = mutated[mid] === 0x20 ? 0x21 : 0x20
    await writeFile(full, mutated)
    const afterHash = await sha256File(full)
    check('篡改后哈希确实改变（哈希函数是活的）', afterHash !== beforeHash)
    const bad = await verifyManifestIntegrity()
    check('篡改后校验器报告 ok=false', bad.ok === false, `failures=${bad.failures.length}`)
    check('篡改后 failures 点名该文件', bad.failures.some(f => f.file === target))
    const rec = bad.failures.find(f => f.file === target)
    check('失败记录含 expected 与 actual（可定位）',
      typeof rec?.expected === 'string' && typeof rec?.actual === 'string' && rec.expected !== rec.actual)
  } finally {
    await writeFile(full, before) // ALWAYS restore — the corpus is frozen
  }
  const restored = await verifyManifestIntegrity()
  check('还原后 integrity 恢复 ok', restored.ok === true, `failures=${restored.failures.length}`)
  check('还原后哈希与原始逐字节相同', (await sha256File(full)) === beforeHash)
}

console.log('M-Bench 负对照（W1 硬门禁）——每个控制必须把指标变红：\n')
nc1()
nc2()
nc3()
nc4()
nc5()
nc6()
await nc7()
console.log(`\n${passes} passed, ${failures} failed`)
if (failures > 0) process.exitCode = 1
