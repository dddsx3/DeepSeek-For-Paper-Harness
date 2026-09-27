"""展示问题2情况1最优策略的单位期望成本分解。

面板(a)为成本累积瀑布图：六个成本分项逐项累加，并以独立总成本柱汇总。
面板(b)为各成本分项金额及其占单位期望总成本的比重。
全部绘图数值来自 results.json 中的 R-Q2-case1-cost-purchase、
R-Q2-case1-cost-inspect、R-Q2-case1-cost-assembly、
R-Q2-case1-cost-product-inspect、R-Q2-case1-cost-disassemble、
R-Q2-case1-cost-exchange、R-Q2-case1-U 和 R-Q2-case1-profit。
关键数值由账本动态注入，本文件不预置或复制任何结果值。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import PercentFormatter


doc = load("results.json")
values = {
    row["result_id"]: row["value"]
    for row in doc["results"]
}

component_ids = [
    "R-Q2-case1-cost-purchase",
    "R-Q2-case1-cost-inspect",
    "R-Q2-case1-cost-assembly",
    "R-Q2-case1-cost-product-inspect",
    "R-Q2-case1-cost-disassemble",
    "R-Q2-case1-cost-exchange",
]
required_ids = component_ids + [
    "R-Q2-case1-U",
    "R-Q2-case1-profit",
]

missing = [result_id for result_id in required_ids if result_id not in values]
if missing:
    raise KeyError(f"results.json 缺少作图所需 result_id: {missing}")

component_costs = np.asarray(
    [float(values[result_id]) for result_id in component_ids],
    dtype=float,
)
total_cost = float(values["R-Q2-case1-U"])
unit_profit = float(values["R-Q2-case1-profit"])

component_labels = [
    cn("采购"),
    cn("零配件\n检测"),
    cn("装配"),
    cn("成品\n检测"),
    cn("拆解"),
    cn("调换损失"),
]
all_labels = component_labels + [cn("单位\n总成本")]
component_colors = [
    PALETTE[index % len(PALETTE)]
    for index in range(component_costs.size)
]

fig, (ax_cost, ax_share) = plt.subplots(
    1,
    2,
    figsize=(6.0, 2.8),
    gridspec_kw={"width_ratios": [1.45, 1.0]},
)

x_positions = np.arange(component_costs.size + 1)
total_index = component_costs.size
origin = 0.0
cumulative = np.cumsum(component_costs)
running_levels = np.concatenate(([origin], cumulative))
waterfall_levels = np.concatenate((cumulative, [total_cost]))
bar_width = 0.62
bar_half = bar_width / 2.0

ax_cost.grid(
    axis="y",
    alpha=0.18,
    linestyle="-",
    color=COLORS["grid"],
)
ax_cost.set_axisbelow(True)

for index, (cost, color) in enumerate(zip(component_costs, component_colors)):
    lower = running_levels[index]
    upper = running_levels[index + 1]

    if cost > origin:
        ax_cost.fill_between(
            [x_positions[index] - bar_half, x_positions[-1] + bar_half],
            lower,
            upper,
            alpha=0.13,
            color=color,
            zorder=1 + index,
        )
        ax_cost.plot(
            [x_positions[index] - bar_half, x_positions[-1] + bar_half],
            [upper, upper],
            color=color,
            linewidth=0.7,
            linestyle="--",
            alpha=0.32,
            zorder=1 + index,
        )

    ax_cost.bar(
        x_positions[index],
        upper - lower,
        bottom=lower,
        width=bar_width,
        color=color,
        edgecolor="white",
        linewidth=0.8,
        alpha=0.92,
        zorder=5,
    )

ax_cost.bar(
    x_positions[total_index],
    total_cost - origin,
    bottom=origin,
    width=bar_width,
    color=_lighten(PALETTE[0], 0.48),
    edgecolor=COLORS["primary"],
    linewidth=1.2,
    alpha=0.95,
    zorder=5,
)

ax_cost.step(
    x_positions,
    waterfall_levels,
    where="mid",
    color=COLORS["primary"],
    linewidth=2.4,
    zorder=6,
)

marker_colors = component_colors + [COLORS["primary"]]
for index, (level, color) in enumerate(zip(waterfall_levels, marker_colors)):
    ax_cost.scatter(
        x_positions[index],
        level,
        color=color,
        s=52,
        edgecolors="white",
        linewidths=1.4,
        zorder=7,
    )

y_upper = max(total_cost, float(cumulative[-1])) * 1.20
label_offset = y_upper * 0.015
for index, (level, color) in enumerate(zip(waterfall_levels, marker_colors)):
    endpoint = index in (0, total_index)
    ax_cost.text(
        x_positions[index],
        level + label_offset,
        f"{level:.2f}",
        ha="center",
        va="bottom",
        fontsize=6.7,
        fontweight="bold" if endpoint else "normal",
        color=color,
        bbox=(
            {
                "boxstyle": "round,pad=0.14",
                "facecolor": "white",
                "edgecolor": color if endpoint else "none",
                "alpha": 0.92,
                "linewidth": 0.6,
            }
            if endpoint
            else None
        ),
        zorder=8,
    )

profit_note = (
    f"{cn('单位利润')} {unit_profit:.2f} {cn('元/件')}"
)
ax_cost.text(
    0.02,
    0.97,
    profit_note,
    transform=ax_cost.transAxes,
    ha="left",
    va="top",
    fontsize=7.2,
    fontweight="bold",
    color=COLORS["accent"],
    bbox={
        "boxstyle": "round,pad=0.3",
        "facecolor": "white",
        "edgecolor": COLORS["accent"],
        "alpha": 0.92,
        "linewidth": 0.8,
    },
    zorder=10,
)

ax_cost.set_xticks(x_positions)
ax_cost.set_xticklabels(
    all_labels,
    rotation=28,
    ha="right",
    rotation_mode="anchor",
    fontsize=6.8,
)
ax_cost.set_xlabel(cn("成本构成"), fontsize=8.5)
ax_cost.set_ylabel(cn("单位期望成本（元/件）"), fontsize=8.5)
ax_cost.set_xlim(-bar_width, x_positions[-1] + bar_width)
ax_cost.set_ylim(origin, y_upper)
ax_cost.tick_params(axis="y", labelsize=7.2)
ax_cost.spines["top"].set_visible(False)
ax_cost.spines["right"].set_visible(False)
panel(ax_cost, "(a)")

shares = component_costs / total_cost
y_positions = np.arange(component_costs.size)

ax_share.barh(
    y_positions,
    shares,
    height=0.58,
    color=component_colors,
    edgecolor="white",
    linewidth=0.8,
    alpha=0.9,
)
ax_share.set_yticks(y_positions)
ax_share.set_yticklabels(component_labels, fontsize=7.0)
ax_share.invert_yaxis()

share_span = float(np.max(shares))
share_offset = share_span * 0.018
for y_position, cost, share in zip(y_positions, component_costs, shares):
    ax_share.text(
        share + share_offset,
        y_position,
        f"{cost:.2f} / {share:.1%}",
        ha="left",
        va="center",
        fontsize=6.8,
        color=COLORS["gray"],
    )

ax_share.set_xlim(origin, share_span * 1.38)
ax_share.xaxis.set_major_formatter(PercentFormatter(xmax=1.0))
ax_share.set_xlabel(cn("占总成本比重"), fontsize=8.5)
ax_share.set_ylabel(cn("成本构成"), fontsize=8.5)
ax_share.tick_params(axis="x", labelsize=7.0)
ax_share.grid(
    axis="x",
    alpha=0.18,
    linestyle="-",
    color=COLORS["grid"],
)
ax_share.set_axisbelow(True)
ax_share.spines["top"].set_visible(False)
ax_share.spines["right"].set_visible(False)
ax_share.spines["left"].set_visible(False)
panel(ax_share, "(b)")

fig.tight_layout(pad=0.8)
save(fig, "fig_q2_optimal_cost_breakdown")
plt.close(fig)
