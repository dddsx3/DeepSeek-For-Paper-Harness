# TASK-P2-A 对照题库 — 出题标准(预注册,跑前冻结)

> 本文件先于任何配对执行落库(禁 P2-A #2:统计口径先写死再跑)。
> 题库:`cases.json` — 24 对,12 个 `closed` + 12 个 `expansion`,每对两协议同题。

## 出题标准

### closed case(闭集可覆盖,T3 应能过)

- 题目文本**显式指名** required `json_path` 与 `unit`,且两值都在 T3 静态候选集
  (`json_path ∈ {mean_thickness, melt_fraction}`、`unit ∈ {m, kg}`)内;
- T3.5 种子池是 T3 池的超集(含上述全部),故 T3.5 也应过;
- 预期:`b`(T3 过 & T3.5 挂)≈ 0 —— 这组是 T3.5 **不损失可靠性**的对照组锚点
  (裁决单 P-A 选项 B:复用已验证题作锚)。

### expansion case(闭集装不下,T3 应全挂)

- 题目文本**显式指名** required `json_path` 与 `unit`,且**至少一个值不在 T3 静态
  候选集内**;两值都是合法扩张目标:
  - `json_path`:小写标识符(`^[a-z][a-z_]*$`,无数字);
  - `unit`:token 形(`^[a-z^/]+$`,无数字);
- 合法性标准:"池外语义目标必须是该题的真实答案"——题目文本本身就把 required
  值写死(如"以 `snow_depth` 为 json_path、单位 `watts` 记录"),不是模型自由发挥;
- 预期:T3 全挂(`t3_free_choice`,模型诚实填 required 值时)或结构性过但语义不符
  (填了池内候选但 ≠ required, adjudication 判挂);T3.5 经 REQUEST_EXPANSION +
  原子微生成(模型提出 required 值)+ SELECT 收编;
- **不允许**:出题含数字值的 case(数字零通道不变)、要求非法形状的 required 值
  (那是攻击面,已被 expand-select 单测覆盖,不进对照实验)。

## 判定规则(预注册 adjudication)

- **T3 arm 成功** ⇔ `admitTemplateFill` 准入 **且** fill.json_path == required.json_path
  **且** fill.unit == required.unit,且后续 pipeline(组装→真实执行→解释)全过;
- **T3.5 arm 成功** ⇔ 状态机对 json_path 与 unit 两槽位各自 SELECT 提交,所选值
  == required 值,组装后 pipeline 全过;ESCAPE 单独计数(零容忍);
- 两 arm 都是**首试**(first attempt),无重试引导;同模型(z-ai/glm-5.3-flash,
  已过统计门且 token 便宜)、严串行、同 prompt 预算口径。

## 统计口径(预注册)

- 主检验:**McNemar 精确检验**(双侧精确二项),只看不一致对:
  `b` = T3 过 & T3.5 挂,`c` = T3 挂 & T3.5 过;`p = min(1, 2·Σ_{k≤min(b,c)} C(b+c,k)·0.5^(b+c))`;
- n=24 是**筛选性对照**:报告 discordant 对数与 p 值;论文终稿统计
  (logistic mixed model + β₃ 交互)留待扩样,本批不做 mixed model(任务书 P2-A #3);
- 成本面:每 arm 总调用/输出 token/成本(按 TASK-P2/pricing.json 口径),per-success
  输出 token;"表达力单价" = T3.5 多覆盖 case 数 ÷ 多花输出 token;
- T3.5 资格行:若 24 个 T3.5 首试 LCB₉₅ ≥ 0.8 且 ESCAPE = 0,registry 落
  `T3.5` 层资格记录(G5)。

## 预期结果方向(预注册的双向诚实)

- 若 T3.5 在 expansion case 上也大量挂:如实报告——它量化受限状态机的边界,
  不是事故(任务书已知风险 #4;禁 3 防的是造假,不防诚实负结果)。
