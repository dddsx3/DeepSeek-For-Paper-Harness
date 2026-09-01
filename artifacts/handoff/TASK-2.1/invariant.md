# TASK 2.1 — Invariants

## INV-2.1-A — Frozen Claim Evidence has a stable hash

`evidence_chain_hash = sha256(canonicalJson({ claim, evidence_refs,
results, run_reference }))` covers, per claim:

- the claim itself: `claim_id`, `claim_type`, `criticality`,
  `evidence_refs`, `result_refs`, `numeric_binding` (verbatim),
- every referenced Result: `result_id`, `value`, `unit`, `run_ref`,
- every referenced Run: `run_id`, `code_hash`,
  `environment_hash`, `dependency_lock_hash`.

Any change to any member — in the live store **or** in the manifest —
flips the hash and the audit FAILs.

**Closed by**: `chainDigest` in `src/ir/evidence-freeze.ts`.
**Proven by**: `tests/ir/evidence-freeze.spec.ts > INV-2.1-A` (7 cases:
binding value, result value, result unit, run code hash, run
environment, evidence refs, and the stable baseline).
**Mutation**: E-01 (hash comparison disabled) and E-05 (binding
excluded from the digest) — both killed.

## INV-2.1-B — The auditor is read-only and independent

`auditEvidenceFreeze(store, manifest)` never mutates the store, never
repairs a claim, never invents evidence. The producer agent cannot
audit its own evidence into acceptance: a claim added after the freeze
is `CHAIN_BROKEN` (CRITICAL), and a self-consistent fabricated manifest
is refused by the out-of-band `manifest_hash` comparison.

**Closed by**: pure-function design + manifest integrity check +
coverage walk over both sides.
**Proven by**: `tests/rt-e/evidence-attacks.spec.ts` E4-a (read-only
byte-identity), E4-b (self-approval FAIL), E4-c (fabricated manifest
hash divergence), E4-d (forged freeze_hash refused).
**Mutations**: E-06 (integrity check disabled), E-08 (unfrozen-claim
detection disabled) — both killed.

## INV-2.1-C — Fail-closed with a closed failure taxonomy

Every audit outcome is one of the five closed categories
(`MISSING_RESULT` / `RESULT_MISMATCH` / `RUN_UNVERIFIED` / `HASH_CHANGED`
/ `CHAIN_BROKEN`) at one of three closed severities. `status = FAIL`
iff any failure has `severity ≠ 'MEDIUM'` — i.e. any CRITICAL-claim
failure fails the audit; non-critical drift is recorded as MEDIUM and
never masks or flips the verdict.

**Closed by**: `EVIDENCE_AUDIT_CATEGORIES` / `EVIDENCE_AUDIT_SEVERITIES`
+ the verdict expression in `report()`.
**Proven by**: `tests/ir/evidence-freeze.spec.ts > closed failure
taxonomy` + one case per category + the MEDIUM non-critical case.
**Mutations**: E-02 (RESULT_MISMATCH disabled), E-03 (RUN_UNVERIFIED
disabled), E-04 (verdict hardcoded PASS), E-07 (severity downgrade) —
all killed.

## Inheritance

TASK 2.1 does not weaken any TASK 2 invariant (INV-2-A..H) or any TASK
1.5R closure: the freeze/audit layer is a pure reader over the same
canonical snapshot, and the full paper-foundation regression (63 files
/ 775 tests) keeps every prior suite green.
