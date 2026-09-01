#!/usr/bin/env python3
"""Apply or revert one TASK 2 mutation by id.

Same split as TASK 1.5R's `mutate.py`: edit step in its own process so
the *suite* (run by `run-mutations.mjs`) can be driven however the
environment needs.

    python mutate.py apply  M-01
    python mutate.py revert M-01
    python mutate.py list

Each mutation targets one TASK 2 invariant. Six are mandated by the
task book §10; ten more are defensive coverage (every guard, every
field, every short-circuit we added in PHASE 1..4).

The mutation list is intentionally specific: every mutation deletes
or neutralises exactly one line, and the anchor is byte-exact so the
runner reports a hard "anchor not found" if any of them drifts. The
revert step restores a byte-exact backup rather than reversing the
edit, because several mutations *delete* lines and a deletion cannot
be undone by string substitution.
"""

import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / 'packages' / 'paper' / 'paper-foundation'
SRC = PKG / 'src' / 'ir'

# Find/replace pairs. (path, find, replace)
# - `find` is the anchor; if it isn't present, mutation cannot apply.
# - `replace` is the mutated form; for line-deletions it is "".
MUTATIONS: dict[str, tuple[Path, str, str]] = {
    # ---- 6 mandated by task book §10 ----------------------------------
    # 1. delete NUMERIC binding requirement (schema side)
    'M-01': (SRC / 'schema.ts',
             "      numeric_binding: numericBindingSchema,\n",
             "      // MUTATED: NUMERIC binding requirement removed\n      numeric_binding: numericBindingSchema.optional(),\n"),
    # 2. delete value equality (semantic side)
    'M-02': (SRC / 'claim-evidence.ts',
             "        if (typeof assertedValue === 'number' && !numericValuesEqual(assertedValue, target.value)) {\n",
             "        if (false) {\n"),
    # 3. delete unit equality (semantic side)
    'M-03': (SRC / 'claim-evidence.ts',
             "        if (assertedUnit !== target.unit) {\n",
             "        if (false) {\n"),
    # 4. only inspect the first CRITICAL Claim — short-circuit the loop
    'M-04': (SRC / 'claim-evidence.ts',
             "  for (const record of store.values()) {\n    if (record.kind !== 'Claim') continue\n",
             "  for (const [index, record] of [...store.values()].entries()) {\n    if (record.kind !== 'Claim') continue\n    if (index > 0) break\n"),
    # 5. change the snapshot walker to inspect `ir_claims` (artifact subset)
    #    — applied to bridge.ts so the production walker short-circuits.
    'M-05': (SRC / 'bridge.ts',
             "  const evidenceFailures = inspectClaimEvidence(store)\n",
             "  // MUTATED: replaced snapshot walker with artifact-subset walker\n  const evidenceFailures: ReadonlyArray<import('./claim-evidence.ts').ClaimEvidenceFailure> = []\n"),
    # 6. allow MODEL claims to carry a numeric_binding (drop the literal null
    #    requirement by mutating the per-branch discriminator — replace
    #    `numeric_binding: zod.null()` with `numeric_binding: zod.unknown()`
    #    so MODEL accepts any value).
    'M-06': (SRC / 'schema.ts',
             "      numeric_binding: zod.null(),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n      model_refs: zod.array(refSchema).min(1),\n",
             "      numeric_binding: zod.unknown(),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n      model_refs: zod.array(refSchema).min(1),\n"),
    # 7. allow QUALITATIVE with zero evidence_refs (drop the semantic guard)
    'M-07': (SRC / 'claim-evidence.ts',
             "      problems.push({\n        kind: 'qualitative_critical_no_evidence',\n",
             "      // MUTATED: silent\n      // "),
}


def apply_extra(text: str, mid: str) -> str | None:
    """Mutations that need more than find/replace — spelled out below."""
    if mid == 'M-08':
        # 8. drop `result_refs.min(1)` on NUMERIC — let a NUMERIC Claim
        #     pass with no result_refs.
        anchor = "      result_refs: zod.array(refSchema).min(1),\n"
        mutated = "      result_refs: zod.array(refSchema),\n"
        return text.replace(anchor, mutated, 1)
    if mid == 'M-09':
        # 9. delete `model_refs.min(1)` on MODEL — let a MODEL Claim pass
        #    without any ModelSpec ref.
        anchor = "      model_refs: zod.array(refSchema).min(1),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n    })\n    .strict(),\n    zod\n    .object({\n      claim_id: idSchema,\n      text: textSchema,\n      claim_type: zod.literal('QUALITATIVE'),"
        mutated = "      model_refs: zod.array(refSchema),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n    })\n    .strict(),\n    zod\n    .object({\n      claim_id: idSchema,\n      text: textSchema,\n      claim_type: zod.literal('QUALITATIVE'),"
        return text.replace(anchor, mutated, 1)
    if mid == 'M-10':
        # 10. drop the `numeric_binding_result_not_in_result_refs` semantic
        #     check (silently accept binding pointing outside result_refs).
        anchor = "        if (resultRef === undefined || !resultRefs.includes(resultRef)) {\n"
        mutated = "        if (false) {\n"
        return text.replace(anchor, mutated, 1)
    if mid == 'M-11':
        # 11. drop the `numeric_binding_result_unresolved` semantic check.
        anchor = "        problems.push({\n          kind: 'numeric_binding_result_unresolved',"
        mutated = "        // MUTATED: silent\n        // "
        return text.replace(anchor, mutated, 1)
    if mid == 'M-12':
        # 12. drop the `model_claim_no_model_ref` semantic check.
        anchor = "          problems.push({\n            kind: 'model_claim_no_model_ref',\n"
        mutated = "          // MUTATED: silent\n          // "
        return text.replace(anchor, mutated, 1)
    if mid == 'M-13':
        # 13. delete the `&& evidenceFailures.length === 0` clause from
        #     the bridge's `ok =` so a single invalid CRITICAL Claim no
        #     longer blocks delivery (the omission-attack reduction).
        anchor = "    && evidenceFailures.length === 0\n"
        mutated = "    && false\n"
        return text.replace(anchor, mutated, 1)
    if mid == 'M-14':
        # 14. drop the `model_claim_no_model_ref` resolution check loop
        #     entirely by short-circuiting `if (modelRefs.length === 0)`.
        anchor = "    if (modelRefs.length === 0) {\n      problems.push({\n        kind: 'model_claim_no_model_ref',\n        path: `${basePath}.model_refs`,\n        reason: 'MODEL Claim must reference at least one ModelSpec',\n      })\n    } else {\n"
        mutated = "    if (false) {\n      problems.push({\n        kind: 'model_claim_no_model_ref',\n        path: `${basePath}.model_refs`,\n        reason: 'MODEL Claim must reference at least one ModelSpec',\n      })\n    } else {\n"
        return text.replace(anchor, mutated, 1)
    if mid == 'M-15':
        # 15. delete the `numericValuesEqual` collapse — switch to Object.is
        #     so -0/+0 fail equality.
        anchor = "export function numericValuesEqual(a: number, b: number): boolean {\n  return a === b\n}\n"
        mutated = "export function numericValuesEqual(a: number, b: number): boolean {\n  return Object.is(a, b)\n}\n"
        return text.replace(anchor, mutated, 1)
    if mid == 'M-16':
        # 16. drop the `numericValuesEqual` call from the validator so it
        #     always passes — bypasses the value equality entirely.
        anchor = "if (typeof assertedValue === 'number' && !numericValuesEqual(assertedValue, target.value)) {\n"
        mutated = "if (false) {\n"
        return text.replace(anchor, mutated, 1)
    return None


def revert_extra(text: str, mid: str) -> str | None:
    """Inverse of apply_extra."""
    if mid == 'M-08':
        return text.replace(
            "      result_refs: zod.array(refSchema),\n",
            "      result_refs: zod.array(refSchema).min(1),\n", 1)
    if mid == 'M-09':
        mutated = "      model_refs: zod.array(refSchema),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n    })\n    .strict(),\n    zod\n    .object({\n      claim_id: idSchema,\n      text: textSchema,\n      claim_type: zod.literal('QUALITATIVE'),"
        original = "      model_refs: zod.array(refSchema).min(1),\n      evidence_refs: zod.array(refSchema),\n      result_refs: zod.array(refSchema),\n    })\n    .strict(),\n    zod\n    .object({\n      claim_id: idSchema,\n      text: textSchema,\n      claim_type: zod.literal('QUALITATIVE'),"
        return text.replace(mutated, original, 1)
    if mid == 'M-10':
        return text.replace(
            "        if (false) {\n",
            "        if (resultRef === undefined || !resultRefs.includes(resultRef)) {\n", 1)
    if mid == 'M-11':
        mutated = "        // MUTATED: silent\n        // "
        original = "        problems.push({\n          kind: 'numeric_binding_result_unresolved',"
        return text.replace(mutated, original, 1)
    if mid == 'M-12':
        mutated = "          // MUTATED: silent\n          // "
        original = "          problems.push({\n            kind: 'model_claim_no_model_ref',\n"
        return text.replace(mutated, original, 1)
    if mid == 'M-13':
        return text.replace("    && false\n", "    && evidenceFailures.length === 0\n", 1)
    if mid == 'M-14':
        mutated = "    if (false) {\n      problems.push({\n        kind: 'model_claim_no_model_ref',\n        path: `${basePath}.model_refs`,\n        reason: 'MODEL Claim must reference at least one ModelSpec',\n      })\n    } else {\n"
        original = "    if (modelRefs.length === 0) {\n      problems.push({\n        kind: 'model_claim_no_model_ref',\n        path: `${basePath}.model_refs`,\n        reason: 'MODEL Claim must reference at least one ModelSpec',\n      })\n    } else {\n"
        return text.replace(mutated, original, 1)
    if mid == 'M-15':
        return text.replace(
            "export function numericValuesEqual(a: number, b: number): boolean {\n  return Object.is(a, b)\n}\n",
            "export function numericValuesEqual(a: number, b: number): boolean {\n  return a === b\n}\n", 1)
    if mid == 'M-16':
        return text.replace(
            "if (false) {\n",
            "if (typeof assertedValue === 'number' && !numericValuesEqual(assertedValue, target.value)) {\n", 1)
    return None


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == 'list':
        for k in sorted(set(MUTATIONS) | {'M-08', 'M-09', 'M-10', 'M-11', 'M-12', 'M-13', 'M-14', 'M-15', 'M-16'}):
            print(k)
        return 0

    mode, mid = sys.argv[1], sys.argv[2]
    backup = Path(__file__).resolve().parent / f'.{mid}.bak'

    if mode == 'revert':
        if not backup.exists():
            print(f'{mid}: no backup to restore', file=sys.stderr)
            return 2
        target_name = backup.read_text(encoding='utf-8').split('\n')[0]
        target = SRC / target_name
        io.open(target, 'w', encoding='utf-8').write(
            backup.read_text(encoding='utf-8').split('\n', 1)[1])
        backup.unlink()
        return 0

    if mid not in MUTATIONS and mid not in {'M-08', 'M-09', 'M-10', 'M-11', 'M-12', 'M-13', 'M-14', 'M-15', 'M-16'}:
        print(f'{mid}: unknown mutation', file=sys.stderr)
        return 2

    if mid in MUTATIONS:
        path, find, replace = MUTATIONS[mid]
        text = io.open(path, encoding='utf-8').read()
        if find not in text:
            print(f'{mid}: anchor not found in {path.name}', file=sys.stderr)
            return 2
        if backup.exists():
            print(f'{mid}: already applied (backup exists) — revert first', file=sys.stderr)
            return 2
        backup.write_text(path.name + '\n' + text, encoding='utf-8')
        io.open(path, 'w', encoding='utf-8').write(text.replace(find, replace, 1))
        return 0

    # Extra mutation
    path = SRC / ('schema.ts' if mid in {'M-08', 'M-09', 'M-06'} else 'bridge.ts' if mid == 'M-13' else 'claim-evidence.ts')
    text = io.open(path, encoding='utf-8').read()
    if backup.exists():
        print(f'{mid}: already applied (backup exists) — revert first', file=sys.stderr)
        return 2
    backup.write_text(path.name + '\n' + text, encoding='utf-8')
    if mode == 'apply':
        new_text = apply_extra(text, mid)
    else:
        new_text = revert_extra(text, mid)
    if new_text is None or new_text == text:
        print(f'{mid}: anchor not found in {path.name}', file=sys.stderr)
        backup.unlink()
        return 2
    io.open(path, 'w', encoding='utf-8').write(new_text)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())