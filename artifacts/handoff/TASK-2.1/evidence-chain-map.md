# Evidence Chain Map — TASK 2.1 Freeze Snapshot

> Frozen at `2026-09-01T00:00:00.000Z` from the canonical example chain
> (`tests/ir/fixtures.ts validChain()`). Every hash below is sha256 over
> the canonical JSON defined in `freeze-hash-report.json → algorithm`.

## Chain at a glance

```
Claim C1 (NUMERIC/CRITICAL)
  ├─ text (presentational, never a number source)
  ├─ numeric_binding ─→ result_ref RES1, asserted_value 0.731, asserted_unit 'm'
  ├─ evidence_refs ───→ [RES1]
  └─ result_refs ─────→ [RES1]
        │
Result RES1  value=0.731 unit='m'
  ├─ producer ────→ RUN1
  └─ run_ref ─────→ RUN1
        │
Run RUN1
  ├─ model_ref ─────────────→ M1 (→ ProblemSpec P1)
  ├─ code_hash ─────────────→ sha256:aaaaaaaaaaaaaaaaa…
  ├─ environment_hash ──────→ 46577bca76f9250cd66687f6…
  └─ dependency_lock_hash ──→ 0ddd244f41c9f3921f4a0f62…
```

## Frozen fingerprints

| Object | id | fingerprint | value |
|--------|----|-------------|-------|
| Manifest | — | `manifest_hash` | `0b3bfbe99b4b9a661498138e77ce0efda122662264749a6ed3a1a97c771ab24b` |
| Freeze content | — | `freeze_hash` | `e52f731cce9d95c6cd3c3af793b514fec33bd685340f4703ad5456d8ab1ac528` |
| Claim | C1 | `evidence_chain_hash` | `fd82388fe3cccb39f478db75bc9932ebe5c0c6263821605963869e057fbecb75` |
| Result | RES1 | value/unit | `0.731 m` |
| Run | RUN1 | code_hash | `sha256:aaaaaaaaaaaaaaaaaaaaaaaaa…` |

## Independent verification

Any auditor can re-derive every fingerprint:

```ts
import { ModelingIr, buildEvidenceFreeze, auditEvidenceFreeze } from '<pkg>/src/ir/index.ts'

const store = ModelingIr.snapshot(ir)          // read-only view
const report = auditEvidenceFreeze(store, manifest)
// report.status === 'PASS'  ⇔  every frozen chain hash re-derived unchanged
```

Verify the manifest itself against the out-of-band registry
(`freeze-hash-report.json`): `report.manifest_hash` MUST equal the
registered `manifest_hash`. A self-consistent but fabricated manifest
re-frozen from tampered evidence carries a different `manifest_hash` —
that difference is the RT-E4 trust boundary (producer ≠ auditor).
