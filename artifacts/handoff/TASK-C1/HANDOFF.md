# TASK-C1 交接 — 实测驾驶舱(independent shell + shared subscription layer)

> 头:`3dab0952f`(TASK-P2)。上游:TASK-R1 计划书 + C1 任务书。三裁决单
> **C-A/B/C 全 B 代签**(`decision-log.md`;C-A 按任务书风险 #1 预设降级映射:
> dsh web 的 client-web bootstrap 无 per-page 扩展点 → **独立壳 + 事件订阅层共用**)。

## 1. 架构(舱体只投影,禁 C1-0 自查通过)

```
学生浏览器 ──HTTP/SSE──▶ cockpit server(apps/cockpit/server.mjs, 127.0.0.1:3081)
                            │  投影层:只读 + 一个研究档案写路径
                            ├─ run/node/event/artifact ← paper-shell 持久化
                            │  (apps/paper-shell/src/paper-shell-persist-*/
                            │   paper_workflow.json, tables.{runs,nodes,
                            │   events,artifacts}, JsonStorageBackend 真实形状)
                            ├─ 题面守卫 ← readProblemFile 同源 import(零复制,G1)
                            ├─ manifest 徽章 ← verifyStudyManifest 同源(G5)
                            ├─ 人话文案 ← blockMessage 同源(G7)
                            └─ FalseBlock 裁决表 ← TASK-P2/study/falseblock.jsonl
                               (pilot-protocol §2 字段;学生申诉=UNCERTAIN,
                                裁决由操作者+审计轨填 — G6)
数据文件 → 只落 cockpit-problems/ 供沙箱代码读取,零 prompt 组装路径(G2)
```

- 运行提交 = spawn `node --import tsx/esm apps/paper-shell/src/cli.ts run ...`
  (与 CLI 用户同一入口,同持久化根;Windows 直用 node.exe 规避 npx/.cmd;
  child error 监听——run2 事故后 P2-A 偏差声明的同款教训不二犯);
- SSE:`GET /api/runs/:id/stream?afterSeq=N`(1.5s 轮询持久化增量,事件按 seq
  重放;EventSource 原生断线重连,恢复不重复渲染)。

- **双击即用交付**:paper-cockpit.exe(Node SEA 单文件启动器:找 runtime→拉起服务→自动开浏览器,中文状态台)+ 启动驾驶舱.cmd 兜底(杀软拦截场景)+ 便携包清单(packaging/cockpit/README.md);异 cwd(桌面快捷方式场景)启动实测 200。

## 2. 前端(apps/cockpit/public/,子代理实现,主控验收)

`index.html`(483 行)+ `app.js`(1232 行),**纯原生零框架零 CDN**。五区齐备:
① 拖拽导题(题面/数据分栏,base64→同源守卫,失败红条显后端 reason 原文)
② 交付区(状态色区分 + 报告下载)③ 实时进度时间线(SSE 投影,阶段由
node.title×事件 type 组合,不发明引擎没有的阶段;usage 累计;gate_result 逐门
点亮)④ 节点视图(卡片网格 + BLOCKED 高亮 + 溯源卡投影 artifact 链与 sha256
"引擎返回"标注 + 溯源 JSON 导出按钮)⑤ 实测辅助(manifest 徽章三态/误杀申诉
模态/知情同意一次性确认/一键演示)。

主控静态验收:零外链、零引擎语义泄漏(sha256 仅投影展示且标注来源)、
EventSource 原生、API 字段与 server 对齐、JS 语法通过。

## 3. 集成联调实测(全部真实跑通)

| 项 | 结果 |
|---|---|
| 静态页 | index 200 / app.js 200 |
| manifest 徽章投影 | 冻结漂移正确上报(git_commit/基线——正是 verify 该说的话) |
| **read body failed 四洞修复** | ①OPTIONS 预检 204+CORS ②multipart 解析(题面+数据双文件)③child spawn 直用 node.exe + error 监听(**run2 同款 unhandled 'error' 崩服根因**)④clientError 中文 400;全矩阵复测过 |
| demo-run e2e | 连续两次 DELIVERED,durable runId 映射成功(`run-id ->` 行提取) |
| run 投影 | run/nodes(4:plan/execute/review/deliver)/events(24)/artifacts(1) |
| SSE | engine 事件按 seq 重放 + snapshot;pending 事件在 run 未持久化时正确发出 |
| 上传 | base64 JSON、multipart 单/双文件、超限/空/编码三拒(人话)、非 JSON 400 |

## 4. Gate 自评

| Gate | 状态 |
|---|---|
| G1 上传三攻击同源守卫 | ✅ readProblemFile 直 import,UI 零复制校验逻辑 |
| G2 数据文件不入 prompt | ✅ 数据只落 problems 目录供沙箱读;舱体无任何 prompt 组装代码 |
| G3 关页重开恢复 | ✅ 投影来自持久化(event seq 重放),前端按 afterSeq 续传 |
| G4 溯源卡链路 | ✅ Claim/Result/Figure 节点投影 artifact 链 + sha256(引擎返回) |
| G5 徽章=CLI verify | ✅ 同一 verifyStudyManifest 函数(漂移实测一致) |
| G6 FalseBlock 归档格式 | ✅ pilot-protocol §2 字段,学生申诉=UNCERTAIN |
| G7 文案零第二套 | ✅ BLOCKED 人话走 blockMessage;其余 UI 文案为中性描述非状态语义 |
| G8 1112 基线零改动 | ✅ 舱为投影层;引擎/shell 语义零触碰(cli 仅加 2 行 run-id 打印 + BLOCKED 备忘录字段,均为投影增强) |
| G9 release 可装可验 | ⏳ 签名 release 机制在库;`release-notes.md` 已备,实际打 release 待首个冻结版 |
| G10 30 分钟真人实测 | ⏳ **待真人**(用户到场) |

## 5. B0 三件套(顺带完成)

- B0-1:BLOCKED run-report 增强 `memo` 字段(已过门清单/已铸 IR kinds/count/
  failing node/建议介入点——纯投影);
- B0-2:pilot-protocol M2 复核清单加"叙事连贯性"维度;
- B0-3:20 份历史 handoff 文件加 FROZEN-SNAPSHOT 标头(防"当前状态"误读)。

## 6. 已知边界

1. SSE 当前是 1.5s 持久化轮询的增量投影,非引擎事件总线直连——对 5 学生
   规模绰绰有余,若未来要推真正的引擎级推送,接 audit 流订阅点即可(接口已按
   afterSeq 语义设计,前端无需改);
2. G10 与 G9 的"实际打 release"需要真人与冻结版,本批交付到"可装可验"为止;
3. 前端在 file:// 直开时已由 CORS 预检兜底,但推荐 `npx tsx apps/cockpit/server.mjs`
   同源使用。

---

## 7. 用户实测反馈修复轮(2026-09-09,C1.5)

用户 5 个实测问题(见根目录 HANDOFF-NEXT-AGENT.md §1)的最终处置:

| # | 问题 | 处置 |
|---|---|---|
| 1 | read body failed | 与驾驶舱无关(该报错是 LLM 通道 400);四洞修复保持,§5 矩阵复测无复现 |
| 2 | EADDRINUSE 崩溃 | 双修:server.on('error') 中文提示(前批)+ **launcher 双击防重**——`cockpitAlreadyUp()` 1s 探测 /api/manifest,已在运行则直接开浏览器 exit 0,不 spawn。实测:第二实例优雅退出,原实例继续服务 |
| 3 | 上传无法识别 | §5 矩阵复测全过:JSON/multipart 双形态、中文+空格文件名、0 字节守卫拒、缺字段 400;新增 **>8MB 干净 413**(原为 500)。.exe 服务端放行属设计现状(扩展名过滤在客户端) |
| 4 | T1/T2/T3 意义不明 + demo 无效 | tier 文案(前批)+ demo 绑定(前批)已验证生效 |
| 5 | API 不可配置(最致命) | **C1.5 全链落地**:服务端 GET/POST /api/settings(掩码/编辑不填 key=保留旧 key/replace-all)+ POST /api/settings/test(GET /models 探测,支持未保存行内联测试)+ submitRun 第 5 参 profileId 按 profile 注入 PAPER_PROBE_*(不同 key=分账);前端设置面板(overlay,新增/激活 radio/测试/模型列表点选回填/删除/保存)+ 顶栏激活徽章("● model @ name")+ startRun 守卫(无路由拒绝并指引)。浏览器 UI 全链路实测:新增→激活→保存→掩码回读→真 key 测试(200+5 模型)→点选回填→保存。**联调修出 2 个真 bug:①POST /api/settings 的 `doc` TDZ(服务端 500)②manifestDetail inline display 被 CSS 压住(详情按钮"点了没反应")** |

零指示新用户测试(用户点名的验收方式):general-purpose 子代理(不给任何文档,
只有"大学生拿到双击程序"的角色卡)实测两轮(各 15-20 分钟)。第一轮 Top 5
困惑 → 逐条修复(启动反馈/无 key 反馈/详情按钮/术语白话化/编号重排+报告预览);
第二轮复测判定:前 4 项**已解决**;新抓 1 个真 bug——**交付区按钮行 .dl-row
容器 display:none 从未被 .on 切换(下载/预览按钮整行不可见,C1 初版即有)** →
已修并 GUI 验证:预览按钮点击后页内展开 report.md 全文、按钮变"收起初稿"。
复测另提 2 个低危项不改:①知情同意弹窗按 localStorage 设计(子代理清了站点
存储才重弹,机制正确)②自动化点击 filechooser 偶发不触发(真实鼠标未复现,挂观察)。

回归:1112/1112(paper-foundation)+ 27/27(shell)✅。exe 重建(异 cwd
C:\Windows\Temp 启动 3081=200,settings API 正常)。cockpit-settings.json
已 gitignore;真 key 永不入库(仅存本机 .env.local / cockpit-settings.json)。
