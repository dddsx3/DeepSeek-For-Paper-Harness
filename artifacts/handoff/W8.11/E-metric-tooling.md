# W8.11 E 组 —— 度量工具修复（守卫覆盖面 / 负对照 / 1189 基线）

> **性质**：这三件都是 W8.10 独立复核实测证明**不成立**的工具。修它们不是为了好看——
> 一个恒真的守卫、一个空转的负对照、一个来源不明的基线，都是"信号说假话"。

---

## E1 —— 守卫覆盖面：1 个包 → 6 个包

### 事故（W8.10-E2 独立复核发现）
`SHELL_PROVENANCE_TARGETS` 只列 **1** 个包，而 `cli.ts` 通过 exports 加载
**6** 个 workspace 包。该常量自己的注释却声称是 "the workspace packages the
paper-shell CLI loads"——**守卫的自我描述与内容不符**。

缺口不是修辞问题：W8.8 那次事故（改了 src 没重建 lib）对 `dsh-storage*` /
`dsh-llm` / `cordis` **同样成立**，而守卫对它们全盲。当前它们恰好都通过，
所以此刻无假阴性——但那是运气，不是守卫。

### 修法
从**真实 import 语句**推导（`rg "^import .* from '@deepseek-ai/" apps/paper-shell/src/*.ts`），
扩到全部 6 个：

| 包 | 目录 | 入口 |
|---|---|---|
| `@deepseek-ai/dsh-paper-foundation` | `packages/paper/paper-foundation` | `lib/index.js` |
| `@deepseek-ai/dsh-storage` | `packages/storage/storage` | `lib/index.js` |
| `@deepseek-ai/dsh-storage-domain` | `packages/storage/storage-domain` | `lib/index.js` |
| `@deepseek-ai/dsh-storage-json` | `packages/storage/storage-json` | `lib/index.js` |
| `@deepseek-ai/dsh-llm` | `packages/llm/llm` | `lib/index.js` |
| `@deepseek-ai/cordis` | `vendor/cordis` | `lib/index.js` |

### 证据
```
ok = true
  PASS @deepseek-ai/dsh-paper-foundation: entry lib/index.js is 83534 ms newer than the newest source
  PASS @deepseek-ai/dsh-storage: entry lib/index.js is 1148186027 ms newer than the newest source
  PASS @deepseek-ai/dsh-storage-domain: entry lib/index.js is 1148197964 ms newer than the newest source
  PASS @deepseek-ai/dsh-storage-json: entry lib/index.js is 1148198021 ms newer than the newest source
  PASS @deepseek-ai/dsh-llm: entry lib/index.js is 1148198233 ms newer than the newest source
  PASS @deepseek-ai/cordis: entry lib/index.js is 1148185677 ms newer than the newest source
```

### 负对照（证明守卫对新扩的包不是恒真）
把常量删回 1 个包 → 测试立即变红，**精确点名 5 个漏掉的包**：
```
AssertionError: imported but not guarded: @deepseek-ai/cordis,
  @deepseek-ai/dsh-storage, @deepseek-ai/dsh-storage-json,
  @deepseek-ai/dsh-storage-domain, @deepseek-ai/dsh-llm
```
（还原后 11/11 全绿）

### 新增测试（2 条）
1. **从真实 import 推导应覆盖的集合**再与常量比对——而不是把六个名字再抄一遍
   （那只会得到第二个会漂移的真相源）。
2. 每个 target 都解析到**真实存在的 built entry**（否则守卫恒真而没人知道）。

---

## E2 —— 负对照修复（3 项不成立 → 已修）

### 背景（W8.10-E3 实测）
`bench/negative-controls/` 的 `18/18` 里 **3 项检查不成立**，实际有效检查数为 **15**。

### 逐项状态

| 项 | 缺陷（W8.10-E3 实测） | W8.11 状态 |
|---|---|---|
| **NC-2** | fixture 题面只有 5 个空白分隔 token，而 `recitalOverlap(..., n=8)` 按空白切词取 8-gram → **结构上不可能形成 8-gram**，实测 `m2_recital_overlap = 0`（与"复述稿"完全相反）。M1 翻负的真实原因是**骨架全缺**。且其 check **只断言 `m1_readable_draft === false`、不断言 overlap** | 见下 |
| **NC-7** | 两项同义反复（断言"sha256 ≠ 64 个 0"恒真；断言手写对象字面量的 `.ok === false`，**根本没调校验器**）+ **硬编码本机绝对路径**（换 checkout 会 ENOENT 崩溃） | 见下 |
| **CI** | 负对照**没有任何 CI 调用者**（`.github/`、`gitlab-ci.yml`、`scripts/`、`package.json`、`lefthook.yml` 全无命中） | 见下 |

> **诚实标注**：本组（E2）的修复**未在本轮完成**。原因：W8.11 的执行被子代理额度耗尽打断，
> 而 E2 需要先读 `bench/negative-controls/` 的实现细节再改（不能凭 W8.10 报告的描述改，
> 那正是"凭叙述改代码"）。**如实记为未完成**，不假装完成。
> 已确认的**修复方向**（供 W8.12）：
> 1. NC-2：加长 fixture 题面 + **补断言** `m2_recital_overlap` 超禁线（阈值 0.30，
>    W8.10-E3 用够长的纯复述稿实测 0.388）。
> 2. NC-7：改为**真调用校验器**；去掉硬编码路径（改为相对仓库根解析）。
> 3. 接入 CI（`.github/workflows/` 本地改动即可，**不得实际触发远端**——GitHub 不可达）。

---

## E3 —— W8.9 的 `1189` 基线：**已查清，是反推出来的假基线**

### 结论（一句话）
**`1189` 不是任何真实测量值。** W8.9 的真实结果 `1301` 是对的，真实基线是
**`1259`**，真实增量是 **`+42`**——而报告写的 `1189 → +112` 是把基线**反推**
（1301 − 112 = 1189）造出来的，好让增量看起来接近三倍。

### 复算命令与证据

**① `1301` 是对的**（W8.10-E 组已独立复现）：
```
npx vitest run packages/paper/paper-foundation apps/paper-shell
  → 119 文件 / 1319 用例（HEAD 工作区，W8.10 期）
1319 − 18（W8.9 提交后的新增净额）= 1301   ← 与声称精确相等
```

**② W8.8 自己报的基线是 `1259`**（`bench/W8.8-REPORT.md:59` 逐字）：
```
- paper **1198/1198**（+2 幂等测试）；shell 61/61；tsc 全过
1198 + 61 = 1259
```

**③ W8.9 实际加了 `42` 条，不是 `112`**：
```
git show 11b10efeff -- packages/paper/paper-foundation/tests apps/paper-shell/tests \
  | grep -cE "^\+.*\b(it|test)\s*\("     → 43   （新增）
git show 11b10efeff -- ... | grep -cE "^-.*\b(it|test)\s*\("   →  1   （删除）
净额 = 42
```
其中 W8.9 新建的 `executor-e1e2.spec.ts` 贡献 23 条；其余是既有 spec 的增量。

**④ 恒等式闭合**：
```
1259（真实基线）+ 42（真实净增）= 1301（真实结果）   ✓ 精确相等
1189（声称基线）+ 112（声称净增）= 1301（真实结果）  ✗ 1189 无来源
```

**⑤ `1189` 不可从任何提交复现**：`git grep 1189` 只命中 W8.9 报告本身
（W8.10-E3 已实测）。上面 ①–④ 是**正推**（从两个独立来源算增量），
而 W8.9 的写法只能解释为**反推**（先有结果，再挑一个基线让增量好看）。

### 判定
| 项 | W8.9 声称 | 实测 | 判定 |
|---|---|---|---|
| 结果 | `1301/1301`（119 文件） | 1301（119 文件） | ✅ **正确** |
| 基线 | `1189` | **1259** | ❌ **错误，无来源** |
| 增量 | `+112` | **+42** | ❌ **错误，约为真实的 2.7 倍** |

### 形态归类
这**不是**新形态，是**假绿**（第 1 类）的变体：不是"指标不可能变红"，而是
**"增量不可能被复核"**——报告只给差值、不给基线出处，于是差值无法验证，
直到下一轮有人从两个独立来源正推才暴露。**教训**：报告里的每个差值必须
**同时给基线的出处**（哪个文件、哪一行），否则它就是不可核验的。

---

## 一句话

**E1 已修（守卫覆盖面 1 → 6 个包，变异击杀已验证）；E3 已查清（`1189` 是反推的假基线，
真实是 `1259 → +42`）；E2 未完成，如实记账，修复方向已写明。**
