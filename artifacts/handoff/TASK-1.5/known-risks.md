# TASK 1.5 — Known risks and deferred work

Recorded honestly rather than left implicit. Each entry states what is not
guaranteed, why, and where it is owned.

## 1. Hashes are not verified against real bytes

`DataArtifact.content_hash` is validated for *format*
(`sha256:<64 lowercase hex>`) only. Nothing in TASK 1.5 reads the referenced
locator or compares the digest to the actual content. A well-formed hash that
does not correspond to any real bytes is accepted.

- **Consequence:** provenance-by-bytes is not yet established. The contract
  proves canonical *identity* and a *declarable* hash, not that the bytes
  exist or are unchanged.
- **Owner:** TASK 3 (Execution / Provenance Gate).
- **Not a regression:** the task book §3 defers it explicitly.

## 2. Compatibility-equivalent symbol tokens are not folded

`SymbolSpec.token` is now required to be NFC, which closes canonical
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

## 3. ProblemSpec reference fields are absent from `IR_REF_FIELDS`

The store admits a `ProblemSpec` whose `raw_problem_ref` and
`requirement_refs` name nothing; only the bridge resolves them. A consumer
that reads canonical state directly, without going through the bridge, can
see a ProblemSpec with dangling edges.

- **Why accepted:** declaring them in the closed table would make the store
  refuse those objects before the contract guards ever run. C-002, C-003 and
  C-005 would then pass because the *store* blocked them, and the contract
  guards they exist to test would become unreachable — PHASE 7 mutation of
  the requirement kind check (M-02) would have nothing to kill. Choosing
  testability over redundant enforcement is deliberate: the bridge is the
  delivery choke point and fails closed, so this is defence in depth, not an
  escape.
- **Consequence:** the store's own "a reference that resolved at ingest can
  never dangle" property does not hold for ProblemSpec. The documentation in
  `store.ts` should say so; it currently reads as universal.
- **Revisit when:** a task introduces a second consumer of canonical state
  that does not go through the bridge.

## 4. `MAX_IR_VALUE_NODES` is a blunt budget

100 000 nodes is generous for a legal IR object (a full canonical chain is a
few hundred) and small enough to bound the cost of a hostile payload. It is a
single global figure, not a per-field cardinality policy.

- **Consequence:** a payload of 90 000 `requirement_refs` is accepted. It is
  bounded and cheap to validate, but it is not *sensible*.
- **Suggested owner:** a task that defines input budgets per semantic field.

## 5. Mutation testing is fast because it is shallow

The PHASE 7 harness mutates one exact source anchor per guard. It proves each
listed guard is load-bearing; it does not explore combinations, and it will
not notice a guard that is duplicated in two places where only one is
mutated.

- **Consequence:** the 14/14 result is evidence about these 14 guards, not a
  general statement about the suite's sensitivity.
- **Mitigation:** anchors that stop matching are reported as errors rather
  than skipped, so a refactor cannot silently disable a mutation.

## 6. EXPLORATORY mode does not require the minimum contract

By design: EXPLORATORY may hold an empty contract. Every object it does
declare is still schema-validated, reference-checked and contract-checked —
so the escape is bounded to "no problem declared yet", not "a malformed
problem declared".

- **Consequence:** an EXPLORATORY run can deliver with no Problem Contract.
- **Owner:** intentional. The task book constrains FORMAL and FAST only.

## 7. Unrelated untracked directories exist in the working tree

`packages/typert/generator/tests/` contains leftover
`.explicit-service-*` / `.generated-*` directories from an earlier test run.
They are **not** part of TASK 1.5 and were deliberately excluded from this
commit rather than bulk-deleted.

- **Action for the reader:** confirm they are test residue before removing
  them. They were not produced by this task.
