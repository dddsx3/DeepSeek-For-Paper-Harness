/**
 * 分阶段切片与热重启 —— 每一步都留下可检查、可续跑的切片。
 *
 * ## 为什么需要它（用户口径）
 *
 * 一次真实运行要 40–80 分钟、几十万 token。**它失败时，我们失去的是整轮**：
 * 想修一处，就得从头再跑一遍。而失败往往发生在很靠后的阶段（产出链的内容判据），
 * 前面那些阶段（E1 分析、E2 声明、代码执行）其实**已经成功了**。
 *
 * 用户的要求是把每一步切开：
 *
 *   - **每阶段完成即默认停止**，等人（或 agent）检查；检查通过才进入下一阶段。
 *   - 若在 B 阶段暴露问题，修完之后**从"A 已完成、B 未开始"的状态重启 B**——
 *     不是从头跑。
 *   - **每一轮切片都保留**，方便随时回看、更新与修复。
 *
 * ## 切片的边界选在哪
 *
 * 判据是**状态可序列化**：一个阶段只有在它的全部产出都能落盘、且下一阶段只需要
 * 这些产出就能继续时，才配当一个切片边界。按这个判据，本 harness 的边界是：
 *
 * | 阶段 | 产出（切片载荷） | 续跑需要它做什么 |
 * |---|---|---|
 * | `analyze` | E1 全文 | 作为 E2 的输入 |
 * | `declare` | 容器全文 + 准入结论 | 作为产出链的输入 |
 * | `produce` | 执行记录 + IR 条目 + **渲染后的正文** | 作为评审与交付的输入 |
 * | `review` | 缺陷清单 | 作为修订的输入 |
 * | `deliver` | 最终交付正文 + 档位 | 终态 |
 *
 * **为什么没有单独的 `render` 阶段**（初版设计里有一个，实现时去掉了）：
 * `runProductionChain` 把"跑代码 → 铸 IR → 解释 → 出图 → 渲染 → 契约检查"放在
 * **一次调用**里，中间没有可序列化的停顿点。把它切成两片需要先重构那个方法的长尾
 * ——**那正是 round-6 报告里 P0 未完成的原因**。阶段表**只列真实存在的边界**，
 * 不列设计意图：一个永远发不出来的阶段名会让"下一阶段"指向一个不存在的切片。
 *
 * ## 与"门禁"的关系
 *
 * 切片**不是**门：它不判定对错，只负责"停在这里、把状态交出来"。检查由人/agent
 * 做（读切片里的载荷），判定结论写回 `manifest.json` 的 `review` 字段。这样
 * "检查通过才继续"是一条**可追溯**的事实，而不是一句口头约定。
 *
 * @module @deepseek-ai/dsh-paper-foundation/runtime/stage-checkpoint
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 阶段 id（顺序即流水线顺序）。 */
export const STAGE_IDS = ['analyze', 'declare', 'produce', 'review', 'deliver'] as const
export type StageId = (typeof STAGE_IDS)[number]

/** 一个阶段的元信息。 */
export interface StageSpec {
  readonly id: StageId
  /** 人读的阶段名（进检查提示与报告）。 */
  readonly title: string
  /** 这一阶段的产出是什么（检查时该看什么）。 */
  readonly produces: string
  /** 这一阶段的产出为什么能支撑续跑。 */
  readonly resumableBecause: string
}

/**
 * 阶段表。
 *
 * `resumableBecause` 不是注释，是**设计判据**：写不出这一句的阶段不配当切片边界，
 * 因为它意味着"续跑需要的信息没被落盘"。
 */
export const STAGES: ReadonlyArray<StageSpec> = [
  {
    id: 'analyze',
    title: '建模分析（E1）',
    produces: 'E1 全文（自由散文）',
    resumableBecause: 'E1 是纯文本，且 E2 只以它为输入——续跑只需把这段文本喂回去',
  },
  {
    id: 'declare',
    title: '容器声明与准入（E2）',
    produces: '容器全文 + 准入结论',
    resumableBecause: '容器是纯 JSON 文本；准入是它的纯函数，续跑可重放而不必重发模型调用',
  },
  {
    id: 'produce',
    title: '代码执行、IR 铸造与正文渲染',
    produces: '执行记录 + IR 条目 + 渲染后的正文',
    resumableBecause: '三者都可序列化，且渲染是纯函数（IR + narrative → 正文）；续跑不必重跑代码',
  },
  {
    id: 'review',
    title: '对抗评审',
    produces: '缺陷清单',
    resumableBecause: '缺陷清单是数据；续跑可从它直接进修订或交付',
  },
  {
    id: 'deliver',
    title: '交付与定档',
    produces: '最终交付正文 + 档位',
    resumableBecause: '终态——它没有"续跑"，只有"完成"',
  },
]

/** 一次检查的结论（由人/agent 写回）。 */
export interface StageReview {
  /** 检查结论。 */
  readonly verdict: 'passed' | 'failed'
  /** 结论的依据（人读）。 */
  readonly note: string
  /** 检查时间（ISO）。 */
  readonly at: string
}

/** 一个切片的清单。 */
export interface SliceManifest {
  readonly sliceVersion: 1
  /** 阶段 id。 */
  readonly stage: StageId
  /** 流水线内序号（从 1 起，与目录名前缀一致）。 */
  readonly index: number
  /** 完成时间（ISO）。 */
  readonly completedAt: string
  /** 运行 id。 */
  readonly runId: string
  /** 载荷文件名（相对切片目录）。 */
  readonly payload: string
  /** 载荷的 sha256——切片被改动过必须看得出来。 */
  readonly payloadSha256: string
  /** 检查结论；未检查时为 null。 */
  readonly review: StageReview | null
  /**
   * 续跑所需的**最小信息**（人读 + 机器读）。
   *
   * 例如 `declare` 切片记 `{ containerChars, admitted: true }`——检查者据此知道
   * 该看什么，续跑逻辑据此知道这一片能不能直接用。
   */
  readonly facts: Readonly<Record<string, string | number | boolean>>
}

/** 切片在磁盘上的位置。 */
export function sliceDirName(index: number, stage: StageId): string {
  return `${String(index).padStart(2, '0')}-${stage}`
}

/**
 * 写一个切片。
 *
 * 原子性：先写载荷、再写清单——**清单是切片的完成标记**。读侧只认"清单存在且
 * 载荷哈希对得上"的目录为完整切片，因此半个切片不会被误当成续跑点。
 *
 * @param root - 切片根目录（通常是 `<runRoot>/slices`）。
 * @param input - 切片内容。
 * @returns 切片目录与清单。
 */
export async function writeSlice(
  root: string,
  input: {
    readonly stage: StageId
    readonly index: number
    readonly runId: string
    readonly payload: string
    readonly facts: Readonly<Record<string, string | number | boolean>>
    readonly now?: string
  },
): Promise<{ readonly dir: string; readonly manifest: SliceManifest }> {
  const dir = join(root, sliceDirName(input.index, input.stage))
  // 同一阶段重跑（修完问题后从上一个检查点重启）时，**旧切片必须留下**：
  // 它是"修之前长什么样"的唯一证据。所以把它整体改名移开，而不是覆盖。
  if (existsSync(dir)) {
    let n = 1
    while (existsSync(`${dir}.superseded-${String(n)}`)) n += 1
    await rename(dir, `${dir}.superseded-${String(n)}`)
  }
  await mkdir(dir, { recursive: true })
  const payloadName = 'payload.txt'
  await writeFile(join(dir, payloadName), input.payload, 'utf8')
  const manifest: SliceManifest = {
    sliceVersion: 1,
    stage: input.stage,
    index: input.index,
    completedAt: input.now ?? new Date().toISOString(),
    runId: input.runId,
    payload: payloadName,
    payloadSha256: sha256Hex(input.payload),
    review: null,
    facts: input.facts,
  }
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { dir, manifest }
}

/** 列出已完成的切片（按 index 升序）。清单缺失或载荷哈希不符的目录**不算切片**。 */
/** 规范切片目录名：`NN-stage`。被移走的旧切片（`….superseded-N`）不匹配。 */
const SLICE_DIR = /^[0-9]{2}-[a-z]+$/

export async function listSlices(root: string): Promise<ReadonlyArray<SliceManifest>> {
  const names = await readdir(root).catch(() => [] as string[])
  const out: SliceManifest[] = []
  for (const name of names.sort()) {
    // 只认规范目录名：**被移到一边的旧切片仍在磁盘上**（用户要求"每一轮切片都保留"），
    // 但不再参与续跑判定——否则同一阶段的两个轮次会被当成"序号重复"而截断续跑链。
    if (!SLICE_DIR.test(name)) continue
    const manifest = await readManifest(join(root, name))
    if (manifest === null) continue
    out.push(manifest)
  }
  return out.sort((a, b) => a.index - b.index)
}

/** 读一个切片的清单；不完整则返回 null（**不猜**）。 */
async function readManifest(dir: string): Promise<SliceManifest | null> {
  const raw = await readFile(join(dir, 'manifest.json'), 'utf8').catch(() => null)
  if (raw === null) return null
  let parsed: SliceManifest
  try {
    parsed = JSON.parse(raw) as SliceManifest
  } catch {
    return null
  }
  if (parsed.sliceVersion !== 1) return null
  const payload = await readFile(join(dir, parsed.payload), 'utf8').catch(() => null)
  if (payload === null) return null
  // 载荷被改过 → 切片作废。**不静默采用**：一个被改过的切片会让"续跑"从错误的
  // 状态开始，而那种错误极难从产物上看出来。
  if (sha256Hex(payload) !== parsed.payloadSha256) return null
  return parsed
}

/** 读一个切片的载荷。清单不完整时抛错（调用方应先 `listSlices` 过滤）。 */
export async function readSlicePayload(dir: string): Promise<string> {
  const manifest = await readManifest(dir)
  if (manifest === null) throw new Error(`slice at ${dir} is incomplete or tampered with`)
  return readFile(join(dir, manifest.payload), 'utf8')
}

/** 把检查结论写回切片（**就地**更新清单）。 */
export async function recordReview(dir: string, review: StageReview): Promise<void> {
  const raw = await readFile(join(dir, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(raw) as SliceManifest
  await writeFile(
    join(dir, 'manifest.json'),
    `${JSON.stringify({ ...manifest, review }, null, 2)}\n`,
    'utf8',
  )
}

/**
 * 续跑点：**最后一个"已完成且检查通过"的切片**。
 *
 * 这正是用户要的语义：如果在 B 阶段暴露问题，修完之后要从"**A 已完成、B 未开始**"
 * 重启。判据是"检查结论为 passed"，所以一个**未经检查**的切片不会被当成续跑点
 * ——否则"检查通过才继续"就成了一句空话。
 *
 * @param slices - 已完成的切片（`listSlices` 的结果）。
 * @returns 续跑点；没有合格切片时返回 null（意味着从头跑）。
 */
export function resumePointOf(slices: ReadonlyArray<SliceManifest>): SliceManifest | null {
  let point: SliceManifest | null = null
  for (const slice of slices) {
    // 序号必须连续：`01-analyze` 之后直接出现 `03-produce` 说明 `02-declare`
    // 缺失或损坏，此时**不能**把 03 当续跑点——它的前提不成立。
    if (point === null) {
      if (slice.index !== 1) break
    } else if (slice.index !== point.index + 1) {
      break
    }
    if (slice.review === null || slice.review.verdict !== 'passed') break
    point = slice
  }
  return point
}

/** 下一个该跑的阶段（续跑点之后那一个）。 */
export function nextStageAfter(slices: ReadonlyArray<SliceManifest>): StageSpec {
  const point = resumePointOf(slices)
  const done = point === null ? 0 : point.index
  return STAGES[Math.min(done, STAGES.length - 1)] as StageSpec
}

/**
 * 渲染续跑提示。
 *
 * 这段文字是**给人看的**，所以要包含三件事：停在哪、看什么、怎么继续。
 * 缺了"怎么继续"，热重启就只是"跑一半停了"。
 *
 * @param input - 切片目录、续跑点、运行 id、题面文件。
 * @returns 可直接打印的多行文本。
 */
export function renderResumeInstruction(input: {
  readonly slicesRoot: string
  readonly runId: string
  readonly problemFile: string
  readonly slices: ReadonlyArray<SliceManifest>
}): string {
  const point = resumePointOf(input.slices)
  const next = nextStageAfter(input.slices)
  const lines: string[] = []
  lines.push('── 已停在检查点（热重启） ──')
  if (point === null) {
    lines.push('  尚无"检查通过"的切片：下一阶段是第 1 阶段。')
  } else {
    lines.push(`  最后一个检查通过的切片：${sliceDirName(point.index, point.stage)}（${point.stage}）`)
    lines.push(`  该切片的载荷：${join(input.slicesRoot, sliceDirName(point.index, point.stage), point.payload)}`)
  }
  const pending = input.slices.filter(s => s.review === null)
  for (const s of pending) {
    lines.push(`  ⏸ 待检查：${sliceDirName(s.index, s.stage)}（${s.stage}）—— ${s.facts['note'] ?? ''}`)
  }
  lines.push(`  下一阶段：${next.id}（${next.title}）—— 产出：${next.produces}`)
  lines.push('')
  lines.push('  检查通过后继续：')
  lines.push(`    paper-shell run ${input.problemFile} --resume ${input.slicesRoot} --run-id ${input.runId}`)
  return lines.join('\n')
}

/** 载荷哈希：切片被改动过必须看得出来。 */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
