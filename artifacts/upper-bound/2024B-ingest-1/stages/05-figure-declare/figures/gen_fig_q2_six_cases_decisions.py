"""展示表 1 六种情况的最优二值决策及对应单位期望利润。

(a) 决策热力图：逐行展示各情况的 Z1、Z2、C、D 最优决策。
(b) 利润热力图：展示同一账本口径下的单位期望利润。
数据来自 results.json 中 R-Q2-case{1..6}-Z1、R-Q2-case{1..6}-Z2、
R-Q2-case{1..6}-C、R-Q2-case{1..6}-D 与 R-Q2-case{1..6}-profit；
图内数值均由账本直接标注，注释不复制账本结果。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import CMAP_SEQ

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap


doc = load("results.json")
records = doc["results"]
values = {record["result_id"]: record["value"] for record in records}

prefix = "R-Q2-case"
decision_variables = ("Z1", "Z2", "C", "D")
case_tags = sorted(
    {
        result_id[len(prefix) :].split("-", 1)[0]
        for result_id in values
        if result_id.startswith(prefix) and result_id.endswith("-profit")
    },
    key=lambda tag: int(tag),
)

if not case_tags:
    raise ValueError("results.json 中未找到问题 2 各情况的利润结果")

required_ids = [
    f"{prefix}{tag}-{suffix}"
    for tag in case_tags
    for suffix in (*decision_variables, "profit")
]
missing_ids = [result_id for result_id in required_ids if result_id not in values]
if missing_ids:
    raise KeyError(f"results.json 缺少绘图所需结果：{missing_ids}")

decision_matrix = np.asarray(
    [
        [values[f"{prefix}{tag}-{variable}"] for variable in decision_variables]
        for tag in case_tags
    ],
    dtype=float,
)
profit_values = np.asarray(
    [values[f"{prefix}{tag}-profit"] for tag in case_tags],
    dtype=float,
)
profit_matrix = profit_values[:, np.newaxis]

decision_min = float(np.min(decision_matrix))
decision_max = float(np.max(decision_matrix))
profit_min = float(np.min(profit_values))
profit_max = float(np.max(profit_values))

fig = plt.figure(figsize=(6.0, 4.0))
ax_decision = fig.add_axes((0.08, 0.14, 0.38, 0.76))
ax_profit = fig.add_axes((0.58, 0.14, 0.24, 0.76))
cax_decision = fig.add_axes((0.48, 0.14, 0.018, 0.76))
cax_profit = fig.add_axes((0.84, 0.14, 0.025, 0.76))

decision_cmap = ListedColormap(
    [_lighten(PALETTE[0], 0.82), PALETTE[0]]
)
decision_image = ax_decision.imshow(
    decision_matrix,
    cmap=decision_cmap,
    vmin=decision_min,
    vmax=decision_max,
    interpolation="nearest",
    aspect="auto",
)
profit_image = ax_profit.imshow(
    profit_matrix,
    cmap=CMAP_SEQ,
    vmin=profit_min,
    vmax=profit_max,
    interpolation="nearest",
    aspect="auto",
)

case_labels = [cn(f"情况 {tag}") for tag in case_tags]
row_positions = np.arange(len(case_tags))
decision_positions = np.arange(len(decision_variables))

ax_decision.set_xticks(decision_positions)
ax_decision.set_xticklabels([cn(variable) for variable in decision_variables])
ax_decision.set_yticks(row_positions)
ax_decision.set_yticklabels(case_labels)
ax_decision.set_xlabel(cn("决策变量"))
ax_decision.set_ylabel(cn("表1情况"))

ax_profit.set_xticks([])
ax_profit.set_yticks(row_positions)
ax_profit.tick_params(axis="y", labelleft=False)
ax_profit.set_xlabel(cn("单位期望利润"))

for ax, n_rows, n_cols in (
    (ax_decision, decision_matrix.shape[0], decision_matrix.shape[1]),
    (ax_profit, profit_matrix.shape[0], profit_matrix.shape[1]),
):
    ax.set_xticks(np.arange(-0.5, n_cols, 1), minor=True)
    ax.set_yticks(np.arange(-0.5, n_rows, 1), minor=True)
    ax.grid(which="minor", color=COLORS["grid"], linewidth=0.6)
    ax.tick_params(which="minor", bottom=False, left=False)
    for spine in ax.spines.values():
        spine.set_visible(False)

for row in range(decision_matrix.shape[0]):
    for col in range(decision_matrix.shape[1]):
        value = decision_matrix[row, col]
        text_color = (
            COLORS["primary"] if value == decision_min else COLORS["highlight"]
        )
        ax_decision.text(
            col,
            row,
            cn(f"{value:g}"),
            ha="center",
            va="center",
            color=text_color,
            fontweight="bold",
        )

for row, value in enumerate(profit_values):
    text_color = (
        COLORS["primary"] if value == profit_min else COLORS["highlight"]
    )
    ax_profit.text(
        0,
        row,
        cn(f"{value:.2f}"),
        ha="center",
        va="center",
        color=text_color,
        fontweight="bold",
    )

panel(ax_decision, "(a)")
panel(ax_profit, "(b)")

decision_colorbar = fig.colorbar(
    decision_image,
    cax=cax_decision,
    ticks=np.unique(decision_matrix),
)
decision_colorbar.set_label(cn("账本决策值"))
decision_colorbar.outline.set_visible(False)
decision_colorbar.ax.tick_params(length=0, pad=2)

profit_colorbar = fig.colorbar(
    profit_image,
    cax=cax_profit,
    ticks=[profit_min, profit_max],
)
profit_colorbar.set_label(cn("元/件"))
profit_colorbar.outline.set_visible(False)
profit_colorbar.ax.tick_params(length=0, pad=2)

save(fig, "fig_q2_six_cases_decisions")
plt.close(fig)
