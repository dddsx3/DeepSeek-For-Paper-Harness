"""问题3基准装配网络节点热力图：颜色展示各节点单位成本 U，格内标注缺陷率 q 与节点检测/拆解决策；数据来自账本 R-Q3-baseline-node-cost、R-Q3-baseline-best-decision、R-Q3-baseline-node-count、R-Q3-baseline-semi-count。"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import setup_style

import matplotlib.pyplot as plt
import numpy as np


def main():
    setup_style()
    doc = load("results.json")
    values = {item["result_id"]: item["value"] for item in doc["results"]}

    node_cost = values["R-Q3-baseline-node-cost"]
    decisions = values["R-Q3-baseline-best-decision"]
    node_count = values["R-Q3-baseline-node-count"]
    semi_count = values["R-Q3-baseline-semi-count"]

    nodes = list(node_cost.keys())
    costs = np.array([[node_cost[node]["U"] for node in nodes]], dtype=float)

    fig, ax = plt.subplots(figsize=(6.0, 2.8))
    mesh = ax.imshow(costs, aspect="auto", cmap="YlGnBu")
    ax.set_xticks(np.arange(len(nodes)))
    ax.set_xticklabels([cn(node) for node in nodes], rotation=45, ha="right")
    ax.set_yticks([0])
    ax.set_yticklabels([cn("单位成本 U")])

    for idx, node in enumerate(nodes):
        decision = decisions[node]
        q_value = node_cost[node]["q"]
        ax.text(
            idx, 0,
            cn(f'U={node_cost[node]["U"]:.2f}\nq={q_value:.3f}\nZ={decision["Z"]}, D={decision["D"]}'),
            ha="center", va="center", fontsize=7,
            color=COLORS["gray"]
        )

    colorbar = fig.colorbar(mesh, ax=ax, pad=0.02)
    colorbar.set_label(cn("单位成本 U"))
    ax.set_xlabel(cn("节点"))
    ax.set_ylabel(cn("节点指标"))
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    panel(ax, "(a)")
    fig.text(
        0.99, 0.01,
        cn(f"节点数={node_count}；半成品数={semi_count}"),
        ha="right", va="bottom", fontsize=7, color=COLORS["gray"]
    )
    fig.tight_layout()
    save(fig, "fig_q3_assembly_network_cost")


if __name__ == "__main__":
    main()
