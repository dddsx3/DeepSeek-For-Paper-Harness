/**
 * P0-5 (PRD v2 §5.1.3, W4) — problem-family routing with explicit refusal.
 *
 * Classifies a problem statement into a method family WITHOUT any LLM
 * call (zero token, PRD §3.4 拒绝优先). The classifier is a heuristic:
 * it names the family the CONTEXT likely wants, so the method-family
 * contract (W5) can pick the right template — it never claims to model
 * anything. Refusals are explicit and cheap: a problem with no usable
 * modeling signal declines with a human reason before a single token is
 * spent.
 *
 * Families follow the preregistered set (bench/PREREGISTRATION.md §A):
 *   F1 机理/优化（微分方程/动力学/几何/排程）
 *   F2 微分方程/动力系统（轨迹/运动/传播）
 *   F3 统计/数据驱动（样本/假设检验/回归/数据表）
 *   F4 评价决策（多准则/方案比较/打分/层次/成本收益）
 *
 * Design rules:
 *   - Deterministic: same text -> same family (pure string matching).
 *   - Refusal reasons are human sentences (the shell's wording discipline:
 *     no second wording set — reuse the blockMessage-ish style).
 *   - The classifier needs >= MIN_SIGNAL signal lines; a bare sentence
 *     like "请写一篇论文" declines, it does not guess F1.
 */

import { getContract } from './contracts/index.ts'

/** Closed family ids (keep in sync with bench/PREREGISTRATION.md §A). */
export const FAMILIES = ['F1', 'F2', 'F3', 'F4'] as const
export type MethodFamily = (typeof FAMILIES)[number]
/** Families that HAVE an implemented contract. W8.6-C1: derived from the
 *  contract registry itself (not a hand-kept list) — "supported" can
 *  never drift from "contracted" because there is one source. */
export const SUPPORTED_FAMILIES: ReadonlyArray<MethodFamily> = FAMILIES.filter(
  family => getContract(family) !== undefined,
)

export type RouteVerdict =
  | { readonly ok: true; readonly family: MethodFamily; readonly note: string }
  | { readonly ok: false; readonly reason: string }

/** A keyword rule: family + matched-words + signal weight. */
const RULES: ReadonlyArray<{ family: MethodFamily; words: ReadonlyArray<string> }> = [
  { family: 'F3', words: ['统计', '概率', '假设检验', '置信', '信度', '抽样', '样本', '回归', '数据表', '数据', '观测', '次品率', '分布'] },
  { family: 'F4', words: ['决策', '方案', '打分', '层次分析', '成本', '收益', '评价', '比较', '优先级', '选择', '多准则', '综合'] },
  { family: 'F2', words: ['微分方程', '运动', '轨迹', '速度', '加速度', '传播', '扩散', '动力学', '位置', '仿真', '随时间'] },
  { family: 'F1', words: ['优化', '约束', '目标函数', '求解', '设计', '几何', '排程', '调度', '规划', '最大化', '最小化'] },
]

/** Minimum total matched keywords before the classifier commits. */
export const MIN_SIGNAL = 2

/** Strip bold/markdown/latex decorations that could pollute the match.
 *  Character class, not alternation: an orphan `|` in the regex would
 *  match the empty string and `replace` would insert a space after every
 *  character (抽样 -> 抽 样), silently killing every keyword match. */
function normalize(text: string): string {
  return text
    .replace(/[*_`#|]/g, ' ')
    .replace(/\\[()]|\$\$|\$/g, ' ')
    .toLowerCase()
}

/**
 * Classify a problem statement into a method family, or decline with a
 * reason. Zero LLM calls by construction.
 */
export function classifyProblem(statement: string): RouteVerdict {
  const normalized = normalize(statement)
  if (normalized.trim().length < 40) {
    return { ok: false, reason: '题面过短，无法识别建模主题（请确认上传的是完整题目原文）' }
  }
  const scores = new Map<MethodFamily, number>()
  for (const rule of RULES) {
    let hits = 0
    for (const word of rule.words) {
      if (normalized.includes(word)) hits += 1
    }
    if (hits > 0) scores.set(rule.family, (scores.get(rule.family) ?? 0) + hits)
  }
  if (scores.size === 0) {
    return { ok: false, reason: '题面未包含可识别的数学建模线索（统计/优化/方程/评价等），无法路由到方法族契约。请确认这份文件是数学建模竞赛题面。' }
  }
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]
  if (best === undefined || best[1] < MIN_SIGNAL) {
    return { ok: false, reason: `建模信号不足（命中 ${best?.[1] ?? 0} < ${MIN_SIGNAL}），无法可靠路由。请补充完整题面。` }
  }
  const family = best[0]
  const note = `命中方法族 ${family}（关键词 ${best[1]} 处：${[...scores.entries()].map(([f, n]) => `${f}×${n}`).join('，')}）`
  if (!SUPPORTED_FAMILIES.includes(family)) {
    // W8.6-C1: routing to a family WITHOUT a contract must refuse here —
    // zero model calls. W8.5's 75,669-token burn was exactly this gate
    // missing: the router said F4 (a contract existed) while the real
    // need was F2 (no contract) — the mismatch cost a full 18-minute run.
    // The reason text names which families ARE contracted, so the user
    // learns the support boundary without spending anything.
    return {
      ok: false,
      reason: `题面路由到 ${family}（${note}），但该族没有已实现的契约（已有契约：${SUPPORTED_FAMILIES.join('、')}）。明确拒绝：不消耗额度。`,
    }
  }
  return { ok: true, family, note }
}

/** Render the route verdict into the taskText (family banner for the
 *  contract layer; W5 reads it). */
export function routeBanner(verdict: Extract<RouteVerdict, { ok: true }>): string {
  return `\n## 题型路由（自动）\n\n方法族：${verdict.family}\n\n${verdict.note}\n`
}
