/**
 * 阶段交接：`PASSED` 哨兵（JSON）+ `inputDigest` 失效判定 + 回滚作废。
 *
 * ## 为什么用文件而不是内存
 *
 * 参考工作流的规则是"读取工作区中已有的文件，在前步骤的基础上继续工作"——阶段之间
 * 靠**文件**交接，而不是靠一个长会话。本 harness 沿用这条，但**读写由 harness 承担**
 * （本管线的模型调用没有通用文件工具，"让模型自己 Write"是一条无法被遵守的指令）。
 *
 * 哨兵是 **JSON**：可 diff、可哈希、可人工检查（见 `interchange.ts` 的模块注释）。
 *
 * ## 三条准入规则（都是代码，不是约定）
 *
 * 1. **门禁全过才发哨兵**：`passportFor` 在 `gate.code !== 0` 时**抛错**，拒绝签发。
 *    `code === 2`（无法判定）同样不算通过——参考脚本有这个语义，折成"通过"就是自欺。
 * 2. **上游必须就绪**：`stageReady` 校验上游哨兵存在、非 stale、且摘要一致。
 * 3. **回滚作废下游**：`markStaleFrom` 把序号更大的哨兵标 `stale`（**不删除**，证据保留）。
 *
 * 第 3 条是评估指出的缺口——"回滚到阶段 2 后，阶段 3/4/5 的 PASSED 其输入已经变了，
 * 但它们仍带着旧的 sha256 躺在磁盘上"，会产出"半新半旧"的不一致包。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/handoff
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuditVerdict } from './audit.ts'
import { digestOf, inputDigestOf } from './interchange.ts'
import { STAGES, stageDirName, type StageId, type StageSpec } from './registry.ts'

/** 门禁结论。0 = 通过；1 = 硬失败；2 = **无法判定**（不算通过）。 */
export interface GateVerdict {
  readonly code: 0 | 1 | 2
  readonly items: ReadonlyArray<{
    readonly id: string
    readonly ok: boolean
    readonly detail: string
    /**
     * 这一条自己的判定码（0/1/2）。**不能只看聚合的 `code`**：重跑时要把
     * "这一轮到底哪几条硬失败"投递回简报，而 `2`（未实现/无法判定）不是执行者
     * 能修的东西——把 `2` 也投回去，等于让它去追一个不存在的任务。
     *
     * 可选：缺省按 `1`（硬失败）算。手写的条目都出现在失败分支里（`stage_audit`
     * 之类），而 `ok`/`fail`/`cannot` 三个构造器都会显式带上。
     */
    readonly code?: 0 | 1 | 2
  }>
}

/** 一个阶段的通行证（`PASSED` 文件的内容）。 */
export interface StagePassport {
  readonly passportVersion: 1
  readonly stage: StageId
  readonly index: number
  readonly at: string
  readonly status: 'passed' | 'stale'
  /**
   * **通过得干不干净** —— 与 `status` 分开的一个轴（红队 F6）。
   *
   * `status: 'passed'` 说的是"可以往下走"；`cleanliness` 说的是"走得多干净"：
   * - `clean`：门禁全 0；
   * - `unverified-gates`：有门禁给 `2`（无法判定）——**可签发但不算通过**，
   *   缺口在 `unverifiedGates` 里点名。
   *
   * 为什么单独一个字段：把 `status: "passed"` 与 code 2 并列会被下游当绿灯读，
   * 而"`2` 不等于通过"是本项目反复强调的纪律。机器可读的分离胜过措辞约定。
   */
  readonly cleanliness?: 'clean' | 'unverified-gates'
  /** 上游摘要 + 技能版本 + 门禁版本 的合成摘要。上游一变，本证失效。 */
  readonly inputDigest: string
  /** 产物名 → sha256（目录型产物记 `dir:<文件数>`）。 */
  readonly artifacts: Readonly<Record<string, string>>
  readonly gate: GateVerdict
  /** 被标 stale 时写明原因（谁回滚了、何时）。 */
  readonly staleReason?: string
  /**
   * **无法判定**的门禁 id（`code 2`）。
   *
   * 它们既不是通过、也不是失败：判据还没实现（或本轮判不了）。记在证上有两个作用——
   * ① "`2` 不等于通过"这条纪律落在纸面上，谁想宣称 CLEAN 就得先补上它们；
   * ② 事后能回答"这一轮有哪些判据其实没跑"。
   */
  readonly unverifiedGates?: ReadonlyArray<string>
  /**
   * **逐节点审计的结论**（用户新增约束）。
   *
   * 记在通行证上而不是只写阶段目录，是为了让"这一轮是谁审的、判了多少分、有哪些要求没完成"
   * 成为**交付物的一部分**——下游（与人工检查）读通行证就能看到，不必去翻阶段目录。
   */
  readonly audit?: AuditVerdict
}

/**
 * 通行证文件名。
 *
 * 导出给 runner 的"重跑 = 替换"用：它要能认出哪些是 harness 自己的记账文件、
 * 不能当"上一轮模型产物"删掉。两份清单各写一个字面量迟早会漂移。
 */
export const PASSPORT_FILE = 'PASSED'

/**
 * 签发通行证。
 *
 * **门禁不过就拒绝签发**——这是"默认准入 = 门禁全过"在代码里的落点。`code === 2`
 * 也拒绝：无法判定不是通过。
 *
 * @param spec - 阶段。
 * @param input - 上游摘要、技能/门禁版本、产物哈希、门禁结论。
 * @returns 通行证。
 */
export function passportFor(
  spec: StageSpec,
  input: {
    readonly upstreamDigests: ReadonlyArray<string>
    readonly skillVersion: string
    readonly gateVersion: string
    readonly artifacts: Readonly<Record<string, string>>
    readonly gate: GateVerdict
    readonly unverifiedGates?: ReadonlyArray<string>
    /** 逐节点审计的结论（有则记进通行证）。 */
    readonly audit?: AuditVerdict
    readonly now?: string
  },
): StagePassport {
  // `1`（硬失败）→ 拒绝签发。
  if (input.gate.code === 1) {
    throw new Error(
      `refusing to issue PASSED for stage '${spec.id}': gate code 1 (hard failure)`
      + ` — ${input.gate.items.filter(i => !i.ok).map(i => i.id).join('、') || '(no failing item listed)'}`,
    )
  }
  // `2`（无法判定）→ **可以签发，但必须把"哪些门禁没判"记在证上**。
  //
  // 这条契约是本文件里唯一一处刻意允许"非全过也签发"的地方，理由写在 `runner.ts`
  // 的模块头：让 `2` 阻断阶段会让**所有门禁实现完之前系统完全不可运行**；而
  // `CLEAN/MARKED/DEGRADED/ESCALATE` 这套既有阶梯本来就是"检出问题但如实标注、
  // 不零掉产物"。
  //
  // 但"`2` 不等于通过"这条纪律**没有丢**：证上必须带 `unverifiedGates`，交付侧
  // 按它降档。**忘了记就等于把它当成了通过**，所以这里强制非空。
  if (input.gate.code === 2) {
    const unverified = input.unverifiedGates ?? []
    if (unverified.length === 0) {
      throw new Error(
        `refusing to issue PASSED for stage '${spec.id}': gate code 2 (cannot judge) requires`
        + ' `unverifiedGates` to name WHICH gates were unjudgeable — recording nothing would'
        + ' amount to treating "cannot judge" as "passed"',
      )
    }
  }
  return {
    passportVersion: 1,
    stage: spec.id,
    index: spec.index,
    at: input.now ?? new Date().toISOString(),
    status: 'passed',
    cleanliness: input.gate.code === 0 ? 'clean' : 'unverified-gates',
    inputDigest: inputDigestOf({
      upstreamDigests: input.upstreamDigests,
      skillVersion: input.skillVersion,
      gateVersion: input.gateVersion,
    }),
    artifacts: input.artifacts,
    gate: input.gate,
    ...(input.unverifiedGates === undefined || input.unverifiedGates.length === 0
      ? {}
      : { unverifiedGates: input.unverifiedGates }),
    ...(input.audit === undefined ? {} : { audit: input.audit }),
  }
}

/** 写通行证（覆盖同名文件；`stale` 状态同样写在这里，不另开文件）。 */
export async function writePassport(stagesRoot: string, passport: StagePassport): Promise<string> {
  const spec = STAGES.find(s => s.id === passport.stage)
  if (spec === undefined) throw new Error(`unknown stage in passport: ${passport.stage}`)
  const dir = join(stagesRoot, stageDirName(spec))
  await mkdir(dir, { recursive: true })
  const file = join(dir, PASSPORT_FILE)
  await writeFile(file, `${JSON.stringify(passport, null, 2)}\n`, 'utf8')
  return file
}

/** 读通行证；不存在或损坏返回 null（**不猜**）。 */
export async function readPassport(stagesRoot: string, spec: StageSpec): Promise<StagePassport | null> {
  const raw = await readFile(join(stagesRoot, stageDirName(spec), PASSPORT_FILE), 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as StagePassport
    return parsed.passportVersion === 1 ? parsed : null
  } catch {
    return null
  }
}

/** 一个阶段的全部上游通行证摘要（按上游阶段序号排序；缺失的记空串以便发现缺口）。 */
export async function upstreamDigestsOf(
  stagesRoot: string,
  spec: StageSpec,
): Promise<ReadonlyArray<string>> {
  const upstream = STAGES.filter(s => s.index < spec.index)
  const out: string[] = []
  for (const up of upstream) {
    const passport = await readPassport(stagesRoot, up)
    out.push(passport === null ? '' : passport.inputDigest)
  }
  return out
}

/**
 * 本阶段能否启动。
 *
 * 三查：上游哨兵**存在**、**非 stale**、且**摘要与本次一致**。任一不满足都拒绝启动
 * 并说明是哪一环失效——而不是"跑起来再说"。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @param spec - 本阶段。
 * @param skillVersion - 本阶段技能的版本（进摘要）。
 * @param gateVersion - 本阶段门禁的版本（进摘要）。
 * @returns 就绪判定；不就绪时给出可读原因。
 */
export async function stageReady(
  stagesRoot: string,
  spec: StageSpec,
  skillVersion: string,
  gateVersion: string,
): Promise<{ readonly ok: boolean; readonly reason: string; readonly inputDigest: string }> {
  const upstream = STAGES.filter(s => s.index < spec.index)
  for (const up of upstream) {
    const passport = await readPassport(stagesRoot, up)
    if (passport === null) {
      return { ok: false, reason: `上游阶段 '${up.id}' 没有 PASSED —— 本阶段不能启动`, inputDigest: '' }
    }
    if (passport.status !== 'passed') {
      return {
        ok: false,
        reason: `上游阶段 '${up.id}' 的 PASSED 已作废（stale：${passport.staleReason ?? '未注明'}）—— 需先重跑它`,
        inputDigest: '',
      }
    }
  }
  const digests = await upstreamDigestsOf(stagesRoot, spec)
  const digest = inputDigestOf({ upstreamDigests: digests, skillVersion, gateVersion })
  return { ok: true, reason: '', inputDigest: digest }
}

/**
 * 校验一个已存在的通行证是否仍与当前上游一致。
 *
 * 用途：从磁盘恢复一次运行时，确认"这一片还算数"。摘要不一致 → 作废。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @param spec - 阶段。
 * @param skillVersion - 当前技能版本。
 * @param gateVersion - 当前门禁版本。
 * @returns 是否仍有效。
 */
export async function passportStillValid(
  stagesRoot: string,
  spec: StageSpec,
  skillVersion: string,
  gateVersion: string,
): Promise<boolean> {
  const passport = await readPassport(stagesRoot, spec)
  if (passport === null || passport.status !== 'passed') return false
  const digests = await upstreamDigestsOf(stagesRoot, spec)
  return passport.inputDigest === inputDigestOf({ upstreamDigests: digests, skillVersion, gateVersion })
}

/**
 * 回滚：把**序号大于 `toStage` 的**全部哨兵标 `stale`。
 *
 * **不删除**——旧哨兵是"修之前长什么样"的唯一证据（与切片 `.superseded-N` 同一条纪律）。
 *
 * @param stagesRoot - `stages/` 根目录。
 * @param toStage - 回滚目标阶段（它自己保持有效）。
 * @param reason - 作废原因（写进每个被作废的哨兵，便于事后追溯是谁触发的）。
 * @returns 被作废的阶段 id。
 */
export async function markStaleFrom(
  stagesRoot: string,
  toStage: StageId,
  reason: string,
): Promise<ReadonlyArray<StageId>> {
  const target = STAGES.find(s => s.id === toStage)
  if (target === undefined) throw new Error(`unknown rollback target: ${toStage}`)
  const stale: StageId[] = []
  for (const spec of STAGES) {
    if (spec.index <= target.index) continue
    const passport = await readPassport(stagesRoot, spec)
    if (passport === null) continue
    await writePassport(stagesRoot, { ...passport, status: 'stale', staleReason: reason })
    stale.push(spec.id)
  }
  return stale
}

/**
 * 产物的哈希表（进通行证）。
 *
 * 目录型产物记 `dir:<文件数>` —— 对目录取哈希要先定义遍历顺序与是否含子目录，
 * 那是把不确定性藏进一个看起来确定的值里；文件数 + 目录内每个文件的哈希另记在
 * 阶段自己的清单里。
 *
 * @param dir - 阶段目录。
 * @param specs - 该阶段的产出清单。
 * @returns 产物名 → 摘要。
 */
export async function artifactDigests(
  dir: string,
  specs: StageSpec['produces'],
): Promise<Readonly<Record<string, string>>> {
  const out: Record<string, string> = {}
  for (const spec of specs) {
    if (spec.kind === 'dir') {
      const entries = await readdir(join(dir, spec.file)).catch(() => [] as string[])
      out[spec.file] = `dir:${String(entries.length)}`
      continue
    }
    const text = await readFile(join(dir, spec.file), 'utf8').catch(() => null)
    out[spec.file] = text === null ? 'MISSING' : digestOf(text)
  }
  return out
}
