# bench/quality/cumcm-2026-A — 建模质量回归基准（M-QUAL 阶段 D）

> **地位**：把 2026-A（药材烘干，F1 机理/连续族）从"一次性实测"变成"每次回归的
> 标尺"。**不是** `bench/MANIFEST.json` 的第 13 道赛题——那份清单是**冻结的 12 题
> 预注册**（premise 见 MANIFEST.json），2026-A 是**质量回归语料**而非可跑题，故放在
> `bench/quality/` 而非 `bench/problems/`。M-QUAL 方案原文写的是
> `bench/problems/cumcm-2026-A/`，此处为遵守冻结纪律所作的**显式偏差**，不改 MANIFEST。

## 语料内容与冻结口径

| 项 | 值 |
|---|---|
| 冻结时间 | 2026-09-19 |
| 内容性质 | **机器可读的判据/阈值/形态清单**（JSON + 忠实题面摘录），不含任何外部正文或图片 |
| 完整性口径 | `capability-library.json` / `form-contract.json` 由回归测试直接读取并断言（见 `tests/quality/cumcm-2026-a.spec.ts`、`tests/delivery/delivery-form.spec.ts`） |

> **2026-09-22 撤回**：`reference-verdicts/`（4 份外部判定文件的逐字副本）**已删除**。
> 撤回理由：它们不是本仓库的作品，且**没有任何消费者**——回归测试读的是
> `capability-library.json` / `form-contract.json`（本仓库自行提取的结构化阈值），
> 不需要那份原始副本。留着一份来源未闭合的副本本身就是风险，删掉它不影响任何断言。
> 相关文档里原先指向这些文件的"出处"引用，改为指向本目录内自产的结构化语料。

> **为什么存 JSON 而不存原稿**：本目录服务于"阈值引擎能否复现四类退化"这一机械问题，
> 只需要数值与形态，不需要论文正文。存机器可读提取物既够用，也不引入任何传播面。

## 文件

| 文件 | 内容 | 服务于 |
|---|---|---|
| `capability-library.json` | F1 族 11 条 machine 能力的结构化阈值库（DPH `CapabilitySpec` 形态；F1-1..F1-11 退化映射） | 阶段 B：能力判定闸 + 阈值引擎的回归输入 |
| `form-contract.json` | 模板契约 + 三份形态清单（bad_delivered / names_fixed_time_string / corrected） | 阶段 C：E-5 交付形态闸的回归输入 |
| `problem-faithful.md` | 题面忠实摘录（几何/初值/物性/环境/判据的机械事实） | 阈值出处可追溯 |

## golden 期望（回归测试断言的机械结论）

1. **能力阈值库**：11 条全部通过 `capabilitySpecSchema`；绑定到构造 store 后
   合格 Result 全部 PASS。
2. **四类退化全部 raise**（负对照，M-QUAL H-B/H-C）：
   - N 不足：`state_len=60` → `CAP-2026A-DISTRIBUTED` violation（GE 101）
   - dt 超稳定限：`stability_margin=0.886` → `CAP-2026A-STABILITY` violation（GE 1）
   - 越界：`max_C=2.552` → `CAP-2026A-BOUND-C` violation（LE 2.55，**基准实测值 2.5520**）
   - 校核/交付配置错配：校核 run `dt=0.25` vs 交付 run `dt=1.0` → `config_mismatch`
     （**F1 major 的机械复现**；同一 store 修正为 dt=0.25 后零发现）
3. **E-5 交付形态**：`bad_delivered` → 表头名两处 mismatch（A1 丢失 + '0.0cm'
   后缀）；`names_fixed_time_string` → 时间列类型 mismatch（int→string，即
   "时间列写成 '1s'"）；`corrected` → 零发现。
4. **C-2 声明↔实际**：JSON 记 `dt=0.5` 而模型声明 `dt=0.2` →
   `config_declared_actual_mismatch`（minor `[P-08][4]` 的机械复现）。

## 诚实边界

- 三项不可判（物性经验公式正确性、肉内无实测、仿射假设物理真伪）在本基准中
  **保持不可判**：它们由 `capability-library.json` 的 `boundary_refs`（L-2/L-3/L-4）
  登记，不由阈值冒充。
- 阈值 subject 是**代码发射的聚合标量**——"发射的标量是否真的聚合自全场"
  属同源边界（P-3/P-6 探针在 E2E 期补偿），本基准不声称消除。
- `bench/MANIFEST.json` 的 12 题预注册不受影响；本目录不参与 family 真值
  统计，只服务质量闸的回归。
