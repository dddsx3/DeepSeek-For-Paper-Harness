/**
 * 国赛 Word 样式档与封面档 —— **迁移自参考，并适配成本机的默认画像**。
 *
 * ## 迁移了什么、适配了什么
 *
 * 参考的 `tools/docx_style_profiles/` 是一批 JSON 样式档（13 份），其中
 * `competition_zh.json`（对标 `cumcmthesis.cls`）与 `covers/cumcm.json`（承诺书 + 标题页）
 * 是国赛用的那一套。**两份都已原样迁移进 `assets/docx-profiles/`**，不做改写——
 * 它们是数据，改写数据等于换标准。
 *
 * 适配的是**它的用法**。参考里流程是：
 *
 *   阶段 9 `format-profile` 读用户给的文字要求 → 写 `_text_profile.json`
 *   → 阶段 11 `docx-export` 读它 + `covers/*.json` → 渲染
 *
 * 而参考自己写明：**画像非法时 `docx-export` 会回退到默认 profile**。本机把这条
 * 从"引擎内部的兜底"提成**显式契约**：
 *
 * - `resolveDocxProfile(raw)`：把阶段 9 的画像**叠加在国赛默认之上**；
 * - 画像缺失、非法、或字段类型不对 → **回退到默认值，并给出具名原因**；
 * - 绝不回退到"无格式"——那是把"没读到画像"变成"交出一份没有格式的论文"。
 *
 * 这条正是适配台账里承诺的"本机适配选项"：**能力不丢，改成 harness 侧默认值**。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/docx-profile
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 样式档与封面档所在目录（从模块自身解析，单一来源）。 */
export const DOCX_PROFILES_DIR = join(HERE, 'assets', 'docx-profiles')

/** 国赛正文样式档的形状（只声明本机真的会读的字段——**不是**全文转录）。 */
export interface DocxProfile {
  readonly profile_name: string
  readonly page: {
    readonly size: string
    readonly margin_top_cm: number
    readonly margin_bottom_cm: number
    readonly margin_left_cm: number
    readonly margin_right_cm: number
  }
  readonly fonts: {
    readonly chinese_heading: string
    readonly chinese_body: string
    readonly latin: string
    readonly monospace: string
  }
  readonly headings: Readonly<Record<string, number | string | boolean>>
  readonly body: {
    readonly font_size_pt: number
    readonly line_spacing: number
    readonly first_line_indent_chars: number
  }
  readonly table: Readonly<Record<string, number | string | boolean>>
  readonly references: Readonly<Record<string, number | string>>
  readonly image: Readonly<Record<string, number | string>>
  readonly code_block: Readonly<Record<string, number | string>>
}

/** 国赛封面档的形状。 */
export interface DocxCover {
  readonly language: string
  readonly preface: {
    readonly title: string
    readonly title_size_pt: number
    readonly body_text: string
    readonly form_fields: ReadonlyArray<{ readonly label: string; readonly key: string }>
  }
  readonly title_page: Readonly<Record<string, unknown>>
}

/** 解析结果：画像 + **它从哪来**（回退必须是可见的事实，不是隐形的）。 */
export interface ResolvedProfile {
  readonly profile: DocxProfile
  /** `explicit` = 用了阶段 9 给的画像；`default` = 回退到国赛默认。 */
  readonly source: 'explicit' | 'default'
  /** 回退原因（`source === 'default'` 时非空；**必须能被写进报告**）。 */
  readonly fallbackReason: string
  /** 阶段 9 的画像里被采纳的顶层键（用于"哪些要求真的生效了"）。 */
  readonly appliedKeys: ReadonlyArray<string>
}

/** 读国赛默认样式档（迁移进来的那份，**逐字**）。 */
export function defaultDocxProfile(): DocxProfile {
  return JSON.parse(readFileSync(join(DOCX_PROFILES_DIR, 'competition_zh.json'), 'utf8')) as DocxProfile
}

/** 读国赛默认封面档。 */
export function defaultDocxCover(): DocxCover {
  return JSON.parse(readFileSync(join(DOCX_PROFILES_DIR, 'covers', 'cumcm.json'), 'utf8')) as DocxCover
}

/** 顶层键里允许被用户画像覆盖的（其余保持国赛默认）。 */
const OVERRIDABLE = new Set(['page', 'fonts', 'headings', 'body', 'title', 'table', 'references', 'image', 'code_block', 'abstract', 'keywords'])

/**
 * 把阶段 9 的画像解析成**可用的最终画像**。
 *
 * 三层：默认（国赛）→ 用户画像的合法覆盖 → 逐字段类型校验。
 *
 * @param raw - 阶段 9 产出的 `_text_profile.json` 文本；`null`/`undefined` 表示缺失。
 * @returns 最终画像 + 来源 + 回退原因 + 被采纳的键。
 */
export function resolveDocxProfile(raw: string | null | undefined): ResolvedProfile {
  const base = defaultDocxProfile()
  if (raw === null || raw === undefined || raw.trim() === '') {
    return {
      profile: base,
      source: 'default',
      fallbackReason: '阶段 9 没有产出 `_text_profile.json` —— 用国赛默认样式档（A4 / 2.5cm 边距 / SimHei 标题 / SimSun 正文 / 12pt 1.5 倍行距）。',
      appliedKeys: [],
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      profile: base,
      source: 'default',
      fallbackReason: `阶段 9 的画像不是合法 JSON（${String(error).slice(0, 80)}）—— 用国赛默认样式档。`
        + '**注意：这不是"用户没提要求"，是"要求没被解析出来"**，导出报告里必须写明。',
      appliedKeys: [],
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      profile: base,
      source: 'default',
      fallbackReason: '阶段 9 的画像不是 JSON 对象 —— 用国赛默认样式档。',
      appliedKeys: [],
    }
  }
  // 逐键叠加：**只覆盖顶层键**（不做深合并——深合并会让"用户只改了字号"悄悄丢掉
  // 同一节里其他的默认值，那种丢失极难从产物上看出来）。
  const override = parsed as Record<string, unknown>
  const applied: string[] = []
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (!OVERRIDABLE.has(key)) continue
    if (typeof value !== 'object' || value === null) continue
    merged[key] = value
    applied.push(key)
  }
  return {
    profile: merged as unknown as DocxProfile,
    source: applied.length === 0 ? 'default' : 'explicit',
    fallbackReason: applied.length === 0
      ? '阶段 9 的画像里没有一个可识别的字段（`page`/`fonts`/`headings`/`body`/…）—— 用国赛默认样式档。'
      : '',
    appliedKeys: applied,
  }
}

/**
 * 导出前的**格式校核**（阶段 11 的门禁 `docx_precheck` 用它）。
 *
 * 参考的校核看三件事：占位符、表格列数、图片链接。这里同样三件，
 * 但**判据写成代码**而不是让模型自己看。
 *
 * @param markdown - 论文正文。
 * @param figureFiles - 实际存在的图文件名。
 * @returns 致命项（空 = 可以导出）。
 */
export function docxPrecheckFatal(markdown: string, figureFiles: ReadonlyArray<string>): ReadonlyArray<string> {
  const fatal: string[] = []
  // ① 占位符：章节空槽与未替换的 result 占位符都不许交付
  const placeholders = [...markdown.matchAll(/\{<[a-zA-Z0-9_-]+>\}|_\(模型待写入\)_|TODO|待补/g)]
  if (placeholders.length > 0) {
    fatal.push(`存在 ${String(placeholders.length)} 处未填充占位（章节空槽不得交付）：${placeholders.slice(0, 3).map(m => m[0]).join('、')}`)
  }
  // ② 图片链接必须闭合
  const linked = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => (m[1] ?? '').replace(/^\.\//, ''))
  const missing = linked.filter(p => !figureFiles.includes(p.split('/').pop() ?? p))
  if (missing.length > 0) {
    fatal.push(`图片链接指向不存在的文件：${missing.slice(0, 3).join('、')}`)
  }
  // ③ 表格列数必须一致（Markdown 表头与分隔行、各行同列数）
  for (const [i, block] of tableBlocks(markdown).entries()) {
    const widths = new Set(block.map(row => row.split('|').length))
    if (widths.size > 1) {
      fatal.push(`第 ${String(i + 1)} 张表的列数不一致（出现 ${[...widths].join('/')} 列）`)
    }
  }
  return fatal
}

/** 抽出 Markdown 表格块（连续的 `|` 行）。 */
function tableBlocks(markdown: string): ReadonlyArray<ReadonlyArray<string>> {
  const out: string[][] = []
  let current: string[] = []
  for (const line of markdown.split('\n')) {
    const isRow = /^\s*\|.*\|\s*$/.test(line)
    if (isRow) { current.push(line.trim()); continue }
    if (current.length > 0) { out.push(current); current = [] }
  }
  if (current.length > 0) out.push(current)
  return out
}
