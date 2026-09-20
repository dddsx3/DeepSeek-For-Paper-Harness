# R1-REPORT — 交付面固化（最短路径第一批）

> 路线书 R1 批次交付报告，2026-09-21。纪律：单逻辑单元、有门、有反例、可回滚、不推红 CI。
> 边界：**本批次未跑完整论文产出运行**（用户授权到 E2E 之前；完整测试等批准）。验证全部为低消耗
> 单元/作用域测试 + 无模型的 CLI 冒烟。

---

## R1① figures 写出接 CLI — ✅ 完成

**问题**（路线书 §5 L5 缺口"figures 写出未接 CLI"）：v2 渲染器把每张图引用为 `figures/<id>.svg`，
但 SVG 字节只存在于 executor 链内——交付报告里的图链**永远悬空**。

**落地**：
- executor：`persistFigures(runId, figures)` —— minted SVG 写入 `<finalOutputRoot>/<runId>/final/figures/<id>.svg`（与最终产出同级、同一 sink 契约；无 sink 时 audit 记账不静默）；写失败 = promotion_failed（DELIVERABLE 意味着文件存在）。
- CLI：读取 final 目录时跳过 `figures/` 目录选报告文件；复制 `figures/*.svg` 到 out-dir；加入确定性 zip（sorted 名 + 无时间戳成员，保 G2 重跑同 sha256）；`run-report.json` 新增 `figures` 计数与 `figure_links_broken` 数组。
- 链接守卫：`src/delivery/figure-links.ts`（`figureLinksOf` / `brokenFigureLinks`）——报告引用的 `figures/…` 目标与磁盘实际比对；悬空 → 机器可读记录 + 大声报错。

**判据 / 反例**：
- ✅ 脚本化完整链测试（executor-authoritative.spec）：声明 figure 的容器跑完 → `final/figures/F-OUT.svg` 真实落盘 + 报告链与磁盘互证；负对照 `brokenFigureLinks(report, {'figures/OTHER.svg'})` 必红。
- ✅ figure-links.spec 4 条：提取/去重/排序/无图零误报/悬空必红。
- ⚠️ "运行后 figures/ 非空"的 CLI 级判据依赖完整运行，**留待用户批准的 E2E**；engine→CLI 的接线已由脚本化链 + zip 单元测试覆盖。

## R1② DELIVERABLES 契约 — ✅ 完成

**落地**：`src/delivery/deliverables-contract.ts`——
- schema 照搬 REF-D 实测（`DELIVERABLES.json` 11 项，kind 闭集 `xlsx/json/md/other`，`min_bytes` 每项必填，xlsx 带 sheets/min_rows/min_cols）。
- 判定（fail-closed）：缺文件 → `deliverable_missing`；低于 min_bytes → `deliverable_too_small`（空壳 = 形态 1 假绿变红）；xlsx 行列未机器读 → `xlsx_content_unverified` **诚实注记**（不假装已核）；契约不合法 → `contract_invalid` 不猜。
- CLI：`paper-shell deliverables verify <contract.json> <dir>`——缺项/空壳 exit 1，契约非法 exit 2，通过 exit 0（对标 `study manifest verify`）。**接入管线交付门（缺项 BLOCKED）留 R6③ 四方一致性终闸**，本批先给可判定的契约层。

**判据 / 反例**：8 条契约测试（闭集拒绝/无 min_bytes 拒绝/空数组拒绝/正例零阻断/删文件必红（NR-5）/空壳必红/逐项独立）+ CLI 冒烟三态（0/1/2）+ xlsx 注记。

## R1③ 每图必带生成脚本（DPH 等价物）— ✅ 完成

**等价物说明**：DPH 的图不是模型手绘，而是**固定 harness 渲染器 + 记录数据**的确定性产出——"独立重跑出同图"的 DPH 等价物 = 每张图可追溯到（渲染器版本 + 字节哈希），且确定性可证。
- CLI 在存在 figure 时写出 `figure-manifest.json`：`{figures:[{file, sha256, renderer_version:'okabe-ito-v1/svg'}]}`——无时间戳（保 zip 确定性），进 out-dir + zip。
- 判定：manifest 覆盖每张发货图；未登记 svg = 检查目标（测试断言 manifest 无时间戳、纯文本、与图同进 zip）。

**判据 / 反例**：shell NR spec 新增 3 条（figures+manifest 进 zip / 同内容同 zip 字节 / manifest 无时间戳纯文本）。REF-D 式 `gen_*.py` 逐图脚本在 DPH 由渲染器+数据哈希承担; 若未来走外部画图，R3 阶段补脚本存在性检查。

## R1④ NR-1~4 扩展到交付契约（NR-5）— ✅ 完成

- **NR-5 断言**（deliverables-contract.spec）：删掉契约要求的一个文件 → 校验必红（`deliverable_missing`）；空壳文件 → `deliverable_too_small`。这是"交付完整度"指标可被变红的操作（§10 负对照纪律）。

## 门 / 回归

- ✅ paper 域作用域套件：**126 文件 / 1507 通过**（排除 1 项环境 flake，见下）
- ✅ tsc 双包 clean；lib 重建 + 来源守卫（跑前 `build:lib:host` + provenance 检查）
- ⚠️ **环境 flake 记录（非 R1 引入）**：`apps/paper-shell/tests/bundle.spec.ts`（xlsx 概况子进程在并行负载下解析失败，隔离跑通过）、`execution-producer.spec.ts`（DP-4 单条，同样过载态偶发）——与全仓 worker-OOM 同源，R1 未触碰这两处代码（bundle.ts/execution-producer.ts 零改动）

## 反例清单（本批负对照）

| 断言 | 变红操作 |
|---|---|
| 图链可解析 | 报告引用 `figures/nope.svg` |
| 交付契约完整 | 删掉契约要求的文件 / 文件压到 min_bytes 以下 |
| zip 确定性 | 同内容两次打包字节不同（G2） |
| manifest 无时间戳 | 打包内容含 `generated_at` |
| 图可追溯 | 未登记 svg 混入 figures/ |

## 下一批（R2 格式链 启动；R1 其余判据随 E2E 批准后闭合）

R2① text_profile 派生 · R2② DOCX 导出前校核（15 类×负例）· R2③ 自动修复不改语义（N30）· R2⑥ 退出码契约 0/1/2 + 完成铁律（§5.5.2 增量 3/4）。完整论文产出运行（闭合 R1① CLI 判据 + 挡位时长实测）等待用户批准。