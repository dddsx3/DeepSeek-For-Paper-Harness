# 下一阶段开始前的 Pre-flight Checklist

> **目的**: 下一个 agent 在开始写代码之前，按这个清单逐项过一遍；任何一项不过就先停下处理，不要带病写代码。

## 1. 上下文确认

- [ ] 已读 `HANDOFF-NEXT/README.md` 全文
- [ ] 已读 v2 任务书对应章节（TASK 1.5 = §8）
- [ ] 已读 `AGENTS.md` 至少 §Pre-release stance + §Repository layout + §Commands
- [ ] 已读 `TASK-1.25/summary.md`（理解前序 TASK 的不变量与机制）
- [ ] 已读 `TASK-1/summary.md`（理解 IR 的 INV-IR-01..15）
- [ ] 已读 `TASK-0/summary.md`（理解 Delivery 的 INV-DEL-01..09）
- [ ] 已读 `TASK--1-r1/summary.md`（理解 Runtime 与 Capability Firewall）

## 2. 工具与命令可用性

- [ ] `git status` 干净（没有未提交修改）
- [ ] `git log --oneline -n 5` 与本 handoff 的 git-state.txt 一致
- [ ] `node --version` ≥ 22.19（或 24+）
- [ ] `pnpm --version` 是 11.x
- [ ] `pnpm install` 无错误
- [ ] `pnpm test -- --project=thread-safe packages/paper` 462/462 通过（基线）
- [ ] `node artifacts/handoff/TASK-1.25/run-fault-corpus.mjs "$(pwd)" artifacts/handoff/TASK-1.25/faults` 8/8 BLOCKED
- [ ] `pnpm run lint` 0 errors
- [ ] `pnpm run typecheck` 0 errors（或确认已知 tsdown/rolldown Windows 写失败问题与代码无关）

## 3. 设计期必须先做的（§21 模板要求）

- [ ] **列出当前 Escape Path**（TASK 1.5 要关的逃逸口是什么？）
- [ ] **列出应建立的 invariant**（每条写明 enforced at）
- [ ] **列出最小修改范围**（哪些文件 / 函数 / 接口会被改；哪些不会动）
- [ ] **列出需扩展的测试与 fixture**
- [ ] **列出 BACKLOG 候选**（发现但不顺手修的问题）

## 4. 红队与 mutation 计划

- [ ] 列出本 TASK 要派的红队 agent 数（≥ 3）及各自 mandate
- [ ] 列出本 TASK 要写的 fault fixture 编号（建议续 TASK 1.25 的 B-，从 B-009 开始；或开新 series 如 Req-001）
- [ ] 列出 mutation 检查的 guard 清单（每个 guard 删除 → 套件必须变红）

## 5. Git 准备

- [ ] 已 `git checkout main`
- [ ] 已 `git pull origin main`（或确认不需要 pull）
- [ ] 已确认没有未保存的工作
- [ ] 已确认当前 HEAD 与 git-state.txt 一致

## 6. 不要在开始前做的事

- ❌ 不要直接开始写代码 —— 先把上面的"设计期必须先做的"完成。
- ❌ 不要重命名既有 API（除非是 pre-release stance §明文允许的 foundation 重构）。
- ❌ 不要重构 IR / Delivery / Runtime 已 frozen 的模块。
- ❌ 不要顺手修 known-risks 中的任何一项（除非该风险的所有权 TASK 编号就是当前 TASK）。
- ❌ 不要在 commit 中夹带与本 TASK 无关的修改。
- ❌ 不要为了测试通过而降低 Gate 严格度。

## 7. 如果上面的清单某项不通过

- **基线测试 462/462 失败**: 立即停下，先用 `git status` / `git diff` 检查是否有未提交改动；如有 revert 或 stash；如无，可能环境问题（pnpm install / node 版本）。
- **基线 fault corpus 失败**: 立即停下，怀疑环境（fixture 文件被改 / IR 实现被改）。回滚到 HEAD 后重跑。
- **typecheck 失败且不是已知 tsdown 问题**: 立即停下，找具体错；可能是依赖 stale，跑 `pnpm install`。
- **git state 与 git-state.txt 不一致**: 立即停下，先 `git fetch origin` + `git log origin/main` 对比，决定要不要 reset。

---

_本清单是 §21 模板的"代码前检查"具体化。任何一项 ☐ 都是潜在 blocker。_