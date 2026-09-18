# W8.10-C1 — DP-4 spike：执行期能否【捕获】`dt` / `N` / `solver_config`

> **性质：只读探测（read-only probe）。**
> 本轮未修改 `packages/` 或 `apps/` 下任何文件；唯一新增物是本目录下的
> `probe-dp4-config-capture.mts`（探针）与 `.probe-dp4-output.txt`（原始输出归档）。
> 探测的**变量是结论**（DP-4 能否成立），不是代码状态——因此本报告的证据与
> 探针脚本同轮归档，但二者相互独立：报告只引用探针的 stdout，不引用探针的意图。

---

## 结论（一句话）

**能捕获——且捕获路径已经存在、已在生产路径上跑通**：`code → jsonPath → Result`
（`produceInterpretation`）能把模型声明为**可执行片段**里的 `dt` / `N` /
`solver_config.rtol` 等**数值**逐个读回 canonical store，值来自真实执行字节，
模型散文从不参与；**但**当前通道的载体 `Result.value` 是 `zod.number()`，
所以 `solver_config` 里**非数值**的成员（如 `method: "RK4"`）与**整个对象**
都**没有** Result 形态的载体——这是"部分能"，边界恰好落在**数值 vs 结构**上。

---

## 一、实测证据

### 1.1 命令

```bash
cd "D:/deepseek modex/deepseek-harness"
node_modules/.bin/tsx "artifacts/handoff/W8.10/probe-dp4-config-capture.mts"
```

原始输出归档：`artifacts/handoff/W8.10/.probe-dp4-output.txt`（exit 0）。
探针驱动的是**真实生产链**：真 node 子进程（`LocalProcessRunner`）写文件 →
`captureExecution` 捕获 → `produceInterpretation` 铸 Result。

### 1.2 正向：`dt` / `N` / `solver_config.*` 逐个捕获（SECTION A）

模型 `code` 里的配置字面量（`code` 是唯一允许出现数字的地方）：

```js
const config = { dt: 0.25, N: 200, solver_config: { method: "RK4", rtol: 1e-6, atol: 1e-9 } };
fs.writeFileSync("result.json", JSON.stringify({ config, mean_thickness: 0.731 }));
```

真实执行字节（探针实测回读）：

```
{"config":{"dt":0.25,"N":200,"solver_config":{"method":"RK4","rtol":0.000001,"atol":1e-9}},"mean_thickness":0.731}
```

经 `jsonPath` 铸成的 canonical Result：

```
A:   RES-DT       name=config.dt                  value=0.25     canonical_agrees_with_bytes=true src=file:///runs/RUN-DP4/result.json#config.dt
A:   RES-N        name=config.N                   value=200      canonical_agrees_with_bytes=true src=file:///runs/RUN-DP4/result.json#config.N
A:   RES-RTOL     name=config.solver_config.rtol  value=0.000001 canonical_agrees_with_bytes=true src=file:///runs/RUN-DP4/result.json#config.solver_config.rtol
A:   RES-ATOL     name=config.solver_config.atol  value=1e-9     canonical_agrees_with_bytes=true src=file:///runs/RUN-DP4/result.json#config.solver_config.atol
A: VERDICT — 4 scalar config numbers captured from executed bytes, model prose never consulted
```

`canonical_agrees_with_bytes=true` 是探针**独立重算**的结果：它用
`resolveJsonPath` 直接从字节再取一次，与 store 里的 `Result.value` 比对。

### 1.3 M5 形状：`config.json` 作为独立 run output（SECTION A5）——推荐形态

```
A5: two declared outputs produced: [file:///runs/RUN-DP4-CFG/config.json, file:///runs/RUN-DP4-CFG/result.json]
A5:   RES-CFG-DT     dt                 = 0.25      s              file:///runs/RUN-DP4-CFG/config.json#dt
A5:   RES-CFG-N      N                  = 200       dimensionless  file:///runs/RUN-DP4-CFG/config.json#N
A5:   RES-CFG-RTOL   solver_config.rtol = 0.000001  dimensionless  file:///runs/RUN-DP4-CFG/config.json#solver_config.rtol
A5: VERDICT — the M5 shape WORKS: config is a first-class run output,
A5:           pinned by RunArtifact.code_hash = sha256:41aa51c4d5300…
```

即：**`RunArtifact.output_refs` 可以声明多个输出**，配置因此成为一个
**被 `code_hash` 钉住的一等 run 产物**——配置与产出它的代码同源同哈希，
这正好是 M5 诊断要的"一类对象"。

### 1.4 边界：非数值与整对象**不能**进 Result（SECTION A2 / A3 / B）

```
A2: REFUSED result_source_invalid: result 'RES-METHOD': path 'config.solver_config.method' ... does not resolve to a finite number (got RK4)
A2: VERDICT — a non-numeric config value has NO Result-shaped carrier in the current IR

A3: the executed bytes DO carry the object verbatim: {"method":"RK4","rtol":0.000001,"atol":1e-9}
A3: it is reachable by resolveJsonPath but has no typed carrier (Result.value is zod.number())
A3: sha256 of the config subtree = sha256:3f1761b370ee59a4be62744bb7a6b9e300c7d38279ad0a3ffb92f090426c5889

B: REFUSED result_source_invalid: result 'RES-CFG-OBJECT': path 'config.solver_config' ... (got [object Object])
B: Results written to canonical store = 0 (0 means the refusal is atomic)
```

三个要点：
- `method: "RK4"` 这类**非数值**配置**没有**载体——`Result.value` 是
  `zod.number()`（`ir/schema.ts:236`），refusal 是 schema 级的，不是策略级的。
- 整个 `solver_config` 对象同样被拒；但它在字节里**完整存在**且**可哈希**
  （A3 的 sha256），所以"配置指纹"是可做的，"配置入 Result"不是。
- B 的 `Results written = 0` 证明 refusal 是**原子**的：整批声明一起拒，
  不会留下半个 Result。这条对 M5 很重要——失败是干净的回退，不是脏状态。

### 1.5 边界：代码没写的数字**无法**捕获（SECTION A4）

```
A4: REFUSED result_source_invalid: result 'RES-NEVER-WRITTEN': path 'config.dx' ... (got undefined)
A4: VERDICT — capture is CONDITIONAL on the code emitting the number; there is no side channel
```

捕获**不是**"读心"：`dt` 必须由**执行的代码**写出来。这是通道的定义，不是缺陷——
但也说明 M5 的 `CapabilitySpec` 若要引用配置，必须要求 `code` 显式 emit 它。

### 1.6 `run` 块**不能**声明配置（SECTION C / E）

`dt` 放进 container 的 `run` 块会被 executor 拒（白名单只允许
`outputBasenames` / `seed`）：

```
C: parseModelContainer accepted = true (run block is schema-open at parse time)
C: run block seen by the parser = {"outputBasenames":["result.json"],"seed":20260903,"dt":0.25}

E: executor REJECTED code=gate-failed
E: message = node '…' circuit-broken: DRIFT:PRODUCE_RUN_DECLARATION_INVALID: failed identically on consecutive attempts — a third retry is known-ineffective (W8.6-A4)
```

E 是**真实 executor 端到端**跑出来的（`ctx.paperExecutor.runs.execute`），不是
对私有函数的猜测——refusal 走的是正式失败分类 `DRIFT`。

**位置**：`packages/paper/paper-foundation/src/executor.ts:1025`
（`allowedRunKeys`）、`:1028`（refusal 返回）。

> 这条**不是**坏消息，反而是 M5 的**护栏**：它证明"配置不能从模型 pen 直接
> 声明进 IR"这条既有纪律是**活的**，因此 M5 不必自己再发明一遍。

### 1.7 一个需要记录的反例：`parameter_refs[].value` 是**声明**通道（SECTION F）

```
F: ModelSpec.parameter_refs[].value = 0.25 accepted = true
F: stored in canonical store = [{"symbol_ref":"SYM-rho","value":0.25}]
```

`ModelSpec.parameter_refs[].value` 是 `zod.number()`（`ir/schema.ts:174`）且
`ModelSpec` 在模型面白名单内（`produce/ir-producer.ts:53-58`）——**模型可以直接
写一个数字进 canonical store**。这与"零数字通道"并不矛盾（它是一条**声明**
通道，且被 `evidence-freeze` / bridge 追踪），但它**不是**捕获通道：
它不来自任何 run、**没有任何字段把它绑到 RunArtifact**、也没有 `code_hash`
把它钉住。M5 若需要"配置与执行可复现地绑定"，**不能**用它。

### 1.8 `seed` 的旁证：声明与捕获是两回事（SECTION D）

```
D: child-visible seed material = {"seed_env":[],"argv":[],"all_env_keys":[…80+ keys…]}
D: RunArtifact.seed (declared, canonical) = 20260903
D: ExecutionRecord.seed (captured)      = 20260903
```

`seed` 被**捕获**进了 `ExecutionRecord`（`execution/capture.ts:115,152`，来源
`run.seed`），但 runner **从不把它交给子进程**——`ExecutionRequest.seed`
（`execution/runner.ts:29`）在 `LocalProcessRunner.run`（`:97-109`）里没有任何
消费者：既不进 env，也不进 argv。

这对 M5 是**重要的警告**：**"配置进了 IR" ≠ "配置影响了这次执行"**。
`seed` 就是现成的例子——它被记为环境的一部分（`execution/audit.ts:278-286`
把 seed drift 判为 environment mismatch），却对子进程零影响。若 M5 的
`dt` 走同一条路（只声明、不交付），"配置复现"会变成**空断言**。
M5 必须走 **A5 形态**（配置由 code emit），才能保证配置**真的驱动了**执行。

---

## 二、判定：部分能，边界在"数值 vs 结构"

| 对象 | 能否捕获 | 机制 / 原因 |
|---|---|---|
| `dt` / `N` 等**标量数值** | **能** | `jsonPath` → `Result.value`（`zod.number()`） |
| 嵌套数值 `solver_config.rtol` | **能** | 点路径 `resolveJsonPath`（`interpretation-producer.ts:149-156`） |
| 整份 `solver_config` **对象** | **不能** | 无对象载体；`Result.value` 是 `zod.number()`（`ir/schema.ts:236`） |
| `solver_config.method` 等**非数值** | **不能** | 同上，`:262-268` 的 finite-number 检查 |
| 配置**指纹**（对象哈希） | **能**（但需新字段） | 字节可 `sha256Hex`（A3 实测），IR 里无现成字段承载 |
| `run` 块里**声明**配置 | **不能**（且是护栏） | `executor.ts:1025-1028` |
| `parameter_refs[].value` | 能写，但**不是捕获** | 声明通道，无 run 绑定（§1.7） |

**关键文件与行号**

| 机制 | 位置 |
|---|---|
| 数值回读（jsonPath → Result） | `packages/paper/paper-foundation/src/produce/interpretation-producer.ts:149`（`resolveJsonPath`）、`:261-277`（铸 Result，`:262` finite 检查，`:276` 写 `source_location = locator#jsonPath`） |
| Result 闭 schema（数值载体） | `packages/paper/paper-foundation/src/ir/schema.ts:229-241`（`value: zod.number()` 在 `:236`） |
| 执行期独立复核（replay） | `packages/paper/paper-foundation/src/execution/replay.ts:213`（`extractResultValue`）、`:217`（拆 `#fragment`）、`:235`（finite 检查） |
| 运行块白名单 | `packages/paper/paper-foundation/src/executor.ts:1025`、`:1028` |
| 基名→canonical locator 归一 | `packages/paper/paper-foundation/src/executor.ts:2222`（`normalizeInterpretationLocators`）、调用点 `:1115` |
| 捕获（唯一 ExecutionRecord 生产者） | `packages/paper/paper-foundation/src/execution/capture.ts:75`（`captureExecution`）、`:113-117`（run）、`:152`（`seed`） |
| runner 不交付 seed | `packages/paper/paper-foundation/src/execution/runner.ts:29`（字段）、`:97-109`（`run`，无消费者） |
| 模型面白名单（`ModelSpec` 可写） | `packages/paper/paper-foundation/src/produce/ir-producer.ts:53-58` |
| `parameter_refs[].value` 数值字段 | `packages/paper/paper-foundation/src/ir/schema.ts:174` |

---

## 三、对 M5 的直接含义

DP-4 **不需要**新机制就能成立：M5 需要的 `dt` / `N` 类数值配置，**今天**就能
经 `code → jsonPath → Result` 捕获，且已在真实子进程上跑通（§1.2）。

M5 真正需要补的是**三处结构缺口**，且都不是"解析散文"能解决的：

1. **对象/非数值配置无载体**（§1.4）。`solver_config` 作为**整体**需要一个
   IR 对象来承载（可哈希、可引用）。这是 `CAPABILITY-SCHEMA.md` 的
   `at_config_ref`（`docs/quality/CAPABILITY-SCHEMA.md:90`）指向
   `RunArtifact` 却**指不到配置本身**的结构原因。
2. **配置与执行的绑定**（§1.8）。`seed` 的反例说明"记在 IR 里"与"交付给
   执行"是两件事。M5 的配置必须走 **A5 形态**（由 `code` emit 成 run output），
   这样 `code_hash` 才能把"配置"与"产出它的代码"钉在一起。
3. **配置的交付语义未定义**（§1.8）。若 M5 期望配置**影响**求解，需要一个
   明确的交付契约（env / argv / 生成文件），并有一个 gate 验证它真的到了。

`docs/quality/CAPABILITY-SCHEMA.md:88-90` 的 `at_config_ref: refSchema.nullable()`
指向 `RunArtifact`——按本次实测，这个指向**是可行的**（RunArtifact 确实是配置
的 owner），但前提是配置走 A5 形态成为 run output，否则 `at_config_ref` 会指向
一个**不携带配置**的 run。

---

## 四、备选方案

**DP-4 没有失败，因此本节不是"降级路径"清单。** 下列是**加强** M5 的候选，
按推荐度排序；**从模型散文解析配置不在其中，也不应进入任何备选**——
M5 自身诊断（"缺的是一类对象，不是一条检查"）与散文解析直接矛盾。

1. **（推荐，零新机制）配置即 run output。** 要求 `code` 写出 `config.json`
   并列入 `outputBasenames`；`dt` / `N` / 数值型 `solver_config.*` 用
   `jsonPath` 铸成 Result。**今天即可用**，实测见 §1.3。缺口只剩"整对象"。
2. **（小改动）给配置一个 IR 载体。** 新增一个承载**结构化配置**的 IR kind
   （或扩展 `RunArtifact`），其值从 run output 字节派生、以 sha256 钉住。
   这使 §1.4 的"整对象"与"非数值"变得可捕获、可引用，并让
   `at_config_ref` 有真正的落点。
3. **（小改动）把配置交付显式化。** 为 runner 增加一个受控的配置交付通道
   （env 或生成文件），并加一条 gate 断言"声明的配置确实到达了子进程"。
   这直接消除 §1.8 的 `seed` 式空断言风险。
4. **（若 1–3 都不做）** 则 M5 的 `at_config_ref` 只能表达"配置跑在哪个 run 上"，
   **不能**表达"配置是什么"——此时应**回头重估 M5 可行性**，而不是退到
   散文解析。

---

## 五、可复现性

```bash
cd "D:/deepseek modex/deepseek-harness"
node_modules/.bin/tsx "artifacts/handoff/W8.10/probe-dp4-config-capture.mts"
```

- 探针：`artifacts/handoff/W8.10/probe-dp4-config-capture.mts`
- 原始输出：`artifacts/handoff/W8.10/.probe-dp4-output.txt`（exit 0）
- 环境：Node v24.13.0，Windows，tsx 4.22.4
- 探针全程在进程内构造 store；不写 `packages/` / `apps/`，不碰 canonical 存储。
  它执行的唯一外部进程是 `node main.js`（由 `LocalProcessRunner` 在临时目录中运行）。
