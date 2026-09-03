# TASK-P2 — known-risks（P1 清单重审 + P2 新增残余风险）

> 纪律 A1：红字在册 > 假绿。逐项重审 P1 清单，如实关闭/降级/保留。

## P1 清单重审

1. **executor 未内嵌 code-run/interpretation → 关闭**（P2-1 内嵌，executor-
   authoritative.spec 4 绿；残留点见下方 #P2-1）。
3. **真实 provider 遵从率未采 → 部分关闭**：探针就位、fake 自检 1.0；真实 ≥20
   次调用待 key（manual job）。义务保留：<0.8 必须降级 EXPLORATORY（D-P2.5）。
6. **结论守卫保守（纯文本）→ 降级**：P2-4 结构化槽位成为第一层，文本守卫降兜底；
   合法"方法性数字误入 conclusion"仍被拒的保守面收窄但未清零（写 conclusion 只引结果值）。
7. **figure vacuous → 关闭**（P2-3 真校验；D3-closed 见 decision-log）。
其余（4 A7 对应缺口、5 无容差、2 firewall code-run 未并入、8/9 平台纪律）沿用 P1 在册。

## P2 新增残余风险

- **P2-1**：executor 整链以 strict/fast 表达"FORMAL 门集"（RunMode 无 formal，
  D-P2.1）；模型 EXECUTE 的 instruction 未内置容器协议教学（fake/真实均靠系统/
  外部 prompt 引导），真实遵从依赖探针实测——protocol prompt 工程留 P3。
- **P2-2**：SVG 渲染器不支持位图/字体布局（矢量文本由查看器渲染）；DF 图形
  扩展（data-table、多序列 x 轴）留 P3。
- **P2-3**：figure 门只比较"当前 store 重推导哈希 vs 声明哈希"；Result 未更新而
  FigureSpec 声明的 data_refs 集合与渲染图不一一（同值多图）不被 v1 区分（计数域
  同 A7 缺口，P3 语义核对）。
- **P2-4**：结论槽位 require 值逐字出现在 claim text——表达自由度受限（可改
  "0.731 m（±0.012）"仅当 uncertainty_refs 绑定）；合法改述需显式 quantity_refs。
- **P2-5**：demo-v2 与 CI 在 Linux/无 headless 差异面未覆盖（本机 Windows 验证）；
  CI Linux 真跑为准。
