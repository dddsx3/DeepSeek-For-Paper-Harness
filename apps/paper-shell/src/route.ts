/**
 * P0-5 (PRD v2 §5.1.3, W4) — problem-family routing with explicit refusal.
 * W8.6-P3 重标：从「词频投票」改为「方法组件分析 + 契约存在性优先」。
 *
 * 分类器识别题面需要的**全部方法组件**（核验表 Part B 的 F1–F4 定义，
 * 2026-09-17 与核验表对齐），判定规则：
 *   - 每个命中的组件都被列出（带命中强度）；
 *   - **任一组件族没有契约 → 拒绝**（零 token），理由指明缺哪个组件；
 *   - 全部组件都有契约 → 可跑，主族 = 命中分最高者（供契约 banner）。
 *
 * 为什么改（O-L1-04 的证据）：W8.5 中 2024-C 被词频投票判为 F4（有契约）
 * 放行，但其真实方法构成 = F3 预测 + **F2 优化（契约缺席）**。
 * 词频投票会用一个"碰巧存在的契约"掩盖一个"结构性缺失的契约"——
 * 75,669 output tokens 的浪费自此溯源。组件分析 + 契约存在性优先直接
 * 切断这条因果链：C 题现在会被拒绝并说明"缺 F2"。
 *
 * Families (核验表 Part B):
 *   F1 机理/连续（微分方程/物理机理/几何/守恒）
 *   F2 组合/离散优化（LP/ILP/调度/路径/选择）
 *   F3 数据驱动/统计（回归/时序/检验/样本/数据）
 *   F4 评价决策（多准则/排序/层次/方案比较）
 *
 * Design rules:
 *   - Deterministic: same text -> same verdict (pure string matching).
 *   - The classifier needs >= MIN_SIGNAL hits for a component to count.
 *   - Refusal reasons are human sentences and name the missing contract.
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

export interface RouteComponent {
  readonly family: MethodFamily
  readonly hits: number
}

export type RouteVerdict =
  | { readonly ok: true; readonly family: MethodFamily; readonly note: string; readonly components: ReadonlyArray<RouteComponent> }
  | { readonly ok: false; readonly reason: string }

/** A method-component rule, aligned to 核验表 Part B (W8.6-P3 realign). */
const RULES: ReadonlyArray<{ family: MethodFamily; words: ReadonlyArray<string> }> = [
  { family: 'F1', words: ['微分方程', '动力学', '物理机理', '机理', '几何', '守恒', '运动方程', '速率', '热传导', '波动', '光学', '力学', '轨迹', '碰撞'] },
  { family: 'F2', words: ['优化', '约束', '目标函数', '求解', '规划', '调度', '排程', '路径', '最短', '最小化', '最大化', '整数规划', '线性规划', '分配', '装箱', '选址'] },
  { family: 'F3', words: ['统计', '概率', '假设检验', '置信', '信度', '抽样', '样本', '回归', '数据', '观测', '次品率', '分布', '时间序列', '预测', '缺失', '相关性'] },
  { family: 'F4', words: ['决策', '方案', '打分', '层次分析', '评价', '比较', '优先级', '选择', '多准则', '综合', '排序', '权重', '指标'] },
]

/** Minimum hits for a component to count as "required by the problem". */
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

/** The method components a statement requires (hits >= MIN_SIGNAL),
 *  strongest first. Exported for the metrics layer / tests. */
export function methodComponents(statement: string): ReadonlyArray<RouteComponent> {
  const normalized = normalize(statement)
  const scored: Array<{ family: MethodFamily; hits: number }> = []
  for (const rule of RULES) {
    let hits = 0
    for (const word of rule.words) {
      if (normalized.includes(word)) hits += 1
    }
    if (hits >= MIN_SIGNAL) scored.push({ family: rule.family, hits })
  }
  return scored.sort((a, b) => b.hits - a.hits)
}

/**
 * Classify a problem statement into its method components, or decline with
 * a reason. Zero LLM calls by construction.
 *
 * W8.6-P3: the verdict passes only when EVERY required component's family
 * has a contract. A dominant family with a contract can no longer mask a
 * required family without one.
 */
export function classifyProblem(statement: string): RouteVerdict {
  const normalized = normalize(statement)
  if (normalized.trim().length < 40) {
    return { ok: false, reason: '题面过短，无法识别建模主题（请确认上传的是完整题目原文）' }
  }
  const components = methodComponents(statement)
  if (components.length === 0) {
    return { ok: false, reason: '题面未包含可识别的数学建模线索（统计/优化/方程/评价等），无法路由到方法族契约。请确认这份文件是数学建模竞赛题面。' }
  }
  const componentText = components.map(c => `${c.family}×${c.hits}`).join('，')
  // Contract-existence-first (O-L1-04): every REQUIRED component must be
  // contracted. The missing one is named — the user learns the boundary
  // without spending a token.
  const missing = components.filter(c => !SUPPORTED_FAMILIES.includes(c.family))
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `题面需要的方法组件：${componentText}；其中 ${missing.map(m => m.family).join('、')} 尚无已实现的契约（已有契约：${SUPPORTED_FAMILIES.join('、')}）。明确拒绝：不消耗额度——混合题必须先补齐缺失组件的契约。`,
    }
  }
  const primary = components[0]
  if (primary === undefined) {
    return { ok: false, reason: '无法确定主方法族。' }
  }
  const note = `方法组件：${componentText}；主族 ${primary.family}`
  return { ok: true, family: primary.family, note, components }
}

/** Render the route verdict into the taskText (family banner for the
 *  contract layer; W5 reads it). */
export function routeBanner(verdict: Extract<RouteVerdict, { ok: true }>): string {
  return `\n## 题型路由（自动）\n\n方法族：${verdict.family}\n\n${verdict.note}\n`
}
