/**
 * 阶段执行器 —— 按注册表跑 11 个阶段，逐阶段门禁 + 通行证 + 回滚。
 *
 * ## 它不碰 provider
 *
 * 执行器只依赖一个 `callModel(stage, prompt)` 回调。这样它**完全可测**（注入假调用器
 * 就能跑完整条链），也不必知道 provider 是真是假、是哪个中转。
 *
 * ## 阶段的产出怎么落盘：一个**明确的规则**，不是猜
 *
 * 一个阶段的产出可能是一份（阶段 7 的 `paper/main.md`）也可能是四份（阶段 1）。
 * 模型一次调用只返回一段文本，所以映射规则必须写死：
 *
 * | 产出份数 | 模型的回答形态 | 为什么 |
 * |---|---|---|
 * | **1 份** | **原文**（不带信封） | 阶段 2b 要写纯散文——套信封会把 JSON 解析风险引回来，而那正是分片要消灭的头号失败 |
 * | **≥2 份** | **JSON 信封** `{"files": {"<名>": "<内容>"}}` | 一份回答装多份产出；JSON 是本项目指定的传递媒介 |
 *
 * 信封缺文件、多文件、名字不对——**一律判失败并点名**，不"尽力猜哪个是哪个"。
 *
 * ## 失败语义（四档）
 *
 * - `passed`：门禁**全 0** → 签发通行证；
 * - `passed-unverified`：门禁有 `2`（无法判定）但**没有 `1`** → **签发通行证，并把
 *   `unverifiedGates` 记在证上**；
 * - `gate-failed`：门禁有 `1`（硬失败）→ 不签发，把下游标 stale，并报告建议回滚目标；
 * - `blocked`：上游没就绪（缺通行证 / stale / 摘要不符）→ 拒绝启动并点名是哪一环。
 *
 * ### 为什么 `2` **不阻断阶段**，而是"阻断 CLEAN"
 *
 * 第一版让 `2` 与 `1` 一样阻断。测试立刻撞出一个后果：**阶段 1 的 `capability_check`
 * 尚未实现（`2`），于是整条链一步都跑不动**。
 *
 * 两种语义都自洽，但后果差别很大：
 *
 * | 语义 | `2` 的含义 | 后果 |
 * |---|---|---|
 * | 阻断阶段（第一版） | "判不了就不许往下走" | **所有门禁实现完之前，系统完全不可运行** |
 * | 阻断 CLEAN（现行） | "判不了就不算通过，但**缺口如实记账**" | 链能跑；缺口进通行证、进交付档位 |
 *
 * 选后者，理由是它与本仓库**既有的交付阶梯**一致：`CLEAN / MARKED / DEGRADED / ESCALATE`
 * 本来就是"检出问题但如实标注、不零掉产物"的机制。而"`2` 不等于通过"这条纪律**没有丢**
 * ——它变成了**通行证上的 `unverifiedGates`**：谁想宣称 CLEAN，就得先把这些缺口补上。
 *
 * **不许把 `2` 当 `0`** 这条仍然成立：`passed-unverified` 与 `passed` 是两个不同的状态，
 * 交付侧按前者降档。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/runner
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stageBriefing } from './briefing.ts'
import { runGates, type GateInput } from './gates.ts'
import {
  artifactDigests,
  markStaleFrom,
  passportFor,
  readPassport,
  stageReady,
  writePassport,
  type GateVerdict,
  type StagePassport,
} from './handoff.ts'
import { STAGES, stageDirName, type StageId, type StageSpec } from './registry.ts'

/** 执行器需要的外部能力（注入，便于测试与替换 provider）。 */
export interface StageRunContext {
  /** `stages/` 根目录。 */
  readonly stagesRoot: string
  /** 跑一次模型调用（阶段简报 → 回答文本）。只对 `kind === 'model'` 的阶段调用。 */
  readonly callModel: (stage: StageSpec, prompt: string) => Promise<string>
  /** 本阶段技能的版本（进 `inputDigest`；技能改了旧通行证就失效）。 */
  readonly skillVersionOf: (stage: StageSpec) => string
  /** 本阶段门禁的版本（同上）。 */
  readonly gateVersionOf: (stage: StageSpec) => string
  /**
   * 确定性阶段的执行体（harness 侧计算）。
   *
   * 缺省时确定性阶段**不产出任何文件**——那会让它的门禁失败（文件不存在），
   * 这是有意的：**没实现的确定性阶段不许静默通过**。
   */
  readonly runDeterministic?: (stage: StageSpec, stagesRoot: string) => Promise<void>
  /** 阶段是否挂了只读工具（影响简报是否列语料索引）。 */
  readonly toolsMounted?: (stage: StageSpec) => boolean
  /** 时钟（测试可注入）。 */
  readonly now?: () => string
}

/** 一个阶段的结果。 */
export interface StageOutcome {
  readonly stage: StageId
  readonly status: 'passed' | 'passed-unverified' | 'gate-failed' | 'blocked'
  readonly gate: GateVerdict
  readonly passport?: StagePassport
  /** `gate-failed` 且本阶段声明了回滚目标时，**建议回到哪个阶段**（执行器不擅自重跑）。 */
  readonly suggestedRollbackTo?: StageId
  /** 被标 stale 的下游阶段（`gate-failed` 时）。 */
  readonly staledDownstream?: ReadonlyArray<StageId>
  readonly reason: string
}

/**
 * 把模型的回答映射成 `文件 → 内容`。
 *
 * 规则见模块头：1 份产出取原文，≥2 份取 JSON 信封。
 *
 * @param spec - 阶段。
 * @param text - 模型的回答。
 * @returns 文件映射；形态不合法时抛错（**不尽力猜**）。
 */
export function parseStageOutput(spec: StageSpec, text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  if (spec.produces.length === 1) {
    const only = spec.produces[0]
    if (only === undefined) throw new Error(`stage '${spec.id}' declares no deliverable`)
    out.set(only.file, text)
    return out
  }
  // ≥2 份：要 JSON 信封
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error(`stage '${spec.id}' declares ${String(spec.produces.length)} deliverables, so the answer must be a JSON envelope {"files": {...}} — got no JSON object`)
  }
  let parsed: { files?: unknown }
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as { files?: unknown }
  } catch (error) {
    throw new Error(`stage '${spec.id}' envelope is not valid JSON: ${String(error).slice(0, 100)}`)
  }
  const files = parsed.files
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new Error(`stage '${spec.id}' envelope has no "files" object`)
  }
  const expected = new Set(spec.produces.map(p => p.file))
  const got = Object.keys(files as Record<string, unknown>)
  const missing = [...expected].filter(f => !got.includes(f))
  const extra = got.filter(f => !expected.has(f))
  // **缺与多都判失败**：静默接受"多出来的文件"会让阶段悄悄产出契约外的产物。
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `stage '${spec.id}' envelope does not match its contract —`
      + (missing.length > 0 ? ` missing: ${missing.join('、')};` : '')
      + (extra.length > 0 ? ` unexpected: ${extra.join('、')};` : '')
      + ` expected exactly: ${[...expected].join('、')}`,
    )
  }
  for (const [name, body] of Object.entries(files as Record<string, unknown>)) {
    if (typeof body !== 'string') throw new Error(`stage '${spec.id}' file '${name}' is not a string`)
    out.set(name, body)
  }
  return out
}

/** 读上游产物文本（供简报内联）。缺失的记空串并在简报里如实体现。 */
async function upstreamTextOf(stagesRoot: string, spec: StageSpec): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const path of spec.consumes) {
    if (path.startsWith('00-input/')) continue // 题面等外部输入由调用方另行注入
    const text = await readFile(join(stagesRoot, path), 'utf8').catch(() => null)
    if (text !== null) out.set(path, text)
  }
  return out
}

/** 读阶段目录内的产物文本（供门禁）。 */
async function stageFilesOf(stagesRoot: string, spec: StageSpec): Promise<Map<string, string>> {
  const dir = join(stagesRoot, stageDirName(spec))
  const out = new Map<string, string>()
  for (const p of spec.produces) {
    if (p.kind === 'dir') continue
    const text = await readFile(join(dir, p.file), 'utf8').catch(() => null)
    if (text !== null) out.set(p.file, text)
  }
  return out
}

/**
 * 跑一条阶段链。
 *
 * 默认从第 1 阶段跑到第 11 阶段；遇到 `blocked` 或 `gate-failed` **立即停**
 * （后续阶段的前提已经不成立，继续跑只会产出不一致的包）。
 *
 * @param ctx - 注入的能力。
 * @param options - `only` 限定只跑某些阶段（调试用）；`problemCount` 供逐问判据。
 * @returns 逐阶段结果（含失败原因与建议回滚目标）。
 */
export async function runStages(
  ctx: StageRunContext,
  options: { readonly only?: ReadonlyArray<StageId>; readonly problemCount?: number } = {},
): Promise<ReadonlyArray<StageOutcome>> {
  const outcomes: StageOutcome[] = []
  const targets = options.only === undefined
    ? STAGES
    : STAGES.filter(s => options.only?.includes(s.id) === true)
  for (const spec of targets) {
    const skillVersion = ctx.skillVersionOf(spec)
    const gateVersion = ctx.gateVersionOf(spec)
    const ready = await stageReady(ctx.stagesRoot, spec, skillVersion, gateVersion)
    if (!ready.ok) {
      outcomes.push({
        stage: spec.id, status: 'blocked', gate: { code: 2, items: [] },
        reason: ready.reason,
      })
      break
    }

    const dir = join(ctx.stagesRoot, stageDirName(spec))
    await mkdir(dir, { recursive: true })
    try {
      if (spec.kind === 'model') {
        const prompt = stageBriefing(spec, await upstreamTextOf(ctx.stagesRoot, spec), ctx.toolsMounted?.(spec) === true)
        const answer = await ctx.callModel(spec, prompt)
        for (const [name, body] of parseStageOutput(spec, answer)) {
          const file = join(dir, name)
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, body, 'utf8')
        }
      } else {
        // 确定性阶段：执行体缺省时**什么都不做** → 门禁会因文件不存在而失败。
        // 这是有意的：没实现的确定性阶段不许静默通过。
        await ctx.runDeterministic?.(spec, ctx.stagesRoot)
      }
    } catch (error) {
      outcomes.push({
        stage: spec.id, status: 'gate-failed',
        gate: { code: 1, items: [{ id: 'stage_output', ok: false, detail: String(error instanceof Error ? error.message : error) }] },
        ...(spec.rollbackTo.length === 0 ? {} : { suggestedRollbackTo: spec.rollbackTo[0] as StageId }),
        reason: `阶段产出未通过形态检查：${String(error instanceof Error ? error.message : error)}`,
      })
      break
    }

    const gateInput: GateInput = {
      files: await stageFilesOf(ctx.stagesRoot, spec),
      upstream: new Map([...await upstreamTextOf(ctx.stagesRoot, spec)].map(([k, v]) => [k.split('/').pop() ?? k, v])),
      problemCount: options.problemCount ?? 0,
    }
    const gate = runGates(spec.gates, gateInput)
    // `1` = 硬失败 → 阻断；`2` = 无法判定 → **不阻断阶段，但记账**（见模块头的取舍）
    if (gate.code === 1) {
      // 门禁不过 → 不签发；把**下游**标 stale（它们的输入前提已经不成立）
      const staled = await markStaleFrom(
        ctx.stagesRoot, spec.id,
        `阶段 '${spec.id}' 门禁未通过（code ${String(gate.code)}）—— 下游前提不成立`,
      )
      outcomes.push({
        stage: spec.id, status: 'gate-failed', gate,
        ...(spec.rollbackTo.length === 0 ? {} : { suggestedRollbackTo: spec.rollbackTo[0] as StageId }),
        staledDownstream: staled,
        reason: `门禁 code ${String(gate.code)}（0=通过 1=硬失败 2=无法判定）：`
          + gate.items.filter(i => !i.ok).map(i => i.id).join('、'),
      })
      break
    }

    const unverified = gate.items.filter(i => !i.ok).map(i => i.id)
    const passport = passportFor(spec, {
      upstreamDigests: await upstreamDigestList(ctx, spec),
      skillVersion, gateVersion,
      artifacts: await artifactDigests(dir, spec.produces),
      gate,
      unverifiedGates: unverified,
      ...(ctx.now === undefined ? {} : { now: ctx.now() }),
    })
    await writePassport(ctx.stagesRoot, passport)
    outcomes.push({
      stage: spec.id,
      status: unverified.length === 0 ? 'passed' : 'passed-unverified',
      gate, passport,
      reason: unverified.length === 0
        ? '门禁全过，已签发通行证'
        : `门禁全过但**有 ${String(unverified.length)} 条无法判定**（${unverified.join('、')}）——`
          + '已如实记在通行证上；这些缺口使本阶段不能计入 CLEAN。',
    })
  }
  return outcomes
}

/** 上游通行证的摘要列表（按阶段序号）。 */
async function upstreamDigestList(ctx: StageRunContext, spec: StageSpec): Promise<ReadonlyArray<string>> {
  const out: string[] = []
  for (const up of STAGES.filter(s => s.index < spec.index)) {
    const passport = await readPassport(ctx.stagesRoot, up)
    out.push(passport === null ? '' : passport.inputDigest)
  }
  return out
}
