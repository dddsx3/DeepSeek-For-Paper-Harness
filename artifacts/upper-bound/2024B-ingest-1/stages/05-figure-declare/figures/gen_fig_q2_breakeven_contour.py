"""比较六种情形下16种策略组合的期望成本热力图；单面板展示账本策略成本矩阵；数据来自 R-Q2-case1-strategies 至 R-Q2-case6-strategies。"""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import seaborn as sns

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


def main():
    doc = load("results.json")
    values = {item["result_id"]: item["value"] for item in doc["results"]}
    ids = [
        "R-Q2-case1-strategies",
        "R-Q2-case2-strategies",
        "R-Q2-case3-strategies",
        "R-Q2-case4-strategies",
        "R-Q2-case5-strategies",
        "R-Q2-case6-strategies",
    ]

    strategies = [values[result_id] for result_id in ids]
    costs = np.asarray([[strategy["U"] for strategy in row] for row in strategies])
    combination_labels = [
        f"{s['Z1']}{s['Z2']}{s['C']}{s['D']}" for s in strategies[0]
    ]
    case_labels = [cn(f"情况{i}") for i in range(1, len(strategies) + 1)]

    cmap = LinearSegmentedColormap.from_list(
        "ledger_costs",
        [_lighten(PALETTE[0], 0.78), PALETTE[0]],
    )
    fig, ax = plt.subplots(figsize=(6.0, 4.8))
    sns.heatmap(
        costs,
        ax=ax,
        cmap=cmap,
        cbar_kws={"label": cn("期望成本（元/件）")},
        xticklabels=combination_labels,
        yticklabels=case_labels,
        linewidths=0.35,
        linecolor=COLORS["grid"],
    )
    ax.set_xlabel(cn("策略组合（Z₁Z₂CD）"))
    ax.set_ylabel(cn("表1情况"))
    ax.tick_params(axis="x", labelrotation=0)
    ax.tick_params(axis="y", labelrotation=0)
    panel(ax, "(a)")
    fig.tight_layout()
    save(fig, "fig_q2_breakeven_contour")


if __name__ == "__main__":
    main()
