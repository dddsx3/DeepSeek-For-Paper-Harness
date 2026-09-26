/**
 * **图表预算** —— 一篇论文该配多少张图，以及"多少算不合格"。
 *
 * ## 为什么需要它（用户口径）
 *
 * *"只有四张图是绝对无法支撑一篇优秀论文的……比如 30 页正文的论文应该配多少张图，
 * 将其作为一个约束写好，允许上下浮动 3 张。"*
 *
 * 实测（2024B）：阶段 1 的 `FIGURE_MANIFEST` 规规矩矩写了 `DATA=14`，
 * 但**阶段 5 交付时只剩 7 张**——11 条 `plan_deviations` 里 7 条是"申报放弃"。
 * 每一条的理由都真实（账本里确实没有那些数），**申报放弃的机制也是对的**，
 * 问题在于**没有任何东西去数"最后剩几张"**：契约允许逐张申报，却不设总量下限，
 * 于是"诚实地放弃"可以一路放弃到图集撑不起论文。
 *
 * 这正是本仓库反复出现的同一形态：**规则写了、没人去数它**。
 * 所以这里把"该有几张"变成可计算的数，并在**规划**与**交付**两端各卡一次。
 *
 * ## 数字从哪来（参考实现的原文依据，不是拍的）
 *
 * 参考资产里有两处硬依据：
 *
 * 1. `figure-distribution-exemplars.md` 的逐题范例（25-30 页正文）：
 *    国赛 A 题 15 张数据图、B 题 13 张、C 题 14 张；华为杯（约 60 页正文）28-32 张。
 *    换算成密度：13/28≈0.46、14/28≈0.50、15/28≈0.54、30/60≈0.50 —— **稳定在 0.5 张/页**。
 * 2. `comp-prob-analysis/SKILL.md` 的机械闸（原样照搬的常量）：
 *    `HARD_FLOOR=3`（数据图少于 3 张判"工作严重不完整"，硬阻塞）、
 *    软区间 `SOFT_REF_LOW=12` / `SOFT_REF_HIGH=20`（竞赛论文标准，不阻塞）、
 *    并且**明说流程图/推导示意图（DRAWIO/TIKZ）不计入数据图参考值**。
 *
 * 本模块把两者合成一条**按页数推导**的规则，因为页数才是"论文多长"的直接度量：
 *
 * ```
 * 目标正文页数 = max(20, 6 × 子问题数 + 6)      // 每问 6 页 + 首尾 6 页；20 页是既有地板
 * 数据图目标   = round(0.5 × 目标正文页数)        // 参考实测的密度
 * 容差         = ±3                            // 用户指定
 * ```
 *
 * 4 问的 2024B：目标 30 页 → 数据图目标 15、区间 12-18。
 * 与参考的逐题范例（B 题 13 张 / 25-30 页）与软区间（12-20）都落在同一带里。
 *
 * ## 两个不能丢的细节
 *
 * - **硬底线 3 张**：容差**不能**把下限拉到 3 以下。3 是参考的"工作严重不完整"线，
 *   是绝对底线；容差只作用于"目标 ±3"，不作用于这条底线。
 * - **TIKZ/DRAWIO 算下限、不算上限**：参考原话是"若本题为【推理密集型】
 *   （几何推导/多步证明/临界分析），数据图达底线即正常，推导构造图(TIKZ)+
 *   结果验证/关键结果/灵敏度图才是重点，**勿为凑数硬加数据曲线稀释重点**"。
 *   所以：下限用 `DATA + TIKZ + DRAWIO` 判（推理题可以靠推导图达标），
 *   上限只卡 `DATA`（防为凑数硬加数据图）。这样两条纪律都不破。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/figure-budget
 */

/** 用户指定的容差：允许上下浮动 3 张。 */
export const FIGURE_COUNT_TOLERANCE = 3

/** 参考的绝对底线（`comp-prob-analysis` 的 `HARD_FLOOR`）：少于 3 张数据图 = 工作严重不完整。 */
export const FIGURE_COUNT_HARD_FLOOR = 3

/** 每页正文约 800 字符（与 `paper_page_floor` 同口径，两处必须一致）。 */
export const CHARS_PER_PAGE = 800

/** 每页正文配多少张数据图（参考逐题范例实测 0.46–0.54，取 0.5）。 */
export const FIGURES_PER_PAGE = 0.5

/** 每个子问题的正文页数（参考："问题一(5-7页)"，取 6）。 */
const PAGES_PER_PROBLEM = 6

/** 首尾公共部分页数：问题重述+分析 + 假设符号 + 灵敏度 + 评价（参考范例合计 7-9 页，取 6 保守）。 */
const PAGES_FRONT_BACK = 6

/** 正文页数地板（与 `paper_page_floor` 的 20 页一致）。 */
const MIN_BODY_PAGES = 20

/**
 * 目标正文页数。
 *
 * 由子问题数推导（每问 6 页 + 首尾 6 页），并不低于既有的 20 页地板。
 * **它是"目标"，不是"上限"**——参考明确"页数超了完全没问题，绝不能主动压页"。
 */
export function targetBodyPages(problemCount: number): number {
  const byProblems = PAGES_PER_PROBLEM * Math.max(problemCount, 1) + PAGES_FRONT_BACK
  return Math.max(MIN_BODY_PAGES, byProblems)
}

/** 数据图目标数（`round(0.5 × 目标页数)`）。 */
export function targetDataFigures(problemCount: number): number {
  return Math.round(FIGURES_PER_PAGE * targetBodyPages(problemCount))
}

/** 图表预算区间。`lo` 已被硬底线兜住（不会低于 `FIGURE_COUNT_HARD_FLOOR`）。 */
export interface FigureBudget {
  /** 目标正文页数（推导过程要能讲给人听，所以一并给出）。 */
  readonly pages: number
  /** 数据图目标数。 */
  readonly target: number
  /** 下限（`target - 容差`，但不低于硬底线）。 */
  readonly lo: number
  /** 上限（`target + 容差`）。 */
  readonly hi: number
}

/**
 * 算出本轮的图表预算。
 *
 * @param problemCount - 题面子问题数；为 0（数不出）时按 1 问保守处理。
 */
export function figureBudget(problemCount: number): FigureBudget {
  const pages = targetBodyPages(problemCount)
  const target = targetDataFigures(problemCount)
  return {
    pages,
    target,
    lo: Math.max(FIGURE_COUNT_HARD_FLOOR, target - FIGURE_COUNT_TOLERANCE),
    hi: target + FIGURE_COUNT_TOLERANCE,
  }
}

/** 把预算写成一句人能读的话（门禁 detail 与简报共用同一句，避免两处措辞漂移）。 */
export function budgetSentence(budget: FigureBudget, problemCount: number): string {
  return `题面 ${String(Math.max(problemCount, 1))} 问 → 目标正文 ${String(budget.pages)} 页`
    + ` → 数据图目标 ${String(budget.target)} 张（容差 ±${String(FIGURE_COUNT_TOLERANCE)}，`
    + `区间 ${String(budget.lo)}–${String(budget.hi)} 张；绝对底线 ${String(FIGURE_COUNT_HARD_FLOOR)} 张）`
}
