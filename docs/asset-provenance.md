# 资产来源台账（Asset Provenance Ledger）

> 路线书 R0① 交付。目的：仓库内每一块"从外部搬进来"的资产，都能回答四个问题——
> **来源路径 / 取得方式 / 许可状态 / 可分发性**。正文内容一律自写，本台账只登记来源与约束。
>
> 判据：台账覆盖 `docs/asset-library/` 全部条目（按目录归组），并与 `THIRD_PARTY_NOTICES.md` 的许可声明一致。

---

## 1. `docs/asset-library/`（619 文件）— 数字资产库全量迁移（2026-09-19）

| 项 | 值 |
|---|---|
| 仓库内位置 | `docs/asset-library/`（main 分支，见 R0②） |
| 来源（REF-B） | `D:\modex\_assets_extracted`（`_mh` 资产库解包态） |
| 取得方式 | 全量镜像拷贝（用户 2026-09-19 裁决：不做选择性提交，本目录为**唯一引用点**）；迁移时逐文件 sha256 对账，漂移按 Q 支线 §5.3 协议处理 |
| 引用纪律 | ① 只搬机制，不搬产物——`_cumcm_run/workspace` 为参考运行产物快照，**只读对照、不得复制图/表/数值进 DPH 交付物**（N23）；② 源库变更以本清单 sha256 为准 |
| 许可总声明 | `docs/asset-library/THIRD_PARTY_NOTICES.md`（v2 文本，R0② 更新为 v3 现状标注） |
| 可分发性 | **混合**——见下方分组表；整体上"公开发布前需逐族筛查"（模板商标面、per-template 溯源为开放项） |

### 1.1 目录归组（619 文件）

| 组 | 文件数 | 内容 | 许可/出处 | 可分发性 |
|---|---|---|---|---|
| `skills/` | 317 | 90 个技能（`comp-*` 阶段审查、`paper-figure*`、`format-profile`、`docx-format-check`、`comp-modeling` 等） | 上游技能谱系经自研改造（`humanities-*` 为 MIT，见 notices §3）；含 `shared-scripts/`（64 项确定性检查脚本，**等价物可自建**） | 通用资产可分发；引用其"功能规格"而非文本 |
| `_repos/` | 160 | 上游开源仓库快照（校准/参考） | 各上游开源许可（README 记录） | 保留快照；使用遵守各上游许可 |
| `assets/` | 35 | palette-previews ×14 / style-previews ×6 等 | 通用视觉资产（与题目无关） | 可分发（与题目无关的通用资产） |
| `_ieee_calibinfo/` | 31 | IEEE 校准信息 | 公开资料 | 仅作参考 |
| `_cumcm_run/` | 29 | 参考工作流运行产物快照（含 `manifest.json` 3MB、`workspace/` 快照） | **运行产物，只读对照（N23）** | **不复制进交付物** |
| `tools/` | 21 | 工具脚本 | 自研/上游改造 | 可分发 |
| `templates/` | 9 | 竞赛论文 LaTeX 模板族（`mcmthesis.cls` 等） | **LPPL**（`mcmthesis` 上游）+ 各竞赛 flavor；per-template 溯源为**开放项**（notices §4） | 可合法使用与分发，须遵守 LPPL 许可；**竞赛品牌目录（`huawei/` 等）的商标面公开发布前需筛查** |
| `prompts/` | 8 | 提示词资产 | 自研 | 可分发 |
| `katex-assets/` | 3 | KaTeX 内嵌 css/js | **MIT** | 可分发（附版权与许可声明） |
| `(root)` | 6 | README / THIRD_PARTY_NOTICES / 迁移清单 | — | — |

## 2. `docs/figure-reference/`（47 文件）— 图形层参考资产（W9 迁移，2026-09-19）

| 项 | 值 |
|---|---|
| 来源（REF-B） | `D:\modex\_assets_extracted`（同一解包态） |
| 取得方式 | 选择性镜像（W9 任务书 §0.6 引用纪律：任务书引用资产必须给绝对路径；本目录为图形层**唯一引用点**） |
| 内容 | `palette-previews/`(29) `style-previews/`(6) `skills/`(10) `prompts/`(1) + README |
| 许可 | 配色/风格预览 = **通用资产**（与题目无关）；skills 同 asset-library 谱系 |
| 可分发性 | 通用资产可分发；技能部分遵守上游 MIT/LPPL 族 |
| 现状 | W9 已迁；后续以 `docs/asset-library/` 为唯一引用点（asset-library README 声明） |

> 两棵树的**重复性**：`docs/figure-reference/` 是 W9 的早期迁移（先于全量迁移），其子集（palette/style 预览、部分 skills/prompts）在 `docs/asset-library/` 中亦有。以 `docs/asset-library/` 为准；figure-reference 保留以防 W9 引用点漂移，**新引用一律指向 asset-library**。

## 3. `bench/quality/cumcm-2026-A/` — 质量闸参照基线与真实题面

| 项 | 值 |
|---|---|
| 仓库内位置 | `bench/quality/cumcm-2026-A/`（capability-library.json / form-contract.json / problem-faithful.md / reference-verdicts/） |
| 来源 | REF-C/REF-D 世界（桌面 CUMCM 正版运行 + 2026-A 题面）；`reference-verdicts/` 的 4 个 JSON 即 `bench/reference/` 清单中工作区根目录同名文件的**仓库内副本**，其 `_meta.source_files` 携带 sha256 与核验记录 |
| 取得方式 | 从正版运行产物提取作**裁判基准**（sha256 在档）；题面数值逐字抄录 OCR 原文 + 400 DPI 栅格化独立核验（见 `PROBLEM_FACTS.json` `_meta.verification_notes`） |
| 许可/分发性 | 题面与运行产物受**竞赛材料传播限制**（R0 遗留确认项）；仓库内只存**机器可读提取物**（判据/阈值/哈希），不存 PDF/正文 |
| 作用 | W10-MQUAL 五闸的黄金语料（4 类退化必须被识别） |

## 4. `bench/reference/cumcm-2026-A/manifest.json` — REF-D 外部参照基线（R0③）

| 项 | 值 |
|---|---|
| 内容 | REF-D 完整工作区**结构清单 + sha256 + 字节 + 类别**（255 文件 / 49.8MB，2026-09-21 生成） |
| 来源 | `C:\Users\35702\Desktop\CUMCM\workspaces\5ba6e7bd5010`（正版运行终点样本） |
| 纪律 | **只入结构清单 + sha256，不入正文**；`.git` 内部对象不入清单 |
| 用途 | 终点判据 D1–D12 的对照物；漂移检测基线 |

## 5. 自产资产（无外部来源，记录备查）

| 位置 | 内容 | 说明 |
|---|---|---|
| `artifacts/handoff/`（W10-MQUAL / W11.5 / R0） | 每轮报告、真实运行归档（run-report/attempts/console/report.md）、诊断脚本 | **自研运行产物**，无第三方许可负担；引用纪律：归档为证据，不复制其图/表/数值进交付物 |
| `artifacts/handoff/neizero/` | 第零次内测交付物（数字核对样本） | 自产；作为真实错误样本仅用于测试断言 |
| `bench/`（MANIFEST.json / TRUTH-FAMILIES.json 等） | M-Bench 预注册题集 | 自产（12 题预注册）；题面来自公开竞赛，传播限制见 §3 |
| `docs/`（其余） | 工程文档 / 路线书答复 | 自产 |

---

## 对账状态

- [x] `docs/asset-library/` 分组覆盖（619 文件按 10 组归组，§1.1）
- [x] 许可声明与仓库事实对齐（R0②：notices 更新为 v3 现状——库在 main 的 `docs/asset-library/`，`digital-assets` 分支为 v2 旧树已废弃标注）
- [ ] **竞赛材料传播限制**（REF-C 题面/运行产物）：R0 遗留确认项，单独一条
- [ ] per-template 溯源（`templates/` 每个 `.cls` 的上游/许可逐条记录）、竞赛品牌商标面筛查：notices §4 开放项，分发前关闭