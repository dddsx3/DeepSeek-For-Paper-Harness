# TASK-PW — decision-log（弱模型遵从分层）

> 上游：TASK-P3 + TASK-P3D（HEAD `58fccc3dd6`，第四轮复审计判定两批 DONE、无待复签项）。
> 本文件先签批、后实现（G1）；裁决单全文见任务书文件一 §11。

## §11 三张裁决单签批回执

### W-A：协议面分层（T1/T2/T3）vs 维持单协议 —— **选 A**（代签）
- 代签人：审计方（作者委托，沿用 E4/E5/E6/E7 代签先例）；日期：2026-09-05。
- 落地映射：W1-W6 + 攻击/回归全套——同一 IR/门集/信任链，模型产出面
  T1 全声明（先修 F-A）/ T2 引导小步 / T3 模板填充；能力探针定层；
  层内 ≥0.8 才 FORMAL；降层自动、升级必经探针。

### W-B：NONE（不调用/散文化）的处置语义 —— **选 A**（代签）
- 代签人：审计方；日期：2026-09-05。
- 落地映射：W4 + 攻击 1-4 红测——NONE ≠ 错，引导重试预算 2 次（可选项 +
  该层最小示例）；ESCAPE 保持零预算硬拒；NONE 耗尽记 failure 并降层。

### W-C：输入资产域外化的范围（F-A 收口）—— **选 A**（代签）
- 代签人：审计方；日期：2026-09-05。
- 落地映射：W1 + 攻击 1-4 红测 + fake 零绕过——全量域外：输入资产
  （ProblemSpec/RAW_PROBLEM/RequirementSpec）从模型声明域移除（teaching
  明示仅可按 id 引用）；模型产物哈希全部 harness 后置计算回填；模型
  声明域哈希字段归零。

## 准入状态

| # | 门槛 | 状态 |
|---|---|---|
| G0 | P3/P3D handoff 完整、无待复签 | ✓（TASK-INDEX 两行 DONE；第四轮复审计无 ☐） |
| G1 | W-A/W-B/W-C 签批 | ✓（本文件，三张均选 A 代签入库） |
| G2 | 基线全绿 | 逐提交同步 gate-report(976→985→993→1003→1007→1018→1025);最终 93 文件 / 1025 测试全绿;demo v4 9/9 exit 0;probe v3 fake 三层 trusted exit 0 |
| G3 | 探针 key | 本批 key 不在环境 → W6 按部分关闭先例走禁 7:probe v3 real 段显式 SKIPPED(D-PW.2);key 就绪后 `pnpm run test:pw:probe` 归档 |

## 偏差声明（D-PW.x，随实现逐条登记）

- D-PW.1（如需要）：数字资产轨与本批的并行关系按任务书文件一 §10.5——
  skills 数字资产并入在 §8（P4 候选），不阻塞 TASK-PW 主轨。

## 实现登记（W1..W6 落地后追加）

| 里程碑 | 状态 | 证据 |
|---|---|---|
| W1 不可能字段清除 | ✓ | MODEL_FACE_KINDS 白名单 + 三拒绝码红测；P1-5 demo 移植 exit 0 |
| W4 NONE/DRIFT 分离 | ✓ | failureClassOf 五类 + 引导预算 2 + 降层；executor-tier.spec 8 绿 |
| W2 T2 引导小步 | ✓ | guided-steps.spec 10 绿 + executor-guided T2 happy/3 攻击 |
| W3 T3 模板填充 | ✓ | template-fill.spec 8 绿 + executor-guided T3 happy/2 攻击 |
| W5 能力探针 v1 + 注册表 | ✓ | registry.spec 7 绿；probe-v1 5/5 升级 exit 0 |
| W6 probe v3 + corpus v4 + demo v4 + CI | ✓（fake 层；real 禁 7 SKIPPED） | probe-v3 fake T1/T2/T3=1.0 trusted exit 0；demo-v4 9/9 FBR 0/9；pw-provider-probe-v3 manual job 入库 |

## 偏差声明（D-PW.x，随实现逐条登记）

- D-PW.1：数字资产轨与本批并行（§10.5 P4 候选），不阻塞主轨。
- D-PW.2（probe v3 real 未跑）：GMI/MiniMax key 不在环境 → 按禁 7 显式
  SKIPPED（probe-v3/output/summary.json status=SKIPPED，永不静默 PASS）；
  key 就绪后 `pnpm run test:pw:probe` 归档，按 adherence 实况登记各层
  FORMAL/EXPLORATORY（字面降级，同 P3-3 先例）。
- D-PW.3（probe-v1 vs probe-v3 分工）：v1 = 注册表 plumbing 自检（5 题）；
  v3 = 分层真实测量（每层 ≥5 次、≥20 合计，复用 W4 分类 + W2/W3 准入链 +
  W5 注册表记录）。不重复。
- D-PW.4（demo v4 "与 T1 等价" 基线）：T2/T3 正例与"harness 组装容器的 T1
  一次性 twin"做 byte-identical 断言（assembleGuidedContainer /
  assembleTemplateContainer 输出以 T1 路径重放）；corpus T1 全叶仍用 P3 原
  容器（FBR 0/5 独立成立，禁 9 重演面不混入）。
