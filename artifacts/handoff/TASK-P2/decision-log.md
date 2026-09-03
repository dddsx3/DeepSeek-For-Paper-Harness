# TASK-P2 — decision-log（P2 批次冻结稿与执行记录）

> 前置：P1 闭口决议 + E4 三裁决（选 A）于 2026-09-04 代签入库（TASK-P1/decision-log 复签记录段）。
> 本文记录 P2 内新决策与对任务书字面的偏差声明（有偏差必记，禁止事项 8）。

## E4 落地映射（随 P2-1 提交，代码与裁决一致）
- E4a 跨轮缺陷累积已实现（review loop v2 + 红测）。
- E4b severity 三值 + 未知值 fail-closed（critical 保留原描述）已实现。
- E4c fast 仅剩 minor 放行 + manifest.advisory_defects 审计已实现。
- 本段只做回执；细节在 commit 200e286519 / P1 decision-log 回执段。

## D-P2.1. executor 整链 = 严格/快速模式真九门（RunMode 无 'formal'）
- 任务书通篇"九门 FORMAL"；仓库 RunMode 枚举（settings runModeSchema）只有
  fast|strict|exploratory。executor 的 delivery 门按 mode 注册：strict/fast 走
  真九门（backbone required），exploratory 豁免。故"executor 权威 FORMAL 交付"
  在实现上 = **strict 模式 + backbone/record 完整链**（与 P1 demo 用
  buildDeliveryPolicy mode FORMAL 语义同一门集）。已记 known-risks；P3 若引入
  显式 'formal' RunMode 再做别名，不重复造。

## D-P2.2. 图资产渲染器实现为"仓库内等价物"（任务书 §P2-3 第 3 点偏差声明）
- 任务书建议 python+matplotlib + PNG；授权"或仓库内等价物"。P2 采用
  **harness 自有确定性矢量渲染器**（src/figure/renderer.ts，零外部运行时依赖、
  固定 Okabe–Ito 样式、确定性 SVG 字节；渲染输入哈希=data_hash）。
- 与任务书字面差异：产物为 SVG（报告以 data:image/svg+xml 内嵌 + 独立 .svg 落盘），
  非 PNG。理由：仓库 CI/容器无 matplotlib 保障，python 面是任务书自列风险 #2；
  SVG 同为"真实渲染字节"（禁 7 满足），且 CI/本机完全可复现（禁 8 受益）。
- 附带义务：P3 如需位图输出，渲染器后端可加 PNG 编码器（输入契约不变）。

## D-P2.3. figure 数据闭环 v1 语义冻结（D3 义务实现）
- FigureSpec.data_hash = sha256(canonicalJson(render input))，render input 由
  harness 按 data_refs 从 store 派生（值来自 Result，模型无数值通道）。
- data_refs 仅允 Result（v1 renderer 画数值量）；DataArtifact 引用在 renderer
  层拒（v1 无 data-table 图型），留 P3 扩展。
- caption/轴标签数字守卫与报告结论区同款（attack 1 红）。
- STALE 传播补 FigureSpec（attack 4 红）。D3-closed 记录：本段即"随 P2 提交"的
  vacuous 解除声明；gates_impl 语义更替登记见 summary.md。

## D-P2.4. 结论双层守卫（禁 6 遵守）
- v1 文本守卫（legacy string conclusion）保留为兜底层；v2 structured slot
  逐字一致性 + 槽位内字面量白名单为第一层。至少一层始终生效。

## D-P2.5. 真实 provider 遵从率（known-risks #3）
- 探针脚本就位且 fake 自检 = 1.0（脚本可信）；真实 ≥20 次调用需 key——
  本批无 key 环境，真实段显式 SKIPPED（不静默 PASS，P2-6 attack 遵守）。
  **阈值义务保持**：实跑 <0.8 时必须降级该 provider+协议组合到 EXPLORATORY。
  记录将随 probe/output/ 归档（manual job 触发）。

## 作者复签（无——本批 E4 已代签，其余为偏差声明记录而非冻结裁决）

## 状态（2026-09-04）
- P2-1/P2-3/P2-4 代码+红测+权威 demo v2 全绿；P2-2 脚本就位（真调用待 key）；
  P2-5 corpus 更新 + P2-6 文档/CI 本批收口。详见 summary.md。
