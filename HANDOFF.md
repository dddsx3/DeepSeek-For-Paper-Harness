# DPH 交接文档 —— 给下一个执行者

> **写给谁**：接手 DPH 项目继续推进的下一个 agent。
> **读法**：先读 §0 的三句话，再读 §1 的基线表，再读 §2 的"你必须知道的事"。
> 后面的章节按需查。
> **编制**：2026-09-19　**基线**：`d2dc30d9ec`（工作树干净）
> **⚠️ 2026-09-20 更新（W10-MQUAL 轮后）**：HEAD = `816b879e7e`+（建模质量五闸
> 已落地 + E2E），见 §8.1 与 `artifacts/handoff/W10-MQUAL/W10-REPORT.md`——
> 本文件其余基线数字以该报告的 §4/§8 为准（scoped 1481/1481、真实运行 27、
> 真实交付 4、G7 已落地）。

---

## §0 三句话（如果只读三句话，读这三句）

1. **DPH 是一条"模型负责想、harness 负责算和证"的流水线**——E1 让模型自由分析，E2 规范化成结构化声明，数字只能经 `code → jsonPath → Result` 回读，**散文里的数字一概不算**。
2. **25 次真实运行证明：模型（v4-flash）的建模智能是真实的，但散文算术 100% 不可信**——第零次内测逐项核验出 4 类数字错误（最严重的：交付的抽样方案接收概率只有 33.9%，不满足题目的 90% 要求）。
3. **你最大的风险不是"模型不行"，而是把 harness 侧缺陷误读成"模型能力不足"**——过去 25 次运行实测抓出 **10+ 处**此类缺陷，每一处此前都被读成"模型不行"。

---

## §1 基线（实测）

| 项 | 值 |
|---|---|
| HEAD | `d2dc30d9ec`　工作树干净 |
| 远端 | **GitHub 不可达**（代理拒绝）→ 本地为准 |
| scoped 测试 | **1405/1406**（120 文件；唯一失败 = 已对账的 xlsx 负载 flake，隔离 11/11 过） |
| 全仓测试 | 15246/15378（958 文件，68 失败——**与本轮无关**，W8.10-E1 已对账） |
| 真实运行累计 | **25 次**（W8.5×1、W8.8×6、W8.9×3、W8.10×4、W8.11×4、W8.12×3、W9.5 回归×1 等） |
| 真实交付 | **3 次**（W8.12 real-run-3 minted=54；mvp2-run-1 minted=56；W9.5 回归 E1 直通 MARKED） |
| **MVP 状态** | MVP-1 ✅ / MVP-2 ✅ / **MVP-3 零人工 ⚠️ 待复核** / **MVP-4 出图 ⚠️ 机制已建但 E1 直通路径无图** / **MVP-5 成本 ⚠️ cost_usd 恒 0** |
| **内测 MVP（九维）** | **22/45**（第零次内测评估见 `artifacts/handoff/neizero/NEIZERO-ASSESSMENT.md`） |
| tsc | 干净（`tsc -b tsconfig.host.json`） |
| 构建守卫 | `ok=true`（6 个包全覆盖，W8.11-E1 扩展） |
| 负对照 | `22 passed, 0 failed`（NC-7 真篡改-还原；已接 CI `paper-harness.yml`） |
| 资产库 | **已全量入库** `docs/asset-library/`（649 文件 29MB）+ `docs/figure-reference/`（46 文件） |
| 计划文档 | 总书/PRD 原件是会话附件未入库；仓库内忠实摘录副本 = **`docs/dph-plan-and-redlines.md`** |

---

## §2 你必须知道的事（**七类形态 + 本轮新增**）

### 七类"信号与原因不符"形态（**全部长在"开发期通过 ≠ 真实运行通过"这条缝里**）

| # | 形态 | 首现 | 一句话 |
|---|---|---|---|
| 1 | 假绿 | T3 自证 14/14 | 指标不可能变红 |
| 2 | 假红 | W8.5 | harness 限制归因给模型 |
| 3 | 构建陷阱 | W8.8 | 测试读 src、运行读 lib |
| 4 | 量具失效 | run#4 | 判定与目标无相关性 |
| 5 | 凭据卫生 | W8.9 | 工具化过程泄漏 |
| 6 | 修复只做判定侧 | W8.9 | 判定写好了、传递侧没接 |
| 7 | 指令冲突 | W8.10-D4 | 矛盾输入下生成；**同输入多次采样方差异常大** |

**第 6 类是本项目的头号杀手**——25 次运行里至少 **10 处**都是它，每一处此前都被读成"模型不行"。**第零次内测又抓到一处**（critical gate 在 grader 之前抛出）。

### §2.1 本项目的核心教训（**比任何代码都重要**）

**教训 1**：**每次真实运行后，先问"这条判定事后能否核验"，再谈模型能力。**
如果答案是不能（E1/容器没落盘、判定没带证据），你拿到的是**一个不可核验的结论**——它可能是假红也可能是假绿，你分不清。

**教训 2**：**判定条件写好了，被判定对象从未以需要的形态到达** = 形态 6。
修法永远不是"改判定"而是"让对象以正确形态到达"。实例：注册晚于 E1、prompt 自相矛盾、比较器不接受排版差异、判定不带证据。

**教训 3**：**一个只能上升或持平的指标不是指标。**
每个指标必须配负对照（已知能让它变红的操作），且**必须有 CI 调用者**——否则就是装饰。

**教训 4**：**报告里每个差值必须同时给基线出处**（哪个文件哪一行），否则它就是不可核验的（W8.9 的 `1189` 假基线教训）。

### §2.2 四处"信息不足"缺陷的修法（**都是 harness 侧，非模型侧**）

| 缺陷 | 症状 | 修法 | 关键判断 |
|---|---|---|---|
| 注册晚于 E1 | B4 结构上不可能过 | 提前注册（幂等） | 顺序缺陷，非能力问题 |
| 比较器是裸 includes | 全角/半角被报"疑似改写" | 折叠排版差异（**无阈值**——阈值会放过真改写） | 负对照 5 例证明不放真改写 |
| E1 prompt 自相矛盾 | 锚点遵从度 0/2/12 | 移除容器讲义（E2 仍收到） | **模型服从篇幅更大者** |
| 讲义缺字段形状 | parameter_refs 写成 id 列表 | 补形状+正反例 | 防漂移：用 schema 真解析讲义正例 |

---

## §3 架构速查（**现在实际跑通的流程**）

```
上传 PDF
  → 守卫前置（来源/预算）
  → 题面摄入（pypdf + openpyxl）
  → 方法族路由（F1–F4，不在契约域零 token 拒）
  → 输入资产注册（DA-RAW / R-OUT / P1）
  → E1 自由分析（prose + 锚点；全文落盘 artifact body）
  → 保真门（B3 双向 / B4 / B5 / 对齐折叠）
  → E2 规范化（checklist 含参数形状 + 引用目标；DRIFT 回灌）
  ├── E2 成功 → 生产链（code → jsonPath → Result）→ 九门 → 评审 → 骨架 → gradeDelivery
  └── E2 失败 → E1 直通交付（fail-soft）→ MARKED（findings 进附录）
       → 评审循环 → gradeDelivery

交付物：report.md（10 章节 + 附录）+ figures/*.svg（独立文件，非 base64）
       + deliverable.zip + run-report.json + audit-trail.json + artifact-bodies.json
docx：scripts/export-docx.py（A4/25mm/宋体/1.5×/黑体标题/图 PNG 嵌入）
```

### 关键文件

| 文件 | 职责 | 行数 |
|---|---|---|
| `packages/paper/paper-foundation/src/executor.ts` | 主执行器（E1/E2/fidelity/兜底/生产链） | ~2200 |
| `…/src/produce/e1-e2.ts` | E1 指令 + E2 指令 + fidelity 检查 + D3 折叠 + D5 诊断 | ~400 |
| `…/src/produce/e2-guidance.ts` | DRIFT 回灌（引用规则/已注册 id/零数字剥离） | ~200 |
| `…/src/produce/e1-direct.ts` | E1 直通渲染（骨架 slots + 假设表 + 诚实说明） | ~90 |
| `…/src/figure/renderer.ts` | 标量 + 2D 序列渲染（配方/误差棒/对数轴/类别轴） | ~430 |
| `…/src/figure/architecture.ts` | 架构图引擎（分层布局 + C4 六机制） | ~340 |
| `…/src/figure/ledger.ts` | 台账解析（CSV/JSON） | ~150 |
| `…/src/figure/quality-check.ts` | 印刷质量门（字号/越界/对比度） | ~120 |
| `…/src/figure/axis-labels.ts` | 类别轴防挤压（旋转 + 抽稀） | ~60 |
| `…/src/ir/schema.ts` | IR 九类对象 schema（`.strict()`） | ~700 |
| `…/src/ir/refs.ts` | 引用校验（null 容忍 + 复合路径） | ~400 |
| `apps/paper-shell/src/invoke.ts` | 诊断文案（`failureFactsOf` 从结构化字段生成） | ~250 |
| `apps/paper-shell/src/code-provenance.ts` | 代码来源守卫（6 包覆盖） | ~170 |
| `scripts/export-docx.py` | docx 导出（python-docx + cairosvg） | ~180 |

---

## §4 红线（**累积 N1–N34，全部有效**）

### 最容易踩的五条（**每条都对应一次真实事故**）

| # | 红线 | 为什么 |
|---|---|---|
| **N18** | 不得为通过率放宽 fidelity 判定 | B3 是"识别优秀建模"的机械落点，**是核心资产**。E1 直通不改 fidelity 门——改的是 findings 的去向 |
| **N19** | 配置类对象必须走"由 code emit"形态 | `seed` 前车之鉴：进 IR 但 runner 不消费 = 空断言 |
| **N20** | 不得为接入图表而放宽"数字必须来自 store" | 零数字通道是本项目的存在理由 |
| **N3** | 任何断言必须走真实对象（不得手传参数） | 手传参数会让"判定条件正确"掩盖"传递链断裂" |
| **N7** | 失败必须原样归档，不得因效果差不归档 | 归档是下一轮诊断的原料 |

### 完整清单

N1–N34 完整原文在《任务总书》（**会话附件，未入库**）。仓库内副本见 **`docs/dph-plan-and-redlines.md`** §4——含所有已确认原文的条目；未列出的条目开工前向用户索取原件，**不要猜**。**每条都对应一次真实事故**——不是理论安全规则，是事故的墓志铭。

---

## §5 关键设计决策（**为什么是现在这个样子**）

| 决策 | 理由 | 反证条件 |
|---|---|---|
| E1/E2 拆分（而非一次调用） | E2 把"精确记账"变成比"基础写作"更硬的门槛，弱模型恰好输在这一层。拆开后 E1 只做模型擅长的事，E2 只做规范化 | 如果 E2 成功率仍然极低 → 需重估拆分本身 |
| E1 直通交付（fail-soft 下） | fail-soft 的 MARKED 评估的是评审循环后的文本，而 E2 失败在更早的生产节点——**两者之间没有通路**。修法是给通路接线 | 如果 E1 直通稿的数字错误率 > E2 成功路径 → 需在直通稿加数字核对步 |
| fidelity 门不放宽（N18） | B3 是"识别优秀建模"的机械落点，是核心资产 | 如果 fidelity 全过但论文质量差 → 说明 B3 判据需要升级 |
| 排版折叠（D3）无阈值 | 阈值会放过真改写（LCS 0.9 的改写照样是改写） | 如果折叠后仍有排版残留 → 需扩充折叠规则 |
| E1 不提 JSON/schema | 指令冲突（形态 7）：85% 篇幅要求 JSON + 15% 要求 prose = 模型服从多数派 | 如果 E1 在纯 prose 指令下也不产锚点 → 需评估模型能力 |
| 架构图用确定性布局（方案 B） | 引入浏览器依赖太重；自研分层布局保留"自动布局"优势 | 如果布局质量不够 → 需重估（备选：无头浏览器） |
| 数字资产**全量**迁移 | 逐轮挑选会造成引用点漂移 | 无（用户已裁决） |

---

## §6 当前缺口与下一步（**按优先级排序**）

### 六个缺口的当前状态（**11 阶段规格的 G1–G7**）

| 缺口 | 状态 | 证据 |
|---|---|---|
| G1 数据图 | ✅ **机制落地 + M5 样本** | `ledger.ts` + `renderer.ts` series2d + 真实 2024-C 数据条形图 |
| G2 架构图 | ✅ **引擎落地** | `architecture.ts`（方案 B + C4 六机制） |
| G3 格式链 | ⚠️ **docx 导出已建**（`scripts/export-docx.py`）；格式 profile + 自检修复**未建** | docx 64903 字节验证通过 |
| G4 去 AI 味 | ❌ **一门都没有** | 第零次内测打 1/5 |
| G5 改进循环 | ❌ **不存在** | 第零次内测打 0/5 |
| G6 对抗复核 | ⚠️ `v5-adversarial.ts` 有设计未接链 | W8.12 §5 遗留 |
| G7 建模质量 | ✅ **已落地（W10-MQUAL，2026-09-20）**——IR 15→18 + 五闸 + golden corpus；遗留：探针执行器/CE-1·2/F3·F4 阈值库 | `artifacts/handoff/W10-MQUAL/W10-REPORT.md` |

### W10–W15 路线图（**按依赖排序**）

```
W9.5  回归收口（部分完成——回归运行已过，docx 导出已建）
  │
W10   建模质量约束 ★（G7）【✅ 2026-09-20 已落地：IR 15→18 + 配置一致性闸
  │   （DP-4 执行期捕获）+ 阈值引擎 + E-5 + 边界无条件渲染 + cumcm-2026-A
  │   golden corpus；E2E 定点探针历史首次真实模型全链 9 门 PASS/CLEAN。
  │   详见 artifacts/handoff/W10-MQUAL/W10-REPORT.md；遗留：B1–B7 探针
  │   执行器、CE-1/CE-2、F3/F4 阈值库】
  │
W11   格式链 ★（G3——稿子交不出去的最大缺口）
  │   格式 profile → Markdown 自检与修复 → docx 导出（导出器已建，自检未建）
  │
W12   去 AI 味 + 改进循环（G4 + G5）
  │   15 类格式检查 + 评审→评分→修改→快照
  │
W13   对抗复核 + 阶段审查（G6）
  │
W14   零配置入口（大众档的硬前置）
  │
W15   内测 MVP 验收（九维打分 + 留出题真测 + 真人零指导测试）
```

**关键路径**：W9.5 → W11 → W12 → W14 → W15。**W10 与 W13 在关键路径之外**。

### §6.1 全 CLI 真实运行的主阻断点仍是 E2 保真门（W10-MQUAL E2E 实测，2026-09-20）

两次真实运行（2024-B，同 real-run-3 参数）：run-2 DELIVERED/MARKED（E1 直通，
44 IR），**E2 规范化再次失败于 B3 反向（E1 假设须被声明）+ DRIFT guidance
budget exhausted**——与全部既往真实运行同构，是当前最高杠杆的修口（与 M-QUAL
正交的 receive 层缺口）。M-QUAL 质量闸在无配置 store 上正确惰性（无新增标注 =
真实运行级无假绿回归确认）。另两个已归档教训：`.env.local` 的 PAPER_PROBE_MODEL
会抢路由（单变量纪律必须命令前缀钉模型）；`PAPER_MAX_OUTPUT_TOKENS_PER_RUN`
设低于历史用量会把失败从"E1 直通交付"改道成"预算 BLOCKED"（HANDOFF §7.5 的
形态实录）。详见 `artifacts/handoff/W10-MQUAL/W10-REPORT.md` §8。

### 已完成但仍需收口的事项

| 事项 | 状态 | 缺口 |
|---|---|---|
| W8.11-E2 负对照 | ✅ NC-2/NC-7/CI 全修 | 无 |
| W8.11-E3 `1189` 假基线 | ✅ 已查清（反推） | 无 |
| W9 架构图 C 组 C4 | ✅ 六机制落地 | **C4-6 的对齐自检未在 CI 中运行**（需加步骤） |
| W9 报告渲染器 | ✅ base64→独立文件 | **figure 文件写出逻辑未接入 CLI**（实测：`cli.ts` 只写 report.md/sha256/run-report.json/deliverable.zip，**没有任何生产路径写出 report.md 所链接的 `figures/*.svg`**——真实运行 outDir 的 figures/ 是空的） |
| W11-A3 docx 导出 | ✅ 基本可用 | LaTeX 公式以纯文本呈现（未转 OMML）；SVG→PNG 依赖 cairosvg（已装但非 repo 依赖） |
| **第零次内测** | ✅ 九维 22/45 | **三件 0/5 的缺口**（入口/去 AI 味/改进循环）待后续轮次 |

---

## §7 陷阱与坑（**每条都花了一次真实运行才发现的**）

### 7.1 测试与运行的不同源（形态 3）

- **测试读 `src`**（vitest tsconfig paths），**真实运行读 `lib/`**（包 exports）。改了 src 不重建 lib → 真实运行跑旧代码。守卫已建（6 包覆盖），**但如果守卫 `ok=false`，必须先 `npm run build:lib:host`**。
- vitest **不做类型检查**——只有 `tsc -b tsconfig.host.json` 抓得到 TS 错误。**每次改代码必须两个都跑**。

### 7.2 pre-commit 钩子的坑

- **whitespace 门**：`git diff --cached --check` 拒绝尾随空白。逐字捕获的证据文件（provider 输出、终端日志）在 `.gitattributes` 里豁免了（`artifacts/handoff/W8.10/**` 和 `docs/figure-reference/**` 和 `artifacts/handoff/W9/2024-C-attachment-1.csv` 和 `docs/asset-library/**`）。**新轮次的归档目录需检查是否需要类似豁免**。
- **lint 门**（oxlint 48 规则）：注意 **no-non-null-assertion**（改用显式 undefined 检查）和 **no-all-duplicated-branches**（重构残渣）。
- **vendor manifest guard**：改 `package.json` 依赖后须重新生成。

### 7.3 Windows 特有的坑

- **heredoc 里的 `$` 和反引号**：Git Bash 的 heredoc 不展开变量（用 `<<'EOF'`），但内容太长会被截断——**改用 Write 工具写 Python 脚本再执行**。
- **`git ls-files` 的 CJK 文件名**：默认 `core.quotepath=true` 会把 CJK 转义成 `\344\270\255`——**用 `git -c core.quotepath=false ls-files` 才能正确比对**。
- **路径含空格**：`D:\deepseek modex\` 有空格——所有 shell 命令中的路径必须加引号。
- **相对路径的 cwd 不确定性**：tsx 脚本里的相对路径相对于 **cwd** 而非脚本位置——**用 `import.meta.url` 或绝对路径**。

### 7.4 模型调用的坑

- **`reasoning_effort` 必须是 `none`**——不限时 reasoning 吃掉全部预算返回空 content（W8.10-B4 实测 24000 tokens 全耗在推理）。
- **`z-ai/glm-5.3-flash` 实测仍可用**（W8.10-B4 探针 HTTP 200），但**目标模型是 `deepseek/deepseek-v4-flash`**（W8.10 起）。
- **`.env.local` 里有 API key**（gitignored），不要打印到任何入库文件。
- **中转并发限制 1**——串行发请求。
- **模型输出的非确定性**：同一 prompt 多次采样的方差可能很大——**先检查 prompt 是否自相矛盾（形态 7），再归因给模型**。

### 7.5 判定与证据

- **fidelity finding 的 `detail` 被截断到 400 字符**——足够 D5 的相似度证据，不够全文比对。全文在 artifact body store（W8.11-B2 落盘）。
- **E1 直通时 `failedRules` 来自 `#receiveFailures`**——只在 fidelity 拒绝和 producer 拒绝两个点 stash；如果失败走了第三条路径（如 budget exhausted），failedRules 可能为空。
- **反向检查的 `detail` 未去重**：E1 写了重复锚点 id（指令允许"重述同一假设用同一 id"），消息把同一 id 列了两次。消息瑕疵，门正常。

---

## §8 下一轮的具体建议（W10 或 W11，可裁决）

### 方案一：W10 建模质量约束（用户最强调，前置已就绪）

- `CapabilitySpec` 落地（`.strict()` 新 kind + 三条 `.refine` + 每条配构造性反例）
- 退化清单机制：对 F3/F4 各产出一套"降维高发区枚举 → 逐条反写机械检查"
- 探针：主动注入已知错误（反向/冻结/开尔文/尺度分离/收缩方向）看是否被抓
- `NumericConfig` 对象化（**必须走 code emit 形态**，红线 N19）

### 方案二：W11 格式链（稿子交不出去的最大缺口）

- 格式 profile 解析（参考实现资产已在库）
- 15 类 Markdown 自检与修复（**自动修复不得改语义**，N30）
- docx 导出增强（LaTeX→OMML；cairosvg 进 package.json 依赖；PNG DPI 下限）
- 图文件写出逻辑接入 CLI（W9 遗留：report-renderer 已改但 CLI 还没写 figures/）

### 我的建议

**先 W11（格式链）**，理由：
1. docx 导出器已建（本轮成果），补自检即可闭环
2. "稿子交不出去"是第零次内测用户最直观的痛点
3. 去了 AI 味的检查（W12）依赖稿子先定型，格式链是前置
4. W10（建模质量）最难、最需要设计，放在前置全部就绪后单独一轮

**但如果你认为建模质量优先**：先 W10 也可以，代价是 docx 导出的自检部分要再等一轮。

---

## §9 交接自检清单（**逐项确认后才开工**）

1. ☐ 读到本文 §0 的三句话，理解"模型负责想、harness 负责算和证"
2. ☐ 确认 HEAD = `d2dc30d9ec` 或其后继，工作树干净
3. ☐ 跑 `npx tsx artifacts/handoff/W8.9/probe-provenance.mts` 确认 `ok=true`（false 则先 `npm run build:lib:host`）
4. ☐ 跑 `timeout 900 npx vitest run packages/paper/paper-foundation apps/paper-shell` 确认 ≥1405/1406（唯一失败 = xlsx 负载 flake）
5. ☐ 读 `docs/dph-plan-and-redlines.md` §1（两级 MVP 区分）与 §4（红线 N1–N34 已确认条目）。**注意：总书/PRD 原件是上一轮会话附件、未入库**——需要完整原文时向用户索取
6. ☐ 读 `docs/dph-plan-and-redlines.md` §2（11 阶段）与 §3（七缺口 G1–G7）
7. ☐ 读 `artifacts/handoff/neizero/NEIZERO-ASSESSMENT.md`（第零次内测的九维 22/45）
8. ☐ 确认下一轮的"单变量"纪律：**每轮真实运行只改一个生成侧变量**（本方法论出自《任务总书》原件；一次改多个变量会无法归因）
9. ☐ 确认三组（真实运行/独立复核/红队）已排入计划
10. ☐ 确认归档目录 `artifacts/handoff/<轮次>/` 已建
11. ☐ **跑一次第零次内测的 docx 产物**（`artifacts/handoff/neizero/paper.docx`），亲眼看看它长什么样——**这比读十份报告都更能校准你对"能交的初稿"的预期**。注意：其中嵌入的图是 M5 样本图（从 `artifacts/handoff/W9/figures/` 手工复制进 neizero/figures/ 再导出），**不是该次运行自己生产的**——运行自身的图文件写出链路尚未接通（见 §6）
12. ☐ 确认数字资产库 `docs/asset-library/` 已入库（649 文件），**不要从 `D:\modex\_assets_extracted` 引用**——本目录是唯一引用点

---

## §10 一句话

**25 次真实运行把阻断点从"E1 看不到题面"推到了"拿到一份 10 章节的 docx"——每一步都是"修好 harness 侧缺陷 → 阻断点后移"。你接手时的状态是：第一次真实交付已发生（MVP-1+2），第零次内测的九维是 22/45，三个 0/5 的缺口（入口/去 AI 味/改进循环）按依赖排序待做。最大的风险始终是同一个：把 harness 侧缺陷读成"模型不行"——每次运行后先问"判定事后能否核验"，再谈模型能力。**
