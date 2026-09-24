/**
 * 随源码走的资产目录 —— **同一个模块在两种布局下要找到同一批文件**。
 *
 * ## 为什么不能只写 `join(HERE, name)`
 *
 * 本包的构建产物是**打包过的** `lib/index.js`（tsdown）。而
 * `src/stages/assets/**`（图模板 / 样式档 / 导出引擎）与 `src/stages/skill-docs/**`
 * （809KB 规则语料）是**纯静态资源**：构建不会把它们复制到 `lib` 旁边，
 * 仓库里也**没有这个约定**（已核实：没有任何 `tsdown.config.ts` 用 `copy`）。
 *
 * 于是同一份代码有两种布局：
 *
 * | 场景 | 模块位置 | 资产在哪 |
 * |---|---|---|
 * | 测试（vitest 读 `src`） | `src/stages/` | `src/stages/<name>/`（模块旁边） |
 * | 真实运行（§6：读 `lib`） | `lib/index.js` | 只能回到包的 `src/stages/<name>/` |
 *
 * ## 解析顺序，以及"找不到就抛错"
 *
 * ① 模块自己旁边（`src` 布局，也是唯一"资产随产物走"的正确形态）；
 * ② 向上找到包根再进 `src/stages/<name>`（`lib` 布局下的回退）。
 *
 * 两者都没有 → **抛错并点名构建问题**。返回一个空目录会让"资产没打包"变成
 * "资产是空的"，而后者在下游会表现为"模板是空字符串""语料读不到"这类
 * 看不出根因的失败。
 *
 * ## 这条回退是**已知的构建缺口**，不是设计
 *
 * 正确形态是构建把 `src/stages/{assets,skill-docs}` 复制到 `lib/stages/` 旁边。
 * 这一步没做（改动根 `tsdown.config.ts` 会波及全部 workspace 包，而按包加
 * `tsdown.config.ts` 会丢掉根配置里的 typert 插件）。所以回退**必须显式**：
 * `resolveStageAssetDir` 同时告诉你"这次用的是哪一份"，调用方可以把它记进清单，
 * 让"跑的是 src 还是 lib 的资产"成为一个可回答的问题。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/asset-dir
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 资产来源：模块旁边（src 布局）还是回退到源码树（lib 布局）。 */
export type AssetLayout = 'beside' | 'source-fallback'

/** 解析结果。 */
export interface ResolvedAssetDir {
  /** 绝对路径。 */
  readonly dir: string
  readonly layout: AssetLayout
}

/** 向上找包根的层数上限（`lib/` → 包根只要一层，留足余量）。 */
const MAX_UP = 6

/**
 * 解析一个资产目录。
 *
 * @param name - 目录名（`assets` / `skill-docs`）。
 * @param from - 从哪个目录开始找（**只为可测**：默认是模块自己的目录；
 *   测试用它模拟 `lib` 布局，不必真的构建一次）。
 * @returns 绝对路径 + 用的是哪一份。
 * @throws 两处都找不到时抛错（**点名构建问题**，不返回空目录）。
 */
export function resolveStageAssetDir(name: string, from: string = HERE): ResolvedAssetDir {
  const beside = join(from, name)
  if (existsSync(beside)) return { dir: beside, layout: 'beside' }
  let dir = from
  for (let i = 0; i < MAX_UP; i += 1) {
    const candidate = join(dir, 'src', 'stages', name)
    if (existsSync(candidate)) return { dir: candidate, layout: 'source-fallback' }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `资产目录 '${name}' 在模块旁边与源码树里都找不到（模块位置：${from}）。`
    + '这不是"资产是空的"，是构建没有把静态资源复制到产物旁边——'
    + '请检查 packages/paper/paper-foundation 的构建是否遗漏了 src/stages/{assets,skill-docs}。',
  )
}

/** 只取路径（调用方不关心布局时用）。 */
export function stageAssetDir(name: string): string {
  return resolveStageAssetDir(name).dir
}
