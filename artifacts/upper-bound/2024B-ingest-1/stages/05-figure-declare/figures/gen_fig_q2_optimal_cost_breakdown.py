"""展示问题2情况1最优策略的单位期望成本瀑布分解。

单面板依次给出采购、零配件检测、装配、成品检测、拆解和调换损失六个
成本分项，以累计阶梯和色带连接至单位期望总成本，并在右上角补充单位
期望利润。数据来自账本 R-Q2-case1-U、R-Q2-case1-profit 及六个
R-Q2-case1-cost-* 条目；所有金额、累计值与贡献比例均在运行时读取。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np


doc = load("results.json")
values = {item["result_id"]: item["value"] for item in doc["results"]}

deltas = np.array(
    [
        float(values["R-Q2-case1-cost-purchase"]),
        float(values["R-Q2-case1-cost-inspect"]),
        float(values["R-Q2-case1-cost-assembly"]),
        float(values["R-Q2-case1-cost-product-inspect"]),
        float(values["R-Q2-case1-cost-disassemble"]),
        float(values["R-Q2-case1-cost-exchange"]),
    ],
    dtype=float,
)
unit_cost = float(values["R-Q2-case1-U"])
unit_profit = float(values["R-Q2-case1-profit"])

cost_names = [
    cn("采购"),
    cn("零配件检测"),
    cn("装配"),
    cn("成品检测"),
    cn("拆解"),
    cn("调换损失"),
]
labels = cost_names + [cn("总成本")]
component_levels = np.cumsum(deltas)
levels = np.append(component_levels, unit_cost)
layer_colors = [
    COLORS["up"] if delta >= 0 else COLORS["down"] for delta in deltas
]
point_colors = [PALETTE[0], *layer_colors, PALETTE[1]]
n = len(labels)

fig, ax = plt.subplots(figsize=(6.0, 3.8))
ax.grid(axis="y", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

x_positions = np.arange(n)
right_edge = x_positions[-1] + 0.5

ax.fill_between(
    [x_positions[0] - 0.5, right_edge],
    0.0,
    levels[0],
    alpha=0.06,
    color=PALETTE[0],
    zorder=0,
)
for i in range(1, len(deltas)):
    color = layer_colors[i - 1]
    bottom = min(levels[i - 1], levels[i])
    top = max(levels[i - 1], levels[i])
    ax.fill_between(
        [x_positions[i] - 0.5, right_edge],
        bottom,
        top,
        alpha=0.15,
        color=color,
        zorder=i,
    )
    ax.plot(
        [x_positions[i] - 0.5, right_edge],
        [levels[i], levels[i]],
        color=color,
        linewidth=0.7,
        linestyle="--",
        alpha=0.35,
        zorder=i,
    )

bar_width = 0.56
for i, delta in enumerate(deltas):
    bottom = 0.0 if i == 0 else levels[i - 1]
    height = levels[i] - bottom
    color = PALETTE[0] if i == 0 else layer_colors[i - 1]
    ax.bar(
        x_positions[i],
        height,
        bottom=bottom,
        width=bar_width,
        color=_lighten(color, 0.35),
        edgecolor=color,
        linewidth=1.0,
        zorder=4,
    )

ax.bar(
    x_positions[-1],
    unit_cost,
    bottom=0.0,
    width=bar_width,
    color=_lighten(PALETTE[1], 0.35),
    edgecolor=PALETTE[1],
    linewidth=1.2,
    zorder=4,
)

ax.step(
    x_positions,
    levels,
    where="mid",
    color=PALETTE[0],
    linewidth=2.4,
    zorder=6,
)

value_span = float(np.max(levels) - np.min(levels))
label_offset = value_span * 0.025
label_values = np.append(deltas, unit_cost)
for i, value in enumerate(label_values):
    color = point_colors[i]
    ax.scatter(
        x_positions[i],
        levels[i],
        color=color,
        s=70,
        zorder=8,
        edgecolors="white",
        linewidths=1.8,
    )
    ax.text(
        x_positions[i],
        levels[i] + label_offset,
        f"{value:.2f}",
        ha="center",
        va="bottom",
        fontsize=8.0,
        fontweight="bold" if i in (0, n - 1) else "normal",
        color=color,
        bbox={
            "boxstyle": "round,pad=0.15",
            "facecolor": "white",
            "edgecolor": color if i in (0, n - 1) else "none",
            "alpha": 0.9,
            "linewidth": 0.5,
        },
        zorder=9,
    )

ax.text(
    0.03,
    0.95,
    cn(f"总成本：{unit_cost:.2f}\n单位利润：{unit_profit:.2f}"),
    transform=ax.transAxes,
    fontsize=8.5,
    ha="left",
    va="top",
    fontweight="bold",
    color=COLORS["primary"],
    bbox={
        "boxstyle": "round,pad=0.35",
        "facecolor": "white",
        "edgecolor": COLORS["primary"],
        "alpha": 0.92,
        "linewidth": 0.9,
    },
    zorder=10,
)

legend_patches = []
for name, delta in zip(cost_names, deltas):
    color = layer_colors[cost_names.index(name)]
    sign = "+" if delta >= 0 else ""
    share = abs(delta) / abs(unit_cost) * 100 if unit_cost else 0.0
    legend_patches.append(
        mpatches.Patch(
            facecolor=_lighten(color, 0.4),
            edgecolor=color,
            linewidth=1.1,
            label=cn(f"{name}  {sign}{delta:.2f} ({share:.0f}%)"),
        )
    )

legend = ax.legend(
    handles=legend_patches,
    loc="lower right",
    frameon=False,
    labelspacing=0.30,
    handlelength=1.5,
    handleheight=0.9,
    fontsize=7.4,
    title=cn("分项贡献"),
    title_fontsize=8.0,
)
legend.set_zorder(11)

ax.set_xticks(x_positions)
ax.set_xticklabels(
    labels,
    rotation=22,
    ha="right",
    rotation_mode="anchor",
    fontsize=8.2,
)
ax.set_xlabel(cn("成本构成"), fontsize=10)
ax.set_ylabel(cn("单位期望成本（元/件）"), fontsize=10)
ax.set_xlim(-0.7, n - 0.3)

y_min = min(0.0, float(np.min(levels)))
y_max = max(0.0, float(np.max(levels)))
y_padding = max(value_span * 0.12, abs(y_max) * 0.02)
ax.set_ylim(y_min, y_max + y_padding)

ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
fig.tight_layout()
save(fig, "fig_q2_optimal_cost_breakdown")
