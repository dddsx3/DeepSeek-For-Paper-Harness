# 检查点 03 — declare 重跑（第二轮 / 第三轮）

> 切片：`03-declare`（第二轮）、`04-declare`（第三轮）——`02-declare`（第一轮）已按 `superseded` 保留
> 配置：`--resume <slices>`（播种 analyze）+ `--pause-after declare`
> 日期：2026-09-24

---

## 1. 结论

**两轮都没过，但第二轮是一次**实质性的**修复**；第三轮证明**提示层教学已到平台期**。

| 轮次 | 改了什么 | `evaluation` | `references` | 结果 |
|---|---|---|---|---|
| 第一轮 | —（基线） | 49 / 800 | 124 / 600 | ❌ |
| **第二轮** | **E2 的 prompt 拼上 produce 简报（正文契约）** | **724 / 800** | **359 / 600**（5 条） | ❌ 但**改善 15× / 3×** |
| 第三轮 | 再点名"这两章完全靠你 + 地板数字" | 778 / 800 | 272 / 600 | ❌ 平台期 |

（均为**合并后**的字数，判据见 `CHECKPOINT-02-CORRECTION.md`。）

---

## 2. 第二轮：修的是什么，效果如何

### 2.1 修法

E2 的 prompt 从 `e2NormalizationPrompt(e1Text, constitutionText())` 改为再拼一份
**produce 简报**——正文契约的载体。简报里含篇幅地板、参考文献规则、评价四要素。

**为什么复用 `produce` 简报而不是新写一份**：判据必须单一来源。新写一份 = 两条会漂移的
副本，而漂移的那天没人会发现——正是本轮格式审计抓到的那类问题。

### 2.2 效果（同一次运行内、同一 E1、只改了 prompt）

| 章 | 第一轮 | 第二轮 | 倍数 |
|---|---|---|---|
| `analysis`（容器自写部分） | 72 | 853 | 12× |
| `evaluation` | 49 | **724** | **15×** |
| `references` | 124（3 条） | **359（5 条）** | 3× |
| `code` | 96 | 328 | 3.4× |
| `restatement` | 32 | （达标，未报） | ✅ |

**评价章四要素**：第一轮缺"优点""局限"；第二轮**四项齐全**。

**参考文献的方法关键词规则**：第一轮**违规**；第二轮**通过**——harness 只报了篇幅，
没报关联性。也就是说 **round-5 的头号阻断（"参考文献与本文所用方法没有可辨的关联"）
在这一轮被这条修法解决了**。

---

## 3. 第三轮：为什么没继续改善

第三轮我在 E2 的 prompt 里**点名了那两章与地板数字**：

```
TWO CHAPTERS ARE ENTIRELY YOURS — nobody else writes them:
- `narrative.evaluation`: floor is 800 characters. Four labelled passages: 优点/局限/敏感性/推广.
- `narrative.references`: floor is 600 characters, at least 3 complete entries …
Every other chapter gets help: your E1 analysis is merged into analysis and methods, and your real
code is appended to code. These two get none — if you leave them short, the paper is refused for
exactly that reason.
```

结果：`evaluation` 724 → **778**（差 22 字），`references` 359 → **272**（**更差**）。

**判据标定没问题**——我用唯一合法标准（参照物）量过：

| 章 | 参照物实测 | 我们的地板 | 判定 |
|---|---|---|---|
| 参考文献 | **3,350 字 / 20 条** | 600 | 地板**偏宽松** |
| 模型的评价 | **1,458 字** | 800 | 地板**偏宽松** |

所以这不是"判据太严"，也不是"模型写得不好"——**是"被告知"这条路走到了尽头**。

### 这正是 round-5 那条教训的复现

round-5 的结论（写进架构文档 §8.3）：

> **模型不会因为被告知就照做。** 把判据写在 prompt 里（"提交前请自查 entries 非空、
> id 不重复…"）没有用——**做成工具后，容器级的机械失败清零了。**

现在同一件事在**正文契约**上重演：容器级的判据已经是工具（`check_container`），
模型会把容器迭代到"可准入"；而**正文契约不是工具**，模型只能靠自觉，
于是三轮都停在"接近但不到"。

**下一步是明确的**（但本轮未做，见 §5）：把 `proseContractViolations` 也接进
`check_container`，让模型在提交前能看到"evaluation 778/800、references 272/600"。
它与容器级失败清零是**同一条路径**——把判据从"请求"变成"可执行检查"。

---

## 4. 热重启本身：三轮验证了什么

这三轮是对热重启功能的**真实压测**，全部通过：

| 能力 | 验证方式 | 结果 |
|---|---|---|
| 每阶段完成即停 | `--pause-after analyze/declare` | ✅ 停、写切片、退出码 3 |
| 切片落盘且可读回 | 三份 declare 切片的载荷逐字节可读 | ✅ |
| 检查结论写回 | `recordReview` → `manifest.review` | ✅ |
| **续跑点 = 最后一个"检查通过"的切片** | `01-analyze` passed + `02-declare` failed → 续跑点 = analyze | ✅ |
| **播种已通过的阶段** | `[RESUME] … 播种：analyze`，E1 未被重发（审计 `resume_seeded`） | ✅ |
| **从"A 完成、B 未开始"重启 B** | 三轮 declare 重跑，每次只重发 E2 | ✅ |
| **每一轮切片都保留** | `01/02/03/04-declare` 并存，各自带自己的检查结论 | ✅ |
| 停在检查点**不是失败** | 三轮都是退出码 3，节点不判 failed、不消耗重试预算 | ✅ |

**这正是用户要的工作流**："如果当前处于 B 阶段，但是暴露出问题，那么就修复，
然后从 A 阶段完成、B 阶段未开始的状态重启这一阶段"——三轮都是这样跑的。

---

## 5. 未完成（诚实列出）

| # | 项 | 状态 |
|---|---|---|
| 1 | **把正文契约接进 `check_container`** | ❌ 未做——这是本轮证据指向的下一步 |
| 2 | `produce` / `review` / `deliver` 三个阶段 | ❌ **未跑到**——三轮都卡在 declare 检查点，没有进入产出链 |
| 3 | 一次走完全链的真实运行 | ❌ 未完成 |
| 4 | docx 样式层审计（格式审计的下一层） | ❌ 未做（round-7 遗留） |

**为什么停在这里**：declare 连续三轮不通过，而下一阶段的产出链**必然**会以
`prose_contract` 拒绝（`evaluation` 与 `references` 不达地板）。在明知会被拒的情况下
继续往下跑，只会烧掉 20 分钟与几十万 token，换来一条已知的拒绝——那不是验证，
是浪费。**正确动作是先修 §5.1，再重启 declare。**

---

## 6. 本轮产出的可复用件

| 件 | 用途 |
|---|---|
| `scripts/.check-container.mts` | 用 harness 自己的判据核查候选容器（准入） |
| `scripts/.check-declare.mts` | 核查容器的 narrative 与图声明（**注意：这是原始 narrative，不是合并后的**） |
| `scripts/.check-merged.mts` | **按产出链的合并规则**重建 narrative 再跑契约（**核查应用这个**） |
| `scripts/.record-review.mts` | 把检查结论写回切片 |

前两个是过程件，**第三个才是正确判据**——这个区别见 `CHECKPOINT-02-CORRECTION.md`。
