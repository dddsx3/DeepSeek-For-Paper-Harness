/**
 * 阶段简报（技能适配层）—— 把参考工作流的 SKILL.md 转成**本 harness 可投递**的形态。
 *
 * ## 为什么必须适配，而不是照抄
 *
 * 参考的 SKILL.md 是给 Claude Code 写的：模型用 `Write` 工具写文件、用
 * `cat _utils/xxx.md` 读规则、用 `python _utils/*.py` 自己跑门禁、按 `$ARGUMENTS`
 * 取参数、按 CLAUDE.md 的 `MH_*` 开关切模式。
 *
 * **本 harness 的模型调用没有通用文件工具。** round-5 已经为此吃过一次亏：宪法里写
 * "用 read_file 读 skills/x.md"，而那是一条**无法被遵守的指令**。所以适配的第一条纪律是
 * **不投递任何模型做不到的指令**。
 *
 * ## 适配规则（逐条对应参考形态）
 *
 * | 参考 | 本 harness |
 * |---|---|
 * | 模型用 `Write` 写文件 | 模型只产出**内容**；harness 落盘到 `stages/NN-id/` 并内联给下一阶段 |
 * | 模型 `cat _utils/xxx.md` 读规则 | 规则**内联进本简报**（见下面的技能正文） |
 * | 模型 `python _utils/*.py` 跑门禁 | 门禁是 **harness 侧 TS**；判据作为**提交前自检清单**内联 |
 * | `MH_FAST_MODE` 等开关 | harness 选项 |
 * | `$ARGUMENTS` | 阶段输入由 harness 注入 |
 *
 * ## 两条写作纪律（用户口径）
 *
 * **一、不许简化成摘要。** 参考的技能正文是 83–1441 行的实操细节。转写时保留**具体形态**
 * （章节骨架、字段名、命名规则、判据数字、反例），只删掉"怎么用工具"那一层。
 * 一份"你要认真写建模报告"的简报等于没有简报。
 *
 * **二、自创部分必须用明确指示，不用建议。** 阶段 8/11 参考里**没有技能**（只有产物形态），
 * 那两段是本 harness 自创的。自创内容没有参考背书，措辞一软就会被忽略——本项目反复验证过
 * "模型不会因为被告知就照做"。所以自创部分一律写成**必须 / 不得 / 产出**，并写明违反的后果；
 * 而移植部分保留参考原本的语气（它已经是被实践校准过的）。
 *
 * @module @deepseek-ai/dsh-paper-foundation/stages/briefing
 */

import { STAGES, stageDirName, type StageSpec } from './registry.ts'
import { skillDocIndexBlock } from './skill-docs.ts'

/** 简报的分节名（固定，便于测试与人工检查）。 */
export const BRIEFING_SECTIONS = [
  '你的任务（明确指示）',
  '产出契约（机器可校验——这就是你会被量到的东西）',
  '上游状态',
  '本步知识（怎么做）',
  '明确不要做',
  '提交前自检',
  '完成标志',
] as const

/**
 * 每阶段的技能正文。
 *
 * `ported` 标记来源：`true` = 转写自参考 SKILL.md；`false` = **本 harness 自创**
 * （参考里没有该技能，只有产物形态）。自创段落一律用明确指示。
 */
interface StageSkill {
  readonly ported: boolean
  /** 任务陈述：祈使句，说明产出什么、不接受什么。 */
  readonly task: string
  /** 怎么做（保留参考的具体形态）。 */
  readonly how: ReadonlyArray<string>
  /** 明确不要做（每条带理由——只加禁令不加理由，模型会换一种方式违反）。 */
  readonly forbidden: ReadonlyArray<string>
  /** 提交前自检（harness 侧门禁的判据；模型可用时另给工具）。 */
  readonly selfCheck: ReadonlyArray<string>
}

const SKILLS: Readonly<Record<string, StageSkill>> = {
  'prob-analysis': {
    ported: true,
    task: '产出**赛题分析**：把题面读成机器可核验的事实集合，并为后续每一步立下可对账的契约。'
      + '你**必须**同时给出 `PROBLEM_ANALYSIS.md`（人读）与 `CAPABILITY_CHECKLIST.json`（机器读）——'
      + '后者是后面每一阶段的对照表，缺了它，后面的"逐问覆盖"就只能靠人看。',
    how: [
      '**逐句表**：把题面拆成句子，每句标类型（决策 / 目标 / 机制 / 数据 / 约束 / 输出）。'
        + '标为决策、目标、机制的句子，**必须**被某个能力项的 `source_sentence` 认领——这是硬判据。',
      '**硬约束清单（HARD_CONSTRAINTS）**：题面里"必须/不得/至少/不超过"这一类。逐条抄原文，不要转述。',
      '**FIGURE_MANIFEST 块**：夹在 `<!-- BEGIN FIGURE_MANIFEST -->` 与 `<!-- END FIGURE_MANIFEST -->` 之间。'
        + '段头式写法（与参考一致）：先写 `DATA=<n>` 再逐行列数据图名，然后 `DRAWIO=<n>`、`TIKZ=<n>`、'
        + '`GPTIMG=0`、`ALL=<n>`。每条以 `fig_` 或 `tikz_` 开头；**数据类图 12–20 张**'
        + '（含横向对比、灵敏度、校核图）。每张图在正文里都要有一处说明它的图表类型。',
      '**ARCH_DECLARATION 块**（`<!-- BEGIN ARCH_DECLARATION -->` … `<!-- END ARCH_DECLARATION -->`）：'
        + '**只要清单里有 `DRAWIO` 条目就必须写**。它是 `图 id → {style_family, direction, layers, edges}` 的 JSON 对象。'
        + '理由：清单只给图**名**，给不出层/节点/连线——阶段 5 的渲染器按声明画图，**没有声明就不画**'
        + '（凭空造一张路线图比缺一张更糟）。节点标签要短（**不得**写具体结果数值，也**不得**整张图都是'
        + '"数据采集/建立模型"这类万能词）。',
      '**CAPABILITY_CHECKLIST.json**：每条 = `{ id, required_output, machine_check, source_sentence }`。'
        + '`machine_check` 要写成**别人能照着核**的句子（"问题 2 给出 16 种策略的期望成本表"），'
        + '不是"建模合理"。',
      '**PROBLEM_FACTS.json**：题面**给定值**的事实表（每个数字附 `raw_quote` 原文片段）。'
        + '它防的是**读题读错**，与零数字通道防的"自算数字"是两件事——不要混。',
      '**锚点**：本阶段的自由分析就是 E1。**必须**保留行首锚点 `[[ASSUMPTION: A-XXX]]` 与 '
        + '`[[REQUIREMENT: R-Qn]]`：前者是保真门 B3 的锚，后者是 B4 逐问覆盖的锚。',
    ],
    forbidden: [
      '**不得**凭印象补题面参数。题面文本已在上文；凡是你写进 `PROBLEM_FACTS.json` 的数字，'
        + '都要能在题面里逐字找到（这就是 `raw_quote` 的用途）。',
      '**不得**写"本问题属于优化问题，需要仔细分析"这类空转句。逐句表的价值在于**可核**，'
        + '空转句无法被任何判据认领。',
      '**不得**用裸名命名图（`image2` / `图2` / `chart1`）。下游对账按 `fig_`/`tikz_` 前缀匹配，'
        + '裸名会被**静默丢掉**——那不是报错，是图凭空消失。',
    ],
    selfCheck: [
      '`PROBLEM_ANALYSIS.md` ≥ 1500 字节（UTF-8 字节数，中文按 3 字节算）。',
      'FIGURE_MANIFEST 的 BEGIN/END 锚点都在，条目全部以 `fig_`/`tikz_` 开头。',
      '清单里有 `DRAWIO` 条目时，`ARCH_DECLARATION` 块也在，且每个 `fig_*` 条目都有对应的层/节点/连线声明。',
      '逐句表里标为决策/目标/机制的句子，全部被能力项的 `source_sentence` 认领。',
      '`[[ASSUMPTION: …]]` 与 `[[REQUIREMENT: …]]` 各有至少一条、且都在**行首**。',
    ],
  },
  modeling: {
    ported: true,
    task: '产出**建模求解**，分两次调用完成：'
      + '**2a 只声明 IR 条目**（Symbol/Assumption/Equation/ModelSpec），**2b 只写富散文**'
      + '`MODELING_REPORT.md`。两次是硬要求，不是风格选择——合成一次会回到 40KB 单次输出，'
      + '而那正是当前头号失败（JSON 写不完整）。'
      + '**本阶段禁止写最终数值结论**：建模阶段还没有代码执行，任何"算出来的数"都是心算，'
      + '没有出生证明。要引用结果的地方**必须**写结果锚点（如 `{R-Q2-case5-profit}`），'
      + '数值由阶段 3 的真跑代码铸出。',
    how: [
      '**2a 的声明要短**：`statement` / `meaning` 控制在 40 字符内。IR 是**索引**，不是正文；'
        + '装不进去的推理写进 2b。',
      '**每个子问题一个 ModelSpec**，其 `problem_refs` 指向该子问题。逐问覆盖是硬判据'
        + '（"虎头蛇尾"要治的就是这个）。',
      '**假设必须被使用**：每条 `AssumptionSpec` 至少要被某个 `ModelSpec.assumption_refs` 引用。'
        + '声明了却不用的假设是记账噪声。',
      '**跨子问题引用有两条合法路线，二选一**：① 在该假设/方程上写 `"shared": true`；'
        + '② 每个子问题各声明一份、id 不同。两条都不做会被 REF-003 拒。',
      '**2b 的正文**必须含：模型假设 / 符号说明 / 逐问模型 / 检验方案 / 灵敏度分析 / 编程实现要点，'
        + '并把阶段 1 的图表预规划**原样带过来**（它是阶段 4 的输入，丢了图就没有来源）。',
      '**问题分析章逐问写**"归到哪类方法 + 为什么 + 难点在哪"，每问一段（参照物每问 270–600 字）。',
      '**模型评价与推广**四要素各一段：优点 / 局限 / 敏感性 / 推广。一句话不算一段。',
      '**要报结果的地方写锚点，不写数**：形如 `{R-Q2-case5-profit}`（`R-` + 问 + 情形/量名）。'
        + '锚点会在阶段 3 真跑代码后被替换成账本里的值。**只有两类数字可以直接写**：'
        + '题面给定值（如"次品率 10%"）与你自己声明的模型常数（如先验 Beta(12,100) 的 12 与 100）'
        + '——门禁 `numbers_traced` 逐个数核对，其余一律判失败。',
      '**检验方案写成"待执行"，不得写成结论**：写"将对 6 种情况逐一核验分项恒等式（容差 1e-6）"，'
        + '**不得**写"6 种情况全部通过（容差 1e-6）"——本阶段还没有代码，检验不可能跑过；'
        + '门禁 `no_claimed_verification` 会抓这类完成时声明。执行结论只能由阶段 3 的产物承载。',
      '**数据缺口要显式声明假设**：若某项结构只能从图/附件读出而你没有它（例如装配树拓扑），'
        + '**必须**把"我假设的拓扑是什么"写成一条显式假设（`ASM-*`）并给出拓扑稳健性说明，'
        + '不得把缺口静默带过——下游会按你的假设算。',
    ],
    forbidden: [
      '**不得**把富散文塞进 IR 字段。IR 字段是给机器索引用的；塞满会让分片收益归零。',
      '**不得**声明不使用的假设、方程或符号。每一条声明都会被"闭合性"判据检查。',
      '**不得**省略"被否掉的方案"。为什么不用 SPRT、为什么不用正态近似——**这正是评委最想看的归因**，'
        + '也是阶段 9"装配而非推理"这一前提的原料：阶段 9 不会替你补推理。',
      '**不得**写任何没有出生证明的数字（心算出的结果、汇总值、期望利润、样本量……）。'
        + '2024B 实测：阶段 2 手写 Q2 六种情况的期望利润，**六处错三处**（报 12.50 真值 15.88、'
        + '报 20.19 真值 16.94、报 12.50 真值 21.68），并据此写出"拆解始终划算"这类被证伪的结论。'
        + '错的不是模型（方法与公式都对），是**在无执行环境下的心算**。',
      '**不得**声称任何检验"已通过"。本阶段没有代码，检验一次也没跑过——'
        + '把"检验方案"写成"检验结论"比单个错数字更危险：它给下游传递"已验证"的假信号。',
    ],
    selfCheck: [
      '`MODELING_REPORT.md` ≥ 1500 字节；IR 声明能满足准入的全部结构判据。',
      '每个子问题都有 ModelSpec；每条假设都被引用；跨子问题引用走两条合法路线之一。',
      '问题分析章逐问归因；评价章四要素齐全；图表预规划已带入。',
      '**要报结果的地方都是锚点 `{R-…}`**，没有心算出来的数字（门禁 `numbers_traced` 逐个数核）。',
      '**检验方案都写成"待执行"**，没有任何"已通过/已验证"的完成时声明（门禁 `no_claimed_verification`）。',
      '数据缺口（如只能从图读出的拓扑）已写成显式假设并给出稳健性说明。',
    ],
  },
  code: {
    ported: true,
    task: '产出**编程实现**：让数字由**真跑出来的代码**产生，并**声明**图——但**不得渲染**图。'
      + '声明与渲染是两件事：你写 `chart_type/data_refs/caption`，harness 据声明取数渲染。'
      + '你不写渲染代码，也不产出任何图像字节。',
    how: [
      '`code/main.py` 是编排入口，依次跑各问并汇总；每问一个 `code/problem*.py`。'
        + '**代码文件数必须 ≥ 题面问数**（逐问奇偶校验）。',
      '**你的代码会被 harness 真跑**（`python code/main.py`，工作目录就是 `code/`）。'
        + '代码必须把要进论文的量写成 **JSON 文件**放在工作目录里（例如 `outputs.json`）——'
        + '打印到 stdout 的东西不会被采集。',
      '**数在哪由下一阶段（数源声明）负责**，本阶段只负责让代码把每个要用的量'
        + '写成 JSON 文件：键名取成能读懂的（`n_star`、`profit_case5`），路径别太深。'
        + '下一阶段会声明 `{locator, json_path}`，harness 真跑你的代码后从产物字节里铸出账本。',
      '`RESULTS.md` 写结果说明：四问的关键数值、校核证据、归因、诚实边界。'
        + '散文里可以引用账本里的数（它们来自真实执行），但**不得**出现代码没产出的数。',
      '每个被声明为输出的量，都要真的写进声明的输出文件。**声明的输出必须存在且非空**。',
      '**数字只有两个合法来源**：题面给定值，或代码真跑出来的值。散文里不许出现自算数字。',
      '分类指标出现 ≥0.99 时，**必须**同时给出防泄漏说明（数据划分、去泄漏步骤）。'
        + '没有说明的 0.99 是硬失败。',
    ],
    forbidden: [
      '**不得**产出任何图像字节（`.png`/`.jpg`/`.pdf`/`.svg`）。渲染是阶段 4 的事，'
        + '本阶段只声明——这条是门禁 `no_render`，会硬失败。',
      '**不得**用"抽样"却不写抽样口径。声明抽样就必须给出抽样说明。',
      '**不得**把结果只打印到 stdout——stdout 不被采集，量必须写进 JSON 文件。',
      '**不得**写 `RESULT_SOURCES.json`：那是下一阶段（数源声明）的产物，'
        + '本阶段写它只会造成两份互相矛盾的定义。',
    ],
    selfCheck: [
      '`code/main.py` ≥ 500 字节、`RESULTS.md` ≥ 1024 字节、代码文件数 ≥ 题面问数。',
      '声明的每个交付物都真的存在且非空（`DELIVERABLES.json` 与磁盘一致）。',
      '代码把每个要用的量写进了工作目录下的 JSON 文件（键名可读、路径不深），'
        + '且**真跑得起来**（harness 会执行 `python code/main.py`，工作目录就是 `code/`）。',
      '`RESULTS.md` 里没有账本之外的数字（门禁 `numbers_traced`）——结果说明只描述'
        + '"算了什么、怎么核"，具体数值由账本承载。',
      '≥0.99 的分类指标都配了防泄漏说明。',
    ],
  },
  'result-sources': {
    // 参考工作流里数由代码写出的 all_results.json 承载；本阶段把"数在哪"独立成
    // 一次小调用——2024B 实测：与代码合在一次回答里，三次被输出上限截断。自创 → 明确指示。
    ported: false,
    task: '**必须**产出 `RESULT_SOURCES.json`：为代码真跑出来的每个量声明**数在哪**。'
      + '**必须**只写定位（`{result_id, name, locator, json_path, unit}`），'
      + '**不得**写任何数值——harness 会真跑你的代码，从产物字节里读出每个数铸成账本。',
    how: [
      '上游是你在阶段 3 交的代码与 `DELIVERABLES.json`。逐个要进论文的量，回答三件事：'
        + '哪个文件（`locator`，相对 `code/`）、文件内哪个路径（`json_path`，如 `problem1.n_star`）、'
        + '单位是什么。',
      '**每个量拆一条**："方案 = {n, k, 置信水平}" 是三个数，写三条（`name` 里写清是哪个）。',
      '`locator` 指向的文件**必须**是你的代码真的会写出的 JSON 文件；'
        + 'harness 会执行 `code/main.py` 然后逐条核对——解析不到、落空、非有限数，都具名失败。',
      '账本（`results.json`）由 harness 铸出并落盘——你**看不到也不需要**看到它的数值；'
        + '下一阶段的图表声明只引用你这里声明的 `result_id`。',
    ],
    forbidden: [
      '**不得**在 `RESULT_SOURCES.json` 里写任何数值（`value` 字段根本不存在）。'
        + '写数 = 数又回到模型手里，前后一致与可追溯全部作废。',
      '**不得**声明代码不会产出的 locator，也**不得**猜一个 json_path——'
        + '铸数失败会点名到具体哪一条。',
      '**不得**把多个数塞进一条声明（json_path 解析出对象/数组 = 失败）。',
    ],
    selfCheck: [
      '`RESULT_SOURCES.json` 是合法 JSON 对象，`sources` 数组非空。',
      '每条声明的 locator 都对应 `code/` 下代码真的会写的 JSON 文件，json_path 都是点路径。',
      'result_id 无重复；每个数单独一条。',
      '没有出现任何数值字面量。',
    ],
  },
  'figure-declare': {
    // 参考工作流里没有这个独立技能（它让模型在编码的同时写绘图脚本）。
    // 本 harness 把"声明"拆成独立阶段：数由 harness 铸出，这里只组织图。自创 → 明确指示。
    ported: false,
    task: '**必须**产出 `FIGURE_DECLARATIONS.json`：把 harness 铸出的结果账本组织成数据图的**声明**。'
      + '**必须**只声明结构（figure_id / chart_type / data_refs / caption），'
      + '**不得**写渲染代码、**不得**产出任何图像字节、**不得**在题注里写账本之外的数字。'
      + '渲染是下一阶段（确定性执行体）的事。',
    how: [
      '上游 `03-code/results.json` 是**唯一取数口**：每条 `{result_id, name, value, unit}` '
        + '都是 harness 真跑代码后从产物字节里铸出的。`data_refs` **必须**指向其中真有的 `result_id`。',
      '**必须**逐字沿用阶段 1 FIGURE_MANIFEST 里的图名；若你确实要改进图（拆分/合并/换图型），'
        + '**必须**用 `plan_deviations: [{"from", "to", "reason"}]` 申报——申报了放行并留痕，静默改名必被拒。',
      '`chart_type` 只能是 `line` / `scatter` / `bar` / `table` 四个之一；'
        + '`caption` / `x_label` / `y_label` 里**不得**出现任何数字（渲染器有守卫，账本之外的数一律拒绝）。',
      '与阶段 1 的清单对账：数据图 12–20 张；每个子问题至少一张；横向对比、灵敏度、校核图都要有归属。',
    ],
    forbidden: [
      '**不得**产出图像字节（`.png`/`.jpg`/`.svg`）。本阶段只声明——`no_render` 语义在声明层同样成立。',
      '**不得**在 `data_refs` 里写账本之外的 id，也**不得**在题注里写具体数值。'
        + '数值只能由渲染器从账本取——这是"数不由模型持有"的最后一道缝。',
      '**不得**用架构前缀（`fig_arch`/`fig_flow`/`fig_roadmap`/`fig_pipeline`/`fig_framework`）命名数据图——'
        + '那些留给流程/架构图阶段，混用会让两边的对账互相踩。',
    ],
    selfCheck: [
      '`FIGURE_DECLARATIONS.json` 是合法 JSON 对象，`figures` 数组非空。',
      '每条 `data_refs` 都解析到账本里真有的 `result_id`。',
      '图名与阶段 1 清单一致，或分叉已用 `plan_deviations` 申报且写了理由。',
      '题注里没有任何数字。',
    ],
  },
  figure: {
    ported: true,
    task: '产出**图表**：把阶段 4 的图声明渲染成真图，并与阶段 1 的 FIGURE_MANIFEST 对账。'
      + '本阶段是**确定性**的——不调用模型，按账本取数渲染。',
    how: [
      '命名规则：数据图**不得**用架构前缀（`fig_arch`/`fig_flow`/`fig_roadmap`/`fig_pipeline`/'
        + '`fig_framework`/`fig_network`/`fig_state`/`fig_decision`/`fig_overview`）——'
        + '那些前缀留给阶段 6 的流程图。',
      '渲染器是**固定的**：Okabe–Ito 色盲安全配色、680×420 viewBox、字号下限 9px、'
        + '数值刻度用等宽字体。声明里能改的只有 `chart_type` / `data_refs` / 题注与轴标签。',
      '半成品检测：有 `_plot_data.json` 却没有任何图，或有数据准备脚本却没有图，都算未完成。',
    ],
    forbidden: [
      '**不得**在数据图上加标题（`plt.title()` 的等价物）。题注由正文给，图里重复一遍是噪声——'
        + '这条是门禁 `figure_style_rules`：声明的题注不得作为文本出现在 SVG 里。',
      '**不得**用默认色板（`tab10`）与 CSS 颜色名、`RdYlGn`/`RdBu_r`/`dark_background`——'
        + '打印成灰度后不可区分。这条也是 `figure_style_rules` 的判据。',
      '**不得**输出低于 300 DPI 的图。本阶段的产物是 SVG（矢量，与分辨率无关）；'
        + '这条地板在栅格化路径上生效——阶段 11 把 SVG 转成 PNG 嵌进 Word 时按 300 DPI 渲染。',
    ],
    selfCheck: [
      'manifest 里每张数据图都有对应文件，且没有清单外的图。',
      '无图内标题、非默认色板、字号 ≥9px、元素不越出画布。',
      '命名前缀合规（数据图不用架构前缀）。',
      '每条 `data_refs` 都解析到阶段 3 投影里真有的 Result。',
    ],
  },
  diagram: {
    ported: true,
    task: '产出**流程与架构图**（路线图 / 数据流 / 框架图）。本阶段**确定性**，按模板渲染。',
    how: [
      '**模板族固定五种，按图选模板**：路线图 `tpl_roadmap`（四问依赖链、数据流总路线）/'
        + '流程 `tpl_flow`（决策流程、算法步骤）/ 架构 `tpl_arch`（系统分层）/'
        + '框架 `tpl_framework`（建模框架）/ 管线 `tpl_pipeline`（数据处理管线）。'
        + '**不许自创模板形态**——模板族的价值是全篇一致。',
      '**命名前缀固定**：`fig_arch` / `fig_flow` / `fig_pipeline` / `fig_framework` / `fig_roadmap`，'
        + '几何精度图用 `tikz_`。这些前缀与数据图（阶段 4）**互斥**，不得混用。',
      '**与 manifest 对账**：阶段 1 的 FIGURE_MANIFEST 里属于 DRAWIO/HTML 段的每一条，'
        + '都必须真的产出一个文件；结构来自分析里的 `ARCH_DECLARATION` 块（**没有声明就不画**）。'
        + 'TIKZ 几何族需要 LaTeX 引擎，本仓库没有——那几张**如实标注够不到**，门禁给 `2` 不给 `0`。',
      '**风格族三选一，全篇统一**：A 朴素竞赛风（黑白为主、线框清晰）/ B 现代精致风（克制的配色与留白）/ '
        + 'C 纯黑白（零色彩——判据是全文不出现任何 `hsl(...)` 与强调色变量）。'
        + '混用两个风格族会让整篇看起来像拼凑的。',
      '**单页、矢量、无白边**：产出的 PDF 必须单页、文字是可选中的字体对象（不是位图）、'
        + '且没有大片留白边距。多页或纯位图都算未完成。',
      '**元素级几何自检**：渲染后逐个元素核对四类问题——文字溢出被裁切、元素越出画布、'
        + '文字块互相重叠、声明对齐的元素中轴漂移（同一列/行的元素中轴偏差超过 4px 即失败）。'
        + '这四类都必须在提交前自己核一遍。',
    ],
    forbidden: [
      '**不得**与数据图混用前缀——架构图用 `fig_arch`/`fig_flow`/`fig_roadmap` 等，'
        + '数据图用阶段 4 的规则；混用会让阶段 4/5 的对账互相踩。',
      '**不得**出现文字溢出裁切、越界、文字块重叠、声明对齐漂移——这四类各有专门判据，'
        + '而且是**渲染后**才能发现，所以必须在提交前自己核。',
      '**不得**在一个风格族里混进另一个的配色或线宽。C 族尤其严格：出现任何颜色即失败。',
    ],
    selfCheck: [
      'manifest 的 HTML/DrawIO/TikZ 段对账通过（每条都有文件）。',
      '四类几何问题零命中：溢出 / 越界 / 重叠 / 对齐漂移（>4px）。',
      '全篇只用一个风格族；C 族时零颜色。',
      'PDF 单页、矢量（文字可选中）、无明显白边。',
    ],
  },
  review: {
    ported: true,
    task: '产出**逻辑对抗复核**：找出会让论文被评委一击致命的**逻辑缺陷**，'
      + '并给出机器可读的结论 `COMP_REVIEW_VERDICT.json`。'
      + '**本阶段同时承载 L5 的三视角评审**（三视角在本阶段内部跑）。',
    how: [
      'findings 的类别固定：`bound_direction`（边界方向）/ `double_count`（重复计数）/'
        + '`extrapolation`（外推越界）/ `missing_feature`（漏了机制）/ `cross_problem`（跨问不一致）。',
      '严重度三档：`fatal` / `major` / `minor`。**只有 fatal 会阻断**。',
      '每条 finding 必须给 `where`（在哪）、`evidence`（证据）、`fix`（怎么修）。',
      '三视角评审**分别**从三个角度读同一份产物（方法是否成立 / 数字是否可信 / 论证是否自洽），'
        + '并把缺陷合进同一份 verdict。',
    ],
    forbidden: [
      '**不得**把 major/minor 报成 fatal 来"保险"——误报会让回滚白跑。'
        + 'major/minor 不阻断，但必须在论文里如实标注为情景模拟/假设。',
      '**不得**只报"建议加强论证"这类无法执行的意见。每条都要能指到具体位置。',
    ],
    selfCheck: [
      '`COMP_REVIEW_VERDICT.json` 是合法 JSON，含 `findings[]` 与 `fatal_count`。',
      '`fatal_count` 与 findings 里 fatal 的条数一致。',
      'fatal > 0 → **必须回滚**到归属阶段（建模 → 阶段 2；代码 → 阶段 3）修正后重跑，不许进阶段 7。',
    ],
  },
  paper: {
    ported: true,
    task: '产出**论文正文**（单文件 `paper/main.md`）。'
      + '**本阶段是装配，不是再推理**：上游产物已经确定了内容，你的任务是把它们组织成论文。',
    how: [
      '章节骨架固定：`# 论文标题` / `## 摘要` / `## 1 问题重述` … / `## 8 模型评价与推广` /'
        + '`## 参考文献` / `## 附录 A：代码`。标题在全文唯一。',
      '图用 `![图 N：题注](figures/xxx.png)` 嵌入；表用**三线表**，题注 `**表 N：题注**` 独占一行。',
      '**正文（附录之前）不少于 20 页**（按每页 800 字符估算）。附录不计入页数。',
      '**参考文献 ≥3 条**，且**至少一条要指向你实际用过的方法**（抽样检验 / 序贯 / 贝叶斯 / 决策 / '
        + '优化 / 仿真 …）。这条是当前最高频的拒绝——它不是格式问题，是"你的论文看起来没读过方法文献"。',
      '**问题重述**用自己的话转述题面背景与各问要求，不要把题面原文贴一遍。',
    ],
    forbidden: [
      '**不得**出现任何 LaTeX 结构：`\\begin{}`/`\\cite{}`/`\\ref{}`/`\\includegraphics{}` 等一律禁止，'
        + '也不得产出 `.tex` 文件。论文是 Markdown。',
      '**不得**现场发明建模结论。凡需要推理的内容（"为什么不用 SPRT"）必须在阶段 1/2 的产物里'
        + '**已经存在**；上游没有的，你不许补——这是 `paper_claim_check` 要拦的东西。',
      '**不得**留连续空行或近空章节。任一章节的正文（不含表与代码块）不少于 120 字。',
      '**不得**在正文里写自算数字。数字只能来自上游 Result（用 `{<result_id>}` 占位符）或题面给定值。',
    ],
    selfCheck: [
      '`paper/main.md` ≥ 5120 字节；正文 ≥ 20 页。',
      '无 LaTeX 残留、无 `.tex` 产物；上游三件产物各 ≥500 字符。',
      '参考文献 ≥3 条且至少一条含方法关键词；评价章四要素齐全；逐问都有对应章节。',
      '`paper_claim_check` 通过**才准写**——每条将写进论文的结果，上游都要有已核验的落地。',
    ],
  },
  improve: {
    // 参考工作流里**没有**这个技能（只有产物形态 PAPER_IMPROVEMENT_STATE.json 与
    // _improvement_rounds/）。所以下面一律用**明确指示**，不用建议。
    ported: false,
    task: '**必须**对 `paper/main.md` 执行"找问题 → 改写 → 复检"的循环，'
      + '并**必须**产出 `PAPER_IMPROVEMENT_STATE.json` 与 `paper/_improvement_rounds/roundN.md`。'
      + '**每一轮的稿子都必须保留**——不许覆盖上一轮。',
    how: [
      '**每一轮必须记录缺陷数**：写进 `PAPER_IMPROVEMENT_STATE.json` 的 `rounds[].defects`。'
        + '没有这个计数，"有没有进展"就无法判定，整条循环也就没有终止依据。',
      '**终止条件只有两条，必须命中其中一条**：'
        + '① `termination: "approved"`——检查器报**零缺陷**时**立即停止**；'
        + '② `termination: "no-progress"`——"进展"的定义是**缺陷数严格下降**，'
        + '连续三轮没有下降则停止。',
      '**必须**在 `termination` 里写明命中哪一条。没有 `termination` 字段即门禁硬失败。',
    ],
    forbidden: [
      '**不得**用"超时"或"轮次用尽"作为终止理由。**额度不是终止条件**——'
        + '实测（strict-12）多给额度只会让稿子在"改好"与"改坏"之间震荡；'
        + '旧系统曾在撞上限后**自行宣布定稿**，那等于把未收敛说成已收敛。',
      '**不得**在拿到"零缺陷"之后继续编辑。批准即收口：继续编辑只会把已经干净的稿子改坏。',
      '**不得**删除或覆盖历史轮次。`roundN.md` 是"修之前长什么样"的唯一证据。',
    ],
    selfCheck: [
      '`PAPER_IMPROVEMENT_STATE.json` 含 `rounds[].defects`（每轮一个数）与 `termination`。',
      '`termination` 是 `approved` 或 `no-progress` 之一，且与缺陷数序列一致。',
      '`paper/_improvement_rounds/` 下的轮次文件齐全，未被覆盖。',
    ],
  },
  'format-profile': {
    ported: true,
    task: '产出**格式画像**：把用户给的文字格式要求解析成机器可读的 `_text_profile.json`。'
      + '**本阶段只准产出这一个文件**，不得写正文、不得改动任何其它东西。',
    how: [
      '**中文字号 → pt**：初号 42 / 小初 36 / 一号 26 / 小一 24 / 二号 22 / 小二 18 / 三号 16 /'
        + '小三 15 / 四号 14 / 小四 12 / 五号 10.5 / 小五 9。',
      '**字体术语 → 系统名**：宋体 SimSun / 黑体 SimHei / 仿宋 FangSong / 楷体 KaiTi /'
        + '微软雅黑 Microsoft YaHei / 等线 DengXian。',
      '逐条把要求落到字段上（页面边距 / 字体 / 各级标题字号与对齐 / 正文行距与首行缩进 /'
        + '表格三线线宽与字号 / 参考文献悬挂缩进 / 图宽与对齐 / 代码块字号与底色）。',
      '**未识别的要求保持默认，并在 `_matched_items` 里说明**——不许猜。',
    ],
    forbidden: [
      '**不得**产出第二个文件。参考的纪律是"本步骤只输出一个 JSON 文件"，'
        + '多产出即硬失败（门禁 `profile_single_file`）。',
      '**不得**为没写的要求编造值。用户没提的行距就用默认值，并记进 `_matched_items` 的未识别项。',
    ],
    selfCheck: [
      '`_text_profile.json` ≥ 300 字节且是合法 JSON 对象。',
      '除它之外本阶段目录里没有别的产物。',
      '`_matched_items` 至少 1 条（说明哪些要求被识别、落在哪个字段）。',
    ],
  },
  'format-check': {
    ported: true,
    task: '产出**格式自检报告** `DOCX_FORMAT_CHECK_REPORT.md`，并在**安全**的前提下就地修复 Markdown。'
      + '**即使全部检查通过，也必须出报告**——报告本身是产物。',
    how: [
      '五类检查，逐类给 ✅/⚠️ 与修复计数：**代码块完整性** / **公式编号语法** / **三线表格式** /'
        + '**伪标题·伪题注·伪公式号** / **Markdown 噪声**。',
      '报告固定三段：自动修复的问题 / 仍需人工处理的问题 / 结论。',
      '修复**保守**，只做三类确定的等价改写：空的全角括号 `（）`→`()`；**同一行内**的 `$$X$$`→`$X$`'
        + '（整行只有 `$$X$$` 的是块公式，不动）；代码围栏的语言标记**只有 100% 可推断时才补**，'
        + '推不出来就留裸围栏。每一次修复都过"改动前后遮掉目标模式后逐字节相同"的比对。',
      '修复**就地**施加在 `07-paper/paper/main.md` 上，修复前的文本另存到本阶段目录的 `_before/main.md`'
        + '（"改动前长什么样"的唯一副本，也是回滚证据）。',
    ],
    forbidden: [
      '**不得**改变公式语义。只允许上面那三类等价改写。',
      '**不得**与导出前校核重复（图片闭合、LaTeX 残留、引用闭合、字数那些归阶段 11 的校核）。',
      '**不得**因为有问题就阻塞——**本阶段是非阻塞的**：未消解的人工项照写报告。',
    ],
    selfCheck: ['`DOCX_FORMAT_CHECK_REPORT.md` ≥ 200 字节', '五类检查都有结论', '修复计数与实际改动一致'],
  },
  'docx-export': {
    // 参考工作流里**没有**这个技能（只有引擎 tools/docx-cn-engine 与产物形态
    // paper/main.docx）。所以下面一律用**明确指示**。
    ported: false,
    task: '**必须**产出 `paper/main.docx`：用 `paper/main.md` 与阶段 9 的 `_text_profile.json` '
      + '渲染出目标格式的 Word 文档，并**必须**在导出前通过格式校核。'
      + '校核不过就**不得**产出 docx，也不得假装导出成功。',
    how: [
      '**必须**在导出前跑一次校核：Markdown 是否还有占位符、表格列数是否一致、图片链接是否闭合。'
        + '任一致命项存在即**拒绝导出**，并把致命项写进报告。',
      '**必须**按 `_text_profile.json` 落格式（字号 / 字体 / 行距 / 三线表线宽 / 悬挂缩进）。'
        + '画像缺失或非法时**回退到默认画像**，并在报告里写明"用了默认"与回退原因。',
      '**必须**校验产物的存在与体量：导出器退出码为 0 **不等于**导出成功——'
        + '还要文件真的存在且不是空壳。',
      '**必须**把 SVG 图栅格化成 PNG 再交给引擎（引擎只嵌位图），栅格化按 300 DPI；'
        + '栅格化依赖缺失时**具名拒绝**，不许嵌占位符充数。',
    ],
    forbidden: [
      '**不得**在致命项存在时产出 docx。宁可交出"缺 docx 的交付包 + 明确的致命项报告"，'
        + '也不要交出一个看起来完整、实际格式错乱的 Word 文件。',
      '**不得**修改 `paper/main.md` 的正文内容。本阶段只做格式转换；图链接的 `.svg → .png`'
        + '只发生在导出用的派生副本（`_export.md`）上。',
    ],
    selfCheck: [
      '导出前校核的致命项为 0。',
      '`paper/main.docx` 存在且体量合理（不是空壳）。',
      '`DOCX_EXPORT_REPORT.md` 里写明了格式画像的来源（explicit / 回退到默认）与回退原因。',
      '引用到的 SVG 图都真的被栅格化成了 PNG（报告里有逐张记录）。',
    ],
  },
}

/**
 * 组装一个阶段的简报。
 *
 * 顺序即优先级（**越靠后越重要**——模型的注意力在末尾最集中）：
 * 任务 → 契约 → 上游 → 怎么做 → 不要做 → 自检 → 完成标志。
 *
 * @param spec - 阶段。
 * @param upstreamText - 上游产物的内联内容（`相对路径 → 文本`）。
 * @param selfCheckTool - 该阶段是否挂了可调用的自检工具（阶段 2a/3）。
 * @returns 简报全文。
 */
export function stageBriefing(
  spec: StageSpec,
  upstreamText: ReadonlyMap<string, string>,
  selfCheckTool: boolean,
): string {
  const skill = SKILLS[spec.id]
  if (skill === undefined) throw new Error(`no skill content for stage '${spec.id}'`)
  const L: string[] = []
  const sec = (name: string): void => { L.push('', `## ${name}`) }

  sec(BRIEFING_SECTIONS[0])
  L.push(skill.task)
  L.push('', `本阶段目录：\`stages/${stageDirName(spec)}/\`。`
    + (skill.ported ? '技能转写自参考工作流。' : '**本阶段的技能是本 harness 自创的**（参考工作流里没有它）——'
      + '所以下面的话是指示，不是建议。'))

  sec(BRIEFING_SECTIONS[1])
  L.push('harness 会用下面这些判据量你的产出。**逐条对着它写**，不要写完再猜：')
  for (const p of spec.produces) {
    const floor = p.minBytes === undefined ? '' : `，≥ ${String(p.minBytes)} 字节`
    L.push(`- \`${p.file}\`（${p.kind}${floor}）—— ${p.desc}`)
  }
  // **回答形态必须教给模型**。runner 的映射规则（1 份取原文 / ≥2 份取 JSON 信封）
  // 原本只写在 runner.ts 的模块头——那是给人看的，模型看不见。2024B-stages-1 的
  // 第一次真实运行撞在这里：模型产出 270KB 推理 + 四个独立的围栏代码块，
  // **没有一个 JSON 信封**，于是"信封不是合法 JSON"。规则没投递，就不是模型不守约。
  L.push('', `- **回答形态（硬性）**：${answerFormOf(spec)}`)

  sec(BRIEFING_SECTIONS[2])
  if (upstreamText.size === 0) {
    L.push('（本阶段没有上游产物。）')
  } else {
    for (const [path, text] of upstreamText) {
      L.push(`### ${path}`, '', text)
    }
  }

  sec(BRIEFING_SECTIONS[3])
  for (const line of skill.how) L.push(`- ${line}`)

  sec(BRIEFING_SECTIONS[4])
  for (const line of skill.forbidden) L.push(`- ${line}`)

  sec(BRIEFING_SECTIONS[5])
  if (selfCheckTool) {
    L.push('你可以调用 `check_container` **任意多次**，在提交前验证结构化声明。'
      + '它返回逐条问题；**它说不可准入就不要提交**——它跑的是 harness 的同一套判据。')
    // 语料索引**只在工具确实挂了时**才列。工具没挂却点名文档 = 又造一条
    // "无法被遵守的指令"（round-5 的原缺陷）。所以两者由同一个开关控制。
    const docIndex = skillDocIndexBlock(spec.id)
    if (docIndex !== '') L.push('', docIndex)
  }
  L.push('逐条自查（这些是 harness 会跑的判据，不是建议）：')
  for (const line of skill.selfCheck) L.push(`- ${line}`)

  sec(BRIEFING_SECTIONS[6])
  L.push(`产出齐备（${spec.produces.map(p => p.file).join('、')}）、且上面每一条自检都成立。`
    + '门禁全过才会签发本阶段的通行证，下一阶段才能启动。')
  return L.join('\n')
}

/**
 * 该阶段的**任务陈述**（执行者收到的契约）。
 *
 * 导出给逐节点审计用：审计员必须看到"执行者被要求做什么"，才能判"是否按要求完成"。
 * 但**不导出执行者的提示词全文**——那会把上游内联也带过去，而审计只该看契约与产物。
 *
 * @param spec - 阶段。
 * @returns 任务陈述；该阶段没有技能内容时抛错。
 */
export function skillTaskOf(spec: StageSpec): string {
  const skill = SKILLS[spec.id]
  if (skill === undefined) throw new Error(`no skill content for stage '${spec.id}'`)
  return skill.task
}

/** 该阶段的技能是否转写自参考（`false` = 本 harness 自创）。 */
export function isPorted(spec: StageSpec): boolean {
  return SKILLS[spec.id]?.ported ?? false
}

/**
 * 一个阶段的**回答形态**（给模型看的硬性要求）。
 *
 * 与 `runner.parseStageOutput` 的映射规则**同源**：1 份产出取原文，≥2 份取 JSON 信封。
 * 规则只写一份，然后两边用——这里导出给测试钉住"简报教的形态 = runner 解析的形态"，
 * 两边漂移时测试会红。
 *
 * @param spec - 阶段。
 * @returns 一句投递给模型的硬性要求。
 */
export function answerFormOf(spec: StageSpec): string {
  if (spec.produces.length === 1) {
    const only = spec.produces[0]
    return `你的回答就是 \`${only?.file ?? '?'}\` 的完整内容本身——从第一个字符到最后一个字符都是它，`
      + '不得加任何解释、任何代码围栏（```）、任何前后缀。'
  }
  const keys = spec.produces.map(p => p.file)
  return `你的回答必须**只有一个** JSON 对象，形如 \`{"files": {…}}\`：`
    + `顶层键是 \`files\`，它下面**恰好**这几个键——${keys.map(k => `\`${k}\``).join('、')}——`
    + '每个键的值就是那份文件的完整内容（字符串）。'
    + '除这一个 JSON 对象外**不得有任何其它字符**：不要解释、不要推理过程、不要代码围栏、'
    + '不要在 JSON 前后加任何话。你的回答会被直接按这个形态解析，多一个字符都会解析失败。'
    + (spec.produces.some(p => p.kind === 'dir')
      ? `目录型产物（${spec.produces.filter(p => p.kind === 'dir').map(p => `\`${p.file}\``).join('、')}）`
        + '**不要**单独作为键列出——把里面的文件用完整相对路径当键'
        + '（例如 `code/main.py`、`code/problem1.py`），目录本身不出现在键里。'
      : '')
}

/** 全部阶段的技能是否都有内容（装配完整性）。 */
export function missingSkills(): ReadonlyArray<string> {
  return STAGES.filter(s => SKILLS[s.id] === undefined).map(s => s.id)
}
