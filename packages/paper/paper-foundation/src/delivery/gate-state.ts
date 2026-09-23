/**
 * L6-a — 门禁状态机（DORMANT / WARN / ENFORCE）。
 *
 * ## 为什么门禁要有状态
 *
 * 旧形态里每个门禁**永远 ENFORCE**：任何一次违规 → 整条链 BLOCKED。这个设计的
 * 隐含假设是"所有模型都需要全部约束"，而真实情况不是这样：
 *
 *   - 强模型不需要被教怎么写问题分析——它本来就会；
 *   - 弱模型需要，但它需要的是**它被证明踩过的那一条**，不是全部 30 条。
 *
 * 静态 prompt 区分不了这两者，"违规记录"可以。所以门禁默认**静默运行只记录**，
 * 首次违规注入一条**针对性的微教学**（只讲被违反的那一条，几百字），
 * 重复违规才升级为硬拦截。
 *
 * 结果是**一套代码两种行为**：强模型跑完一程可能一个门禁都没感知到；弱模型在
 * 它反复踩坑的那个维度上，自动收紧到与旧形态同等的严格度。
 *
 * ## 它约束的是流程，不是模型
 *
 * 这一点必须写清楚，否则会被误读成"放宽质量"。状态机不限制模型输出什么内容，
 * 它限制的是**流程不许在 findings 未消解的状态下宣布完成**——而那是 C5/C6
 * （语义/事实）在 decode 期原理上无法约束之后，唯一还能在架构层保证的闭环形式。
 *
 * ## 状态转移
 *
 * ```
 *  DORMANT ──首次违规──► WARN ──同维度再次违规──► ENFORCE
 *     │                    │                        │
 *   只记录            记录 + 注入微教学          硬拦截该维度
 * ```
 *
 * 三次以上仍违规：保持 ENFORCE，并写进 run-report 作为能力画像的负反馈
 * （供下次运行把该维度的初始档位调高）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/delivery/gate-state
 */

/**
 * 门禁的激活档位。
 *
 * - `DORMANT` — 检查照常跑，违规只记录不拦截、不教学。
 * - `WARN` — 首次违规注入一条微教学；仍不拦截。
 * - `ENFORCE` — 该维度硬拦截（违规进致命集）。
 */
export const GATE_MODES = ['DORMANT', 'WARN', 'ENFORCE'] as const
export type GateMode = (typeof GATE_MODES)[number]

/**
 * 门禁的**性质**——决定它的规则文本该放在哪一层。
 *
 * 这是"门禁 ⇔ 教学同步"契约的重设计：旧契约要求每条规则文本都出现在 prompt 里，
 * 于是所有约束永远以最贵的形式存在。新契约按成本分流，而分流表是**被测试核对的**
 * （见 `tests/constitution-contract.spec.ts`），所以"漏教"仍然不可能发生。
 *
 * - `interface` — 模型不看到就产不出合法容器 → 规则必须在最小宪法里。
 * - `knowledge` — "怎么写更好" → 规则在技能库里，宪法只给索引。
 */
export type GateRuleHome = 'interface' | 'knowledge'

/** 一个门禁的激活登记。 */
export interface GateActivation {
  /** 门禁 id（与 `gate-registry.ts` / 链内门禁同名）。 */
  readonly id: string
  /** 规则文本该住哪一层。 */
  readonly home: GateRuleHome
  /** `WARN` 档注入的微教学——**只讲这一条**，几百字，不是整本手册。 */
  readonly microTeaching: string
  /** 每个模型能力档位下的初始模式。 */
  readonly initial: Readonly<Record<'S' | 'A' | 'B', GateMode>>
}

/**
 * 门禁激活登记表。
 *
 * **`interface` 类**的门禁，其规则文本必须能在 `PAPER_CONSTITUTION` 里找到；
 * **`knowledge` 类**的必须在技能库某份文档里找到。测试逐条核对这两件事。
 */
export const GATE_ACTIVATIONS: ReadonlyArray<GateActivation> = [
  {
    id: 'container_shape',
    home: 'interface',
    microTeaching: '容器的首字符必须是 `{"__dsh_paper":"ir-container-v1"`，且它必须是**同一个 JSON 对象**的第一个键。不要先写一个标记对象、再写第二个对象。',
    initial: { S: 'DORMANT', A: 'DORMANT', B: 'WARN' },
  },
  {
    id: 'numeric_channel',
    home: 'interface',
    microTeaching: '你刚才在 narrative 里写了一个不是 Result 的数字。改成 `{<result_id>}` 占位符（harness 会注入真实值），或者让 `code` 把这个量 emit 成 Result 再引用。题面给定的常数不是 Result——用文字表述它。',
    initial: { S: 'DORMANT', A: 'WARN', B: 'WARN' },
  },
  {
    id: 'required_output_unpaid',
    home: 'interface',
    microTeaching: '有一个子问题没有自己的 Result + CRITICAL Claim。每个子问题都要单独建模型、跑代码、声明结果——一个总数不算回答四个问题。',
    initial: { S: 'DORMANT', A: 'WARN', B: 'WARN' },
  },
  {
    id: 'figure_required',
    home: 'interface',
    microTeaching: 'interpretations.figures 至少要有**一张图**。只声明结构（figure_id / chart_type / data_refs / caption），字节和哈希由 harness 渲染。',
    initial: { S: 'DORMANT', A: 'WARN', B: 'WARN' },
  },
  {
    id: 'e1_e2_fidelity',
    home: 'interface',
    microTeaching: '保真门是双向的：E1 里每一个 `[[ASSUMPTION: id]]` 锚点都必须在 entries 里有同 id 的 AssumptionSpec，反之亦然。你刚才两个方向有一个对不上——数一遍，不要只声明"重要的那几条"。',
    initial: { S: 'DORMANT', A: 'DORMANT', B: 'WARN' },
  },
  {
    id: 'prose_contract',
    home: 'knowledge',
    microTeaching: '有一个章节低于它的退回线，或者缺了必需的段落要素。篇幅参照与章节要素在 `skills/writing-norms.md`；论文契约在 `skills/paper-contract.md`。读一份再改，不要凭印象补字数。',
    initial: { S: 'DORMANT', A: 'DORMANT', B: 'WARN' },
  },
  {
    id: 'blank_area',
    home: 'knowledge',
    microTeaching: '正文里有连续空行，或某个章节的正文过短（空区域会被判为"占位"）。填充实质内容，不要用空行制造篇幅。',
    initial: { S: 'DORMANT', A: 'WARN', B: 'WARN' },
  },
  {
    id: 'assumption_structure',
    home: 'knowledge',
    microTeaching: '有假设没有被任何模型引用，或者缺 justification。假设的闭环规则在 `skills/paper-contract.md` 的"假设的闭环"一节。',
    initial: { S: 'DORMANT', A: 'WARN', B: 'WARN' },
  },
  {
    id: 'numeric_consistency',
    home: 'knowledge',
    microTeaching: '正文里的数字与产物对不上，或者正文里的算式自身不自洽。**不要改文字去迎合旧数字**——重跑产出脚本。规则见 `skills/evidence-and-numbers.md`。',
    initial: { S: 'DORMANT', A: 'DORMANT', B: 'WARN' },
  },
  {
    id: 'config_consistency',
    home: 'knowledge',
    microTeaching: '你的解析校核与交付物用了**不同的离散参数**（例如校核 dt=0.25、交付 dt=1.0）。那么校核结论不适用于交付物。让它们同源，或如实报出两套配置的差异。',
    initial: { S: 'DORMANT', A: 'DORMANT', B: 'WARN' },
  },
  {
    id: 'reference_validation',
    home: 'knowledge',
    microTeaching: '参考文献里有条目无法核验。不许编造——换一篇你真的知道的，或如实标注不确定。规则见 `skills/paper-contract.md` 的"参考文献纪律"。',
    initial: { S: 'DORMANT', A: 'DORMANT', B: 'WARN' },
  },
  {
    id: 'explore_deepen',
    home: 'knowledge',
    microTeaching: '你的方案决策记录不完整：每个子问题都要有 2–3 个候选、四维打分、选择理由、以及**每个落选者各自的落选理由**。理由要具体到"它能/不能回答题面的哪一问"，"C1 更好"不算理由。规则见 `skills/explore-select-deepen.md`。',
    initial: { S: 'DORMANT', A: 'DORMANT', B: 'WARN' },
  },
  {
    id: 'stale_detection',
    home: 'knowledge',
    microTeaching: '交付物里有产物比它依赖的代码/配置**旧**（数字是上一版跑出来的）。重跑产出脚本，而不是改写论文。',
    initial: { S: 'DORMANT', A: 'WARN', B: 'WARN' },
  },
]

/** 一条状态转移记录（进审计轨迹）。 */
export interface GateTransition {
  readonly gateId: string
  readonly from: GateMode
  readonly to: GateMode
  readonly violations: number
  /** 本次转移是否注入微教学。 */
  readonly taught: boolean
}

/** 状态机快照——写进 run-report，也是"这次运行被收紧到什么程度"的证据。 */
export interface GateStateSnapshot {
  readonly modes: Readonly<Record<string, GateMode>>
  readonly violations: Readonly<Record<string, number>>
  readonly transitions: ReadonlyArray<GateTransition>
}

/**
 * 门禁状态机。
 *
 * **纯内存、确定性**：同一个违规序列必然得到同一个模式序列，因此可重放、可测试。
 * 不读时钟、不落盘（快照由调用方写进审计轨迹）。
 */
export class GateStateMachine {
  readonly #modes = new Map<string, GateMode>()
  readonly #violations = new Map<string, number>()
  readonly #transitions: GateTransition[] = []
  readonly #activations: ReadonlyMap<string, GateActivation>

  /**
   * @param tier - 模型能力档位（L0 能力画像的产出）。决定各门禁的**初始**模式：
   *               S 档几乎全 DORMANT，B 档关键维度直接 WARN 起步。
   * @param activations - 激活登记表，默认 {@link GATE_ACTIVATIONS}（测试可注入）。
   */
  constructor(tier: 'S' | 'A' | 'B' = 'A', activations: ReadonlyArray<GateActivation> = GATE_ACTIVATIONS) {
    this.#activations = new Map(activations.map(a => [a.id, a]))
    for (const a of activations) this.#modes.set(a.id, a.initial[tier])
  }

  /**
   * 当前模式。**未登记的门禁默认 ENFORCE**——登记表是白名单，不是黑名单：
   * 一个没被显式登记过的检查项，不该因为"忘了登记"而静默放过。
   *
   * @param gateId - 门禁 id。
   */
  modeOf(gateId: string): GateMode {
    return this.#modes.get(gateId) ?? 'ENFORCE'
  }

  /** 该门禁是否硬拦截（违规进致命集）。 */
  isEnforcing(gateId: string): boolean {
    return this.modeOf(gateId) === 'ENFORCE'
  }

  /** 违规计数（0 表示未违规）。 */
  violationsOf(gateId: string): number {
    return this.#violations.get(gateId) ?? 0
  }

  /**
   * 记录一次违规，按状态机推进。
   *
   * @param gateId - 违规的门禁 id。
   * @returns 本次的处置：新模式、是否注入微教学（内容）、是否硬拦截。
   */
  recordViolation(gateId: string): {
    readonly mode: GateMode
    readonly enforcing: boolean
    readonly microTeaching: string | null
  } {
    const from = this.modeOf(gateId)
    const violations = this.violationsOf(gateId) + 1
    this.#violations.set(gateId, violations)

    // DORMANT → WARN：首次违规，注入针对性微教学（只讲这一条）。
    // WARN → ENFORCE：同维度再次违规，收紧为硬拦截。
    // ENFORCE 保持：已是最严档，不再转移（计数继续累积，供能力画像使用）。
    let to: GateMode = from
    if (from === 'DORMANT') to = 'WARN'
    else if (from === 'WARN') to = 'ENFORCE'
    this.#modes.set(gateId, to)

    const taught = from === 'DORMANT' && to === 'WARN'
    const activation = this.#activations.get(gateId)
    this.#transitions.push({ gateId, from, to, violations, taught })

    return {
      mode: to,
      enforcing: to === 'ENFORCE',
      microTeaching: taught ? (activation?.microTeaching ?? null) : null,
    }
  }

  /**
   * 记录一次通过。**不做衰减**——本次运行内一旦收紧就不再放松。
   *
   * 理由：运行内衰减会让"再试几次就过了"变成一条可行路径，而那正是把门禁
   * 变成橡皮章的方式。跨运行的档位调整走能力画像（L0），是另一条路。
   *
   * @param gateId - 通过的门禁 id。
   */
  recordPass(_gateId: string): void {
    // 刻意留空：见上。存在这个方法是让调用点显式表达"这里我考虑过衰减"。
  }

  /** 快照，供审计轨迹与 run-report 使用。 */
  snapshot(): GateStateSnapshot {
    return {
      modes: Object.fromEntries([...this.#modes.entries()].sort(([a], [b]) => a.localeCompare(b))),
      violations: Object.fromEntries([...this.#violations.entries()].sort(([a], [b]) => a.localeCompare(b))),
      transitions: [...this.#transitions],
    }
  }

  /**
   * 汇总本次运行中"被收紧过"的维度，作为能力画像的负反馈：
   * 这些维度下次运行应把初始档位调高（B 档起步）。
   */
  tightenedGates(): ReadonlyArray<string> {
    return [...this.#violations.entries()]
      .filter(([, n]) => n > 0)
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b))
  }
}
