"""问题 3 实例与问题 2 表 1 六种情况的最优期望利润量级对照（单 panel 柱状图）。

本图讲什么
    把问题 3 的 2 工序 8 零配件实例在最优节点级决策下的单位成品期望利润，与问题 2
    表 1 六种情况的最优期望利润放在同一利润口径（元/件）下做降序排列的横向对照，
    让读者一眼看出账本里唯一的问题 3 结果处在什么量级。

panel 说明
    单 panel：横轴为情形（问题 3 实例 + 表 1 情况 1-6），纵轴为单位成品期望利润
    （元/件），柱按数值降序排列，问题 3 实例的柱用高亮色区分，柱顶为账本原值。

数据来源（全部取自 results.json 账本，脚本内不写任何数值）
    R-Q3-profit        = 66.08687700045726  元/件（问题 3 实例）
    R-Q2-case1-profit  = 21.680384087791495 元/件（表 1 情况 1）
    R-Q2-case2-profit  = 13.812500000000007 元/件（表 1 情况 2）
    R-Q2-case3-profit  = 19.795610425240056 元/件（表 1 情况 3）
    R-Q2-case4-profit  = 15.875000000000007 元/件（表 1 情况 4）
    R-Q2-case5-profit  = 18.93827160493828  元/件（表 1 情况 5）
    R-Q2-case6-profit  = 21.6786703601108   元/件（表 1 情况 6）

口径说明
    两组结果来自相互独立的参数体系（零配件数量、次品率与成本参数均不同），本图只做
    同口径下的量级参照，不构成两者优劣或可比性的结论；账本中问题 3 只有 R-Q3-profit
    这一项利润结果，故不给出节点级策略组合的横向对比。
"""

import json

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# ---------------------------------------------------------------- 数据绑定
# (result_id, 横轴分组标签)，标签顺序与 FIGURE_PLAN 的 x_groups 一致
REF_LABELS = [
    ("R-Q3-profit", "问题3 实例"),
    ("R-Q2-case1-profit", "情况1"),
    ("R-Q2-case2-profit", "情况2"),
    ("R-Q2-case3-profit", "情况3"),
    ("R-Q2-case4-profit", "情况4"),
    ("R-Q2-case5-profit", "情况5"),
    ("R-Q2-case6-profit", "情况6"),
]
HIGHLIGHT = "问题3 实例"

with open("results.json", encoding="utf-8") as fh:
    _ledger = {item["result_id"]: item for item in json.load(fh)["results"]}

labels_all = [lab for _, lab in REF_LABELS]
values_all = np.array([float(_ledger[rid]["value"]) for rid, _ in REF_LABELS])
unit = _ledger[REF_LABELS[0][0]]["unit"]

# 降序排列
order = np.argsort(-values_all)
labels = [labels_all[i] for i in order]
values = values_all[order]

# ---------------------------------------------------------------- 绘图
n = len(values)
fig, ax = plt.subplots(figsize=(6.0, 4.0))
x = np.arange(n)
max_val = values.max()

facecolors = []
edgecolors = []
for lab, val in zip(labels, values):
    if lab == HIGHLIGHT:
        base = PALETTE[1]
    else:
        base = _lighten(PALETTE[0], 0.55 * (1.0 - val / max_val))
    facecolors.append(_lighten(base, 0.15))
    edgecolors.append(base)

bars = ax.bar(
    x, values, width=0.62,
    color=facecolors, edgecolor=edgecolors, linewidth=1.2, zorder=3,
)
ax.bar_label(bars, fmt="%.2f", padding=2, fontsize=8.5)

ax.set_xticks(x)
ax.set_xticklabels(labels, fontsize=9.5)
ax.set_xlabel("情形", fontsize=11)
ax.set_ylabel(f"单位成品期望利润（{unit}）", fontsize=11)
ax.set_ylim(0, max_val * 1.20)
ax.set_axisbelow(True)
ax.grid(axis="y", alpha=0.12, linestyle="--")
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.tight_layout()
save_fig(fig, "figures/fig_q3_strategy_cost_compare.png")
