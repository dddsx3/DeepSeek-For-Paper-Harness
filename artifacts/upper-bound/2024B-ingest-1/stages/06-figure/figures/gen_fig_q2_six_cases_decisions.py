"""六种情况的最优决策矩阵与经济结果排序。

(a) 热力图展示各情况的 Z1、Z2、C、D 账本取值，行末列出单位期望利润，并框出账本判定的全局最优情况。
(b) 按单位期望利润降序排列六种情况，同时标出排名与全局最优情况。
数据来自账本 R-Q2-case1 至 R-Q2-case6 的 Z1、Z2、C、D、profit 项，以及 R-Q2-global-best-case-id；所有绘图数值均在运行时读取，模块不内嵌账本结果副本。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import CMAP_SEQ

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import Normalize
from matplotlib.patches import Rectangle


DATA_REFS = (
    "R-Q2-case1-Z1",
    "R-Q2-case1-Z2",
    "R-Q2-case1-C",
    "R-Q2-case1-D",
    "R-Q2-case1-profit",
    "R-Q2-case2-Z1",
    "R-Q2-case2-Z2",
    "R-Q2-case2-C",
    "R-Q2-case2-D",
    "R-Q2-case2-profit",
    "R-Q2-case3-Z1",
    "R-Q2-case3-Z2",
    "R-Q2-case3-C",
    "R-Q2-case3-D",
    "R-Q2-case3-profit",
    "R-Q2-case4-Z1",
    "R-Q2-case4-Z2",
    "R-Q2-case4-C",
    "R-Q2-case4-D",
    "R-Q2-case4-profit",
    "R-Q2-case5-Z1",
    "R-Q2-case5-Z2",
    "R-Q2-case5-C",
    "R-Q2-case5-D",
    "R-Q2-case5-profit",
    "R-Q2-case6-Z1",
    "R-Q2-case6-Z2",
    "R-Q2-case6-C",
    "R-Q2-case6-D",
    "R-Q2-case6-profit",
    "R-Q2-global-best-case-id",
)
DECISION_KEYS = ("Z1", "Z2", "C", "D")


def case_number_from_id(result_id):
    token = result_id.split("-")[2]
    return int(token[len("case"):])


doc = load("results.json")
values = {
    record["result_id"]: record["value"]
    for record in doc["results"]
}
missing = [result_id for result_id in DATA_REFS if result_id not in values]
if missing:
    raise KeyError("Missing result_id(s): " + ", ".join(missing))

decision_refs = [
    result_id
    for result_id in DATA_REFS
    if result_id.rsplit("-", 1)[-1] in DECISION_KEYS
]
profit_refs = [
    result_id
    for result_id in DATA_REFS
    if result_id.endswith("-profit")
]
case_numbers = sorted(
    {case_number_from_id(result_id) for result_id in decision_refs}
    | {case_number_from_id(result_id) for result_id in profit_refs}
)

decision_lookup = {
    (
        case_number_from_id(result_id),
        result_id.rsplit("-", 1)[-1],
    ): result_id
    for result_id in decision_refs
}
profit_lookup = {
    case_number_from_id(result_id): result_id
    for result_id in profit_refs
}

decision_matrix = np.asarray(
    [
        [
            values[decision_lookup[(case_number, decision_key)]]
            for decision_key in DECISION_KEYS
        ]
        for case_number in case_numbers
    ],
    dtype=float,
)
profits = {
    case_number: float(values[profit_lookup[case_number]])
    for case_number in case_numbers
}
best_case = int(values["R-Q2-global-best-case-id"])
if best_case not in case_numbers:
    raise ValueError("R-Q2-global-best-case-id is not present in the case data")

unique_values = np.unique(decision_matrix)
normalization = Normalize(
    vmin=float(unique_values.min()),
    vmax=float(unique_values.max()),
)

fig, (ax_matrix, ax_rank) = plt.subplots(
    1,
    2,
    figsize=(6.0, 2.8),
    gridspec_kw={"width_ratios": (1.45, 1.0)},
)

heatmap = ax_matrix.imshow(
    decision_matrix,
    cmap=CMAP_SEQ,
    norm=normalization,
    interpolation="nearest",
    aspect="auto",
)

colorbar = fig.colorbar(
    heatmap,
    ax=ax_matrix,
    fraction=0.046,
    pad=0.025,
    shrink=0.82,
)
colorbar.set_ticks(unique_values)
colorbar.set_ticklabels([cn(f"{value:g}") for value in unique_values])
colorbar.ax.set_ylabel(cn("账本取值"), rotation=90, labelpad=4)
colorbar.ax.tick_params(colors=COLORS["gray"], labelsize=7)
colorbar.outline.set_edgecolor(COLORS["grid"])

for row_index, row in enumerate(decision_matrix):
    for column_index, value in enumerate(row):
        ax_matrix.text(
            column_index,
            row_index,
            f"{value:g}",
            ha="center",
            va="center",
            fontsize=7.5,
            color=COLORS["gray"],
            bbox={
                "boxstyle": "circle,pad=0.25",
                "facecolor": _lighten(COLORS["gray"], 0.88),
                "edgecolor": "none",
                "alpha": 0.88,
            },
            zorder=3,
        )

heatmap_width = len(DECISION_KEYS)
boundary_x = heatmap_width - 0.5
profit_x = heatmap_width + 0.45
ax_matrix.axvline(
    boundary_x,
    color=COLORS["grid"],
    linewidth=0.9,
    zorder=1,
)
ax_matrix.text(
    profit_x,
    -0.70,
    cn("利润"),
    ha="center",
    va="center",
    fontsize=7.5,
    fontweight="bold",
    color=COLORS["gray"],
    clip_on=False,
)

for row_index, case_number in enumerate(case_numbers):
    is_best = case_number == best_case
    ax_matrix.text(
        profit_x,
        row_index,
        f"{profits[case_number]:.2f}",
        ha="center",
        va="center",
        fontsize=7.5,
        fontweight="bold" if is_best else "normal",
        color=PALETTE[0] if is_best else COLORS["gray"],
    )

ax_matrix.set_xticks(np.arange(heatmap_width))
ax_matrix.set_xticklabels([cn(key) for key in DECISION_KEYS])
ax_matrix.set_yticks(np.arange(len(case_numbers)))
ax_matrix.set_yticklabels(
    [
        cn(f"情况 {case_number}" + ("  ★" if case_number == best_case else ""))
        for case_number in case_numbers
    ]
)
ax_matrix.set_xticks(
    np.arange(-0.5, heatmap_width, 1),
    minor=True,
)
ax_matrix.set_yticks(
    np.arange(-0.5, len(case_numbers), 1),
    minor=True,
)
ax_matrix.grid(
    which="minor",
    color=COLORS["grid"],
    linewidth=0.6,
    alpha=0.85,
)
ax_matrix.tick_params(
    which="minor",
    bottom=False,
    left=False,
)
ax_matrix.tick_params(
    which="major",
    length=0,
    colors=COLORS["gray"],
    labelsize=7.5,
)
ax_matrix.set_xlim(-0.5, heatmap_width + 1.35)
ax_matrix.set_ylim(len(case_numbers) - 0.5, -0.95)
ax_matrix.set_xlabel(cn("决策位 Z1 / Z2 / C / D"))
ax_matrix.set_ylabel(cn("表1情况"))
for spine in ax_matrix.spines.values():
    spine.set_color(COLORS["grid"])
    spine.set_linewidth(0.7)

best_index = case_numbers.index(best_case)
ax_matrix.add_patch(
    Rectangle(
        (-0.5, best_index - 0.5),
        heatmap_width,
        1,
        fill=False,
        edgecolor=COLORS["highlight"],
        linewidth=2.0,
        zorder=4,
    )
)
panel(ax_matrix, "(a)")

ranked = sorted(
    ((case_number, profits[case_number]) for case_number in case_numbers),
    key=lambda item: (item[1], -item[0]),
    reverse=True,
)
ranked_cases = [item[0] for item in ranked]
ranked_profits = [item[1] for item in ranked]
rank_positions = np.arange(len(ranked))
bar_colors = [
    PALETTE[0]
    if rank_index == 0
    else _lighten(PALETTE[0], min(0.70, 0.18 * rank_index))
    for rank_index in range(len(ranked))
]
bar_edges = [
    COLORS["highlight"] if case_number == best_case else COLORS["grid"]
    for case_number in ranked_cases
]
bar_widths = [
    1.6 if case_number == best_case else 0.5
    for case_number in ranked_cases
]

bars = ax_rank.barh(
    rank_positions,
    ranked_profits,
    height=0.62,
    color=bar_colors,
    edgecolor=bar_edges,
    linewidth=bar_widths,
)
ax_rank.set_yticks(rank_positions)
ax_rank.set_yticklabels(
    [
        cn(
            f"{rank_index + 1}. 情况 {case_number}"
            + ("  ★" if case_number == best_case else "")
        )
        for rank_index, case_number in enumerate(ranked_cases)
    ]
)
ax_rank.invert_yaxis()
ax_rank.margins(x=0.22)
ax_rank.axvline(
    0.0,
    color=COLORS["ref_line"],
    linewidth=0.9,
    zorder=1,
)
ax_rank.set_axisbelow(True)
ax_rank.grid(
    axis="x",
    color=COLORS["grid"],
    linewidth=0.6,
    alpha=0.8,
)
ax_rank.bar_label(
    bars,
    labels=[f"{profit:.2f}" for profit in ranked_profits],
    padding=3,
    fontsize=7,
    color=COLORS["gray"],
)
ax_rank.set_xlabel(cn("单位期望利润（元/件）"))
ax_rank.set_ylabel(cn("利润排序"))
ax_rank.tick_params(
    axis="y",
    length=0,
    colors=COLORS["gray"],
    labelsize=7.5,
)
ax_rank.tick_params(
    axis="x",
    colors=COLORS["gray"],
    labelsize=7,
)
ax_rank.text(
    0.98,
    1.03,
    cn("★ 账本全局最优"),
    transform=ax_rank.transAxes,
    ha="right",
    va="bottom",
    fontsize=7,
    color=COLORS["gray"],
)
for side in ("top", "right", "left"):
    ax_rank.spines[side].set_visible(False)
ax_rank.spines["bottom"].set_color(COLORS["grid"])
panel(ax_rank, "(b)")

fig.subplots_adjust(
    left=0.11,
    right=0.98,
    bottom=0.24,
    top=0.86,
    wspace=0.58,
)
save(fig, "fig_q2_six_cases_decisions")
plt.close(fig)
