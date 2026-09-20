# R0-REPORT — 台账与基线冻结

> 路线书 R0 批次（R0① ② ③ ④ ⑤）交付报告，2026-09-21。
> 纪律：每批一个逻辑单元、有门、有反例、可回滚、不推红 CI。

---

## R0① 资产来源台账 — ✅ 完成

`docs/asset-provenance.md`：覆盖 `docs/asset-library/` 全部 619 文件（10 组归组表）+ `docs/figure-reference/`(47) + `bench/quality/cumcm-2026-A/` + `bench/reference/` + 自产资产段。每项含来源路径/取得方式/许可状态/可分发性。**判据达成**：台账分覆盖 + 与 notices 许可声明一致（R0② 同步更新）。

开放项（诚实记账，不假装关闭）：
- 竞赛材料传播限制（REF-C 题面/运行产物）——R0 遗留确认项
- `templates/` per-template 溯源 + 竞赛品牌商标面筛查（notices §4 开放项，分发前关闭）

## R0② 声明与分支事实对齐 — ✅ 完成

**事实**（2026-09-19 起）：资产库在 **`main` 的 `docs/asset-library/`**（619 文件，唯一引用点）。
**声明原状**：`docs/asset-library/THIRD_PARTY_NOTICES.md` 与 `digital-assets` 分支根文件仍写 "not on main"。
**处置**：
- main 侧：`docs/asset-library/THIRD_PARTY_NOTICES.md` 升级 v3 头部（现状标注：库在 main；digital-assets = v2 旧树已废弃）+ 尾部 Last verified 2026-09-21；许可义务正文未动（KaTeX MIT / humanities MIT / 模板 LPPL + 开放项 / 字体不随附）。
- `digital-assets` 分支：根 `THIRD_PARTY_NOTICES.md` 同步标注废弃（本次批次随 main 提交后补该分支提交，见下）。
**判据**：`git ls-tree -r main --name-only | grep asset-library`（460+ 文件在 main）与 `docs/asset-library/THIRD_PARTY_NOTICES.md` 的 v3 声明一致 ✅。

## R0③ REF-D 外部参照基线 — ✅ 完成

`bench/reference/cumcm-2026-A/manifest.json`：REF-D 完整工作区结构清单 + sha256 + 字节 + 类别。**255 文件 / 49,838,748 字节**（2026-09-21 生成）。

| 类别 | 文件数 |
|---|---|
| reports | 23 |
| meta | 32 |
| scratch (`_tmp`) | 90 |
| code | 9 |
| figures | 82 |
| paper | 6 |
| data | 13 |

纪律遵守：只入结构清单 + sha256 不入正文；`.git` 对象不入清单。与 `bench/quality/cumcm-2026-A/reference-verdicts/` 的关系在 `_meta` 注明（4 个 JSON 即工作区根同名文件的仓库内副本）。

> 注：路线书 §2 引述"456 文件 / 90 MB"为 CUMCM 根整体口径；本清单按工作区（REF-D）口径 255 文件 / 49.8MB。以本清单为准。

## R0④ 决策记录 + REF-C 待挖收尾 — ✅ 完成

`docs/route-v3-decisions.md`：三个问题的答复与落点——
1. REPO 路径确认：`D:\deepseek modex\deepseek-harness` ✅
2. LaTeX 缺 `comp-review` = **遗漏**（用户裁定）→ 复核与出口解耦，`v5-adversarial` 为出口无关前置闸 ✅
3. 接受 §3.6 T0/T1/T2 推算口径（45–70min / 2.5–4h / T3 8–12h），汇报用 AI 净时长 ✅

REF-C 待挖清单：5 项中 3 项关闭（`comp-paper-zh` 疑点由裁定关闭、AUDIT 53 数字并入 P-3、aris.db 已消化）；2 项低优先保留（mh_capture 对照、workspace .git）。新登记 W11.5 实测失败形态一条：**输出预算/协议长度不匹配**（截断类，run-12）。

## R0⑤ 基线冻结 — ✅（本文件）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-21 |
| HEAD（冻结时） | `28c32975ae6`（main，已推 github dddsx3/DeepSeek-For-Paper-Harness） |
| 测试基线 | paper 域 132 文件 / **1532 测试**全绿（2026-09-21 全量 paper 作用域复跑）；全仓非 paper 包存在 worker-OOM 环境性失败（lsp/subagent-acp/sandbox 等，与本次改动无关，CI 负责全仓门） |
| 真实运行基线 | W11.5 归档 12 次（run-report ×11 已入仓 + run-7 仅 console）；W10 归档 2 次；历轮合计 25 + 12 = **37 次**（§10 口径） |
| M-Bench 预注册 | 12 题冻结于 2026-09-14（`bench/MANIFEST.json`） |
| 质量闸黄金语料 | `bench/quality/cumcm-2026-A/`（4 类退化可识别，W10-MQUAL 证明） |
| 本轮新增文件 | `docs/asset-provenance.md`、`docs/route-v3-decisions.md`、`bench/reference/cumcm-2026-A/manifest.json`、notices v3 更新 |

## 门

- [x] paper 域测试全绿（1532）
- [x] manifest.json 可解析、sha256 可复现（生成器确定性；重跑一次即对账）
- [x] 声明与分支事实一致（R0② 判据）
- [ ] 竞赛材料传播限制确认（R0 遗留，挂起）

## 反例（负对照）

- 台账"覆盖全部条目"：若有人新增 `docs/asset-library/` 顶层组而未更新 §1.1 → 台账过期（对账步骤在 R0② 判据里，后续 CI 可加守卫）。
- manifest 漂移：REF-D 工作区任何文件字节变化 → sha256 对照失败（这是"只入哈希"的意义）。

## 下一批预告（R1 交付面固化，最短路径）

R1① figures 写出接 CLI（`produce/report-renderer.ts` → `apps/paper-shell/src/cli.ts`，判据：运行后 `figures/` 非空 + report.md 图片链接在磁盘可解析，反例：引用不存在的图必须红）
R1② DELIVERABLES 契约（照搬 §1.2 schema + 通用 kind 体系，11 项逐项校验，缺项 BLOCKED）
R1③ 每图必带生成脚本（独立重跑出同图）
R1④ NR-1~4 扩到交付契约（新增 NR-5）