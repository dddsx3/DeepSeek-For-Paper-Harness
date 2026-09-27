"""问题2情况1全部策略组合的单位期望成本—利润矩阵。

面板 (a) 展示各零配件检测决策与成品决策组合的单位期望成本热力图。
面板 (b) 展示相同策略组合的单位期望利润热力图。
数据取自 R-Q2-case1-strategies；整体最优成本、利润及四项决策分别取自
R-Q2-case1-U、R-Q2-case1-profit、R-Q2-case1-Z1、R-Q2-case1-Z2、
R-Q2-case1-C、R-Q2-case1-D。所有数值均在运行时由账本读取。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import CMAP_SEQ, CMAP_SEQ_R

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import Normalize
from matplotlib.patches import Rectangle


def _outline_cells(ax, mask, *, edgecolor, linewidth, zorder):
    """按热力图行列掩码添加单元格边框。"""
    for row_idx, col_idx in np.argwhere(mask):
        ax.add_patch(
            Rectangle(
                (col_idx - 0.5, row_idx - 0.5),
                1,
                1,
                fill=False,
                edgecolor=edgecolor,
                linewidth=linewidth,
                zorder=zorder,
            )
        )


def main():
    doc = load("results.json")
    values = {entry["result_id"]: entry["value"] for entry in doc["results"]}

    strategies = values["R-Q2-case1-strategies"]
    best_cost = float(values["R-Q2-case1-U"])
    best_profit = float(values["R-Q2-case1-profit"])
    optimal_decision = (
        int(values["R-Q2-case1-Z1"]),
        int(values["R-Q2-case1-Z2"]),
        int(values["R-Q2-case1-C"]),
        int(values["R-Q2-case1-D"]),
    )

    part_levels = sorted(
        {(int(row["Z1"]), int(row["Z2"])) for row in strategies}
    )
    product_levels = sorted(
        {(int(row["C"]), int(row["D"])) for row in strategies}
    )
    strategy_lookup = {
        (
            int(row["Z1"]),
            int(row["Z2"]),
            int(row["C"]),
            int(row["D"]),
        ): (float(row["U"]), float(row["profit"]))
        for row in strategies
    }

    if len(strategy_lookup) != len(strategies):
        raise ValueError("R-Q2-case1-strategies contains duplicate decisions")

    cost_matrix = np.array(
        [
            [
                strategy_lookup[(z1, z2, c, d)][0]
                for c, d in product_levels
            ]
            for z1, z2 in part_levels
        ],
        dtype=float,
    )
    profit_matrix = np.array(
        [
            [
                strategy_lookup[(z1, z2, c, d)][1]
                for c, d in product_levels
            ]
            for z1, z2 in part_levels
        ],
        dtype=float,
    )

    optimal_part = (optimal_decision[0], optimal_decision[1])
    optimal_product = (optimal_decision[2], optimal_decision[3])
    optimal_row = part_levels.index(optimal_part)
    optimal_col = product_levels.index(optimal_product)

    if not np.isclose(cost_matrix[optimal_row, optimal_col], best_cost):
        raise ValueError("R-Q2-case1-U does not match the strategy table")
    if not np.isclose(profit_matrix[optimal_row, optimal_col], best_profit):
        raise ValueError("R-Q2-case1-profit does not match the strategy table")

    if not np.all(np.isclose(cost_matrix, best_cost, rtol=0.0, atol=np.finfo(float).eps)):
        best_cost = float(np.nanmin(cost_matrix))
    if not np.all(np.isclose(profit_matrix, best_profit, rtol=0.0, atol=np.finfo(float).eps)):
        best_profit = float(np.nanmax(profit_matrix))

    cost_column_best = np.isclose(
        cost_matrix,
        np.nanmin(cost_matrix, axis=0, keepdims=True),
        rtol=1e-10,
        atol=1e-12,
    )
    profit_column_best = np.isclose(
        profit_matrix,
        np.nanmax(profit_matrix, axis=0, keepdims=True),
        rtol=1e-10,
        atol=1e-12,
    )
    cost_overall_best = np.isclose(
        cost_matrix, best_cost, rtol=1e-10, atol=1e-12
    )
    profit_overall_best = np.isclose(
        profit_matrix, best_profit, rtol=1e-10, atol=1e-12
    )

    fig, axes = plt.subplots(
        1,
        2,
        figsize=(6.0, 2.8),
        constrained_layout=True,
    )

    cost_norm = Normalize(vmin=best_cost, vmax=float(np.nanmax(cost_matrix)))
    profit_norm = Normalize(
        vmin=float(np.nanmin(profit_matrix)), vmax=best_profit
    )

    heatmaps = (
        (
            axes[0],
            cost_matrix,
            cost_norm,
            CMAP_SEQ_R,
            cost_column_best,
            cost_overall_best,
            cn("单位期望成本（元/件）"),
            COLORS["highlight"],
            "(a)",
        ),
        (
            axes[1],
            profit_matrix,
            profit_norm,
            CMAP_SEQ,
            profit_column_best,
            profit_overall_best,
            cn("单位期望利润（元/件）"),
            COLORS["accent"],
            "(b)",
        ),
    )

    for ax, matrix, norm, cmap, column_best, overall_best, cbar_label, best_edge, tag in heatmaps:
        image = ax.imshow(
            matrix,
            cmap=cmap,
            norm=norm,
            origin="upper",
            interpolation="nearest",
            aspect="equal",
        )

        ax.set_xticks(np.arange(len(product_levels)))
        ax.set_yticks(np.arange(len(part_levels)))
        ax.set_xticklabels(
            [cn(f"({c},{d})") for c, d in product_levels]
        )
        ax.set_yticklabels(
            [cn(f"({z1},{z2})") for z1, z2 in part_levels]
        )
        ax.set_xlabel(cn("成品决策位 (C,D)"))
        ax.set_ylabel(cn("零配件决策位 (Z1,Z2)"))
        ax.tick_params(axis="both", colors=COLORS["gray"], labelsize=8)

        annotation_box = {
            "facecolor": _lighten(COLORS["neutral"], 0.88),
            "edgecolor": "none",
            "alpha": 0.88,
            "boxstyle": "round,pad=0.18",
        }
        for row_idx in range(matrix.shape[0]):
            for col_idx in range(matrix.shape[1]):
                ax.text(
                    col_idx,
                    row_idx,
                    cn(f"{matrix[row_idx, col_idx]:.2f}"),
                    ha="center",
                    va="center",
                    color=COLORS["primary"],
                    fontsize=7.5,
                    bbox=annotation_box,
                )

        _outline_cells(
            ax,
            column_best,
            edgecolor=best_edge,
            linewidth=1.3,
            zorder=3,
        )
        _outline_cells(
            ax,
            overall_best,
            edgecolor=COLORS["up"],
            linewidth=2.6,
            zorder=4,
        )

        colorbar = fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04)
        colorbar.set_label(cbar_label, color=COLORS["primary"], fontsize=8)
        colorbar.ax.tick_params(colors=COLORS["gray"], labelsize=7)
        colorbar.outline.set_edgecolor(_lighten(PALETTE[0], 0.35))
        colorbar.outline.set_linewidth(0.7)
        panel(ax, tag)

    save(fig, "fig_q2_strategy_cost_heatmap")
    plt.close(fig)


if __name__ == "__main__":
    main()
