"""图2展示表1六种情况的最优单位期望成本与回收链期望成本。
Panel (a) 用并列棒棒糖比较最优单位成本 U 与对应最优策略记录的回收链成本 R，并给出各自中位数。
Panel (b) 用棒棒糖展示逐情况成本差 U−R，仅用于成本结构对照。
数据来自账本 R-Q2-case1-U 至 R-Q2-case6-U，以及对应的 R-Q2-case1-strategies 至 R-Q2-case6-strategies；图内数值均由账本读取或据其计算。"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import numpy as np


U_RESULT_IDS = (
    "R-Q2-case1-U",
    "R-Q2-case2-U",
    "R-Q2-case3-U",
    "R-Q2-case4-U",
    "R-Q2-case5-U",
    "R-Q2-case6-U",
)

STRATEGY_RESULT_IDS = (
    "R-Q2-case1-strategies",
    "R-Q2-case2-strategies",
    "R-Q2-case3-strategies",
    "R-Q2-case4-strategies",
    "R-Q2-case5-strategies",
    "R-Q2-case6-strategies",
)

doc = load("results.json")
values_by_id = {
    item["result_id"]: item["value"]
    for item in doc.get("results", [])
}
required_ids = U_RESULT_IDS + STRATEGY_RESULT_IDS
missing_ids = [result_id for result_id in required_ids if result_id not in values_by_id]
if missing_ids:
    raise KeyError(cn("结果账本缺少绘图所需记录") + ": " + ", ".join(missing_ids))


def matched_recovery_cost(target_u, strategy_rows, result_id):
    """从策略表中取与标量最优单位成本匹配的 R 字段。"""
    if not isinstance(strategy_rows, list) or not strategy_rows:
        raise ValueError(cn("策略表为空或格式错误") + f": {result_id}")
    matches = [
        row for row in strategy_rows
        if isinstance(row, dict) and "U" in row and "R" in row
        and np.isclose(float(row["U"]), float(target_u))
    ]
    if len(matches) != 1:
        raise ValueError(
            cn("最优单位成本未能唯一匹配策略记录")
            + f": {result_id}, matches={len(matches)}"
        )
    return float(matches[0]["R"])


def ascending_ranks(values):
    order = np.argsort(values, kind="mergesort")
    return {int(index): rank for rank, index in enumerate(order, start=1)}


u_values = np.asarray(
    [float(values_by_id[result_id]) for result_id in U_RESULT_IDS],
    dtype=float,
)
recovery_values = np.asarray(
    [
        matched_recovery_cost(
            values_by_id[u_result_id],
            values_by_id[strategy_result_id],
            strategy_result_id,
        )
        for u_result_id, strategy_result_id in zip(
            U_RESULT_IDS, STRATEGY_RESULT_IDS
        )
    ],
    dtype=float,
)
cost_gaps = u_values - recovery_values

if not (
    np.all(np.isfinite(u_values))
    and np.all(np.isfinite(recovery_values))
    and np.all(np.isfinite(cost_gaps))
):
    raise ValueError(cn("成本数据包含非有限数值"))

case_labels = []
for result_id in U_RESULT_IDS:
    case_token = result_id.split("-case", 1)[1].split("-", 1)[0]
    case_labels.append(cn(f"情况 {case_token}"))

case_count = len(case_labels)
x_positions = np.arange(case_count, dtype=float)
x_offset = 0.17
u_ranks = ascending_ranks(u_values)
recovery_ranks = ascending_ranks(recovery_values)
gap_ranks = ascending_ranks(cost_gaps)

u_color = PALETTE[0]
recovery_color = PALETTE[1]
gap_color = PALETTE[2]

u_span = float(np.ptp(u_values)) or float(np.finfo(float).eps)
recovery_span = float(np.ptp(recovery_values)) or float(np.finfo(float).eps)
gap_span = float(np.ptp(cost_gaps)) or float(np.finfo(float).eps)

fig, (ax_compare, ax_gap) = plt.subplots(1, 2, figsize=(6.0, 3.2))

for index, value in enumerate(u_values):
    rank = u_ranks[index]
    rank_ratio = (rank - 1) / max(case_count - 1, 1)
    item_color = _lighten(u_color, 0.38 * rank_ratio)
    value_ratio = (float(value) - float(np.min(u_values))) / u_span
    ax_compare.vlines(
        x_positions[index] - x_offset,
        0.0,
        float(value),
        color=item_color,
        linewidth=2.0 + 1.8 * value_ratio,
        zorder=3,
    )
    ax_compare.scatter(
        x_positions[index] - x_offset,
        float(value),
        s=48.0 + 34.0 * value_ratio + (12.0 if rank <= 3 else 0.0),
        color=item_color,
        edgecolors=_lighten(item_color, 0.65),
        linewidths=1.1,
        zorder=5,
    )

for index, value in enumerate(recovery_values):
    rank = recovery_ranks[index]
    rank_ratio = (rank - 1) / max(case_count - 1, 1)
    item_color = _lighten(recovery_color, 0.42 * rank_ratio)
    value_ratio = (
        (float(value) - float(np.min(recovery_values))) / recovery_span
    )
    ax_compare.vlines(
        x_positions[index] + x_offset,
        0.0,
        float(value),
        color=item_color,
        linewidth=1.6 + 1.4 * value_ratio,
        linestyle="--",
        zorder=3,
    )
    ax_compare.scatter(
        x_positions[index] + x_offset,
        float(value),
        s=44.0 + 28.0 * value_ratio,
        facecolors=_lighten(item_color, 0.68),
        edgecolors=item_color,
        linewidths=1.4,
        zorder=5,
    )

compare_ymax = float(max(np.max(u_values), np.max(recovery_values)))
compare_label_offset = compare_ymax * 0.025
for index, value in enumerate(u_values):
    rank_suffix = f"  ★{u_ranks[index]}" if u_ranks[index] <= 3 else ""
    ax_compare.text(
        x_positions[index] - x_offset,
        float(value) + compare_label_offset,
        f"{value:.2f}{rank_suffix}",
        ha="center",
        va="bottom",
        fontsize=7.0,
        fontweight="bold" if u_ranks[index] <= 3 else "normal",
        color=_lighten(u_color, 0.10 * (u_ranks[index] - 1)),
        zorder=7,
    )

for index, value in enumerate(recovery_values):
    ax_compare.text(
        x_positions[index] + x_offset,
        float(value) + compare_label_offset,
        f"{value:.2f}",
        ha="center",
        va="bottom",
        fontsize=7.0,
        color=_lighten(recovery_color, 0.10 * (recovery_ranks[index] - 1)),
        zorder=7,
    )

median_u = float(np.median(u_values))
median_recovery = float(np.median(recovery_values))
ax_compare.axhline(
    median_u,
    color=COLORS["ref_line"],
    linestyle="-",
    linewidth=1.0,
    alpha=0.72,
    zorder=1,
)
ax_compare.axhline(
    median_recovery,
    color=COLORS["ref_line"],
    linestyle="--",
    linewidth=1.0,
    alpha=0.72,
    zorder=1,
)
ax_compare.text(
    0.98,
    median_u,
    cn(f"U中位数 {median_u:.2f}"),
    transform=ax_compare.get_yaxis_transform(),
    ha="right",
    va="bottom",
    fontsize=6.8,
    color=COLORS["ref_line"],
    bbox={
        "boxstyle": "round,pad=0.20",
        "facecolor": "white",
        "edgecolor": "none",
        "alpha": 0.82,
    },
    zorder=8,
)
ax_compare.text(
    0.98,
    median_recovery,
    cn(f"R中位数 {median_recovery:.2f}"),
    transform=ax_compare.get_yaxis_transform(),
    ha="right",
    va="bottom",
    fontsize=6.8,
    color=COLORS["ref_line"],
    bbox={
        "boxstyle": "round,pad=0.20",
        "facecolor": "white",
        "edgecolor": "none",
        "alpha": 0.82,
    },
    zorder=8,
)

legend_handles = [
    Line2D(
        [0], [0],
        color=u_color,
        marker="o",
        markersize=5.5,
        linewidth=2.2,
        label=cn("最优单位成本 U"),
    ),
    Line2D(
        [0], [0],
        color=recovery_color,
        marker="o",
        markersize=5.5,
        linestyle="--",
        linewidth=1.8,
        label=cn("回收链成本 R"),
    ),
]
ax_compare.legend(
    handles=legend_handles,
    loc="upper left",
    frameon=False,
    fontsize=7.2,
    handlelength=2.2,
)

gap_ymax = float(np.max(cost_gaps))
gap_label_offset = gap_ymax * 0.025
for index, value in enumerate(cost_gaps):
    rank = gap_ranks[index]
    rank_ratio = (rank - 1) / max(case_count - 1, 1)
    item_color = _lighten(gap_color, 0.38 * rank_ratio)
    value_ratio = (float(value) - float(np.min(cost_gaps))) / gap_span
    ax_gap.vlines(
        x_positions[index],
        0.0,
        float(value),
        color=item_color,
        linewidth=2.0 + 1.8 * value_ratio,
        zorder=3,
    )
    ax_gap.scatter(
        x_positions[index],
        float(value),
        s=50.0 + 34.0 * value_ratio + (12.0 if rank <= 3 else 0.0),
        color=item_color,
        edgecolors=_lighten(item_color, 0.65),
        linewidths=1.1,
        zorder=5,
    )
    rank_suffix = f"  ★{rank}" if rank <= 3 else ""
    ax_gap.text(
        x_positions[index],
        float(value) + gap_label_offset,
        f"{value:.2f}{rank_suffix}",
        ha="center",
        va="bottom",
        fontsize=7.0,
        fontweight="bold" if rank <= 3 else "normal",
        color=item_color,
        zorder=7,
    )

median_gap = float(np.median(cost_gaps))
ax_gap.axhline(
    median_gap,
    color=COLORS["ref_line"],
    linestyle=":",
    linewidth=1.1,
    alpha=0.72,
    zorder=1,
)
ax_gap.text(
    0.98,
    median_gap,
    cn(f"中位数 {median_gap:.2f}"),
    transform=ax_gap.get_yaxis_transform(),
    ha="right",
    va="bottom",
    fontsize=6.8,
    color=COLORS["ref_line"],
    bbox={
        "boxstyle": "round,pad=0.20",
        "facecolor": "white",
        "edgecolor": "none",
        "alpha": 0.82,
    },
    zorder=8,
)

for ax in (ax_compare, ax_gap):
    ax.set_axisbelow(True)
    ax.grid(axis="y", color=COLORS["grid"], linestyle="-", alpha=0.13)
    ax.set_xlim(-0.55, case_count - 0.45)
    ax.set_xticks(x_positions)
    ax.set_xticklabels(case_labels, fontsize=8.2)
    ax.set_xlabel(cn("表1情况"), fontsize=9.5)
    ax.tick_params(axis="y", labelsize=7.8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

ax_compare.set_ylim(0.0, compare_ymax * 1.24)
ax_compare.set_ylabel(cn("单位期望成本（元/件）"), fontsize=9.5)
ax_gap.set_ylim(0.0, gap_ymax * 1.24)
ax_gap.set_ylabel(cn("成本差 U−R（元/件）"), fontsize=9.5)

panel(ax_compare, "(a)")
panel(ax_gap, "(b)")

fig.tight_layout(w_pad=1.5)
save(fig, "fig_q2_recovery_cost_compare")
plt.close(fig)
