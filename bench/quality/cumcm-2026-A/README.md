# bench/quality/cumcm-2026-A — 建模质量回归基准（M-QUAL 阶段 D）

> **地位**：把参考工作流 2026-A（药材烘干，F1 机理/连续）从"一次性实测"变成
> "每次回归的标尺"。**不是** `bench/MANIFEST.json` 的第 13 道赛题——那份
> 清单是**冻结的 12 题预注册**（premise 见 MANIFEST.json），2026-A 是参考
> 资产而非可跑题，故放在 `bench/quality/`（质量回归基准）而非
> `bench/problems/`。M-QUAL 方案原文写的是 `bench/problems/cumcm-2026-A/`，
> 此处为遵守冻结纪律所作的**显式偏差**，不改 MANIFEST。

## 出处与完整性

| 项 | 值 |
|---|---|
| 参考工作区 | `C:\Users\35702\Desktop\CUMCM\workspaces\5ba6e7bd5010`（2026-A 完整实测产物，工作流基线 c8fcffd37f） |
| 归档时间 | 2026-09-19 |
| 完整性对账 | 四份判定 JSON 的 sha256 前 16 位与 `docs/quality/QUALITY-MECHANISM-SPEC.md` §5 的对账值**逐位一致**（14/14 未修改结论的子集）：CAPABILITY_VERDICT `d405c9213ea6bb7e`、COMP_REVIEW_VERDICT `a6fefe0415d6de97`、DATA_FACTS `bcac23bc92a15408`、PROBLEM_FACTS `6fc53139e8a599ef` |

## 文件

| 文件 | 内容 | 服务于 |
|---|---|---|
| `reference-verdicts/*.json` | 参考工作流的判定原文件（逐字归档） | 判定期望的真值出处 |
| `capability-library.json` | F1 族 11 条 machine 能力的结构化阈值库（DPH `CapabilitySpec` 形态；F1-1..F1-11 退化映射） | 阶段 B：能力判定闸 + 阈值引擎的回归输入 |
| `form-contract.json` | 模板契约 + 三份形态清单（bad_delivered / names_fixed_time_string / corrected） | 阶段 C：E-5 交付形态闸的回归输入 |
| `problem-faithful.md` | 题面忠实摘录（几何/初值/物性/环境/判据的机械事实） | 阈值出处可追溯 |

## golden 期望（回归测试断言的机械结论）

1. **能力阈值库**：11 条全部通过 `capabilitySpecSchema`；绑定到构造 store 后
   合格 Result 全部 PASS。
2. **四类退化全部 raise**（负对照，M-QUAL H-B/H-C）：
   - N 不足：`state_len=60` → `CAP-2026A-DISTRIBUTED` violation（GE 101）
   - dt 超稳定限：`stability_margin=0.886` → `CAP-2026A-STABILITY` violation（GE 1）
   - 越界：`max_C=2.552` → `CAP-2026A-BOUND-C` violation（LE 2.55，**参考实测值 2.5520**）
   - 校核/交付配置错配：校核 run `dt=0.25` vs 交付 run `dt=1.0` → `config_mismatch`
     （**参考 F1 major 的机械复现**；同一 store 修正为 dt=0.25 后零发现）
3. **E-5 交付形态**：`bad_delivered` → 表头名两处 mismatch（A1 丢失 + '0.0cm'
   后缀）；`names_fixed_time_string` → 时间列类型 mismatch（int→string，即
   "时间列写成 '1s'"）；`corrected` → 零发现。
4. **C-2 声明↔实际**：JSON 记 `dt=0.5` 而模型声明 `dt=0.2` →
   `config_declared_actual_mismatch`（参考 minor `[P-08][4]` 的机械复现）。

## 诚实边界

- 参考工作流的 `review_limits` 承认的三项不可判（物性经验公式正确性、肉内
  无实测、仿射假设物理真伪）在本基准中**保持不可判**：它们由
  `capability-library.json` 的 `boundary_refs`（L-2/L-3/L-4）登记，不由阈值
  冒充。
- 阈值 subject 是**代码发射的聚合标量**——"发射的标量是否真的聚合自全场"
  属同源边界（P-3/P-6 探针在 E2E 期补偿），本基准不声称消除。
- `bench/MANIFEST.json` 的 12 题预注册不受影响；本目录不参与 family 真值
  统计，只服务质量闸的回归。
