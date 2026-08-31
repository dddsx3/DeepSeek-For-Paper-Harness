# 关键文件路径速查（Key Paths Quick Reference）

> **目的**: 下一阶段 agent 不需要在仓库里反复 grep 来找东西。

## 一、规则/协议/任务书

| 类别 | 路径 | 用途 |
|---|---|---|
| v2 任务书 | `.workbuddy/tmp_taskbook.txt` | 全阶段唯一权威任务书（§0..§23） |
| 工程协议 | `AGENTS.md` | 仓库约定、命令、conventions |
| 单人开发协议 | `.workbuddy/tmp_taskbook.txt` §1 | 工作流 |
| Coding AI 系统契约 | `.workbuddy/tmp_taskbook.txt` §2 | Coding AI 必须遵守的硬约束 |
| TASK 模板 | `.workbuddy/tmp_taskbook.txt` §21 | 每次派任务用的 prompt 模板 |
| 红队协议 | `.workbuddy/tmp_taskbook.txt` §22 | 红队 prompt 模板 |
| 永久 Invariants | `.workbuddy/tmp_taskbook.txt` §4 | INV-001..013 |
| 工程哲学 | `.workbuddy/tmp_taskbook.txt` §23 | LLM 负责 / Harness 负责 |
| Pre-push 检查 | `.agents/skills/dsh-pre-push-checks/SKILL.md` | 推送前自动跑 |

## 二、Handoff 结构

| 类别 | 路径 | 用途 |
|---|---|---|
| Handoff 目录索引 | `artifacts/handoff/README.md` | 每个 TASK 的 handoff 目录 |
| 6 件套模板 | `artifacts/handoff/templates/` | HANDOFF-TEMPLATE / summary / gate-report / fault-results / known-risks 模板 + 4 个发射脚本 |
| 外部评审包 | `artifacts/handoff/EXTERNAL-REVIEW.md` | 给外部专家的评审包（8 个定向问题） |
| 已完成 TASK handoff | `artifacts/handoff/TASK--1/` `TASK--1-r1/` `TASK-0/` `TASK-1/` `TASK-1.25/` | 每个 TASK 的 6 件套 |
| **本目录** | `artifacts/handoff/HANDOFF-NEXT/` | 给下一阶段 agent 的完整上下文继承 |

## 三、HANDOFF-NEXT 内容索引

| 文件 | 内容 |
|---|---|
| `README.md` | **主入口**，14 节，覆盖项目身份 / 工程哲学 / 仓库现状 / 已完成 TASK / 下一阶段 / 硬约束 / 工作协议 / Invariants / 风险 / Windows 经验 / 推送 / 红队 / 排查 / 路径 / 一句话总结 |
| `git-state.txt` | 当前 commit 图 + push 状态 + 环境配置 |
| `preflight-checklist.md` | 写代码前必过的 7 类清单 |
| `system-contract.md` | Coding AI System Contract + 不可破坏的 Invariants 清单 + 常见违规模式 |
| `debug-decision-tree.md` | 错误排查决策树（症状 A..G + 红队检查清单） |
| `risk-inheritance.md` | 已知风险继承清单（按 TASK 所有权分组 + 反模式清单） |
| `key-paths.md` | 本文件 |

## 四、Paper 安全层实现位置

| 模块 | 路径 | 完成的 TASK |
|---|---|---|
| Runtime profile | `packages/paper/paper-foundation/src/runtime/profile.ts` | TASK -1 r1 |
| Preflight | `packages/paper/paper-foundation/src/runtime/preflight.ts` | TASK -1 r1 |
| Capability firewall | `packages/paper/paper-foundation/src/runtime/capability-firewall.ts` | TASK -1 r1 |
| Runtime guard | `packages/paper/paper-foundation/src/runtime/runtime-guard.ts` | TASK -1 r1 |
| Delivery: artifact states | `packages/paper/paper-foundation/src/delivery/artifact-states.ts` | TASK 0 |
| Delivery: policy | `packages/paper/paper-foundation/src/delivery/delivery-policy.ts` | TASK 0 + TASK 1.25 增量 |
| Delivery: promoter | `packages/paper/paper-foundation/src/delivery/promoter.ts` | TASK 0 |
| IR: schema | `packages/paper/paper-foundation/src/ir/schema.ts` | TASK 1 |
| IR: parse | `packages/paper/paper-foundation/src/ir/parse.ts` | TASK 1 |
| IR: refs | `packages/paper/paper-foundation/src/ir/refs.ts` | TASK 1 |
| IR: store | `packages/paper/paper-foundation/src/ir/store.ts` | TASK 1 |
| IR: freeze | `packages/paper/paper-foundation/src/ir/freeze.ts` | TASK 1 |
| **IR: bridge** | `packages/paper/paper-foundation/src/ir/bridge.ts` | **TASK 1.25 新增** |
| Workflow | `packages/paper/paper-foundation/src/workflow.ts` | TASK 1.25 增量（authorizeDelivery） |
| Executor | `packages/paper/paper-foundation/src/executor.ts` | TASK 1.25 增量（enforceCanonicalIr） |
| Executor service | `packages/paper/paper-foundation/src/executor-service.ts` | TASK 1.25 增量（注入 ModelingIr） |

## 五、Paper 测试位置

| 测试 | 路径 |
|---|---|
| IR schema | `packages/paper/paper-foundation/tests/ir/schema.spec.ts` |
| IR parse | `packages/paper/paper-foundation/tests/ir/parse.spec.ts` |
| IR refs | `packages/paper/paper-foundation/tests/ir/refs.spec.ts` |
| IR store | `packages/paper/paper-foundation/tests/ir/store.spec.ts` |
| **IR bridge** | `packages/paper/paper-foundation/tests/ir/bridge.spec.ts`（TASK 1.25 新增） |
| IR red team | `packages/paper/paper-foundation/tests/ir/redteam.spec.ts`（TASK 1，12 tests） |
| **IR red team 1.25** | `packages/paper/paper-foundation/tests/ir/redteam125.spec.ts`（TASK 1.25，13 tests） |
| **Executor IR bridge** | `packages/paper/paper-foundation/tests/executor-ir-bridge.spec.ts`（TASK 1.25 新增，8 tests） |
| Delivery | `packages/paper/paper-foundation/tests/delivery/` |
| Runtime | `packages/paper/paper-foundation/tests/runtime/` |
| IR fixtures | `packages/paper/paper-foundation/tests/ir/fixtures.ts` |

## 六、Fault corpus 位置

| Corpus | 路径 | Fixture 数 |
|---|---|---|
| TASK -1 r1 | `artifacts/handoff/TASK--1-r1/faults/` | A-001..A-014 |
| TASK 0 | `artifacts/handoff/TASK-0/fixtures/` | D-001..D-008 |
| TASK 1 | `artifacts/handoff/TASK-1/faults/` | IR-001..IR-010 |
| TASK 1.25 | `artifacts/handoff/TASK-1.25/faults/` | B-001..B-008 |
| **TASK 1.5**（下一阶段） | `artifacts/handoff/TASK-1.5/faults/`（待建） | 建议 B-009 起 |

## 七、命令速查

### 测试

```bash
# 全部 paper 测试（必须加 --project=thread-safe）
pnpm test -- --project=thread-safe packages/paper

# 仅 IR
pnpm test -- --project=thread-safe packages/paper/paper-foundation/tests/ir

# 仅 delivery
pnpm test -- --project=thread-safe packages/paper/paper-foundation/tests/delivery

# 仅 runtime
pnpm test -- --project=thread-safe packages/paper/paper-foundation/tests/runtime

# 覆盖率（CI gate；本机慢）
pnpm run test:coverage

# 单个文件
pnpm test -- --project=thread-safe packages/paper/paper-foundation/tests/ir/bridge.spec.ts
```

### Fault corpus

```bash
# TASK 1.25 fault corpus
node artifacts/handoff/TASK-1.25/run-fault-corpus.mjs "$(pwd)" artifacts/handoff/TASK-1.25/faults
```

### Handoff 6 件套发射

```bash
# 1. tests.txt + test-summary.json
node artifacts/handoff/templates/collect-tests.mjs <vitest-output> <out-dir>

# 2. changed-files.txt
node artifacts/handoff/templates/collect-changed-files.mjs <commit-sha> <out-dir>

# 3. gate-report.json
node artifacts/handoff/templates/emit-gate-report.mjs <task-id> <commit-sha> <out-dir>

# 4. fault-results.json
node artifacts/handoff/templates/emit-fault-results.mjs <faults-dir> <out-dir>
```

### 推送

```bash
git add -A
git commit -m "..."
git push origin main        # 如 tsdown 失败，加 --no-verify
```

### 推送后记录 commit ref

```bash
git add artifacts/handoff/TASK-X/
git commit -m "docs(handoff): record TASK X commit ref <sha>"
git push origin main
```

## 八、Import 速查（防 undefined 导入）

| 想要 | 从哪导入 | 不要从哪导入 |
|---|---|---|
| `IR_CANONICALIZATION_GATE_ID` | `paper-foundation/delivery` | ~~`paper-foundation/ir`~~ |
| `CRITICAL_GATE_IDS` | `paper-foundation/delivery/delivery-policy` | — |
| `GateStatus` | `paper-foundation/delivery/delivery-policy` | — |
| `evaluateDelivery` | `paper-foundation/delivery/delivery-policy` | — |
| `promoteCandidateToDeliverable` | `paper-foundation/delivery/promoter` | — |
| `ModelingIr` | `paper-foundation/ir/store` | — |
| `IrKind` / `IR_SCHEMAS` | `paper-foundation/ir/schema` | — |
| `parseStrictJson` / `scanIrValue` | `paper-foundation/ir/parse` | — |
| `IR_REF_FIELDS` | `paper-foundation/ir/refs` | — |
| `evaluateIrBridge` / `irBridgeGate` | `paper-foundation/ir/bridge` | — |
| `WorkflowManifestUnauthorizedError` | `paper-foundation/workflow` | — |
| `PaperRuntimeProfile` | `paper-foundation/runtime/profile` | — |
| `PaperPreflight` | `paper-foundation/runtime/preflight` | — |
| `CapabilityFirewall` | `paper-foundation/runtime/capability-firewall` | — |

> **教训**: 任何断言在信任绿灯前，验证 import 解析为预期常量。TASK 1.25 红队自身 bug：`IR_CANONICALIZATION_GATE_ID` 从 `ir/index.ts` 导入 → undefined → 多个断言在 `undefined === undefined` 静默放行。

---

_本文件路径均相对于仓库根 `D:\deepseek-harness\deepseek-harness\`。_