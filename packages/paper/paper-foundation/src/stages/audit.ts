/**
 * 逐节点**独立审计** —— 每个关键节点交付前，由另一个 AI 角色先审一遍。
 *
 * ## 为什么必须有它（用户新增的架构约束）
 *
 * 原设计里审计只在阶段 8（逻辑对抗复核）发生，而阶段 8 是**全量审计**：它看的是完整报告，
 * 做的是独立核算与全局检验。把"这一轮到底有没有按要求做完"也押到那时才判，代价不可接受：
 * 一个模型连续跑完分析、建模、编程、绘图、写作，**中间没人复核**，到阶段 8 才发现问题，
 * 前面所有轮次的算力与 token 都已经付掉了，而且要整段回滚。
 *
 * 所以审计分两层：
 *
 * | 层 | 谁做 | 看什么 | 判什么 |
 * |---|---|---|---|
 * | **逐节点审计**（本模块） | 每个关键节点后的**独立审计角色** | 本阶段的**契约 + 产物** | ① 这一轮执行者是否按要求完成；② 交付结构是否完整；③ 质量初判。**低于阈值不许交付** |
 * | **全局审计**（阶段 8） | 复核角色 | **完整报告 + 全部上游产物 + 账本** | 独立核算、交叉检验、跨阶段一致性 |
 *
 * ## 独立性是审计的全部价值（所以本模块的提示词只有契约与产物）
 *
 * 审计员**看不到执行者的提示词与推理**，只看"契约要求什么"与"磁盘上实际是什么"。
 * 若把执行者的自述也给它，它会顺着执行者的框架去理解产物——那正是"自己审自己"的失效模式。
 *
 * ## 判定与阈值
 *
 * 审计员必须返回**结构化 JSON**（不是散文评价）：`verdict` + `score` + 逐条要求对照 +
 * findings + missing。机械判据：
 * - 任一 `fatal` finding → 失败；
 * - `score < 阈值`（默认 0.7）→ 失败；
 * - 结构不完整（`structure_ok: false` 或 `missing` 非空）→ 失败。
 *
 * 失败即**不签发通行证**（"低于阈值不允许交付"），并按阶段声明的 `rollbackTo` 建议回滚。
 *
 * ## 审计本身跑不了时：记 `2`，不当通过
 *
 * 审计调用失败（配额、坏 JSON、空回答）时**不能当成通过**——本项目反复强调 `2 ≠ 0`。
 * 所以那种情况记为"无法判定"，进通行证的 `unverifiedGates`（本阶段可继续但**不能计入 CLEAN**），
 * 并在检查点报告里如实写明"这一轮没有被审计"。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/audit
 */

import type { StageSpec } from './registry.ts'

/** 审计发现的一条问题。 */
export interface AuditFinding {
  readonly severity: 'fatal' | 'major' | 'minor'
  readonly where: string
  readonly issue: string
  readonly fix: string
}

/** 逐条要求对照。 */
export interface RequirementCheck {
  readonly item: string
  readonly done: boolean
  readonly note: string
}

/** 审计结论。 */
export interface AuditVerdict {
  readonly stage: string
  readonly verdict: 'pass' | 'fail'
  /** 0–1 的质量初判分（审计员给，机械阈值判）。 */
  readonly score: number
  readonly structureOk: boolean
  readonly requirementCompliance: ReadonlyArray<RequirementCheck>
  readonly findings: ReadonlyArray<AuditFinding>
  readonly missing: ReadonlyArray<string>
  /** 审计用的模型（进通行证，便于事后追"这一轮是谁审的"）。 */
  readonly model: string
  readonly at: string
}

/** 审计的机械判定：阈值 + 结构 + fatal。 */
export interface AuditGateInput {
  readonly minScore: number
}

/** 审计的判定结果。 */
export interface AuditDecision {
  readonly ok: boolean
  readonly reason: string
}

/**
 * 机械判定一条审计结论是否放行。
 *
 * 三条判据**任一不满足即不放行**（用户的"低于阈值不允许交付"）：
 * ① 任一 `fatal`；② `score < minScore`；③ 结构不完整或有 missing。
 *
 * @param verdict - 审计结论。
 * @param input - 阈值。
 * @returns 判定与具名原因。
 */
export function decideAudit(verdict: AuditVerdict, input: AuditGateInput): AuditDecision {
  const fatal = verdict.findings.filter(f => f.severity === 'fatal')
  const problems: string[] = []
  if (fatal.length > 0) {
    problems.push(`${String(fatal.length)} 条 fatal（${fatal.slice(0, 2).map(f => `${f.where}：${f.issue.slice(0, 40)}`).join('；')}）`)
  }
  if (!(verdict.score >= input.minScore)) {
    problems.push(`质量分 ${verdict.score.toFixed(2)} < 阈值 ${input.minScore.toFixed(2)}`)
  }
  if (!verdict.structureOk || verdict.missing.length > 0) {
    problems.push(`交付结构不完整${verdict.missing.length > 0 ? `（缺：${verdict.missing.slice(0, 4).join('、')}）` : ''}`)
  }
  const undone = verdict.requirementCompliance.filter(r => !r.done)
  if (undone.length > 0) {
    problems.push(`${String(undone.length)} 项要求未完成（${undone.slice(0, 3).map(r => r.item.slice(0, 30)).join('、')}）`)
  }
  return problems.length === 0
    ? { ok: true, reason: `审计通过（质量分 ${verdict.score.toFixed(2)}，要求 ${String(verdict.requirementCompliance.length)} 项全部完成）` }
    : { ok: false, reason: `审计未通过：${problems.join('；')}` }
}

/**
 * 构造**审计提示词** —— 只有契约与产物，没有执行者的任何自述。
 *
 * @param spec - 阶段（提供 produces / gates / 标题）。
 * @param skillTask - 该阶段给执行者的任务陈述（**契约的一部分**，不是执行者的推理）。
 * @param artifacts - 本阶段产出的 `文件名 → 文本`。
 * @param upstreamNames - 上游可见的产物名（审计员需要知道"上游给了什么"，以便判"要求是否被满足"）。
 * @param budgetChars - 单个产物的内联上限（超出截断并**明说**）。
 * @returns 审计提示词。
 */
export function auditPromptOf(input: {
  readonly spec: StageSpec
  readonly skillTask: string
  readonly artifacts: ReadonlyMap<string, string>
  readonly upstreamNames: ReadonlyArray<string>
  readonly budgetChars?: number
}): string {
  const budget = input.budgetChars ?? 12_000
  const L: string[] = []
  L.push('你是**独立审计员**。你的职责不是重做任务，而是判断这一阶段的执行者**是否按要求完成了任务**、'
    + '交付结构是否完整、以及这一轮产物够不够格进入下一阶段。')
  L.push('')
  L.push('你**只看得到契约与产物**，看不到执行者的提示词与推理过程——这是刻意的：独立性是审计的全部价值。'
    + '不要顺着"执行者大概是怎么想的"去理解产物，只对照契约看磁盘上实际有什么。')
  L.push('')
  L.push(`## 被审阶段：${String(input.spec.index)}. ${input.spec.title}（\`${input.spec.id}\`）`)
  L.push('')
  L.push('### 任务陈述（执行者收到的契约）')
  L.push(input.skillTask)
  L.push('')
  L.push('### 产出契约（每一条都要核）')
  for (const p of input.spec.produces) {
    const floor = p.minBytes === undefined ? '' : `，≥ ${String(p.minBytes)} 字节`
    L.push(`- \`${p.file}\`（${p.kind}${floor}）—— ${p.desc}`)
  }
  L.push('')
  L.push('### 机械门禁（已由 harness 跑过，你不需要重跑）')
  for (const g of input.spec.gates) L.push(`- \`${g}\``)
  L.push('')
  if (input.upstreamNames.length > 0) {
    L.push('### 上游给了什么（判断"要求是否被满足"的依据）')
    for (const n of input.upstreamNames) L.push(`- \`${n}\``)
    L.push('')
  }
  L.push('### 本阶段实际产出的内容')
  if (input.artifacts.size === 0) {
    L.push('（**没有任何产物**——这本身就是 fatal。）')
  }
  for (const [name, text] of input.artifacts) {
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes <= budget) {
      L.push(`#### \`${name}\`（${String(bytes)} 字节）`, '', text, '')
      continue
    }
    const cut = Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8')
    L.push(`#### \`${name}\`（${String(bytes)} 字节，**只内联前 ${String(budget)} 字节**）`, '', cut, '',
      `（\`${name}\` 被截断——不要因为"没看到"就判它缺内容；只对可见部分下判断。）`, '')
  }
  L.push('## 你要回答三件事')
  L.push('1. **要求完成度**：逐条对照上面的任务陈述与产出契约——执行者是否真的做了每一件？'
    + '特别注意"看起来做了但其实没有"的形态（空壳、占位符、把要求复述一遍当完成）。')
  L.push('2. **交付结构**：产物是否齐备、形态是否正确、有无自相矛盾或与上游冲突？')
  L.push('3. **质量初判**：这一轮产物够不够格进入下一阶段？给一个 0–1 的分。')
  L.push('')
  L.push('## 输出（**只输出一个 JSON 对象，前后不得有任何其它字符**）')
  L.push('```json')
  L.push('{"verdict":"pass"|"fail","score":0.0,"structure_ok":true,')
  L.push(' "requirement_compliance":[{"item":"<契约里的某条>","done":true,"note":"<依据>"}],')
  L.push(' "findings":[{"severity":"fatal"|"major"|"minor","where":"<文件/位置>","issue":"<问题>","fix":"<怎么修>"}],')
  L.push(' "missing":["<缺什么>"]}')
  L.push('```')
  L.push('判定纪律：**任一 fatal 必须 verdict=fail**；score<0.7 必须 verdict=fail；'
    + '结构不完整或 missing 非空必须 verdict=fail。不要"为了不挡路"而给 pass——'
    + '你放行的东西会直接进入下一阶段，而下一阶段会把它当真。')
  return L.join('\n')
}

/**
 * 严格解析审计员的回答。
 *
 * @param raw - 模型回答。
 * @param spec - 阶段。
 * @param model - 审计用的模型名（进结论）。
 * @returns 审计结论。
 * @throws 回答里没有合法 JSON、缺必填字段、或字段类型不对时抛错（**具名**，
 *   由调用方记成"无法判定"而不是"通过"）。
 */
export function parseAuditVerdict(raw: string, spec: StageSpec, model: string, now: string): AuditVerdict {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error(`审计回答里没有 JSON 对象（${String(raw.length)} 字符）—— 无法判定，不当作通过`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch (error) {
    throw new Error(`审计回答的 JSON 不合法：${String(error).slice(0, 120)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('审计回答不是 JSON 对象')
  }
  const obj = parsed as Record<string, unknown>
  const score = obj['score']
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new Error('审计回答缺 `score`（0–1 的数字）—— 没有分数就无法按阈值判定')
  }
  const verdict = obj['verdict']
  if (verdict !== 'pass' && verdict !== 'fail') {
    throw new Error(`审计回答的 verdict 必须是 pass/fail，得到 ${JSON.stringify(verdict)}`)
  }
  const structureOk = obj['structure_ok'] !== false // 缺省视为 true（不因字段缺失而误判失败）
  const findings: AuditFinding[] = []
  if (Array.isArray(obj['findings'])) {
    for (const f of obj['findings'] as ReadonlyArray<Record<string, unknown>>) {
      const severity = f['severity']
      findings.push({
        severity: severity === 'fatal' || severity === 'major' || severity === 'minor' ? severity : 'minor',
        where: String(f['where'] ?? '（未指明位置）'),
        issue: String(f['issue'] ?? ''),
        fix: String(f['fix'] ?? ''),
      })
    }
  }
  const compliance: RequirementCheck[] = []
  if (Array.isArray(obj['requirement_compliance'])) {
    for (const c of obj['requirement_compliance'] as ReadonlyArray<Record<string, unknown>>) {
      compliance.push({
        item: String(c['item'] ?? ''),
        done: c['done'] === true,
        note: String(c['note'] ?? ''),
      })
    }
  }
  const missing = Array.isArray(obj['missing']) ? (obj['missing'] as ReadonlyArray<unknown>).map(String) : []
  return {
    stage: spec.id, verdict, score, structureOk,
    requirementCompliance: compliance, findings, missing, model, at: now,
  }
}
