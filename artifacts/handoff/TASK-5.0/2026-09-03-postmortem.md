# Postmortem — 2026-09-03 TASK 5.0 batch: full issue ledger & prevention runbook

> 摘要（中文）：本批次共修复三层 CI 失败根因（smoke 根路径解析错、
> 3.R3 封禁路径遗留、LocalProcessRunner 一次性事件竞态），升级了
> GitHub Actions 运行时（Node20→Node24），并记录了大量 Windows /
> GitHub 托管 runner / 沙箱平台的坑。下文逐条给出根因、证据、修复
> 与"如何避免再次触发"。附录是给后续 agent 的提交前检查清单。
>
> Head commit at write time: `4f753b1ade`. Paper harness gates CI: green.

## A. Code/task fixes landed this batch

| # | Issue | Root cause | Fix (commit) | Recurrence guard |
|---|---|---|---|---|
| A1 | 5.0.5 was mid-flight: `persistFinal`/`FINAL_OUTPUT_PATH`/`decision` undefined; `RunPolicy` passed where `DeliveryPolicy` required (7 tsc errors) | Previous agent paused mid-edit | `enforceDelivery` returns one `{policy,decision}`; promoter gets the same pair; `persistFinal` reachable only via promoter's `writeFinalOutput` (`69f82d7547`) | Never commit a tree that fails `tsc -p packages/paper/paper-foundation` |
| A2 | `test:task3` pointed at non-existent `artifacts/handoff/TASK-3.1/run-3-of-3.ts` | Stale script from an abandoned plan | Aggregator now chains fault-corpus → mutations → replay-smoke → report-state; CI workflow added (`69f82d7547`) | CI would have caught it; wire scripts before claiming them |
| A3 | 5.0.8 seeded in the working tree by the author but unwired (required fields on `DeliveryPolicy`, no rule, no builder) | Mid-edit hand-off | `evaluateDelivery` replay_stale rule with injected clock + registry wiring + EX-25..27 (`7d1b5fbb9b`) | Run tsc + vitest after any hand-off before continuing |
| A4 | 5.0.8 literals: 12 `DeliveryPolicy` test literals lacked the 2 new required fields | Interface grew | All 12 literals explicitly carry `replayedAt: null, deliveryReplayMaxAgeMs: null` | Type-level fields must be added to every literal or the runtime reads `undefined` as a non-null window |

## B. The CI failure chain (Paper harness gates, exit 1 → 13 → 2 → green)

Three stacked root causes on the real-process replay smoke step, each exposed only after the previous one was fixed:

| # | Symptom on ubuntu-24.04 | Root cause | Fix (commit) | Recurrence guard |
|---|---|---|---|---|
| B1 | `ERR_MODULE_NOT_FOUND …/artifacts/packages/...` | `fileURLToPath(import.meta.url)` returns the **file** path; three `..` from the file lands in `<repo>/artifacts` instead of `<repo>`. CI runs the script with no repo-root arg, so the broken default path was used. | Base on `dirname(...)` + three `..`; also accept MSYS `/d/…` args (`c5ea344200`) | A script's default repo-root must resolve from its directory, not its file; test with no argv |
| B2 | `Error: record ingest failed` (after path fix, local) | Script still wrote `ExecutionRecord` via the direct `ir.put('ExecutionRecord', X)` path **closed by 3.R3 / INV-3-M** — silently broken since `adc50eaebd`, nobody re-ran it until CI wiring | Ingest via `ir.putExecutionRecord(record, CAPTURE_ATTESTATION)` (`c5ea344200`) | Grep for `put('ExecutionRecord'` before assuming capture-path evidence runs |
| B3 | tsx exit 13 "unsettled top-level await"; then plain-node watchdog exit 2: stdout stream ended but stderr never ended; child never exited (60s spawn timeout didn't fire) | **Missed-one-shot-event race in `LocalProcessRunner.run()`**: it awaited stdout first and attached the stderr reader + `exit` listener only afterwards. A fast child closes its pipes and exits before those late listeners attach; `end`/`exit` fire exactly once → the late await hangs forever. `collectRuntimeFacts()` had the same shape. | Attach both stream readers AND `exit`/`error` listeners immediately at spawn; read streams concurrently (`4f753b1ade`). Reproduced locally with a 30s watchdog (stdout ended, stderr never), 8/8 clean after. | Never attach a one-shot event listener after an await that the same process may have already passed; when awaiting two stream ends, start both reads before awaiting either |
| B4 | tsx on Node 24 reported "unsettled top-level await" spuriously on hosts where the loop drains | tsx TLA bookkeeping + long pending top-level await | Smoke flow moved into `main()` with a ref'd watchdog and explicit exit codes (0/1/2) (`c7e8de1c41`); launcher switched from tsx to `node --experimental-transform-types` because the runner uses constructor parameter properties that strip-only mode rejects (`6826935d4a`) | Keep long-lived flows out of top-level await; prefer the project's declared launcher (`tsx` or explicit transform flag) for TS with non-erasable syntax |

CI hygiene fixes in the same batch: `pnpm/action-setup@v4 → v6` and `actions/upload-artifact@v4 → v7` (both declare `runs.using: node24`; GitHub deprecated the Node 20 action runtime on 2025-09-19 and force-runs node20 actions on node24 with a warning).

**Outcome**: Paper harness gates is a hard, green gate (fault corpus + mutations + real-process replay smoke + RG-06/07 self-check) in ~80s.

## C. Repository/harness state corrections discovered along the way

| # | Discovery | Action |
|---|---|---|
| C1 | `run-real-execution-smoke.mjs` and the fault/mutation runners resolved the repo root inconsistently; the smoke's own header said "Usage (via tsx)" while `package.json` ran plain `node` | Unified: plain-`node` for runners that only spawn vitest; `node --experimental-transform-types` for the smoke that imports project TS |
| C2 | gate-report `baseline` had drifted from the real suite (declared 856/14, measured up to 26 mid-batch) | RG-06/RG-07 verifier now re-measures and enforces; baseline re-synced to 871/11 |
| C3 | A suite flake (`service-guards.spec.ts` invariant double-registration, 11 vs 12 failures) came from the repo-wide `scripts/test-invariants.ts` auto-mount racing a manual mount | Added the file to `MANUAL_INVARIANT_TEST_EXCEPTIONS`; verifier accepts the declaration when any of up to two genuine measurements matches |
| C4 | Verifier originally forced `--maxWorkers=1`, which manufactures the C3 flake every run | Verifier now measures the repo-default worker configuration |
| C5 | `verify-report-state.mjs` couldn't be run on this Windows host (nested vitest never exits; a fixed report filename let a lingering child feed stale numbers) | Waits for a per-attempt unique JSON report file, then stops the child |
| C6 | Remote `main` was reset to `ebfd11c18d` during mid-batch housekeeping (local tracking refs went stale) | Author chose fast-forward re-push; authoritative check is `git ls-remote origin main` |

## D. Platform traps (each cost real time — read before touching this repo on Windows)

1. **Windows vitest child never exits** after writing its JSON report (worker pool keeps the process alive; observed past 120s, in and out of a sandbox). A full suite run can kill the whole bash session at exit. → Drive vitest through a report-file watcher (as the verifier does), never `spawnSync`.
2. **Foreground sandboxed `rm` is routed through a safe-delete trash helper** that fails on this host and aborts `&&` chains. → Avoid `rm` in sandboxed commands; escalate (host) for cleanup or delete via node `fs.unlinkSync`.
3. **MSYS paths**: git-bash `$(pwd)` yields `/d/…`; `path.resolve('/d/…')` on Windows gives `D:\d\…` → ENOENT. → Normalize `/X/…` to `X:\…` in any tool that takes a repo root (verifier + smoke now both do).
4. **`fileURLToPath` returns the file, not its dir** (B1).
5. **Node strip-only TS cannot load parameter properties / other non-erasable syntax** → use tsx or `node --experimental-transform-types`.
6. **GitHub-hosted runners execute fast children**: races that are rare on a 150ms local child become deterministic (B3: 31ms stdout end). Add short-watchdog local reproduction before assuming "CI infra problem".
7. **E2E (real DeepSeek API) workflow fails loudly on any `main` push when the repo secret `DEEPSEEK_API_KEY_EXTERNAL` is unset** — by design (anti-false-green). It is NOT a code failure. Fix = configure the secret (option A, pending key) or disable the workflow.

## E. Pre-push checklist for the next agent (this fork)

1. `npx tsc -p packages/paper/paper-foundation/tsconfig.json --noEmit` — clean.
2. `node_modules/.bin/tsx artifacts/handoff/TASK-2.1/verify-report-state.mjs <repo>` → **PASS** (this runs the full suite; repo-default workers).
3. Run the smoke **locally** once (real child): `node --experimental-transform-types artifacts/handoff/TASK-3/run-real-execution-smoke.mjs` → exit 0 `CHAIN CLOSED`. (If it ever stalls again: it is the missed-event pattern in D6 — do not reclassify it as "host problem" without the phase trace.)
4. If you touched `artifacts/handoff/**`, `package.json`, or paper sources, expect the **Paper harness gates** workflow to run after push; watch it (`gh run watch`) to green.
5. Do not claim a task done while any of the 11 known suite failures or 3 v1.1-deferred stubs are open (INV-3-Q; the ledger is in `artifacts/handoff/TASK-INDEX.md` + `TASK-2.1/gate-report.json`).
6. Never attach a one-shot event listener after an intervening await (B3 pattern); never long-run top-level awaits (B4).

## F. Real-API E2E unlock (option A) — findings while the ¥1 quota lasted

The repo's real-API E2E workflow ran for the first time once the
`DEEPSEEK_API_KEY_EXTERNAL` secret existed. Everything before the quota
ran out was genuine fork drift that is now fixed:

- **Host-build type-check of test files had never run** (fork pushes
  straight to main; e2e Preflight previously blocked before Build). The
  first unlocked Build exposed ~78 type errors across ~20 paper test
  files (unused specifiers, `Record<string, unknown>` vs strict ingest
  params, verdict-union `.failures` reads, literal comparisons, a
  mistyped GateRecord[] function...). Fixed to 0 errors, all
  behavior-preserving; see the commit "make the paper test corpus
  typecheck under the host build (78 -> 0)". **Prevention:** after any
  paper test/source edit run `npx tsc -b tsconfig.host.json` locally,
  not just the package tsconfig.
- **Fork branding drift in upstream CLI e2e**: `apps/cli/tests/built-bin.e2e.ts`
  asserted `Usage: dsh ...`; the fork's web profile app prints
  `Usage: dph --profile web` (args.ts `.name('dph')`) while the headless
  profile app still prints `dsh`. Assertions now follow reality (web =
  dph, headless = dsh).
- **paper workflow.e2e.ts** mounted a default FORMAL guard but ran
  `fast` workflows; TASK -1 `assertRuntimeReady` rejects that. It now
  mounts `createFastProfile()`.
- **Quota reality**: the ¥1 key was consumed mid-suite (account balance
  went to -0.03 CNY / is_available=false), so the tail of the E2E run
  (subagent spawn ENOENT, workflow-worker TypeError, headless-agent
  usage=0, ...) reflects exhausted quota, not code. A full real-API
  pass is ~62 files / 208 tests; budget several ¥ for one complete run
  before triaging any remaining with-key failures.

## F2. Real-API E2E — now fully green (quota refilled)

With the key topped up to ¥9.96, one rerun of the previously failed E2E
dropped from 39 tail failures to a single failure, then to zero:

- The one real remaining failure was `packages/paper/paper-foundation/tests/workflow.e2e.ts`
  (fast acceptance case): `ir_canonicalization:BLOCKED: missing IR
  backbone … minimum Problem Contract not satisfied`. The executor
  delivers only when a canonical IR with a closed Problem Contract is
  mounted (`ctx.get('paperModelingIr')`, TASK 1.25), and the text-then-
  gate workflow expects the caller to pre-load the backbone — every
  executor unit suite does `ctx.provide('paperModelingIr', backboneIr())`,
  but this acceptance harness predates the gate and had never run on the
  fork (the E2E preflight blocked before Build until the secret existed,
  and the pre-secret runs never reached the tests). Fix: mount
  `backboneIr()` in the harness before `PaperExecutorService`.
- Final state on `4318db5457`: **E2E (real DeepSeek API) = success**,
  62 files / 208 tests green (the earlier quota-empty tail of ~39
  "failures" — usage 0, ENOENT, TypeError — was all exhausted-quota
  noise, confirmed by the clean rerun). `pnpm/action-setup` bumped to v6
  in e2e.yml too; the run carries **no Node-20 annotations**.
- Paper harness gates remain green on the same code base (674053db74).

**Prevention:** when touching paper executor / workflow composition, the
executor unit suites (executor.spec, executor-guards, rt-c4/*) already
mount `backboneIr()`; any new e2e or integration harness around the
workflow must do the same or every FAST/STRICT run is BLOCKED at the
ir_canonicalization gate before a manifest can exist.
