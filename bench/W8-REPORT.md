# W8 报告 — 论文骨架层(P0-7)+ 验证层接入交付闸门

> 🔴 **2026-09-22 架构改造提示**：本报告是**当时**的实测记录，其中"`strict-tolerance` 是默认档位"已不成立——默认已反转为 `fail-soft`。现行架构见 [`../docs/upper-bound-architecture.md`](../docs/upper-bound-architecture.md)。

> 依据:DPH-PRD-v2 §5.1.4/§6.1 P0-7、§8 W8。
> 基线:W7 commit `80e0c184b1` 之后。本文档随 W8 批次提交。

## 1. W8 退出判据验证(PRD §8 原文)

> 骨架可渲染为完整空壳

**达成。** `renderPaperSkeleton` 渲染 10 章节全齐(paper-skeleton.spec 7/7):
- 10 个必备章节(摘要/问题重述/问题分析/模型假设/符号说明/模型建立与求解/模型检验/模型评价/参考文献/代码附录)全部出现在渲染文本中(M4 骨架完整率 100%);
- **符号表/假设表自动生成**:机器表格从 IR 行渲染(含 markdown 管道转义),空 IR 渲染完整空壳并注明"由规范 IR 自动生成";
- REQUIRED_OUTPUT 表并入问题重述(重述即列出必须产出什么)。

## 2. 交付清单

| 组件 | 落点 | 验证 |
|---|---|---|
| PaperSkeleton | `produce/paper-skeleton.ts`(新):PAPER_SECTIONS 闭集 + renderPaperSkeleton | skeleton.spec 7/7(10 章节全齐/符号表/假设表/要求表/空壳/管道转义) |
| **V1–V4 接入交付闸门** | `executor.ts`:fail-soft 下 `runVerificationV1V4(ir)` 失败项并进 gradeInput → MARKED 附录;**strict-tolerance 保持历史输入逐字节不变**(V findings 不参与) | fail-soft spec 4/4:合法 backbone 零 V 误报(附录只有 review 项);**overlay 未引用假设 → 附录真实出现 V1 finding(A-ORPHAN)且 run 仍交付** |

## 3. 关键工程决策与发现

1. **验证层并入的闸门语义**:V 失败在 fail-soft 下是**标注**(进附录),不是平行判定路径——与 W2 的 gradeDelivery 单一裁决一致。strict-tolerance 的输入集合保持与 W2 提交时逐字节相同(V findings 只在 fail-soft 模式注入),历史行为零漂移。
2. **零误报即资产**:合法 backbone 上 V1–V4 零 finding——验证器的"合法链零误报"性质(从 W6 的 validChain 测试继承)在真实 executor 链路上复现,附录里的每一行都是真问题。
3. **harness 可注入 IR**:fail-soft 验收 harness 泛化为接受自定义 ModelingIr,W8 的 V-gate 测试用 overlay(合法 backbone + 一个漏网假设)证明"V 失败 → 附录行"全链路。
4. **骨架渲染是数据不是耦合**:PaperSkeleton 独立于现有 report-renderer(5 固定标题模板),不破坏 T3 回归路径;W9+ 图形重构时骨架层承接图表槽位。

## 4. 测试与验证

- paper-skeleton.spec 7/7(新增);fail-soft spec 4/4(含 W8 V-gate);paper **1180/1180**(107 文件);shell 58/58;负对照 18/18;paper/shell tsc 全过;metrics integrity OK

## 5. 遗留与下一步(W9–W10)

1. **图形重构(W9–W10,P1-1)**:序列化数据模型 + DataArtifact 接入 + 多序列/误差棒/矢量/中文字体;骨架层已就位承接图表槽位。
2. **V5–V7 接入 gradeInput**:W8 只接了 V1–V4(纯结构、IR 可查);V5 对抗审查需要 run 侧 ReviewerFinding 汇集、V6/V7 需要声明面输入——W11 端到端贯通时随契约层一起接。
3. **骨架与 executor 的接线**:当前骨架渲染器独立可运行;让 EXECUTE 交付文本走骨架渲染(替代 5 固定标题)需改 runProductionChain 的报表生成——W9 与图形一起动,避免本回合触碰交付主链。

## 6. W8 模块精读:ir-producer.ts(§9 第 8/12 份)

- **不变量**:produceContainerInto 是模型输出进 IR 的**唯一**门——候选 kind 白名单(AssumptionSpec/EquationSpec/ModelSpec/DataArtifact)、DataArtifact 仅 output-pointer 形(禁 content_hash——"不存在字节的哈希"规则)、引用闭合由 store.put 复验。
- **我不同意什么**:模型声明 DataArtifact 用 `{data_id, locator}` 而 harness 事后 mint 完整对象——两阶段形状不同意味着"模型声明的 DataArtifact"与"IR 里的 DataArtifact"不是同一类型,靠约定衔接。建议给两阶段显式命名(ModelPointer vs CanonicalData),类型上断开。
- **删掉它会坏在哪**:ir-container-v1 协议的拒绝分类(ESCAPE/NONE/DRIFT)都从 producer 的 verdict 出——它是 W4 失败分类的上游。
- **一句话对外**:模型说什么不重要,能进账本的才重要——producer 把"模型的声明"翻译成"IR 的事实",翻译不过去就按失败类退回。

---

*W8 退出判据:达成(骨架渲染完整空壳 + 符号/假设表自动生成 + V1–V4 成为真闸门)。W9 进入:图形重构(上)序列化数据模型 + DataArtifact 接入。*