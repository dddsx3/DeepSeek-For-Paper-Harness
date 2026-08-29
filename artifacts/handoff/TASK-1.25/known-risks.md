# Known risks (deferred) — TASK 1.25

The presence of an entry here is **not** a failure; the presence of a
**fixed-but-undocumented** risk in this commit **is**.

| ID | Description | Why deferred | Target TASK |
|----|-------------|--------------|-------------|
| RISK-1.25-01 | **INV-1.25-A is input-vacuous today.** The executor passes `claims: []` because the workflow does not yet *make* IR claims; A's mechanism is complete and tested (`bridge.spec.ts`), but no production input exercises it until claims exist. | Populating claims requires parsing the paper text for IR-object statements — that is TASK 2's evidence chain, not a bridge concern. | TASK 2 |
| RISK-1.25-02 | **The executor never registers IR objects during a run.** INV-1.25-B's backbone must be present in the store before delivery, but nothing in the run itself *creates* those objects yet; today a composition must pre-register them or the run is blocked. | Making the run produce IR objects is the Claim→Result→Run chain (TASK 2). Being blocked meanwhile is the intended fail-closed behaviour. | TASK 2 |
| RISK-1.25-03 | **`EXPLORATORY` is exempt from the backbone.** A run marked EXPLORATORY can reach Deliverable with an empty IR. | EXPLORATORY is the mode in which no mathematical fact is asserted; demanding a backbone there is a category error. The exemption is narrow (mode-checked, not caller-checked). | TASK 3 (mode semantics) |
| RISK-1.25-04 | **`irClaimSchema.artifact_id` is not validated against the artifact store.** A claim binds an `artifact_id` to an `ir_ref`, but the bridge cannot prove that `artifact_id` names a real stored artifact. | Artifact-store lookups are an executor/engine concern; the bridge is a pure reader of the IR by design. | TASK 2 / TASK 3 (provenance gate) |
| RISK-1.25-05 | **Gate ids remain free-form strings for non-critical gates.** INV-1.25-C closes the missing/downgraded/duplicate holes for the closed critical set, but a non-critical gate with a typo'd id still silently evaluates as its own (non-blocking) thing. | Non-critical gates cannot block delivery by definition, so the blast radius is a lost warning, not a lost invariant. | TASK 3 (gate registry v1) |
| RISK-1.25-06 | **`authorizeDelivery` trusts its caller about *which* gates passed.** The executor passes `gates: ['review', IR_CANONICALIZATION_GATE_ID]` after checking them, but the engine does not independently re-verify the decision. | Re-verification would duplicate the policy evaluation in a second place; the durable record is auditable and the executor path is the only caller. | TASK 3 (gates v1) |

Carried over unchanged from `TASK-1/known-risks.md`: RISK-01..RISK-15 (all
still deferred to their owner TASKs; RISK-14 is now **partially resolved** —
the workflow can no longer ignore the IR for delivery in FORMAL/FAST, while
claim-population waits for TASK 2).
