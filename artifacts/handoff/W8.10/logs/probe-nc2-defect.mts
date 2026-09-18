// E3 probe: does NC-2 actually exercise the n-gram (recital) rule it claims?
import { computeProblemMetrics, recitalOverlap, M4_SECTIONS } from '../../../../bench/metrics/compute-metrics.mjs'

const problemText = '问题：测量平均厚度 mean_thickness。给定数据范围 0.731 与时长 42.2。'
const report = { status: 'DELIVERED', usage: { input_tokens: 1000, output_tokens: 20000, cost_usd: 0.014 }, figures_from_data: true }
const meta = { manual_interventions: 0, wall_clock_seconds: 600, resultNumbers: ['0.731', '42.2'] }

const recitalDraft = problemText + '\n' + problemText
console.log('--- NC-2 exactly as run-all.mjs builds it ---')
console.log('recitalOverlap(draft, problem) =', recitalOverlap(recitalDraft, problemText))
const r = computeProblemMetrics('B', 'F1', report, recitalDraft, problemText, meta)
console.log('m1_readable_draft =', r.m1_readable_draft)
console.log('m2_recital_overlap =', r.m2_recital_overlap, '  <-- the n-gram value')
console.log('skeleton missing   =', r.m4_missing_sections.length, '/', M4_SECTIONS.length)
console.log('silent errors      =', r.m2_silent_errors)
console.log('=> M1 false because:',
  [r.m4_missing_sections.length > 0 ? 'skeleton missing' : null,
   r.m2_silent_errors > 0 ? 'silent errors' : null,
   (r.m2_recital_overlap ?? 0) >= 0.30 ? 'recital >= 0.30' : null].filter(Boolean).join(' + ') || '(none)')

// Word count proves the n-gram path is structurally unreachable on this fixture.
console.log('\nwhitespace tokens in problemText =', problemText.split(/\s+/).filter(Boolean).length, '(n-gram n = 8)')

// Now a draft that is LONG enough and IS pure recital, with everything else clean.
console.log('\n--- control: a recital draft long enough to form 8-grams ---')
const longProblem = '问题 重述 如下 本 题 要求 建立 数学 模型 并 求解 最优 参数 取值 使得 总 成本 最小 化 同时 满足 约束 条件 与 精度 要求'
const longDraft = longProblem + '\n' + longProblem + '\n' + M4_SECTIONS.map(s => `## ${s}`).join('\n') + '\n结论: 0.731 42.2'
console.log('recitalOverlap =', recitalOverlap(longDraft, longProblem))
const r2 = computeProblemMetrics('C', 'F1', report, longDraft, longProblem, meta)
console.log('m1_readable_draft =', r2.m1_readable_draft, '| m2_recital_overlap =', r2.m2_recital_overlap, '| skeleton missing =', r2.m4_missing_sections.length)
console.log('=> on a fixture where ONLY recital is degraded, the rule DOES fire:', r2.m1_readable_draft === false && (r2.m2_recital_overlap ?? 0) >= 0.30)
