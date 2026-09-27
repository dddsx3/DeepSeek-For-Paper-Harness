"""表1各情况全部策略的单位期望成本与综合排名。

主面板按聚类顺序展示各情况的策略成本热力图，并以边框和数值框标出
账本决策标量指定的策略；上方树状图给出策略成本模式的聚类顺序。
辅助面板按各情况归一化成本汇总策略排名，排名越小越优。
数据来自 R-Q2-case1-strategies 至 R-Q2-case6-strategies，以及对应的
Z1、Z2、C、D 决策标量；关键数值均在运行时从账本读取并标注。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import CMAP_SEQ

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Rectangle
from scipy.cluster.hierarchy import dendrogram, linkage


doc = load("results.json")
if not isinstance(doc, dict) or "results" not in doc:
    raise ValueError("results.json 缺少 results 数组")

values = {}
for item in doc["results"]:
    result_id = item.get("result_id")
    if not result_id:
        raise ValueError("账本条目缺少 result_id")
    if result_id in values:
        raise ValueError(f"账本存在重复 result_id: {result_id}")
    values[result_id] = item.get("value")

case_specs = [
    (
        "R-Q2-case1-strategies",
        ("R-Q2-case1-Z1", "R-Q2-case1-Z2", "R-Q2-case1-C", "R-Q2-case1-D"),
    ),
    (
        "R-Q2-case2-strategies",
        ("R-Q2-case2-Z1", "R-Q2-case2-Z2", "R-Q2-case2-C", "R-Q2-case2-D"),
    ),
    (
        "R-Q2-case3-strategies",
        ("R-Q2-case3-Z1", "R-Q2-case3-Z2", "R-Q2-case3-C", "R-Q2-case3-D"),
    ),
    (
        "R-Q2-case4-strategies",
        ("R-Q2-case4-Z1", "R-Q2-case4-Z2", "R-Q2-case4-C", "R-Q2-case4-D"),
    ),
    (
        "R-Q2-case5-strategies",
        ("R-Q2-case5-Z1", "R-Q2-case5-Z2", "R-Q2-case5-C", "R-Q2-case5-D"),
    ),
    (
        "R-Q2-case6-strategies",
        ("R-Q2-case6-Z1", "R-Q2-case6-Z2", "R-Q2-case6-C", "R-Q2-case6-D"),
    ),
]

all_result_ids = []
for strategy_id, decision_ids in case_specs:
    all_result_ids.extend((strategy_id, *decision_ids))
missing_ids = [result_id for result_id in all_result_ids if result_id not in values]
if missing_ids:
    raise KeyError(f"账本缺少绘图所需 result_id: {missing_ids}")

decision_names = ("Z1", "Z2", "C", "D")
cases = []
for strategy_id, decision_ids in case_specs:
    rows = values[strategy_id]
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{strategy_id} 不是非空策略数组")
    target_decision = tuple(int(values[result_id]) for result_id in decision_ids)
    case_number = strategy_id[len("R-Q2-case") : -len("-strategies")]
    cases.append((case_number, rows, target_decision))


def strategy_key(row):
    return tuple(int(row[name]) for name in decision_names)


reference_rows = cases[0][1]
canonical_keys = [strategy_key(row) for row in reference_rows]
if len(set(canonical_keys)) != len(canonical_keys):
    raise ValueError("首个情况含重复策略组合")

ordered_case_rows = []
costs = []
decisions = []
case_labels = []
for case_number, rows, target_decision in cases:
    lookup = {strategy_key(row): row for row in rows}
    if set(lookup) != set(canonical_keys):
        raise ValueError(f"情况 {case_number} 的策略组合与其他情况不一致")
    ordered_rows = [lookup[key] for key in canonical_keys]
    ordered_case_rows.append(ordered_rows)
    costs.append([float(row["U"]) for row in ordered_rows])
    decisions.append(target_decision)
    case_labels.append(cn(f"情况 {case_number}"))

cost_matrix = np.asarray(costs, dtype=float)
if cost_matrix.ndim != 2 or cost_matrix.size == 0:
    raise ValueError("无法由账本构造成本矩阵")
if not np.all(np.isfinite(cost_matrix)):
    raise ValueError("成本矩阵含非有限值")

n_cases, n_strategies = cost_matrix.shape
row_minima = cost_matrix.min(axis=1, keepdims=True)
row_ranges = cost_matrix.max(axis=1, keepdims=True) - row_minima
normalized_costs = np.divide(
    cost_matrix - row_minima,
    row_ranges,
    out=np.zeros_like(cost_matrix),
    where=row_ranges != 0,
)
overall_score = normalized_costs.mean(axis=0)

linkage_matrix = linkage(
    normalized_costs.T,
    method="average",
    metric="euclidean",
)
dendrogram_data = dendrogram(
    linkage_matrix,
    no_labels=True,
    color_threshold=0,
    above_threshold_color=COLORS["gray"],
)
leaf_order = np.asarray(dendrogram_data["leaves"], dtype=int)
ordered_costs = cost_matrix[:, leaf_order]
ordered_overall_score = overall_score[leaf_order]
ordered_keys = [canonical_keys[index] for index in leaf_order]
strategy_labels = [cn("".join(str(value) for value in key)) for key in ordered_keys]

key_to_column = {key: index for index, key in enumerate(canonical_keys)}
ordered_optima = [key_to_column[decision] for decision in decisions]

rank_order = np.argsort(overall_score, kind="stable")
ranks = np.empty(n_strategies, dtype=int)
ranks[rank_order] = np.arange(1, n_strategies + 1)
ordered_ranks = ranks[leaf_order]

fig = plt.figure(figsize=(6.0, 4.8))
grid = fig.add_gridspec(
    3,
    1,
    height_ratios=(0.70, 3.80, 0.75),
    left=0.14,
    right=0.88,
    top=0.98,
    bottom=0.18,
    hspace=0.32,
)
ax_main = fig.add_subplot(grid[1])
ax_dendrogram = fig.add_subplot(grid[0], sharex=ax_main)
ax_rank = fig.add_subplot(grid[2], sharex=ax_main)

all_dendrogram_x = np.concatenate(
    [np.asarray(item, dtype=float) for item in dendrogram_data["icoord"]]
)
x_span = float(all_dendrogram_x.max() - all_dendrogram_x.min())
if x_span > 0:
    mapped_x = (
        (all_dendrogram_x - all_dendrogram_x.min())
        / x_span
        * (n_strategies - 1)
    )
else:
    mapped_x = np.zeros_like(all_dendrogram_x)

offset = 0
for x_coordinates, y_coordinates in zip(
    dendrogram_data["icoord"], dendrogram_data["dcoord"]
):
    width = len(x_coordinates)
    ax_dendrogram.plot(
        mapped_x[offset : offset + width],
        y_coordinates,
        color=PALETTE[0],
        linewidth=1.0,
        solid_capstyle="round",
    )
    offset += width
ax_dendrogram.set_xlim(-0.5, n_strategies - 0.5)
ax_dendrogram.set_ylim(bottom=0)
ax_dendrogram.set_xticks([])
ax_dendrogram.set_yticks([])
for spine in ax_dendrogram.spines.values():
    spine.set_visible(False)

image = ax_main.imshow(
    ordered_costs,
    aspect="auto",
    cmap=CMAP_SEQ,
    interpolation="nearest",
)
ax_main.set_xticks(np.arange(n_strategies))
ax_main.set_xticklabels(strategy_labels)
ax_main.set_yticks(np.arange(n_cases))
ax_main.set_yticklabels(case_labels)
ax_main.tick_params(
    axis="x",
    which="both",
    bottom=False,
    labelbottom=False,
    length=0,
)
ax_main.tick_params(axis="y", length=0, labelsize=8)
ax_main.set_ylabel(cn("表1情况"))
ax_main.set_xticks(
    np.arange(n_strategies + 1) - 0.5,
    minor=True,
)
ax_main.set_yticks(
    np.arange(n_cases + 1) - 0.5,
    minor=True,
)
ax_main.grid(
    which="minor",
    color=COLORS["grid"],
    linewidth=0.45,
)
ax_main.tick_params(which="minor", bottom=False, left=False)
panel(ax_main, "(a)")

optimum_box_color = _lighten(COLORS["highlight"], 0.72)
for row_index, column_index in enumerate(ordered_optima):
    ax_main.add_patch(
        Rectangle(
            (column_index - 0.5, row_index - 0.5),
            1,
            1,
            fill=False,
            edgecolor=COLORS["highlight"],
            linewidth=2.2,
            zorder=3,
        )
    )
    optimum_value = ordered_costs[row_index, column_index]
    ax_main.text(
        column_index,
        row_index,
        cn(f"★ {optimum_value:.2f}"),
        ha="center",
        va="center",
        fontsize=6.2,
        fontweight="semibold",
        color=COLORS["neutral"],
        zorder=4,
        bbox={
            "boxstyle": "round,pad=0.15",
            "facecolor": optimum_box_color,
            "edgecolor": "none",
            "alpha": 0.90,
        },
    )

score_minimum = float(ordered_overall_score.min())
score_maximum = float(ordered_overall_score.max())
score_upper = (
    score_maximum
    if score_maximum > score_minimum
    else float(np.nextafter(score_minimum, np.inf))
)
ax_rank.imshow(
    ordered_overall_score[np.newaxis, :],
    aspect="auto",
    cmap=CMAP_SEQ,
    interpolation="nearest",
    vmin=score_minimum,
    vmax=score_upper,
)
ax_rank.set_xticks(np.arange(n_strategies))
ax_rank.set_xticklabels(strategy_labels)
ax_rank.set_yticks([])
ax_rank.tick_params(
    axis="x",
    labelrotation=90,
    labelsize=6.3,
    length=0,
    pad=2,
)
ax_rank.set_xticks(
    np.arange(n_strategies + 1) - 0.5,
    minor=True,
)
ax_rank.grid(
    which="minor",
    color=COLORS["grid"],
    linewidth=0.45,
)
ax_rank.tick_params(which="minor", bottom=False)
ax_rank.set_xlabel(cn("策略综合成本排名（#1 最优）"))
panel(ax_rank, "(b)")

rank_text_color = COLORS["neutral"]
rank_box_color = _lighten(COLORS["neutral"], 0.82)
best_rank = int(ordered_ranks.min())
medal_limit = min(3, n_strategies)
for column_index, rank in enumerate(ordered_ranks):
    ax_rank.text(
        column_index,
        0,
        cn(f"#{int(rank)}"),
        ha="center",
        va="center",
        fontsize=6.5,
        fontweight="semibold" if rank == best_rank else "normal",
        color=rank_text_color,
        bbox={
            "boxstyle": "round,pad=0.12",
            "facecolor": rank_box_color,
            "edgecolor": "none",
            "alpha": 0.88,
        },
    )
    if rank == best_rank:
        edge_color = COLORS["highlight"]
        edge_width = 2.2
    elif rank <= medal_limit:
        edge_color = COLORS["secondary"]
        edge_width = 1.1
    else:
        continue
    ax_rank.add_patch(
        Rectangle(
            (column_index - 0.5, -0.5),
            1,
            1,
            fill=False,
            edgecolor=edge_color,
            linewidth=edge_width,
            zorder=3,
        )
    )

colorbar_axis = fig.add_axes([0.90, 0.34, 0.018, 0.40])
colorbar = fig.colorbar(image, cax=colorbar_axis)
colorbar.set_label(
    cn("单位期望成本（元/件）"),
    rotation=90,
    labelpad=8,
)
colorbar.ax.tick_params(labelsize=7)
colorbar.outline.set_edgecolor(COLORS["grid"])

save(fig, "fig_q2_strategy_cost_heatmap")
