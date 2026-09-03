# TASK-P2 — redteam（kill 证明汇总）

> 每条攻击在 spec/脚本级有红测试，spec 名可复现。

## E4 review 语义（executor-review-v2.spec.ts，6）
- E4a：round0 critical + 干净轮无 resolved → 仍 BLOCK；显式 resolved 才清。
- E4b：未知 severity → critical finding 并 BLOCK；单条 well-formed critical BLOCK。
- E4c：fast minor 剩余 → 放行且 manifest.advisory_defects 审计；fast major → BLOCK。

## P2-1 executor 权威链（executor-authoritative.spec.ts，4）
- 正例：strict POLAR 全链 DELIVER（RunArtifact/ExecutionRecord/Result/Claim 落库，
  0.731 报告真实落盘）。
- 攻击1：模型注入 runnerCommand → PRODUCE_RUN_DECLARATION_INVALID，无 Result。
- 攻击2：jsonPath 不可解析 → interpretation 拒，零部分写入。
- 攻击3：code 不产声明输出 → capture OUTPUT_SET_MISMATCH，无法冒领 DELIVER。

## P2-3 figure 闭环（figure-consistency.spec 7 + figure-producer.spec 6 + stale-figure.spec 1）
- 正例：data_hash 一致的图无 finding（蓝）；declaration 铸图 + golden 字节一致。
- 攻击1：caption/轴标签自由数字 → 拒。
- 攻击2：data_refs 悬挂/类型不符 → finding/拒。
- 攻击3：data_hash 与实际渲染输入不一致（换数据）→ BLOCK。
- 攻击4：Result 更新后旧图 → STALE_TRANSITIVE BLOCK（stale-figure）。
- 攻击5：无 data_hash 的 FigureSpec（含直写路径）→ schema 拒。
- 攻击6：越界 chart_type（pie）→ renderer 白名单外拒收（figure_data_invalid）。
- 额外：重复 figure_id / 空 data_refs → 零部分写。

## P2-4 报告 v2（report-v2.spec.ts，6）
- TOO-GOOD v2 重演：槽位 text 0.732 vs 表 0.731 → 拒（kill 不因版本升级失效）。
- 攻击3：text 直通（不报绑定值/带无关数字）→ 拒。
- 槽位逐字一致正例 / 多量绑定 / legacy 文本守卫兜底 / 图 data-uri + 溯源附录。

## P2-6 demo v2（脚本级，demo-v2/run-p2-demo.mjs）
- TOO-GOOD-V2（槽位）→ run 未完成 KILLED；CAPTION-ESCAPE（图注数字）→ KILLED。

## P2-2 probe 自检（probe/run-p2-probe.mjs）
- fake 20 次自检 = 1.0（脚本可信）；重试不并入首次遵从（探针攻击防线）。

## P1 关键 kill 回归（跨版本不失效）
- TOO-GOOD / OVER-PROMISE：P1 spec 持续绿；v2 渲染器下 TOO-GOOD 槽位版亦红。
