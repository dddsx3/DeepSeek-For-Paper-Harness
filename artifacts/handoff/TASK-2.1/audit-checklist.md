# Evidence Chain Audit Checklist — TASK 2.1

> The operating manual for an **Evidence Chain Freeze Auditor**. An
> auditor is an independent verification agent: it reads, it never
> writes. This document is simultaneously the Phase 4 Single Agent Task
> Card and the step-by-step audit procedure.

---

## Part I — Agent Task Card (Phase 4)

### Single Agent Task Card

| Field | Value |
|-------|-------|
| **Name** | Evidence Chain Freeze Auditor |
| **Role** | Independent Verification Agent |
| **Goal** | Verify that every paper/experiment claim owns a complete, tamper-evident Evidence Chain (Claim → Result → Run). |

### Inputs

| Input | Source | Notes |
|-------|--------|-------|
| IR Snapshot | `ModelingIr.snapshot(ir)` | Read-only view of canonical state. Refuse any object that fails `ModelingIr.isCanonicalIr`. |
| Evidence Freeze Manifest | `evidence-freeze-manifest.json` | The frozen claim/result/run layers. |
| Run Metadata | `FrozenRun` entries | code / environment / dependency fingerprints. |
| Hash Registry | `freeze-hash-report.json` | **Out-of-band** anchor: the true `manifest_hash`. |

### Output

`EvidenceAuditReport` (see `src/ir/evidence-freeze.ts`):

```ts
interface EvidenceAuditReport {
  audit_id: string                 // 'AUD-' + sha256(manifest_hash | store digest), deterministic
  status: 'PASS' | 'FAIL'
  claims_checked: number           // CRITICAL claims examined
  failures: {
    claim_id: string
    category: 'MISSING_RESULT' | 'RESULT_MISMATCH' | 'RUN_UNVERIFIED'
            | 'HASH_CHANGED' | 'CHAIN_BROKEN'
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
    reason: string
  }[]
  manifest_hash: string            // compare against the out-of-band registry
}
```

### Success criteria

**PASS requires ALL of:**

- [ ] 100% of CRITICAL claims audited (`claims_checked` covers every critical claim on both sides of the comparison)
- [ ] result binding valid (value + unit identical on both sides)
- [ ] run reference exists and its fingerprints match
- [ ] `evidence_chain_hash` unchanged for every claim (INV-2.1-A)
- [ ] no chain break (claim → result → run → model → problem closure intact)
- [ ] `report.manifest_hash` equals the out-of-band registry value

**FAIL on ANY of:**

- [ ] any CRITICAL-claim failure (`severity` CRITICAL or HIGH) → `audit.status = FAIL`
- [ ] manifest hash mismatch against the registry → refuse before per-claim verdicts

---

## Part II — Audit procedure

### Step 0 — Identity checks (before touching evidence)

1. Verify the store: `ModelingIr.isCanonicalIr(ir)` must be true. A forged duck-typed store is treated as empty → every claim fails → FAIL.
2. Verify the manifest: recompute `manifest_hash` over the manifest content. Mismatch → single `<manifest>` `HASH_CHANGED` `CRITICAL` failure → FAIL (RT-E4-d).
3. Verify the anchor: `manifest.manifest_hash` must equal the value in the out-of-band `freeze-hash-report.json`. A self-consistent manifest fabricated from tampered evidence carries a *different* hash — this is the only defence against a lying producer (RT-E4-c).

### Step 1 — Coverage (RT-E4-b)

4. Enumerate CRITICAL claims on **both** sides: live store and manifest. The audit walker does this automatically; an unfrozen critical claim (added after freeze) is `CHAIN_BROKEN` / `CRITICAL`.

### Step 2 — Per-claim chain verification

For each claim:

5. **Result layer**: every `result_refs` entry and the binding's `result_ref` must resolve on both sides with identical `value` and `unit`. Drift → `RESULT_MISMATCH` (CRITICAL). Missing → `MISSING_RESULT` (CRITICAL). (RT-E1)
6. **Run layer**: the result's `run_ref` must resolve; `code_hash` and `environment_hash` must match the frozen fingerprints. Drift → `RUN_UNVERIFIED` (HIGH). (RT-E2)
7. **Whole-chain hash**: re-derive `evidence_chain_hash` from the live snapshot and compare with the frozen value. Any difference → `HASH_CHANGED` (HIGH). (INV-2.1-A)

### Step 3 — Verdict

8. `status = FAIL` iff any failure has `severity ≠ 'MEDIUM'`. Non-critical claim drift is recorded as `MEDIUM` and never masks a critical failure nor flips the verdict.

---

## Part III — Hard rules for the auditor agent

- **Read-only.** The auditor never calls `put`, never repairs a claim, never auto-fills evidence. `auditEvidenceFreeze` is a pure function; a test (`E4-a`) proves the store is byte-identical after an audit.
- **Producer ≠ auditor.** The agent that generated the evidence can never be the one that anchors its hash. The hash registry travels out-of-band.
- **No repair, no tolerance.** Value equality is exact (`a === b`, `-0/+0` collapsed by JSON). A drifted number is a failure, never a rounding artefact.
- **Fail-closed.** Every unexpected condition (non-canonical store, tampered manifest, missing object) lands in the closed failure taxonomy — never in an exception, never in a PASS.

## Part IV — Attack coverage map

| Attack | Route | Detected by |
|--------|-------|-------------|
| RT-E1 Evidence Substitution | swap result value / unit / identity behind a frozen claim | `RESULT_MISMATCH` + `HASH_CHANGED` |
| RT-E2 Historical Replay | old run fingerprints under a new claim | `RUN_UNVERIFIED` |
| RT-E3 Partial Evidence | chain missing a member | store refuses at ingest; stripped manifest → `<manifest>` tamper |
| RT-E4 Agent Trust | self-mutation, self-approval, fabricated manifest | read-only proof, `CHAIN_BROKEN`, `manifest_hash` anchor |

Regression home: `tests/rt-e/evidence-attacks.spec.ts` (13 attacks, all detected).
Mutation home: `artifacts/handoff/TASK-2.1/run-mutations.mjs` (E-01..E-08, all killed).
