"""主面板展示组装拓扑变体的利润，辅助面板展示成品策略组合的利润；数据来自账本中的拓扑稳健性、成品策略对照及基准成本与利润记录。"""
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import setup_style


setup_style()


def main():
    doc = load("results.json")
    results = {item["result_id"]: item["value"] for item in doc["results"]}

    topology = results["R-Q3-topology-robustness"]
    strategies = results["R-Q3-product-strategy-compare"]
    baseline_cost = results["R-Q3-baseline-U-root"]
    baseline_profit = results["R-Q3-baseline-profit"]

    fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8))

    ax = axes[0]
    topology_names = [item["name"] for item in topology]
    topology_profits = [item["profit"] for item in topology]
    x_topology = list(range(len(topology_names)))
    ax.plot(x_topology, topology_profits, color=PALETTE[0], marker="o",
            linewidth=1.8, markersize=4)
    ax.fill_between(x_topology, topology_profits, baseline_profit,
                    color=_lighten(PALETTE[0], 0.5), alpha=0.35)
    ax.axhline(baseline_profit, color=COLORS["ref_line"], linestyle="--",
               linewidth=1, label=cn("基准利润"))
    ax.set_xticks(x_topology)
    ax.set_xticklabels(topology_names, rotation=35, ha="right", fontsize=7)
    ax.set_xlabel(cn("拓扑变体"))
    ax.set_ylabel(cn("利润（元/件）"))
    ax.grid(axis="y", color=COLORS["grid"], linewidth=0.6)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, fontsize=8)
    panel(ax, "(a)")

    ax = axes[1]
    strategy_labels = [
        cn(f"Z={item['Z']}, D={item['D']}") for item in strategies
    ]
    strategy_profits = [item["profit"] for item in strategies]
    x_strategy = list(range(len(strategy_labels)))
    ax.plot(x_strategy, strategy_profits, color=PALETTE[1], marker="s",
            linewidth=1.8, markersize=4)
    ax.fill_between(x_strategy, strategy_profits, baseline_profit,
                    color=_lighten(PALETTE[1], 0.5), alpha=0.35)
    ax.axhline(baseline_profit, color=COLORS["ref_line"], linestyle="--",
               linewidth=1, label=cn("基准利润"))
    ax.set_xticks(x_strategy)
    ax.set_xticklabels(strategy_labels, rotation=25, ha="right", fontsize=8)
    ax.set_xlabel(cn("成品策略组合"))
    ax.set_ylabel(cn("利润（元/件）"))
    ax.grid(axis="y", color=COLORS["grid"], linewidth=0.6)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(frameon=False, fontsize=8)
    panel(ax, "(b)")

    fig.tight_layout()
    save(fig, "fig_q3_strategy_cost_compare")


if __name__ == "__main__":
    main()
