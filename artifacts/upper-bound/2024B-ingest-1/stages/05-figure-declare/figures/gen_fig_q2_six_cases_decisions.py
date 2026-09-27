"""六种情形的最优二元决策热力图及利润对照；(a) 展示零配件检测、成品检测与拆解决策，(b) 展示各情形最优利润。数据来自 R-Q2-case{1-6}-{Z1,Z2,C,D,profit}。"""
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.colors import LinearSegmentedColormap

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


def main():
    doc = load("results.json")
    records = doc["results"]
    values = {item["result_id"]: item["value"] for item in records}

    cases = range(1, 7)
    decisions = ("Z1", "Z2", "C", "D")
    matrix = np.array([
        [values[f"R-Q2-case{case}-{decision}"] for decision in decisions]
        for case in cases
    ])
    profits = np.array([
        values[f"R-Q2-case{case}-profit"] for case in cases
    ])

    cmap = LinearSegmentedColormap.from_list(
        "decision_scale", [_lighten(PALETTE[0], 0.75), PALETTE[0]]
    )
    fig, (ax_heat, ax_profit) = plt.subplots(
        1, 2, figsize=(6.0, 2.8), gridspec_kw={"width_ratios": [1.35, 1]}
    )

    sns.heatmap(
        matrix,
        ax=ax_heat,
        cmap=cmap,
        vmin=0,
        vmax=1,
        annot=True,
        fmt=".0f",
        linewidths=0.6,
        linecolor=COLORS["grid"],
        cbar=False,
        xticklabels=[cn("零件1检测"), cn("零件2检测"), cn("成品检测"), cn("拆解")],
        yticklabels=[cn(f"情况 {case}") for case in cases],
    )
    ax_heat.set_xlabel(cn("决策环节"))
    ax_heat.set_ylabel(cn("表 1 情况"))
    ax_heat.tick_params(axis="x", labelrotation=0)
    panel(ax_heat, "(a)")

    bars = ax_profit.bar(
        np.arange(len(profits)),
        profits,
        color=PALETTE[0],
        edgecolor=COLORS["gray"],
        linewidth=0.5,
    )
    ax_profit.set_xticks(np.arange(len(profits)))
    ax_profit.set_xticklabels([cn(f"情况 {case}") for case in cases], rotation=0)
    ax_profit.set_xlabel(cn("表 1 情况"))
    ax_profit.set_ylabel(cn("期望利润（元/件）"))
    ax_profit.axhline(0, color=COLORS["ref_line"], linewidth=0.8)
    ax_profit.bar_label(bars, fmt="%.1f", padding=2, fontsize=7)
    ax_profit.grid(axis="y", color=COLORS["grid"], linewidth=0.5)
    ax_profit.set_axisbelow(True)
    panel(ax_profit, "(b)")

    fig.tight_layout()
    save(fig, "fig_q2_six_cases_decisions")


if __name__ == "__main__":
    main()
