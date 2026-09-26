"""
fig_q3_strategy_cost_compare —— 问题 3 两工序八零配件实例 与 问题 2 表 1 六情况 的单位成品期望利润量级对照

本图讲什么：
    把问题 3 的组装树实例（图 1 / 表 2）在最优节点级决策下的单位成品期望利润，与问题 2 表 1 六种情况
    的最优期望利润放在同一把尺子上，检验"工序数 / 零配件数增加后，单位成品期望利润的量级是否仍与之可比"。

面板：
    (a) 单面板棒棒糖图（lollipop）：纵轴为实例 / 情况（按利润降序排列），横轴为单位成品期望利润（元/件）。
        茎线自 x = 0 起；端点圆点大小、茎线粗细随数值线性渐变；前三名带排名徽章；中位数参考线 + 中位数短标签。

数据来源（全部经 load("results.json") 从账本读入，脚本内无任何硬编码数值）：
    R-Q3-profit          问题 3 组装树实例最优单位成品期望利润
    R-Q2-case1-profit    问题 2 表 1 情况 1 最优期望利润
    R-Q2-case2-profit    问题 2 表 1 情况 2 最优期望利润
    R-Q2-case3-profit    问题 2 表 1 情况 3 最优期望利润
    R-Q2-case4-profit    问题 2 表 1 情况 4 最优期望利润
    R-Q2-case5-profit    问题 2 表 1 情况 5 最优期望利润
    R-Q2-case6-profit    问题 2 表 1 情况 6 最优期望利润

口径说明：问题 2 与问题 3 全程使用同一"单位成品期望利润（元/件）"口径，故可直接横向比较量级。
本轮账本未铸出问题 3 的节点级决策与成本分项（R-Q3-node-decision-* / R-Q3-cost-*），故本图如实退化为
量级对照，不虚构节点级数值。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import colorsys
import matplotlib.colors as mc
import numpy as np
import matplotlib.pyplot as plt

# ── 账本读取：单一入口，全部数值来自 results.json ─────────────────────────────
doc = load("results.json")
_recs = doc["results"] if isinstance(doc, dict) and "results" in doc else doc
V = {r["result_id"]: r["value"] for r in _recs}

# ── 条目定义：仅含 result_id 与类目名（类目名不是数值数据） ────────────────────
ITEMS = [
    ("R-Q3-profit", cn("问题 3 实例")),
    ("R-Q2-case1-profit", cn("表 1 情况 1")),
    ("R-Q2-case2-profit", cn("表 1 情况 2")),
    ("R-Q2-case3-profit", cn("表 1 情况 3")),
    ("R-Q2-case4-profit", cn("表 1 情况 4")),
    ("R-Q2-case5-profit", cn("表 1 情况 5")),
    ("R-Q2-case6-profit", cn("表 1 情况 6")),
]

# ── 按数值降序排列（排序键取自账本） ──────────────────────────────────────────
pairs = sorted(((lab, float(V[rid])) for rid, lab in ITEMS), key=lambda t: -t[1])
labels = [p[0] for p in pairs]
scores = np.asarray([p[1] for p in pairs], dtype=float)
n = len(scores)

s_min, s_max = float(scores.min()), float(scores.max())
s_range = (s_max - s_min) if s_max > s_min else 1.0


def _interp(c1, c2, t):
    """HSL 空间线性插值，t=0 返回 c1，t=1 返回 c2；返回 hex 串。"""
    r1, g1, b1 = mc.to_rgb(c1)
    r2, g2, b2 = mc.to_rgb(c2)
    h1, l1, s1 = colorsys.rgb_to_hls(r1, g1, b1)
    h2, l2, s2 = colorsys.rgb_to_hls(r2, g2, b2)
    if abs(h2 - h1) > 0.5:
        if h1 < h2:
            h1 += 1.0
        else:
            h2 += 1.0
    h = (h1 + (h2 - h1) * t) % 1.0
    l = l1 + (l2 - l1) * t
    s = s1 + (s2 - s1) * t
    return mc.to_hex(colorsys.hls_to_rgb(h, l, s))


item_colors = [
    _interp(PALETTE[0], PALETTE[3], i / (n - 1) if n > 1 else 0.0) for i in range(n)
]

# ── 画布：长宽比 4.2/6.0 = 0.70 ≤ 0.80 → 宽 6.0in（与 FIGURE_PLAN figsize 一致）──
fig, ax = plt.subplots(figsize=(6.0, 4.2))
y_pos = np.arange(n)

ax.grid(axis="x", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

# 中位数参考线（判据线，置于底层）
median_val = float(np.median(scores))
ax.axvline(median_val, color=COLORS["ref_line"], linestyle=":",
           linewidth=1.0, alpha=0.55, zorder=1)

# 主体：渐变茎线 + 渐变端点 + 排名徽章
for i, s in enumerate(scores):
    c = item_colors[i]
    ratio = (s - s_min) / s_range
    lw = 1.6 + 2.2 * ratio

    ax.hlines(y_pos[i], 0.0, s, color=c, linewidth=lw, zorder=3)

    ax.scatter(s, y_pos[i], color=c, s=55 + 130 * ratio, zorder=5,
               edgecolors="white", linewidths=1.8)

    ax.text(s + s_range * 0.028, y_pos[i], f"{s:.2f}",
            fontsize=8.0, fontweight="bold" if i < 3 else "normal",
            color=c, va="center", ha="left", zorder=6)

    badge_x = -s_range * 0.062
    rank = i + 1
    if rank <= 3:
        ax.text(badge_x, y_pos[i], str(rank), fontsize=8.0, fontweight="bold",
                color="white", ha="center", va="center", zorder=7,
                bbox=dict(boxstyle="circle,pad=0.30",
                          facecolor=_lighten(c, 0.15), edgecolor="none"))
    else:
        ax.text(badge_x, y_pos[i], str(rank), fontsize=7.5, fontweight="bold",
                color=_lighten(c, 0.20), ha="center", va="center", zorder=7)

# 第一名背景高亮条
ax.axhspan(y_pos[0] - 0.40, y_pos[0] + 0.40, alpha=0.06,
           color=item_colors[0], zorder=0)

# 中位数短标签（图内仅此一处数值锚点，≤1 行）
ax.text(median_val, -0.86, cn(f"中位数 {median_val:.2f}"),
        fontsize=7.8, color=COLORS["ref_line"], ha="center", va="center",
        zorder=8,
        bbox=dict(boxstyle="round,pad=0.25", facecolor="white",
                  edgecolor=COLORS["ref_line"], alpha=0.85, linewidth=0.8))

ax.set_yticks(y_pos)
ax.set_yticklabels(labels, fontsize=9)
ax.set_xlabel(cn("单位成品期望利润（元/件）"), fontsize=10)

ax.set_xlim(-s_range * 0.13, s_max + s_range * 0.15)
ax.set_ylim(n - 0.5, -1.25)

ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

panel(ax, "(a)")

fig.tight_layout()
save(fig, "fig_q3_strategy_cost_compare")
