"""问题3基准拓扑的节点成本与次品率画像。

面板(a)展示节点记录中的单位成本 U，面板(b)展示次品率 Q；节点总数、
半成品数、根节点成本和单位成品利润以底部数据锚点呈现。全部绘图数值读取
自账本 R-Q3-baseline-node-cost、R-Q3-baseline-node-count、
R-Q3-baseline-semi-count、R-Q3-baseline-U-root 和
R-Q3-baseline-profit，不在脚本中固化。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch


doc = load("results.json")
values = {entry["result_id"]: entry["value"] for entry in doc["results"]}

node_cost = values["R-Q3-baseline-node-cost"]
node_count = int(values["R-Q3-baseline-node-count"])
semi_count = int(values["R-Q3-baseline-semi-count"])
root_u = float(values["R-Q3-baseline-U-root"])
unit_profit = float(values["R-Q3-baseline-profit"])

if not isinstance(node_cost, dict):
    raise TypeError("R-Q3-baseline-node-cost 必须为节点记录对象")

node_names = list(node_cost)
u_values = np.asarray([float(node_cost[name]["U"]) for name in node_names])
q_values = np.asarray([float(node_cost[name]["Q"]) for name in node_names])
semi_names = [name for name in node_names if name.startswith("S")]

if len(node_names) != node_count:
    raise ValueError("节点记录数与 R-Q3-baseline-node-count 不一致")
if len(semi_names) != semi_count:
    raise ValueError("半成品记录数与 R-Q3-baseline-semi-count 不一致")

root_matches = [
    name for name in node_names if float(node_cost[name]["U"]) == root_u
]
if len(root_matches) != 1:
    raise ValueError("无法由 R-Q3-baseline-U-root 唯一识别根节点")
root_name = root_matches[0]

kind_specs = (
    ("part", cn("零配件节点"), PALETTE[0]),
    ("semi", cn("半成品节点"), PALETTE[1]),
    ("final", cn("成品节点"), PALETTE[2]),
)
kind_colors = {
    key: (base_color, _lighten(base_color, 0.58))
    for key, _, base_color in kind_specs
}


def classify_node(name):
    if name == root_name:
        return "final"
    if name in semi_names:
        return "semi"
    return "part"


node_kinds = [classify_node(name) for name in node_names]
edge_colors = [kind_colors[kind][0] for kind in node_kinds]
fill_colors = [kind_colors[kind][1] for kind in node_kinds]
line_widths = [2.4 if kind == "final" else 1.2 for kind in node_kinds]

fig, axes = plt.subplots(1, 2, figsize=(6.0, 3.2))
x = np.arange(len(node_names))
bar_width = 0.76

profiles = (
    (axes[0], u_values, cn("单位成本 U（元/件）"), "(a)", 1),
    (axes[1], q_values, cn("次品率 Q（概率）"), "(b)", 2),
)

for ax, profile_values, y_label, panel_tag, decimals in profiles:
    y_max = float(np.max(profile_values))
    y_mean = float(np.mean(profile_values))
    y_limit = y_max * 1.20

    ax.axhspan(
        0.0,
        y_limit,
        color=PALETTE[0],
        alpha=0.025,
        zorder=0,
    )
    bars = ax.bar(
        x,
        profile_values,
        width=bar_width,
        color=fill_colors,
        edgecolor=edge_colors,
        linewidth=line_widths,
        zorder=2,
    )

    label_pad = y_max * 0.018
    for bar, raw_value in zip(bars, profile_values):
        value = float(raw_value)
        is_best = value == y_max
        prefix = "★" if is_best else ""
        label = prefix + f"{value:.{decimals}f}"
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + label_pad,
            label,
            ha="center",
            va="bottom",
            fontsize=5.8,
            fontweight="bold" if is_best else "normal",
            color=edge_colors[int(bar.get_x() + bar.get_width() / 2)]
            if is_best
            else COLORS["gray"],
            bbox=(
                dict(
                    boxstyle="round,pad=0.1",
                    facecolor="white",
                    edgecolor="none",
                    alpha=0.75,
                )
                if is_best
                else None
            ),
        )

    ax.axhline(
        y=y_mean,
        color=COLORS["ref_line"],
        linestyle="--",
        linewidth=0.8,
        alpha=0.55,
        zorder=1,
    )
    ax.text(
        x[-1],
        y_mean + y_max * 0.012,
        cn("均值 ") + f"{y_mean:.{decimals}f}",
        fontsize=6.2,
        color=COLORS["ref_line"],
        ha="right",
        va="bottom",
        style="italic",
        bbox=dict(
            boxstyle="round,pad=0.2",
            facecolor="white",
            edgecolor="none",
            alpha=0.82,
        ),
    )

    ax.set_xticks(x)
    ax.set_xticklabels(node_names, fontsize=6.8)
    ax.set_xlabel(cn("生产节点"), fontsize=8.5)
    ax.set_ylabel(y_label, fontsize=8.5)
    ax.set_ylim(0.0, y_limit)
    ax.tick_params(axis="y", labelsize=7.0)
    ax.grid(
        axis="y",
        alpha=0.16,
        linestyle="--",
        linewidth=0.6,
        color=COLORS["grid"],
    )
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    panel(ax, panel_tag)

legend_handles = [
    Patch(
        facecolor=kind_colors[key][1],
        edgecolor=kind_colors[key][0],
        linewidth=1.2,
        label=label,
    )
    for key, label, _ in kind_specs
]
fig.legend(
    handles=legend_handles,
    loc="upper center",
    bbox_to_anchor=(0.5, 0.97),
    ncol=3,
    frameon=False,
    fontsize=6.8,
    handlelength=1.5,
    columnspacing=1.2,
)

summary = cn(
    "节点 {nodes} 个（半成品 {semis} 个）｜根节点 U={root_u:.1f} 元/件｜"
    "单位成品期望利润={profit:.1f} 元/件"
).format(
    nodes=node_count,
    semis=semi_count,
    root_u=root_u,
    profit=unit_profit,
)
fig.text(
    0.5,
    0.035,
    summary,
    ha="center",
    va="bottom",
    fontsize=6.3,
    color=COLORS["gray"],
)

fig.tight_layout(rect=(0.0, 0.12, 1.0, 0.91))
save(fig, "fig_q3_node_cost_profile")
