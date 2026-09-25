# -*- coding: utf-8 -*-
"""一次性补丁：阶段 3 拆分（code 只写建模代码 + harness 铸数；新增 figure-declare 阶段）。"""
import io

BASE = 'packages/paper/paper-foundation/src/stages/'

# ── 1) stage-service.ts：挂 afterModel ──────────────────────────────────────
p = BASE + 'stage-service.ts'
s = io.open(p, encoding='utf-8').read()
old_import = "import { deterministicRunner, type DeterministicOutcome } from './deterministic.ts'"
if old_import in s and 'runCodeAndMintResults' not in s:
    s = s.replace(old_import,
                  old_import + "\nimport { runCodeAndMintResults } from './execute-and-mint.ts'", 1)
old_hook = '      runDeterministic: deterministicRunner(this.config.onDeterministicOutcome),'
new_hook = '''      runDeterministic: deterministicRunner(this.config.onDeterministicOutcome),
      // 阶段 3 的 harness 侧后处理：**真跑代码并铸数**。模型只声明数在哪
      // （RESULT_SOURCES.json），账本由真实执行的产物字节铸成——数不由模型持有。
      afterModel: async (spec, stagesRoot) => {
        if (spec.id !== 'code') return
        const outcome = await runCodeAndMintResults(stagesRoot)
        this.config.onDeterministicOutcome?.({
          stage: 'code',
          summary: '执行 code/main.py（exit ' + String(outcome.exitCode) + '），按声明铸出 '
            + String(outcome.minted) + ' 条账目',
        })
      },'''
assert old_hook in s, 'stage-service hook anchor missing'
s = s.replace(old_hook, new_hook, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('stage-service ok')

# ── 2) briefing.ts：code 技能改契约；新增 figure-declare 技能；figure 技能改口径 ──
p = BASE + 'briefing.ts'
s = io.open(p, encoding='utf-8').read()

# 2a) code.how —— 从"声明图"改为"声明数在哪"
start = s.index("    how: [\n      '`code/main.py` 是编排入口")
end = s.index("    forbidden: [\n      '**不得**产出任何图像字节", start)
new_how = u'''    how: [
      '`code/main.py` 是编排入口，依次跑各问并汇总；每问一个 `code/problem*.py`。'
        + '**代码文件数必须 ≥ 题面问数**（逐问奇偶校验）。',
      '**你的代码会被 harness 真跑**（`python code/main.py`，工作目录就是 `code/`）。'
        + '代码必须把要进论文的量写成 **JSON 文件**放在工作目录里（例如 `outputs.json`）——'
        + '打印到 stdout 的东西不会被采集。',
      '`RESULT_SOURCES.json` 声明**数在哪**：'
        + '`{"sources": [{"result_id", "name", "locator", "json_path", "unit"}]}`。'
        + '`locator` 是代码写出的 JSON 文件名；`json_path` 是文件内的点路径'
        + '（`problem1.n_star`、`cases[0].accept`）。'
        + '**你只声明定位，不写数值**——harness 真跑代码后从产物字节里读出每个数铸成账本。'
        + 'locator 解析不到、路径落空、值不是有限数，都会具名失败。',
      '`RESULTS.md` 写结果说明：四问的关键数值、校核证据、归因、诚实边界。'
        + '散文里可以引用账本里的数（它们来自真实执行），但**不得**出现代码没产出的数。',
      '每个被声明为输出的量，都要真的写进声明的输出文件。**声明的输出必须存在且非空**。',
      '**数字只有两个合法来源**：题面给定值，或代码真跑出来的值。散文里不许出现自算数字。',
      '分类指标出现 ≥0.99 时，**必须**同时给出防泄漏说明（数据划分、去泄漏步骤）。'
        + '没有说明的 0.99 是硬失败。',
    ],
'''
s = s[:start] + new_how + s[end:]

# 2b) code.selfCheck —— 图声明相关两条改成账本/定位
old_self = """    selfCheck: [
      '`code/main.py` ≥ 500 字节、`RESULTS.md` ≥ 1024 字节、代码文件数 ≥ 题面问数。',
      '声明的每个交付物都真的存在且非空（`DELIVERABLES.json` 与磁盘一致）。',
      '没有图像字节；`FIGURE_DECLARATIONS.json` 的每条 `data_refs` 都指向自己 `results` 里真有的 id。',
      '≥0.99 的分类指标都配了防泄漏说明。',
    ],"""
new_self = """    selfCheck: [
      '`code/main.py` ≥ 500 字节、`RESULTS.md` ≥ 1024 字节、代码文件数 ≥ 题面问数。',
      '声明的每个交付物都真的存在且非空（`DELIVERABLES.json` 与磁盘一致）。',
      '`RESULT_SOURCES.json` 的每条 locator 都指向代码真写出的 JSON 文件，'
        + '`json_path` 都能解析出有限数（harness 铸账本时会逐条核）。',
      '代码真跑出 `results.json` 账本（harness 铸数）且非空。',
      '≥0.99 的分类指标都配了防泄漏说明。',
    ],"""
assert old_self in s, 'code.selfCheck anchor missing'
s = s.replace(old_self, new_self, 1)

# 2c) 新增 figure-declare 技能（自创 → 明确指示），插在 figure 之前
anchor = "  figure: {\n    ported: true,\n    task: '产出**图表**：把阶段 3 的图声明渲染成真图"
new_skill = u'''  'figure-declare': {
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
      + '本阶段是**确定性**的——不调用模型，按账本取数渲染。'''
old_anchor_full = anchor
# the original figure task text may differ slightly; locate by prefix
idx = s.index("  figure: {\n    ported: true,\n    task: '产出**图表**：把阶段")
end_of_task = s.index("',", idx + 200)
s = s[:idx] + new_skill + s[end_of_task + 1:]

# 2d) figure.how 的对账措辞
s = s.replace("与 manifest 对账（**双向**）：计划里的每张**数据图**都必须真的渲染出来；渲染出来的图也必须都在计划里。",
              "与 manifest 对账（**双向**）：计划里的每张**数据图**都必须真的渲染出来；渲染出来的图也必须都在计划里（已申报的分叉按申报后的名字对）。", 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('briefing ok')
print('ALL PATCHES APPLIED')
