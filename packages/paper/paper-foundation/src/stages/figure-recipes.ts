/**
 * 配方检索 —— 让**简报**能把某张图该用的配方代码内联进去。
 *
 * ## 为什么需要它
 *
 * 参考工作流的 Step 3 是"**每张图先 `get_recipe.py` 取配方、照抄骨架、再换数据**"，
 * 理由写得很直白：
 * > *"Do NOT write figure scripts from scratch — the recipes contain critical styling
 * > details (gradient fills, KDE backgrounds, annotation boxes, layered visuals)
 * > that you will miss if you write from memory."*
 *
 * 但本仓库的模型**读不到磁盘**：简报是唯一通道。所以"取配方"这件事必须由
 * harness 做——把该图的配方正文**内联进那一张图的简报里**。这与阶段 2/3 的分片
 * 是同一套机制：**一次调用只交付一份小产物，需要的上下文由 harness 拼好**。
 *
 * ## 配方库的形态（照搬参考）
 *
 * 五份 markdown，每份由若干 `## <编号>. <标题> — <中文名>（<要点串>）` 章节组成，
 * 章节到下一个 `## 数字.` 或文件末尾为止。编号在文件内唯一。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/figure-recipes
 */

import { plottingAsset } from './assets.ts'

/** 配方类别（与参考的五个文件名一一对应）。 */
export const RECIPE_CATEGORIES = ['basic', 'advanced', 'academic', 'competition', 'empirical'] as const
export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number]

/** 一条配方的索引项（标题 + 要点串），供简报里的"可选配方清单"用。 */
export interface RecipeIndexEntry {
  readonly category: RecipeCategory
  readonly number: number
  readonly title: string
}

const FILE_OF: Readonly<Record<RecipeCategory, string>> = {
  basic: 'figure_recipes_basic.md',
  advanced: 'figure_recipes_advanced.md',
  academic: 'figure_recipes_academic.md',
  competition: 'figure_recipes_competition.md',
  empirical: 'figure_recipes_empirical.md',
}

/** 已读过的配方库缓存（同一次进程里只读一次）。 */
const cache = new Map<RecipeCategory, string>()

function rawOf(category: RecipeCategory): string {
  const hit = cache.get(category)
  if (hit !== undefined) return hit
  const text = plottingAsset(FILE_OF[category])
  cache.set(category, text)
  return text
}

/** 该类别下的全部配方索引（按编号升序）。 */
export function recipeIndex(category: RecipeCategory): ReadonlyArray<RecipeIndexEntry> {
  const out: RecipeIndexEntry[] = []
  for (const m of rawOf(category).matchAll(/^##\s+(\d+)\.\s+(.+)$/gm)) {
    const num = Number(m[1])
    const title = (m[2] ?? '').trim()
    if (Number.isFinite(num) && title !== '') out.push({ category, number: num, title })
  }
  return out.sort((a, b) => a.number - b.number)
}

/**
 * 取一条配方的**完整正文**（含代码骨架与坑位段）。
 *
 * @param category - 类别。
 * @param number - 编号。
 * @returns 配方正文；找不到时返回 null（由调用方决定报错还是放行）。
 */
export function recipeText(category: string, number: number): string | null {
  if (!(RECIPE_CATEGORIES as readonly string[]).includes(category)) return null
  const cat = category as RecipeCategory
  const raw = rawOf(cat)
  // 章节边界：下一个 `## <数字>.` 或文件末尾（与参考 get_recipe.py 同一口径）
  const re = new RegExp(`^##\\s+${String(number)}\\.\\s.*?(?=\\n##\\s+\\d+\\.|\\Z)`, 'ms')
  const hit = re.exec(raw)
  return hit === null ? null : hit[0].trim()
}

/** 全部配方的总数（简报里报一句"库里有多少个"，让模型知道可选面有多宽）。 */
export function recipeTotal(): number {
  return RECIPE_CATEGORIES.reduce((n, c) => n + recipeIndex(c).length, 0)
}

/**
 * 简报里的「可选配方清单」块 —— 只列**类别 + 编号 + 标题**（正文按图内联）。
 *
 * 全量内联不可能（配方库 350KB+）。所以分两步：规划那一调用看清单选型，
 * 写脚本那一调用只内联它选中的那一条正文。
 */
export function recipeIndexBlock(): string {
  const L: string[] = []
  L.push(`### 可选配方（共 ${String(recipeTotal())} 个；正文在写脚本时会按你选的编号内联进来）`)
  L.push('')
  for (const c of RECIPE_CATEGORIES) {
    const items = recipeIndex(c)
    L.push(`**\`${c}\`**（${String(items.length)} 个）：`)
    for (const it of items) L.push(`- \`${it.category} #${String(it.number)}\` — ${it.title}`)
    L.push('')
  }
  return L.join('\n')
}
