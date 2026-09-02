# External Advisory Handoff — DeepSeek-For-Paper-Harness

**Purpose.** This package is for external reviewers — mathematical-modelling
experts, software/security architects, and LLM engineers — who have been asked
to audit the project, stress-test its reasoning, or advise on its next phase.
It describes *what exists, what is claimed, how to verify the claims, and the
specific questions we most need help with*.

**Status snapshot.** Pre-release, single-developer, red-team-verified core.
Eleven tasks of the v2 task book are complete: TASK 1.25, 1.5, 1.5R, 2,
2.1, 3, 3.5, 3.6, plus the merged TASK 4.0 gate-registry stub and the
TASK 3.5 STALE engine; a TASK 2.1 audit batch (3.R1 criticality, 3.R2
gate registry, 3.R3 producer-only, 3.R4 CI, 3.R5 handoff, 3.R6 replay-
delivery staleness) is in. The current gate posture is one real
provenance producer (`provenance`), one structural stub
(`runtime_integrity`, `reference_validation`), and five UNIMPLEMENTED
critical gates (delivery blocked with `producer_unimplemented` for each).
The TASK 4 admission file (`TASK-4-准入评审与前置任务书.md`) requires
TASK 4.4 numeric tolerance to ship under a v1.1 task-book amendment
before TASK 4 can start; the other follow-ups (4.2 reviewer schema
unification, 4.3 FigureSpec data_hash, 4.5 documentation) are
self-contained. The current `paper-foundation` suite reports 70 files
/ 856 tests with 21 historical failures (16 pre-existing + 5 stale-
engine alignment); see `artifacts/handoff/TASK-2.1/known-risks.md`
item 12 for the documented follow-up.

---

## 1. What this project is

`DeepSeek-For-Paper-Harness` is a fork of the DeepSeek harness that wraps a
**mathematical-modelling paper workflow** in a safety layer. The guiding
philosophy (task book §23):

> LLM 负责：提出模型、提出解释、提出怀疑、提出 narrative。
> Harness 负责：事实、状态、来源、执行、依赖、一致性、准入、交付。
>
> (The LLM proposes — models, explanations, suspicions, narrative.
>  The Harness owns — facts, state, provenance, execution, dependencies,
>  consistency, admission, delivery.)

The single acceptance criterion for this phase (task book §0) is:

> **Can the model still bypass the harness and produce a paper that *looks*
> complete while the underlying mathematics is wrong?** If yes, we keep
> fixing the harness.

The project deliberately does **not** pursue (yet): general proof assistants,
model auto-selection, large skill libraries, multi-agent debate, AI aesthetics
judges, or benchmark platforms. All of those are listed in the task book as
explicitly deferred (§19).

**Repository.** https://github.com/ddds3x/DeepSeek-For-Paper-Harness
(origin fork; `upstream` = https://github.com/deepseek-ai/deepseek-harness).
Current work is on branch `main`, commit `6e2ee8feca` (after the already-pushed
`2a7b1425de`).

## 2. The v2 task book, in one line each

| Task | What it builds | Status |
|---|---|---|
| TASK -1 | Production capability lockdown: `PaperRuntimeProfile`, fail-closed `PaperPreflight`, per-stage `CapabilityFirewall` | ✅ + red-team round 1 (`-1 r1`) |
| TASK 0 | Freeze delivery semantics: Candidate → Verified → Deliverable, deterministic `DeliveryPolicy`, single promoter | ✅ |
| TASK 1 | Minimal Modeling IR: closed zod schemas for 8 object kinds, strict JSON ingress, reference validation, append-only canonical store | ✅ (this handoff) |
| TASK 1.5 | Requirement Registry / DataArtifact / Symbol Registry (kill "free-text data" and "variable meaning drift") | ⏳ next |
| TASK 2 | Claim → Result → Run evidence chain + mutation tests on paper text | not started |
| TASK 3 | Deterministic gates v1 (schema/execution/provenance/numeric/coverage/reproducibility/unit) | not started |
| TASK 3.5 | Dependency + STALE propagation engine | not started |
| TASK 4 | Fault corpus v1 (20 attack classes) | not started |
| TASK 5 | Reviewer demoted to Attack Generator (no verdict authority) | not started |
| TASK 6 | Context firewall: structured state never summarised | not started |
| TASK 7 | FigureSpec + fixed renderer (model loses chart-design freedom) | not started |
| TASK 7.5 | TableSpec + EquationSpec + critical-narrative lock (`{{result:R17}}`) | not started |
| TASK 8 | AssuranceBench v0 (pass corpus + escape corpus) | not started |

Per task book §1.1, core tasks are strictly serial — no parallel development
until the pre-skill gate.

## 3. What exists now (the "safety core")

All under `packages/paper/`:

- **`paper-foundation/src/runtime/`** — `profile.ts` (declarative runtime
  profile: services, stages, gate registry, delivery policy), `preflight.ts`
  (FORMAL mode refuses to start if persistence / artifact store / audit /
  verifier registry / delivery policy / hash provider / gate registry /
  stage whitelist are missing), `capability-firewall.ts` (per-stage capability
  whitelist, `shell`/`web`/`self_modify` forbidden everywhere),
  `runtime-guard.ts` (execution gate on every capability call).
- **`paper-foundation/src/delivery/`** — `artifact-states.ts` (closed
  Candidate/Verified/Deliverable zod machine), `delivery-policy.ts`
  (deterministic `evaluateDelivery`: all critical gates PASS + no stale +
  no unresolved refs + outputs covered + profile valid; FAST mode cannot skip
  critical gates), `promoter.ts` (the only function allowed to mint a
  `DeliverableArtifact`; refuses on any failure path).
- **`paper-foundation/src/ir/`** — the Minimal Modeling IR (TASK 1):
  `schema.ts` (8 closed zod schemas), `parse.ts` (strict JSON ingress +
  structural scan), `refs.ts` (closed reference table), `store.ts`
  (append-only canonical store, `#private` internals, deep-frozen records),
  `freeze.ts` (cycle-safe deep-freeze of policy tables).

### The IR in one diagram

```
model text ─▶ parseStrictJson ─▶ scanIrValue ─▶ IR_SCHEMAS[kind].parse
           ─▶ validateRefFields ─▶ global id uniqueness ─▶ ModelingIr.put
           ─▶ canonical state (deep-frozen, append-only)
```

Objects: `ProblemSpec`, `ModelSpec`, `RunArtifact`, `Result`, `Claim`,
`VerificationResult`, `FigureSpec`, `ReviewerFinding`. Every ID is globally
unique; every reference must resolve at ingest time to an object of the
declared kind (a `Result.run_ref` may only name a `RunArtifact`, etc.).
`ReviewerFinding` is a first-class kind so that malformed reviewer output is a
refusal rather than an absorbed blob.

## 4. Claims and how to verify them

| Claim | How to verify |
|---|---|
| Paper suite is green: **420/420** | `pnpm test -- --project=thread-safe packages/paper` (note: `--project=thread-safe` is required; omitting it hangs on an empty project) |
| New IR files at 100% per-file coverage | `vitest run --project=thread-safe --coverage packages/paper/paper-foundation/tests/ir` (see `vitest.config.ts` per-file thresholds) |
| Fault corpus IR-001..IR-010: 10/10 blocked, escape_rate 0 | `node artifacts/handoff/TASK-1/run-fault-corpus.mjs <repo-root> artifacts/handoff/TASK-1/faults` — the runner **asserts** every verdict is BLOCKED and every fixture ran (RT4-05 fix) |
| Every red-team exploit has a regression test | `packages/paper/paper-foundation/tests/ir/redteam.spec.ts` — one test per executed exploit |
| Removing any single guard fails the suite | Mutation testing was run by a red-team agent: 17 guards removed one at a time, **17/17 killed** |
| Prior tasks' corpora | `artifacts/handoff/TASK--1-r1/faults/` (A-001..A-014, 14/14) and `artifacts/handoff/TASK-0/fixtures/` (D-001..D-008, 8/8) |

Handoff packages live in `artifacts/handoff/` — each TASK ships
`summary.md` (escape paths closed, invariants, blocked/allowed behaviour),
`gate-report.json` (machine PASS/FAIL), `fault-results.json`,
`known-risks.md`, `tests.txt`, `changed-files.txt`.

## 5. The red-team process (this is not a normal dev loop)

The working protocol (§1) mandates, for every completed TASK, that at least
**3 sub-agents attack the implementation in the real environment** before it
can be accepted. For TASK 1, four independent agents were dispatched with
distinct mandates: (1) JSON/type-confusion ingress, (2) reference-graph and
id attacks, (3) immutability/prototype attacks, (4) mutation testing and
test-suite blind spots. They were required to *execute* exploits, not
theorise; a summary of the 13 fixed findings is in
`artifacts/handoff/TASK-1/summary.md` §2. The fixed escape paths include:

- TypeScript `private` leaking the backing `Map` at runtime (arbitrary
  injection/deletion of canonical state) → ECMAScript `#private`.
- Frozen-but-rewritable record envelopes (spoofing `record.kind` to fool the
  next reference-kind check) → whole record frozen.
- Mutable module-level policy tables (`IR_REF_FIELDS.Result = []` disabled
  reference validation process-wide) → deep-freeze + frozen-ness tests.
- Prototype hijack of the store class → class + prototype frozen.
- `Object.prototype` pollution defeating zod's `.strict()` (both directions:
  global ingest DoS and `{}` passing a fully-required schema via inherited
  keys) → `scanIrValue` rejects inherited/symbol/accessor keys.
- `put()` and `ingestJson()` disagreeing on identical bytes (`__proto__`
  accepted on the typed path) → same scan on both doors.
- 8 MB payload killing the process (depth cap ran after `JSON.parse`) →
  1 MiB pre-parse size cap.
- `put()` throwing instead of refusing (throwing audit sink / clock) →
  total `put()`, audit-before-commit.
- A `CRITICAL` claim with zero references passing → schema refine.

## 6. Known risks — where we most need your eyes

Deferred by design per task book §20 (only deferrals are allowed, no drive-by
fixes). Full list in `artifacts/handoff/TASK-1/known-risks.md` (RISK-01..15).
The ones with real consequences:

- **RISK-14 — the IR is not yet wired into anything.** No producer consumes
  `ModelingIr`; "no illegal object can enter canonical state" is true but
  vacuous until TASK 2 connects the workflow. Highest-priority integration
  question.
- **RISK-11 — `executor.ts` `parseDefects` still absorbs malformed reviewer
  output** into a "major defect" instead of refusing. This is the exact
  anti-pattern the IR forbids, in pre-existing code that TASK 5 must fix.
- **RISK-01 — external locators are not filesystem-checked.** A `RunArtifact`
  may name output files that do not exist; the IR has no filesystem by
  design (TASK 3's execution gate owns it).
- **RISK-03 — `subproblem_id`/`output_id` are unique within their parent
  only**, and not addressable as reference targets (TASK 1.5 promotes them
  into a Requirement Registry).
- **RISK-09 — reviewer verdict fields are *rejected*, not *ignored*.** TASK 5
  specifies "ignore `paper_passed` if present"; we currently refuse the whole
  finding, which is stricter but a different behaviour.

## 7. Questions for external advisors (pick your lane)

### A. Mathematical-modelling correctness (domain expert)
1. Is the object vocabulary (ProblemSpec/ModelSpec/Run/Result/Claim/
   Verification/Figure) the *right* minimal ontology for a math-modelling
   paper, or is a crucial fact currently inexpressible as structured state?
2. What are the top 3 most common ways a "complete-looking" modelling paper
   is mathematically wrong, that a deterministic gate could actually catch?
   (We know the classic ones — unit flips, sign flips, sensitivity on the
   wrong parameter — but your list will shape TASK 3's gates.)
3. For TASK 2's numeric-claim extraction: is comparing `claim.value ==
   result.value` on extracted numbers a sound first step, or is there a
   cheaper invariant that catches more?

### B. Software/security architecture
4. Is "append-only store + ingest-time reference resolution" the right
   foundation, or should the IR anticipate mutation/staleness now instead of
   in TASK 3.5? (We chose append-only to make dangling references
   impossible by construction.)
5. Fail-closed is our default for *every* unknown state. Where is that
   likely to create false-block rates that will make a real workflow
   unusable, and which gates should get explicit "warn" semantics first?
6. Any blind spots in the red-team methodology itself? (Four agents, real
   execution, mutation suite — what would a fifth agent find that four
   didn't?)

### C. LLM engineering
7. The IR forbids "parse the model's JSON, and if it fails, call another LLM
   to guess what it meant." We allow re-requesting the model to regenerate.
   Is there a *standard* pattern (structured outputs, tool schemas, two-pass
   self-repair with explicit gates) that would make the regeneration path
   cheap and reliable without violating the no-repair rule?
8. For TASK 5, is "reviewer emits findings; deterministic oracle routes each
   finding" a workable replacement for reviewer verdicts? What attacks on
   that routing should we expect?

## 8. How to run things

```sh
# node ^22.19 || >=24; pnpm 11 (via corepack: `corepack enable` or install into your node dir)
pnpm install
pnpm test -- --project=thread-safe packages/paper            # 420 tests, IR + runtime + delivery
pnpm test -- --project=thread-safe packages/paper/paper-foundation/tests/ir   # 118 IR tests
node artifacts/handoff/TASK-1/run-fault-corpus.mjs "$(pwd)" artifacts/handoff/TASK-1/faults
pnpm run typecheck    # full repo tsc -b + tsdown (slow; pre-push hook runs it)
```

Windows notes: use the PowerShell terminal for long-running commands; vitest
without `--project=thread-safe` hangs; the sandbox may block bulk deletes
(safe-delete guard), which is unrelated to the repo.

## 9. What we're asking you to send back

- **Priority 1:** answers to the questions in §7 that match your lane.
- **Priority 2:** any *executed* bypass of the current safety core (preferred:
  a minimal test or script against `packages/paper`). We will fold it into
  the fault corpus and fix it, per the protocol.
- **Priority 3:** a one-page opinion on TASK 1.5/2 sequencing if you believe
  the task book's serial order hides a cheaper high-value fix.

Contact/return path: reply to whoever sent you this document, or open an
issue on the repository. All findings will be tracked in
`artifacts/handoff/` and credited in the handoff.
