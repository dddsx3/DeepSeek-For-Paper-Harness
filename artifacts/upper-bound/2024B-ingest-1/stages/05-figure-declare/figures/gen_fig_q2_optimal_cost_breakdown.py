"""问题 2 表 1 情况 1 最优策略下的「成本 → 利润」瀑布图（单 panel，advanced 配方 6）。

本图讲什么
----------
把「售价口径的合格交付收入」拆成两段：先扣掉每件合格成品的期望总成本，落点即
最优期望利润。整条阶梯回答的是「最优策略下每件卖出去的钱，被成本吃掉多少、留下
多少」。本轮账本未铸出采购 / 检测 / 装配 / 拆解 / 调换损失五项成本分项，因此图中
**不虚构分项分解**，只呈现成本侧与利润侧的两段结构。

panel (a)
---------
起始柱  = 合格交付收入（= 期望总成本 + 最优期望利润，由两个账本数相减/相加派生）
扣减柱  = − 期望总成本（彩色层带 + 阶梯连线）
终值柱  = 最优期望利润（落点）

数据来自账本（results.json）
---------------------------
  R-Q2-case1-unit-cost  情况 1 最优策略下每件合格成品的期望总成本（元/件）
  R-Q2-case1-profit     情况 1 最优期望利润（元/件）
两个数均由 load("results.json") 读出，脚本内不写死任何数值。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# ── 账本取数（data_refs 里的 result_id 即键） ───────────────────────────────
doc = load("results.json")
records = doc["results"] if isinstance(doc, dict) else doc
ledger = {r["result_id"]: r["value"] for r in records}

unit_cost = float(ledger["R-Q2-case1-unit-cost"])
profit = float(ledger["R-Q2-case1-profit"])
revenue = unit_cost + profit                      # 售价口径的合格交付收入（派生）

levels = np.array([revenue, profit, profit], dtype=float)   # 每一步的累积水平
deltas = np.array([revenue, -unit_cost, 0.0], dtype=float)  # 每一步的增量贡献

n = len(levels)
x = np.arange(n)
labels = [cn("合格交付收入"), cn("− 期望总成本"), cn("最优期望利润")]

down_c = COLORS["down"]
pad = revenue * 0.02

fig, ax = plt.subplots(figsize=(6.0, 3.4))
ax.grid(axis="y", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

# ── 色带层叠：收入底层 + 成本扣减层 ─────────────────────────────────────────
ax.fill_between([x[0] - 0.5, x[-1] + 0.5], 0.0, levels[0],
                alpha=0.06, color=PALETTE[0], zorder=0)
ax.fill_between([x[1] - 0.5, x[-1] + 0.5], levels[1], levels[0],
                alpha=0.15, color=down_c, zorder=2)
ax.plot([x[1] - 0.5, x[-1] + 0.5], [levels[1], levels[1]],
        color=down_c, linewidth=0.7, linestyle="--", alpha=0.35, zorder=2)

# ── 终值柱（落地利润） ─────────────────────────────────────────────────────
ax.bar(x[2], levels[2], width=1.0, color=_lighten(PALETTE[0], 0.55),
       edgecolor=PALETTE[0], linewidth=1.1, zorder=3)

# ── 阶梯连线 + 圆点 ────────────────────────────────────────────────────────
ax.step(x, levels, where="mid", color=PALETTE[0], linewidth=2.8, zorder=10)
for i in range(n):
    c = down_c if i == 1 else PALETTE[0]
    ax.scatter(x[i], levels[i], color=c, s=90, zorder=11,
               edgecolors="white", linewidths=2.0)

# ── 数值标注：统一放在圆点上方，首尾端点带边框 ─────────────────────────────
anchor_texts = [f"{revenue:.2f}", f"-{unit_cost:.2f}", f"{profit:.2f}"]
for i in range(n):
    c = down_c if i == 1 else PALETTE[0]
    edge = c if i in (0, n - 1) else "none"
    ax.text(x[i], levels[i] + pad, anchor_texts[i], ha="center", va="bottom",
            fontsize=8.5, fontweight="bold" if i in (0, n - 1) else "normal",
            color=c,
            bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                      edgecolor=edge, alpha=0.9, linewidth=0.5), zorder=12)

# ── 右上角口径框：利润率（派生量，不受数据范围影响） ───────────────────────
ax.text(0.97, 0.95, cn("利润率") + f" {profit / revenue * 100:.1f}%",
        transform=ax.transAxes, fontsize=9.5, ha="right", va="top",
        fontweight="bold", color=COLORS["up"],
        bbox=dict(boxstyle="round,pad=0.4", facecolor="white",
                  edgecolor=COLORS["up"], alpha=0.9, linewidth=1.0), zorder=15)

# ── 贡献信息放图例（避免与层带 / 阶梯线重叠） ─────────────────────────────
legend_patches = [
    mpatches.Patch(facecolor=_lighten(PALETTE[0], 0.4), edgecolor=PALETTE[0],
                   linewidth=1.2,
                   label=cn("收入（成本+利润）") + f"  {revenue:.2f}"),
    mpatches.Patch(facecolor=_lighten(down_c, 0.4), edgecolor=down_c,
                   linewidth=1.2,
                   label=cn("扣减 期望总成本") + f"  -{unit_cost:.2f}"),
    mpatches.Patch(facecolor=_lighten(PALETTE[0], 0.55), edgecolor=PALETTE[0],
                   linewidth=1.2,
                   label=cn("落点 最优期望利润") + f"  {profit:.2f}"),
]
legend = ax.legend(handles=legend_patches, loc="lower right", frameon=False,
                   labelspacing=0.35, handlelength=1.5, handleheight=1.0,
                   fontsize=8.5, facecolor="white",
                   title=cn("元/件"), title_fontsize=9)
legend.set_zorder(15)

# ── 坐标轴 ─────────────────────────────────────────────────────────────────
ax.set_xticks(x)
ax.set_xticklabels(labels, fontsize=9.5)
ax.set_ylabel(cn("金额（元/件）"), fontsize=10.5)
ax.set_xlabel(cn("成本与利润构成项"), fontsize=10.5)
ax.set_xlim(-0.7, n - 0.3)
ax.set_ylim(0.0, revenue * 1.18)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
panel(ax, "(a)")
fig.tight_layout()

save(fig, "fig_q2_optimal_cost_breakdown")
