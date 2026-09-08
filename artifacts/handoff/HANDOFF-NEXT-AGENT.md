# HANDOFF — 交接给下一位 Agent(2026-09-09,当前会话因通道故障终止)

> **✅ 本交接已于 2026-09-09 当日执行完毕**:§3.1–§3.6 全部完成(含两轮
> 零指示子代理可用性测试与逐条修复),详见 `artifacts/handoff/TASK-C1/HANDOFF.md` §7
> 与 `artifacts/handoff/TASK-INDEX.md` 的 TASK-C1.5 行。本文保留作过程记录。

> **必读顺序**:本文 → §3 五大未竟任务 → §4 当前代码状态 → §5 验证命令。
> 接手前先读根目录《DeepSeek-For-Paper-Harness-下一步任务书(TASK-C1-实测驾驶舱).md》
> 与《DeepSeek-For-Paper-Harness-问题总账与集成规划(TASK-R1计划书).md》。

## 0. 一句话现状

TASK-C1(实测驾驶舱)主体已完成并推送(GitHub main tip `070ffcf791`,CI 绿),
exe 双击即用已打通;**但用户实测暴露 5 个体验/功能问题,其中 2 个已修一半
(服务端 settings API 已写完未联调、demo 按钮绑定已补),剩余工作清晰可续**。
用户已批准:派一个"零指示新用户"子代理做可用性测试,用反馈修完再交付。

## 1. 用户报告的 5 个问题(原话要点 + 处置状态)

| # | 问题 | 状态 |
|---|---|---|
| 1 | **反复报 "read body failed"** | 上一批已根治四洞(OPTIONS 预检/multipart/spawn ENOENT 崩服/clientError)。用户又报的这条,时间戳显示是**用户与本 agent 的 LLM 通道报错**(provider_code=400001,模型 z-ai/glm-5.3-flash 请求 400),**与驾驶舱无关**。若驾驶舱仍复现,先跑 §5 验证矩阵 |
| 2 | **EADDRINUSE**:双击 exe 若已有实例在跑 → 崩溃堆栈 | **服务端已修未重建 exe**:`apps/cockpit/server.mjs` 末尾已加 `server.on('error')` EADDRINUSE 中文提示("驾驶舱很可能已在运行,直接打开 127.0.0.1:3081")。**剩余:launcher.cjs 应在启动前探测 3081 已就绪则直接开浏览器不重启服务** |
| 3 | **上传文件无法识别/无法上传** | 根因是历史:server 早期一崩全死(已修)。但需用 §5 矩阵复测 multipart/JSON 双形态;前端 `addFiles`(app.js ~890)用 FileReader base64,与服务端 JSON 形态匹配——若用户仍失败,重点查 `PROBLEM_EXT` 大小写、`readAsBase64` 对 0 字节文件、以及 exe 内嵌路径下 cockpit-problems 目录写权限 |
| 4 | **T1/T2/T3 意义不明 + 一键演示无效** | 两个都修了一半:①tier 选项文案已改人话(index.html:333 "T3(推荐 —— 模板填空,最省额度,已通过可靠性验证)");②**demoRun 从未绑定按钮已补绑**(app.js `$('btnDemo').addEventListener('click', demoRun)` 已加,位于 initImportZone 尾部)。**剩余:重建 exe 后实测** |
| 5 | **API 完全不可配置(最致命)** | **服务端已写完未联调**:`apps/cockpit/server.mjs` 新增 `GET/POST /api/settings`(profiles 增删改,key 只存本地 `apps/cockpit/cockpit-settings.json` 永不回传 UI 只回掩码)、`POST /api/settings/test`(GET /models 连通性探测,返回模型列表)、`submitRun(problemPath, tier, mode, useFake, profileId)` 按激活配置注入子进程 env(PAPER_PROBE_*,**不同 key=不同账户=费用分账,随时换模型**)。EADDRINUSE 优雅化也已加。**剩余:前端设置面板(见 §3)完全未做** |

## 2. 架构事实(接手必知)

- **形态**:独立壳(裁决 C-A 降级映射)。`apps/cockpit/server.mjs` = 投影层,
  127.0.0.1:3081;前端 `apps/cockpit/public/{index.html,app.js}` 纯原生零 CDN;
  **exe** = Node SEA 把 `apps/cockpit/launcher.cjs` 注入 node.exe(90MB,
  gitignored;构建命令在 `packaging/cockpit/README.md`;**重打包前必须 taskkill
  旧实例,否则 Couldn't write**)。
- **投影数据源**(真实形状,勿再猜):`apps/paper-shell/src/paper-shell-persist-*/`
  下 `paper_workflow.json` 的 `tables.{runs,nodes,events,artifacts}` 是**键值映射**
  (无 .rows 包裹!`rowsOf = t => Object.values(t ?? {})`);每目录一个 run。
- **运行提交**:server spawn `node --import tsx/esm apps/paper-shell/src/cli.ts run …`
  (必须 process.execPath 直用,不能 npx);CLI 的 DELIVERED/BLOCKED 路径都打印
  `run-id -> <uuid>` 供 server 的 runKey→runId 映射。
- **禁 C1-0**:舱体零引擎语义;守卫(readProblemFile)/文案(blockMessage)/
  manifest verify(verifyStudyManifest)全部 import shell 同源。
- **回归底线**:1112/1112(paper-foundation)+ 27/27(shell);RG-06/07/09;
  push 后 paper-harness CI 绿。

## 3. 待办清单(按序)

### 3.1 前端设置面板(问题 #5 的 UI 半边,最高优先)

在 `index.html` header 的 `btnDemo` 旁加 `btnSettings`("API 设置"),仿既有
overlay 模式(`consentOverlay`/`appealOverlay`,class="overlay">.modal)加
`settingsOverlay`:

- **profile 列表**:每行 name / endpoint / model / apiKeyMasked(只读)/ 单选
  radio(激活)/ "测试" 按钮(POST `/api/settings/test` {profileId} → 显示
  detail + models 列表可点选回填 model)/ "删除";
- **新增表单**:名称、endpoint(https://…)、模型 ID、API key(password 输入);
- 保存 = POST `/api/settings` {profiles:[…], activeId}(**编辑已有行不填
  key = 保留旧 key**,服务端已实现该语义);
- 加载 = GET `/api/settings`;
- **运行提交带上激活配置**:app.js 的 `startRun`(约 990 行)POST /api/runs 的
  body 加 `profileId: activeProfileId`(从 settings 状态取);demo-run 不带
  (fake 模式无 key);
- 页面加载与保存后刷新设置状态;顶栏加一个当前激活模型的小徽章(如
  "● glm-5.3-flash @ y-api")让用户随时知道在用哪个账户。

### 3.2 launcher 双击防重(问题 #2 的 UI 半边)

`apps/cockpit/launcher.cjs` 的 main() 开头:先 GET
`http://127.0.0.1:3081/api/manifest`,1 秒内通 → 打印"驾驶舱已在运行,正在
打开页面…"并直接 `openBrowser(url)` 后退出(exit 0),不 spawn server。

### 3.3 上传复测(问题 #3)

按 §5 矩阵跑一遍;若 multipart 失败重点查 `parseMultipart` 对文件名含中文/
空格的 part 头解析;若 base64 JSON 失败查 readBody 8MB 上限与 413 返回。

### 3.4 重建 exe 并自测

```bash
cd "D:\deepseek modex\deepseek-harness"
node --experimental-sea-config sea-config.json   # sea-config.json 需重建(上批已删,内容:{"main":"apps/cockpit/launcher.cjs","output":"sea-prep.blob","disableExperimentalSEAWarning":true})
taskkill //F //IM paper-cockpit.exe               # 必须,句柄占用会 Couldn't write
cp "$(which node)" paper-cockpit.exe
npx postject paper-cockpit.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
# 异 cwd 双击场景:PowerShell Start-Process exe -WorkingDirectory C:\Windows\Temp → 3081 应 200
```

### 3.5 零指示新用户可用性测试(用户明确要求)

派 general-purpose 子代理,**不许给它本 handoff 与任何任务书**,只给:

> "你是大学生,拿到一个双击就能用的程序(路径 D:\deepseek modex\deepseek-harness\paper-cockpit.exe)。
> 你的任务:不问任何人、不看文档,自己把它跑起来,并完成'导入一道题并生成论文初稿'
> (可用页面上的演示功能)。记录每一步:你点了什么、哪里卡住、哪句话看不懂、
> 哪个按钮你不敢点。最后列出让你困惑或无法继续的 Top 5。你可以用浏览器访问
> http://127.0.0.1:3081/,也可以用 curl 探测,但不得读源码。"

验收:收集子代理的 Top 5 困惑 → 逐条修复(UI 文案/交互),再让它复测一轮。

### 3.6 收尾

回归(1112+27)→ 更新 `artifacts/handoff/TASK-C1/HANDOFF.md`(Gate 表 +
用户反馈修复记录)→ TASK-INDEX/INTERIM-STATUS → 提交推送 → 向用户汇报
(含子代理反馈清单与逐条处置)。

## 4. 当前代码状态(未推送部分)

**已推送**(GitHub main `070ffcf791`):C1 主体、exe v1、B0、P2 全部。

**本地已改未提交**(新会话开工前先 `git status` 确认;以下改动都在,别重写):

- `apps/cockpit/server.mjs`:
  - settings 存储(loadSettings/saveSettings/maskKey/activeProfile,读
    `apps/cockpit/cockpit-settings.json`,该文件需加 .gitignore!);
  - `GET/POST /api/settings`、`POST /api/settings/test`;
  - `submitRun` 第 5 参 profileId + 路由注入;
  - `server.on('error')` EADDRINUSE 中文提示;
  - demo-run 路径不变(fake,不带 profile);
- `apps/cockpit/public/app.js`:`btnDemo` 绑定已补(initImportZone 尾部);
- `apps/cockpit/public/index.html`:tier 选项人话文案已改;
- `.gitignore`:已含 paper-cockpit.exe / sea-prep.blob / cockpit-problems/;
  **待加**:`apps/cockpit/cockpit-settings.json`。

**未动**:前端设置面板、launcher 防重、exe 重建、可用性测试。

## 5. 验证命令(接手 5 分钟自检)

```bash
cd "D:\deepseek modex\deepseek-harness"
npx vitest run --project=thread-safe packages/paper/paper-foundation  # 1112/1112
npm run test:m1:shell                                                  # 27/27

# 起服务(清 3081 旧实例后)
node --input-type=module -e "await import('./apps/cockpit/server.mjs')" &
curl -s http://127.0.0.1:3081/api/settings        # {"ok":true,"profiles":[],…}
curl -s -X POST http://127.0.0.1:3081/api/settings -H 'content-type: application/json' \
  -d '{"profiles":[{"name":"y-api","endpoint":"https://api.y-api.bestvirtualgoods.com/v1","model":"z-ai/glm-5.3-flash","apiKey":"sk-TEST"}],"activeId":null}'
curl -s http://127.0.0.1:3081/api/settings        # 应见掩码 key
curl -s -X POST http://127.0.0.1:3081/api/demo-run -H 'content-type: application/json' -d '{}'   # fake,应 DELIVERED
curl -s http://127.0.0.1:3081/api/runs/active     # runId 应已映射
# 双开场景:再起一个 server → 应打印"端口 3081 已被占用…已在运行"并 exit 1,不崩
```

真 key 在 `D:\deepseek modex\deepseek-harness\.env.local`(y-api 中转:
endpoint https://api.y-api.bestvirtualgoods.com/v1,模型 z-ai/glm-5.3-flash /
deepseek/deepseek-v4-pro;旧 tokenrouter 中转已弃用但 cassette 语料仍有效)。
**.env.local 与 cockpit-settings.json 永不入库。**

## 6. 长线背景(已完成,防重复劳动)

- 专家计划 v1 全链落地:P0-A/B/C/D → Commit1-3 → P1-C/P1C2(双模型族
  glm-5.3-flash + deepseek-v4-pro 各 14/14,LCB95 0.807)→ P1-D(T3.5)→
  P2-A(McNemar p=0.0156,表达力单价 ~5,613 tok/case)→ P2-B(manifest)→
  P2-C(pilot-protocol)。§22 里程碑前置全达成。
- 台账:`artifacts/handoff/TASK-INDEX.md`(每批一行)、`INTERIM-STATUS.md`、
  各 TASK-*/HANDOFF.md。审计快照都有 FROZEN-SNAPSHOT 标头。
- 测试模型族已换轨 z-ai/glm-5.3-flash(旧 free 退役);deepseek 侧用
  deepseek-v4-pro(旧 v4-flash 记录已标 legacy-protocol,upgradeVerdict 拒之)。

---
*交接生成:2026-09-09。新 agent:从 §3.1 开工,完成后 §3.5 的子代理测试是
用户点名的验收方式,不要省略。*
