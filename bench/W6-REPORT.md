# W6 报告 — 验证层(上)V1–V4 结构检查

> 依据:DPH-PRD-v2 §6.4(验证层 V1–V7)、§6.1 P0-6、§8 W6。
> 基线:W5 commit `460a8b8409` 之后。本文档随 W6 批次提交。

## 1. W6 退出判据验证(PRD §8 原文)

> V1–V4 结构检查;每项有一个能构造出的反例被抓住

**达成。** `tests/verification/v-structure.spec.ts` **11/11**:四项检查全部有"合法链通过 + 构造反例被抓住"的成对用例。

| 检查 | 合法过 | 反例被抓住 |
|---|---|---|
| V1 假设-使用一致性 | validChain 全引用 | 未引用的 ACTIVE 假设(A-ORPHAN)被标 |
| V2 假设-来源匹配 | GIVEN→DataArtifact 成立 | APPROXIMATION/MODELING_CHOICE 缺 justification 被标 |
| V3 假设-结论敏感性 | 无 HIGH 缺敏感性 | HIGH 假设无 sensitivity_refs 被标 |
| V4 模型-题面覆盖 | 链上符号+REQUIRED_OUTPUT 全达 | 幽灵符号(SYM-GHOST)+无 reaching 链的 R-GHOST 被标 |

## 2. 交付清单

| 组件 | 落点 | 说明 |
|---|---|---|
| V1–V4 验证模块 | `packages/paper/paper-foundation/src/verification/v-structure.ts`(新) | 4 个纯函数 + `runVerificationV1V4` 汇总;`toMap` 适配(接受 ModelingIr 或 Map,与 gate-registry 同构,可注入现有链条) |
| 反例单测 | `tests/verification/v-structure.spec.ts` 11/11 | 以 `validChain()`(合法链)为基座,叠加单个违规对象,违规可归因 |

## 3. 关键工程决策与发现

1. **复用合法链 `validChain()` 而非手搓 fixture**:IR 的 `put` 做**引用存在性校验**(scope_ref 必须已注册 ProblemSpec、变量必须已注册 SymbolSpec……),手搓 fixture 一直撞校验。改用 `validChain()`(其引用全部解析)当基座,反例只是"叠加一个漏网对象"——这让**每个反例都归因清晰**,且证明验证器在合法 IR 上**零误报**。
2. **`toMap` 适配**:验证函数签名接受 `ReadonlyMap` 或 `ModelingIr`(有 `list()`),与 gate-registry 消费的 store 形状一致,之后接进交付门槛(MARKED 附录纳入 V 失败)无需改验证器本身。
3. **★ 发现 schema 层的纵深防御**:幽灵符号 **SYM-GHOST 连 IR 都进不去**——`put(模型引用未声明符号)` 被引用校验直接拒。V4 的符号检查因此是**纵深防御**(防绕过 schema 的手工 store),不是第一道防线。这印证 PRD 的"架构质量★★★★(引用闭合)"判断,也说明 V4 主战场在 REQUIRED_OUTPUT 覆盖(幽灵需求 R-GHOST 成功进入 store 且被抓)。
4. **V1–V4 尚未接进交付门槛**:W6 只交付"可运行的验证器 + 反例单测";把 V 失败计入 MARKED 附录需改动 executor 的 grade 输入(把 `runVerificationV1V4` 结果并进 `gradeInput`)——留 W7(与 V5 对抗审查一起接),避免 W6 范围膨胀(PRD §10 范围纪律)。

## 4. 测试与验证

- verification spec 11/11(新增);paper 1156/1156(104 文件);shell 58/58;负对照 18/18;paper/shell tsc 全过
- 反例有效性:全部反例是"合法 IR + 一个可利用的缺口",验证器必抓(归因断言,非仅计数)

## 5. 遗留与下一步(W7)

1. **V1–V4 接入交付门槛**:把 `runVerificationV1V4` 结果并进 fail-soft 的 gradeInput → V 失败进 MARKED 附录(与 W2 的附录渲染打通)。
2. **V5 对抗性审查 + V6 + V7**:V5 独立通道要求 ≥N 问题(V5 零发现=无效);V7 sympy 量纲/残差/定义域。
3. **契约专项验证器与 V1–V4 的合并**:W5 的 F3/F4 专项验证(残差/权重敏感性)与 W6 通用结构检查是互补层——W7 接入时确认两者不重复判、都进附录。

## 6. W6 模块精读:ir/schema.ts(§9 第 6/12 份)

- **不变量**:全谱 schema 是**引用闭合**的——`put` 对每个 ref 字段做存在性 + 目标 kind 校验(AssumptionSpec.scope_ref→ProblemSpec、justification_refs→已注册对象……);未知 enum 值 fail-closed(`.strict()` + zod enum);ExecutionRecord 只能经 `putExecutionRecord(record, attestation)` 摄入(INV-3-M),防伪造捕获记录。
- **我不同意什么**:`content_hash` 字符串格式 `sha256:<64 hex>` 是运行时正则校验,不是类型——一个写错长度的 hash 要到 put 才报错,且 `'sha256:' + '0'.repeat(64)` 这种测试写法暴露了它没有 branded type。建议给 `content_hash` 加 `Branded<'Sha256Ref'>` 模板字面量类型(仓里已有 Branded 基建)。
- **删掉它会坏在哪**:引用闭合 + fail-closed 是 TASK 1/1.5 的红队成果(防伪装门、防绕过 IR 直写交付);删掉=回到"任何对象都能被声明、引用可以悬空"的旧坑。
- **一句话对外**:IR 是"每个引用都必须落地"的强约束账本——模型声明的东西必须存在,否则根本进不了门。

---

*W6 退出判据:达成(V1–V4 结构检查,每项反例被抓住)。W7 进入:V5 对抗性审查 + V6 + V7 sympy(量纲错误模型被 BLOCK;零发现审查被判定无效)。*