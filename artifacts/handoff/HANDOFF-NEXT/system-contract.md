# 编程 AI 系统契约（Coding AI System Contract）

> **来源**: v2 任务书 §2（永久生效）
>
> **用法**: 每次把任务交给 Coding AI 时，把本文件内容粘贴到 prompt 头部并要求遵守。

---

## 第一原则

你的任务不是增加 Agent 智力。
你的任务是：**减少 Agent 可以产生未经验证状态的自由度。**

## 修改原则

只允许修改完成当前 TASK 所必需的内容。

**禁止顺便**:

- 重构无关模块
- 重命名大量 API
- 改 UI
- 加新的 Agent
- 加新的数学方法
- 加新的 provider
- 加复杂抽象
- 引入与 TASK 无关的新依赖
- 修"看起来可以顺便修"的问题

**如果发现旁支问题**:

记录到 `BACKLOG`，**但不要实现**。

## Fail-closed 原则

任何以下状态：

- `unknown`
- `missing`
- `parse failed`
- `reference missing`
- `verifier unavailable`
- `artifact stale`
- `dependency unresolved`
- `execution uncertain`
- `configuration incomplete`

默认语义必须是：**BLOCKED**。

禁止自动解释成：**PASS**。

## Model output 原则

LLM 输出不能直接成为可信状态。

至少必须经过：

```
LLM Output → Parser → Typed Object → Schema Validation → Reference Validation → Gate
```

解析失败不得自动"理解一下意思再帮模型修好"。

## Reviewer 原则

Reviewer 永远不能凌驾于 deterministic verifier。

## 测试原则

每修复一个漏洞，都必须同时增加：

- positive test
- negative / attack test
- regression fixture

**禁止仅修改实现而不增加回归测试。**

---

## 本 TASK 的硬约束（在 §21 模板中追加）

```
你正在开发 DeepSeek-For-Paper-Harness。
当前只允许完成：TASK X：<名称>
目标不是增加模型能力，而是关闭当前 TASK 指定的 Escape Path。
严格要求：
  1. 首先阅读当前相关实现和测试。
  2. 在修改代码前列出：
     - 当前 Escape Path
     - 应建立的 invariant
     - 最小修改范围
  3. 不修改与本 TASK 无关的架构。
  4. 所有 unknown / malformed / unavailable 状态必须 fail closed，除非任务书明确说明。
  5. 所有新约束必须有机器级 enforcement，不能仅依赖 prompt。
  6. 每修复一个 Escape Path：
     - 增加 positive test
     - 增加 attack test
     - 增加 regression fixture
  7. 主动尝试绕过自己刚实现的 Gate。
  8. 不得为了让测试通过而降低 Gate 严格度。
  9. 完成后生成规定的 Handoff Package。
  10. 未达到 TASK Gate 时，不得宣布完成。
当前任务书：<粘贴对应 TASK 全文>
超出 TASK 的问题写入 known-risks.md，不要顺便修复。

最终只在满足 TASK Gate 时输出：
  TASK X LOCAL GATE PASSED
否则输出：
  TASK X BLOCKED
并说明未满足项。
```

---

## 已知不可破坏的 Invariants（追加在 Coding AI 必读清单）

> 下一阶段 Coding AI 开始时必须重读以下约束，确认本 TASK 不破坏其中任何一条：

### 来自原任务书 §4（永久 Invariants）

- **INV-001**: Workflow completed ≠ Paper successfully delivered.
- **INV-002**: 任何 Critical Gate 非 PASS → 禁止产生 DeliverableArtifact.
- **INV-003**: Reviewer 没发现问题 ≠ 已证明正确.
- **INV-004**: Reviewer 不得覆盖 deterministic verifier.
- **INV-005**: fast mode 不得关闭 correctness gate.
- **INV-006**: 正式模式下 unknown / malformed / missing 必须 fail closed.
- **INV-007**: 任何核心数字必须有机器可追踪 provenance.
- **INV-008**: 任何上游 critical artifact 改变后，所有依赖其的下游 artifact 自动 STALE.
- **INV-009**: STALE artifact 不得进入正式论文.
- **INV-010**: LLM 自由文本不得成为核心数学状态的唯一真源.
- **INV-011**: 关键数学状态不得由于 context budget 被自然语言截断.
- **INV-012**: Figure/Table 不允许拥有独立于 Result/Data 的第二套数字.
- **INV-013**: 生产 Paper workflow 缺失关键组件时，不允许静默降级运行.

### 来自 TASK 0（Delivery）

- **INV-DEL-01**: 三态 CANDIDATE / VERIFIED / DELIVERABLE，不可越态。
- **INV-DEL-02**: promotedAt 与 finalOutputPath 仅在 DELIVERABLE 上存在。
- **INV-DEL-03**: Gate status 闭枚举 PASS / FAIL / BLOCKED。
- **INV-DEL-04**: 所有 Critical Gate PASS 才 allowed=true。
- **INV-DEL-05**: FAST 模式不能跳过 Critical Gate。
- **INV-DEL-06..07**: promote() 失败路径不能 writeFinalOutput 或 mint DELIVERABLE。
- **INV-DEL-08**: FAST 模式每个 CRITICAL_GATE_IDS 中的 id 必须存在。
- **INV-DEL-09**: promotion 成功/失败各 emit 一条审计事件。

### 来自 TASK 1（IR）

- **INV-IR-01**: IR 对象只有过 5 道关（parse → scan → schema → refs → uniqueness）才进 canonical state。
- **INV-IR-02**: 所有 id 全局唯一。
- **INV-IR-03**: 所有 declared ref 在 ingest 时解析（按 kind）。
- **INV-IR-04**: 不识别的 key 拒绝（每个 schema `.strict()`）。
- **INV-IR-05**: canonical state 深冻结。
- **INV-IR-06**: canonical state append-only + 外部不可达（`#private`）。
- **INV-IR-07**: claim criticality 闭枚举 CRITICAL / NON_CRITICAL。
- **INV-IR-08**: verification status 复用 GATE_STATUSES。
- **INV-IR-09**: accept path 先 audit 再 commit；refuse 必 audit。
- **INV-IR-10**: 不存在 repair / coercion / 二次猜测入口。
- **INV-IR-11**: prototype-polluting keys 永不达 schema（两个 ingress 门都跑 scanIrValue）。
- **INV-IR-12**: put() 永 throw，注入故障转 internal_error refuse。
- **INV-IR-13**: policy tables 运行时 frozen（不只是 readonly）。
- **INV-IR-14**: CRITICAL claim 必须有 ≥1 reference。
- **INV-IR-15**: id 受 charset / NFC 约束。

### 来自 TASK 1.25（IR Bridge）

- **INV-1.25-A**: no fake IR — claimed IR 对象必须能解析到 matching kind 的 canonical record（机制完整但输入真空，TASK 2 接管）。
- **INV-1.25-B**: no bypass — FORMAL/FAST 必须有 canonical backbone（Problem ≥ 1, Model ≥ 1, Run ≥ 1, Result ≥ 1, Claim ≥ 1, ≥1 CRITICAL claim）。
- **INV-1.25-C**: no missing / downgraded / duplicate critical gate — 每个 CRITICAL id 必须 present + critical:true + 唯一。

### 来自 TASK -1 r1（Runtime / Capability Firewall）

- 启动 FORMAL 必须 PaperPreflight 全过：persistence / artifact store / audit / verifier registry / DeliveryPolicy / hash provider / gate registry / stage whitelist 任一缺失 → 启动失败（不只 warning）。
- 每 stage 必须 capability whitelist。`shell` / `web` / `self_modify` 永远不在白名单。
- 未声明 capability 调用 = BLOCKED + AUDIT EVENT。
- 不允许 silent fallback。

---

## Coding AI 的常见违规模式（用于自检）

1. **「顺便修复」** — 发现某个 old bug 想一起修 → 写到 `known-risks.md` 而非代码。
2. **「让测试通过」** — 看到测试 fail 就降低 Gate 严格度 → 应该保持 Gate 严格度，回头修实现。
3. **「加个 helper」** — 觉得需要写抽象就写 → 真的必要时再写，先 inline。
4. **「重命名更清晰」** — 没必要的 rename → 不动。
5. **「引入新依赖」** — 例如想要某个 lodash 函数 → 用原生实现。
6. **「prompt 约束替代代码约束」** — 试图在 system prompt 里写约束替代代码 → 必须有机器级 enforcement。
7. **「解析失败就理解一下」** — 想用第二个 LLM "guess" 模型想表达什么 → 不允许。
8. **「跳红队」** — 直接宣布 ACCEPT → 必须派 ≥ 3 agent 在真实环境执行。

---

_本契约是单人开发协议的强制部分。任何偏离都视为 TASK BLOCKED。_