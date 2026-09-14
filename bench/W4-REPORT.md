# W4 报告 — P0-10 大众档最小入口 + P0-5 题型路由与明确拒绝

> 依据：DPH-PRD-v2 §5.1.3/§5.1.10（题型路由 + 大众档入口）、§6.1 P0-5/P0-10、§8 W4 退出判据。
> 基线：W3 commit `d488bce05f` 之后。本文档随 W4 批次提交。

## 1. W4 退出判据验证（PRD §8 原文）

> 非支持域题被拒绝且零 token

**达成。** `[REFUSED]` 路径在**任何模型调用之前**触发（CLI exit 3，未 spawn 任何 provider 请求）：
- F1 优化调度题（支持域=F3/F4）→ 拒绝，理由含"明确拒绝：不消耗额度"
- 泛化"请写一篇论文" → 拒绝（建模信号不足）
- 极短题面 → 拒绝（过短）

零 token 由构造保证（无 LLM 调用），非测得：路由是**纯字符串启发式**。

## 2. 交付清单

| 组件 | 落点 | 验证 |
|---|---|---|
| 题型路由分类器 | `apps/paper-shell/src/route.ts`（新）：F1-F4 关键词加权 + MIN_SIGNAL + 明确拒绝；`routeBanner` 写族进 taskText | route.spec **8/8**：F3/F4 支持、F1 拒绝、泛化拒绝、短题拒绝、确定性、闭集 |
| CLI 路由接入 | `cli.ts`：`classifyProblem` 在任何 provider 调用前；REFUSED exit 3 + 零 token；支持域 banner 拼接 | 端到端：F1 题 `[REFUSED]` + exit 3；C 题正常跑通 |
| cockpit PDF 直读 | `server.mjs handleUpload`：删除 E4 "PDF 暂不支持" 422，PDF 不再喂 UTF-8 守卫（留给 bundle pypdf） | 上传 2024-C.pdf 返回 `problemPath`（此前 422） |
| 数据附件进 run | `server.mjs submitRun` 接收 `dataPaths` → CLI `--data` 标志；前端 `app.js` 上传后回传 path | 端到端 zip 的 attachments 台账有 xlsx |
| 大众档 fail-soft 默认 | `submitRun(…, failSoft=true)` → CLI `--fail-soft` | 端到端 run 照常交付 |
| 产出版下载 | `server.mjs` 新 `GET /api/runs/:id/download` → deliverable.zip；前端 `btnDownload` 指向它 | `200 1773B`；zip 含 report.md/sha256.txt/run-report.json |

**M-Bench 中文数据链路**：上传的 xlsx 台账 sha256 `b799a137...` 与 `bench/MANIFEST.json` 里 2024-C 附件 1 哈希**完全一致**——W1 冻结的语料与 cockpit 上传路径共用同一份字节。

## 3. 关键工程决策

1. **路由是零 token 的构造保证，不是测得**:分类器纯字符串匹配,无 LLM——"零 token"由架构保证(拒绝分支在 provider 创建之前 return 3)。
2. **banner 进 taskText 而非交付物**:路由信息是给 W5 方法族契约层消费的输入,不是论文内容——T3 模板不渲染它(实测 report 无 banner,符合预期)。
3. **cockpit PDF 不再 422**:W3 的 bundle 已在 shell 侧做 pypdf 提取,cockpit 只要把 PDF 存盘 + 交给 `run` 的 `--data/--out` 链即可;上传层只保留"文本问题过 UTF-8 守卫、PDF 直接放行"。
4. **下载走真实 deliverable.zip 而非投影文本**:大众档用户拿的是**最终交付物**(含报告+run-report+sha256),不是页面投影;失败时 404 提示"未生成"。

## 4. 测试与验证

- route.spec 8/8(新增);paper-shell 46/46;paper-foundation 1145/1145 无回归;负对照 18/18;metrics integrity OK
- cockpit 端到端(PDF 上传→数据附件→run→下载 zip)全通,含真实 sha256 交叉验证

## 5. 遗留与下一步(W5)

1. **方法族契约层(F4 评价决策 + F3 数据驱动,2 套)**:路由已把族写进 taskText,契约卡(候选集封闭/专项验证)是 W5 主体;当前 T3/T1 其实还没消费 banner——W5 把契约接上才算闭环。
2. **cockpit UI 一键直出**:当前是"上传→选层级→运行"三步;大众档最终形态是"拖入→等待→下载",层级选择应隐藏给大众档(默认 fail-soft + 默认模式)。
3. **路由代码本身是启发式**:F1/F2 的 F1 误判风险存在(真实 CUMCM A 题带优化词会被 F1 拒,哪怕它是决赛题)。W5 契约层应把"族→契约卡"做得比分类更稳;分类器只是第一道零成本闸。

## 6. W4 模块精读:executor.ts 第 2 周(§9 第 4/12 份)

- **不变量**:`runNode` 对 plan/execute/review/revise 四类节点共用同一运行循环;每类节点的 prompt 由调用方(execute 主循环)组织,节点自身不感知语义;`Policy.maxReviseRounds` 是唯一轮次上限。
- **我不同意什么**:`runNode` 的 `role` 与 `nodeType` 双轨——`runNode(runId,'review','review','reviewer',…)` 的类型串是字符串字面量,`reviewSections` 之类的语义片段与 role 绑死但没有编译期约束。建议加 `role: 'reviewer' => NodeType<'review'>` 的映射类型,让"review 节点必须 reviewer role"成为类型。
- **删掉它会坏在哪**:plan→execute→review→revise 的循环与防重入、attempt/maxAttempts 账本都在 `runNode` 生命周期里。
- **一句话对外**:每一次模型调用的"进出账本"——谁、哪一轮、几次尝试、返回什么,全在这一个函数里。

---

*W4 退出判据:达成(非支持域题零 token 拒绝)。W5 进入:方法族契约(F4 + F3,2 套契约卡落地,各跑通 1 道可见题)。*