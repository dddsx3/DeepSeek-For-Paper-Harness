"""fig_q2_optimal_cost_breakdown —— 表 1 情况 1 最优策略下的单位合格成品经济性瀑布图

本图讲什么
----------
把账本中「每件合格成品的期望总成本」与「最优期望利润」两段拼成一条瀑布，
显示两段如何算术合成为单位售出口径的合计值；账本未提供采购 / 检测 / 装配 /
拆解 / 调换损失的分项金额，故本图不拆解成本成分，只做「成本—利润—合计」三段。

Panel 说明（单一 panel）
------------------------
  · 第 1 根柱「期望总成本」：从 0 升到成本值，取成本侧语义色；
  · 第 2 根柱「期望利润」：从成本值浮升到合计值，取收益侧语义色；
  · 第 3 根柱「合计（成本+利润）」：从 0 到合计值的总计柱，取主色；
  · 虚线连接线把上一步的落点与下一段的起点对齐，圆点标出每个口径项的落点；
  · 右上角方框给出合成合计值，图例给出两段对合计的占比（由图内两值算术得出）。

数据来自账本 results.json（每个数都从账本读，脚本内无任何硬编码数值）
--------------------------------------------------------------------
  R-Q2-case1-unit-cost → 期望总成本（元/件）
  R-Q2-case1-profit    → 最优期望利润（元/件）
  合计 = 上述两值之和（仅对账本两值做算术合成，不等同于题面给定的市场售价）。
"""

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

import json

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# ── 账本读取：图里出现的每一个数都来自 results.json ──────────────────────────
with open("results.json", "r", encoding="utf-8") as fh:
    LEDGER = {row["result_id"]: row for row in json.load(fh)["results"]}

cost = LEDGER["R-Q2-case1-unit-cost"]["value"]        # 期望总成本（元/件）
profit = LEDGER["R-Q2-case1-profit"]["value"]         # 最优期望利润（元/件）
total = cost + profit                                 # 合成合计（仅两值相加）

# ── 瀑布几何 ────────────────────────────────────────────────────────────────
labels = ["期望总成本", "期望利润", "合计（成本+利润）"]
values = [cost, profit, total]
bottoms = [0.0, cost, 0.0]        # 第 1 段自 0 起，第 2 段从成本落点浮升，第 3 段是总计柱
heights = [cost, profit, total]
levels = [cost, total, total]     # 每根柱的落点，供连接线 / 圆点 / 标注使用
bar_colors = [COLORS["down"], COLORS["up"], PALETTE[0]]

n = len(labels)
x = np.arange(n)

fig, ax = plt.subplots(figsize=(6.0, 3.6))
ax.grid(axis="y", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

# ── 色带层叠：成本段与利润段的增量色带延伸到最右侧，形成层次 ────────────────
ax.fill_between([x[0] - 0.5, x[-1] + 0.5], 0.0, cost,
                alpha=0.06, color=bar_colors[0], zorder=0)
ax.fill_between([x[1] - 0.5, x[-1] + 0.5], cost, total,
                alpha=0.15, color=bar_colors[1], zorder=1)
ax.plot([x[1] - 0.5, x[-1] + 0.5], [total, total],
        color=bar_colors[1], linewidth=0.7, linestyle="--", alpha=0.35, zorder=1)

# ── 主体柱 ──────────────────────────────────────────────────────────────────
ax.bar(x, heights, bottom=bottoms, width=0.56, color=bar_colors,
       edgecolor="white", linewidth=0.8, zorder=6)

# ── 台阶连接线：上一步落点接到下一段起点 ────────────────────────────────────
for i in range(1, n):
    ax.plot([x[i - 1] + 0.28, x[i] - 0.28], [levels[i - 1], levels[i - 1]],
            color=PALETTE[0], linewidth=1.4, linestyle="--", alpha=0.7, zorder=8)

# ── 落点圆点 ────────────────────────────────────────────────────────────────
for i in range(n):
    ax.scatter(x[i], levels[i], color=bar_colors[i], s=52, zorder=11,
               edgecolors="white", linewidths=1.4)

# ── 数值标注：统一放在落点上方，首尾带边框、中间白底无边框 ──────────────────
for i in range(n):
    ax.text(x[i], levels[i] + total * 0.02, f"{values[i]:.2f}",
            ha="center", va="bottom", fontsize=8.5,
            fontweight="bold" if i in (0, n - 1) else "normal",
            color=bar_colors[i],
            bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                      edgecolor=bar_colors[i] if i in (0, n - 1) else "none",
                      alpha=0.9, linewidth=0.5), zorder=12)

# ── 合成合计锚点（固定右上角，不受数据范围影响） ────────────────────────────
ax.text(0.97, 0.95, f"合计 {total:.2f} 元/件", transform=ax.transAxes,
        fontsize=8.5, ha="right", va="top", fontweight="bold", color=PALETTE[0],
        bbox=dict(boxstyle="round,pad=0.35", facecolor="white",
                  edgecolor=PALETTE[0], alpha=0.9, linewidth=1.0), zorder=15)

# ── 口径分解放进图例，避免色带中央的文字与连接线重叠 ────────────────────────
legend_patches = [
    mpatches.Patch(facecolor=_lighten(bar_colors[0], 0.45), edgecolor=bar_colors[0],
                   linewidth=1.2,
                   label=f"期望总成本  {cost:.2f} 元/件（占合成合计 {cost / total * 100:.1f}%）"),
    mpatches.Patch(facecolor=_lighten(bar_colors[1], 0.40), edgecolor=bar_colors[1],
                   linewidth=1.2,
                   label=f"期望利润  {profit:.2f} 元/件（占合成合计 {profit / total * 100:.1f}%）"),
]
legend = ax.legend(handles=legend_patches, loc="lower right", frameon=False,
                   labelspacing=0.35, handlelength=1.5, handleheight=1.0,
                   fontsize=7.5, title="口径分解", title_fontsize=8.0)
legend.set_zorder(15)

# ── 坐标轴 ──────────────────────────────────────────────────────────────────
ax.set_xticks(x)
ax.set_xticklabels(labels, fontsize=8.5)
ax.set_xlabel("口径项", fontsize=9)
ax.set_ylabel("金额（元/件）", fontsize=9)
ax.tick_params(axis="y", labelsize=8)
ax.set_xlim(-0.6, n - 0.4)
ax.set_ylim(0.0, total * 1.18)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.tight_layout()
save_fig(fig, "figures/fig_q2_optimal_cost_breakdown.png")
