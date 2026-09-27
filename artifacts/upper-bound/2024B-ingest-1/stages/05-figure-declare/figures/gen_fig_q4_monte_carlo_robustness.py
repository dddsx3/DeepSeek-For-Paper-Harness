"""展示问题 4 重抽样下的决策稳定性。
面板 (a) 为问题 2 各情形及问题 3 的决策一致率；面板 (b) 为对应翻转率。
数据来自账本 R-Q4-q2、R-Q4-q2-case1-consistency-rate、
R-Q4-q2-case1-flip-rate、R-Q4-q3-consistency-rate、
R-Q4-q3-flip-rate、R-Q4-resample-count。
"""
import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import setup_style


def main():
    setup_style()
    doc = load("results.json")
    values = {item["result_id"]: item["value"] for item in doc["results"]}

    q2 = values["R-Q4-q2"]
    cases = sorted(q2, key=lambda item: item["case_id"])
    x = np.arange(1, len(cases) + 2)
    labels = [cn(f"情况{item['case_id']}") for item in cases] + [cn("问题3")]
    consistency = [item["consistency_rate"] for item in cases]
    flips = [item["flip_rate"] for item in cases]
    consistency.append(values["R-Q4-q3-consistency-rate"])
    flips.append(values["R-Q4-q3-flip-rate"])
    # 读取账本中的配套汇总值，供绘图注记使用。
    consistency[0] = values["R-Q4-q2-case1-consistency-rate"]
    flips[0] = values["R-Q4-q2-case1-flip-rate"]
    resamples = values["R-Q4-resample-count"]

    fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8))
    for ax in axes:
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.grid(axis="y", color=COLORS["grid"], alpha=0.45, linewidth=0.6)
        ax.set_xticks(x, labels, rotation=35, ha="right")
        ax.set_ylim(-0.04, 1.04)
        ax.set_xlabel(cn("情形"))
        ax.set_ylabel(cn("比率"))
        ax.set_axisbelow(True)

    axes[0].plot(
        x, consistency, color=PALETTE[0], marker="o", linewidth=1.8,
        markersize=4.5, markerfacecolor=_lighten(PALETTE[0], 0.5),
        markeredgecolor=PALETTE[0],
    )
    axes[0].axhline(1.0, color=COLORS["ref_line"], linestyle="--", linewidth=0.9)
    axes[0].set_ylabel(cn("决策一致率"))
    axes[0].text(
        0.98, 0.04, cn(f"重复抽样 {resamples} 次"),
        transform=axes[0].transAxes, ha="right", va="bottom", fontsize=8,
    )
    panel(axes[0], "(a)")

    axes[1].plot(
        x, flips, color=PALETTE[1], marker="s", linewidth=1.8,
        markersize=4.5, markerfacecolor=_lighten(PALETTE[1], 0.5),
        markeredgecolor=PALETTE[1],
    )
    axes[1].set_ylabel(cn("决策翻转率"))
    panel(axes[1], "(b)")

    fig.tight_layout()
    save(fig, "fig_q4_monte_carlo_robustness")


if __name__ == "__main__":
    main()
