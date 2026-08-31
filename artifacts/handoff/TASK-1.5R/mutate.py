#!/usr/bin/env python3
"""Apply or revert one TASK 1.5 mutation by id.

Split out of `run-mutations.mjs` so the mutation can also be driven from a
shell loop. That matters because this environment cannot reliably spawn a
nested `node` process that runs vitest — the child hangs indefinitely — while
invoking vitest from the shell works. Keeping the edit step in its own
process lets the *suite* be run by whatever mechanism is available.

    python mutate.py apply  M-09
    python mutate.py revert M-09
    python mutate.py list

`revert` is idempotent and safe to run on an unmutated tree: it only performs
the replacement when the mutated text is present and the original is not.
"""

import io
import sys
from pathlib import Path

# __file__ = <repo>/artifacts/handoff/TASK-1.5/mutate.py
# parents[0] = TASK-1.5, [1] = handoff, [2] = artifacts, [3] = repo root.
ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / 'packages' / 'paper' / 'paper-foundation'
SRC = PKG / 'src' / 'ir'

MUTATIONS = {
    'M-01': (SRC / 'problem-contract.ts',
             "  .regex(/^sha256:[0-9a-f]{64}$/, 'content_hash must be sha256:<64 lowercase hex>')", ""),
    'M-02': (SRC / 'problem-contract.ts',
             "      } else if (target.kind !== 'RequirementSpec') {", "      } else if (false) {"),
    'M-03': (SRC / 'problem-contract.ts',
             "if (typeof reqSource === 'string' && reqSource !== rawRef) {", "if (false) {"),
    'M-05': (SRC / 'problem-contract.ts',
             "        } else if (target.role !== 'VARIABLE') {", "        } else if (false) {"),
    'M-06': (SRC / 'problem-contract.ts',
             "        } else if (target.role !== 'PARAMETER') {", "        } else if (false) {"),
    'M-07': (SRC / 'problem-contract.ts',
             "      } else if (target.role !== 'INPUT_DATA') {", "      } else if (false) {"),
    'M-08': (SRC / 'problem-contract.ts',
             "      } else if (target.kind !== 'Result' && target.kind !== 'DataArtifact') {",
             "      } else if (false) {"),
    'M-09': (SRC / 'bridge.ts',
             "    && (!requiresBackbone || contractSatisfied)\n", ""),
    'M-10': (SRC / 'schema.ts',
             "    requirement_refs: zod.array(refSchema),\n  })\n  .strict()",
             "    requirement_refs: zod.array(refSchema),\n  })"),
    'M-11': (SRC / 'problem-contract.ts',
             "  .refine(v => v === v.normalize('NFC'), 'token must be in Unicode NFC form')", ""),
    'M-12': (SRC / 'bridge.ts',
             "  const orphanModelSpecs = modelSpecs.filter(m => !claimedModelIds.has(String(m['model_id'])))",
             "  const orphanModelSpecs: ReadonlyArray<Readonly<Record<string, unknown>>> = []"),
    'M-13': (SRC / 'problem-contract.ts',
             "    if (!declaresRequiredOutput) {", "    if (false) {"),
    'M-14': (SRC / 'parse.ts',
             "  if (budget.nodes > MAX_IR_VALUE_NODES) return 'too_large'", "  if (false) return 'too_large'"),
    # M-04 needs a two-line insertion, so it is spelled out rather than
    # encoded as a find/replace pair.
}


def apply_m04(text: str) -> str:
    anchor = "  const seen = new Map<string, { readonly scope_ref: string; readonly token: string; readonly symbol_id: string }>()"
    return text.replace(
        anchor,
        "  return []\n  // eslint-disable-next-line no-unreachable\n" + anchor,
        1,
    )


def revert_m04(text: str) -> str:
    return text.replace(
        "  return []\n  // eslint-disable-next-line no-unreachable\n", "", 1
    )


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] == 'list':
        for k in sorted(MUTATIONS):
            print(k, MUTATIONS[k][0].name)
        print('M-04 problem-contract.ts')
        return 0

    mode, mid = sys.argv[1], sys.argv[2]

    # Revert restores a byte-exact backup rather than reversing the edit.
    # Several mutations *delete* a line, and a deletion cannot be undone by
    # string substitution — which is exactly how M-09 left the working tree
    # mutated after a partial run.
    backup = Path(__file__).resolve().parent / f'.{mid}.bak'
    if mode == 'revert':
        if not backup.exists():
            print(f'{mid}: no backup to restore', file=sys.stderr)
            return 2
        target = SRC / backup.read_text(encoding='utf-8').split('\n')[0]
        io.open(target, 'w', encoding='utf-8').write(
            backup.read_text(encoding='utf-8').split('\n', 1)[1])
        backup.unlink()
        return 0

    if mid == 'M-04':
        path = SRC / 'problem-contract.ts'
        text = io.open(path, encoding='utf-8').read()
        backup.write_text(path.name + '\n' + text, encoding='utf-8')
        io.open(path, 'w', encoding='utf-8').write(apply_m04(text))
        return 0

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


if __name__ == '__main__':
    raise SystemExit(main())
