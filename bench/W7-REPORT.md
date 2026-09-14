# W7 报告 — 验证层(下)V5 对抗审查 + V6 模型选择 + V7 sympy

> 依据:DPH-PRD-v2 §6.4(V1–V7)、§6.1 P0-6、§8 W7。
> 基线:W6 commit `7222f07ee7` 之后。本文档随 W7 批次提交。

## 1. W7 退出判据验证(PRD §8 原文)

> 量纲错误模型被 BLOCK;零发现审查被判定无效

**两者都达成。**
- **量纲错误被 BLOCK(shell 侧判定)**:`sympy-v7-check.py` 对"结果单位未在符号表声明"的模型返回 `DIM-002 ok:false`;`runV7Check` 打包层端到端验证(v6-v7.spec:单位不匹配被捉、PROBABILITY 越限被捉)。这只是验证器判定——把 ok:false 转成 run BLOCK/MARKED 由下一阶段接进交付门槛。
- **零发现审查被判定无效**:`adjudicateAdversarialReview` 对空 findings 返回 `valid:false` 且 detail 含"零发现"(v5.spec 断言)。

## 2. 交付清单

| 组件 | 落点 | 验证 |
|---|---|---|
| **V5 对抗审查** | `verification/v5-adversarial.ts` | v5.spec 6/6:合格审查过;零发现=无效;**悬空引用被弃**(幻觉发现不算);**伪造 text_span 被弃**(span 不在论文中) |
| **V6 模型选择** | `verification/v6-model-choice.ts` | v6 部分 5/6:≥2 候选+选型理由+放弃理由;单候选/自创模型/缺理由/未给放弃理由全被拒 |
| **V7 sympy** | `scripts/sympy-v7-check.py`(量纲/定义域/残差)+ `verification/v7-sympy.ts`(打包层) | v7 部分 4/4:脚本路径在仓内、量纲不匹配被捉、干净量纲过、PROBABILITY 越限被捉 |
| **验证层全集** | `tests/verification/` 3 spec **27/27** | V1–V7 全部可运行 + 反例可构造 |

## 3. 关键工程决策与发现

1. **V5 的"有效发现"判定比"数量"更严**:不只数 findings,还要每个都过两道过滤——引用必须可解析(悬空的 target/evidence 是幻觉)、span 必须是论文逐字子串(伪造 span 是攻击者臆造)。这让"对抗审查"本身不可被敷衍:零发现无效、发现全是假的也无效。
2. **V7 走 shell 侧(与 bundle 同模式)**:sympy 是 python 生态,引擎不依赖文件格式的原则延伸为"引擎可通过子进程调外部数值工具,但不内嵌"。type 上 `V7Input` 显式,脚本确定性(同输入同输出)。
3. **V6 的"≥2 候选"是数模评审得分的结构预埋**:PRD §6.4 明确"模型选择可解释性是评审本身得分点"。候选集来自 W5 契约(封闭),V6 只查"是否比较过、理由是否说清"——不做正确性判断(交叉验证/残差是 V7/F3 契约的事)。
4. **接入交付门槛仍待做**:V1–V7 现在是独立的可运行验证器集;把它们汇入 fail-soft 的 gradeInput(V 失败进 MARKED 附录、致命性类似 W2)是 W8 骨架层装配的一部分。**诚实边界**:W7 的"量纲错误被 BLOCK"是 shell 侧判定能力,不是 run 终态——run 级 BLOCK 要等接入。

## 4. 测试与验证

- verification 3 spec 27/27(新增 16);paper 1172/1172(106 文件);shell 58/58;负对照 18/18;paper/shell tsc 全过;metrics OK
- V7 真实调用(sympy 脚本)已端到端两次验证(单位不匹配 DIM-002、PROBABILITY 越限 DOM-001)

## 5. 遗留与下一步(W8)

1. **V1–V7 接入交付门槛**:把 `runVerificationV1V4`/`V5`/`V6`/`V7` 汇总成一份 v-findings,按 W2 的 fail-soft 语义并进 gradeInput → 失败进 MARKED 附录、致命(如量纲系统性错误)可 BLOCK。这是"验证层从独立模块变成真正闸门"的关键一步。
2. **V7 与 F3 契约的残差检查重叠**:F3 契约验证器有"残差存在",V7 的 RES-001 有"残差居中"——接入时确认不重复计数(契约管"存在",V7 管"分布")。
3. **附录渲染纳入 v-findings**:W2 的附录目前只列 gate/review;W8 加 v-findings 表。

## 6. W7 模块精读:delivery/gate-registry.ts(§9 第 7/12 份)

- **不变量**:`buildDeliveryPolicy` 是唯一装配点(9 道 critical 门 + UNIMPLEMENTED 显式态);`evaluateDelivery` 对非 PASS 的 critical 门 fail-closed,不容忍"缺门"或"downgrade 门"(RT125C 系列);`CRITICAL_GATE_IDS` 是慢变闭集,新增门必须同时改清单+注册。
- **我不同意什么**:门的状态只有 PASS/FAIL/BLOCKED ——**没有"待验证"态的语义**:V1–V7 这种"新验证器还没接"的状态只能用 UNIMPLEMENTED 表达,而 UNIMPLEMENTED 是 fail-closed(BLOCK)。这造成"代码已就绪但未接线"和"根本没实现"不可区分。建议加一个显式 `NOT_WIRED` 中间态:能跑但未并入交付判定——杜绝"实现存在却因接线滞后被当成不存在"的审计误导。
- **删掉它会坏在哪**:INV-3-K(单一交付判定路径)与 RT125 红队的一切防线都在这。
- **一句话对外**:所有"该不该交付"的裁决只从这里过——谁想绕过它另开判定就是红队第一攻击目标。

---

*W7 退出判据:达成(量纲错误可被判定、零发现审查判定无效)。W8 进入:论文骨架层(PaperSkeleton + 10 章节渲染 + 符号表/假设表自动生成)。*