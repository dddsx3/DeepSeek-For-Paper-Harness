/**
 * Modeling IR reference declarations (TASK 1 + TASK 1.5R).
 *
 * Task book §7: "所有 reference 必须 resolve". A reference field is only
 * meaningful if something declares *what it must point at*, so this module is
 * that declaration — a closed table, not a naming convention.
 *
 * TASK 1.5R — Canonical Reference Closure: every IR-internal reference is
 * closed against the canonical store at commit time. `validateRefFields` walks
 * the closed policy, and `ModelingIr.put()` refuses any ingest whose value
 * contains a missing or wrong-kind reference. The delivery bridge is no
 * longer the first line of structural reference validity; it keeps the
 * semantic role/source/scope/uniqueness checks and the FORMAL/FAST minimum
 * contract, and is the only consumer that runs them.
 *
 * Two deliberate non-goals, both recorded in `known-risks.md`:
 *
 *   - **External locators are not resolved here.** `code_ref`, `stdout_ref`,
 *     `input_refs`, `output_refs` name files/URIs outside the IR graph. The IR
 *     has no filesystem, so it only enforces that they are non-empty; proving
 *     the bytes exist is TASK 3's execution gate.
 *   - **`ANY` is genuinely any.** `evidence_refs` may point at any registered
 *     object (a Result can be evidence for a Claim; so can a RunArtifact).
 *     `ANY` still requires the ID to exist — it only relaxes the *kind*
 *     check, never the *existence* check. A known narrow union such as
 *     `FigureSpec.data_refs: Result | DataArtifact` is expressed as a target
 *     set, not as `ANY`: the per-element kind check belongs here, on the
 *     store's commit boundary.
 *
 *   - **Ingest must follow the dependency topology.** The store is append-only
 *     with no forward-reference repair queue, so an object can only resolve a
 *     ref to an id that is already registered. `target: 'ANY'` is reserved
 *     for evidence-style refs where the id's kind does not matter; structural
 *     refs use a single kind or an explicit narrow target set.
 */

import { deepFreeze } from './freeze.ts'
import type { IrKind } from './schema.ts'

/**
 * What a reference field is allowed to point at.
 *
 *   - `'ANY'`          : any registered object. Existence is still required.
 *   - `IrKind`         : exactly that kind.
 *   - `readonly IrKind[]`: any one of the listed kinds (closed narrow union).
 *
 * Closed: `'ANY'` is reserved for refs whose id's kind does not constrain
 * the relationship. Known unions must be enumerated, not collapsed to `'ANY'`.
 */
export type IrRefTarget = IrKind | readonly IrKind[] | 'ANY'

/**
 * How `IrRefFieldSpec` reads refs out of an object.
 *
 *   - `'single'`           : a bare string field.
 *   - `'many'`             : an array of strings.
 *   - `{ kind: 'nested', …}`: an array of objects, each carrying a string ref
 *     under `child`. The path is reported with the index so the audit trail
 *     names the exact offender.
 */
export type IrRefArity =
  | 'single'
  | 'many'
  | { readonly kind: 'nested'; readonly child: string }

/** A closed declaration of one IR-internal reference field. */
export interface IrRefFieldSpec {
  /** Field name on the IR object. */
  readonly path: string
  /** How the field is read out of the object. */
  readonly arity: IrRefArity
  /** What the ref is allowed to point at. */
  readonly target: IrRefTarget
}

/**
 * Closed table of IR-resolvable reference fields, per kind. A field that is
 * absent from this table is an external locator and is NOT resolved against
 * the canonical store.
 *
 * TASK 1.5R: every IR-internal reference declared by the new Problem
 * Contract (`ProblemSpec.raw_problem_ref` / `requirement_refs`,
 * `ModelSpec.variable_refs` / `parameter_refs[].symbol_ref`,
 * `RunArtifact.input_data_refs`, `FigureSpec.data_refs`) is now an entry in
 * this table with a target set that is no wider than necessary. The store
 * is the single point of truth for existence + kind closure; the bridge
 * only walks role / source / scope / minimum contract.
 */
export const IR_REF_FIELDS: Readonly<Record<IrKind, ReadonlyArray<IrRefFieldSpec>>> = {
  ProblemSpec: [
    // `raw_problem_ref` is an IR-internal reference: it points at a
    // `DataArtifact` in the canonical store. The bridge keeps the
    // role=RAW_PROBLEM semantic check; existence+kind lives here.
    { path: 'raw_problem_ref', arity: 'single', target: 'DataArtifact' as const },
    { path: 'requirement_refs', arity: 'many', target: 'RequirementSpec' as const },
  ],
  ModelSpec: [
    { path: 'problem_refs', arity: 'many', target: 'ProblemSpec' as const },
    { path: 'dependencies', arity: 'many', target: 'ModelSpec' as const },
    // Variables are SymbolSpec records; the bridge keeps the role=VARIABLE
    // + scope-ownership semantic check.
    { path: 'variable_refs', arity: 'many', target: 'SymbolSpec' as const },
    // Parameters are nested objects; the spec extractor walks each entry and
    // resolves its `symbol_ref` to a SymbolSpec.
    { path: 'parameter_refs', arity: { kind: 'nested', child: 'symbol_ref' }, target: 'SymbolSpec' as const },
  ],
  RunArtifact: [
    { path: 'model_ref', arity: 'single', target: 'ModelSpec' as const },
    // Inputs are DataArtifact records; the bridge keeps the role=INPUT_DATA
    // semantic check.
    { path: 'input_data_refs', arity: 'many', target: 'DataArtifact' as const },
  ],
  Result: [
    { path: 'run_ref', arity: 'single', target: 'RunArtifact' as const },
  ],
  Claim: [
    { path: 'evidence_refs', arity: 'many', target: 'ANY' },
    { path: 'result_refs', arity: 'many', target: 'Result' as const },
    { path: 'model_refs', arity: 'many', target: 'ModelSpec' as const },
  ],
  VerificationResult: [
    { path: 'target_ref', arity: 'single', target: 'ANY' },
    { path: 'evidence_refs', arity: 'many', target: 'ANY' },
  ],
  // `data_refs` is the canonical narrow union `Result | DataArtifact`. The
  // per-element kind check belongs on the store boundary, not on the bridge.
  FigureSpec: [
    { path: 'data_refs', arity: 'many', target: ['Result', 'DataArtifact'] as const },
    { path: 'claim_refs', arity: 'many', target: 'Claim' as const },
  ],
  ReviewerFinding: [
    { path: 'target_ref', arity: 'single', target: 'ANY' },
    { path: 'evidence_refs', arity: 'many', target: 'ANY' },
  ],
  DataArtifact: [],
  RequirementSpec: [
    { path: 'source_data_ref', arity: 'single', target: 'DataArtifact' as const },
  ],
  SymbolSpec: [
    { path: 'scope_ref', arity: 'single', target: 'ProblemSpec' as const },
  ],
}

// This table *is* the reference policy, so it must not be writable at
// runtime: assigning `IR_REF_FIELDS.Result = []` silently legalised a
// dangling `run_ref` in every store in the process (red team RT2-02 / RT3-01).
deepFreeze(IR_REF_FIELDS)

/** Why a reference failed to resolve. */
export type IrRefResolution = 'missing' | 'kind_mismatch'

/** A ref that the resolver rejected, with enough context for a stable audit. */
export interface IrRefProblem {
  /** Field path on the offending object (e.g. `parameter_refs.2.symbol_ref`). */
  readonly path: string
  readonly ref: string
  /** The kind the ref is *allowed* to be — `'ANY'` for genuinely-any refs. */
  readonly target: IrRefTarget
  readonly resolution: IrRefResolution
  /** The kind the ref actually resolved to, or `null` when it is missing. */
  readonly actual: IrKind | null
}

/** Resolves a reference to the kind of the object it names. */
export type IrRefResolver = (ref: string) => IrKind | undefined

/**
 * Decide whether `actual` is a permitted target for `target`.
 *
 * Extracted so the per-element check is shared between `validateRefFields`
 * and any future test that wants to assert the policy without standing up a
 * full store.
 */
export function isAllowedTarget(target: IrRefTarget, actual: IrKind): boolean {
  if (target === 'ANY') return true
  if (typeof target === 'string') return target === actual
  return target.includes(actual)
}

/**
 * Check every declared IR reference field of `value`.
 *
 * Only valid to call on an object that already passed
 * `IR_SCHEMAS[kind].parse` — the arity casts below trust the schema.
 *
 * Every reference is checked; the function does not stop at the first
 * problem, so one ingest reports every dangling edge at once. The function
 * is total: a throwing extractor yields an `internal_error`-style problem
 * rather than escaping as an exception.
 */
export function validateRefFields(
  kind: IrKind,
  value: unknown,
  resolve: IrRefResolver,
): ReadonlyArray<IrRefProblem> {
  const problems: IrRefProblem[] = []
  const source = value as Record<string, unknown>

  for (const spec of IR_REF_FIELDS[kind]) {
    const raw = source[spec.path]
    if (spec.arity === 'single') {
      // Bare string ref. Schema has already rejected `undefined` / wrong type.
      const ref = raw as string
      problems.push(...checkRef(spec.path, ref, spec.target, resolve))
      continue
    }
    if (spec.arity === 'many') {
      const refs = raw as ReadonlyArray<string>
      for (const ref of refs) {
        problems.push(...checkRef(spec.path, ref, spec.target, resolve))
      }
      continue
    }
    // Nested: each entry is an object; the ref is at `entry[spec.arity.child]`.
    const entries = raw as ReadonlyArray<Record<string, unknown>>
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!
      const ref = entry[spec.arity.child] as string
      problems.push(...checkRef(`${spec.path}.${i}.${spec.arity.child}`, ref, spec.target, resolve))
    }
  }

  return problems
}

function checkRef(
  path: string,
  ref: string,
  target: IrRefTarget,
  resolve: IrRefResolver,
): ReadonlyArray<IrRefProblem> {
  const actual = resolve(ref)
  if (actual === undefined) {
    return [{ path, ref, target, resolution: 'missing', actual: null }]
  }
  if (!isAllowedTarget(target, actual)) {
    return [{ path, ref, target, resolution: 'kind_mismatch', actual }]
  }
  return []
}
