"""情况1最优策略的单位成本项目规模图。单面板以水平条形展示采购、检测、装配、成品检测、拆解和调换损失分项；数据来自账本 R-Q2-case1-cost-purchase、R-Q2-case1-cost-inspect、R-Q2-case1-cost-assembly、R-Q2-case1-cost-product-inspect、R-Q2-case1-cost-disassemble、R-Q2-case1-cost-exchange。账本未提供成本参数扰动扫描，因此图中仅呈现成本规模，不表示灵敏度或正负扰动影响。
"""
import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


def main():
    doc = load("results.json")
    values = {item["result_id"]: item["value"] for item in doc["results"]}

    refs = [
        ("R-Q2-case1-cost-purchase", "采购"),
        ("R-Q2-case1-cost-inspect", "零配件检测"),
        ("R-Q2-case1-cost-assembly", "装配"),
        ("R-Q2-case1-cost-product-inspect", "成品检测"),
        ("R-Q2-case1-cost-disassemble", "拆解"),
        ("R-Q2-case1-cost-exchange", "调换损失"),
    ]
    items = sorted(
        [(label, float(values[result_id])) for result_id, label in refs],
        key=lambda item: item[1],
    )
    labels = [cn(item[0]) for item in items]
    amounts = np.asarray([item[1] for item in items], dtype=float)
    y = np.arange(len(labels))

    fig, ax = plt.subplots(figsize=(6.0, 4.5))
    ax.set_axisbelow(True)
    ax.grid(axis="x", color=COLORS["grid"], alpha=0.3, linewidth=0.7)

    bars = ax.barh(
        y,
        amounts,
        height=0.58,
        color=_lighten(PALETTE[0], 0.55),
        edgecolor=PALETTE[0],
        linewidth=1.1,
        zorder=3,
    )
    ax.bar_label(bars, fmt="%.2f", padding=3, fontsize=8.5, color=COLORS["gray"])

    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    ax.set_xlabel(cn("单位成本（元/件）"))
    ax.set_ylabel(cn("成本项目"))
    ax.set_xlim(left=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    panel(ax, "(a)")

    fig.tight_layout()
    save(fig, "fig_q2_sensitivity_unit_cost")


if __name__ == "__main__":
    main()
