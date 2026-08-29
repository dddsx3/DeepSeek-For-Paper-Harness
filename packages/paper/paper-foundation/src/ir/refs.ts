/**
 * Modeling IR reference declarations (TASK 1).
 *
 * Task book §7: "所有 reference 必须 resolve". A reference field is only
 * meaningful if something declares *what it must point at*, so this module is
 * that declaration — a closed table, not a naming convention.
 *
 * Two deliberate non-goals, both recorded in `known-risks.md`:
 *
 *   - **External locators are not resolved here.** `code_ref`, `stdout_ref`,
 *     `input_refs`, `output_refs` and `raw_problem_ref` name files/URIs
 *     outside the IR graph. The IR has no filesystem, so it only enforces
 *     that they are non-empty; proving the bytes exist is TASK 3's execution
 *     gate.
 *   - **`ANY` is not a hole.** `evidence_refs` may point at any registered
 *     object (a Result can be evidence for a Claim; so can a RunArtifact).
 *     `ANY` still requires the ID to exist — it only relaxes the *kind*
 *     check, never the *existence* check.
 */

import { deepFreeze } from './freeze.ts'
import type { IrKind } from './schema.ts'

/**
 * What a reference field is allowed to point at. `'ANY'` means "any
 * registered object".
 */
export type IrRefTarget = IrKind | 'ANY'

export interface IrRefFieldSpec {
  /** Field name on the IR object. */
  readonly path: string
  /** `'single'` for a bare string ref, `'many'` for an array of refs. */
  readonly arity: 'single' | 'many'
  readonly target: IrRefTarget
}

/**
 * Closed table of IR-resolvable reference fields, per kind. A field that is
 * absent from this table is an external locator and is NOT resolved against
 * the canonical store.
 */
export const IR_REF_FIELDS: Readonly<Record<IrKind, ReadonlyArray<IrRefFieldSpec>>> = {
  ProblemSpec: [],
  ModelSpec: [
    { path: 'problem_refs', arity: 'many', target: 'ProblemSpec' },
    { path: 'dependencies', arity: 'many', target: 'ModelSpec' },
  ],
  RunArtifact: [
    { path: 'model_ref', arity: 'single', target: 'ModelSpec' },
  ],
  Result: [
    { path: 'run_ref', arity: 'single', target: 'RunArtifact' },
  ],
  Claim: [
    { path: 'evidence_refs', arity: 'many', target: 'ANY' },
    { path: 'result_refs', arity: 'many', target: 'Result' },
    { path: 'model_refs', arity: 'many', target: 'ModelSpec' },
  ],
  VerificationResult: [
    { path: 'target_ref', arity: 'single', target: 'ANY' },
    { path: 'evidence_refs', arity: 'many', target: 'ANY' },
  ],
  // `data_refs` resolves to `Result` in TASK 1 because DataArtifact does not
  // exist until TASK 1.5; TASK 1.5 widens this to `['Result', 'DataArtifact']`.
  FigureSpec: [
    { path: 'data_refs', arity: 'many', target: 'Result' },
    { path: 'claim_refs', arity: 'many', target: 'Claim' },
  ],
  ReviewerFinding: [
    { path: 'target_ref', arity: 'single', target: 'ANY' },
    { path: 'evidence_refs', arity: 'many', target: 'ANY' },
  ],
}

// This table *is* the reference policy, so it must not be writable at
// runtime: assigning `IR_REF_FIELDS.Result = []` silently legalised a
// dangling `run_ref` in every store in the process (red team RT2-02 / RT3-01).
deepFreeze(IR_REF_FIELDS)

/** Why a reference failed to resolve. */
export type IrRefResolution = 'missing' | 'kind_mismatch'

export interface IrRefProblem {
  readonly path: string
  readonly ref: string
  readonly target: IrRefTarget
  readonly resolution: IrRefResolution
  /** The kind the ref actually resolved to, or `null` when it is missing. */
  readonly actual: IrKind | null
}

/** Resolves a reference to the kind of the object it names. */
export type IrRefResolver = (ref: string) => IrKind | undefined

/**
 * Check every declared IR reference field of `value`.
 *
 * Only valid to call on an object that already passed
 * `IR_SCHEMAS[kind].parse` — the arity casts below trust the schema.
 *
 * Every reference is checked; the function does not stop at the first
 * problem, so one ingest reports every dangling edge at once.
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
    const refs: ReadonlyArray<string> = spec.arity === 'single'
      ? [raw as string]
      : (raw as ReadonlyArray<string>)

    for (const ref of refs) {
      const actual = resolve(ref)
      if (actual === undefined) {
        problems.push({ path: spec.path, ref, target: spec.target, resolution: 'missing', actual: null })
      } else if (spec.target !== 'ANY' && actual !== spec.target) {
        problems.push({ path: spec.path, ref, target: spec.target, resolution: 'kind_mismatch', actual })
      }
    }
  }

  return problems
}
