# W8.10-B3 — 回灌不得破坏 cassette 指纹（硬判据 H9）

> 判定人：W8.10-B3 验证子代理
> 判定时间：2026-09-18（会话中仓库发生并发提交，见 §6 时序注记）
> 判定对象：`e5ffdae03f`（W8.10-B，E2 DRIFT 引导回灌）
> 证据目录：`artifacts/handoff/W8.10/B3-replay-out/`（含 `console.log` 与逐次 run-report）

---

## 1. 结论（放最前）

**无 miss。B 组的 DRIFT 引导回灌没有破坏任何既有 cassette。**

| 项 | 结果 |
|---|---|
| `glm-t3-coursework-v4.json` 回放 ×2 | **DELIVERED / exit 0 / 零 miss**，zip sha `ad4125adbf3a4dcd…` 两次逐字节相同 |
| `glm53flash-t3-coursework-v2.json` 回放 ×2 | **DELIVERED / exit 0 / 零 miss**，zip sha `c518fa5918710e9e…` 两次逐字节相同 |
| report sha 与录制值一致性 | v4 = `f2fbb3bbc16c4f5a338d11d69cf31c85b4b70400e71723e3867a96090791fd51`（与 B commit message 自称的 W8.9 录制值 `f2fbb3bbc16c4f5a` 一致） |
| 回放请求指纹 | 10/10 全部 `in_cassette=true`（实测逐调用追踪，见 §4） |
| cassette 文件完整性 | 未改动（`git status` 干净；v4 `76e58edf50faf079…`、flash `35e16808c762a312…`） |

**为何结构上不可能 miss（两条独立保证，任一成立即足够）：**

1. **这两个 cassette 走 T3，根本不经过 E1/E2 接收层。** B 组改的引导只挂在
   `executor.ts:1400` 的 `else if (... && this.e1e2Enabled())` 分支上，而 T3 在
   `executor.ts:1385` 的 `else if (tier === 'T3' && ...)` 分支就被截走了（`else if`
   链，T3 永不落入 E1/E2 分支）。**T3 路径一次 E2 调用都不发**，引导无从进入指纹。
   实测佐证：两次回放的完整调用追踪里，**没有任何一条 prompt 含 `NORMALIZING`**
   （E2 提示词的特征串）——E1/E2 分支确实没跑。
2. **即便走 T1/T2，引导为空时 prompt 逐字节不变。** `e2PromptWithGuidance` 在
   `guidance.length === 0` 时**直接返回 `basePrompt` 原对象**（`e2-guidance.ts:188`），
   不做任何拼接。见 §5 的逐字核对。

---

## 2. 回放调用方式（先读代码再实测）

`apps/paper-shell/src/cli.ts` 的 `main()` 参数解析（`parseArgs`，第 72–92 行）：

- `--replay <file>`（第 239 行）与 `--fake` **互斥**（第 244–247 行显式报错）；
- **`--replay` 不需要 API key**：第 250 行的路由守卫是
  `if (!fake && replayPath === undefined && ...)`——replay 被排除在外；
- **`--replay` 还需要 `--tier` 与 `--out`**（`--mode` 可选，默认 `strict`）；
- cassette 自带 provider/model 身份，`CassetteReplayer.load(...).meta` 先被读出来喂给
  `buildContext(here, display)`（第 264–269 行）——这是 W8.9 修的"回放恒 miss"bug 的
  修复点，**回放的身份来自 cassette 而非路由环境变量**。

`--replay` 走 `createReplayProvider`（第 296–297、715 行）：每个 seam 请求按
`requestFingerprint`（provider + model + system + messages，`cassette.ts:58–70`）查表，
**未知指纹 loud FAIL**（`cassette.ts:177–183`）：

```
cassette miss: request d9ec4a1914bee999… was never recorded — the engine changed what it asks; re-record the cassette (never guess on replay)
```

CI 的既有调用（`.github/workflows/paper-harness.yml:166–167`）即本次实测所用形态：
`--tier T3 --mode strict --out <dir> --replay <cassette>`，且每盘连跑两次比 zip sha。

---

## 3. 实测：完整命令 + 完整输出

环境：`pnpm` 不在 PATH，改用仓库内 `node_modules/.bin/tsx`（同一执行器，等价）。
provider 路由环境变量**全部未设置**（`env | grep -iE "PAPER_PROBE|DEEPSEEK|DSH_E2E_LLM"` 无输出），
证明回放确实零 key、零网络。

命令（对 2 盘 cassette 各跑 A/B 两次）：

```bash
for cassette in artifacts/handoff/TASK-E/cassettes/*.json; do
  name=$(basename "$cassette" .json)
  ./node_modules/.bin/tsx apps/paper-shell/src/cli.ts run \
    artifacts/handoff/TASK-M1/samples/course-work.md \
    --tier T3 --mode strict --out artifacts/handoff/W8.10/B3-replay-out/$name-a --replay "$cassette"
  ./node_modules/.bin/tsx apps/paper-shell/src/cli.ts run \
    artifacts/handoff/TASK-M1/samples/course-work.md \
    --tier T3 --mode strict --out artifacts/handoff/W8.10/B3-replay-out/$name-b --replay "$cassette"
done
```

完整输出（原样，落盘于 `artifacts/handoff/W8.10/B3-replay-out/console.log`）：

```
################ CASSETTE: artifacts/handoff/TASK-E/cassettes/glm-t3-coursework-v4.json ################
---- RUN A: node_modules/.bin/tsx apps/paper-shell/src/cli.ts run artifacts/handoff/TASK-M1/samples/course-work.md --tier T3 --mode strict --out artifacts/handoff/W8.10/B3-replay-out/glm-t3-coursework-v4-a --replay artifacts/handoff/TASK-E/cassettes/glm-t3-coursework-v4.json ----
[CODE-FRESH] 代码来源已断言：entry lib/index.js is 391030 ms newer than the newest source
[T3] 固定填充面（回归用）：跳过方法族路由——该路径按设计不读题面。
[DELIVERED] sha256=f2fbb3bbc16c4f5a...
  run-id  -> 83f93491-bd9c-4236-8194-961aec8214e0
  report  -> artifacts\handoff\W8.10\B3-replay-out\glm-t3-coursework-v4-a\report.md
  zip     -> artifacts\handoff\W8.10\B3-replay-out\glm-t3-coursework-v4-a\deliverable.zip (zip sha256=ad4125adbf3a4dcd...)
  usage   -> in 2587 tok / out 769 tok / $0.0000 (TASK-Q2 telemetry)
  audit   -> workflow_started,ir_entry_written,(×11),delivery_graded,final_output_written,promotion_succeeded,workflow_completed
  tier    -> T3
EXIT=0
---- RUN B ----
[CODE-FRESH] 代码来源已断言：entry lib/index.js is 391030 ms newer than the newest source
[T3] 固定填充面（回归用）：跳过方法族路由——该路径按设计不读题面。
[DELIVERED] sha256=f2fbb3bbc16c4f5a...
  run-id  -> 3f447b04-88ef-49af-a1a1-d996b56d6742
  report  -> artifacts\handoff\W8.10\B3-replay-out\glm-t3-coursework-v4-b\report.md
  zip     -> artifacts\handoff\W8.10\B3-replay-out\glm-t3-coursework-v4-b\deliverable.zip (zip sha256=ad4125adbf3a4dcd...)
  usage   -> in 2587 tok / out 769 tok / $0.0000 (TASK-Q2 telemetry)
  audit   -> workflow_started,ir_entry_written,(×11),delivery_graded,final_output_written,promotion_succeeded,workflow_completed
  tier    -> T3
EXIT=0
################ CASSETTE: artifacts/handoff/TASK-E/cassettes/glm53flash-t3-coursework-v2.json ################
---- RUN A ----
[CODE-FRESH] 代码来源已断言：entry lib/index.js is 391030 ms newer than the newest source
[T3] 固定填充面（回归用）：跳过方法族路由——该路径按设计不读题面。
[DELIVERED] sha256=6f23b0a25eb393dc...
  run-id  -> b7c47aed-5fc3-4c75-b67c-fc8faeae7b34
  report  -> artifacts\handoff\W8.10\B3-replay-out\glm53flash-t3-coursework-v2-a\report.md
  zip     -> artifacts\handoff\W8.10\B3-replay-out\glm53flash-t3-coursework-v2-a\deliverable.zip (zip sha256=c518fa5918710e9e...)
  usage   -> in 2801 tok / out 972 tok / $0.0000 (TASK-Q2 telemetry)
  audit   -> workflow_started,ir_entry_written,(×11),delivery_graded,final_output_written,promotion_succeeded,workflow_completed
  tier    -> T3
EXIT=0
---- RUN B ----
[CODE-FRESH] 代码来源已断言：entry lib/index.js is 391030 ms newer than the newest source
[T3] 固定填充面（回归用）：跳过方法族路由——该路径按设计不读题面。
[DELIVERED] sha256=6f23b0a25eb393dc...
  run-id  -> a2091447-68ac-471b-91a5-544cb5fc8750
  report  -> artifacts\handoff\W8.10\B3-replay-out\glm53flash-t3-coursework-v2-b\report.md
  zip     -> artifacts\handoff\W8.10\B3-replay-out\glm53flash-t3-coursework-v2-b\deliverable.zip (zip sha256=c518fa5918710e9e...)
  usage   -> in 2801 tok / out 972 tok / $0.0000 (TASK-Q2 telemetry)
  audit   -> workflow_started,ir_entry_written,(×11),delivery_graded,final_output_written,promotion_succeeded,workflow_completed
  tier    -> T3
EXIT=0
```

> 上表 `ir_entry_written,(×11)` 是落盘输出的压缩写法，原始行是 11 个连续的
> `ir_entry_written`（共 16 条 audit 事件），未改动任何字符，见 `console.log`。

### 3.1 确定性断言（机器核验）

```
glm-t3-coursework-v4:        zipA=ad4125adbf3a4dcd8f2582bbff0e025b4a141d974878c889fdb02d991a2511f5
                             zipB=ad4125adbf3a4dcd8f2582bbff0e025b4a141d974878c889fdb02d991a2511f5  EQUAL=YES
glm-t3-coursework-v4:        reportA=reportB=f2fbb3bbc16c4f5a338d11d69cf31c85b4b70400e71723e3867a96090791fd51  EQUAL=YES
glm53flash-t3-coursework-v2: zipA=zipB=c518fa5918710e9ed2f10f32e3d394eac4b6c03ffd9f6da181510650d9778d71  EQUAL=YES
glm53flash-t3-coursework-v2: reportA=reportB=6f23b0a25eb393dc20f0840af1709c1161e148ff36d0df52774a955343219702  EQUAL=YES
```

`grep -niE "miss|blocked|refus|error|fail" console.log` → **无任何命中**
（既无 cassette miss，也无 BLOCKED/拒绝/错误）。

### 3.2 阴性对照（证明"无 miss"不是检测器失灵）

把 v4 的 entry[0] 指纹打乱后另存为 `B3-replay-out/NEGCTRL-perturbed.json` 再回放：

```
[BLOCKED] 调用/传输失败（provider-unavailable）：node '…' exhausted 3 attempts and is paused for review
EXIT=1
```

追踪文件显示 `in_cassette=false` 连续 3 次、`status=BLOCKED`、`code=provider-unavailable`。
**miss 检测器是活的**：指纹不匹配必然以 exit 1 + BLOCKED 收场。故 §3 的 exit 0 是
真实命中，不是"检测不到"。

---

## 4. 指纹分析（逐调用追踪）

用未跟踪的证据脚本 `B3-replay-out/b3-trace.mts` 包住 `CassetteReplayer.prototype.answerWithUsage`，
记录引擎在回放时**实际算出的**每个指纹（只读，不写 cassette、不改 apps/packages）。

v4（`trace-v4.jsonl`）：

| call | 指纹前 16 | in_cassette | prompt 字符 | 调用性质（据 prompt 头） |
|---|---|---|---|---|
| 0 | `99040b43028513af` | **true** | 155 | plan（`Produce a short numbered execution plan`） |
| 1 | `3b04c706f5a6dead` | **true** | 395 | `T3 template fill-in` |
| 2 | `032bcc0fae030a67` | **true** | 2504 | canonical context（interpretation） |
| 3 | `8cbaf84201a65de4` | **true** | 1039 | `Current text:`（revise） |
| 4 | `c59222b8b1232d38` | **true** | 2883 | canonical context（re-review） |

flash（`trace-flash.jsonl`）：`99040b43028513af` / `3b04c706f5a6dead` / `032bcc0fae030a67` /
`c53c095f450f60bf` / `638d61de6a63a29c`，**5/5 全部 `in_cassette=true`**。

两条关键观察：

1. **10 次调用全部命中，零 miss。** 两个 cassette 的 entry[0]、entry[1]、entry[2]
   指纹**完全相同**（`99040b43028513af…`、`3b04c706f5a6dead…`、`032bcc0fae030a67…`）
   ——同一 harness、同一题面、同一 T3 面，前三个请求逐字节一致，只有模型回答不同。
2. **追踪里没有任何 E2 提示词。** 对 trace 全文做 `includes('NORMALIZING')` 与
   `includes('modeling analysis')` 均返回 **false**。T3 路径的 5 次调用是
   plan → T3 fill-in → interpretation → revise → re-review，**与 E1/E2 无关**。

### 4.1 独立佐证：usage 逐字相等

cassette 录了 usage（TASK-Q2），回放的 run-report 把它逐字复现。**求和恒等式**证明
回放确实消费了 cassette 的**每一条** entry（不是"碰巧没走到那条"）：

| cassette | cassette 内 in/out 求和 | 回放 run-report | 相等 |
|---|---|---|---|
| `glm-t3-coursework-v4` | 2587 / 769 | 2587 / 769 | **YES** |
| `glm53flash-t3-coursework-v2` | 2801 / 972 | 2801 / 972 | **YES** |

---

## 5. 逐字代码核对：`e2PromptWithGuidance` 空引导恒等性

**结论：该性质成立——但成立的范围比 commit message 说的窄，见 §5.1。**

`packages/paper/paper-foundation/src/produce/e2-guidance.ts:187-190`：

```ts
/** The E2 prompt with the guidance appended (or the bare prompt when empty). */
export function e2PromptWithGuidance(basePrompt: string, guidance: string): string {
  if (guidance.length === 0) return basePrompt
  return `${basePrompt}\n\n${guidance}`
}
```

逐字核对：`guidance.length === 0` 时**返回 `basePrompt` 本身**（不是 `basePrompt + ''`、
不是任何等价重拼），**无分隔符、无尾随换行**。恒等性成立。

上游 `e2DriftGuidance`（同文件 `138-142`）在**两个输入都空**时返回 `''`：

```ts
const hasViolations = priorViolations.length > 0
const hasRegistered = registeredIds.length > 0
if (!hasViolations && !hasRegistered) return ''
```

调用点 `executor.ts:1461-1470`：`baseE2Prompt = e2NormalizationPrompt(e1Text, EXECUTE_PROTOCOL_TEACHING)`
是 W8.9 的**原样**调用（`git show 11b10efeff:.../executor.ts:1412` 逐字一致：
`const e2Prompt = e2NormalizationPrompt(e1Text, EXECUTE_PROTOCOL_TEACHING)`），
B 只是把它改名为 `baseE2Prompt` 再套一层。**B 组没有改 `e2NormalizationPrompt` 本身**
（`git show --stat e5ffdae03f` 只碰了 `executor.ts`、新增 `e2-guidance.ts`、`executor-e1e2.spec.ts`；
`e1-e2.ts` 不在 B 的改动清单里）。

实测（`B3-replay-out/b3-pure.mts`，直接 import 源码）：

```
A) e2PromptWithGuidance(base, "") === base  -> true
   returned bytes: "BASE-PROMPT-BYTES"
B) e2DriftGuidance(no violations, no ids) -> "" (len 0)
```

### 5.1 ⚠ 该恒等性的**适用范围**被 commit message 说过头了

B 的 commit message 与 `executor.ts:1462-1465` 的注释都写着：

> "Empty on the first attempt (the prompt is then byte-identical to W8.9's — the backfill is
> confined to retries, which is also what keeps the cassette corpus valid for runs that never retry)"

**这句"first attempt ⇒ 空引导"在 B 自己的代码里就不成立。** 引导非空的条件是
`hasViolations || hasRegistered`，而 `registeredIds` 走的是 `registeredIdsOf()`
（`executor.ts:600-608`，读 canonical store 快照）——**只要 store 非空，首次尝试就带引导**。

实测（`B3-replay-out/b3-firstattempt.mts`，用脚本化 provider 驱动工作树 executor 跑一次
T1/T2 接收层首试）：

```
E2 call count on this run: 2
first E2 prompt chars: 6306
contains E2_DRIFT_HEADER      : true      <-- 首次尝试就带引导
contains "What went wrong"    : false     <-- 但确实没有"上次违规"（纠正性内容）
contains "ALREADY REGISTERED" : true
contains "R-OUT"              : true
```

（该次运行因我给的假容器 `parse_failed` 而最终 BLOCKED，与本判定无关；这里只取
"首次 E2 的 prompt 内容"这一事实。）

**但这条不构成对 cassette 的威胁**，理由有二：

1. **对既有语料无影响**：两个 cassette 都走 T3，压根没有 E2 调用（§4 追踪实证），
   引导在结构上无法进入它们的指纹。**H9 判定不受此影响。**
2. **这条偏差由 W8.10-D1 显式确认并保留**。工作树/HEAD 的测试
   `executor-e1e2.spec.ts:620` 已改名为
   `'a first-attempt success gets NO *corrections* (only the registered-id list)'`，
   并在注释里写明：

   > "B1 has two halves. ② (the registered-id list) is PREVENTIVE — it must be present from
   > the first attempt, because the duplicate-id failure it prevents (`S-P` declared twice)
   > happens on attempt one. ③ (the prior violation) is CORRECTIVE and may only appear after a
   > refusal. 'First attempt gets no guidance' was the wrong statement; the right one is
   > 'first attempt gets no corrections'."

   即：**首次尝试带"预防性 id 清单"是有意为之**（正是 W8.9 run-3 `conflicting_id` 的修复），
   只有"纠正性回灌"才被限制在重试。所以这是一处**注释/commit message 与代码语义不一致的
   文档缺陷，不是行为缺陷**——`executor.ts:1462-1465` 的注释与
   `executor-e1e2.spec.ts` 里已修正的措辞互相矛盾，建议同步。

**给后续的推论**：如果将来录一盘走 T1/T2 接收层的 cassette，那么"首次尝试的 prompt 与
W8.9 逐字节相同"这条**不能**用来保证兼容——那时首试 prompt 已含 id 清单（实测 6306 字符，
其中引导 985 字符）。届时该 cassette 的回放兼容性要靠"引导文本的确定性"
（`registeredIdsOf()` 已 `sort()`，见 `executor.ts:605-607`）来保证，而不是靠"空引导恒等"。

---

## 6. 时序注记（重要，避免读者误读证据）

本判定执行期间**仓库被并发提交**：开始时 HEAD = `e5ffdae03f`（B），会话中途变成
`04d98cc378`（W8.10-D1）。因此：

- **§3 的 4 次回放（23:30）** 运行在 HEAD = `e5ffdae03f` 的代码上，`[CODE-FRESH]` 断言
  通过（lib 比最新 src 新 391030 ms）；
- **23:35 之后的追踪/探针** 看到 `[CODE-STALE]` 警告（lib 落后于 D1 改的 src）。
  **这对判定无影响**：真实运行读 `lib`（`packages/paper/paper-foundation/lib/index.js`，
  sha256 `3ec2a2c037fc4d58f4d336b90e731129ce64eac47c234b8ea81244188422d55a`，mtime 14:20:04），
  而 `lib` 是**未跟踪的构建产物**，全程未变；`--replay` 属离线模式，`[CODE-STALE]` 按设计
  仅告警不拒绝（`cli.ts:365-378`）；
- 同一份 `lib` 在 `[CODE-STALE]` 下再次回放仍得 `report sha = f2fbb3bbc16c4f5a…`、
  `usage = 2587/769` 逐字相同（`trace-v4/`），**证明判定结论对 D1 前后都稳定**。
- 唯一受影响的产物是 zip 内的 `run-report.json`：其中的 `code_provenance.ok` 字段随
  `[CODE-FRESH]`→`[CODE-STALE]` 从 `true` 变 `false`（`report.md` 与 `sha256.txt` 逐字节不变，
  已 diff 确认）。这是 provenance 记录的正常语义，**不是 cassette 缺陷**。
- **我未修改任何被跟踪文件**：`git status --porcelain -- packages/ apps/ bench/` 只列出
  D1 自己留下的两处（`e1-e2.ts`、`executor-e1e2.spec.ts`），我写的全部产物都在
  `artifacts/handoff/W8.10/B3-replay-out/` 下（未跟踪）。
  **cassette 未被删除、未被修改**（红线 N15 遵守）。

---

## 7. 缺陷与建议

**未发现任何 cassette 相关的既有 miss 或新缺陷。** H9 通过。

以下两条是**非阻塞**的文档/一致性问题，建议随手修：

1. **`executor.ts:1462-1465` 的注释与代码语义不符**（§5.1）。注释说"首次尝试引导为空、
   prompt 与 W8.9 逐字节相同"，实际首次尝试在 store 非空时**已带预防性 id 清单**。
   工作树的测试（`executor-e1e2.spec.ts:620`）已把措辞修正为"首次尝试无**纠正**"，
   注释应同步，否则下一个读者会用这条错前提去推 cassette 兼容性。
2. **B 的 commit message 同一句**（"空引导时 prompt 与 W8.9 逐字相同"）建议加限定：
   "仅在 `priorViolations` 与 `registeredIds` **皆空**时"。

**结论一句话**：H9 通过——两盘 cassette 各回放两次全部 DELIVERED、零 miss、zip/report sha
逐字节相同；根因是这两个 cassette 走 T3 路径（`executor.ts:1385` 的 `else if` 先截走，
永不进入 `1400` 的 E1/E2 分支，实测追踪中零 E2 调用），B 组的引导在结构上无从影响其指纹。
`e2PromptWithGuidance` 的空引导恒等性（`e2-guidance.ts:188`）**逐字成立**，但"首次尝试
必为空"这条推论不成立（首试即含预防性 id 清单），该偏差已被 D1 显式确认为有意设计。
