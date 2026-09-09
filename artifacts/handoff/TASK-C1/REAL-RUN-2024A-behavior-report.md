# REAL-RUN-2024A — 驾驶舱 × 2024 CUMCM A 题真实运行行为记录

> **FROZEN-SNAPSHOT**(2026-09-09 记录完毕;事件时间戳一律 UTC,本地 = UTC+8)
> 本文是一次真实运行的**事后行为记录**,不是当前状态描述。
> 证据归档:`artifacts/handoff/TASK-C1/evidence-real-run-2024A/`
> (paper_workflow.json + paper_audit.json + 上传题面 md,共约 40KB)

---

## 0. 元信息

| 项 | 值 |
|---|---|
| 测试日期 | 2026-09-09,提交时刻 00:21:39Z(本地 08:21:39),终态 01:09:35Z(本地 09:09:35) |
| 代码版本 | GitHub main `8cb397eb10`(C1.5 批次之后,工作区干净) |
| 测试题目 | 2024 年高教社杯全国大学生数学建模竞赛 **A 题「板凳龙」闹元宵** |
| 题面来源 | `D:\pmkWxf8H9cfe9984c1a1a5b1263e5dd3b5596ed5\CUMCM2024Problems\A题\A题.pdf`(744KB,3 页) |
| 上传题面 | `2024-A题-板凳龙.md`(2.9KB,PDF 保真文本转换,内容未改写,仅图注归位/去页码);server 端注册名 `problem-mttcs31f-2024-A题-板凳龙.md`,sha256 `53f8491f52eebf1a8ec3406054e7b8841d62847ab18e45db78898af6233fbe93` |
| 运行参数 | tier=**T3**,mode=**strict**,fake=false(真实模型) |
| 运行标识 | runKey `run-mttcsfoy` → runId `2a68c09-fadc-4c06-bebb-8c3ed91efbc4`(完整:`2a687c09-fadc-4c06-bebb-8c3ed91efbc4`) |
| 模型路由 | cockpit 激活配置 `y-api`(endpoint `https://api.y-api.bestvirtualgoods.com/v1`,model `z-ai/glm-5.3-flash`),经 submitRun 注入 `PAPER_PROBE_*` 子进程环境 |
| 数据附件 | 无(A 题无数据文件) |
| 终态 | **BLOCKED**(run 记录 status=failed;review 门 4 次未过) |
| 用量 | input **23,908** tok / output **264,428** tok / costUsd 0(pricing 表未配置,占位价) |
| 耗时 | 全程 **47 分 55 秒**(提交→终态) |

> ⚠ 题面转换说明:引擎守卫按 UTF-8 文本读题(readProblemFile),PDF 二进制不可直传,
> 故做了 PDF→Markdown 保真转换。这是操作层转换,不是改题;若未来支持 PDF 直读,
> 应在引擎侧做提取,不应依赖操作者手工转换。

---

## 1. 全程请求级时间线(从 workflow 事件表精确重建)

9 个节点、9 次模型请求,全部 attempt=1/3(无节点内重试;循环是 review→revise 结构):

| # | 节点 | 开始(UTC) | 结束(UTC) | 耗时 | 结果 |
|---|---|---|---|---|---|
| 1 | plan | 00:21:40 | 00:22:14 | 34s | succeeded |
| 2 | execute | 00:22:14 | 00:22:18 | **4s** | succeeded |
| 3 | review #1 | 00:22:18 | 00:22:57 | 39s | succeeded(判定 3 缺陷:critical×1 / major×1 / minor×1) |
| 4 | revise #1 | 00:22:57 | 00:23:19 | 22s | succeeded |
| 5 | review #2 | 00:23:19 | 00:23:33 | 14s | succeeded(major×1) |
| 6 | revise #2 | 00:23:33 | 00:44:29 | **1256s(20.9 分钟)** | succeeded |
| 7 | review #3 | 00:44:29 | 00:44:35 | 6s | succeeded(major×1) |
| 8 | revise #3 | 00:44:35 | 01:09:21 | **1486s(24.8 分钟)** | succeeded |
| 9 | review #4 | 01:09:21 | 01:09:35 | 14s | succeeded(major×1 + critical×1)→ **gate FAIL → BLOCKED** |

观察要点:
- **review 节点恒快**(6–39s);**两个慢请求恰好都是 revise**(20.9 / 24.8 分钟),其余请求 4–39s;
- execute 仅 **4s**——T3 的执行阶段是模板装配(closed-slot filling),不是长生成;
- revise#2/#3 合计约 46 分钟,占全程 96%;每轮 revise 产出规模巨大(out 总量 264k,
  扣除首轮 plan/execute/revise#1 的量,两轮长 revise 估计各 6–8 万 output tokens)。

---

## 2. 逐阶段行为详述

### 2.1 题面进入
- curl 以 JSON/base64 形态 POST `/api/problems`(与前端 FileReader 同一 JSON 形态),
  守卫(readProblemFile,与 CLI 同源)通过,返回 problemPath + sha256;
- 同源路径 POST `/api/runs` 提交运行,携带 `profileId: profile-mttclap2-0`;
  server 用 profile 的 endpoint/model/apiKey 覆盖子进程 env 后 spawn
  `node --import tsx/esm apps/paper-shell/src/cli.ts run <problem> --tier T3 --mode strict`。

### 2.2 plan + execute(00:21:40–00:22:18)
- plan 34s 产出计划;execute 4s 完成。
- **T3 是模板填空**:execute 的 4 秒说明它把模型输出装配进 course-work 形态的
  固定模板,而非自由写作。首版交付物的结论区出现了
  **`mean_thickness is 0.731 m`——这是 demo 课程作业题(海冰厚度)的结果数字**,
  与板凳龙题毫无关系(见 2.3 的 critical 缺陷原文)。
- 另有 minor 缺陷:"题面复述在图 3 描述后被截断,正文以 'template report v2' 占位注
  结束"——即模板的题面槽位没有被完整填充。

### 2.3 review #1(00:22:18–00:22:57)——评审门正常工作
三条缺陷(评审模型 glm-5.3-flash 产出,引擎原样入档):
1. **critical**:"结论断言 'mean_thickness is 0.731 m',该量在要求输出中根本不存在;
   任务要求的是板凳龙的逐秒位置/速度……"(demo 模板串题的直接证据);
2. major:"交付文本没有解决五个问题中的任何一个:没有 0–300s 或 −100–100s 的
   位置/速度表,没有问题 2 的终止时刻、问题 3 的最小螺距……";
3. minor:"题面复述在图 3 描述后被截断,正文以模板占位注结尾,交付明显不完整"。

### 2.4 revise 循环(review #2/#3 均 major"纯复述题面")
- revise #1(22s)之后交付物退化为**逐字复述题面**(第 2 次 review 判 major:
  "The delivered text is a verbatim restatement of the problem statement only…");
- revise #2(20.9 分钟,巨量输出)之后 review #3(仅 6s)判定**仍是纯复述**;
- revise #3(24.8 分钟,巨量输出)之后 review #4 判定:**交付文本完全为空**
  (critical:"The delivered text is completely empty. No content of any kind was
  delivered…")→ review 门第 4 次 FAIL → BLOCKED。

### 2.5 终态与投影
- CLI 打印 `[BLOCKED] 调用/传输失败(gate-failed):run '…' failed its review gate
  after 4 reviews → 重试一次;若持续失败报告给维护者。run-id -> 2a687c09…`;
- cockpit 的 runKey→runId 映射、`/api/runs/active` 终态、SSE 投影全部正确;
- **BLOCKED 运行没有产出新 report.md/zip**(cockpit-out 中残留的是上一次 demo 的文件,
  容易误读——见问题清单 #P6);
- GUI 呈现(干净窗口验证):交付区红色"被门禁拦截"+引擎原文+两处"我认为这是误杀"
  按钮自动激活;时间线 9 节点带各轮缺陷原文;门禁节 `review:BLOCKED · 缺陷合计 2
  (critical 1 / advisory 0)`;用量条 23,908 / 264,428 / $0。

---

## 3. 根因分析(分层)

### R1(主因):T3 闭集模板 × CUMCM 开放建模题不适配【引擎语义,非驾驶舱 bug】
T3 的 execute 是 course-work 形态的模板装配(4 秒完成),其示例/槽位与"板凳龙"
五问结构完全错位:首版直接串题(demo 题的数字出现在结论),此后 3 轮 revise 在
T3 约束下也只能产出题面复述,始终无法生成五问要求的结构化结果(result1/2/4.xlsx、
表 1/表 2、终止时刻、最小螺距、缩短调头弧、最大速度)。review 门连续 4 次正确拒绝,
最终 BLOCKED——**门禁按设计拦截了不合格交付,链路本身工作正常**。
T3 的通过率数据(14/14 QUALIFIED)全部来自 course-work 型题;CUMCM A 题超出其
设计域。换 **T2(分步引导)** 或换模型族可能改善,但属引擎侧决策,本批未动。

### R2(性能):y-api 中转在长生成下极慢
两个 revise 请求各 20.9/24.8 分钟(其余请求 4–39s)。流空闲看门狗为 5 分钟
(`dsh-llm-deepseek` DEFAULT_STREAM_IDLE_TIMEOUT_MS=300_000),却没触发——说明
中转端在持续吐字节(SSE 心跳或极慢速流),**没有请求级总时长上限**。曾疑似挂死
(12 分钟 usage 零增长),实际最终完成——"慢"而非"死",但用户无从区分。

### R3(质量):极慢生成 × 空交付
revise#3 花了 24.8 分钟却交付**空文本**并被 shell 当作有效交付进入 review。
疑似中转端流式生成失败/被截断后,引擎未对"空交付"做前置校验(空文本一路走到
review 才被 critical 拦下)。对空交付 fail-fast 应是廉价且值得的改进。

### R4(计量展示):request_started 事件的 provider/model 标签失真
所有节点(含 demo fake 运行)的 request_started 都显示
`deepseek-official/placeholder`,与实际路由(y-api / z-ai/glm-5.3-flash,真实
用量可证)不符。属展示层标签未投影真实路由,易误导排障(本次排障初期即被误导)。

---

## 4. 本次观察到的问题与改进清单(按优先级)

| # | 级别 | 现象 | 证据 | 影响层 | 建议方向 |
|---|---|---|---|---|---|
| P1 | 高 | 长生成请求无总时长上限,单请求 20+ 分钟,用户无法区分"慢"与"死" | §1 时间线 #6/#8;曾 12 分钟 usage 零增长 | 引擎(请求级 deadline)+ 驾驶舱 | 请求级总超时(如 5–10min)+ 超时明确入档 |
| P2 | 高 | 驾驶舱无"取消运行"按钮;慢运行只能等或关服务 | 本次只能靠 curl/杀进程 | 驾驶舱 | server 增 DELETE /api/runs/:runKey(杀子进程),UI 加取消按钮 |
| P3 | 高 | T3 × 开放建模题必然 BLOCKED,但 UI 不解释"为什么被拦" | 缺陷原文全英文且是评审视角 | 引擎/文案 | BLOCKED 时给出 tier 适配提示(如"T3 模板适合课程作业题,开放建模题建议 T2") |
| P4 | 中 | 空文本交付未做 fail-fast,走到 review 才拦截(浪费一轮评审) | review #4 critical | 引擎 | execute/revise 产出空文本时直接判传输失败并重试 |
| P5 | 中 | request_started 显示 `deepseek-official/placeholder`,与真实路由不符 | 全部 9 个请求;demo fake 同样显示 | 引擎事件标签/投影 | 事件 provider/model 投影真实路由(来自 resolveShellRoute) |
| P6 | 低 | BLOCKED 运行不清理/不标注 cockpit-out 里的旧 report,reportPath 仍指向上一次交付 | 本次交付区显示旧 demo 的 report 路径 | 驾驶舱投影 | 按 runKey 隔离 out 子目录,或在投影里注明"报告属于上一次 DELIVERED 运行" |
| P7 | 低 | 后台标签页被浏览器冻结时,运行列表/时间线不自动更新(切回前台恢复) | 60 分钟后台窗口未显示新 run;InPrivate 干净窗口同数据正常 | 浏览器行为,代码已有 visibilitychange 兜底 | 可加"数据最后更新于 HH:MM:SS"角标帮助识别陈旧视图 |
| P8 | 低 | consent 遮罩开着时拦截全页点击(正常模态行为,但叠加 P7 时易误判"按钮失灵") | InPrivate 窗口复现 | UI | 可给遮罩加"页面被同意弹窗覆盖"提示(低优先) |

(另:GUI 上传对**自动化**事件不触发 file chooser 属浏览器自动化限制,真实鼠标正常,
已在前批可用性测试确认,不列问题。)

---

## 5. 本批验证过的正常路径(防重复排查)

- 上传守卫:PDF 转出的 2.9KB md 通过(空/超限/编码三拒另有矩阵覆盖);
- 设置 API + profileId 注入:真实调用走了 y-api(用量 264k output tokens 为证,
  demo fake 恒为 0);
- plan/execute/review/revise 循环、门禁计数(critical 计入 gate_fail)、BLOCKED
  人话输出、runKey→runId 映射、SSE 投影、时间线/节点/交付区/误杀入口 GUI 呈现:
  全部按设计;
- 回归底线:1112/1112 + 27/27(同批早前已验证,本运行未改任何引擎代码)。

## 6. 复现指南

```bash
cd "D:\deepseek modex\deepseek-harness"
node --input-type=module -e "await import('./apps/cockpit/server.mjs')" &
# 配置激活 profile(见 cockpit-settings.json,已有 y-api)后:
# 1) 上传题面(已归档副本 evidence-real-run-2024A/problem-*.md)
# 2) POST /api/runs {"problemPath":"...","tier":"T3","mode":"strict","fake":false,
#                     "profileId":"profile-mttclap2-0"}
# 或 CLI 等价:npx tsx apps/paper-shell/src/cli.ts run <problem> --tier T3 --mode strict
# 预期:~48 分钟后 BLOCKED(review 4 次未过);若中转提速则时间缩短,结果应仍为
# BLOCKED(串题/复述/空交付三态之一)——除非 T3 语义或模型族变更。
```

## 7. 结论(一句话)

**驾驶舱投影层与门禁链路经受住了一次真实对抗(48 分钟、264k tokens、4 轮评审),
行为全部可解释;交付失败源于 T3 模板与 CUMCM 开放题的适配边界,属引擎侧已知域
外场景**——真实人员测试可按"P3 的适配提示 + 课程作业型题目"推进,开放题场景
待 T2/模型族决策后再验。
