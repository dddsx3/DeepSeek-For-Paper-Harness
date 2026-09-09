# ISSUES-AND-ROOT-CAUSES — 驾驶舱真实使用全量问题台账与根因探寻

> **FROZEN-SNAPSHOT**(2026-09-09 固化;后续新增问题请追加 §9,不改历史条目)
> 覆盖范围:TASK-C1.5 交付全过程中的浏览器 UI 自测、两轮零指示子代理测试、
> 以及 REAL-RUN-2024A 的 4 次真实模型运行(见 `REAL-RUN-2024A-behavior-report.md`)。
> 每条问题:现象 → 证据 → 根因 → 层次 → 状态 → 对 TOP 目标(`TOP-GOAL-direct-draft.md`)的影响。

---

## 0. 根因分层框架(排障时先归层)

| 层 | 范围 | 典型症状 |
|---|---|---|
| **L1 引擎/协议层** | paper-shell 引擎语义、tier 协议、门禁、W4 重试政策 | 运行能跑但 DELIVERED/BLOCKED 结果错误、协议拒绝 |
| **L2 驾驶舱投影层** | `apps/cockpit/server.mjs` + `public/*` | 页面显示/交互/API 形状错误;引擎本身对 |
| **L3 遥测/文案层** | 事件投影、usage、人话文案 | 数据真实但标签/措辞误导 |
| **L4 中转/外部依赖层** | y-api 中转、模型可用性、流式性能 | 传输失败、模型不存在、极慢 |
| **L5 操作/环境层** | 题面格式、浏览器行为、打包约束 | 需要人工转换/自动化限制/文件句柄 |

---

## 1. 已修复问题(F 系列全部有 commit,均在 `8cb397eb10` 及之前)

### F1【L2】POST /api/settings 整体不可用——TDZ 崩溃(500)
- **现象**:首次保存任何配置返回 `{"ok":false,"reason":"Cannot access 'doc' before initialization"}`。
- **证据**:curl 矩阵第 1 步即复现;代码 `const doc = loadSettings()` 外层声明,POST 分支底部又 `const doc = {...}` 同名遮蔽,分支内前面的 `doc.profiles.find(...)` 触发 TDZ。
- **根因**:上批"已写完未联调"的代码未经运行验证;TDZ 是块级 const 的经典坑。
- **修复**:底部变量改名 `nextDoc`。**教训:任何"写完未测"的 API 必须先跑一遍最小 curl 矩阵再交 UI。**

### F2【L2】"冻结漂移 · 详情"按钮点了没反应
- **现象**:子代理点击三次无反应;数据其实都在(`/api/manifest` 有 drifts)。
- **证据**:CSS `#manifestDetail{display:none} #manifestDetail.on{display:block}`;JS 用 `show(box,…)` 设 inline `style.display=''`——**inline 空字符串回落到 CSS 的 display:none,`.on` 类从未被加**。
- **根因**:同一 CSS 类切换语义在 JS 里写成了 inline style;更深层是"一个元素两套显示机制"。
- **修复**:`classList.toggle('on', …)`。**教训:凡 CSS 定义了 `.x{display:none}.x.on{…}` 的元素,JS 一律用 classList,禁止 inline style。**(同类坑见 F3,说明这是系统性写法隐患。)

### F3【L2】交付区按钮行整行不可见(下载/预览/误杀从 C1 v1 起就点不到)
- **现象**:子代理二轮:"首轮加载短暂可见,此后 display:none";Playwright 报 element is not visible。
- **证据**:`.dl-row{display:none} .dl-row.on{display:flex}`,全 JS 无一处加 `.on`。
- **根因**:与 F2 同款(容器级),且自 C1 初版存在——两轮子代理测试才暴露,说明"可见性回归"缺少专门用例。
- **修复**:`renderDelivery` 里 toggle `.on`。**教训:交付区是核心动线,应加一条 DOM 可见性断言测试。**

### F4【L2】无 API 配置时点「开始生成」近乎零反馈(<2 秒小字)
- **现象**:子代理:"10 秒观察窗内无弹窗无报错,唯一提示存活不足 2 秒,按钮可反复空点"。
- **证据**:守卫分支只有 `showReason` 红条,且后续 renderAll 会重绘;startHint 文案固定。
- **根因**:错误呈现依赖单一弱通道,且没有"提交前常驻预防"。
- **修复**:三重呈现——startHint 常驻"⚠ 尚未配置 API…"、提交时 8 秒 toast、红条横幅;保存设置后即时刷新。**教训:拦截类反馈 = 预防提示 + 持久错误 + 指路三件套。**

### F5【L2】首页编号乱序(1→3→2→4→5)
- **现象**:子代理:"编号按流程排列"期望落空。
- **根因**:卡片物理顺序(左列 1,3 / 右列 2,4,5)与编号命名时序不一致;窄屏 order 重排又另有一套。
- **修复**:编号按动线重排(左列 1→2,右列 3→4→4b→5),与窄屏 order 对齐。**教训:编号=用户心智动线,改布局必须同步改编号。**

### F6【L2】初稿只能下载/看路径,页内无法预览
- **现象**:子代理二轮:"期望页面内直接预览报告"。
- **修复**:新增 `GET /api/report`(投影 outRoot/report.md,只读)+「在页面里看初稿」按钮(展开/收起,不影响运行输出区)。验证:点击后全文展开、按钮态切换正确。

### F7【L2】>8MB 上传返回 500
- **现象**:`payload too large` + HTTP 500。
- **根因**:readBody 抛错被外层 catch 统一转 500。
- **修复**:上传路径捕获并区分 413(人话"单次上传上限 8MB")。**教训:可预知的用户错误必须映射 4xx+可读 reason,不能裸 500。**

### F8【L3】术语零解释("门禁/审计轨/冻结漂移/额度")
- **现象**:子代理:"术语堆叠,整个实测辅助区第一次看等于噪音","导出溯源 JSON 不敢点"。
- **修复**:申诉/漂移文案白话化、badge 加 `.warn` 桔色与"点详情看说明"、漂移详情加一行人话解释。**遗留:交付区门信息里的 `ir_canonicalization` 等仍未解释(并入 §3 O5)。**

### F9【L2】一键演示从未绑定 + tier 选项术语化(前批 `8df7279` 已修,本批验证生效)

---

## 2. 开放问题——驾驶舱层(L2,O 系列)

### O1【L2,高】无"取消运行"能力(TOP 阻断 B6)
- **现象**:T3 真实运行 48 分钟;期间用户唯一手段是关窗口/杀进程。
- **根因**:server 用 `spawn` 子进程 + 内存 activeRuns,未暴露终止端点;UI 无按钮。
- **建议**:`DELETE /api/runs/:runKey`(杀子进程树 + 终态 BLOCKED(reason=cancelled))+ 时间线卡片加取消按钮;注意 Windows 下杀进程树(taskkill /T)。

### O2【L2,中】BLOCKED 运行的 reportPath 指向**上一次 DELIVERED** 的 report
- **现象**:本次 BLOCKED 运行的交付区显示 `cockpit-out\report.md`(实为上一轮 demo 的报告),易误读为本次产出。
- **根因**:所有运行共享 `--out cockpit-out` 且报告路径是静态拼接;BLOCKED 不产出新文件也不清理旧文件。
- **建议**:按 runKey 隔离子目录,或投影中显式标注"该路径属于最近一次 DELIVERED 运行"。

### O3【L2+L1,高】真实成本不可见、无单 run 预算上限证据(TOP 阻断 B5)
- **现象**:4 次真实运行烧掉 ~28 万 output tokens,页面恒显 `$0`(pricing 未配);usage 事件虽有 budgetState 机制(TASK-Q2),本次未观察到预算门生效。
- **根因**:pricing.json 机制存在但 y-api 模型未配价;cockpit 提交路径未显式传预算参数。
- **建议**:配 pricing(y-api 三模型)让 $ 实时可见;cockpit 提交带 per-run 预算上限(如 $0.5/次,可配),超限 BLOCKED(reason=budget)。

### O4【L5→L2,低】后台标签页被浏览器冻结,视图陈旧不自新
- **现象**:60 分钟后台窗口:API 提交的新 run 不出现在运行列表;SSE/轮询停摆;切回前台经 visibilitychange 恢复。
- **根因**:Edge intensive throttling(后台链式定时器限频/挂起)。代码侧轮询逻辑本身正确(InPrivate 干净窗口同数据正常)。
- **建议**:页头加"数据更新于 HH:MM:SS"角标;检测 document.hidden→visible 时强制全量刷新(已有,可加陈旧标记)。

### O5【L3,低】术语残留与弹窗叠加
- `ir_canonicalization` 等门名仍英文;consent 遮罩覆盖全页时所有点击被拦(正常模态行为,但用户可能以为"页面坏了")。
- **建议**:门名给一行中文对照(投影层映射表);遮罩出现时 title 提示。

---

## 3. 开放问题——引擎/协议层(L1,E 系列;**TOP 目标的真正阻断**)

### E1【L1,最高】T3 闭集模板 × 开放建模题语义不适配(TOP 阻断 B1)
- **现象**(2024 A 题,T3 strict,48 分钟,in 23,908/out 264,428):
  1. 首版交付结论区出现 **`mean_thickness is 0.731 m`**——demo course-work 题的示例数字泄漏进真题交付(critical);
  2. 题面槽位在图 3 后截断,正文以 `template report v2` 占位注结束(minor);
  3. 之后 3 轮 revise 全部退化为**逐字复述题面**(major×3);
  4. 第 4 轮交付**完全为空**(critical)→ review 4 连拒 → BLOCKED。
- **根因探寻**:execute 仅 4 秒、T3 是 course-work 模板装配;模板的槽位结构与五问开放题错位——模型要么照抄模板示例(串题),要么只能复述题面(在"不得引入未入账内容"约束下,它没有合法的"自由发挥"通道)。review 门的缺陷描述也证明评审模型认为"结构上根本没响应题目"。
- **佐证**:T3 的 14/14 QUALIFIED 全部来自 course-work 型题;CUMCM A 题超出设计域。
- **建议**:T3 面向开放题直接判"题型不适配"提前拒绝(省 26 万 tokens);开放题走 T2/T2.5(见 E2/E3)。

### E2【L1,最高】T2 三步协议 ESCAPE `unledgered_reference` 零重试——两模型族同点必死(TOP 阻断 B2)
- **现象**:glm-5.3-flash 与 deepseek-v4-flash 的 T2 运行均在 execute 步骤死于
  `ESCAPE refused: unledgered_reference (zero retry budget — W4)`;v4-pro 因中转下架未能参与(见 X1)。
- **根因探寻**(代码级,`packages/paper/paper-foundation/src/produce/guided-steps.ts` + `executor.ts`):
  - T2 要求模型在**封闭候选集**内分三步声明:step1 声明 `run{code, outputBasenames, seed}`(文件名必须在 harness 候选清单内,"模型零发明空间")→ step2 声明 Result(`locator` 必须⊆ step1 已声明的 outputBasenames)→ step3 声明 claims(`result_refs` 必须⊆ step2 已入账 id);
  - 两个模型族都在 step2/3 引用了 step1 未登记的 locator;
  - `admission.code` 分流:`step_foreign_key/schema_violation` → **DRIFT**(有引导重试预算,拒因回灌);`unledgered_reference/free_id/free_structure/bypass_container` → **ESCAPE**(零重试,W4 attack 1:"ESCAPE 后重试 = 给第二次机会违反同一禁令")→ run 直接 failed → BLOCKED;
  - 换句话说:**跨步引用一致性错误被归类为"安全逃逸"而非"可引导偏差"**,于是没有任何纠错回路;而这类错误恰恰是新题型首跑时模型最常犯的。
- **这一条是"直出竞赛题"的单点最大阻断**:它让 T2 的失败变成确定性(重试无意义,引导不生效)。
- **候选解法(均需专家裁决,涉及 W4)**:
  1. 把 `unledgered_reference`(仅"跨步引用"类,非攻击形态)从 ESCAPE 降级为 DRIFT——带 reason 回灌重试;
  2. step1 增加显式教育:把题目要求的输出文件(result1/2/4.xlsx)与 harness 候选清单做映射提示;
  3. 新增 T2.5"分问协议":五问各一组 step,封闭面更小、跨步引用自然归位。

### E3【L1,高】模型请求无总时长上限;慢/死不可区分(TOP 阻断 B3)
- **现象**:revise#2 20.9 分钟、revise#3 24.8 分钟(其余请求 4–39s);期间 usage 曾 12 分钟零增长,疑似挂死,最终完成——但用户无从区分。
- **根因探寻**:`dsh-llm-deepseek` 有流空闲看门狗 `DEFAULT_STREAM_IDLE_TIMEOUT_MS=300_000`(5 分钟),但中转端持续吐字节(心跳/极慢流)把看门狗喂活,**没有任何请求级总 deadline**;节点级只有 attempt 预算,不覆盖"单次 attempt 无限长"。
- **建议**:请求级 deadline(如 5–10 分钟,超时按传输失败计 attempts);与 O1 取消能力配合。

### E4【L1,高】空交付未 fail-fast
- **现象**:revise#3 花 24.8 分钟产出**空文本**,被当有效交付进入 review,直到 review 才以 critical 拦下(白花一轮评审,且拉长总时长)。
- **根因**:produce/revise 路径对最终文本无"非空/最小长度"前置校验;空文本一路走完装配。
- **建议**:装配后立即校验空/近空(如 <N 字符)→ 按传输失败重试(计 attempts,不再计 ESCAPE——这不是模型违规,是传输/生成事故)。

### E5【L3,中】request_started 事件标签 `deepseek-official/placeholder` 与真实路由不符
- **现象**:全部 9 个请求(demo fake 亦然)显示 `deepseek-official/placeholder`,而实际路由是 y-api/glm-5.3-flash(264k 真实 output tokens 为证)。
- **根因**:事件 data 里的 provider/model 是引擎侧静态/占位标签,未投影 `resolveShellRoute` 的真实路由。排障时曾据此误判"没用真模型"。
- **建议**:事件标签取真实 route;audit 里 `production_enabled.detail.route` 已是真实的,可对齐。

### E6【L3,低】评审缺陷文本全英文、评审者视角,学生不可读
- **现象**:时间线里 `[major] The delivered text is a verbatim restatement…` 直排给学生看。
- **根因**:blockMessage 表只翻译引擎拒绝码,defect 描述是评审模型原文直投。
- **建议**:时间线缺陷行加一句中文摘要(投影层映射即可,不动引擎)。

---

## 4. 开放问题——中转/外部依赖层(L4,X 系列)

### X1【L4,高】`deepseek/deepseek-v4-pro` 被 y-api 中转下架
- **现象**:T2 运行 plan 节点 3 attempts 全挂(无 usage),`provider-unavailable`;直连探测返回
  `{"error":{"code":"model_not_found","message":"No available channel for model deepseek/deepseek-v4-pro under group y-api (distributor)"}}`。
- **影响**:handoff §6 记载的"deepseek 侧用 v4-pro"已失效;双模型族研究轨在 y-api 上只剩 v4-flash(且见 X2)。
- **建议**:向中转方确认通道;或把 deepseek 轨迁回官方/其他中转;**驾驶舱侧建议加启动冒烟**:对激活 profile 发一次 1-token 请求并显示"该 key 能用哪些模型",把 X1 这类问题从"运行 3 次失败"提前到"配置时 5 秒发现"。

### X2【L4,中】中转模型映射:v4-flash 请求被路由到 `hy3` 执行
- **现象**:直连 v4-flash 探测,响应 `"model":"hy3"`(hy3 在该中转目录内)。1-token 探测即触发,并非偶发。
- **影响**:引擎按"deepseek 家族"做的所有口径(含 upgradeVerdict/legacy-protocol 隔离)对实际服务模型失真;复现实验不可控。
- **建议**:中转方确认映射表;研究口径如需纯 deepseek,必须换通道。

### X3【L4,高】长流式生成极慢且伴随心跳/慢流(与 E3 叠加)
- **现象**:revise 21/25 分钟完成;12 分钟 usage 零增长后恢复。
- **根因探寻**:中转侧(分发/排队/上游)持续有字节但吞吐极低;客户端 idle watchdog(300s)因字节持续而永不触发,与 E3 共同构成"慢/死不可区分"。
- **建议**:同 E3(deadline);另可对比官方 API 延迟做一次基准,量化中转开销。

---

## 5. 操作/环境层(L5,Z 系列)

### Z1【L5,中】PDF 题面需人工转 md
- **现象**:引擎守卫(readProblemFile)按 UTF-8 文本读题,PDF 二进制不可直传;2024 A 题用 pypdf 手工转 2.9KB md(PDF 744KB→守卫通过)。
- **影响**:竞赛题几乎全是 PDF;真实用户第一步就会被卡。
- **建议**:驾驶舱上传时做 PDF→文本提取(python/pdf.js 均可,投影层实现),转换结果给用户预览确认后入守卫;守卫侧 300KB 限制对转出文本通常不构成问题。

### Z2【L5,低】浏览器后台标签节流(→ O4)
### Z3【L5,低】AXPress 语义点击不触发 file chooser(自动化工具限制;真实鼠标正常;子代理二轮的"上传回归"由此解释)
### Z4【L5,低】API key 输入框触发 Edge"保存密码?"弹窗
- **建议**:key input 加 `autocomplete="new-password"` 可显著减少浏览器密码管理器介入。
### Z5【L5,低】exe 重打包前必须 taskkill 旧实例(文件句柄 → Couldn't write)——已文档化约束,操作规程保留。

---

## 6. 错误速查表(排障索引:看到什么 → 归哪层 → 查哪里)

| 你看到的 | 归层 | 结论/去处 |
|---|---|---|
| `{"ok":false,"reason":"Cannot access 'doc' before initialization"}` | L2 | F1,已修(`nextDoc`) |
| `payload too large` + HTTP 500 | L2 | F7,已修(413+人话) |
| 页面按钮"点了没反应"(数据其实在) | L2 | 先查 F2/F3 同款:CSS `.x/.x.on` vs inline style |
| `[BLOCKED] … failed its review gate after N reviews` | L1 | E1;看 defect 三类:critical 串题/空交付、major 复述 |
| `[BLOCKED] … ESCAPE refused: unledgered_reference (zero retry budget — W4)` | L1 | E2;T2 三步协议,零重试是设计;两模型族同点必死 |
| `[BLOCKED] … exhausted 3 attempts and is paused for review` + `provider-unavailable` | L4 | X1;先直连中转 `/chat/completions` 探测模型是否存在 |
| `[BLOCKED] 调用/传输失败(gate-failed)` 但 usage 正常增长后停 | L4+L1 | X3+E3;慢流非挂死,看最后 defect |
| `第 1 次模型请求 · deepseek-official/placeholder` | L3 | E5;标签失真,以 usage 真实性为准 |
| `端口 3081 已被占用 —— 驾驶舱很可能已经在运行了` | L2 | 已修:launcher 防重,直接开浏览器即可 |
| `✗ 60 秒内服务未就绪` | L5 | launcher 兜底文案;查 runtime/node 与仓库目录完整性 |
| 双击 exe 无反应且 3081 无监听 | L5 | 先 `netstat -ano \| grep 3081`;exe 需仓库目录在旁(见 packaging README) |
| 重打包报 Couldn't write | L5 | Z5;先 taskkill paper-cockpit.exe |

---

## 7. 与 TOP 目标的映射(每条开放项阻断什么)

| 开放项 | 阻断的验收判据(`TOP-GOAL-direct-draft.md`) |
|---|---|
| E1 / E2 | G-直出-1(2024 A 题 DELIVERED)——**主阻断** |
| E3 / O1 | G-直出-3(过程可见、可取消、慢/死可分辨) |
| E4 | G-直出-1(时长与成本可控) |
| O3 / X3 | G-直出-3(费用显示)+ 直出的成本可行性 |
| E5 / E6 | G-直出-3(看得懂) |
| X1 / X2 | 模型族可用性(双轨验收) |
| Z1 | G-直出-2(B/C/E 类 PDF 题入口) |

---

## 8. 统计摘要(截至本快照)

- 已修复:9(F1–F9,全部 L2/L3,本 session 推送);
- 开放:L1×6(E1–E6,含 2 条 TOP 主阻断)、L2×5(O1–O5)、L4×3(X1–X3)、L5×5(Z1–Z5);
- 真实运行累计消耗:in ~27.4k / out ~280k tokens,4 次运行,0 次 DELIVERED(题型全部超出当前协议设计域);
- 0 次引擎代码改动(禁 C1-0 遵守;所有 L1 修复均为建议,待专家裁决)。

## 9. 追加区(后续新问题登记于此,保持时间序)

*(空——下一位接手者从这里续写)*
