/**
 * Cordis service exposing the workflow executor. Deployment-varying pricing,
 * budget, and backoff arrive as validated config rather than constants, so a
 * composition can change them from `cordis.yml` without a code change.
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/executor-service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { ModelPrice, PricingTable } from './cost.ts'
import { WorkflowExecutor } from './executor.ts'
import type { ExecutorOptions } from './executor.ts'

/** Daily spend ceiling used when a composition names none. */
export const DEFAULT_DAILY_BUDGET_USD = 20
/** Warning fraction used when a composition names none. */
export const DEFAULT_BUDGET_WARN_FRACTION = 0.8
/** Strict-mode ceiling multiplier used when a composition names none. */
export const DEFAULT_STRICT_BUDGET_MULTIPLIER = 1.5
/** First retry delay used when a composition names none. */
export const DEFAULT_BACKOFF_BASE_MS = 1000
/** Retry delay ceiling used when a composition names none. */
export const DEFAULT_BACKOFF_CAP_MS = 30_000
/** Context-window fraction one request may occupy when a composition names none. */
export const DEFAULT_CONTEXT_UTILIZATION = 0.8

/**
 * Execution policy for one deployment. Every field is optional in yml: the
 * schema below supplies the default at load, and a hand-built composition
 * resolves the same value through the constructor.
 */
export interface ExecutorConfig {
  /** Daily spend ceiling in USD; zero or less means unbounded. */
  readonly dailyBudgetUsd?: number
  /** Fraction of the ceiling that raises a warning event. */
  readonly budgetWarnFraction?: number
  /** Multiplier applied to the ceiling for strict-mode runs. */
  readonly strictBudgetMultiplier?: number
  /** First retry delay in milliseconds. */
  readonly backoffBaseMs?: number
  /** Retry delay ceiling in milliseconds. */
  readonly backoffCapMs?: number
  /** Route prices keyed by provider then model. */
  readonly pricing?: PricingTable
  /** Fraction of a model's context window one request may occupy. */
  readonly contextUtilization?: number
  /** 5.0-R (R5): root under which promoted final outputs are really written. */
  readonly finalOutputRoot?: string
  /** P1-1: require and run the structured-output producer on EXECUTE. */
  readonly produceFromExecute?: boolean
  /** P2-1: deployment-owned code-run configuration (model can never choose
   *  the command); required for the EXECUTE production chain. */
  readonly produceRun?: {
    command: string[]
    entryFile: string
    environment: string
    timeoutMs: number
    allowExecutable?: string[]
  }
  /** TASK-PW W2: the guided-step protocol tier a producing run starts in.
   *  T1 = full declaration (default), T2 = guided steps, T3 = template
   *  fill. The executor degrades T1 → T2 → T3 on NONE exhaustion (W4). */
  readonly initialTier?: 'T1' | 'T2' | 'T3'
  /**
   * 交付档位（三档，见 `executor.ts` 的 `PaperExecutorOptions.deliveryGradeMode`）。
   *
   * **默认 `fail-soft`**：检出但未返修的 finding 走"显式接受"，交付一份带
   * 已知缺陷表的完整包。`closed-loop` 走闭环返修 + 指纹复验，预算内未消解则
   * `ESCALATE`。`strict-tolerance` 是历史行为（任何未通过即拒绝、零产物），
   * 需要显式开启——它是一条从未在任何真实产出中被验证过的路径。
   */
  readonly deliveryGradeMode?: 'strict-tolerance' | 'fail-soft' | 'closed-loop'
  /** L0 能力画像档位；缺省按保守默认 A（详见 `probe/capability-profile.ts`）。 */
  readonly capabilityTier?: 'S' | 'A' | 'B'
  /**
   * W12-C1：分阶段切片与热重启。
   *
   * `slicesRoot` 给出切片落盘位置；`stagePause` 列出**完成即停**的阶段。
   * 缺省都不设 = 热重启关闭（零开销）。
   */
  readonly slicesRoot?: string
  /** 与 `allowExecutable` 同形：schema 产出 `string[]`，接口照抄以免可选性不匹配。 */
  readonly stagePause?: string[]
  /** W12-C2：热重启播种（analyze=E1 全文，container=准入通过的容器全文）。 */
  readonly resumeFrom?: { readonly analyze?: string; readonly container?: string }
  /**
   * L2 探索—择优—深挖。缺省按 run mode 决定（`strict` 开启，其余关闭）。
   * 开启后 EXECUTE 之前会跑两个 plan 型节点（explore / select）。
   */
  readonly exploreDeepen?: boolean
  /** L5 对抗评审的视角数。缺省 `strict` 跑 3 个，`fast` / `exploratory` 跑 1 个。 */
  readonly reviewPersonas?: 1 | 3
  /** L6 闭环预算。缺省 `{maxRounds: 2, maxAttemptsPerFinding: 2}`。 */
  readonly closureBudget?: { readonly maxRounds: number; readonly maxAttemptsPerFinding: number }
  /** W8.6-P4: per-run OUTPUT-token ceiling (pricing-independent guard).
   *  Zero/absent = unbounded (historical). */
  readonly maxOutputTokensPerRun?: number
  /** W9-P2 / W8.9-A4: shard the EXECUTE declaration (three small outputs
   *  merged into the same container). **W8.9-A4: this is now the default**;
   *  pass `false` to restore the single-shot declaration, or set
   *  `disableShardDeclare: true` to opt out explicitly. */
  readonly shardDeclare?: boolean
  /** W8.9-A4: explicit opt-OUT of the sharded path (takes precedence over
   *  `shardDeclare`). Present so a composition can say "I know about
   *  sharding and I want it off" without relying on `false`'s meaning. */
  readonly disableShardDeclare?: boolean
  /** W8.9-B1: the E1/E2 receive layer (free analysis → independent
   *  normalization). **Default ON**; `false` restores the single-shot
   *  container path for A/B comparison. */
  readonly e1e2?: boolean
  /** W8.9-B1: explicit opt-out of the receive layer (takes precedence). */
  readonly disableE1E2?: boolean
  /** W8.9-B3/B4: refuse a container whose declarations are not verbatim
   *  anchored in the E1 analysis. Default true; `false` records the
   *  findings without refusing (first-real-run tolerance). */
  readonly enforceFidelity?: boolean
}

const modelPrice: s<ModelPrice> = s.object({
  inputPer1k: s.number().min(0).required(),
  outputPer1k: s.number().min(0).required(),
})

/**
 * Resolve one deployment's execution policy. The loader applies the schema
 * defaults before construction; this is the same resolution for a
 * hand-built composition, and the single place either path defaults.
 * @param config - the composition's declared policy, possibly partial.
 * @param audit - audit sink to attach, when the composition mounts one.
 * @returns the fully resolved executor options.
 */
export function resolveExecutorOptions(
  config: ExecutorConfig,
  audit?: ExecutorOptions['audit'],
  ir?: ExecutorOptions['ir'],
  artifactBodies?: ExecutorOptions['artifactBodies'],
): ExecutorOptions {
  return {
    pricing: config.pricing ?? {},
    budget: {
      dailyBudgetUsd: config.dailyBudgetUsd ?? DEFAULT_DAILY_BUDGET_USD,
      warnFraction: config.budgetWarnFraction ?? DEFAULT_BUDGET_WARN_FRACTION,
      strictMultiplier: config.strictBudgetMultiplier ?? DEFAULT_STRICT_BUDGET_MULTIPLIER,
    },
    backoff: {
      baseMs: config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
      capMs: config.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS,
    },
    contextUtilization: config.contextUtilization ?? DEFAULT_CONTEXT_UTILIZATION,
    // 5.0-R (R5): a real sink root makes promotion write bytes. The empty
    // string is the schema-level "not mounted" marker.
    ...(config.finalOutputRoot ? { finalOutputRoot: config.finalOutputRoot } : {}),
    // P1-1: opt-in structured-output producer on the EXECUTE node.
    ...(config.produceFromExecute ? { produceFromExecute: true } : {}),
    // P2-1: the deployment-owned runner; validated against the built-in
    // code-run allow-list when the chain executes.
    ...(config.produceRun === undefined ? {} : { produceRun: config.produceRun }),
    // TASK-PW W2: the tier a producing run starts at; `undefined` resolves
    // to T1 (initialTier()) inside the executor.
    ...(config.initialTier === undefined ? {} : { initialTier: config.initialTier }),
    // 交付档位；缺省 = fail-soft（见 schema 处的注释）。
    ...(config.deliveryGradeMode === undefined ? {} : { deliveryGradeMode: config.deliveryGradeMode }),
    // L0 能力画像档位：只在调用方显式声明时前传——缺省由 executor 取保守默认 A，
    // 而不是在 schema 层再造一个默认值（避免"两处默认"这类漂移）。
    ...(config.capabilityTier === undefined ? {} : { capabilityTier: config.capabilityTier }),
    // W12-C1：热重启的两项也必须**显式转发**——白名单漏一项的后果是"模块做好了
    // 但从组合层够不到"，而症状是**静默的**（运行照跑，只是不停）。
    // 本轮的端到端测试正是这样抓到它自己的：`--pause-after` 传了却不生效。
    ...(config.slicesRoot === undefined ? {} : { slicesRoot: config.slicesRoot }),
    ...(config.stagePause === undefined ? {} : { stagePause: config.stagePause }),
    ...(config.resumeFrom === undefined ? {} : { resumeFrom: config.resumeFrom }),
    // 上限解放架构的其余三个开关，同样**只在显式声明时前传**：`undefined` 必须
    // 到达 executor，由它的单一读者决定默认（档位相关），避免默认值在两层各写一份。
    //
    // 这三行曾经缺失：选项在 executor 里实现了、schema 里没有，于是 composition
    // 传进来会被静默丢掉——"模块接好了但从组合层够不到"。那是本次改造要消灭的
    // 形态之一，所以这里逐个显式转发，并由 `wired-into-mainline.spec.ts` 覆盖。
    ...(config.exploreDeepen === undefined ? {} : { exploreDeepen: config.exploreDeepen }),
    ...(config.reviewPersonas === undefined ? {} : { reviewPersonas: config.reviewPersonas }),
    ...(config.closureBudget === undefined ? {} : { closureBudget: config.closureBudget }),
    ...(config.maxOutputTokensPerRun === undefined ? {} : { maxOutputTokensPerRun: config.maxOutputTokensPerRun }),
    // W8.9-A4: forward BOTH halves of the switch — dropping the opt-out
    // here would silently ignore a composition's explicit request (the
    // defect this batch's own test caught: disableShardDeclare never
    // reached the executor, so "off" behaved as "default on").
    ...(config.shardDeclare === undefined ? {} : { shardDeclare: config.shardDeclare }),
    ...(config.disableShardDeclare === true ? { disableShardDeclare: true } : {}),
    // W8.9-B1: forward both halves of the receive-layer switch, same reason
    // as the shard switch above — a dropped opt-out silently runs the
    // default path while the caller believes it opted out.
    ...(config.e1e2 === undefined ? {} : { e1e2: config.e1e2 }),
    ...(config.disableE1E2 === true ? { disableE1E2: true } : {}),
    ...(config.enforceFidelity === undefined ? {} : { enforceFidelity: config.enforceFidelity }),
    // exactOptionalPropertyTypes: an explicit undefined would be a type
    // error on the optional fields, so omit rather than pass through.
    ...ir === undefined ? {} : { ir },
    ...audit === undefined ? {} : { audit },
    ...artifactBodies === undefined ? {} : { artifactBodies },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    paperExecutor: PaperExecutorService
  }
}

/** Lifecycle owner of the node executor over the durable engine. */
export class PaperExecutorService extends Service {
  static inject = ['paperWorkflow', 'paperProvider', 'paperSettings', 'paperRuntimeGuard']

  static Config: s<ExecutorConfig> = s.object({
    dailyBudgetUsd: s.number().min(0).default(DEFAULT_DAILY_BUDGET_USD),
    budgetWarnFraction: s.number().min(0).max(1).default(DEFAULT_BUDGET_WARN_FRACTION),
    strictBudgetMultiplier: s.number().min(1).default(DEFAULT_STRICT_BUDGET_MULTIPLIER),
    backoffBaseMs: s.number().step(1).min(1).default(DEFAULT_BACKOFF_BASE_MS),
    backoffCapMs: s.number().step(1).min(1).default(DEFAULT_BACKOFF_CAP_MS),
    pricing: s.dict(s.dict(modelPrice)).default({}),
    contextUtilization: s.number().min(0.1).max(1).default(DEFAULT_CONTEXT_UTILIZATION),
    finalOutputRoot: s.string().default(''),
    produceFromExecute: s.boolean().default(false),
    produceRun: s
      .object({
        command: s.array(s.string()).default([]),
        entryFile: s.string().default(''),
        environment: s.string().default(''),
        timeoutMs: s.number().step(1).min(1).default(30_000),
        allowExecutable: s.array(s.string()),
      }),
    // TASK-PW W2: T2 guided-step sessions opt in at the composition; the
    // executor's enforced tier still resolves from the W4 ledger.
    initialTier: s.union(['T1', 'T2', 'T3'] as const),
    // 交付档位。**默认 fail-soft**：`strict-tolerance`（任何 finding 即拒绝、
    // 零产物）是一条从未在任何真实产出中被验证过的路径，而放行路径的缺陷
    // （finding 无归宿）已由 L6 闭环补上。因此默认值反转，strict 需显式开启。
    deliveryGradeMode: s.union(['strict-tolerance', 'fail-soft', 'closed-loop'] as const).default('fail-soft'),
    // L0 能力画像档位。刻意**不设 schema 默认**：`undefined` 必须到达 executor，
    // 由它的单一读者决定（`defaultProfile`），避免默认值在两层各写一份。
    capabilityTier: s.union(['S', 'A', 'B'] as const),
    // W12-C1：切片根目录与"完成即停"的阶段清单。
    slicesRoot: s.string(),
    stagePause: s.array(s.string()),
    // W12-C2：播种载荷（两个可选的长字符串）。
    resumeFrom: s.object({
      analyze: s.string(),
      container: s.string(),
    }),
    // L2 / L5 / L6 的开关同样**不设 schema 默认**：`undefined` 到达 executor 后
    // 由档位决定默认值。schema 里再写一份默认就会变成"两处默认"，而两处默认
    // 迟早会漂移——那时"strict 档为什么没跑三视角"会变成一个查不出来的问题。
    exploreDeepen: s.boolean(),
    reviewPersonas: s.union([1, 3] as const),
    closureBudget: s.object({ maxRounds: s.number().step(1).min(0), maxAttemptsPerFinding: s.number().step(1).min(0) }),
    // W8.6-P4: per-run output-token ceiling; 0 = unbounded.
    maxOutputTokensPerRun: s.number().step(1).min(0).default(0),
    // W9-P2 / W8.9-A4: shard declaration. No schema default is declared
    // here on purpose — `undefined` must reach the executor so its
    // `shardDeclareEnabled()` (the single reader) decides, rather than a
    // second default living in the schema layer.
    shardDeclare: s.boolean(),
    // W8.9-A4: explicit opt-out.
    disableShardDeclare: s.boolean().default(false),
    // W8.9-B1: receive layer. No schema default (undefined must reach the
    // executor, whose `e1e2Enabled()` is the single reader).
    e1e2: s.boolean(),
    disableE1E2: s.boolean().default(false),
    // W8.9-B3/B4: fidelity enforcement; absent = enforced (executor default).
    enforceFidelity: s.boolean(),
  })

  private executor: WorkflowExecutor | undefined

  /**
   * @param ctx - Context carrying the engine, provider, and settings services.
   * @param config - Validated budget, backoff, and pricing policy.
   */
  constructor(ctx: Context, private readonly config: ExecutorConfig = {}) {
    super(ctx, 'paperExecutor')
  }

  /** Build the executor from the composed services and validated policy. */
  protected [Service.init](): void {
    this.executor = new WorkflowExecutor(
      this.ctx.paperWorkflow.runs,
      this.ctx.paperProvider,
      this.ctx.paperSettings,
      resolveExecutorOptions(
        this.config,
        this.ctx.get('paperAudit'),
        // TASK 1.25: the canonical IR store, when the composition mounts one.
        // Absent, the executor treats it as an empty store and blocks FORMAL
        // and FAST delivery rather than delivering text-only.
        this.ctx.get('paperModelingIr'),
        // W8.11-B2: the artifact body store, when the composition mounts one.
        // Absent, receive-layer texts are not persisted — the pre-W8.11
        // behaviour, kept as the explicit fallback for compositions that do
        // not mount the store.
        this.ctx.get('paperArtifactBody'),
      ),
      this.ctx.paperRuntimeGuard,
    )
  }

  /**
   * Resolve the executor built during initialization.
   * @returns the initialized workflow executor.
   */
  get runs(): WorkflowExecutor {
    if (this.executor === undefined) throw new Error('paper executor is not initialized')
    return this.executor
  }
}

export default PaperExecutorService
