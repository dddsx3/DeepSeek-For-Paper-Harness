# TASK-T1 — IR 语义契约冻结 (任务书第一阶段 / Sprint 1) 交接文档

> 头:`e7a5b16a83`(上一批)之后,本批是「下一阶段工程任务书」第一阶段的实现。
> 本文件是给外部行业专家做**审计与重设计**的交接:已完成什么、没完成什么、
> 哪些决策请求复核、repo 现状与验证方式。

## 1. 本批完成(已落地并全 regression 绿)

### 1.1 三个新 IR canonical 对象(`packages/paper/paper-foundation/src/ir/contract-objects.ts`)

| 对象 | 作用 | 关键字段 |
|---|---|---|
| `AssumptionSpec` | 假设的唯一 owner(任务书 T1.1:假设是数学建模第一大道 hallucination 渠道) | assumption_id / scope_ref→ProblemSpec / statement / source_type(GIVEN\|DERIVED\|MODELING_CHOICE\|APPROXIMATION) / justification_refs / risk_level / testable / sensitivity_refs / status(ACTIVE\|OBSOLETE\|QUESTIONED) |
| `EquationSpec` | 公式的唯一 owner;**机器态与展示态分离**(T1.2:LaTeX 是 renderer) | equation_id / scope_ref / expression / representation(SYMPY\|LATEX_PRESENTATION) / lhs_symbols / rhs_symbols / equation_type / unit / depends_on / source |
| `ExperimentSpec` | 实验设计(与 RunArtifact/ExecutionRecord 的"执行记录"分离) | experiment_id / purpose / input_data_refs / parameter_sweep / metrics / replications / seed_policy / expected_invariants / run_refs |

三个对象都进了 `IR_KINDS` / `IR_SCHEMAS` / `ID_FIELD_BY_KIND` / `IR_REF_FIELDS`,
关闭了 store commit 边界的引用闭合(refs.ts),bridge resolver 同步(Y2 阶段将要的
G001/G002/G007 门有了字段来源)。

### 1.2 ModelSpec 从自由文本切到引用(T1.2 canonical owner)

- `ModelSpec.assumptions[]` / `equations[]`(自由文本)**删除**,换成
  `assumption_refs[]` / `equation_refs[]`(→ AssumptionSpec / EquationSpec)。
- **数字零通道不变**:数字仍只存在于 Result 与 numeric_binding,公式的 expression 是
  文本表述的机器态(尚无独立数值语义)。
- 同步的产线面:executor 教学串(EXECUTE_PROTOCOL_TEACHING)、probe noneGuide 示例、
  guided-steps(T2)与 template-fill(T3)的容器组装、MODEL_FACE_KINDS 白名单、证据冻结
  依赖锁指纹(`assumption_refs` 进 `dependencyLockFingerprint` —— 漂移向量从"假设文本改"
  换成"依赖的假设集合改")。

### 1.3 SymbolSpec / RequirementSpec 补字段(T1.1 推荐字段)

- SymbolSpec:**必填** shape(SCALAR\|VECTOR\|MATRIX\|TENSOR\|INDEXED)、
  domain(REAL\|NONNEGATIVE_REAL\|INTEGER\|NONNEGATIVE_INTEGER\|BOOLEAN\|PROBABILITY\|COMPLEX)、
  index_set [](T2 的 shape/domain 门直接吃)。
- RequirementSpec:source_span([start,end] 字符偏移,可回答"R-17 从原题哪一段抽出")、
  normalized_text、mandatory、ambiguity_status(可选,留给 extractor)。

### 1.4 架构 mutation 测试(`tests/ir/ir-contract.spec.ts`,T1 验收 #4)

- **duplicate truth source**:ModelSpec 重新内嵌自由文本 assumptions/equations → 拒绝
  (第二真值不可表示);三个 contract 对象都是 strict schema(不可识别键拒绝)。
- **bypass reference**:直接驱动 validateRefFields/isAllowedTarget,钉死
  `IR_REF_FIELDS.ModelSpec` 必须包含 assumption_refs/equation_refs 且 target 只接受
  AssumptionSpec/EquationSpec(未来删表行会红)。

### 1.5 Fault corpus + demo 全量迁移(52 + 3)

- 56 个 fault fixture(TASK-1.5/1.5R/2,C-18/R-18/D-20)迁移到新 ModelSpec 并新增
  AssumptionSpec/EquationSpec 前置条目;**攻击字段保留原文**(R-005 的双 ModelSpec 攻击
  结构也保住了)。
- TASK-P1/P2/P3 的 demo `cases.mjs`(三份)与 shell 模板同步。
- **注意**:TASK-1.5 的 C-corpus(faults/C-*.json)由独立脚本
  `artifacts/handoff/TASK-1.5/run-fault-corpus.mjs` 跑,本批改 schema 之前基线即为
  8 passed / 10 failed(历史遗留,被 1.5R R-corpus 取代);本批迁移后两 corpus 都不新增
  失败。

## 2. 未完成 / 未开始(需要你与专家复核)

- **ir-contract-v1.md 与 paper.md 的记录**(任务书验收 #3、#5)**:未完成**。契约细节
  现在只在 `ir-contract.spec.ts`/schema 注释/本文件里。
- **两 mutation 未接到 runner**:任务书只要求"两 mutation 必红"——已由 spec 直接驱动;
  没接 `run-mutations.mjs` 模式。
- **Production 面尚未"驱动真实验证"**:新对象只是可声明可入 store,第二批
  (Scientific Gate Kernel:G001 符号/G002 shape/G003 unit/G004-5 公式/G007 数值/G008
  claim 类型,任务书 T2.1/T2.2)未动。
- **ExperimentSpec 没有生产者**:无地方 emit 它(任务书 T3.2/T3.3 执行证明之后才有)。
- 51 个历史 C-corpus 失败(历史遗留,未修,已被 R-corpus 取代)。

## 3. 决策点(请求专家复核)

1. **EquationSpec.model_ref 我拿掉了**(任务书建议有)。理由:append-only store 无前向
   引用,ModelSpec.equation_refs → EquationSpec 与 EquationSpec.model_ref → ModelSpec
   构成引用环无法准入。我用 scope_ref→ProblemSpec 替代(与 SymbolSpec 同构)。
   **这是偏离任务书的决策,请专家确认或给替代方案。**
2. **SymbolSpec.shape/domain 我做成必填**,RequirementSpec 四个新字段做成可选。
   shape/domain 必填让所有 fixture(52+3+demo)都要补字段;如果专家认为 G002 门之前
   不该强迫模型多写两个字段,可以回退为可选。此决策影响弱模型 T1/T2/T3 遵从率
   (感知上多两个必填字段 = T1 面更大)。
3. **依赖锁指纹语义变化**:从 hash(假设文本) 变成 hash(假设引用集合)。语义上更干净
   (依赖 = 依赖边,假设内容由 AssumptionSpec 自身冻结),但 EX-04c 的漂移测试语义
   因此改写——专家若认为"假设内容改动必须导致依赖锁漂移",需要指纹把被引用
   AssumptionSpec 的内容也纳入。

## 4. 本批验证结果(提交时全绿)

| 项 | 结果 |
|---|---|
| paper-foundation vitest(thread-safe) | **1040 passed / 1040(94 文件)** |
| RG-06/07/09 self-check | PASS(1040/1040 与 gate-report 一致) |
| P1-5 demo | corpus green:legal 3/3、wrong 2/2 KILLED、9/9 real gates |
| P2 demo v2 | corpus green:4/4、wrong 2/2 |
| P3 demo v3 | corpus green:5/5、wrong 6/6 |
| paper-shell unit tests | 8/8 绿 |
| demo:pw(fake,t3) | 报告内容不变(report sha a0e4c492),zip sha 因 zip 内 run-report 审计串变化变为 5e775fb8(两次重跑同 sha,确定性保持) |
| tsc -b / typecheck | 通过 |

## 5. Repo 现状 & 怎样复现

- 主干 main,本次改动的范围:`packages/paper/paper-foundation/{src,tests}/*`、
  `artifacts/handoff/TASK-1.{5,5R}/faults/*`、`artifacts/handoff/TASK-2/faults/*`、
  `artifacts/handoff/{TASK-P1,TASK-P2,TASK-P3}/demo*/{cases.mjs,output/*}`、
  `artifacts/handoff/TASK-M1/shell-out`(重生成)、`artifacts/handoff/TASK-2.1/gate-report.json`
  (基线 1025→1040/94 文件)。
- 命令:
  - `npx vitest run --project=thread-safe packages/paper/paper-foundation` — 1040/1040
  - `npm run test:task3:report-state` — RG-06 通过,必须与 gate-report.json baseline 一致
  - `npm run test:p1:demo` / `test:p2:demo` / `test:p3:demo` — 三个 corpus 绿
  - `npm run demo:pw` / `npm run test:m1:shell` — shell 面