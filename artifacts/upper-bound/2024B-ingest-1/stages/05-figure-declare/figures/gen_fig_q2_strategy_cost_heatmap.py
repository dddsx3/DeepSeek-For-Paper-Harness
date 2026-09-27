"""六种情形下 16 种策略的单位期望成本热力图；单面板展示各策略组合成本矩阵。数据来自账本 R-Q2-case1-strategies 至 R-Q2-case6-strategies。"""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


def main():
    doc = load("results.json")
    results = {item["result_id"]: item["value"] for item in doc["results"]}
    case_ids = [f"R-Q2-case{i}-strategies" for i in range(1, 7)]
    cases = [results[result_id] for result_id in case_ids]

    strategy_labels = [
        f"({item['Z1']},{item['Z2']},{item['C']},{item['D']})"
        for item in cases[0]
    ]
    matrix = np.asarray([[strategy["U"] for strategy in case] for case in cases])
    case_labels = [f"情况 {i}" for i in range(1, len(cases) + 1)]

    cmap = LinearSegmentedColormap.from_list(
        "ledger_costs", [_lighten(PALETTE[0], 0.82), PALETTE[0]]
    )
    fig, ax = plt.subplots(figsize=(6.0, 3.7))
    image = ax.imshow(matrix, aspect="auto", cmap=cmap, interpolation="nearest")

    ax.set_xticks(np.arange(len(strategy_labels)))
    ax.set_xticklabels(strategy_labels, rotation=45, ha="right", fontsize=7)
    ax.set_yticks(np.arange(len(case_labels)))
    ax.set_yticklabels([cn(label) for label in case_labels])
    ax.set_xlabel(cn("策略组合（Z1、Z2、C、D）"))
    ax.set_ylabel(cn("表 1 情况"))

    midpoint = (float(np.min(matrix)) + float(np.max(matrix))) / 2
    for row in range(matrix.shape[0]):
        for col in range(matrix.shape[1]):
            ax.text(
                col,
                row,
                f"{matrix[row, col]:.1f}",
                ha="center",
                va="center",
                fontsize=6,
                color="white" if matrix[row, col] > midpoint else COLORS["gray"],
            )

    colorbar = fig.colorbar(image, ax=ax, fraction=0.035, pad=0.025)
    colorbar.set_label(cn("单位期望成本（元/件）"))
    panel(ax, "(a)")
    fig.tight_layout()
    save(fig, "fig_q2_strategy_cost_heatmap")


if __name__ == "__main__":
    main()
