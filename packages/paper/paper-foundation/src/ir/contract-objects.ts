/**
 * TASK-T1 — IR Semantic Contract objects (Sprint 1, task book T1.1).
 *
 * Three new canonical kinds give every P0 scientific fact one owner:
 *
 *   - {@link AssumptionSpec} — the single source of truth for a modeling
 *     assumption. `ModelSpec.assumption_refs` points at these; the model
 *     never embeds a free-text assumption in `ModelSpec` (T1.2 唯一 owner).
 *     `source_type` is a closed enum, so how the assumption entered the
 *     model (given / derived / modeling choice / approximation) is
 *     auditable, and `testable` + `risk_level` are the seed of the
 *     T2 assumption gate.
 *
 *   - {@link EquationSpec} — the single canonical owner of a formula's
 *     machine state: `expression` (SYMPY / LATEX_PRESENTATION) with its
 *     symbol contracts (`lhs_symbols` / `rhs_symbols` / `depends_on`).
 *     `ModelSpec.equation_refs` points at these; the LaTeX a paper renders
 *     is derived, never a second source of truth.
 *
 *   - {@link ExperimentSpec} — the design of a scientific run, distinct
 *     from its execution: `RunArtifact`/`ExecutionRecord` record what
 *     *happened* on one run; `ExperimentSpec` records what the model
 *     *intended* (purpose, parameter sweep, metrics, replications,
 *     expected invariants) and which runs instantiate it (`run_refs`).
 *
 * `ExperimentSpec` deliberately declares **no `model_ref`** (D-T1-1): the
 * experiment is scoped by its `input_refs` (DataArtifacts), and the model
 * relationship is derived through the runs that instantiate it. A direct
 * model link would duplicate the ownership edge `RunArtifact.model_ref`
 * already declares — see `docs/paper/ir-contract-v1.md` for the decision.
 *
 * All three are closed zod schemas (`.strict()`), consistent with the rest
 * of the IR: an unrecognised key is a hard failure, never a silently
 * ignored extra. Newly added SymbolSpec/RequirementSpec fields live in
 * `problem-contract.ts`; the three kinds below are standalone so the store,
 * the reference table, and the producer face can pick them up without
 * touching the problem-contract file.
 *
 * @module packages/paper/paper-foundation/src/ir/contract
 */

import { z as zod } from 'zod'

const idSchema = zod
  .string()
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Z}]+$/u, 'must not contain control, format, surrogate or separator characters')
  .refine(v => v === v.normalize('NFC'), 'must be in Unicode NFC form')

const refSchema = zod.string().min(1)
const textSchema = zod.string().min(1).max(65_536)

// ---------------------------------------------------------------------------
// AssumptionSpec
// ---------------------------------------------------------------------------

/** Closed set of how an assumption entered the model (auditable trace). */
export const ASSUMPTION_SOURCE_TYPES = ['GIVEN', 'DERIVED', 'MODELING_CHOICE', 'APPROXIMATION'] as const
export type AssumptionSourceType = (typeof ASSUMPTION_SOURCE_TYPES)[number]

/** Closed set of assumption statuses (fail-closed on unknown). */
export const ASSUMPTION_STATUSES = ['ACTIVE', 'OBSOLETE', 'QUESTIONED'] as const
export type AssumptionStatus = (typeof ASSUMPTION_STATUSES)[number]

export const assumptionSpecSchema = zod
  .object({
    assumption_id: idSchema,
    /** The ProblemSpec this assumption belongs to (same scope rules as SymbolSpec). */
    scope_ref: refSchema,
    statement: textSchema,
    source_type: zod.enum(ASSUMPTION_SOURCE_TYPES),
    /** Evidence records that justify the assumption (ANY, like Claim.evidence_refs). */
    justification_refs: zod.array(refSchema),
    /** closed: HIGH | MEDIUM | LOW — seed of the T2 assumption risk gate. */
    risk_level: zod.enum(['HIGH', 'MEDIUM', 'LOW']),
    /** Whether the assumption can be empirically tested (boolean, not prose). */
    testable: zod.boolean(),
    /** Result/DataArtifact records that probe this assumption (sensitivity). */
    sensitivity_refs: zod.array(refSchema),
    status: zod.enum(ASSUMPTION_STATUSES),
    /**
     * W8.9-B3 — the verbatim sentence of the E1 analysis this assumption came
     * from. Optional because the single-shot paths have no E1 text to anchor
     * to; REQUIRED on the receive layer (E1/E2), where the executor refuses a
     * declaration whose span is missing, too short, or not a verbatim
     * substring of E1 (the fidelity gate, `produce/e1-e2.ts`).
     *
     * This is the field that makes "形式化忠实于推理" checkable: the harness
     * cannot judge whether the reasoning is good, but it can demand that the
     * formalization quotes the reasoning.
     */
    e1_span: textSchema.optional(),
    /**
     * 这条假设是否**适用于全部子问题**（全局假设）。
     *
     * 事故（第一轮上限测试，2024B × deepseek-v4-pro；两次运行共 14 次拒绝里 **71%**
     * 追溯到这一处）：模型在 E1 里正确识别出"各零部件的次品事件相互独立"是一条
     * **全局假设**——它适用于全部 4 个子问题。它声明了一条 `A-INDEP`（`scope_ref: P1`），
     * 并在 4 个 ModelSpec 里引用它，于是被 `REF-003` 拒绝：
     * `'A-INDEP' is scoped outside the referencing object's scopes`。
     *
     * **那不是模型错，是契约缺一个表达能力**：`scope_ref` 只允许一个作用域，而
     * `ModelSpec` 只能引用自己 `problem_refs` 之内的对象，于是"全局"这件事在 IR 里
     * 无法表达。模型被逼着做的是"逐子问题各声明一条、各用不同 id"这种纯记账——而它
     * 显然不认为那是自己的活。
     *
     * `shared: true` 就是那个缺失的表达：作用域仍指向它**推导自**的那个子问题
     * （保持溯源），但它对**任何**子问题都可引用。归属检查
     * （`validateScopeOwnership`）据此放行。
     *
     * **不变量没有被削弱**：一条**非** shared 的假设被跨子问题引用时仍然照旧拒绝——
     * 规则原本要防的"借另一个子问题的假设来给自己背书"依然被防住。放宽的只是
     * "声明者明确说了它对所有子问题成立"这一种情形，而那种情形本身是可审计的
     * （字段在 IR 里，指纹覆盖它）。
     */
    shared: zod.boolean().optional(),
  })
  .strict()

export type AssumptionSpec = zod.infer<typeof assumptionSpecSchema>

// ---------------------------------------------------------------------------
// EquationSpec
// ---------------------------------------------------------------------------

/** Closed set of equation representation forms (machine vs presentation). */
export const EQUATION_REPRESENTATIONS = ['SYMPY', 'LATEX_PRESENTATION'] as const
export type EquationRepresentation = (typeof EQUATION_REPRESENTATIONS)[number]

/** Closed set of equation kinds (added per need; closed = auditable). */
export const EQUATION_TYPES = ['DEFINITION', 'CONSTRAINT', 'OBJECTIVE', 'DERIVED'] as const
export type EquationType = (typeof EQUATION_TYPES)[number]

export const equationSpecSchema = zod
  .object({
    equation_id: idSchema,
    /** The ProblemSpec this equation lives in. */
    scope_ref: refSchema,
    /** Canonical machine expression (SYMPY source or LaTeX presentation). */
    expression: textSchema,
    representation: zod.enum(EQUATION_REPRESENTATIONS),
    /** Symbols referenced on the left-hand side (closed shape contract). */
    lhs_symbols: zod.array(refSchema),
    /** Symbols referenced on the right-hand side. */
    rhs_symbols: zod.array(refSchema),
    equation_type: zod.enum(EQUATION_TYPES),
    /** Unit the equation is stated in (canonical, like Result.unit). */
    unit: refSchema,
    /** Equation ids this one derives from (equivalence graph, G005 seed). */
    depends_on: zod.array(refSchema),
    /** Source: data artifact or text span the equation came from. */
    source: refSchema,
    /** W8.9-B3 — the verbatim E1 sentence this equation came from (see
     *  AssumptionSpec.e1_span for the full contract). */
    e1_span: textSchema.optional(),
    /**
     * 这条方程是否**适用于全部子问题**（全局定义）。
     *
     * 与 `AssumptionSpec.shared` 同源、同理：一条被多个子问题共用的定义式
     * （例如二项分布的 pmf）不该被逼着抄成四份不同 id 的副本。归属检查据此放行；
     * 非 shared 的跨子问题引用仍然拒绝。
     */
    shared: zod.boolean().optional(),
  })
  .strict()
  .refine(v => new Set(v.lhs_symbols).size === v.lhs_symbols.length, {
    message: 'EquationSpec.lhs_symbols contains duplicate references',
  })
  .refine(v => new Set(v.rhs_symbols).size === v.rhs_symbols.length, {
    message: 'EquationSpec.rhs_symbols contains duplicate references',
  })

export type EquationSpec = zod.infer<typeof equationSpecSchema>

// ---------------------------------------------------------------------------
// ExperimentSpec
// ---------------------------------------------------------------------------

/** Closed set of seed policies (fail-closed on unknown). */
export const EXPERIMENT_SEED_POLICIES = ['FIXED', 'PER_RUN', 'NONE'] as const
export type ExperimentSeedPolicy = (typeof EXPERIMENT_SEED_POLICIES)[number]

/**
 * One scientific experiment design. Scoped by its inputs (DataArtifacts);
 * the runs that instantiate it are named in `run_refs`. Deliberately no
 * `model_ref` — D-T1-1, see header.
 */
export const experimentSpecSchema = zod
  .object({
    experiment_id: idSchema,
    purpose: textSchema,
    // Named `input_data_refs` (not `input_refs`) so the field reads as an
    // IR-internal reference to DataArtifacts, exactly like RunArtifact's —
    // `input_refs` is a legacy EXTERNAL locator name the reftable rules out.
    input_data_refs: zod.array(refSchema),
    /** Parameter sweep as canonical pairs: key = parameter symbol id. */
    parameter_sweep: zod.array(
      zod.object({
        symbol_ref: refSchema,
        values: zod.array(zod.number()),
      }).strict(),
    ),
    metrics: zod.array(refSchema),
    replications: zod.number().int().min(1),
    seed_policy: zod.enum(EXPERIMENT_SEED_POLICIES),
    expected_invariants: zod.array(textSchema),
    run_refs: zod.array(refSchema),
  })
  .strict()
  .refine(v => new Set(v.input_data_refs).size === v.input_data_refs.length, {
    message: 'ExperimentSpec.input_data_refs contains duplicate references',
  })
  .refine(v => new Set(v.run_refs).size === v.run_refs.length, {
    message: 'ExperimentSpec.run_refs contains duplicate references',
  })

export type ExperimentSpec = zod.infer<typeof experimentSpecSchema>
