# TASK-M1 — probe-real(真实遵从率实证,首项)

> 组合:provider=`deepseek-official` 适配器,端点 `https://api.y-api.bestvirtualgoods.com/v1`
> (OpenAI 兼容中转,测试专用无限额度 key),模型 `deepseek/deepseek-v4-flash`。
> 测试 key 由作者提供(本批次专用),探针为串行低并发(每层 5 次、间隔 ≥1.5s)。
> 全部首次尝试为 first-attempt(重试预算 0 计入,transport 重试只等不计数)。

## 数据(3 轮,合计 38 次首次尝试 ≥20)

| 轮次 | 时间(UTC) | T1 | T2 | T3 | 说明 |
|---|---|---|---|---|---|
| 轮 1 | 2026-09-06T17:02 | 0/5 | 0/5 | **5/5** | 首次完整跑;T3 全过 |
| 轮 2 | 2026-09-06T17:46 | 0/5 | 0/5 | 0/5 | T3 5 次全部在 **execution 阶段**失败("runner produced []"),fill-in 本身全准入;同窗口 T2 11 次 transport 重试 → 判定瞬时环境窗口 |
| 专测 | 2026-09-07(凌晨) | — | — | **8/8** | 同管道 T3 专测(8 次,同一 key):fill-in→组装→真实执行→解释 全过 |

- 轮 2 的 T3 归因:5 次失败失败分类全为 `execution`(代码运行没产出文件),fill-in 准入 5/5 成功;
  专测 8/8 证明该失败是瞬时窗口(同窗口 T2 大量 transport 重试),非协议问题。
- 合并口径(first-attempt 红线):
  - **T1(全声明容器):0/10** —— 两次跑失败签名完全一致:ModelSpec 的 `assumptions`/`parameter_refs`
    形状漂移(`expected array`/`expected object`)、`DA-RAW` 引用类型错配(`reference_kind_mismatch`)。
    与 MiniMax 旧锚点(19/20 高置信错误结构)同家族:模型高置信地写错声明结构。
  - **T2(三步向导):0/10** —— step 2 的 locator 全都不等于 step 1 声明的输出
    (`step1_output.json`/`RES-OUT.json`/`output.json` vs 候选 `result.json`):模型不把步 1 的
    候选清单带入步 2(跨步引用未入账),高置信自造文件名。这是可引导修复的 DRIFT,但首次尝试
    adherence = 0。
  - **T3(闭集填充):fill-in 准入 18/18(1.0),端到端 13/18**;5 次端到端失败全部落在瞬时
    execution 窗口,专测 8/8 端到端全过 ⇒ **T3 对本模型真实可用**(结构遵从 1.0)。

## 层间对比(对照 MiniMax 0/20 锚点)

| 层 | 模型要写什么 | 本模型行为 | adherence | 结论 |
|---|---|---|---|---|
| T1 | 一次完整 ir-container-v1 | 高置信写错结构(schema 漂移/引用错配) | 0/10 | **设计预期中的弱模型形态**——字段自由度太高 |
| T2 | 三步 ≤4 字段声明 | 步 2 不继承步 1 候选,自造文件名 | 0/10 | 引导面仍给了语义自由(locator),弱模型抓不住候选约束 |
| T3 | 闭集槽位→候选映射 | 槽位全部命中候选(零发明空间) | fill 18/18、E2E 端到端(专测 8/8) | **设计目的达成**:T3 把 0/20 弱模型遵从率救回 |

任务书 M1-1 的预判("预期是 T2/T3 层把遵从率救回")成立,且救回的是 **T3 层**(T2 的
locator 自由仍给弱模型留下可错的发明空间)。

## 首测组合定层(M-C 选项 B 的产品化应用)

- **首测组合:provider=deepseek-official,model=deepseek/deepseek-v4-flash,层 = T3**。
- 依据:层内双指标(结构遵从 = 1.0、端到端首次 = 专测 8/8 ≥ 0.8、重试预算 0)满足
  upgradeVerdict 单门;T1/T2 双指标 0 → 字面 EXPLORATORY 降级(T3 之外无 FORMAL 层)。
- 降层链记录:T1/T2 组合身份 `.../v1 + deepseek/deepseek-v4-flash + T1(或 T2)` → EXPLORATORY
  (registry 双指标 < 0.8,如实登记)。
- 弱模型轨:**T3 可用**;T1/T2 轨转为持续观察项(每次真实批次重测,不强求救回)。

## 归档

- `summary.json` / `records.jsonl` = 轮 2(干净串行那次,含全三层逐次记录)副本;
- 本文件(含轮 1 与专测的合并口径)= 三局综合结论;
- 真实调用审计:共 38 次首次尝试(10 T1 + 10 T2 + 18 T3),transport 重试只等待不计数;cost 依 key
  额度实测,本批不单独核算(测试专用无限额度)。