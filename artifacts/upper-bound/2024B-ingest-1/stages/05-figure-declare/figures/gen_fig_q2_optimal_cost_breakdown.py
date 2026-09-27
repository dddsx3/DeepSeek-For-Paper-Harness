"""问题2情况1最优策略的单位期望成本瀑布图；单面板展示各成本分项的累计贡献及账本总成本核对。数据来自 R-Q2-case1-cost-purchase、R-Q2-case1-cost-inspect、R-Q2-case1-cost-assembly、R-Q2-case1-cost-product-inspect、R-Q2-case1-cost-disassemble、R-Q2-case1-cost-exchange、R-Q2-case1-U。"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np


doc = load("results.json")
values = {item["result_id"]: item["value"] for item in doc["results"]}

component_refs = [
    ("采购", "R-Q2-case1-cost-purchase"),
    ("零配件检测", "R-Q2-case1-cost-inspect"),
    ("装配", "R-Q2-case1-cost-assembly"),
    ("成品检测", "R-Q2-case1-cost-product-inspect"),
    ("拆解", "R-Q2-case1-cost-disassemble"),
    ("调换损失", "R-Q2-case1-cost-exchange"),
]
labels = [cn(label) for label, _ in component_refs] + [cn("账本总成本")]
components = [values[result_id] for _, result_id in component_refs]
ledger_total = values["R-Q2-case1-U"]

cum = np.cumsum(components)
x_positions = np.arange(len(labels))
n = len(labels)
layer_colors = [COLORS["up"] if value >= 0 else COLORS["down"] for value in components]

fig, ax = plt.subplots(figsize=(6.0, 3.4))
ax.grid(axis="y", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

# 逐项成本形成的色带与累计阶梯
for i, value in enumerate(components):
    left = x_positions[i] - 0.42
    right = x_positions[-1] + 0.42
    bottom = cum[i] - value
    top = cum[i]
    ax.fill_between([left, right], bottom, top, alpha=0.15,
                    color=layer_colors[i], zorder=1 + i)
    ax.plot([left, right], [cum[i], cum[i]], color=layer_colors[i],
            linewidth=0.7, linestyle="--", alpha=0.35, zorder=2 + i)

# 从零起始的累计成本底层
ax.fill_between([x_positions[0] - 0.42, x_positions[-1] + 0.42],
                0, cum[0], alpha=0.06, color=PALETTE[0], zorder=0)
ax.step(x_positions[:len(components)], cum, where="mid",
        color=PALETTE[0], linewidth=2.2, zorder=10)

for i, total in enumerate(cum):
    ax.scatter(x_positions[i], total, color=layer_colors[i], s=58,
               zorder=11, edgecolors="white", linewidths=1.5)
    ax.text(x_positions[i], total, f"{total:.2f}", ha="center", va="bottom",
            fontsize=8, color=layer_colors[i],
            bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                      edgecolor="none", alpha=0.9), zorder=12)

# 最后一项直接显示账本总成本，用于与分项累计核对
ax.bar(x_positions[-1], ledger_total, width=0.58, color=PALETTE[0],
       alpha=0.78, zorder=5)
ax.scatter(x_positions[-1], ledger_total, color=PALETTE[0], s=58,
           zorder=11, edgecolors="white", linewidths=1.5)
ax.text(x_positions[-1], ledger_total, f"{ledger_total:.2f}",
        ha="center", va="bottom", fontsize=8, fontweight="bold",
        color=PALETTE[0],
        bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                  edgecolor=PALETTE[0], alpha=0.9, linewidth=0.5), zorder=12)

legend_patches = [
    mpatches.Patch(facecolor=_lighten(layer_colors[i], 0.4),
                   edgecolor=layer_colors[i], linewidth=1.0,
                   label=labels[i])
    for i in range(len(components))
]
ax.legend(handles=legend_patches, loc="upper left", frameon=False,
          labelspacing=0.3, handlelength=1.3, fontsize=7.5, ncol=2)

ax.set_xticks(x_positions)
ax.set_xticklabels(labels, fontsize=8, rotation=20, ha="right")
ax.set_ylabel(cn("单位期望成本（元/件）"), fontsize=9)
ax.set_xlim(-0.6, n - 0.4)
ax.set_ylim(0, max(float(np.max(cum)), float(ledger_total)) * 1.18)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
panel(ax, "(a)")
fig.tight_layout()
save(fig, "fig_q2_optimal_cost_breakdown")
