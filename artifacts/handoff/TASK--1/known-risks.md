# Known risks (deferred)

Risks discovered while implementing this TASK, but explicitly out of scope and
deferred per task book §20 and §21.

The presence of an entry here is **not** a failure. The presence of a
**fixed-but-undocumented** risk in this commit **is** a failure.

| ID | Description | Why deferred | Target TASK |
|----|-------------|--------------|-------------|
| RISK-01 | The capability firewall is a passive gate: the `CapabilityRequest` objects are produced by callers, so a caller that forgets to call `firewall.check()` will execute its capability without any check. Code-level enforcement of "every capability invocation must route through the firewall" (e.g. by removing direct access to underlying capabilities and exposing only a `withCapabilityCheck(stage, cap, fn)` wrapper) belongs to a later TASK. | This TASK is the smallest viable lockdown; layering the wrapper around the executor is a separate wiring change. | TASK 0+ (paper executor wiring) |
| RISK-02 | `runPreflight` accepts `availableServices` as a plain `Map` keyed by `interfaceName`. A future production config that registers services under a different name (e.g. `paper.persistence.v2`) would silently bypass preflight unless the interface name in the profile is updated. Profile-vs-runtime name binding is intentionally a string match for now, but it would be safer to validate that the registered instance actually implements the `ServiceRequirement` shape. | This TASK's contract is "interface-name presence", not "shape conformance"; adding shape conformance is a TASK-3 concern (verifier-registry-side validation). | TASK 3 (verifier gate integration) |
| RISK-03 | `CapabilityFirewall` does not currently emit an audit event for a request whose `stage` is missing from `profile.stagePolicies` — it emits one with `allowed: false, reason: 'not_in_whitelist'`, which is correct, but the produced event does not distinguish "stage not in profile" from "stage in profile, capability not in stage whitelist". Both cases are blocked (correct), but the audit trail cannot be post-hoc filtered to surface the configuration error. | The TASK's gate is "block"; surfacing the configuration error is a separate audit-quality improvement. | TASK 0+ (audit refinement) |
