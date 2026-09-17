# DPH-Q 支线规格文档索引

> **支线定位**：DPH-Q —— **质量识别的机械化**。独立于主线（W8.9 修"接收层"），专攻"量化有困难的关键点"。
> **基线**：DPH `8915028361`（W8.8）　**编制**：2026-09-17
> **本轮性质**：**只出规格，不改 DPH 主链代码**（§1.3 / N5）。全部产物是**规格与检查清单**。
> **入口**：[`QUALITY-MECHANISM-SPEC.md`](QUALITY-MECHANISM-SPEC.md)（Q1-D1，主规格文档）

---

## 一句话

**不要试图判断"建模好不好"——要枚举"这类题最典型的退化方式"，然后为每一种写一个能把它抓出来的机械检查。质量识别 = 退化检测。**

---

## 产物清单（按阅读顺序）

### 第一层：机制总纲

| 文档 | 内容 | 对应条例 |
|---|---|---|
| [**QUALITY-MECHANISM-SPEC.md**](QUALITY-MECHANISM-SPEC.md) | **主规格**：机制四步、3 个新 IR 对象 + 4 处扩展、12 处接缝、首批需改动文件清单（8 新增 / 12 修改 / 5 测试，**不实施**）、H1–H8 对账、§7 预登记逐条对账、给主线的 8 个决策点 | Q1-D1 |

### 第二层：四项机制构件

| 文档 | 内容 | 对应条例 |
|---|---|---|
| [FAMILY-DEGRADATION-LISTS.md](FAMILY-DEGRADATION-LISTS.md) | **退化枚举底座**：F1（11 条，含 `[P-01]` 原文五条）／F3（9 条）／F4（10 条）／跨族（6 条）。三族边界与"为何不违反 N2"的自检 | Q1-A2 |
| [PROBE-TYPOLOGY.md](PROBE-TYPOLOGY.md) | **探针类型学**：10 类（含构造方法 / 预期信号 / 失败信号 / 可复现性）、四轴分类、**两处空位识别**、构造规范骨架 | Q1-A3 |
| [CAPABILITY-SCHEMA.md](CAPABILITY-SCHEMA.md) | **能力清单 schema**：14 字段（逐字段改动理由）、zod 定义、注册进既有表的 7 个必改点、一个填好的实例、**三处转换损失点** | Q1-B1 |
| [HONESTY-BOUNDARY-CLASSES.md](HONESTY-BOUNDARY-CLASSES.md) | **诚实边界四类 + 一条补充**（L-1 / **L-1b** / L-2 / L-3 / L-4）：每类的"必须声明的句式" + 机械检查 + **DPH 覆盖状态**（2 未覆盖 / 3 部分覆盖）。**L-1b 是防“声明退化为免责”的必需补充**，有材料侧实测支撑 | Q1-A4 |

### 第三层：与 DPH 的接缝规格

| 文档 | 内容 | 对应条例 |
|---|---|---|
| [GATE-MAPPING.md](GATE-MAPPING.md) | **检查→门映射**：已有门可覆盖 **6** / 需扩展 **9** / **新增 gate id 0**；5 个扩展点 E-1..E-5；1 处**新增检查形态** N-1；**三处"看似需新门实则不需"的否决理由** | Q1-B3 |
| [JUDGE-CRITERIA.md](JUDGE-CRITERIA.md) | **`judge` 分流三问** + 23 条逐条复核（**18/5 vs 材料 15/8**，含 3 条提升的理由与 3 条否决的理由）+ 存在性/实质分离标记 | Q1-B2 |
| [CONFIG-CONSISTENCY-CHECK.md](CONFIG-CONSISTENCY-CHECK.md) | **M5 配置一致性**：三类对象对（C-1/C-2/C-3）、六种处置（D-1..D-6，**全部自动**）、既有字段的实测评估、需新增的 `NumericConfig`、生产者机制的三个候选 | Q1-B4 |
| [LIMITS-TEMPLATE.md](LIMITS-TEMPLATE.md) | **边界模板**：四类可填充句式、组装形态、引用位置（含**一处修正**：边界须无条件生成）、`BoundaryDeclaration` schema | Q1-B5 |

### 第四层：依赖与独立性

| 文档 | 内容 | 对应条例 |
|---|---|---|
| [W8.9-DEPENDENCY.md](W8.9-DEPENDENCY.md) | **依赖声明**：3 项（E1 文本 / span 锚定 / V 层可读 E1）+ **降级路径**（实测能力边界）+ 三阶段实施顺序（**阶段 1 不依赖 W8.9**）+ **反向依赖** 4 项 | Q1-D2 |
| [REVIEW-INDEPENDENCE.md](REVIEW-INDEPENDENCE.md) | **复核独立性**：5 环节共享链拆解、3 个独立维度（I-1/I-2/I-3）、3 条机械证明（P-1/P-2/P-3）、4 个构造性反例（CE-1..CE-4）、**E1/E2 拆分不解决同源缺陷的论证** | Q1-D3 |

### 支撑产物（`artifacts/handoff/Q1/`）

| 文件 | 内容 | 对应条例 |
|---|---|---|
| [`Q1-A1-capabilities.md`](../../artifacts/handoff/Q1/Q1-A1-capabilities.md) | 23 条能力**全字段**提取（含 `judge` 分布 15/8、字段并集 9 项实测复算） | Q1-A1 |
| [`Q1-contract-machine.json`](../../artifacts/handoff/Q1/Q1-contract-machine.json) | `LOGIC_CONTRACT_MACHINE` 解析后的 JSON（12 顶层键，行 995–1242） | `[P-14]` |
| [`Q1-A5-reference-gap.md`](../../artifacts/handoff/Q1/Q1-A5-reference-gap.md) | 引用缺口登记（G-1）+ 与 DPH `fake` 基线的类比 + 本支线的自对账 | Q1-A5 |
| [`Q1-C1-2024B-capabilities.md`](../../artifacts/handoff/Q1/Q1-C1-2024B-capabilities.md) | **2024-B 独立能力清单**：16 条 / 87.5% machine / 38 条阈值 / 16 条 `source_anchor` | Q1-C1（**H5**） |
| [`q1-c2-checks.py`](../../artifacts/handoff/Q1/q1-c2-checks.py) | **5 条 machine 检查的实现 + 双向实跑驱动器** | Q1-C2（**H6**） |
| [`Q1-C2-run-record.json`](../../artifacts/handoff/Q1/Q1-C2-run-record.json) | 双向实跑运行记录（`H6_met: true`） | Q1-C2 |
| [`Q1-C3-probes-on-2024B.md`](../../artifacts/handoff/Q1/Q1-C3-probes-on-2024B.md) | 探针在 2024-B 上的可行性：6 类可移植 / 3 类受限 / 1 类不可移植 | Q1-C3 |

---

## 复现命令

```bash
# 双向实跑（H6）
cd deepseek-harness/artifacts/handoff/Q1
python q1-c2-checks.py          # 期望 exit 0，输出 "H6 达成"

# 材料指纹复核（H8）
cd "C:\Users\35702\Desktop\CUMCM\workspaces\5ba6e7bd5010"
sha256sum CAPABILITY_CHECKLIST.json | cut -c1-16    # 期望 4b4ade14aa2b1429
find . -name "*CROSS_PROBLEM_LEDGER*"               # 期望 0 命中（G-1）
```

---

## 四条必须记住的账

1. **87.5% 是标注值，不是实证值。** 被实跑证明可执行的只有 **5/16 = 31.2%**，且条件于 `M-1` 简化模型。**成立的命题是"当被要求时可写出 87.5% 标注为 machine 的检查"；不成立的命题是"F3/F4 的可机械率 = 87.5%"**——这是与 T3 同族的**度量有效性**问题（`Q1-C1` §2.2）。**单独引用 87.5% 会重演本支线反对的东西。**
2. **`semantic` 部分（2024-B 上 2 条）依赖 W8.9 的 E1 文本**——无 E1 则不可校验（`W8.9-DEPENDENCY.md` §2.1）。但 **`machine` 部分不依赖 W8.9**。
3. **`[P-11][0]` 的同源缺陷未被解决**——E1/E2 拆分只是移动了共享点。**任何声称"复核完全独立"的设计都是错的**（`REVIEW-INDEPENDENCE.md` §3）。且材料侧的共享环节**已出现可疑活动**（`[F-08]` 的"53 个数字未登记"），故仅声明共享点不够，必须给检出手段（**L-1b**）。
4. **M5 的可行性挂在 DP-4 上**——若配置抽取落为散文解析，M5 即与它自己的诊断矛盾（`QUALITY-MECHANISM-SPEC.md` §8.1）。**DP-4 → DP-2 → DP-1 是实施顺序**，不是并列决策。
