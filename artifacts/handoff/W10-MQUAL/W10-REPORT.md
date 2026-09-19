# W10-MQUAL —— 建模质量专项落地报告（M-QUAL 阶段 A–E 全部落地）

> **编制**：2026-09-19　**基线**：`f7113d13b4`（工作树干净起步）
> **任务来源**：《建模质量专项优化行动方案》（M-QUAL，用户 2026-09-19 下发）
> **一句话**：把 2026-A 参考工作流证明过的"能力判定 + 探针阈值 + 配置一致 +
> 交付形态 + 诚实边界"五道闸从规格落成 DPH 每次运行强制触发的机械门，
> 全部复用既有 critical gate id（9 项不变），fail-soft 哲学未破坏。

---

## §1 落地清单（对照 M-QUAL §4）

| 阶段 | 规格 | 落地物 | 退出判据 | 状态 |
|---|---|---|---|---|
| **A 配置一致性闸** | DP-2/DP-4（Q1-B4） | `ir/numeric-config.ts`（IR kind 16）+ `delivery/config-consistency.ts`（C-1/C-2/D-2·D-6/D-4/D-5）+ `produce/execution-producer.ts` 执行期捕获 | 六处置反例全绿；负对照抓 `dt=0.25/1.0` 错配 | ✅ |
| **B 能力判定闸** | DP-1（Q1-B1） | `ir/capability-spec.ts`（IR kind 17，4 条 refine）+ `delivery/capability-thresholds.ts`（E-1 容差 / E-2·E-3 算子，接 G5） | refine 反例全绿；4 类退化 raise | ✅ |
| **C 交付形态闸** | E-5（Q1-B3） | `delivery/delivery-form.ts`（表头/列类型/行数，接 G8 `requirement_coverage`） | 抓"时间列 '1s'"与表头丢失 | ✅ |
| **D 回归基准** | 阶段 D | `bench/quality/cumcm-2026-A/`（阈值库 11 条 + 表单契约/清单 + 4 份参考判定归档 + golden 测试） | golden 在管线上跑通，机械结论与参考一致 | ✅ |
| **E 边界声明** | DP-8（Q1-B5） | `ir/boundary-declaration.ts`（IR kind 18，"没有第三条路"refine）+ `delivery/boundary-render.ts`（无条件渲染）+ executor 接线 | CLEAN 时边界仍渲染 | ✅ |

**IR_KINDS 15→18**，四张表（`IR_KINDS` / `IrObjectMap` / `IR_SCHEMAS` /
`ID_FIELD_BY_KIND`）+ `IR_REF_FIELDS` 同步登记；护栏测试
（`redteam.spec` 引用表覆盖、`schema.spec` 每 kind fixture、`ir-contract.spec`）
全部通过。

## §2 DP-4 spike 结论（承重决策）

**执行期捕获可行，已落地**。机制：
1. 被测代码把 `numeric_config.json` 写进自己的沙箱（**code emit**，红线 N19），
   文件在 `outputBasenames` 里显式声明；
2. runner 收集真实输出字节 → `ExecutionRecord.output_hash` 覆盖配置字节
   （配置与实跑的**字节级绑定**）；
3. `produceRunExecution` 解析该 JSON（closed schema，**不是散文解析**），
   token→SymbolSpec 解析（fail-closed：未知 token 拒绝整个 chain），
   物化为 canonical `NumericConfig`；
4. `config-consistency` 走查（接在 `execution` 门内，N-1 新增检查形态）。

**一处已声明的设计修正**：所有权边取 `NumericConfig.run_ref → RunArtifact`
（append-only 拓扑下 run 先于 config 入库，规格原文的 `RunArtifact.config_ref`
方向无法解析后向引用）——G7 引用解析的强度等价。规格原文
`CONFIG-CONSISTENCY-CHECK.md` §3.2 未改，以本文件与本注释为准。

## §3 E2E 面向模型的契约变化（真实运行会感知）

- **EXECUTE_PROTOCOL_TEACHING 新增一行**：教模型 SHOULD 声明
  `numeric_config.json` 并从代码写出 closed-schema 的配置 JSON
  （discretization/physical 键必须是已声明 SymbolSpec 的 token）。
  已声明但解析失败 → 拒绝容器（fail-closed，防"自觉"退化）。
- **phase-in 契约激活**：store 中无任何 NumericConfig 时配置闸零发现
  （既有判定不回归）；捕获到第一份配置后，每条 CRITICAL 链的 run 都必须有
  配置证据（D-6）。
- **CLEAN 交付新增边界附录**：store 含 BoundaryDeclaration 时无条件渲染
  （LIMITS-TEMPLATE §2.1 指出的"CLEAN 无附录是错的"已修正）。

## §4 验证证据（全部实跑，2026-09-19）

| 项 | 结果 |
|---|---|
| `npx tsc -b tsconfig.host.json` | 干净（exit 0） |
| scoped vitest（paper-foundation + paper-shell） | **1481/1481**（基线 1405/1406；本轮净增 76 项，xlsx flake 本轮亦过） |
| 负对照（`bench/negative-controls/run-all.mjs`） | **22 passed, 0 failed** |
| 构建守卫（`probe-provenance.mts`，lib 重建后） | **ok = true**（6 包覆盖） |
| staged lint 门（48 规则，pre-commit 同款） | 本轮全部触碰文件 **0 错误**（`npm run lint` 的 89 规则全仓 639 错为既有状态，HEAD 同款内容同样报错，非本轮引入） |
| golden corpus sha256 对账 | 四份参考判定 JSON 前 16 位与 `QUALITY-MECHANISM-SPEC.md` §5 逐位一致（`d405c921…` / `a6fefe04…` / `bcac23bc…` / `6fc53139…`） |

**负对照四类退化全部 raise（golden 实测）**：
N 不足（state_len=60 < 101）、dt 超稳定限（margin=0.886 < 1）、
越界（max_C=2.552 > 2.55，**参考实测值**）、校核偏差超限（1.1945e-3 > 1e-3）。
**F1 major 机械复现**：校核 run dt=0.25 vs 交付 run dt=1.0 → `config_mismatch`
（理由携带两侧数值）；修正后零发现。**C-2 机械复现**：实跑 dt=1 vs 模型声明
0.25 → `config_declared_actual_mismatch`。**E-5 实物回归**：参考交付
result1.xlsx 的实际形态（A1=None + '0.0cm' 后缀 + 时间列 '1s'）逐项被
`form_header_name_mismatch` / `form_header_type_mismatch` 抓住；修正形态零发现。

## §5 诚实边界（自应用 N6）

1. **探针未真跑**。B1–B7 的**执行器**（改参重跑 + expected_invariants 断言）
   不在本轮——它需要活模型与活运行，属 E2E 期工作。本轮落地的是探针的
   **阈值化形态**（P-4 上界 / P-8 配置复现等已表达为 golden 阈值）与
   `probe_refs` 的可查询连接。H-C 的"B1–B7 在 2026-A 上真跑"**未达成**，
   待密钥。
2. **系列算子 fail-closed**。MONOTONE_* / MAX_OVER_AXIS 的数据通道未落地，
   引擎遇到即报 `capability_threshold_unsupported`（绝不静默通过）；
   2026-A 阈值库用代码发射的聚合标量表达同类判据——"发射的标量是否真的
   聚合自全场"是同源边界，由 P-3/P-6 探针在 E2E 期补偿。
3. **配置 emission 自报**。代码写 dt=0.25 而实跑 dt=1.0 的谎报，M5 抓不到
   （C-2 只能对"配置 vs 模型声明参数"）——探针 P-8（同配置独立重跑逐位
   复现）是该缺口的机械补偿，E2E 期接。
4. **未落地清单**：CE-1/CE-2 独立性断言（V5 扩展，REVIEW-INDEPENDENCE 步 2–3）、
   族契约映射 `capability-map.ts`（N-7/P4）、C-3"已声明配置差"的独立声明对象
   （当前以 ExperimentSpec.run_refs 为声明载体）。**边界渲染的对象来源**
   （谁在真实运行中登记 BoundaryDeclaration：族库注入 vs 模型声明）未裁决，
   当前 executor 只渲染 store 里已存在的声明。
5. **87.5% 教训的延续**：本轮 golden 的 11 条阈值是"被要求时写出的"——
   它们对**参考工作流的已知退化**全部可抓（负对照证明），不证明对新题的
   退化覆盖完备。F3/F4 阈值库未建（F1 优先，符合专项范围）。

## §6 与主线的关键路径关系

- 关键路径（W9.5 → W11 → W12 → W14 → W15）不受影响；W10（G7 本体）提前落地，
  HANDOFF §8 的"方案一"除探针真跑外全部完成。
- 下一步 E2E（需密钥）：真实题目跑 produce 链 → 验证模型是否服从
  `numeric_config.json` 契约（形态 7 风险点）→ 观察 config 闸 / 阈值引擎 /
  边界附录在真实交付物上的表现 → 单变量纪律归档。

## §7 E2E 定点探针（2026-09-19，真实模型，`e2e-probe-1/`）

> **背景**：检查 `.env.local` 旧 key（2026-09-08）：14 模型 12 个 HTTP 200
>（含目标 `deepseek/deepseek-v4-flash` 与 `z-ai/glm-5.3-flash`）；2 个失败为
> 模型侧问题（gpt-6-astra 不支持 max_tokens、mimo-v2.5 中转 524），key 有效。
> 历史上全部真实交付都走 E1 直通（E2 规范化从未在真实运行中成功 → 生产链
> 从未被真模型跑到），故先做**单变量定点探针**（W8.10-B4 传统）而非全 CLI 跑。

**探针**：`probe-e2e-config-capture.mts` —— EXECUTE teaching 全文作 system、
小型欧拉 ODE 题作 user，一次容器产出 → `produceContainerInto` → 真实 node
子进程 → DP-4 捕获 → interpretation 铸造 → 九门 + gradeDelivery，带 DRIFT 式
重试（拒绝原因回灌，上限 3 次）。

**最终归档运行结论（`e2e-probe-1/probe-verdict.json`）**：

| 测量点 | 结果 |
|---|---|
| 模型服从 `numeric_config.json` 新契约 | ✅ outputBasenames 声明 + 代码真实写出（形态 7 风险点解除） |
| 容器接收 | ✅ 9 entries（attempt 2；attempt 1 的 criticality 布尔错误被 DRIFT 回灌自修） |
| 真实执行 + 捕获 | ✅ ExecutionRecord=1，outputs=[result.json, numeric_config.json] |
| **DP-4 配置捕获** | ✅ `NC-RUN-PROBE-W10`：discretization=[{S-DT,0.25},{S-N,8}] physical=[{S-K,0.35},{S-Y0,2.55}] —— token→SymbolSpec 解析在真实数据上工作 |
| **C-2 声明↔实际** | ✅ **零发现**——真实模型的 parameter_refs 声明值与实跑发射配置逐字段一致（参考侧 minor `[P-08][4]` 的反面首次被机械确认） |
| 九道 critical gate | ✅ **`decision.allowed=true`**（历史首次：真实模型 × 完整生产链 × 全门 PASS） |
| gradeDelivery | ✅ CLEAN（fatal 探针按探针边界置 false——真实管线的 emptyContent 由渲染报告正文判定） |
| 成本 | ~1.7k in + 1.2k out tok/次调用，2 次调用 ≈ 6k tokens |

**E2E 顺带修掉的 4 处既有缺陷**（每处都是"判定正确、对象未以正确形态到达"
或形态 7，非模型能力问题）：
1. `AssumptionSpec` teaching 未讲 ref 字段形状 → 模型把 SymbolSpec id 塞进
   `sensitivity_refs` 被拒（W8.11-A1c 同族）→ 已补形状（声明时必须 `[]`）。
2. `SymbolSpec.unit` 空串被拒而 teaching 无说明 → 已补 "unit 必须非空，
   dimensionless 用字面量"。
3. `EquationSpec.lhs/rhs_symbols` 用了数学 token 而非 symbol_id → 已补
   "必须是已声明 SymbolSpec 的 symbol_id"。
4. **teaching 与 schema 自相矛盾（形态 7）**：teaching 允许 `chart_type:"table"`
   而 `interpretationSchema` 只认 line|scatter|bar → 已对齐（P3-4 已加 table
   渲染，admission 枚举是遗漏）。

**另发现（已修）**：`interpretations.claims` 在 schema 中存在但 teaching 从未
教过 → 真实生产链将永远铸不出 Claim → 已补教学行（含 NUMERIC/CRITICAL 形状
与"无 claim 则 REQUIRED_OUTPUT 永不支付"的后果说明）。

**诚实边界**：
- `criticality: true`（布尔）的滑步在 3 次运行中出现 2 次——teaching 明说
  字符串仍复现，DRIFT 一次回灌即自修。这是**已知的单次修复模式**，若未来
  全链运行中该滑步率上升，考虑在 teaching 加正反例（W8.11-A1c 防漂移纪律：
  用 schema 真解析讲义正例）。
- 探针只覆盖"单容器单问"路径；全 CLI 运行（E1→fidelity→E2→produce→review
  →骨架→docx）仍未在真实模型上跑通生产链——那是下一轮的事。
- 探针的 9 门 PASS 不含图（figures 可选未触发）与 E-5 形态检查（composition
  未注册契约）——两者的真实数据验证仍挂起。

**E2E 后全量回归**：tsc 0 错误；scoped **1481/1481**；lib 重建；构建守卫
**ok = true**。

## §8 改动文件清单

**新增（10 src + 8 test + 1 corpus）**:
`src/ir/{numeric-config,capability-spec,boundary-declaration}.ts`、
`src/delivery/{config-consistency,capability-thresholds,delivery-form,boundary-render}.ts`、
`tests/ir/{numeric-config,capability-spec,boundary-declaration}.spec.ts`、
`tests/delivery/{config-consistency,capability-thresholds,delivery-form,boundary-render}.spec.ts`、
`tests/quality/cumcm-2026-a.spec.ts`、
`bench/quality/cumcm-2026-A/**`。

**修改（11）**：`src/ir/schema.ts`（15→18）、`src/ir/refs.ts`、`src/ir/index.ts`、
`src/delivery/gate-registry.ts`（三门扩展接线）、`src/delivery/index.ts`、
`src/produce/execution-producer.ts`（DP-4 捕获）、`src/executor.ts`（teaching +
边界附录）、`src/capability-sets.ts`（算子消费状态注释更新）、
`tests/ir/fixtures.ts`（3 新 kind fixture + 链尾追加）、
`tests/ir/redteam.spec.ts`（引用表扩展）、`tests/executor.spec.ts`（R5 期望
更新为 DP-8 新契约）、`tests/produce/execution-producer.spec.ts`（DP-4 四测）。

**未动**：`bench/MANIFEST.json`（12 题冻结预注册不受影响——golden corpus 因此
放在 `bench/quality/` 而非 M-QUAL 方案所写的 `bench/problems/`，显式偏差已
在 corpus README 声明）、`evidence-freeze.ts`（配置比较走字段级比对，强于
指纹等值；指纹命名空间保持 `-v1`，golden 指纹零改动）。
