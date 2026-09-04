# TASK-P3 — known-risks（P2 九项重审矩阵 + P3 新增残余风险）

> 纪律 A1：红字在册 > 假绿。P2 清单逐项重审，如实关闭/收窄/保留。

## P2 清单重审（对照 TASK-P2/known-risks.md 九项）

- **P2-1（RunMode 无 formal + 教学缺位）→ 关闭**：formal 别名已登记
  （`migrateRunMode` 层 'formal'→strict，D-P3.1，闭集不动）；EXECUTE
  instruction 内置 `EXECUTE_PROTOCOL_TEACHING` v0（`src/executor.ts` 导出，
  probe v2 逐字引用，两者不可能漂移）。真实遵从率已实测（见 #3）。
- **P2-2（SVG 位图/DF 扩展）→ 部分关闭**：DF `table` 图型已落地
  （P3-4，闭集 {line,scatter,bar,table}，table 只吃 Result，禁4 保持）；
  PNG 位图、多序列 x 轴仍留 P4。
- **P2-3（同值多图不区分）→ 关闭**：唯一性键
  (sorted data_refs, chart_type, style_profile) 生产期拒重、零部分写入
  （P3-4 攻击 1 红，DUP-FIGURE kill 叶入 corpus v3）。
- **P2-4（逐字表达受限）→ 关闭（保守面按声明收窄）**：P3-2
  `representation` 声明制落地（verbatim | rounded{dp} | with_uncertainty），
  ≈/± 有声明路径；**方法性数字入结论保持禁止（禁3 未放开）**。
- **P2-5（demo/CI 平台差异）→ 保留**：P3-6 demo v3 本机 Windows 验证 +
  CI Linux 真跑为准（与 P2 同口径）。

## P1 清单重审（#2 口径定稿，F3）

- **#2（firewall code-run 白名单）→ 按原文口径标记关闭**：P1 原文口径为
  "runnerCommand 由部署方组合层注入、模型不可选"。P2-1 已在 executor 层
  强制：容器 run 块只许 `outputBasenames/seed`（越键即
  `PRODUCE_RUN_DECLARATION_INVALID`），runnerCommand 仅经部署挂载的
  `options.produceRun` 注入（`src/executor.ts`）。**沙箱能力层（文件系统/
  网络边界）** 作为独立风险在册为下方 P3-6（demo 真跑使用临时目录 +
  内存后端；外部部署自行配置 OS 级沙箱）。
- 其余（#1 已闭 P2 / #4 见下 / #5 无容差 / #6 见下 / #8/#9 平台纪律）
  沿用上批状态；#4 关闭见下。

## known-risks 主清单状态（#3/#4/#5/#6 如实）

- **#3（真实 provider 遵从率）→ 部分关闭 → 本批实测归档**：
  probe v2 已实跑（GMI `https://api.gmi-serving.com/v1` +
  `MiniMaxAI/MiniMax-M3`，20 次真实首次尝试，教学段 v0）：
  **首次遵从率 0/20**；失败分类 declaration-drift 17 / run-failure 2 /
  transport-error 1（记录归档 `probe-v2/output/`）。
  **<0.8 降级已字面生效**：该 provider+协议+教学组合记录为
  EXPLORATORY 降级（summary `downgrade` 字段 + 本 decision-log 在册）。
  **口径声明**：该实测针对 MiniMax-M3 组合，**不覆盖 DeepSeek 官方端点**；
  known-risks #3 的"DeepSeek 侧实测"子项保持**部分关闭**（CI secret 无
  key，义务随批移交不消失，禁7）。教学增益对比（前后 A/B）不在本批预算
  （任务书 §7 风险 4）。
- **#4（文本声称 A 实际证明 B）→ 关闭**：P3-1 评审语义核对 v1 兑现 P1 D1
  义务——三类闭集（claim_without_evidence / number_rewrite_mismatch /
  scope_overclaim）+ 证据域（text_span 必须存在于交付文本、ref_ids 必须
  解析进 SemanticContext）+ E4 账本复用；无证据 finding parse 层拒（禁1，
  攻击 3/3b/4 红）。
- **#5（舍入/约述表达）→ 收窄至声明制域**：未声明的 ≈/舍入一律拒
  （禁2/禁6 不动）；`rounded` 单一半进位规范、负数/科学计数 v1 拒
  （D-P3.2）；`with_uncertainty` 必须绑定声明 Result 的 ± 值。
- **#6（表达自由度保守面）→ 按声明收窄**：verbatim/声明制外无第三条路；
  方法性数字入结论仍禁（禁3）；合法"0.731 m（±0.012）"现走
  with_uncertainty 声明（P3-2 正例绿）。

## P3 新增残余风险

- **P3-1**：真实 reviewer 的语义误杀率未实测（corpus v3 legal 叶语义误杀
  0/5，但那是 fake reviewer；真实 reviewer 的误杀面待真实 review 探针——
  证据域 ref_ids 必填已是最小盘，收紧点在攻击红测内）。
- **P3-2**：dp 语义 v1 只承诺十进制小数位（0..20）；负数舍入、科学计数、
  有效位表述 fail-closed 拒（D-P3.2）；真实论文若需有效位表述走扩展任务书。
- **P3-3**：probe v2 实测的 0/20 针对单一组合（GMI + MiniMax-M3 + 教学
  v0）；不同 provider/不同教学版本需各自实测，**不得跨组合外推**。教学段
  措辞修正（kind/role 歧义澄清）后仍 0/20——declaration-drift 从"role 当
  kind"变为 schema 细节（content_hash 格式、依赖数组、引用漂移），下一步
  改进方向在册：教学段附一个完整最小示例仍受禁10 约束（不得教 schema 外
  格式，但 schema 内的完整示例不违规），留 P4。
- **P3-4**：唯一性键以 (sorted refs, chart_type, style) 为界——caption/
  轴标签不同不影响键（同数据同型不同标题仍视为重复资产，是有意保守）；
  DataArtifact 行选择语义未设计（禁4 保持，table 只吃 Result）。
- **P3-5**：formal 别名在 migration 层登记（migrateRunMode）；settings 的
  `defaultMode` union 未加 'formal'（schemastery 类型面不动，禁8 保守面）——
  配置侧若写 'formal' 仍会在 schema 校验拒，需经 migration 入口。
- **P3-6**：demo v3 summary 已 UUID 脱敏（F1，重跑零脏字面成立）；但
  `generated_at` 一类时间戳字段本批不存在于 demo summary（无需例外标注）。
- **P3-7**：master CI 的 `check:ci` lintGate 覆盖全仓 oxlint，上游遗留
  ~20 处 executor.ts/renderer.ts 风格错误（P2 及更早提交未过本地
  lefthook 所致）在本批未清（P3 纪律：不越界改无关于 P3 diff 的行）；
  master 推送预期 lint 红一次，清欠走后续任务书。
