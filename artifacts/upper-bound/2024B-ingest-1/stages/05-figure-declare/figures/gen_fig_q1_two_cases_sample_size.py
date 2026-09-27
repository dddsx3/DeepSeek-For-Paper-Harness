"""两种抽样判定情形的最小检测次数与临界次品数对照；单面板分组柱状图分别呈现两项同单位指标。数据来自 results.json：R-Q1-case95-n、R-Q1-case95-c、R-Q1-case90-n、R-Q1-case90-c。"""

import numpy as np
import matplotlib.pyplot as plt
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

doc = load("results.json")
values = {item["result_id"]: item["value"] for item in doc["results"]}

categories = [cn("95% 信度拒收"), cn("90% 信度接收")]
groups = {
    cn("最小检测次数 n*"): [
        values["R-Q1-case95-n"],
        values["R-Q1-case90-n"],
    ],
    cn("临界次品数 c*"): [
        values["R-Q1-case95-c"],
        values["R-Q1-case90-c"],
    ],
}

fig, ax = plt.subplots(figsize=(6.0, 2.8))
panel(ax, "(a)")

x = np.arange(len(categories))
n_groups = len(groups)
width = 0.32

for i, (name, vals) in enumerate(groups.items()):
    offset = (i - n_groups / 2 + 0.5) * width
    color = PALETTE[i]
    bars = ax.bar(
        x + offset,
        vals,
        width,
        color=_lighten(color, 0.4),
        edgecolor=color,
        linewidth=1.2,
        label=name,
        zorder=2,
    )
    ax.bar_label(bars, fmt="%.0f", padding=2, fontsize=8, color=COLORS["gray"])

ax.set_xticks(x)
ax.set_xticklabels(categories, fontsize=9)
ax.set_ylabel(cn("数量（件）"), fontsize=9)
ax.legend(frameon=False, fontsize=8, labelspacing=0.35, handlelength=1.4)
ax.set_ylim(0, max(max(vals) for vals in groups.values()) * 1.2)
ax.grid(axis="y", alpha=0.12, linestyle="--", color=COLORS["grid"])
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.tight_layout()
save(fig, "fig_q1_two_cases_sample_size")
