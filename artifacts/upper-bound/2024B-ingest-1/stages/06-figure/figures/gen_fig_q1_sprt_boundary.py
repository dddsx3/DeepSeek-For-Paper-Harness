"""
绘制问题1的SPRT对数似然比决策边界。
(a) 展示接受边界、拒收边界及二者之间的继续抽样区。
(b) 展示继续抽样区宽度随累计抽样件数的变化。
全部坐标、边界端点及备择假设参数来自账本中的
R-Q1-sprt-m、R-Q1-sprt-accept-line、R-Q1-sprt-reject-line、
R-Q1-nominal-p 与 R-Q1-p-alt。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import numpy as np
import matplotlib.pyplot as plt


doc = load("results.json")
ledger = {item["result_id"]: item["value"] for item in doc["results"]}

m = np.asarray(ledger["R-Q1-sprt-m"], dtype=float)
accept = np.asarray(ledger["R-Q1-sprt-accept-line"], dtype=float)
reject = np.asarray(ledger["R-Q1-sprt-reject-line"], dtype=float)
p0 = float(ledger["R-Q1-nominal-p"])
p1 = float(ledger["R-Q1-p-alt"])

if not (m.size == accept.size == reject.size):
    raise ValueError("SPRT横轴与两条边界序列长度不一致")
if np.any(np.diff(m) <= 0):
    raise ValueError("SPRT累计抽样件数序列必须严格递增")
if not p0 < p1:
    raise ValueError("备择次品率必须高于标称次品率")

gap = reject - accept
mark_every = max(1, m.size // 10)

fig, (ax_boundary, ax_gap) = plt.subplots(
    1,
    2,
    figsize=(6.0, 2.8),
    gridspec_kw={"width_ratios": [1.35, 1.0]},
)

continuation_color = _lighten(COLORS["up"], 0.88)
ax_boundary.fill_between(
    m,
    accept,
    reject,
    color=continuation_color,
    alpha=0.32,
    linewidth=0,
    label=cn("继续抽样区"),
    zorder=1,
)
ax_boundary.plot(
    m,
    accept,
    color=COLORS["up"],
    linewidth=2.2,
    marker="o",
    markersize=3.4,
    markevery=mark_every,
    markeredgecolor="white",
    markeredgewidth=0.7,
    label=cn("接受边界"),
    zorder=3,
)
ax_boundary.plot(
    m,
    reject,
    color=COLORS["down"],
    linewidth=2.2,
    linestyle="--",
    marker="s",
    markersize=3.4,
    markevery=mark_every,
    markeredgecolor="white",
    markeredgewidth=0.7,
    label=cn("拒收边界"),
    zorder=3,
)

accept_extreme = int(np.argmax(accept))
is_late = accept_extreme > m.size / 2
ax_boundary.scatter(
    m[accept_extreme],
    accept[accept_extreme],
    s=70,
    marker="*",
    color=COLORS["up"],
    edgecolor="white",
    linewidth=1.0,
    zorder=4,
)
ax_boundary.annotate(
    cn(f"★ {accept[accept_extreme]:.2f}"),
    xy=(m[accept_extreme], accept[accept_extreme]),
    xytext=(-8 if is_late else 8, 18),
    textcoords="offset points",
    ha="right" if is_late else "left",
    fontsize=7.5,
    fontweight="bold",
    color=COLORS["up"],
    arrowprops={
        "arrowstyle": "->",
        "color": COLORS["up"],
        "lw": 1.0,
    },
    bbox={
        "boxstyle": "round,pad=0.22",
        "facecolor": "white",
        "edgecolor": COLORS["up"],
        "alpha": 0.92,
    },
)

ax_boundary.set_xlabel(cn("累计抽样件数 m（件）"))
ax_boundary.set_ylabel(cn("对数似然比边界 ln(L₁/L₀)"))
ax_boundary.legend(
    title=cn(f"p₀={p0:.1%}，p₁={p1:.1%}"),
    frameon=False,
    fontsize=7.5,
    title_fontsize=8,
    labelspacing=0.35,
    handlelength=1.8,
    loc="best",
)
ax_boundary.grid(
    True,
    alpha=0.14,
    linestyle="--",
    linewidth=0.7,
    color=COLORS["grid"],
)
ax_boundary.margins(x=0.02, y=0.12)
panel(ax_boundary, "(a)")

ax_gap.fill_between(
    m,
    np.zeros_like(gap),
    gap,
    color=_lighten(PALETTE[2], 0.78),
    alpha=0.28,
    linewidth=0,
    zorder=1,
)
ax_gap.plot(
    m,
    gap,
    color=PALETTE[2],
    linewidth=2.1,
    marker="o",
    markersize=3.2,
    markevery=mark_every,
    markeredgecolor="white",
    markeredgewidth=0.7,
    zorder=3,
)

gap_extreme = int(np.argmax(gap))
gap_is_late = gap_extreme > m.size / 2
ax_gap.scatter(
    m[gap_extreme],
    gap[gap_extreme],
    s=65,
    marker="*",
    color=PALETTE[2],
    edgecolor="white",
    linewidth=1.0,
    zorder=4,
)
ax_gap.annotate(
    cn(f"★ Δmax={gap[gap_extreme]:.2f}"),
    xy=(m[gap_extreme], gap[gap_extreme]),
    xytext=(-8 if gap_is_late else 8, 16),
    textcoords="offset points",
    ha="right" if gap_is_late else "left",
    fontsize=7.5,
    fontweight="bold",
    color=PALETTE[2],
    arrowprops={
        "arrowstyle": "->",
        "color": PALETTE[2],
        "lw": 1.0,
    },
    bbox={
        "boxstyle": "round,pad=0.22",
        "facecolor": "white",
        "edgecolor": PALETTE[2],
        "alpha": 0.92,
    },
)

ax_gap.set_xlabel(cn("累计抽样件数 m（件）"))
ax_gap.set_ylabel(cn("继续抽样带宽 Δ(m)"))
ax_gap.grid(
    True,
    alpha=0.14,
    linestyle="--",
    linewidth=0.7,
    color=COLORS["grid"],
)
ax_gap.margins(x=0.02, y=0.18)
panel(ax_gap, "(b)")

for ax in (ax_boundary, ax_gap):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

fig.tight_layout(w_pad=1.4)
save(fig, "fig_q1_sprt_boundary")
