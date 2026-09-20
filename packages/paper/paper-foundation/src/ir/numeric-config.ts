/**
 * NumericConfig — M-QUAL 阶段 A（DP-2/DP-4 落地）.
 *
 * 给"一次数值求解的配置"一个**可比较、可报差异**的 IR 身份
 * （`docs/quality/CONFIG-CONSISTENCY-CHECK.md` §3.2 的最小形态 + 一处
 * **已声明的方向修正**）。它抓的是参考工作流 2026-A 里 comp-review 靠人肉
 * 才查出的 F1 major：**校核跑 `dt=0.25`、交付用 `dt=1.0`，两侧各自合法，
 * 错误只在配对关系上**——既有九门全部只看单个产物的内部自洽，表达不了
 * 这条跨产物关系（GATE-MAPPING §2.1 的新增检查形态 N-1）。
 *
 * 为什么不能复用既有字段（Q1-B4 §3.1 实测）：
 *   - `RunArtifact.environment` 是自由文本，比较退化为字符串比较
 *     （`"dt=0.25"` vs `"dt=0.250"` 误报、多字段漏报）；
 *   - `ExecutionRecord.environment_hash` 只能判"是否相同"，标注（D-1）
 *     必须给出**两侧的具体数值**，指纹给不了；
 *   - `ExperimentSpec.parameter_sweep` 只表达"扫过哪些值"，不表达
 *     "本次执行选定的值"。
 *
 * **方向修正（相对 Q1-B4 §3.2 的挂载点）**：规格建议 `RunArtifact.config_ref`
 * 指向 NumericConfig；但 DP-4 裁决的候选 3（执行期捕获）要求配置在**实跑
 * 之后**才存在——而 store 是 append-only、无前向引用修复队列，run 先于
 * config 入库时无法携带后向解析的 `config_ref`。故所有权边改为
 * **`NumericConfig.run_ref → RunArtifact`**（append-only 拓扑下唯一可声明的
 * 方向，与 `Result.run_ref` 同构），"这次运行用了什么配置"由
 * `IR_REF_FIELDS` 解析、由 G7 `reference_validation` 门保证可解析——
 * 强度等价，且 RunArtifact schema **零改动**（既有 golden 指纹不动）。
 *
 * 红线 N19（配置类对象必须走"由 code emit"形态）：NumericConfig 的唯一
 * 生产者是执行期捕获——被测代码在自己的沙箱里写出
 * {@link NUMERIC_CONFIG_EMISSION_BASENAME}（其字节被 ExecutionRecord 的
 * `output_hash` 覆盖），harness 把这份 JSON（不是散文）物化为 IR 对象。
 * 配置值与代码实际所跑值的绑定（C-2 的"声明↔实际"同构）由
 * `delivery/config-consistency.ts` 机械比对。
 *
 * 诚实边界：emission 本身由被测代码自查自报（代码写 `dt=0.25` 而实际跑
 * `dt=1.0` 的谎报，M5 抓不到）——该缺口由探针 P-8（配置复现：用同一配置
 * 独立重跑并比对，E2E 期真跑）补偿；本模块不声称消除同源。
 *
 * @module @deepseek-ai/dsh-paper-foundation/src/ir/numeric-config
 */

import { z as zod } from 'zod'

const idSchema = zod
  .string()
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u, 'must not contain control, format, surrogate or separator characters')
  .refine(v => v === v.normalize('NFC'), 'must be in Unicode NFC form')

const refSchema = zod.string().min(1)
const textSchema = zod.string().min(1).max(65_536)

/**
 * The single file basename whose JSON payload the executed code must write
 * for the config to be captured. One canonical name: the capture seam looks
 * for exactly this file among the run's REAL outputs (its bytes are covered
 * by the ExecutionRecord's `output_hash`).
 */
export const NUMERIC_CONFIG_EMISSION_BASENAME = 'numeric_config.json'

/**
 * The emission document: what the CODE writes (keyed by the SAME tokens the
 * container declared as SymbolSpecs). Shape mirrors the IR object but keys
 * are tokens, not resolved refs — the harness does the token→SymbolSpec
 * resolution (fail-closed on unknown tokens).
 */
export const numericConfigEmissionSchema = zod
  .object({
    /**
     * 离散化参数。键 = 已声明 SymbolSpec 的 token **或 symbol_id**（两者都唯一
     * 指向同一符号；`null` 表示"本次未填"——它不携带任何数值，物化时丢弃）。
     */
    discretization: zod.record(zod.string(), zod.number().nullable()),
    /** 物理/算法参数（同上）。 */
    physical: zod.record(zod.string(), zod.number().nullable()),
    /** 离散/算法选择的**枚举**选择（显式/隐式格式、求解器名）。 */
    choices: zod.record(zod.string(), zod.string()),
    /** 物性组标识（如 'A2'/'A3'/'A4'）。2026-A 的"三套物性混用"正是这个字段。 */
    property_set: zod.string().nullable().optional(),
  })
  .strict()

export type NumericConfigEmission = zod.infer<typeof numericConfigEmissionSchema>

/**
 * Closed shape of one numeric config. `discretization` / `physical` entries
 * are symbol-anchored (each `symbol_ref` resolves to a SymbolSpec); `choices`
 * are free-form enumerable selections; `property_set` names the physical
 * property group.
 */
export const numericConfigSchema = zod
  .object({
    config_id: idSchema,
    /** The run this config records (owner edge; append-only topology). */
    run_ref: refSchema,
    /** 离散化参数。key 必须解析到已声明的 SymbolSpec，value 是数值。 */
    discretization: zod.array(
      zod.object({ symbol_ref: refSchema, value: zod.number() }).strict(),
    ),
    /** 物理/算法参数（物性组、h/hm、阈值、界面取法…）。 */
    physical: zod.array(
      zod.object({ symbol_ref: refSchema, value: zod.number() }).strict(),
    ),
    /** 离散/算法选择的枚举选择（显式/隐式格式、求解器名）。 */
    choices: zod.array(
      zod.object({ key: idSchema, value: textSchema }).strict(),
    ),
    /** 物性组标识（如 'A2'/'A3'/'A4'）。 */
    property_set: textSchema.nullable(),
  })
  .strict()
  .refine(v => new Set(v.discretization.map(e => e.symbol_ref)).size === v.discretization.length, {
    message: 'NumericConfig.discretization contains duplicate symbol_ref entries',
  })
  .refine(v => new Set(v.physical.map(e => e.symbol_ref)).size === v.physical.length, {
    message: 'NumericConfig.physical contains duplicate symbol_ref entries',
  })
  .refine(v => new Set(v.choices.map(e => e.key)).size === v.choices.length, {
    message: 'NumericConfig.choices contains duplicate keys',
  })

export type NumericConfig = zod.infer<typeof numericConfigSchema>

/** Why an emission could not become a canonical NumericConfig. */
export const NUMERIC_CONFIG_EMISSION_FAILURE_KINDS = [
  'EMISSION_INVALID',
  'TOKEN_UNRESOLVED',
  'SCOPE_UNRESOLVED',
] as const
export type NumericConfigEmissionFailureKind = (typeof NUMERIC_CONFIG_EMISSION_FAILURE_KINDS)[number]

export interface NumericConfigEmissionFailure {
  readonly kind: NumericConfigEmissionFailureKind
  readonly reason: string
}

/** One resolvable symbol: token + id, scoped to a problem id. */
export interface EmissionSymbol {
  readonly symbol_id: string
  readonly token: string
  readonly scope_ref: string
}

export interface NumericConfigFromEmissionInput {
  readonly configId: string
  readonly runRef: string
  /** The problem ids the run's model belongs to (the resolution scope). */
  readonly scopeRefs: ReadonlyArray<string>
  readonly emission: NumericConfigEmission
  /** The declared symbols the resolution closes against (from the store). */
  readonly symbols: ReadonlyArray<EmissionSymbol>
}

export type NumericConfigFromEmissionResult =
  | { readonly ok: true; readonly config: NumericConfig }
  | { readonly ok: false; readonly failures: ReadonlyArray<NumericConfigEmissionFailure> }

/**
 * Materialize the code-emitted config into a canonical NumericConfig.
 *
 * Fail-closed on unknown tokens: a `discretization`/`physical` key that does
 * not resolve to a declared SymbolSpec **within the run's model scope**
 * refuses the whole capture — a config value that cannot be tied to a
 * declared symbol can never take part in the C-2 declared-vs-actual
 * comparison, and admitting it would create a second, unanchored source of
 * numeric truth. `choices` keys are free-form (an enumerable selection is
 * not a symbol).
 *
 * Total: never throws on hostile input; every contradiction is a failure.
 */
export function numericConfigFromEmission(
  input: NumericConfigFromEmissionInput,
): NumericConfigFromEmissionResult {
  const failures: NumericConfigEmissionFailure[] = []
  const scopes = new Set(input.scopeRefs)
  // Scope first: without it no token can resolve, and the precise cause is
  // the missing scope, not each token that did not resolve.
  if (input.scopeRefs.length === 0) {
    return {
      ok: false,
      failures: [{ kind: 'SCOPE_UNRESOLVED', reason: 'the run\u2019s model declares no problem scope; config tokens cannot resolve' }],
    }
  }
  const inScope = input.symbols.filter(symbol => scopes.has(symbol.scope_ref))
  const byToken = new Map<string, EmissionSymbol>()
  const byId = new Map<string, EmissionSymbol>()
  // Normalised spelling map: case and underscore/brace differences are
  // notation (`p0` vs `P_0`, `T_inf` vs `Tinf`). Ambiguity REFUSES — a key
  // that normalises onto two different declared symbols is not resolvable,
  // and guessing would bind the value to the wrong symbol.
  const byNormalized = new Map<string, EmissionSymbol | 'ambiguous'>()
  const normalize = (key: string): string => key.toLowerCase().replace(/[_\-{}$]/g, '')
  for (const symbol of inScope) {
    byToken.set(symbol.token, symbol)
    byId.set(symbol.symbol_id, symbol)
    // BOTH spellings of the same symbol enter the normalised map. Evidence:
    // run-4 of W11.5 emitted key `S_P0` for the declared id `S-P0`
    // (token `p0`) — an underscore for a hyphen, the same symbol in a
    // different rendering. Since both aliases name ONE symbol, no ambiguity
    // is created; a collision between two DIFFERENT symbols still refuses.
    for (const spelling of [symbol.token, symbol.symbol_id]) {
      const normalized = normalize(spelling)
      const prior = byNormalized.get(normalized)
      const unambiguous = prior === undefined || prior === 'ambiguous'
        ? prior !== 'ambiguous'
        : prior.symbol_id === symbol.symbol_id
      byNormalized.set(normalized, unambiguous ? symbol : 'ambiguous')
    }
  }

  const resolve = (section: string, key: string): string | null => {
    const exact = byToken.get(key) ?? byId.get(key)
    if (exact !== undefined) return exact.symbol_id
    const fuzzy = byNormalized.get(normalize(key))
    if (fuzzy !== undefined && fuzzy !== 'ambiguous') return fuzzy.symbol_id
    failures.push({
      kind: 'TOKEN_UNRESOLVED',
      reason: fuzzy === 'ambiguous'
        ? `${section} key '${key}' matches more than one declared SymbolSpec by spelling — rename the key to the exact token or symbol_id (ambiguous keys are refused, never guessed)`
        : `${section} key '${key}' does not resolve to a SymbolSpec declared in scope [${[...scopes].join(', ')}]`,
    })
    return null
  }

  const discretization: Array<{ symbol_ref: string; value: number }> = []
  for (const [token, value] of Object.entries(input.emission.discretization)) {
    if (value === null) continue // "not filled" carries no value to record
    const symbolRef = resolve('discretization', token)
    if (symbolRef === null) continue
    discretization.push({ symbol_ref: symbolRef, value })
  }
  const physical: Array<{ symbol_ref: string; value: number }> = []
  for (const [token, value] of Object.entries(input.emission.physical)) {
    if (value === null) continue
    const symbolRef = resolve('physical', token)
    if (symbolRef === null) continue
    physical.push({ symbol_ref: symbolRef, value })
  }
  if (failures.length > 0) return { ok: false, failures }

  const config: NumericConfig = {
    config_id: input.configId,
    run_ref: input.runRef,
    discretization,
    physical,
    choices: Object.entries(input.emission.choices).map(([key, value]) => ({ key, value })),
    property_set: input.emission.property_set ?? null,
  }
  const parsed = numericConfigSchema.safeParse(config)
  if (!parsed.success) {
    return {
      ok: false,
      failures: [{
        kind: 'EMISSION_INVALID',
        reason: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      }],
    }
  }
  return { ok: true, config: parsed.data }
}
