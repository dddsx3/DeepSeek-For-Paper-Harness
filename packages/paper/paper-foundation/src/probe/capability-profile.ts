/**
 * L0 — 能力画像（一次性探针，产出模型档位 S / A / B）。
 *
 * ## 为什么需要它
 *
 * "一套架构服务所有模型"的朴素做法是写 if 分支：强模型走宽松路径、弱模型走严格
 * 路径。分支的代价是两条路径都要维护、且分叉会随时间扩大。
 *
 * 本设计换一个做法：**加一个自适应参数，不加分支**。探针跑一次（约 1–2 分钟，
 * 成本可忽略），产出档位；档位决定两件事：
 *
 *   1. **门禁的初始档位**（`GateStateMachine` 的 `initial`）——强模型的绝大多数
 *      门禁永远停在 DORMANT；
 *   2. **教学前置量**——强模型不预载任何知识文档，弱模型预载一份精简版。
 *
 * 于是同一份代码在两种模型上表现出两种行为，而代码里没有第二套流程。
 *
 * ## 探针考什么
 *
 * 三个小任务，各自对应一种**会被架构依赖**的能力：
 *
 * | 探针 | 考的能力 | 为什么架构依赖它 |
 * |---|---|---|
 * | `symbolic` | 符号推理（小推导题） | 决定符号证据通道能不能用 |
 * | `execution` | 执行正确性（小代码题） | 决定 `code` 块能不能一次跑通 |
 * | `structure` | 指令遵循（小结构输出题） | 决定容器能不能一次合规 |
 *
 * **它测的不是模型智力，是模型与本架构的匹配度。** 因此档位是"该给它多少脚手架"，
 * 不是"它有多聪明"——同一个模型换一套 harness，档位可以不同。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/probe/capability-profile
 */

/** 模型档位。决定门禁初始档位与教学前置量。 */
export const MODEL_TIERS = ['S', 'A', 'B'] as const
export type ModelTier = (typeof MODEL_TIERS)[number]

/** 探针种类。 */
export const PROBE_KINDS = ['symbolic', 'execution', 'structure'] as const
export type ProbeKind = (typeof PROBE_KINDS)[number]

/** 一个探针的观测结果。 */
export interface ProbeObservation {
  readonly kind: ProbeKind
  readonly passed: boolean
  /** 人读的观测细节（进审计轨迹，供以后校准档位阈值）。 */
  readonly detail: string
  /** 该探针的耗时（毫秒）——用于判断"是否值得每次运行都跑"。 */
  readonly elapsedMs: number
}

/** 一次能力画像。 */
export interface CapabilityProfile {
  readonly tier: ModelTier
  readonly observations: ReadonlyArray<ProbeObservation>
  /** 判档理由——**必须可复核**：说清哪几个探针决定档位。 */
  readonly rationale: string
  /** 该档位下，prompt 里允许前置的知识量。 */
  readonly teaching: TeachingBudget
}

/** 各档位下的教学前置量。 */
export interface TeachingBudget {
  /** 是否在 prompt 里预载一份精简知识摘要（而不是只给索引）。 */
  readonly preloadKnowledge: boolean
  /** 预载时的字符上限（0 = 不预载）。 */
  readonly preloadMaxChars: number
  /** 门禁的初始档位策略说明（给人读）。 */
  readonly gatePolicy: string
}

const TEACHING: Readonly<Record<ModelTier, TeachingBudget>> = {
  S: {
    preloadKnowledge: false,
    preloadMaxChars: 0,
    gatePolicy: '门禁全 DORMANT：检查照常跑，违规只记录。强模型跑完一程可能一个门禁都没感知到。',
  },
  A: {
    preloadKnowledge: false,
    preloadMaxChars: 0,
    gatePolicy: '关键门禁 WARN 起步：首次违规注入一条针对性微教学。',
  },
  B: {
    preloadKnowledge: true,
    preloadMaxChars: 4_000,
    gatePolicy: '宪法 + 精简教学前置；关键维度 WARN 起步，二次违规即 ENFORCE。这就是旧形态的行为，但只对它证明需要的维度启用。',
  },
}

/**
 * 判档。
 *
 * 判据（预先声明，避免事后凑结论）：
 *   - 三个探针全过 → `S`（不需要脚手架）
 *   - `structure` 过 + 至少一个别的过 → `A`
 *   - 其余（含 `structure` 不过）→ `B`（容器合规本身需要帮助，前置教学）
 *
 * `structure` 被赋予较高权重，理由是它是**架构的硬依赖**：容器不合规则整条
 * 生产链拿不到任何产物。`symbolic` 与 `execution` 不过只影响深度，不影响存活。
 *
 * @param observations - 探针观测。
 */
export function assessCapability(observations: ReadonlyArray<ProbeObservation>): CapabilityProfile {
  const byKind = new Map(observations.map(o => [o.kind, o] as const))
  const structure = byKind.get('structure')?.passed ?? false
  const symbolic = byKind.get('symbolic')?.passed ?? false
  const execution = byKind.get('execution')?.passed ?? false

  let tier: ModelTier
  if (structure && symbolic && execution) tier = 'S'
  else if (structure && (symbolic || execution)) tier = 'A'
  else tier = 'B'

  const passed = observations.filter(o => o.passed).map(o => o.kind)
  const failed = observations.filter(o => !o.passed).map(o => o.kind)
  const rationale = [
    `通过：${passed.length > 0 ? passed.join('、') : '（无）'}`,
    `未通过：${failed.length > 0 ? failed.join('、') : '（无）'}`,
    tier === 'B' && !structure
      ? '判 B：结构探针未通过——容器合规是硬依赖，必须前置教学'
      : `判 ${tier}`,
  ].join('；')

  return { tier, observations: [...observations], rationale, teaching: TEACHING[tier] }
}

/**
 * 无探针时的保守默认档位。
 *
 * **默认是 `A` 而不是 `S`**：在没有任何证据的情况下假定模型不需要脚手架，
 * 会让弱模型直接卡在容器层（零产物），那是比"多给一点帮助"贵得多的错误。
 * 而 `A` 也不等于旧形态——旧形态的默认是"全部 ENFORCE"，等价于比 `B` 更严。
 *
 * @param reason - 为什么没有探针（进审计轨迹）。
 */
export function defaultProfile(reason: string): CapabilityProfile {
  return profileForTier('A', `未跑能力探针（${reason}）——按保守默认档 A 处理`)
}

/**
 * 由**调用方声明的档位**构造画像（探针执行器尚未接线时的显式路径）。
 *
 * 它与 {@link defaultProfile} 的区别只是理由文本不同——两者都产出**完整的**
 * 画像（含教学预算），因此下游不需要区分"档位从哪来"。
 *
 * @param tier - 声明的档位。
 * @param reason - 人读理由（进审计轨迹）。
 */
export function profileForTier(tier: ModelTier, reason: string): CapabilityProfile {
  return { tier, observations: [], rationale: reason, teaching: TEACHING[tier] }
}

/**
 * 把上一次运行中被收紧的维度反馈进下一次的档位选择。
 *
 * 这是能力画像的**负反馈**通道：某个维度反复违规，说明这个模型在该维度确实需要
 * 帮助，于是下次直接给它 `B` 档的初始强度（而不是每次都从 DORMANT 重新试错）。
 *
 * @param tier - 本次档位。
 * @param tightenedGates - 上次运行中被收紧过的门禁 id。
 */
export function withNegativeFeedback(tier: ModelTier, tightenedGates: ReadonlyArray<string>): {
  readonly tier: ModelTier
  readonly note: string
} {
  if (tightenedGates.length === 0) return { tier, note: '无历史收紧记录' }
  if (tier === 'S') {
    return {
      tier: 'A',
      note: `上次运行在 ${tightenedGates.join('、')} 维度被收紧过——本次降为 A 档起步（负反馈）`,
    }
  }
  return {
    tier,
    note: `上次运行在 ${tightenedGates.join('、')} 维度被收紧过——本次保持 ${tier} 档（负反馈已记录）`,
  }
}
