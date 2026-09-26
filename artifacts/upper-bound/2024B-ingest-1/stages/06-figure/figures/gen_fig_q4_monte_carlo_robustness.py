"""问题 2 利润水平 vs 问题 4 决策稳健性的六点对账散点图。

本图讲什么：横轴取问题 2 表 1 六种情况各自的最优期望利润（元/件），纵轴取问题 4 在同
六种情况的抽样不确定下重解得到的“最优决策与点估计决策一致率”（比例），六个情况各落一
点，用于描述性对照“利润高的方案是否同时更稳健”。全图只有一个 panel，不拟合趋势线、不
标注回归式，仅按账本点位做身份标注（情况 1–6），结论与口径一律留给 LaTeX 题注。

数据来源（results.json，逐点一一对应，脚本内不写死任何数值）：
  情况 1：R-Q2-case1-profit / R-Q4-case1-consistency-rate
  情况 2：R-Q2-case2-profit / R-Q4-case2-consistency-rate
  情况 3：R-Q2-case3-profit / R-Q4-case3-consistency-rate
  情况 4：R-Q2-case4-profit / R-Q4-case4-consistency-rate
  情况 5：R-Q2-case5-profit / R-Q4-case5-consistency-rate
  情况 6：R-Q2-case6-profit / R-Q4-case6-consistency-rate

关键数值（读自账本，供题注引用）：利润最低的情况 2 对应一致率 0.9485；利润次低的情况 4
对应一致率 0.9995；利润最高的两点（情况 1 与情况 6）分别对应 0.916 与 0.6085，说明利润
水平与决策稳定性并不同向。输出：figures/fig_q4_monte_carlo_robustness.png。
"""

import json

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

with open("results.json", encoding="utf-8") as fh:
    LEDGER = {row["result_id"]: row["value"] for row in json.load(fh)["results"]}

# 每个点 = (身份标签, 横轴 ref, 纵轴 ref)；数值全部由 LEDGER 取出
POINTS = [
    ("情况1", "R-Q2-case1-profit", "R-Q4-case1-consistency-rate"),
    ("情况2", "R-Q2-case2-profit", "R-Q4-case2-consistency-rate"),
    ("情况3", "R-Q2-case3-profit", "R-Q4-case3-consistency-rate"),
    ("情况4", "R-Q2-case4-profit", "R-Q4-case4-consistency-rate"),
    ("情况5", "R-Q2-case5-profit", "R-Q4-case5-consistency-rate"),
    ("情况6", "R-Q2-case6-profit", "R-Q4-case6-consistency-rate"),
]

xs = np.array([LEDGER[x_ref] for _, x_ref, _ in POINTS], dtype=float)
ys = np.array([LEDGER[y_ref] for _, _, y_ref in POINTS], dtype=float)
labels = [tag for tag, _, _ in POINTS]

# 标签相对点位的偏移（点，确定性给定，避免六点标签互相压盖）
OFFSETS = [(-42, 5), (9, -12), (8, -12), (8, 6), (-40, 8), (-42, 4)]

fig, ax = plt.subplots(figsize=(6.0, 4.5))

ax.scatter(
    xs,
    ys,
    s=120,
    color=PALETTE[0],
    edgecolor=_lighten(PALETTE[0], 0.55),
    linewidth=1.0,
    zorder=3,
)

for tag, xv, yv, off in zip(labels, xs, ys, OFFSETS):
    ax.annotate(
        tag,
        xy=(xv, yv),
        xytext=off,
        textcoords="offset points",
        fontsize=8.5,
        zorder=4,
    )

x_pad = 0.06 * (xs.max() - xs.min())
y_pad = 0.08 * (ys.max() - ys.min())
ax.set_xlim(xs.min() - x_pad, xs.max() + x_pad)
ax.set_ylim(ys.min() - y_pad, ys.max() + y_pad + 0.02)

ax.set_xlabel("问题 2 该情况最优期望利润（元/件）")
ax.set_ylabel("问题 4 该情况决策一致率（比例）")

ax.grid(True, linestyle=":", linewidth=0.6, alpha=0.45)
ax.set_axisbelow(True)

save_fig(fig, "figures/fig_q4_monte_carlo_robustness.png")
