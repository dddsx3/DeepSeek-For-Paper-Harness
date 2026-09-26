"""
fig_q2_six_cases_decisions —— 问题 2 表 1 六种情况最优期望利润对照。

本图讲什么
    表 1 的六种情况（零配件/成品次品率、购买单价、检测成本、拆解费用、调换损失
    的不同组合）在各自最优决策 (Z1, Z2, C, D) 下折出的“单位成品最优期望利润”，
    并给出各情况相对基准情况 1 的增减幅度，用于判读参数变化对最优策略收益的
    影响方向与量级。

每个 panel 是什么
    (a) 六情况最优期望利润柱状图（元/件）：柱高即账本读数，最高利润柱用主色
        实心高亮、其余为同族浅色，柱顶标数值。
    (b) 各情况相对情况 1 的利润差值发散柱：基线为零（情况 1 自身差值为 0），
        下降用 COLORS["down"]、上升用 COLORS["up"]，柱顶带符号标数值。

数据来自账本哪些 id
    R-Q2-case1-profit / R-Q2-case2-profit / R-Q2-case3-profit /
    R-Q2-case4-profit / R-Q2-case5-profit / R-Q2-case6-profit
    —— 两个 panel 的全部柱高都由这些读数派生（panel b 为两账本值之差），
    脚本内不含任何字面量数据，也不含扫描/拟合数据。
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

from _figbase import load, save, panel, PALETTE, COLORS, _lighten

CASE_IDS = [
    "R-Q2-case1-profit",
    "R-Q2-case2-profit",
    "R-Q2-case3-profit",
    "R-Q2-case4-profit",
    "R-Q2-case5-profit",
    "R-Q2-case6-profit",
]
CASE_LABELS = ["情况1", "情况2", "情况3", "情况4", "情况5", "情况6"]

doc = load("results.json")
ledger = {rec["result_id"]: rec["value"] for rec in doc["results"]}

profit = np.array([ledger[key] for key in CASE_IDS], dtype=float)
delta = profit - profit[0]          # 相对情况 1 的差值，由账本两数相减派生
x = np.arange(profit.size)

fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8))

# ---- panel (a) 六情况最优期望利润 -------------------------------------------
ax = axes[0]
best = int(np.argmax(profit))
bar_colors = [_lighten(PALETTE[0], 0.60)] * profit.size
bar_colors[best] = PALETTE[0]       # 主色留给最高利润柱
bars = ax.bar(
    x, profit, width=0.66,
    color=bar_colors, edgecolor=PALETTE[0], linewidth=0.8, zorder=3,
)
ax.bar_label(bars, fmt="%.2f", padding=2, fontsize=6.5, color=COLORS["gray"])
ax.annotate(
    "★", xy=(x[best], profit[best]), xytext=(0, 12),
    textcoords="offset points", ha="center", va="bottom",
    fontsize=7, color=COLORS["highlight"],
)

ax.set_xticks(x)
ax.set_xticklabels(CASE_LABELS, fontsize=7)
ax.set_xlabel("表 1 情况", fontsize=8)
ax.set_ylabel("最优期望利润（元/件）", fontsize=8)
ax.set_ylim(0.0, profit.max() * 1.20)
ax.tick_params(axis="y", labelsize=7)

# ---- panel (b) 相对情况 1 的利润差值发散柱 -----------------------------------
ax2 = axes[1]
delta_colors = [
    COLORS["up"] if d > 0 else (COLORS["down"] if d < 0 else COLORS["gray"])
    for d in delta
]
bars2 = ax2.bar(
    x, delta, width=0.66,
    color=[_lighten(c, 0.55) for c in delta_colors],
    edgecolor=delta_colors, linewidth=0.8, zorder=3,
)
ax2.axhline(0.0, color=COLORS["ref_line"], linewidth=0.9,
            linestyle="--", zorder=2)
ax2.bar_label(bars2, fmt="%+.2f", padding=2, fontsize=6.5, color=COLORS["gray"])

d_hi = max(float(delta.max()), 0.0)
d_lo = min(float(delta.min()), 0.0)
pad = 0.24 * (d_hi - d_lo) if d_hi > d_lo else 1.0
ax2.set_ylim(d_lo - pad, d_hi + pad)

ax2.set_xticks(x)
ax2.set_xticklabels(CASE_LABELS, fontsize=7)
ax2.set_xlabel("表 1 情况", fontsize=8)
ax2.set_ylabel("相对情况 1 的利润差值（元/件）", fontsize=8)
ax2.tick_params(axis="y", labelsize=7)
ax2.legend(
    handles=[
        Patch(facecolor=_lighten(COLORS["up"], 0.55),
              edgecolor=COLORS["up"], label="高于情况 1"),
        Patch(facecolor=_lighten(COLORS["down"], 0.55),
              edgecolor=COLORS["down"], label="低于情况 1"),
    ],
    fontsize=6.5, frameon=False, loc="lower left", handlelength=1.2,
)

# ---- 公共轴样式 --------------------------------------------------------------
for a in (ax, ax2):
    for side in ("top", "right"):
        a.spines[side].set_visible(False)
    a.grid(axis="y", color=COLORS["grid"], linewidth=0.6, alpha=0.6, zorder=0)
    a.set_axisbelow(True)

panel(ax, "(a)")
panel(ax2, "(b)")
fig.tight_layout(pad=0.4, w_pad=1.6)

save(fig, "fig_q2_six_cases_decisions")
