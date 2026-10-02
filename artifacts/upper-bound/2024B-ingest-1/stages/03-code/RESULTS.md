# 阶段三真实运行结果说明

## 1. 运行产物与读取规则

本阶段的结果由 `code/main.py` 顺序调用四个问题模块后实际生成。成功运行时，聚合账本 `outputs.json` 的 `status` 为 `completed`，并包含 `execution_order`、`problem_artifacts` 以及四个问题的完整结果对象；各问题模块还会分别写出 `problem1.json`、`problem2.json`、`problem3.json` 和 `problem4.json`。

本文件不重新心算或手工抄写数值，而是给出与机器账本一致的字段定位器。下表中的路径均表示应从相应 JSON 对象读取的真跑值；字段为空、缺失或未通过验收时，不得用文字说明替代结果。`outputs.json` 是汇总入口，单问题 JSON 是同一结果的模块化副本，二者不得分别解释。金额字段统一按元/合格交付解释，概率字段无量纲，计数与检测次数字段分别使用件或次作为单位。

若运行过程中发生异常，主入口会写出 `run_error.json`，记录已完成的模块、异常类型和异常信息，并以失败状态退出；这类失败产物不构成可引用的数值结果。

## 2. 问题一：精确二项抽样结果

问题一使用精确二项尾概率和整数阈值枚举，不使用正态近似。拒收情形的结果对象必须同时保留标称率处的拒收尾部概率、登记备择率处的功效、检测次数和整数拒收临界值；接收情形必须保留标称率处的接收概率、最小检测次数和最大可行接收临界值。

| 结果量 | 聚合账本定位 | 模块账本定位 | 结果含义 |
|---|---|---|---|
| 拒收检测次数 | `outputs.json:problems.problem1.case95.n` | `problem1.json:case95.n` | 满足登记尾部约束的最小整数检测次数 |
| 拒收临界值 | `outputs.json:problems.problem1.case95.r` | `problem1.json:case95.r` | 样本次品数达到该值时拒收 |
| 标称率拒收尾部 | `outputs.json:problems.problem1.case95.reject_tail` | `problem1.json:case95.reject_tail` | 与登记第一类错误上限比较 |
| 备择率功效 | `outputs.json:problems.problem1.case95.power` | `problem1.json:case95.power` | 与登记第二类错误约束比较 |
| 接收检测次数 | `outputs.json:problems.problem1.case95.accept_n` 或接收条目中的 `n` | `problem1.json:case90.n` | 接收置信约束下的最小整数样本量 |
| 接收临界值 | `outputs.json:problems.problem1.case90.c` | `problem1.json:case90.c` | 样本次品数不超过该值时接收 |
| 标称率接收概率 | `outputs.json:problems.problem1.case90.accept_tail` | `problem1.json:case90.accept_tail` | 与接收置信要求比较 |
| 有限 SPRT 期望检测次数 | `outputs.json:problems.problem1.sprt.expected_n` | `problem1.json:sprt.expected_n` | 截断序贯方案在登记概率下的期望检测数 |
| 固定方案与 SPRT 选择 | `outputs.json:problems.problem1.sprt.selected` | `problem1.json:sprt.selected` | 是否由 SPRT 替换固定方案 |

拒收对象中的 `case95` 不是脱离风险设计的题面唯一答案。代码同时使用标称率、登记的可识别超标幅度和第二类错误上限，因此结果必须带有适用前提；不能把它表述成仅由“标称值”和“拒收置信水平”唯一决定的无条件样本量。接收对象则按接收置信约束单独计算，二者不能混用。

OC 曲线及其配套序列位于 `problem1.oc_curve`，包括真实次品率序列、接收概率序列、拒收概率序列和阈值信息，供后续阶段直接读取。超标幅度与第二类错误的灵敏度结果位于 `problem1.sensitivity` 或等价扫描对象中，必须保留参数网格和逐点重算的检测次数、临界值及尾部概率，不能只输出基准方案。有限 SPRT 的边界、停止状态、截断行为和精确尾部复核位于 `problem1.sprt`；无上限 SPRT 不属于可选结果。

## 3. 问题二：两零件闭环决策结果

问题二对完整的 `(Z1,Z2,C,D)` 决策空间执行状态递推。每个表 1 情形的最优策略和单位合格交付利润按下表读取：

| 结果量 | 聚合账本定位 | 说明 |
|---|---|---|
| 情形标识 | `outputs.json:problems.problem2.cases[i].case_id` | 与表 1 情形标识对应 |
| 最优策略 | `outputs.json:problems.problem2.cases[i].policy` | 按 `z1,z2,c,d` 顺序记录二值决策 |
| 单位利润 | `outputs.json:problems.problem2.cases[i].profit` | 单位最终合格交付的期望净收益 |
| 完整策略比较 | `outputs.json:problems.problem2.policy_table` | 全部候选策略及其利润或成本 |
| 事件现金流账本 | `outputs.json:problems.problem2.cases[i].event_cash_ledger` | 采购、检测、装配、拆解、调换和市场收入分项 |
| Bellman 残差 | `outputs.json:problems.problem2.cases[i].bellman_residual` | 状态方程数值残差 |
| 吸收概率 | `outputs.json:problems.problem2.cases[i].absorption_probability` | 完成一次合格交付的吸收概率 |
| 独立核验状态 | `outputs.json:problems.problem2.validation` | 现金流守恒、吸收性和策略枚举验收 |

策略对象必须显式区分“不检测”和“检测”，不能只保留一个利润标量。零件检测路径使用几何采购与逐件检测；处于 `empty` 状态时直接从首次采购开始计费，不额外添加一次不存在的“首检”。只有已经存在的坏回收件进入重新处理路径时，才记录其重新检测，再按几何过程补充可用零件。该修正同时适用于状态方程和独立事件账本。

单位利润按统一事件账本计算：市场收入只记一次；采购、零件检测、成品检测、装配、拆解和调换损失均按实际事件计入；报废不恢复采购投入，也不产生残值收入。不检测成品时，条件次品率仍进入市场失败、调换、报废或拆解分支；不能因为跳过成品检测而删除这些成本。策略表、现金流账本和 Bellman 值之间的差异以登记的现金流绝对容差验收。

## 4. 问题三：一般装配网络结果

上游仅提供图 1 的规模和表 2 参数，没有可校验的权威父子边表。因此本阶段不把推断拓扑冒充题图正式答案，而是在 `problem3.primary` 和 `problem3.alternative` 中分别保存两个条件拓扑情景。每个情景均须包含节点级决策、单位合格产出利润和节点指标。

| 结果量 | 聚合账本定位 | 结果含义 |
|---|---|---|
| 主情景策略 | `outputs.json:problems.problem3.primary.policy` | 推断主拓扑下的节点决策 |
| 主情景利润 | `outputs.json:problems.problem3.primary.profit` | 主拓扑的单位合格根产出利润 |
| 主情景节点指标 | `outputs.json:problems.problem3.primary.node_metrics` | 各节点产出率、投入成本率和单位成本 |
| 替代情景策略 | `outputs.json:problems.problem3.alternative.policy` | 输入数不同拓扑下的重新优化策略 |
| 替代情景利润 | `outputs.json:problems.problem3.alternative.profit` | 替代拓扑的单位合格根产出利润 |
| 拓扑利润差异 | `outputs.json:problems.problem3.topology_profit_gap` | 两个条件情景之间的利润差 |
| 退化最大误差 | `outputs.json:problems.problem3.degenerate_max_error` | 两零件退化网络与问题二逐策略比较的最大绝对差 |

节点指标必须遵守 `U_v=C_v/Q_v` 的量纲关系。`C_v` 是每次节点投入的期望现金成本，`Q_v` 是每次投入产生合格根件的概率或产出率，二者必须来自同一事件轨迹；不能把单轮装配成本直接当作每件合格交付成本，也不能在父节点转移中再次把 `U_v` 与 `Q_v` 相乘。`Q_v` 为零的策略必须被剔除，并在节点指标中保留剔除原因。

成品节点无论是否执行检测，都必须经过完整的失败处置、调换、报废或拆解事件。拆解后回收的零件保持原质量身份，回收带来的免采购效果只能通过状态转移体现一次。对问题二退化为相同零件、成品、售价和损失参数的网络，十六个逐项策略必须与问题二结果比较；超过登记容差时，`problem3.validation` 必须给出失败状态并阻断正式结果。

## 5. 问题四：情景抽样、区间与稳健重解

问题四没有真实的生产批次观测样本，因此结果必须标为情景分析，不能称为真实抽样估计。情景中心来自登记参数，但每次抽样实际保存的 `n_v` 和 `x_v` 才是点估计、置信区间和决策一致率的输入。

| 结果量 | 聚合账本定位 | 结果含义 |
|---|---|---|
| 情景样本账本 | `outputs.json:problems.problem4.sample_ledger` | 每个参数节点的样本量、次品计数和生成信息 |
| 点估计率 | 样本账本行中的 `p_hat` | 由 `x_v/n_v` 唯一复算 |
| CP 下端点 | 样本账本行中的 `ci_lower` | 显式处理零计数和内部计数 |
| CP 上端点 | 样本账本行中的 `ci_upper` | 显式处理满计数和内部计数 |
| Q2 点策略 | `outputs.json:problems.problem4.case1.point_policy` 至对应情形条目 | 情景点估计下重新求得的策略 |
| Q2 稳健策略 | `outputs.json:problems.problem4.case1.robust_policy` 至对应情形条目 | Bonferroni 联合域内重新优化策略 |
| Q2 利润包络 | `outputs.json:problems.problem4.case1.profit_interval` 至对应情形条目 | 联合域下的利润情景范围 |
| Q3 点策略 | `outputs.json:problems.problem4.q3.point_policy` | 网络情景点估计策略 |
| Q3 稳健策略 | `outputs.json:problems.problem4.q3.robust_policy` | 网络联合域稳健策略 |
| Q3 利润包络 | `outputs.json:problems.problem4.q3.profit_interval` | 网络利润情景范围 |
| 决策一致率 | `outputs.json:problems.problem4.decision_consistency` | 各次情景重优化与情景中心策略的一致比例 |
| 蒙特卡洛收敛 | `outputs.json:problems.problem4.mc_convergence` | 逐次或逐段重复的收敛序列 |
| 样本量扫描 | `outputs.json:problems.problem4.sample_size_scan` | 不同精度样本量下的区间宽度和策略稳定性 |

样本量按照每个参数节点各自的区间宽度目标独立扫描，不能复用问题一的检验最小样本量。Clopper–Pearson 区间在零次品、满次品和内部计数三种情形下均须返回合法闭区间；内部计数使用 Beta 分位数，边界计数使用显式端点。联合构造采用 Bonferroni 矩形，问题二和问题三分别按照各自的参数节点数分配边际错误率，输出名称应使用“联合置信域”或“稳健利润包络”，不能把边际区间误称为联合置信区间。

每个情景重复都重新计算点估计策略、稳健策略和利润包络。固定随机种子、Jeffreys 后验抽样和重复次数均从统一参数模块读取。决策一致率是抽样稳定性指标，不是监督学习分类准确率；本实现没有训练集、测试集或模型拟合，因此不宣称泛化性能，也不适用训练测试划分意义上的防泄漏指标。每次情景抽样的参数节点、次品计数和策略轨迹都应能从样本账本复算。

## 6. 数值验收与失败边界

结果文件应同时提供通过标志和误差量，不能只提供最终策略。验收字段及含义如下：

| 验收项 | 应读取的字段 | 判定内容 |
|---|---|---|
| 精确二项尾部 | `problem1.validation.exact_tail` | 固定方案和截断 SPRT 的尾部约束 |
| OC 单调性 | `problem1.validation.monotonicity` | 阈值固定时概率变化方向 |
| Q2 吸收性 | `problem2.validation.absorption` | 所有候选策略均能完成最终合格交付 |
| Q2 现金流守恒 | `problem2.validation.cashflow` | 状态值与逐事件账本一致 |
| Q2 空状态与坏回收件转移 | `problem2.validation.component_transition` | 空状态不重复计首检，坏回收件按重检路径处理 |
| Q3 DAG 与状态覆盖 | `problem3.validation.graph` | 边表、节点覆盖和可达状态完整 |
| Q3 成本单位 | `problem3.validation.unit_cost` | `Q_v`、`C_v`、`U_v` 量纲一致 |
| Q3 退化等价 | `problem3.validation.degenerate_equivalence` | 两零件逐策略差异不超过登记容差 |
| Q4 CP 边界 | `problem4.validation.cp_endpoints` | 零计数、满计数和内部计数均合法 |
| Q4 联合构造 | `problem4.validation.bonferroni` | 边际错误率分配与参数节点数一致 |
| Q4 重优化 | `problem4.validation.decision_reopt` | 点估计、区间和每次重复均重新求策略 |
| JSON 完整性 | 四个问题 JSON 的 `validation` | 字段非空、数值有限、状态明确 |

误差字段必须使用参数模块登记的精确枚举容差、现金流绝对容差和价值迭代容差。不得用四舍五入后的显示值代替内部比较值，也不得在验证失败时仅保留一个看似可行的最优策略。

## 7. 对上一轮审计事项的落点

上一轮指出的跨文件未定义常量问题通过统一 `params.py` 和各模块显式导入处理；问题二空状态额外首检问题通过拆分空状态与已有坏回收件的转移处理；问题一备择率和第二类错误属于登记设计风险，结果名称和说明均保留该前提；问题三因缺少权威图 1 边表而明确标记为条件拓扑，不输出伪称正式图答案。

单位成本复核落实为 `U_v=C_v/Q_v`，成品不检测分支保留调换、报废和拆解事件；问题四保存每个节点的情景 `n_v,x_v`，不把中心参数直接当作点估计；CP 端点采用零计数、满计数和内部计数的显式分支；联合区间采用 Bonferroni 分配；样本量按区间精度而非问题一检验样本量选择；退化误差、独立参考解、状态数、现金流误差和失败标志均写入结果对象。任何未通过项都必须在 `validation` 中可见，而不能只在说明文字中宣称通过。

## 8. 供后续阶段读取的数据结构

后续阶段所需的逐方案、逐节点和逐情景数据均应从 JSON 账本读取，而不是从本文件重新生成。问题一提供 OC 概率序列、阈值和灵敏度扫描；问题二提供完整策略比较矩阵、逐情形最优策略、利润分解和成本扰动序列；问题三提供两种拓扑的节点指标、策略、利润和拓扑差异；问题四提供样本账本、CP 区间、样本量扫描、利润包络、决策一致率和蒙特卡洛收敛序列。

本阶段只产生代码执行结果及其文字说明，不生成图像字节、渲染代码、图表声明或独立数源文件。