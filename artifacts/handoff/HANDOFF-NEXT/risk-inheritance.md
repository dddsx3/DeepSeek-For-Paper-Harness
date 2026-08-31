# 已知风险继承清单（Risk Inheritance Ledger）

> **目的**: 让下一阶段 agent 立刻知道哪些已知风险归谁所有、不要 drive-by 修复。本文件把分散在 TASK--1-r1、TASK-0、TASK-1、TASK-1.25 `known-risks.md` 的风险整合为单一视图。

---

## 状态: 全部已知风险一览（按 TASK 所有权分组）

### 已 RESOLVED（仅记录，不再阻塞）

| 风险 id | 标题 | 解决 TASK | 解决方式 |
|---|---|---|---|
| RISK-14 (B 部分) | IR 工作流可绕过 | **TASK 1.25** | ir_canonicalization 加入 CRITICAL_GATE_IDS；FORMAL/FAST 必须 backbone |
| TASK -1 r1: A-001..A-014 | 14 个 capability firewall 漏洞 | **TASK -1 r1** | preflight / firewall / runtime-guard / integration / runtime-guard spec |
| TASK 0: D-001..D-008 | 8 个 delivery 漏洞 | **TASK 0** | evaluateDelivery + promoter |
| TASK 1: RT1-01..RT4-05 | 13 个 IR 红队发现 | **TASK 1** | #private, deepFreeze, scanIrValue, total put, etc. |
| TASK 1.25: RT125C-01/03, RT125B-02/03 | 4 个产品漏洞 + 2 harness 缺陷 | **TASK 1.25** | critical:true 检查 / duplicate_gate_id / bridge 前置 / authorizeDelivery |

### 仍 DEFERRED（按所有权 TASK 排序）

#### TASK 1.5 所有权（本阶段主要工作）

| 风险 id | 标题 | 备注 |
|---|---|---|
| **RISK-03** | subproblem_id / output_id 父内唯一，不可作为引用目标 | TASK 1.5 Requirement Registry 接管 |
| **RISK-04 (部分)** | IR 引用字段不包含 external locator | DataArtifact 接管 source_ref 部分 |

#### TASK 2 所有权

| 风险 id | 标题 | 备注 |
|---|---|---|
| **RISK-1.25-01** | INV-1.25-A 输入真空（claims=[]） | TASK 2 接入 ModelingIr 时填入真实 claims |
| **RISK-1.25-02** | run 不生产 IR objects | TASK 2 引入 Claim→Result→Run 链 |
| **RISK-1.25-04** | irClaimSchema.artifact_id 不验证 artifact store | TASK 2 接入时一并验证 |
| **RISK-14 (A 部分)** | IR 尚未被任何生产者接线 | TASK 2 接入 |

#### TASK 3 所有权（Deterministic Gate v1）

| 风险 id | 标题 | 备注 |
|---|---|---|
| **RISK-01** | external locator 不做 fs check | Execution Gate (Gate B) 接管 |
| **RISK-1.25-03** | EXPLORATORY 豁免 backbone | TASK 3 mode semantics 接管 |
| **RISK-1.25-05** | 非 critical gate id 仍自由 | TASK 3 gate registry v1 |
| **RISK-1.25-06** | authorizeDelivery 不独立 re-verify | TASK 3 接管 |

#### TASK 5 所有权（Reviewer 降级为 Attack Generator）

| 风险 id | 标题 | 备注 |
|---|---|---|
| **RISK-09** | reviewer verdict 字段被 reject 而非 ignore | TASK 5 改造（"ignore paper_passed if present"） |
| **RISK-11** | executor.parseDefects 仍吞 malformed reviewer | TASK 5 |
| **RISK-D-08** | reviewer malformed schema | TASK 5 |

---

## TASK 1.5 阶段可能发现的新风险（建议关注）

> 下面这些**不是已知风险**，是 TASK 1.5 在实现过程中可能新发现的风险的预测。新发现的风险按 §21 模板写入 `artifacts/handoff/TASK-1.5/known-risks.md`，**不要 drive-by 修复**。

1. **Requirement / DataArtifact / Symbol 的 schema 边界与既有 IR schema 重叠**: 例如 Requirement 与 Claim 的 criticality 字段是否复用同一枚举？DataArtifact 与 RunArtifact 的 source_ref 语义是否一致？Symbol 的 scope 是否需要独立 Schema？
2. **Requirement 的 criticality 决定错误的影响面**: 若 Requirement 没标 CRITICAL 但用户期待 critical，会不会有 silent miss？
3. **DataArtifact.source_ref 真实存在检查**: 放在 TASK 1.5 还是 TASK 3？前者让 DataArtifact 自洽但要求 fs 依赖；后者保持 IR 与 fs 解耦。
4. **Symbol Registry 的 scope 维度**: 单一字符串 scope 还是 `{kind, ref}` 结构？后者避免新漂移。
5. **覆盖链 Requirement → Model → Result → Claim 是否能在不破坏 INV-IR-01 的前提下闭合？**
6. **RegistryStore 是扩展 ModelingIr 还是平级？** 平级意味着需要新增 ModelingIr 到 RegistryStore 的引用关系；扩展则需要更新 IR_REF_FIELDS 与 IR_SCHEMAS。

---

## 不要做的"反模式"清单（已踩坑）

> 这些是**反例**，写在原任务书 §2 + §19 + §20 但分散。这里汇总。

### 单人开发减负（§20）

每出现一个新想法，只问两个问题：
1. **这是在增加模型能力，还是减少模型自由？**
   - 增加能力 → **BACKLOG**
   - 减少逃逸自由 → 当前 Harness 候选任务
2. **有没有已经发生或明确可构造的 Escape Path？**
   - 没有 → **不开发**

### 不要做（§19 BACKLOG）

- 复杂数学 Oracle（通用形式化证明 / KKT / PDE / 全统计 / 统一 verifier）
- 大规模 Multi-Agent
- Reviewer Reputation
- 完整 Semantic Merkle Context
- AI 图表审美 judge
- 自动最佳模型搜索

### 常见违规模式（应在 preflight 自检）

1. ❌ "顺便修复" — 发现 old bug 想一起修 → 写到 `known-risks.md`
2. ❌ "让测试通过" — 看到测试 fail 就降低 Gate → 应该回头修实现
3. ❌ "加个 helper" — 觉得需要写抽象就写 → 先 inline
4. ❌ "重命名更清晰" — 没必要的 rename → 不动
5. ❌ "引入新依赖" → 用原生实现
6. ❌ "prompt 约束替代代码约束" → 必须有机器级 enforcement
7. ❌ "解析失败就理解一下" → 不允许
8. ❌ "跳红队" → 必须派 ≥ 3 agent 在真实环境执行
9. ❌ "顺手扩展 IR schema" — 既有 IR schema 已被冻结（INV-IR-13），任何改动要重新跑全部 fault corpus
10. ❌ "重命名既有 API" — 除非是 pre-release stance §明文允许的 foundation 重构

---

## 风险记录的格式约定

每个风险在新 TASK 的 `known-risks.md` 中按以下格式记录：

```
| ID | Description | Why deferred | Target TASK |
|----|-------------|--------------|-------------|
| RISK-1.5-XX | <一句话标题> | <为什么不能在本 TASK 修> | <哪个 TASK 应该修> |
```

新增的风险 id 建议按 `RISK-<TASK id>-<序号>` 编号（例如 RISK-1.5-01）。

---

_本文件是各 TASK known-risks.md 的整合视图。每周或每个 TASK 完成后应该重新审视，确保没有遗漏。_