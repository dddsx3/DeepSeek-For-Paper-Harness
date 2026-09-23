/**
 * L6-b — finding 数据契约。
 *
 * ## 为什么要有契约
 *
 * "检出问题"这件事本身没有价值——**有归宿**才有价值。一个 finding 如果没有
 * 终止状态，它就会一直躺在报告里，直到被交付出去当作没发生过。这不是假想：
 * 四次真实运行里，最后一次修复**没有一次**被独立复评过，而其中两份的修复日志
 * 是诚实的（抽验 5/5 落地）——问题不在"假报修复"，在**最后一轮之后没有任何
 * 独立复评**，而复评恰恰是唯一能发现"修得对不对"的环节。
 *
 * 所以契约里的每个字段都必须有**下游消费者**；没有消费者的字段不该存在。
 *
 * ## 四条硬约束（C1–C4）
 *
 * 每条都对应一次实测到的失败，见各自常量上的注释。它们是**代码里的断言**，
 * 不是文档里的倡议。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/finding
 */

/**
 * 闭环层的严重度。
 *
 * 与 IR 的 `FindingSeverity`（`CRITICAL|MAJOR|MINOR`，评审缺陷的词汇）**不是
 * 同一个东西**，因此刻意取了不同的名字：评审严重度描述"这条缺陷有多严重"，
 * 这里的严重度描述"它能不能越过闭环直接拒绝交付"。两套词汇混用会让
 * "CRITICAL 到底会不会 BLOCK"变成一个靠上下文猜的问题。
 *
 * `fatal` 是唯一可以越过闭环直接拒绝的档位。
 */
export const CLOSURE_SEVERITIES = ['fatal', 'major', 'minor'] as const
export type ClosureSeverity = (typeof CLOSURE_SEVERITIES)[number]

/**
 * finding 的终止状态。**只允许这五种，且没有"未处理"这个终态**。
 *
 * - `open` — 未消解（**不是终态**；一个留在 open 的 finding 会阻止"交付完成"）
 * - `fixed` — 已修，且**复验通过**（fingerprint 变了）
 * - `accepted` — 显式接受：如实写进交付物的"已知缺陷表"。**这是一等公民，不是失败。**
 * - `rejected` — 明确驳回，附反驳证据（例如 checker 误报）
 * - `unverifiable` — checker 本身跑不起来。**与"未通过"同级**，不是中性状态（C3）
 */
export const FINDING_STATES = ['open', 'fixed', 'accepted', 'rejected', 'unverifiable'] as const
export type FindingState = (typeof FINDING_STATES)[number]

/** 终态集合——只有这些状态允许"交付完成"。 */
export const TERMINAL_FINDING_STATES: ReadonlySet<FindingState> = new Set(['fixed', 'accepted', 'rejected', 'unverifiable'])

/**
 * 一条 finding。
 *
 * 字段与消费者的对应关系（**没有消费者的字段不该存在**）：
 *
 * | 字段 | 消费者 | 缺了会怎样 |
 * |---|---|---|
 * | `checker` | 闭环复验（重跑**同一个** checker） | 无法做 fingerprint 比对 |
 * | `where.artifactScope` | 闭环分派 | 无法决定谁修，会退回"改文字" |
 * | `fingerprint` | 闭环复验 | 无法判断"是否真的修了" |
 * | `fixHint` | 修复者 | 修复质量下降 |
 * | `state` / `attempts` | 闭环预算 | 无法防震荡 |
 */
export interface Finding {
  /** 稳定 id（同一 checker + 同一 scope 的同一问题 → 同一 id，便于跨轮比对）。 */
  readonly id: string
  /** 类别，如 `numeric_channel` / `prose_contract`。与门禁 id 对齐，便于查微教学。 */
  readonly category: string
  readonly severity: ClosureSeverity
  /** 产出它的 checker 名——复验要跑**同一个**。 */
  readonly checker: string
  /** 位置：具体文件（可带 `:行号`）与受影响的产物范围。 */
  readonly where: {
    readonly files: ReadonlyArray<string>
    /** 修复分派的依据：这个 finding 落在哪些产物上。 */
    readonly artifactScope: ReadonlyArray<string>
  }
  /** 证据：可被独立复核的事实（数值、mtime、diff 摘要），不是"我认为"。 */
  readonly evidence: string
  /** 复验比对的指纹——checker 对该产物算出的、会随修复而改变的值。 */
  readonly fingerprint: string
  /** 建议修法。 */
  readonly fixHint: string
  readonly state: FindingState
  /** 已经尝试修复的次数（防震荡：计入同一预算）。 */
  readonly attempts: number
}

/** 复验结果：checker 重跑后给出的新指纹，或"跑不起来"。 */
export type RecheckOutcome =
  | { readonly kind: 'fingerprint'; readonly value: string }
  | { readonly kind: 'checker_failed'; readonly reason: string }

/**
 * 修复分派表——**对抗成本不对称的关键**。
 *
 * 这张表存在的理由是一个实测事实：一次真实修复**只碰了论文正文**，因为改文字
 * 比重跑代码便宜得多。架构若不明文规定分派规则，它就总会选便宜的那条——
 * 而"改论文去迎合旧数字"恰恰是最坏的选择。
 */
export interface DispatchRule {
  /** 产物范围的前缀匹配。 */
  readonly scopePrefix: string
  /** 谁修。 */
  readonly assignee: string
  /** **禁止**做的事——写进 finding 的 fixHint 前置句，避免修复者走便宜路径。 */
  readonly forbidden: string
}

export const DISPATCH_RULES: ReadonlyArray<DispatchRule> = [
  { scopePrefix: 'code/', assignee: '代码技能（重跑）', forbidden: '禁止改写论文里的数字来"对齐"代码' },
  { scopePrefix: 'results/', assignee: '重跑产出脚本', forbidden: '禁止文本编辑该结果文件' },
  { scopePrefix: 'figures/', assignee: '重绘（重跑产出脚本）', forbidden: '禁止改数据源来迁就旧图' },
  { scopePrefix: 'paper/', assignee: '写作技能（允许直接编辑）', forbidden: '' },
  { scopePrefix: 'DELIVERABLES.json', assignee: '交付清单维护者', forbidden: '禁止删条目来消除 finding' },
]

/**
 * 按产物范围决定谁修。
 *
 * 未命中任何规则时返回"无法分派"——调用方必须把它推进消解（接受/驳回），
 * **不允许**默默留在 open。
 *
 * @param artifactScope - finding 的产物范围。
 */
export function dispatchOf(artifactScope: ReadonlyArray<string>): {
  readonly assignee: string
  readonly forbidden: string
  readonly matched: boolean
} {
  for (const scope of artifactScope) {
    const rule = DISPATCH_RULES.find(r => scope.startsWith(r.scopePrefix))
    if (rule !== undefined) return { assignee: rule.assignee, forbidden: rule.forbidden, matched: true }
  }
  return { assignee: '未分派（直接进消解）', forbidden: '', matched: false }
}

/**
 * 计算一条 finding 的稳定 id。
 *
 * **`occurrence` 不是可选的装饰**：同一个 checker 在**同一次检出**里可以对不同
 * 产物报出多条指纹相同的 finding（例如同一条门禁对两个不同文件各报一次）。
 * 若 id 只由 (checker, category, fingerprint) 派生，这些条目会**撞成同一个 id**，
 * 而闭环按 id 消解——重复项就永远留在 `open`，终局被误判为 `ESCALATE`。
 *
 * 因此 id 必须按**出现次序**去重：第 0 次是身份（历史归档逐字节不变），
 * 第 n 次带 `#n` 后缀。
 *
 * @param checker - 产出它的 checker 名。
 * @param category - 类别。
 * @param fingerprint - 该 checker 对被检产物算出的违规指纹。
 * @param occurrence - 同一 (checker, category, fingerprint) 在本轮内的第几次出现（从 0 起）。
 */
export function findingIdOf(checker: string, category: string, fingerprint: string, occurrence = 0): string {
  // 短哈希足够：同 checker + 同类别 + 同指纹 + 同出现次序 = 同一个问题。
  let h = 0
  const seed = `${checker}::${category}::${fingerprint}`
  for (let i = 0; i < seed.length; i += 1) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0
  }
  const base = `F-${(h >>> 0).toString(16).padStart(8, '0')}`
  return occurrence === 0 ? base : `${base}#${String(occurrence)}`
}

/** 从任意字段拼出一条 finding（统一入口，保证 id 与字段一致）。 */
export function makeFinding(input: {
  readonly category: string
  readonly severity: ClosureSeverity
  readonly checker: string
  readonly files: ReadonlyArray<string>
  readonly artifactScope: ReadonlyArray<string>
  readonly evidence: string
  readonly fingerprint: string
  readonly fixHint: string
  /** 同一 (checker, category, fingerprint) 在本轮内的第几次出现（从 0 起）。 */
  readonly occurrence?: number
}): Finding {
  return {
    id: findingIdOf(input.checker, input.category, input.fingerprint, input.occurrence ?? 0),
    category: input.category,
    severity: input.severity,
    checker: input.checker,
    where: { files: input.files, artifactScope: input.artifactScope },
    evidence: input.evidence,
    fingerprint: input.fingerprint,
    fixHint: input.fixHint,
    state: 'open',
    attempts: 0,
  }
}

/**
 * 渲染交付物附录里的**已知缺陷表**。
 *
 * 这是"检测到但没修"成为**一等公民且对用户可见**的落点。实测依据：一次真实交付
 * 以 `PASS_WITH_FIXES` 出包，用户看到的是"通过"，而不是"还有 2 个 major 未修"。
 * 本表要改的就是这件事。
 *
 * @param findings - 全部 finding（含已修与已接受的）。
 */
export function renderKnownDefectsTable(findings: ReadonlyArray<Finding>): string {
  if (findings.length === 0) return ''
  const unresolved = findings.filter(f => f.state === 'accepted' || f.state === 'rejected' || f.state === 'unverifiable')
  const lines: string[] = []
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 附录：已知缺陷表（自动生成）')
  lines.push('')
  lines.push(`本稿交付时共有 ${String(findings.length)} 项被检出的问题，其中 ${String(unresolved.length)} 项未修复或未证实已修。下表逐项列出状态与证据，供复核者判断本稿的可用范围。`)
  lines.push('')
  lines.push('| # | 严重度 | 类别 | 状态 | 位置 | 证据 |')
  lines.push('|---|---|---|---|---|---|')
  findings.forEach((f, i) => {
    const where = f.where.files.join('、').replace(/\|/g, '\\|')
    const evidence = f.evidence.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${String(i + 1)} | ${f.severity} | ${f.category} | ${STATE_LABEL[f.state]} | ${where} | ${evidence} |`)
  })
  lines.push('')
  lines.push('*状态含义：已修复＝复验指纹已改变；已接受＝确认存在但本轮不修；已驳回＝有反驳证据；无法复验＝检查器本身未跑通（与未通过同级）。*')
  return lines.join('\n')
}

/** 状态的中文标签（给读者看，不是给代码看）。 */
export const STATE_LABEL: Readonly<Record<FindingState, string>> = {
  open: '未消解',
  fixed: '已修复（复验通过）',
  accepted: '已接受（如实披露）',
  rejected: '已驳回（附证据）',
  unverifiable: '无法复验',
}
