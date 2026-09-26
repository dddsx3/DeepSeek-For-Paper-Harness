"""fig_q2_optimal_cost_breakdown —— 情况 1 最优策略下单位合格成品的成本—利润口径分解（瀑布图）

本图讲什么：
    单面板瀑布图。首柱为账本给出的「每件合格成品的期望总成本」，第二柱是在其之上叠加的
    「最优期望利润」增量柱（浮动柱 bottom=总成本），末柱为两值相加得到的口径合计
    （单位成品收入口径，派生值只在脚本内相加，不写进题注）。增量柱以浅色带层叠延伸到
    右端，配阶梯虚线与圆点，柱顶给数值锚点，用于一眼看清成本与利润两块如何拼成收入口径。

数据来自账本（results.json，逐条读取，脚本内不写死任何数值）：
    R-Q2-case1-unit-cost = 34.319615912208505 元/件 → 首柱（期望总成本）
    R-Q2-case1-profit    = 21.680384087791495 元/件 → 第二柱增量（期望利润）
    末柱合计 = 上述两个 result_id 的读数在脚本内相加。

图型偏差（见 FIGURE_PLAN.plan_deviations）：
    账本没有采购／检测／装配／拆解／调换损失的分项条目，原「五段堆叠条形图」无法落数，
    故改用口径分解瀑布图。

面板：(无多面板) x = 口径节点，y = 元/件。
"""

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten
setup_style()

import json
import os

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

try:  # 与其余 gen_fig_*.py 共用同一账本读取入口，避免各脚本各写各的定位方式
    from _figbase import load_ledger  # type: ignore
except Exception:  # _figbase 尚未生成时回退到本地同构实现（候选路径与 ledger_source 对齐）
    def load_ledger():
        """按 FIGURE_PLAN.ledger_source 声明的相对位置逐候选查找账本，返回 {result_id: value}。"""
        here = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join("stages", "04-result-sources", "results.json"),
            "results.json",
            os.path.join("..", "..", "stages", "04-result-sources", "results.json"),
            os.path.join(here, "..", "..", "stages", "04-result-sources", "results.json"),
            os.path.join(here, "results.json"),
        ]
        for path in candidates:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as fh:
                    rows = json.load(fh)["results"]
                return {r["result_id"]: r["value"] for r in rows}
        raise FileNotFoundError("results.json 未找到，已尝试: %s" % candidates)


LEDGER = load_ledger()

unit_cost = float(LEDGER["R-Q2-case1-unit-cost"])   # 元/件，期望总成本
profit = float(LEDGER["R-Q2-case1-profit"])         # 元/件，期望利润
total = unit_cost + profit                          # 元/件，口径合计（脚本内派生）

labels = ["期望总成本", "＋期望利润", "合计（收入口径）"]
bottoms = [0.0, unit_cost, 0.0]
heights = [unit_cost, profit, total]
anchor_vals = [unit_cost, profit, total]
bar_colors = [PALETTE[0], COLORS["up"], PALETTE[0]]

n = len(labels)
x = np.arange(n)
half_w = 0.28  # 柱半宽，供连接线留缝

fig, ax = plt.subplots(figsize=(6.0, 3.6))
ax.grid(axis="y", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

# ── 色带层叠：总成本底层 + 利润增量层带（延伸到最右端，形成"层叠"隐喻）
ax.fill_between([x[0] - 0.5, x[-1] + 0.5], 0.0, unit_cost,
                alpha=0.06, color=PALETTE[0], zorder=0)
ax.fill_between([x[1] - 0.5, x[-1] + 0.5], unit_cost, total,
                alpha=0.15, color=COLORS["up"], zorder=1)
ax.plot([x[1], x[-1] + 0.5], [total, total],
        color=COLORS["up"], linewidth=0.7, linestyle="--", alpha=0.35, zorder=1)

# ── 柱体（第二柱为浮动增量柱）
bars = ax.bar(x, heights, bottom=bottoms, width=2 * half_w,
              color=bar_colors, edgecolor="white", linewidth=0.9, zorder=5)

# ── 阶梯连接线：从上一柱顶水平接到下一柱底/顶
ax.plot([x[0] + half_w, x[1] - half_w], [unit_cost, unit_cost],
        color=PALETTE[0], linewidth=1.2, linestyle="--", alpha=0.7, zorder=9)
ax.plot([x[1] + half_w, x[2] - half_w], [total, total],
        color=COLORS["up"], linewidth=1.2, linestyle="--", alpha=0.7, zorder=9)

# ── 圆点：标出每步的累计水位
for xi, level, col in zip(x, [unit_cost, total, total], bar_colors):
    ax.scatter(xi, level, color=col, s=46, zorder=11,
               edgecolors="white", linewidths=1.6)

# ── 数值标注：统一放在柱顶上方（va="bottom"），首尾有边框、中间无边框
tops = [b + h for b, h in zip(bottoms, heights)]
for xi, top, val, col in zip(x, tops, anchor_vals, bar_colors):
    is_end = (xi == x[0] or xi == x[-1])
    ax.text(xi, top + total * 0.018, f"{val:.2f}", ha="center", va="bottom",
            fontsize=8.5, fontweight="bold" if is_end else "normal", color=col,
            bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                      edgecolor=col if is_end else "none", alpha=0.9,
                      linewidth=0.5), zorder=12)

# ── 图例只承担口径命名，数值锚点已在柱顶给出，避免图面文字冗余
legend_patches = [
    mpatches.Patch(facecolor=_lighten(PALETTE[0], 0.4), edgecolor=PALETTE[0],
                   linewidth=1.2, label=labels[0]),
    mpatches.Patch(facecolor=_lighten(COLORS["up"], 0.4), edgecolor=COLORS["up"],
                   linewidth=1.2, label="增量：期望利润"),
    mpatches.Patch(facecolor="white", edgecolor=PALETTE[0],
                   linewidth=1.2, label=labels[2]),
]
legend = ax.legend(handles=legend_patches, loc="lower right", frameon=False,
                   labelspacing=0.35, handlelength=1.4, handleheight=1.0,
                   fontsize=8.0)
legend.set_zorder(15)

ax.set_xticks(x)
ax.set_xticklabels(labels, fontsize=9.0)
ax.set_xlabel("口径节点", fontsize=9.5)
ax.set_ylabel("元/件", fontsize=9.5)
ax.set_xlim(-0.7, n - 0.3)
ax.set_ylim(0.0, total * 1.16)
ax.tick_params(axis="y", labelsize=8.5)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
fig.tight_layout()
save_fig(fig, "figures/fig_q2_optimal_cost_breakdown.png")
