# TASK 3 — Known Risks (and what is out of scope)

## 1. Delivery gate is structural; byte truth is replay's — by design (D8)

The delivery-time gate verifies structural consistency (record ↔ run ↔
manifest) but cannot see bytes. A forger who copies every declared
fingerprint and invents the byte digests passes the gate (RT-X1-01) and
is refused by the independent replay audit (RT-X1-02). Closing this at
delivery time would mean re-executing on every delivery — deliberately
out of scope. The staleness window between the last replay and delivery
is closed out-of-band by the `manifest_hash` anchor.

## 2. Runtime fingerprints pin capture-vs-replay, not declared-vs-reality

`runtime_fingerprint_hash` proves the replay ran in the same measured
environment as the capture. Proving the DECLARED environment string
matches reality requires a dependency-manifest convention (a lockfile
artifact hashed like code bytes) — deferred to a future task; the runner
config (`environmentFactsCommands`) is the evolution point.

## 3. Dependency-lock derivation is declaration-level

`dependency_lock_hash` (TASK 2.1 derivation) covers
`input_data_refs + parameter_refs + assumptions`. A real dependency
lockfile (package versions frozen at capture time) is not yet hashed;
TASK 4+ owns that.

## 4. The runner seam is trust-neutral, not security-sandboxed

`LocalProcessRunner` bounds the child (timeout, isolated cwd, no stdin)
but executes whatever bytes `code_ref` names. Running untrusted
model-authored code safely (OS sandbox, network denial, FS policy) is a
deployment concern beyond this layer — the composition configures the
runner, and the capture/replay contracts are runner-agnostic.

## 5. Staleness window (inherited, now smaller)

The store is append-only, so frozen evidence never changes; what can
drift is reality between the last replay and the next delivery. The
execution freeze manifest + out-of-band `manifest_hash` (this package's
`execution-hash-report.json`) is the auditor's tool to close that window;
automated re-replay scheduling is a future task.

## 6. `output_refs` are external locators by design (D6)

The store closes `input_data_refs` (DataArtifact) but not `output_refs`:
their reality is carried by the byte-level `output_hash` and replay
re-derivation. Adding an `OUTPUT_DATA` DataArtifact role would change a
closed 2-value enum across every consumer for marginal gain — recorded
as rejected in the task book (§2 item 6).

## 7. Red-team coverage note

The TASK 3 red team (RT-X1..X4, `tests/rt-x/attacks.spec.ts`) was
executed in-session rather than via external sub-agents (the TASK 2
external round hit repeated model-transport failures; the in-session
suite keeps every attack as a permanent regression instead of a
one-off report). 15 adversarial tests, 0 escapes; the honest structural
boundary of the delivery gate is itself pinned as RT-X1-01/02.
