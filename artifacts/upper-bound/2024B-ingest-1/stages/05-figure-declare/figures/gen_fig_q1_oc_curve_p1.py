"""OC 曲线展示真实次品率变化下的接收概率。
单面板：接收概率随真实次品率变化，并以账本中的标称次品率作参考线。
数据来自账本 R-Q1-oc-curve-p-grid、R-Q1-oc-curve-accept-prob、
R-Q1-nominal-p。
"""
import numpy as np
import matplotlib.pyplot as plt
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


doc = load("results.json")
values = {item["result_id"]: item["value"] for item in doc["results"]}

x = np.asarray(values["R-Q1-oc-curve-p-grid"], dtype=float)
y = np.asarray(values["R-Q1-oc-curve-accept-prob"], dtype=float)
nominal_p = float(values["R-Q1-nominal-p"])

fig, ax = plt.subplots(figsize=(6.0, 3.6))

ax.axhspan(
    float(np.min(y)),
    float(np.max(y)),
    alpha=0.02,
    color=PALETTE[0],
    zorder=0,
)

ax.fill_between(x, y, alpha=0.08, color=PALETTE[0], linewidth=0)
ax.plot(
    x,
    y,
    "o-",
    color=PALETTE[0],
    linewidth=2.2,
    markersize=4,
    markeredgecolor="white",
    markeredgewidth=0.9,
    label=cn("接收概率"),
    zorder=3,
)

ax.axvline(
    nominal_p,
    color=COLORS["ref_line"],
    linestyle="--",
    linewidth=1.2,
    label=cn("标称次品率"),
    zorder=2,
)

max_idx = int(np.argmax(y))
ax.scatter(
    x[max_idx],
    y[max_idx],
    s=90,
    color=PALETTE[0],
    edgecolor="white",
    linewidth=1.5,
    zorder=4,
    marker="*",
)
ax.annotate(
    f"★ {y[max_idx]:.2f}",
    xy=(x[max_idx], y[max_idx]),
    xytext=(x[max_idx] + 0.035, y[max_idx] - 0.15),
    fontsize=9,
    color=PALETTE[0],
    arrowprops=dict(arrowstyle="->", color=PALETTE[0], lw=1.0),
    bbox=dict(
        boxstyle="round,pad=0.25",
        facecolor="white",
        edgecolor=_lighten(PALETTE[0], 0.35),
        alpha=0.9,
    ),
)

ax.set_xlabel(cn("真实次品率"))
ax.set_ylabel(cn("接收概率"))
ax.set_xlim(float(np.min(x)), float(np.max(x)))
ax.set_ylim(min(0.0, float(np.min(y))), min(1.05, float(np.max(y)) + 0.05))
ax.legend(frameon=False, labelspacing=0.35, handlelength=1.6, fontsize=9, loc="best")
ax.grid(alpha=0.12, linestyle="--", color=COLORS["grid"])
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
fig.tight_layout()
save(fig, "fig_q1_oc_curve_p1")
