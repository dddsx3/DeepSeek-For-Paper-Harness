/**
 * 产出前自检**工具** —— 让"提交前先检查"成为一次可执行的调用，而不是一段请求。
 *
 * ## 为什么必须有它（实测的证据）
 *
 * 把自检写进 prompt 之后，真实运行里**仍然**出现 2 次容器结构失败与 3 次散文契约
 * 失败。结论很直接：**模型不会因为被告知就照做。** 一段"提交前请核对……"的文字是
 * **请求**；一次返回具体错误的调用才是**检查**。
 *
 * ## 它只做**提交时可判**的检查，并且明说哪些不做
 *
 * 这条边界是刻意的，也是本模块最容易写错的地方。第一次写的时候我把
 * `numeric_config.json` 的键解析也塞了进来——那是**空转**：配置文件的字节是模型的
 * `code` 在**运行期**写出的，提交前它根本不存在，任何"检查"都只能是猜。
 *
 * | 判据 | 提交时可判？ | 谁负责 |
 * |---|---|---|
 * | 容器可解析、版本标记是首键 | ✅ | 本工具（复用 `parseModelContainer`） |
 * | `entries` 非空、每项 `{kind, value}` | ✅ | 本工具 |
 * | 每个子问题有自己的 ModelSpec | ✅ | 本工具 |
 * | 每个 `[[ASSUMPTION: id]]` 有同名 AssumptionSpec（及反向） | ✅ | 本工具 |
 * | 每个 Result 的 `locator` 在 `run.outputBasenames` 里 | ✅ | 本工具 |
 * | 容器内 id 不重复 | ✅ | 本工具 |
 * | **`numeric_config.json` 的键锚得到已声明的符号** | ❌ **运行期才知道** | 准入链（已改为**部分准入 + 缺口上报**，不再零掉一次尝试） |
 * | **`jsonPath` 解析到的值是不是有限数** | ❌ 运行期才知道 | 准入链 |
 *
 * 把做不到的事说清楚，比多报几条"通过"重要——一个会给假绿的自检工具比没有更糟。
 *
 * ## 关键设计约束：与门禁**同源**
 *
 * 自检若与真正的准入检查各写一份，迟早漂移，那时它比没有更糟：它会给模型一个
 * "检查过了，没问题"的假信号。因此本模块**复用门禁自己的函数**，不重新实现判据。
 *
 * ## 它不是门禁
 *
 * 工具只回答"这份容器现在能不能被准入"，不决定交付。它跑在模型自己手里、可调用
 * 任意多次；真正的准入仍发生在 harness 侧，且仍是权威。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/produce/self-check
 */

import { parseModelContainer } from './ir-producer.ts'
import { checkE1E2Fidelity } from './e1-e2.ts'
import { validateScopeOwnership } from '../ir/refs.ts'
import { IR_SCHEMAS, IR_KINDS, type IrKind } from '../ir/schema.ts'

/** 自检工具的名字（模型看到的函数名）。 */
export const SELF_CHECK_TOOL_NAME = 'check_container'

/** 一次自检的结论。 */
export interface SelfCheckVerdict {
  /** 容器现在能否被准入（就"提交时可判"的那些判据而言）。 */
  readonly admissible: boolean
  /** 逐条问题；`admissible` 为真时为空。 */
  readonly problems: ReadonlyArray<string>
  /** 一句话结论——模型最容易读的那一行。 */
  readonly summary: string
  /** **本工具判不了的东西**，如实列出（防"检查过了"被误读成"全对"）。 */
  readonly notChecked: ReadonlyArray<string>
}

/** 自检需要的上下文。 */
export interface SelfCheckContext {
  /** 已注册的子问题 id（`P1`…）。 */
  readonly scopeRefs: ReadonlyArray<string>
  /**
   * E1 的全文——B3 双向锚定只能拿它比。
   *
   * 缺省（未给）时**跳过**锚定检查并在 `notChecked` 里说明，而不是假装通过。
   */
  readonly e1Text?: string
  /**
   * 本题的 REQUIRED_OUTPUT id 列表（`R-Q1`…）。
   *
   * B4（逐问推理覆盖）只能拿它比对。缺省时**跳过 B4** 并在 `notChecked` 里说明。
   */
  readonly requiredOutputIds?: ReadonlyArray<string>
}

const NOT_CHECKED_RUNTIME = [
  '引用是否指向**已登记**的 id（跨轮次的已注册对象）——这里只看本容器内部的闭合性。',
  `${'`numeric_config.json`'} 的键是否锚得到已声明的符号——**它的字节由 code 在运行期写出，提交前不存在**。准入链对它是"部分准入 + 缺口上报"，不会零掉整次尝试。`,
  '每个 `jsonPath` 是否解析到有限数——同上，运行期才知道。',
  '章节篇幅是否达标——那是对**渲染后的正文**的检查，容器里还没有正文。',
]

/**
 * 检查一份候选容器。
 *
 * 顺序与真实准入**一致**（先解析、再形状、再引用闭合），因此模型在这里看到的
 * 第一个问题，就是它在准入时会被拒的第一个问题。
 *
 * @param containerText - 模型准备提交的容器文本。
 * @param ctx - 已注册的子问题与（可选的）E1 全文。
 */
export function checkCandidateContainer(containerText: string, ctx: SelfCheckContext): SelfCheckVerdict {
  const problems: string[] = []

  // ① 解析。`parseModelContainer` 自己就包含"版本标记必须是首键"这条判据
  //    ——复用它，不另写一份。
  const parsed = parseModelContainer(containerText)
  if (!parsed.ok) {
    return {
      admissible: false,
      problems: [`容器无法解析：${parsed.reason}`],
      summary: `不可准入：${parsed.reason}`,
      notChecked: NOT_CHECKED_RUNTIME,
    }
  }
  const entries = parsed.container.entries

  // ② entries 形状：非空、每项 {kind, value}。
  //    四轮里第二高频的失败（`container 'entries' must be a non-empty array`）。
  if (entries.length === 0) {
    problems.push('`entries` 是空的。它必须是一个**非空**数组，每项形如 {"kind": <KIND>, "value": {…}}。')
  }
  for (const entry of entries) {
    if (typeof entry.kind !== 'string' || entry.kind.length === 0) {
      problems.push('有一条 entry 的 `kind` 不是非空字符串。')
      break
    }
    if (typeof entry.value !== 'object' || entry.value === null || Array.isArray(entry.value)) {
      problems.push(`entry '${entry.kind}' 的 \`value\` 不是对象。`)
      break
    }
  }

  // ③ 容器内 id 不重复（同一容器里重复 id 会被整份拒绝）。
  const seen = new Map<string, string>()
  for (const entry of entries) {
    const idField = ID_FIELD_OF_KIND[entry.kind]
    if (idField === undefined) continue
    const id = (entry.value as Record<string, unknown>)[idField]
    if (typeof id !== 'string' || id.length === 0) continue
    const prior = seen.get(id)
    if (prior !== undefined) {
      problems.push(`id '${id}' 在同一个容器里出现了两次（${prior} 与 ${entry.kind}）。每个 id 只能声明一次——要改措辞就换一个新 id。`)
    }
    seen.set(id, entry.kind)
  }

  // ④ 每个子问题都要有自己的 ModelSpec（逐问覆盖是最高频的交付缺陷之一）。
  const coveredByModel = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'ModelSpec') continue
    const refs = (entry.value as { problem_refs?: unknown }).problem_refs
    if (Array.isArray(refs)) for (const r of refs) if (typeof r === 'string') coveredByModel.add(r)
  }
  const uncovered = ctx.scopeRefs.filter(ref => !coveredByModel.has(ref))
  if (uncovered.length > 0) {
    problems.push(`这些子问题没有自己的 ModelSpec：${uncovered.join('、')}——每个子问题各要一个模型，其 problem_refs 指向该子问题。`)
  }

  // ⑤ 每个 Result 的 locator 必须在 `run.outputBasenames` 里。
  const declaredOutputs = new Set<string>()
  const runBlock = (parsed.container as { run?: { outputBasenames?: unknown } }).run
  if (runBlock !== undefined && Array.isArray(runBlock.outputBasenames)) {
    for (const b of runBlock.outputBasenames) if (typeof b === 'string') declaredOutputs.add(b)
  }
  const interpretations = (parsed.container as { interpretations?: { results?: unknown } }).interpretations
  if (interpretations !== undefined && Array.isArray(interpretations.results)) {
    for (const result of interpretations.results) {
      if (typeof result !== 'object' || result === null) continue
      const source = (result as { source?: { locator?: unknown } }).source
      const locator = source?.locator
      if (typeof locator !== 'string') continue
      if (!declaredOutputs.has(locator)) {
        problems.push(`Result '${String((result as { result_id?: unknown }).result_id ?? '?')}' 的 locator '${locator}' 不在 run.outputBasenames 里（已声明：${[...declaredOutputs].join(', ') || '（空）'}）。`)
      }
    }
  }

  // ⑤b **每条 entry 过一遍它自己的闭 schema**。
  //
  //    这一条是 strict-10 实测补上的：那次 attempt 2 被
  //    `entry 'EquationSpec' violates its closed IR schema — Unrecognized key: "token"`
  //    拒掉，而工具当时只报了"JSON 解析失败"——**闭 schema 违规它能查却没查**。
  //    它是最机械可判的一类（字段名对不对），没有理由留给准入去发现。
  //
  //    复用 `IR_SCHEMAS`：与 store 的 `put` 用的是同一张表，不另写一份。
  for (const entry of entries) {
    if (!IR_KINDS.includes(entry.kind as IrKind)) {
      problems.push(`entry kind '${entry.kind}' 不是合法的 IR 类型。合法值：${IR_KINDS.join('、')}。`)
      continue
    }
    const kind = entry.kind as IrKind
    // ProblemSpec / RequirementSpec 由 harness 登记，模型不得声明——这条与准入一致。
    if (kind === 'ProblemSpec' || kind === 'RequirementSpec') {
      problems.push(`entry '${kind}' 不该由你声明——题面与子问题由 harness 登记，你只引用它们的 id。`)
      continue
    }
    const check = IR_SCHEMAS[kind].safeParse(entry.value)
    if (check.success) continue
    const shown = check.error.issues.slice(0, 3).map((issue) => {
      const at = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${at}${issue.message}`
    })
    problems.push(`entry '${kind}' 不符合它自己的 schema（字段名/取值域必须逐字照宪法）：${shown.join('；')}`)
  }

  // ⑥ 作用域归属（REF-003）。**这是全轮次最高频的准入拒绝**（第一到第五轮里
  //    `reference_scope_mismatch` 一直是第一名，最新一次真实运行仍然是它）。
  //    它完全"提交时可判"：容器自己就带着每条假设/方程的 scope_ref 与每个模型的
  //    problem_refs，不需要 store、不需要跑代码。
  //
  //    复用 `validateScopeOwnership`——同一份判据，不另写一份，这样工具看到的
  //    问题与准入时拒的问题逐字同源。
  const byId = new Map<string, { kind: IrKind; value: Record<string, unknown> }>()
  for (const entry of entries) {
    const idField = ID_FIELD_OF_KIND[entry.kind]
    if (idField === undefined) continue
    const id = (entry.value as Record<string, unknown>)[idField]
    if (typeof id === 'string' && id.length > 0) byId.set(id, { kind: entry.kind as IrKind, value: entry.value })
  }
  const resolve = (ref: string): { kind: IrKind; value: unknown } | undefined => byId.get(ref)
  for (const entry of entries) {
    if (entry.kind !== 'ModelSpec') continue
    const model = entry.value as { model_id?: unknown; problem_refs?: unknown }
    const ownScopes = Array.isArray(model.problem_refs)
      ? model.problem_refs.filter((r): r is string => typeof r === 'string')
      : []
    for (const problem of validateScopeOwnership('ModelSpec', entry.value, ownScopes, resolve)) {
      const target = byId.get(problem.ref)
      const targetScope = target === undefined ? undefined : (target.value as Record<string, unknown>)['scope_ref']
      const targetKind = target?.kind ?? 'AssumptionSpec'
      problems.push(
        `模型 '${String(model.model_id ?? '?')}' 的 \`${problem.path}\` 引用了 '${problem.ref}'，` +
        `而它作用在 ${typeof targetScope === 'string' ? `'${targetScope}'` : '别的作用域'}——这个模型属于 ${ownScopes.length === 0 ? '（没有 problem_refs）' : ownScopes.map(s => `'${s}'`).join('、')}。` +
        `跨子问题引用有两条合法路线，**二选一**：① 在该 ${targetKind} 上写 "shared": true（表示它适用于全部子问题）；` +
        '② 每个子问题各声明一份、id 不同（如 EQ-X-P1、EQ-X-P2）。',
      )
    }
  }

  // ⑦ B3/B4/B5 保真检查——**直接复用 `checkE1E2Fidelity`**。
  //
  //    这一条同样"提交时可判"，而且它是**第二高频**的拒绝类（strict-9 真实运行里
  //    B3 拒了两次，形态是 `e1_span 过短（3 < 10）`）。此前工具不查它，于是模型
  //    在准入时才发现——而那时已经烧掉一次完整的 E2 调用。
  //
  //    不另写一份：`checkE1E2Fidelity` 就是准入时跑的那个函数，工具与门看到的
  //    逐字同源。`requiredOutputIds` 缺省时 B4 无锚可比，如实进 `notChecked`。
  const notChecked = [...NOT_CHECKED_RUNTIME]
  if (ctx.e1Text === undefined) {
    notChecked.push('假设锚点的双向 1:1（未拿到 E1 全文，无法比对）。')
  } else {
    const fidelity = checkE1E2Fidelity({
      e1Text: ctx.e1Text,
      entries,
      requiredOutputIds: ctx.requiredOutputIds ?? [],
    })
    for (const finding of fidelity) {
      if (finding.ok) continue
      problems.push(`[${finding.rule}] ${finding.detail}`)
    }
    if (ctx.requiredOutputIds === undefined) {
      notChecked.push('B4 逐问推理覆盖（未拿到 REQUIRED_OUTPUT 清单）。')
    }
  }
  const admissible = problems.length === 0
  return {
    admissible,
    problems,
    summary: admissible
      ? '就"提交时可判"的判据而言可以准入：解析通过、entries 非空且形状正确、id 无重复、每个子问题都有模型、Result 的 locator 都在已声明的输出里、跨子问题引用合法、E1 锚点逐字对得上。'
      : `发现 ${String(problems.length)} 个问题，改完再提交（下面逐条）。`,
    notChecked,
  }
}

/** 每种 entry kind 的 id 字段名（容器内查重用）。 */
const ID_FIELD_OF_KIND: Readonly<Record<string, string>> = {
  SymbolSpec: 'symbol_id',
  AssumptionSpec: 'assumption_id',
  EquationSpec: 'equation_id',
  ModelSpec: 'model_id',
  DataArtifact: 'data_id',
}

/**
 * 跑一次自检，**保证不抛**。
 *
 * ## 为什么需要这一层
 *
 * 自检是只读帮手，不是门。它自己崩掉时，正确的答案是"这次没帮上忙"——而
 * **不是**让整次模型调用作废：后者会让"工具存在"比"工具不存在"更差。
 *
 * 这不是假想。strict-8 真实运行里，工具通道刚打开就撞上端点把
 * `delta.content` 写成 `null`，异常穿透到调用层，整次 E2 尝试作废；而因为
 * 作废发生在 `E2SelfCheck` 审计写入**之前**，事后连"工具到底有没有被调用过"
 * 都无从判断。一个崩掉的检查器必须**留下痕迹**，而不是把痕迹一起带走。
 *
 * 崩掉时 `admissible` 取 `false` 且 `problems` 里写明这是 harness 的故障——
 * 不静默返回"没问题"（那会让模型以为容器已经过关）。
 *
 * @param check - 真正的判据（通常是 {@link checkCandidateContainer}）。
 * @param containerText - 候选容器全文。
 * @returns 判据的结论；判据抛异常时返回"自检未能完成"。
 */
export function runSelfCheckSafely(
  check: (containerText: string) => SelfCheckVerdict,
  containerText: string,
): SelfCheckVerdict {
  try {
    return check(containerText)
  } catch (error) {
    return {
      admissible: false,
      problems: [`自检本身出错了（这不是你的容器的错）：${error instanceof Error ? error.message : String(error)}。按宪法自查后提交。`],
      summary: '自检未能完成',
      notChecked: ['本次自检没有得出结论——上面那条是 harness 的故障，不是对你的容器的判定。'],
    }
  }
}

/**
 * 把自检的问题清单压成**不含数字**的类别句，供回灌使用。
 *
 * ## 为什么必须无数字
 *
 * 回灌文本会被 `e2DriftGuidance` 逐行 `stripNumericLiterals`——那是 E2 的零数字
 * 纪律（B2：shipped guidance 里不得出现数字字面量）。所以**直接引用工具原文是错的**：
 * `e1_span 过短（3 < 10）` 会被剥成 `e1_span 过短（ < ）`，读起来像乱码。
 *
 * 正确做法是**按构造无数字**：只说"哪一类问题"，不引用量。具体的量在工具结果里
 * ——模型随时可以再调一次工具看到原文。
 *
 * @param problems - 工具给出的问题清单。
 * @returns 一句类别描述（无数字）。
 */
export function selfCheckCategorySentence(problems: ReadonlyArray<string>): string {
  const categories: string[] = []
  const add = (label: string, hit: boolean): void => { if (hit) categories.push(label) }
  add('容器不是合法的 JSON 对象', problems.some(p => p.includes('无法解析')))
  add('entry 的字段名或取值不符合它自己的 schema', problems.some(p => p.includes('schema')))
  add('同一条 id 在容器里出现了两次', problems.some(p => p.includes('两次')))
  add('某个子问题没有自己的模型', problems.some(p => p.includes('没有自己的 ModelSpec')))
  add('Result 的 locator 不在已声明的输出里', problems.some(p => p.includes('locator')))
  add('跨子问题引用不合法', problems.some(p => p.includes('作用在')))
  // 标签里**不能出现 `E1` 这类带数字的标识符**：`stripNumericLiterals` 把每个数字
  // 都换成 `#`，`E1` 会变成 `E#`。标签按构造无数字，原文让模型自己调工具去看。
  add('假设与方程的锚点对不上你的分析稿', problems.some(p => p.includes('B3') || p.includes('B4') || p.includes('B5')))
  add('entries 形状不对', problems.some(p => p.includes('entries')))
  if (categories.length === 0) categories.push('自检报出的问题')
  return categories.join('；')
}
