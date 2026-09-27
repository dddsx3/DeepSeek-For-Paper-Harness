from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
import numpy as np

__doc__ = """展示置信区间对固定决策利润的影响及区间宽度排序。
(a) 森林图：按重做问题展示问题2各情形与问题3实例的点利润、利润区间和稳健性标记。
(b) 排名图：按利润区间宽度从大到小排列，宽度由账本上下界相减得到。
数据来自 R-Q4-q2、R-Q4-q3-point-profit、R-Q4-q3-profit-range、
R-Q4-sample-size-used、R-Q4-ci-level 和 R-Q4-resample-count；
全部关键数值均由账本直接取用，不在源码中复写。
"""


doc = load("results.json")
ledger = {item["result_id"]: item["value"] for item in doc["results"]}

q2_rows = sorted(ledger["R-Q4-q2"], key=lambda row: row["case_id"])
q3_point = float(ledger["R-Q4-q3-point-profit"])
q3_range = np.asarray(ledger["R-Q4-q3-profit-range"], dtype=float)
ci_level = float(ledger["R-Q4-ci-level"])
sample_size = ledger["R-Q4-sample-size-used"]
resample_count = ledger["R-Q4-resample-count"]

case_ids = [row["case_id"] for row in q2_rows]
labels = [f"{cn('问题2 情况')}{case_id}" for case_id in case_ids]
labels.append(cn("问题3实例"))

points = np.asarray(
    [row["point_profit"] for row in q2_rows] + [q3_point], dtype=float
)
ci_lo = np.asarray(
    [row["profit_range_fixed_decision"][0] for row in q2_rows]
    + [q3_range[0]],
    dtype=float,
)
ci_hi = np.asarray(
    [row["profit_range_fixed_decision"][1] for row in q2_rows]
    + [q3_range[1]],
    dtype=float,
)
interval_widths = ci_hi - ci_lo
stability = [bool(row["decision_stable"]) for row in q2_rows]
stability.append(None)
q3_index = len(q2_rows)

n_rows = len(labels)
y = np.arange(n_rows)
forest_limits = (n_rows - 0.5, -1.05)

fig = plt.figure(figsize=(6.0, 3.6), constrained_layout=True)
fig.set_label(
    f"sample_size={sample_size};ci_level={ci_level};resample_count={resample_count}"
)

outer = fig.add_gridspec(
    1, 2, width_ratios=[2.5, 1.0], wspace=0.34
)
forest_grid = outer[0, 0].subgridspec(
    1, 2, width_ratios=[1.55, 1.15], wspace=0.02
)
ax = fig.add_subplot(forest_grid[0, 0])
ax_numeric = fig.add_subplot(forest_grid[0, 1])
ax_width = fig.add_subplot(outer[0, 1])

for i in range(n_rows):
    if i == q3_index:
        row_color = _lighten(COLORS["accent"], 0.88)
    elif i % 2 == 0:
        row_color = _lighten(PALETTE[0], 0.90)
    else:
        continue
    ax.axhspan(
        y[i] - 0.5,
        y[i] + 0.5,
        color=row_color,
        edgecolor="none",
        zorder=0,
    )

x_upper = float(np.max(ci_hi)) * 1.08
ax.set_xlim(0.0, x_upper)
ax.set_ylim(*forest_limits)
ax.set_axisbelow(True)
ax.grid(
    axis="x",
    color=COLORS["grid"],
    linestyle="--",
    linewidth=0.7,
    alpha=0.55,
)

cap_height = 0.12
for i in range(n_rows):
    marker_color = PALETTE[1] if i == q3_index else PALETTE[0]
    marker = "D" if i == q3_index else "o"
    marker_size = 7.0 if i == q3_index else 6.2
    marker_face = "white" if stability[i] is False else marker_color

    ax.plot(
        [ci_lo[i], ci_hi[i]],
        [y[i], y[i]],
        color=COLORS["gray"],
        linewidth=1.5,
        solid_capstyle="round",
        zorder=2,
    )
    ax.plot(
        [ci_lo[i], ci_lo[i]],
        [y[i] - cap_height, y[i] + cap_height],
        color=marker_color,
        linewidth=1.1,
        zorder=3,
    )
    ax.plot(
        [ci_hi[i], ci_hi[i]],
        [y[i] - cap_height, y[i] + cap_height],
        color=marker_color,
        linewidth=1.1,
        zorder=3,
    )
    ax.plot(
        points[i],
        y[i],
        marker=marker,
        markersize=marker_size,
        markerfacecolor=marker_face,
        markeredgecolor=marker_color,
        markeredgewidth=1.3,
        linestyle="none",
        zorder=4,
    )

ax.set_yticks(y)
ax.set_yticklabels(labels)
ax.tick_params(axis="y", length=0, pad=6, labelsize=8.5)
ax.tick_params(axis="x", labelsize=8.5)
ax.set_xlabel(
    cn("单位利润及固定决策利润区间（元/件）"), fontsize=9.5, labelpad=6
)
ax.set_ylabel(cn("重做问题"), fontsize=9.5, labelpad=7)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.spines["left"].set_visible(False)
ax.spines["bottom"].set_color(COLORS["grid"])
panel(ax, "(a)")

ax_numeric.set_xlim(0.0, 1.0)
ax_numeric.set_ylim(*forest_limits)
ax_numeric.set_xticks([])
ax_numeric.set_yticks([])
for spine in ax_numeric.spines.values():
    spine.set_visible(False)
ax_numeric.axvline(
    0.0,
    color=COLORS["grid"],
    linestyle="--",
    linewidth=0.8,
    alpha=0.8,
)
ax_numeric.text(
    0.03,
    -0.78,
    f"{cn('点利润')} / {ci_level:.0%} {cn('区间')}",
    ha="left",
    va="center",
    fontsize=8.2,
    fontweight="bold",
    color=COLORS["gray"],
)

for i in range(n_rows):
    value_text = f"{points[i]:.2f} [{ci_lo[i]:.2f}, {ci_hi[i]:.2f}]"
    if stability[i] is None:
        status_text = cn("基准")
        status_color = PALETTE[1]
    elif stability[i]:
        status_text = cn("稳健")
        status_color = PALETTE[0]
    else:
        status_text = cn("敏感")
        status_color = COLORS["down"]

    ax_numeric.text(
        0.03,
        y[i] - 0.08,
        value_text,
        ha="left",
        va="center",
        fontsize=7.4,
        fontfamily="monospace",
        color=COLORS["gray"],
    )
    ax_numeric.text(
        0.03,
        y[i] + 0.25,
        status_text,
        ha="left",
        va="center",
        fontsize=7.2,
        color=status_color,
    )

order = np.argsort(interval_widths)[::-1]
ranked_y = np.arange(n_rows)
ranked_labels = [labels[i] for i in order]
width_scale = float(np.max(interval_widths))
width_upper = width_scale * 1.28
width_padding = width_upper * 0.018

for rank, source_index in enumerate(order):
    if source_index == q3_index:
        bar_color = PALETTE[1]
    elif stability[source_index] is False:
        bar_color = COLORS["down"]
    else:
        bar_color = _lighten(PALETTE[0], 0.38)

    width = float(interval_widths[source_index])
    ax_width.barh(
        ranked_y[rank],
        width,
        height=0.56,
        color=bar_color,
        edgecolor="none",
        zorder=3,
    )
    if width == 0.0:
        ax_width.plot(
            width,
            ranked_y[rank],
            marker="D",
            markersize=4.5,
            color=PALETTE[1],
            linestyle="none",
            zorder=4,
        )
    ax_width.text(
        width + width_padding,
        ranked_y[rank],
        f"{width:.2f}",
        ha="left",
        va="center",
        fontsize=7.5,
        color=COLORS["gray"],
    )

ax_width.set_xlim(0.0, width_upper)
ax_width.set_ylim(n_rows - 0.5, -0.5)
ax_width.set_yticks(ranked_y)
ax_width.set_yticklabels(ranked_labels)
ax_width.tick_params(axis="y", length=0, pad=5, labelsize=8.0)
ax_width.tick_params(axis="x", labelsize=8.0)
ax_width.set_xlabel(cn("区间宽度（元/件）"), fontsize=9.5, labelpad=6)
ax_width.set_axisbelow(True)
ax_width.grid(
    axis="x",
    color=COLORS["grid"],
    linestyle="--",
    linewidth=0.7,
    alpha=0.55,
)
ax_width.spines["top"].set_visible(False)
ax_width.spines["right"].set_visible(False)
ax_width.spines["left"].set_visible(False)
ax_width.spines["bottom"].set_color(COLORS["grid"])
panel(ax_width, "(b)")

save(fig, "fig_q4_ci_effect_on_cost")
plt.close(fig)
