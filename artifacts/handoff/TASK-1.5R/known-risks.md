# TASK 1.5R — Known risks and deferred work

Recorded honestly rather than left implicit. Each entry states what is not
guaranteed, why, and where it is owned.

This file supersedes `artifacts/handoff/TASK-1.5/known-risks.md`. The one
entry that described a *trust-model break* — "ProblemSpec reference fields
are absent from `IR_REF_FIELDS`" — is **deleted**: TASK 1.5R closed every
IR-internal reference (`ProblemSpec.raw_problem_ref` / `requirement_refs`,
`ModelSpec.variable_refs` / `parameter_refs[].symbol_ref`,
`RunArtifact.input_data_refs`, `FigureSpec.data_refs`) at the store commit
boundary, so the store's "a reference that resolved at ingest can never
dangle" invariant now holds for every kind, and `store.ts`'s documentation
is consistent with the implementation again.

## 1. Hashes are not verified against real bytes

`DataArtifact.content_hash` is validated for *format*
(`sha256:<64 lowercase hex>`) only. Nothing in TASK 1.5 / 1.5R reads the
referenced locator or compares the digest to the actual content. A
well-formed hash that does not correspond to any real bytes is accepted.

- **Consequence:** provenance-by-bytes is not yet established. The contract
  proves canonical *identity* and a *declarable* hash, not that the bytes
  exist or are unchanged.
- **Owner:** TASK 3 (Execution / Provenance Gate).
- **Not a regression:** the task book §3 defers it explicitly.

## 2. Compatibility-equivalent symbol tokens are not folded

`SymbolSpec.token` is required to be NFC, which closes canonical
equivalence. NFC does **not** fold compatibility equivalents, so Latin `a`,
Cyrillic `а` (U+0430) and fullwidth `ａ` (U+FF41) remain three distinct
tokens — and a reader would see them as the same symbol.

- **Why not fixed:** folding them needs a confusable/skeleton table (UTS #39).
  Choosing one is a policy decision with consequences for every identifier in
  the IR, not just symbol tokens, and TASK 1.5's scope is the three canonical
  objects. The IR already treats IDs the same way, so this keeps token
  handling consistent with ID handling rather than inventing a one-off rule.
- **Consequence:** a deliberate homoglyph can still define two meanings for
  what a human reads as one symbol. It is a narrower hole than before — the
  accidental case (a different editor's normalisation) is closed.
- **Suggested owner:** a future task that adopts a confusable policy for all
  IR identifiers at once.

## 3. `MAX_IR_VALUE_NODES` is a blunt budget

100 000 nodes is generous for a legal IR object (a full canonical chain is a
few hundred) and small enough to bound the cost of a hostile payload. It is a
single global figure, not a per-field cardinality policy.

- **Consequence:** a payload of 90 000 `requirement_refs` is accepted. It is
  bounded and cheap to validate, but it is not *sensible*.
- **Suggested owner:** a task that defines input budgets per semantic field.

## 4. Mutation testing is fast because it is shallow

The PHASE 5 harness mutates one exact source anchor per guard. It proves each
listed guard is load-bearing; it does not explore combinations, and it will
not notice a guard that is duplicated in two places where only one is
mutated.

- **Consequence:** the 14/14 result is evidence about these 14 guards, not a
  general statement about the suite's sensitivity.
- **Mitigation:** anchors that stop matching are reported as errors rather
  than skipped, so a refactor cannot silently disable a mutation.

## 5. EXPLORATORY mode does not require the minimum contract

By design: EXPLORATORY may hold an empty contract. Every object it does
declare is still schema-validated and reference-closed by the store, and
passes the semantic guards the bridge runs in every mode — so the escape is
bounded to "no problem declared yet", not "a malformed problem declared".

- **Consequence:** an EXPLORATORY run can deliver with no Problem Contract.
- **Owner:** intentional. The task book constrains FORMAL and FAST only.

## 6. Figure data_refs has no bridge-level semantic guard left

TASK 1.5R PHASE 3 removed the figure kind check from the bridge entirely
(`FigureSpec.data_refs` is closed by the store's narrow `Result | DataArtifact`
target set, and renderer policy is TASK 7). A figure whose `data_refs` names
a Result or DataArtifact with a *semantically wrong* role (e.g. an
INPUT_DATA artifact plotted as the primary result) is not rejected by
anything in this task.

- **Consequence:** figure-level semantic policy is deferred, exactly as the
  task book scopes it.
- **Owner:** TASK 7 (renderer / EquationSpec / TableSpec).

## 7. Unrelated untracked directories exist in the working tree

`packages/typert/generator/tests/` contains leftover
`.explicit-service-*` directories from an earlier test run. They are **not**
part of TASK 1.5R and were deliberately excluded from the commit rather than
bulk-deleted.

- **Action for the reader:** confirm they are test residue before removing
  them. They were not produced by this task.
