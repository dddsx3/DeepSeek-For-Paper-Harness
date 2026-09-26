"""
fig_q4_monte_carlo_robustness —— 抽样估计不确定性下的决策稳健性（龙卷风排序 + 区间点图）

本图讲什么
----------
问题 4 把零配件与成品的次品率换成由抽样检测得到的估计值后重解问题 2，
六种情况的 0-1 决策是否还站得住，用「一致率」（重解决策与点估计决策相同的比例）
与「不一致率 1 − 一致率」来度量。

面板
----
(a) 龙卷风式横条：六种情况的决策不一致率 1 − 一致率，由大到小自上而下排列，
    条端标数值并叠加 10% 参考线；最长条即决策最易被抽样误差推翻的情形（强调色）。
(b) 一致率点估计 ± 95% 区间点图（区间由账本标准误按 ±1.96×SE 合成），
    叠加 0.95 稳健性阈值参考线；置信下界跌破 0.95 的情形以强调色标出。

数据来源（results.json 账本）
---------------------------
R-Q4-case1..6-consistency-rate     六种情况的一致率点估计
R-Q4-case1..6-consistency-rate-se  一致率估计量的标准误

关键数值（全部读自账本，脚本内不写死）
------------------------------------
一致率 0.6085 / 0.9160 / 0.9485 / 0.9920 / 0.9995 / 0.9995；
最易翻转的是情况 6（不一致率约 0.3915），最稳的是情况 4、5（不一致率约 0.0005）。
账本只有一致率与标准误两类条目，无重复抽样轨迹与利润分布，故不画收敛曲线。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
import numpy as np
import matplotlib.pyplot as plt

# ----------------------------------------------------------------------
# 取数：每一个数字都来自账本
# ----------------------------------------------------------------------
doc = load("results.json")
vals = {r["result_id"]: r["value"] for r in doc["results"]}

CASES = [1, 2, 3, 4, 5, 6]
rate = np.array([vals[f"R-Q4-case{k}-consistency-rate"] for k in CASES], dtype=float)
se = np.array([vals[f"R-Q4-case{k}-consistency-rate-se"] for k in CASES], dtype=float)
labels = [cn(f"情况 {k}") for k in CASES]

incons = 1.0 - rate          # 不一致率：决策被抽样误差推翻的比例
half = 1.96 * se             # 一致率的 95% 半宽

# 两个面板共用同一行序：不一致率由小到大 → 最长条落在图顶
order = np.argsort(incons)
y = np.arange(len(order))
incons_s = incons[order]
rate_s = rate[order]
half_s = half[order]
labels_s = [labels[i] for i in order]
i_worst = int(np.argmax(incons_s))

fig, (ax_a, ax_b) = plt.subplots(1, 2, figsize=(6.0, 3.6))

# ----------------------------------------------------------------------
# 面板 (a)：龙卷风排序横条（1 − 一致率）
# ----------------------------------------------------------------------
ax_a.grid(axis="x", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax_a.set_axisbelow(True)
for i in range(len(y)):
    if i % 2 == 0:
        ax_a.axhspan(y[i] - 0.45, y[i] + 0.45, alpha=0.04,
                     color=PALETTE[0], zorder=0)

span = incons_s.max() if incons_s.max() > 0 else 1.0
bars = []
for i, v in enumerate(incons_s):
    base = COLORS["accent"] if i == i_worst else PALETTE[0]
    lighten_amt = 0.45 * (1.0 - v / span)
    c = _lighten(base, lighten_amt)
    bars.append(ax_a.barh(y[i], v, height=0.55,
                          color=_lighten(c, 0.30), edgecolor=c,
                          linewidth=1.2, zorder=3))
for b in bars:
    ax_a.bar_label(b, fmt="%.4f", padding=2, fontsize=7.5,
                   color=COLORS["gray"])

ax_a.axvline(0.10, color=COLORS["ref_line"], linewidth=1.0,
             linestyle="--", zorder=4)
ax_a.text(0.10, len(y) - 0.42, cn("10%"), ha="center", va="bottom",
          fontsize=7.5, color=COLORS["ref_line"])
ax_a.text(incons_s[i_worst] * 0.5, y[i_worst] - 0.42, cn("最易翻转"),
          ha="center", va="top", fontsize=7.5, fontstyle="italic",
          color=COLORS["accent"])

ax_a.set_yticks(y)
ax_a.set_yticklabels(labels_s, fontsize=8.5)
ax_a.set_xlim(0.0, span * 1.30)
ax_a.set_ylim(-0.75, len(y) - 0.25)
ax_a.set_xlabel(cn("不一致率 1 − 一致率（无量纲）"), fontsize=9)
ax_a.spines["top"].set_visible(False)
ax_a.spines["right"].set_visible(False)
panel(ax_a, "(a)")

# ----------------------------------------------------------------------
# 面板 (b)：一致率点估计 ± 95% 区间
# ----------------------------------------------------------------------
ax_b.grid(axis="x", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax_b.set_axisbelow(True)
for i in range(len(y)):
    if i % 2 == 0:
        ax_b.axhspan(y[i] - 0.45, y[i] + 0.45, alpha=0.04,
                     color=PALETTE[0], zorder=0)

THRESH = 0.95
ax_b.axvline(THRESH, color=COLORS["ref_line"], linewidth=1.0,
             linestyle="--", zorder=2)
ax_b.text(THRESH, len(y) - 0.42, cn("0.95 阈值"), ha="center", va="bottom",
          fontsize=7.5, color=COLORS["ref_line"])

for i in range(len(y)):
    robust = (rate_s[i] - half_s[i]) >= THRESH
    c = PALETTE[1] if robust else COLORS["accent"]
    ax_b.errorbar(rate_s[i], y[i], xerr=half_s[i], fmt="o", ms=4.5,
                  color=c, ecolor=_lighten(c, 0.35), elinewidth=1.4,
                  capsize=3.5, zorder=3)

lo = float(np.min(rate_s - half_s))
hi = float(np.max(rate_s + half_s))
ax_b.set_xlim(lo - 0.05, hi + 0.05)
ax_b.set_ylim(-0.75, len(y) - 0.25)
ax_b.set_yticks(y)
ax_b.set_yticklabels(labels_s, fontsize=8.5)
ax_b.set_xlabel(cn("一致率（无量纲）"), fontsize=9)
ax_b.spines["top"].set_visible(False)
ax_b.spines["right"].set_visible(False)
panel(ax_b, "(b)")

fig.tight_layout()
save(fig, "fig_q4_monte_carlo_robustness")
