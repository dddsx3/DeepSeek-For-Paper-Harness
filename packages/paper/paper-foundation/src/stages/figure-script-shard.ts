/**
 * 阶段 5 的**两段式分片调用** —— 与阶段 2/3 同一套机制。
 *
 * ## 为什么必须分两段
 *
 * 参考工作流是"先规划图型、再**逐张**取配方写脚本"（Step 1 规划 → Step 3 一图一脚本）。
 * 本仓库的模型读不到磁盘，配方必须由 harness 内联；而配方库 350KB+，
 * 全量内联既装不下也没必要——**每张图只需要它自己那一条**。
 *
 * 所以：
 * | 段 | 交付 | 上下文 |
 * |---|---|---|
 * | 1 | `FIGURE_PLAN.json`（全部图的规划） | 完整简报 + **配方索引**（类别/编号/标题，6KB） |
 * | 2..N+1 | `figures/gen_<figure_id>.py`（一图一脚本） | 完整简报 + **该图规划条目** + **它选中的那条配方正文** |
 *
 * 这样每段的输出都很小（规划是 JSON，脚本是单文件），既不会撞输出上限，
 * 也让模型在写脚本时**眼前就有要照抄的骨架**——这正是参考那条
 * *"不要从零写，配方里有你凭记忆一定会漏的样式细节"* 的落点。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/figure-script-shard
 */

import { recipeIndexBlock, recipeText } from './figure-recipes.ts'

/** 一片：要交付的文件 + 该片的完整 prompt。 */
export interface FigureShard {
  readonly index: number
  readonly total: number
  /** 本片交付的相对路径；第一片是 `FIGURE_PLAN.json`，其余是 `figures/gen_*.py`。 */
  readonly deliverable: string
  readonly prompt: string
}

/** 规划里的一条图（只取本模块需要的字段）。 */
interface PlanEntry {
  readonly figure_id: string
  readonly chart_type?: string
  readonly recipe?: { readonly category?: unknown; readonly number?: unknown }
}

/**
 * 从规划回答里**宽容地**取出 JSON 对象。
 *
 * 模型常把 JSON 包在 ```json 围栏里、或前后带一句解释。这里按"第一个 `{` 到最后一个 `}`"
 * 取（与 runner 的信封解析同一条纪律：宁可多试几种候选，也不因为包装就判形态失败）。
 */
export function extractPlanObject(raw: string): { figures?: unknown } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const candidates = [fenced?.[1] ?? '', raw]
  for (const text of candidates) {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a === -1 || b <= a) continue
    try {
      return JSON.parse(text.slice(a, b + 1)) as { figures?: unknown }
    } catch { /* 试下一个候选 */ }
  }
  return null
}

/** 第一片：只产出规划（简报 + 配方索引）。 */
export function planShard(briefing: string): FigureShard {
  return {
    index: 1,
    total: 1, // total 在第二段开始时才知道，这里先占位（调用方会重算）
    deliverable: 'FIGURE_PLAN.json',
    prompt: `${briefing}\n\n---\n\n## 本次调用（第 1 段：只出规划）\n\n`
      + '**只产出 `FIGURE_PLAN.json` 的完整内容**——你的回答从第一个字符到最后一个字符都是它，'
      + '不得有任何解释或代码围栏。\n\n'
      + '这一步**先不要写绘图脚本**。规划要能回答"每张图讲什么、用什么图型、照哪个配方、'
      + '数据来自账本哪些 id"。**图型要按 `_utils/figure_style_guide.md` 的决策表选**，'
      + '不要默认柱状图。\n\n'
      + recipeIndexBlock(),
  }
}

/** 第二段的每一片：一图一脚本，内联该图的规划条目与配方正文。 */
export function scriptShards(briefing: string, rawPlan: string): ReadonlyArray<FigureShard> {
  const parsed = extractPlanObject(rawPlan)
  const list = parsed?.figures
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('第一段没有产出可用的 `figures` 数组 —— 没有规划就无法逐图内联配方')
  }
  const entries = list as ReadonlyArray<PlanEntry>
  const total = entries.length + 1
  return entries.map((e, i) => {
    const fid = String(e.figure_id ?? `fig_${String(i + 1)}`)
    const cat = typeof e.recipe?.category === 'string' ? e.recipe.category : ''
    const num = typeof e.recipe?.number === 'number' ? e.recipe.number : Number(e.recipe?.number)
    const recipe = cat !== '' && Number.isFinite(num) ? recipeText(cat, num) : null
    const recipeBlock = recipe === null
      ? '\n### 配方\n\n（你没写 `recipe` 或编号越界——**这次没有配方可照抄**。'
        + '按简报里的样式规矩自己写：`setup_style()` + `PALETTE[n]` + `COLORS[...]` + `_lighten(...)`，'
        + '浅色填充 + 原色描边，去掉上/右边框，图内不写标题。）\n'
      : `\n### 你选的配方（**照抄它的骨架，再用账本的真实数据替换 demo 数据**）\n\n${recipe}\n`
    return {
      index: i + 2,
      total,
      deliverable: `figures/gen_${fid}.py`,
      prompt: `${briefing}\n\n---\n\n## 本次调用（第 ${String(i + 2)}/${String(total)} 段：只写这一个脚本）\n\n`
        + `**只产出 \`figures/gen_${fid}.py\` 的完整内容**——你的回答从第一个字符到最后一个字符都是它，`
        + '不得有任何解释或代码围栏。\n\n'
        + `### 这张图的规划条目\n\n\`\`\`json\n${JSON.stringify(e, null, 2)}\n\`\`\`\n`
        + recipeBlock
        + '\n### 硬要求（门禁会逐条审）\n\n'
        + '- 脚本头：`from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten` + 裸调 `setup_style()`；\n'
        + `- 数据从 \`results.json\` 读（\`data_refs\` 里的 result_id 就是它的键），**不得硬编码任何数据**；\n`
        + `- 落盘 \`save_fig(fig, "figures/${fid}.png")\`；\n`
        + '- **不写整图标题**（`plt.title`/`suptitle`）；子图面板标签用 `ax.set_title("(a)", loc="left")` 合法；\n'
        + '- 不用 `#1f77b4` / `RdYlGn` / `RdBu_r` / `dark_background` / CSS 鲜艳命名色；硬编码 hex ≤2 处；\n'
        + '- figsize 按长宽比档位（r≤0.8→宽 6.0in；≤1.2→5.0in；≤1.6→3.6in；否则 3.0in；高 ≤8in）；\n'
        + '- 文件级 docstring：本图讲什么 → 每个 panel 是什么 → 数据来自账本哪些 id。',
    }
  })
}

/**
 * 组装两段回答成一个 JSON 信封（交给 `parseStageOutput` 按原契约解析）。
 *
 * @param planAnswer - 第一段的回答（规划）。
 * @param shards - 第二段的分片（`scriptShards` 的产物）。
 * @param scriptAnswers - 每片的回答，与 `shards` 一一对应。
 * @throws 某片回答为空（没内容就是没交付）。
 */
export function assembleFigureAnswers(
  planAnswer: string,
  shards: ReadonlyArray<FigureShard>,
  scriptAnswers: ReadonlyArray<string>,
): string {
  const files: Record<string, string> = {}
  const parsed = extractPlanObject(planAnswer)
  if (parsed === null) {
    throw new Error('第一段的规划不是合法 JSON —— 没有规划就没有可解析的产出')
  }
  files['FIGURE_PLAN.json'] = JSON.stringify(parsed)
  shards.forEach((shard, i) => {
    const answer = scriptAnswers[i] ?? ''
    if (answer.trim() === '') {
      throw new Error(`第 ${String(shard.index)} 段（${shard.deliverable}）的回答是空的 —— `
        + '该脚本没有内容就是没有交付，不静默跳过')
    }
    // 模型偶尔仍会包一层围栏；剥掉（形态宽容，但**内容**必须真的在）
    const fenced = /```(?:python)?\s*([\s\S]*?)```/.exec(answer)
    files[shard.deliverable] = (fenced?.[1] ?? answer).trim() + '\n'
  })
  return JSON.stringify({ files })
}
