# DPH 功能实现矩阵（2026-10-27 全量梳理）

> **状态图例**：✅ 已实现且验证（真实运行/测试证据）｜🟡 已实现但有挂账问题（编号→DESIGN-DEBTS）｜
> 🟠 机制已建、未经真实运行验证（13 阶段链 4–13 段的共同处境：2024B 卡在阶段 3）｜❌ 未实现｜📋 路线图。
> 证据锚点为代码/产物路径；"验证"指哪种证据（测试钉/真实运行）逐条注明。
> **总览**：工程底盘（执行取证/门禁/审计/CI）最扎实；论文产品链"骨架全通、血肉未验"；
> 三个完全空白 = 去AI味、引用真实性、PNG 位图后端。TOP-GOAL 三判据 0.5/3（详见 §J）。

## A. 题目摄入与路由

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| PDF 题面摄入（pypdf） | ✅ | 2024B 真实运行走通 stage 0→1 |
| xlsx 数据附件 + 描述 profile | ✅ | `apps/paper-shell/tests/bundle.spec.ts` 钉住；2024B 实跑 |
| 题面守卫（大小/来源/预算前置） | ✅ | `readProblemFile` 守卫族 |
| 方法族路由 F1–F4（契约域外零 token 拒） | ✅ | `registry.ts` + 路由守卫；真实题面已路由 |
| PDF 视觉版式理解（图/公式还原） | ❌ | 纯文本提取，版式信息丢失 |

## B. 规划与建模

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| prob-analysis 阶段（逐问分析+守恒检查） | ✅ | 2024B 阶段 1 过审 |
| modeling 阶段（建模报告 + DECLARATION） | 🟠 | **当前最前线**：卡在门禁假阳性与代码收敛（STAGE-3） |
| 建模质量五闸（退化清单/阈值引擎/边界渲染） | ✅ | W10-MQUAL 落地 + golden corpus；真实运行级无假绿回归已确认 |
| 五闸探针执行器 B1–B7 / CE-1/2 / F3/F4 阈值库 | ❌ | W10 遗留（MQUAL-遗留） |

## C. 代码执行与数字通道（承重核心）

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| 代码分片生成 + 语法验证-重问循环 | 🟠 | 2024B 卡在 stage 3（`2d3981dc47` 刚升级修复回路） |
| 本地有界执行（超时/预算硬顶） | ✅ | `execution/runner.ts`，真实运行过 |
| ExecutionRecord 捕获（sha256 取证）+ 字节级 replay 复算 | ✅ | `capture-replay` 测试钉住（RT-X 红队套件） |
| 独立执行审计（生产者≠审计者） | ✅ | `execution/audit.ts` |
| 数字零通道铸造（code→jsonPath→Result） | ✅ | 项目存在理由（红线 N20），红队攻击 0 绕过 |
| 代码 provenance 守卫（6 包覆盖） | ✅ | `apps/paper-shell/src/code-provenance.ts` |
| 冒烟失败定向修复（traceback→单文件→重跑） | ✅ | `smoke-repair.spec.ts` 行为钉 |
| 模型代码 property-based 测试 / 量纲检查 | ❌ | 见 LEAN-ASSESSMENT §7 中间路径 a/b |

## D. 图表

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| figure-declare 声明阶段 + 渲染（_figbase 配方库） | ✅ | 2024B 真实 14 图、9 图型 |
| 文字溢出渲染层修复 | 🟡 | 已修（2026-09-28），待重跑逐张目视复核（P1） |
| 确定性 SVG/TikZ 铸图（冻结于 IR） | ✅ | `figure/` 8 模块 |
| 架构图引擎（分层布局 + C4 六机制） | 🟡 | 引擎 ✅；C4-6 对齐自检未进 CI |
| 流程图 diagram-render | 🟠 | stage 7 机制，未真实跑到 |
| PNG 位图后端 | ❌ | M1-3 未开工（docx 嵌图依赖 cairosvg 本地装） |

## E. 论文生成与格式链

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| paper 骨架 + 10 章节报告渲染 | 🟠 | 机制 ✅（E1 直通版真实产出过）；E2 全链段未跑到 |
| improve 改进循环（双终止条件 + 逐轮快照） | 🟠 | **机制已进 registry**（`id:'improve'`，`improve_terminated` 门）——旧交接说"G5 不存在"已过时；未真实跑过 |
| format-profile / format-check（五类自检，非阻塞） | 🟠 | registry 已定义；未真实跑到 |
| docx 导出（md→docx + LaTeX→OMML） | 🟠 | 导出器 ✅（64903 字节验证）；作为链段未跑到 |
| PDF 导出 | ✅ | preflight-r8 产物含 paper.pdf |
| 去 AI 味（15 类格式检查 + 改写） | ❌ | G4，内测 1/5；路线图 W12 |

## F. 评审与验证

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| review 阶段（COMP_REVIEW + ROLLBACK 拦截） | ✅ | 2024B 实战抓出 4 条致命建模缺陷并拦下阶段 9 |
| 九门交付门禁电池 + 四档交付语义 | ✅ | `delivery/` 37 模块；预算耗尽=ESCALATE |
| 语义指纹三通道复验（L4） | ✅ | `verification/semantic-fingerprint.ts` |
| 符号通道（sympy，v7） | 🟡 | `v7-sympy.ts` 在库；接链深度待核实（见 LEAN-ASSESSMENT） |
| 三视角对抗评审（L5） | 🟡 | 已实现；价值待 E2 后测量（8.1③ 诚实结论） |
| v5-adversarial 接链（G6） | ❌→🟠 | 设计在库未接链；路线图 W13 |
| 引用真实性校验（claim→source 对齐） | ❌ | 现有 references 门只查格式/存在性地板；**对照调研确认的真实缺口** |

## G. 分层与探针

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| T1/T2/T3 协议 + 模型面白名单（F-A） | ✅ | W1–W6 全落地；红队 0 绕过 |
| 能力探针 + 组合注册表 + 统计资格门 | ✅ | 双模型族 14/14 QUALIFIED（LCB₉₅=0.807） |
| T3.5 扩展-择优 | ✅（诚实负结果） | McNemar p=0.0156 未过门，已如实归档 |
| 失败五分类 + 引导重试（D1 裁决） | ✅ | `executor.ts:1173-1191` |
| 阶段回滚（--stage-rollback） | ✅ | 2024B ROLLBACK 语义实战 |

## H. 驾驶舱与产品面

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| 上传/运行/SSE 流/取消/报告预览/误杀档案 | ✅ | F1–F9 全修 + O1 取消落地 |
| 凭据 profile（DPH_HOME 隔离）+ 定价表成本显示 | ✅ | 治理轮迁移 + `pricing.usd.json` |
| 按 runKey 隔离输出目录 | ❌ | O2 open（BLOCKED 运行显示上次报告） |
| 后台标签陈旧标记 / 术语全中文化 | ❌ | O4/O5 低优 |
| 零配置入口（W14） | ❌ | setup/start.bat 已有，"大众档零配置"未做 |

## I. 平台与工程底盘

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| storage-domain 5 版本化域 + fail-loud replay | ✅ | 序列缺口即崩 |
| 审计轨（追加序+脱敏）+ 签名技能/发布 | ✅ | Ed25519 + trust root |
| 产品 CI（paper-harness.yml）+ 40+ verify 门禁 | ✅ | push main 主门禁 |
| verify-no-secrets + pre-push 双门禁 | ✅ | 治理轮新增，typecheck 静默跳过事故已修 |
| runs/ 运行产物体系 + .env profile | ✅ | 治理轮新增 |
| 打包交付（portable/exe） | 🟡 | 可重建；VM 回归清单未全跑 |
| 遗留数据迁移（dry-run/幂等） | ✅ | `legacy.ts`+`migration.ts` |

## J. TOP-GOAL 终判据（仪表盘的仪表盘）

| 判据 | 状态 | 现状 |
|---|---|---|
| G-直出-1：2024A 一跑 DELIVERED | ❌ | 快照期 4/4 BLOCKED；当前 2024B 卡 stage 3 |
| G-直出-2：任意新 B/C/E 题 | ❌ | 依赖 G-直出-1 |
| G-直出-3：过程可见/可取消/成本可见 | 🟡 | 驾驶舱侧大半已修，待真实运行全链验证 |
| 内测九维 | 22/45 | 三个 0/5：入口/去AI味/改进循环 |
| MVP-1~5 | 1✅ 2✅ 3⚠️ 4⚠️ 5✅(修后待复测) | 成本恒 0 已修（E5/O3 落地） |

## K. 路线图（预计实现，按依赖排序）

1. **阶段 3 收敛 + 门禁假阳性清零**（STAGE-3/GATE-FP——当前战役，解锁 4–13 段的真实验证）
2. P0 建模缺陷甲路线复核重跑
3. W11 格式链真实化（format-profile/check 跑通）→ W12 去 AI 味 + 改进循环验证 → W13 对抗复核接链 → W14 零配置入口 → W15 内测验收
4. 小修组：O2 运行隔离、E4 空交付 fail-fast、C4-6 进 CI、PNG 后端（M1-3）
5. 远期（调研触发，见 ECOSYSTEM-SURVEY）：引用真实性门禁、property-based 测试通道
