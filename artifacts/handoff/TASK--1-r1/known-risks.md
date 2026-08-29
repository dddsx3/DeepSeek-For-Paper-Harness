# Known risks (deferred)

Risks discovered while implementing this TASK, but explicitly out of scope
and deferred per task book §20 and §21.

The presence of an entry here is **not** a failure. The presence of a
**fixed-but-undocumented** risk in this commit **is** a failure.

| ID | Description | Why deferred | Target TASK |
|----|-------------|--------------|-------------|
| RISK-01 | `WorkflowExecutor` still constructs a `WorkflowExecutor` directly inside `PaperExecutorService.[Service.init]`. Any consumer that imports `WorkflowExecutor` and instantiates it without going through `PaperExecutorService` bypasses the `runtimeGuard.assertRuntimeReady(...)` gate. The right way to plug this is to make `WorkflowExecutor` itself take the guard as a hard dependency (i.e. throw in its constructor if the guard is missing), which would close the construction-side bypass completely. | This TASK closes the *execution* path (every `execute()` call is gated). Closing the *construction* path is a separate hardening that requires changing `WorkflowExecutor`'s constructor contract across the whole package. | TASK 0+ (executor constructor hardening) |
| RISK-02 | `composition.apply` requires the caller to mount `PaperRuntimeGuard` BEFORE mounting `Composition`. A direct `ctx.plugin(Composition, settings)` without first mounting the guard throws with a clear "must be mounted first" message, but the contract is "caller does two plugin calls" rather than "Composition owns the guard lifecycle." A future "Composition mounts the guard for you" refactor would be safer. | This TASK is the smallest viable enforcement boundary; making the composition own the guard lifecycle requires resolving a Cordis nested-`ctx.plugin` ordering problem that is out of scope here. | TASK 0+ (composition lifecycle) |
| RISK-03 | `verifierRegistry` is built from a sentinel `Object.freeze({...})` with `true` values for each gate id, because the critical gates are not separate services. This is enough to prove "the gate id is registered" but does not prove that the gate is *implementable* against the live runtime. A future task can wire the actual gate implementations into the verifier registry. | This TASK proves that the gate id matches a declared name; the implementation correctness of each gate is a separate concern that the deterministic verifier TASKs will own. | TASK 3 (deterministic verifier gates) |
