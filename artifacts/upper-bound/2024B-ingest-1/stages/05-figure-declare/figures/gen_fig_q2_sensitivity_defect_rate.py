"""展示账本中已有的缺陷率接收特性与两种情形的策略记录。
(a) OC 接收概率随真实次品率变化；(b) 情形 1、6 的策略成本与利润序列。
数据来自 R-Q1-oc-curve-p-grid、R-Q1-oc-curve-accept-prob、
R-Q2-case1-strategies、R-Q2-case6-strategies。
"""
import numpy as np
import matplotlib.pyplot as plt
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

doc = load("results.json")
if isinstance(doc, dict) and "results" in doc:
    values = {item["result_id"]: item["value"] for item in doc["results"]}
else:
    values = doc


def get_value(result_id):
    return values[result_id]


p_grid = np.asarray(get_value("R-Q1-oc-curve-p-grid"), dtype=float)
accept_prob = np.asarray(get_value("R-Q1-oc-curve-accept-prob"), dtype=float)
case1 = get_value("R-Q2-case1-strategies")
case6 = get_value("R-Q2-case6-strategies")

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(6.0, 2.8))

ax1.plot(
    p_grid,
    accept_prob,
    "o-",
    color=PALETTE[0],
    linewidth=1.8,
    markersize=3,
    markeredgecolor="white",
    markeredgewidth=0.7,
    label=cn("接收概率"),
    zorder=3,
)
ax1.fill_between(p_grid, accept_prob, alpha=0.10, color=_lighten(PALETTE[0], 0.5))
max_idx = int(np.argmax(accept_prob))
ax1.scatter(
    p_grid[max_idx], accept_prob[max_idx], s=70, color=PALETTE[0],
    edgecolor="white", linewidth=1.2, zorder=4, marker="*"
)
ax1.annotate(
    f"{accept_prob[max_idx]:.2f}",
    xy=(p_grid[max_idx], accept_prob[max_idx]),
    xytext=(8, -16),
    textcoords="offset points",
    fontsize=8,
    color=PALETTE[0],
    arrowprops=dict(arrowstyle="->", color=PALETTE[0], lw=0.9),
)
ax1.set_xlabel(cn("真实次品率"))
ax1.set_ylabel(cn("接收概率"))
ax1.set_ylim(-0.04, 1.08)
ax1.legend(frameon=False, fontsize=8, loc="best")
ax1.grid(alpha=0.12, linestyle="--", color=COLORS["grid"])
ax1.spines["top"].set_visible(False)
ax1.spines["right"].set_visible(False)
panel(ax1, "(a)")

strategy_index = np.arange(len(case1))
for strategies, name, color in (
    (case1, cn("情形 1"), PALETTE[1]),
    (case6, cn("情形 6"), PALETTE[2]),
):
    costs = np.asarray([item["U"] for item in strategies], dtype=float)
    profits = np.asarray([item["profit"] for item in strategies], dtype=float)
    ax2.plot(
        strategy_index, costs, "o-", color=color, linewidth=1.6,
        markersize=3, markeredgecolor="white", markeredgewidth=0.6,
        label=f"{name}—{cn('成本')}", zorder=3,
    )
    ax2.plot(
        strategy_index, profits, "s--", color=_lighten(color, 0.3),
        linewidth=1.3, markersize=2.8, markeredgecolor="white",
        markeredgewidth=0.6, label=f"{name}—{cn('利润')}", zorder=3,
    )

ax2.set_xlabel(cn("策略记录序号"))
ax2.set_ylabel(cn("账本记录值（元/件）"))
ax2.set_xticks(strategy_index[::2])
ax2.legend(frameon=False, fontsize=7, ncol=2, labelspacing=0.3, handlelength=1.4)
ax2.grid(alpha=0.12, linestyle="--", color=COLORS["grid"])
ax2.spines["top"].set_visible(False)
ax2.spines["right"].set_visible(False)
panel(ax2, "(b)")

fig.tight_layout()
save(fig, "fig_q2_sensitivity_defect_rate")
