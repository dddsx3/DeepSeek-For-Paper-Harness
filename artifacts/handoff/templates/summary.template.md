# TASK X — <name>

## 1. Escape Path closed by this TASK

Describe the escape path the TASK closes, in the format required by the task
book §21 "每个 TASK 交给 Coding AI 的统一模板". Reference the specific
attack / scenario that this change makes impossible.

## 2. New invariants established

List the new INV-xxx or task-local invariants added. Each invariant must be
enforced at code level, not at prompt level. Cite the function or assertion
that enforces it.

## 3. Core modules touched

For each file in `changed-files.txt`, list the type of change (add / modify /
delete) and the smallest description of the change that lets a reviewer find
it without re-reading the diff.

## 4. Behaviour now BLOCKED

Enumerate the runtime conditions that now produce `BLOCKED` / `FAIL` (no
delivery, audit event emitted). One bullet per behaviour.

## 5. Behaviour still allowed

Enumerate the runtime conditions that remain permitted. Be explicit so the
red-team can target the remaining freedom.

## 6. Local gate outcome

Quote the contents of `gate-report.json` in a fenced block.

## 7. Open known risks

Cross-link `known-risks.md`. Do not address any of them in this commit.
