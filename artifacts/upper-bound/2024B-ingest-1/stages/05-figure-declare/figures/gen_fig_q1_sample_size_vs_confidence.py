"""比较拒收与接收方案的最小样本量及临界次品数。
面板 (a) 展示两方案样本量随置信水平的变化；面板 (b) 展示两方案临界次品数随置信水平的变化。
数据来自账本：R-Q1-ssvc-confidence、R-Q1-ssvc-n-reject、R-Q1-ssvc-c-reject、
R-Q1-ssvc-n-accept、R-Q1-ssvc-c-accept。
"""
import numpy as np
import matplotlib.pyplot as plt
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


doc = load("results.json")
results = {item["result_id"]: item["value"] for item in doc["results"]}

x = np.asarray(results["R-Q1-ssvc-confidence"])
n_reject = np.asarray(results["R-Q1-ssvc-n-reject"])
n_accept = np.asarray(results["R-Q1-ssvc-n-accept"])
c_reject = np.asarray(results["R-Q1-ssvc-c-reject"])
c_accept = np.asarray(results["R-Q1-ssvc-c-accept"])

fig, (ax_n, ax_c) = plt.subplots(1, 2, figsize=(6.0, 2.8))
series = [
    (ax_n, n_reject, n_accept, cn("拒收方案"), cn("接收方案"), cn("样本量（件）")),
    (ax_c, c_reject, c_accept, cn("拒收方案"), cn("接收方案"), cn("临界次品数（件）")),
]

for ax, y_reject, y_accept, reject_label, accept_label, ylabel in series:
    ax.plot(
        x, y_reject, "o-",
        color=PALETTE[0], linewidth=2, markersize=4,
        markeredgecolor="white", markeredgewidth=0.8,
        label=reject_label, zorder=3,
    )
    ax.plot(
        x, y_accept, "s-",
        color=PALETTE[1], linewidth=1.8, markersize=3.5,
        markeredgecolor="white", markeredgewidth=0.8,
        label=accept_label, zorder=3,
    )
    ax.set_xlabel(cn("置信水平"))
    ax.set_ylabel(ylabel)
    ax.set_xticks(x)
    ax.tick_params(axis="x", rotation=30)
    ax.grid(alpha=0.12, linestyle="--", color=COLORS["grid"])
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(frameon=False, labelspacing=0.35, handlelength=1.4, fontsize=8)
    panel(ax, "(a)" if ax is ax_n else "(b)")

fig.tight_layout()
save(fig, "fig_q1_sample_size_vs_confidence")
