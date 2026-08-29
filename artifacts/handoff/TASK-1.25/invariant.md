# TASK 1.25 — Canonical IR Enforcement Bridge

**Source.** External advisory review, 2026-08-29. The advisor closed TASK -1,
TASK 0 and TASK 1 (implementation) and raised one **P0 architecture escape**
instead:

```
IR_CAN_BE_BYPASSED
```

The advisor's diagnosis, verbatim in substance:

> 现在你们已经造出了一个非常难攻破的 `ModelingIr`… 但 workflow 根本还不依赖这个 IR。
> "非法对象无法进入 canonical state" 是真的，但 "论文必须来自 canonical state" 还没有成立。
> 这就是典型的 vacuous security property（真空式安全属性）。

**This task is deliberately narrow.** It does **not** extend the ontology
(no Requirement Registry / DataArtifact / Symbol Registry — that is TASK 1.5)
and it does **not** build the Claim→Result→Run evidence chain (TASK 2). It
answers exactly one question:

> **Can the paper workflow still ignore `ModelingIr` completely and reach
> Candidate / Verified / Deliverable anyway?**

Today the answer is yes, and `WorkflowExecutor.deliver()` proves it:

```
LLM output ─▶ free text ─▶ storeArtifact({kind:'text'}) ─▶ buildManifest ─▶ delivered
                              (ModelingIr never consulted)
```

---

## Invariants

### INV-1.25-A — no fake IR (反冒充)
Anything the workflow **claims** to be an IR object must carry a canonical IR
identity. A claim is a closed record:

```ts
{ artifact_id: string, ir_kind: IrKind, ir_ref: string }
```

It is admissible only when `ModelingIr.get(ir_ref)` exists **and**
`record.kind === ir_kind`. A `{ type: 'claim', content: '...' }` style text
artifact may no longer pass itself off as an IR object.

### INV-1.25-B — no bypass (反绕开)
In `FORMAL` and `FAST` mode, delivery requires a canonical **IR backbone**:

```
ProblemSpec ≥ 1, ModelSpec ≥ 1, RunArtifact ≥ 1, Result ≥ 1, Claim ≥ 1,
and ≥ 1 Claim with criticality CRITICAL
```

`EXPLORATORY` mode is exempt (no mathematical facts exist yet) — but INV-A
still applies to it: if it claims IR objects, they must be real.

### INV-1.25-C — no missing critical gate (让 A/B 真正生效的前提)
`evaluateDelivery` previously only inspected the gates it was *handed*, so a
caller that simply omitted a critical gate was approved. That is a fail-open
which would let the new `ir_canonicalization` gate be "forgotten". Now every id
in `CRITICAL_GATE_IDS` must be present in `policy.gates`; a missing one blocks.

> This is the one place where TASK 1.25 touches TASK 0 code. It is in scope
> because without it INV-A and INV-B are unenforceable, not because TASK 0 is
> being reopened. TASK 0 stays CLOSED.

---

## Mechanism (no new gate machinery)

`ir_canonicalization` becomes an ordinary **critical gate** in TASK 0's
existing `CRITICAL_GATE_IDS`. That single wiring buys, for free:

- FAST mode cannot skip it (TASK 0 already forbids skipping critical gates);
- `promoter` — the only mint of `DeliverableArtifact` — refuses on non-PASS;
- the refusal is recorded as a closed `DeliveryFailure`, not a thrown error.

`src/ir/bridge.ts` owns the gate's evaluation; it never throws and never
mutates the store.

---

## Explicitly out of scope

- Extending the ontology (TASK 1.5)
- Claim→Result→Run evidence chain and text-mutation tests (TASK 2)
- Deterministic gates v1 (TASK 3)
- Rewriting `WorkflowExecutor` — TASK 1.25 adds one gate call on the delivery
  path; it does not restructure the executor.

## Acceptance

- fault corpus `B-001..B-008` all `BLOCKED`
- ≥3 red-team agents execute real attacks against the running code
- mutation testing kills every new guard
- the advisor's External Attack Gate is the final say
