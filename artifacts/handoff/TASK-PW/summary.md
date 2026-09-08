> ⚠ FROZEN-SNAPSHOT(任务书 B0-3):本文件是该批次收口时的**历史冻结快照**,不反映仓库当前状态;现行台账见 TASK-INDEX.md 与 INTERIM-STATUS.md。

# TASK-PW — summary（交付出口矩阵）

> 批次：弱模型遵从分层（W1..W6）。上游：TASK-P3（`58fccc3dd6` 后批）。
> 本批全部提交经 lefthook pre-commit（oxlint staged 0 错误）与 pre-push
> typecheck；远端 CI "Paper harness gates" 每批绿（RG-06 baseline 同步）。

## 交付-出口矩阵

| 任务 | 交付 | 出口 | 证据 |
|---|---|---|---|
| W1 不可能字段清除（F-A 收口） | `src/ir/problem-contract.ts`（DATA_ARTIFACT_ROLES + RUN_OUTPUT）、`src/produce/ir-producer.ts`（MODEL_FACE_KINDS 白名单 / modelOutputArtifactSchema / `input_asset_domain` / `hash_field_forbidden` / `registered_id_redeclared` / pendingOutputArtifacts）、`src/executor.ts`（registerInputAssets + 哈希后置回填 + OUTPUT_ARTIFACT_LOCATOR_INVALID）、`src/executor-service.ts`（produceFromExecute 注册）+ 旧 fake 全量迁移 | DONE | `tests/produce/ir-producer.spec.ts` 17 绿（攻击 1a-d/2/2b/3）；executor-authoritative / executor-producer / execution-producer 迁移绿；P1-5 demo 移植 exit 0 |
| W4 NONE/DRIFT 分离语义（W-B 落地，先于 W2/W3） | `src/probe/probe.ts`（failureClassOf 五类 / NONE_RETRY_BUDGET=2 / degradeTier / initialTier / noneGuide / driftCorrection / REGISTERED_ID_TABLE）、`src/executor.ts`（#tierByRun/#noneSpent/#driftSpent/#guidedGuidance + 分类 catch-loop：ESCAPE 零预算 / NONE+DRIFT 引导 / RUN+TRANSPORT 走 legacy）、`src/audit.ts`（escape_refused / tier_degraded） | DONE | `tests/executor-tier.spec.ts` 8 绿（五类精确映射 + parse_failed NONE/DRIFT 分裂 + 攻击 1/2 + NONE≠错 + DRIFT 字段级纠错） |
| W2 T2 引导小步协议 | `src/produce/guided-steps.ts`（session ledger / admitGuidedStep / assembleGuidedContainer / startGuidedSession / defaultCandidates / guidedStepPrompt）、`src/executor.ts`（runGuidedExecute 向导 + tierOf 路由） | DONE | `tests/guided-steps.spec.ts` 10 绿（正例 + 攻击 1/2a/2b/3/4 + 步序强制 + 散文拒）；`tests/executor-guided.spec.ts` T2 happy path 同 sha256（与 T1 等价交付）+ 攻击 1/2/3 红 |
| W3 T3 模板填充协议 | `src/produce/template-fill.ts`（admitTemplateFill 闭集 / assembleTemplateContainer harness 侧组装 / defaultTemplateCandidates / templateFillPrompt）、`src/executor.ts`（T3 路径，拒收 = ESCAPE） | DONE | `tests/template-fill.spec.ts` 8 绿（正例 + 攻击 1/1b/2/3/4/5）；executor-guided T3 happy path 同 sha256 + 攻击 1/2 红 |
| W5 能力探针 v1 + 组合注册表 | `src/probe/registry.ts`（CombinationRegistry append-only / CombinationRecord / upgradeVerdict 双指标 ≥0.8 且零重试预算）、`artifacts/handoff/TASK-PW/probe-v1/`（5 题跨三协议层） | DONE | `tests/registry.spec.ts` 7 绿（正例 + 攻击 1-4 + append-only + 组合区分）；probe v1 fake 5/5 升级 exit 0 |
| W6 probe v3 + corpus v4 + demo v4 + CI | `artifacts/handoff/TASK-PW/probe-v3/`（分层探针：T1/T2/T3 各自首次尝试 adherence + CombinationRegistry 记录 + 无 key 显式 SKIPPED 禁7）、`demo-v4/`（层注册演示 9 叶）、`.github/workflows/paper-harness.yml`（pw-provider-probe-v3 manual job）、`package.json`（test:pw:probe） | DONE（fake 层；真实 key 缺 → 禁7 显式 SKIPPED） | probe v3 fake 自检 T1=1/T2=1/T3=1 trusted、registry 三层 upgrade OK、real SKIPPED exit 0；demo v4 9/9 DELIVER、FBR 0/9、T2/T3 与各自 T1 twin sha256 byte 级一致 |

## 门禁自评

| Gate | 判定 | 证据 |
|---|---|---|
| G0 tsc 干净 | ✅ | `tsc -b tsconfig.host.json` exit 0（pre-push typecheck 每批复跑） |
| G1 vitest 全绿 | ✅ | 93 文件 / 1025 测试全绿（976→985→993→1003→1007→1018→1025 逐提交递增） |
| G2 F-A 不可降级 | ✅ | `hash_field_forbidden` / `input_asset_domain` / `registered_id_redeclared` 三拒绝码有独立红测；模型声明域无 content_hash |
| G3 W4 五类分离 | ✅ | NONE 引导预算 2（可选项 + 最小示例）；ESCAPE 零预算硬拒；DRIFT 字段级纠错点名字段；NONE 耗尽记 failure 并降层（攻击 2 断言 tier_degraded） |
| G4 W2 步协议 | ✅ | 三步 ≤4 字段；步 1 未准入不进入步 2；攻击 1-4 全红；T2 与 T1 同 sha256 |
| G5 W3 填充协议 | ✅ | 自由数字/容器形 JSON/非候选值全拒（ESCAPE）；T3 与 T1 同 sha256 |
| G6 W5 注册表纪律 | ✅ | upgradeVerdict 双指标 + 零重试预算单门；append-only；升级必经探针（禁 5） |
| G7 禁 7 | ✅ | probe v3 无 key → real 段显式 SKIPPED，永不静默 PASS（CI manual job 同纪律） |
| G8 demo v4 确定 | ✅ | 9 叶 9/9 DELIVER、FBR 0/9、T2/T3 与 T1 twin 同 sha256；重跑 exit 0 |
| G9 kill 不失效 | ✅ | corpus v3 六 kill 在 T1 层重演（demo v4 T1 全叶沿用 P3 容器，语义 kill 由 spec 层保持红） |
| G10 文档同步 | ✅ | decision-log / summary / redteam / pass-corpus / probe-v3 / demo-v4 / TASK-INDEX 本批行齐 |

## 偏差声明（D-PW.x）

- **D-PW.1（数字资产轨并行）**：skills 数字资产并入属 P4 候选（任务书文件一
  §10.5），不阻塞本批主轨。
- **D-PW.2（probe v3 真实段未跑）**：本批 fake 层自检 trusted（T1/T2/T3 各
  1.0），真实 ≥15 次首次尝试需要 GMI/MiniMax key —— key 不在环境 → 按禁 7
  显式 SKIPPED（不静默 PASS）；key 就绪后跑 `pnpm run test:pw:probe` 归档。
- **D-PW.3（W5 probe v1 与 W6 probe v3 分工）**：probe-v1 是注册表 plumbing
  自检（5 题），probe-v3 是分层真实测量脚本（每层 ≥5 次，≥20 合计），二者
  不重复：v3 复用 W4 分类 + W2/W3 准入链 + W5 注册表记录。
- **D-PW.4（demo v4 的 T1 twin 基线）**：层注册演示的 "与 T1 等价" 断言采用
  harness 组装容器（assembleGuidedContainer / assembleTemplateContainer 输出）
  以 T1 一次性路径重放 —— 证明向导/填充组装出的容器走同一信任链得到
  byte-identical 报告；corpus T1 全叶仍用 P3 原容器（FBR 0/5 独立成立）。
