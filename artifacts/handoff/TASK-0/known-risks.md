# Known risks (deferred)

Risks discovered while implementing this TASK, but explicitly out of scope and
deferred per task book §20 and §21.

The presence of an entry here is **not** a failure. The presence of a
**fixed-but-undocumented** risk in this commit **is** a failure.

| ID | Description | Why deferred | Target TASK |
|----|-------------|--------------|-------------|
| RISK-01 | TASK 0 only freezes the *shape* of the delivery pipeline. The actual gate implementations (IR schema validation, numeric consistency, reference resolution, etc.) are still placeholders — `evaluateDelivery` consumes a list of `GateRecord`s that gate producers (TASK 3) will populate. Until those producers exist, an empty gate set trivially allows delivery under FORMAL mode. The TASK -1 `paper.deliveryPolicy` interface is also unbacked. | §6 of v2 task book explicitly says "Skills 前只允许：PASS / FAIL / BLOCKED" and "不要实现 verifier gate 实体（属于 TASK 3）——只用类型 placeholder". Per §20, drive-by fixes to the verifier pipeline are forbidden. | TASK 1 (IR schema), TASK 3 (gate implementations) |
| RISK-02 | The promoter's `writeFinalOutput` is an injected dep, not a real filesystem write. A misconfigured host could inject a sink that pretends to write but does not. | §6 only requires the *invocation contract*; the actual durable write is the host's responsibility. No host exists yet. | Future host integration TASK |
| RISK-03 | The v1 commit `9fcbe3a4` had a `src/delivery-policy.ts` / `src/policy.ts` / `src/spec.ts` / `src/executor.ts` set of files. Those paths are unchanged in this commit and are explicitly forbidden from being read or reused. Any code that still references them is dead, but no search-and-prune was performed in this TASK. | §8 forbids reading or refactoring v1 code; searching for orphan references would violate that. | Future cleanup TASK (after all v2 tasks land) |
