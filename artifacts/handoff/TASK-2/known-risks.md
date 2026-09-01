# TASK 2 — Known Risks (and what is out of scope)

> The validator guarantees that the CRITICAL Claim's *core number* lives
> in `numeric_binding`, but TASK 2 deliberately stops at the IR
> boundary. Everything below is a known risk that another task owns.

## 1. Real execution is not verified — TASK 3 owns this

`numeric_binding.asserted_value` is checked against `Result.value` —
both are canonical numbers in the IR. **The IR has no view of the
filesystem.** Whether `Result.value` was *actually produced* by the
run the `RunArtifact.code_hash` names is TASK 3's provenance gate.

A paper could hand-write a `Result` with `value: 0.731` and bind a
Claim to it; the validator accepts the binding because the canonical
match holds. TASK 3 closes this by re-running the code and comparing
the new `value` to the stored one.

**This risk is documented and superseded**; it belongs to TASK 3.

## 2. Hash bytes are not verified — TASK 3 owns this

`DataArtifact.content_hash` and `RunArtifact.{code,input,output}_hash`
are shape-checked (`sha256:<64 lowercase hex>`) but their bytes are
not fetched or verified. The IR carries the hash as a *claim about*
the bytes; TASK 3's execution gate is the verifier.

**Superseded by TASK 3.**

## 3. No tolerance / rounding / repair — TASK 3 owns numeric equality

TASK 2 freezes `numericValuesEqual` as exact identity (`a === b`,
collapsing `-0/+0`). TASK 3 will need a stronger numeric equality
than the IR's "shape match" — the run that produced `Result.value`
recomputes the same quantity and expects the same number to within
the recorded uncertainty. That is TASK 3, not TASK 2.

**Out of scope by design.** Task book §2 explicitly forbids
tolerance/rounding in TASK 2: "不允许 tolerance/rounding 模糊匹配偷偷把不相等数字视为相等；TASK 2 只做 identity/binding，数值一致性算法属于 TASK 3."

## 4. Update / replace / STALE — TASK 3.5 owns this

`ModelingIr` is append-only. There is no in-place update. A run that
re-executes produces a *new* `RunArtifact` and a *new* `Result` —
the canonical store cannot reach back and mark the old ones stale.

TASK 3.5 will own the staleness propagation: a re-run that produces
a different `value` should propagate a STALE label to every claim
that depended on the old value. TASK 2 closes none of this; the IR
is honest about the lack.

**Superseded by TASK 3.5.**

## 5. Reviewer authority / reviewer findings — TASK 5 owns this

`ReviewerFinding.evidence_refs` is `ANY` by `IR_REF_FIELDS`. TASK 5
will own the policy: which reviewer can target which object, and what
authority a finding carries.

TASK 2's binding does not interact with ReviewerFinding — a
CRITICAL Claim can be paired with a finding that disputes it, and
the binding still passes. TASK 5 closes the policy.

**Out of scope.**

## 6. Renderer / EquationSpec / FigureSpec policy — TASK 7 owns this

The discriminated union does not add a `figure_refs` field; the
existing `FigureSpec.claim_refs` is unchanged. TASK 7's renderer
will own the policy of "this claim appears in this figure". TASK 2
guarantees only that the binding holds before the renderer ever
sees the claim.

**Out of scope.**

## 7. TEXT-to-binding inference is forbidden by design

The natural-language `text` of a Claim is **purely presentational**.
TASK 2 never parses `text` to recover the canonical number; the
binding is the only source of truth. If a model writes `text =
"97.3%"` but `numeric_binding.asserted_value = 0.973`, the
validator reports `numeric_value_mismatch` if a `Result.value`
differs — there is no text recovery path.

This is by design: the binding is the claim; the text is the paper.
A future renderer may render `text` as it sees fit; the binding is
the only thing the validator inspects.

## 8. `requirement_refs` on Claim is not added

The task book §3 makes the Claim-side `requirement_refs` field
*recommended* but allows deferral if "the existing model for
requirement mapping is not yet mature". TASK 2 defers it: the
Problem → Requirement closure is already enforced by the
problem-contract guards (`cross_source_requirement`,
`missing_required_output_requirement`); a future TASK can add the
Claim-side `requirement_refs` field when the model's
requirement-mapping becomes stable.

## 9. workflow wiring is fixture-driven, not production-driven

PHASE 3 satisfies task book §8 by reading `ModelingIr.snapshot`
during delivery. The composition (`PaperExecutorService`) still mounts
a pre-populated `ModelingIr` from the test fixture, because the
workflow path (`WorkflowExecutor.deliver`) does not produce Claim /
Result / RunArtifact IR objects. The existing comment at
`src/executor.ts:226-228` is preserved.

A real workflow wiring is **out of scope** for TASK 2 (task book
§2: "executor / executor-service / workflow … 仅为真实生产路径提供
canonical claim/result ingest 与 gate wiring"). The handoff
documents this explicitly; the next TASK (3) that wires execution
to the IR will close it.