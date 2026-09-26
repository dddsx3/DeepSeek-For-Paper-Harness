"""fig_q4_ci_effect_on_cost —— 问题 4 重解决策一致率及其不确定性的森林图合成面板。

本图讲什么
    在“次品率由抽样检测得到”的口径下，重复抽样并重解问题 2，所得最优决策与点估计
    决策的一致率有多高、这个一致率本身有多准。一致率越低且标准误越大，说明该情况对
    抽样波动越敏感、决策越容易被翻转。

每个 panel 是什么
    (a) 森林图：表 1 六种情况的一致率点估计与 95% 置信区间（点估计 ± 1.96×标准误），
        虚线为“完全一致”参考线（=1.0），交替行阴影，另用短标签锚出最低与最高情况。
    (b) 标准误排序条形图：六种情况的标准误由大到小排列，最大值以强调色标出，
        数值直接标在条端，反映重解决策的抽样稳定性。

数据来自账本哪些 id（stages/04-result-sources/results.json，经 _figbase.load 读取）
    R-Q4-case1-consistency-rate / -se … R-Q4-case6-consistency-rate / -se，共 12 个条目；
    脚本内不出现任何数值字面量式的数据，全部经 result_id 取值。

关键表达
    x 轴为决策一致率（比例，0–1 语义，参考线取 1.0）；条形图 x 轴为一致率标准误。
"""

import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

# ---------------------------------------------------------------- 账本读取
doc = load("results.json")
rows = doc["results"] if isinstance(doc, dict) and "results" in doc else doc
V = {r["result_id"]: r["value"] for r in rows}

CASES = [1, 2, 3, 4, 5, 6]
RATE_IDS = ["R-Q4-case%d-consistency-rate" % k for k in CASES]
SE_IDS = ["R-Q4-case%d-consistency-rate-se" % k for k in CASES]

rates = np.asarray([V[i] for i in RATE_IDS], dtype=float)
ses = np.asarray([V[i] for i in SE_IDS], dtype=float)
half = 1.96 * ses
lo, hi = rates - half, rates + half
labels = ["情况 %d" % k for k in CASES]

# ---------------------------------------------------------------- 画布
fig, (ax, axb) = plt.subplots(
    1, 2, figsize=(6.0, 2.8), gridspec_kw={"width_ratios": [1.55, 1.0]}
)

# ================================================== (a) 一致率森林图
y = np.arange(len(CASES), dtype=float)

# 交替行阴影（偶数行）
for i in range(len(CASES)):
    if i % 2 == 0:
        ax.axhspan(
            y[i] - 0.5, y[i] + 0.5,
            color=_lighten(COLORS["gray"], 0.88), zorder=0,
        )

# “完全一致”参考线
ax.axvline(1.0, color=COLORS["ref_line"], linestyle="--", linewidth=1.0, zorder=1)

# 点估计 + 95% 置信区间（森林图主体）
ax.errorbar(
    rates, y, xerr=half,
    fmt="o", color=PALETTE[0], ecolor=PALETTE[0],
    elinewidth=1.2, capsize=2.5, markersize=5.0,
    markeredgecolor="white", markeredgewidth=0.8, zorder=3,
)

ax.set_yticks(y)
ax.set_yticklabels(labels, fontsize=8)
ax.invert_yaxis()
ax.set_xlabel("决策一致率（比例）", fontsize=9)
ax.set_xlim(float(np.min(lo)) - 0.05, float(np.max(hi)) + 0.06)
ax.grid(axis="x", alpha=0.15, linestyle="--", color=COLORS["grid"])
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.tick_params(axis="x", labelsize=8)

# 仅两个数据锚点短标签：最低与最高情况
i_min = int(np.argmin(rates))
i_max = int(np.argmax(rates))
ax.annotate(
    "%.4f" % rates[i_min],
    xy=(rates[i_min], y[i_min]), xytext=(0, -13),
    textcoords="offset points", ha="center", va="top",
    fontsize=7.5, color=COLORS["down"], zorder=4,
)
ax.annotate(
    "%.4f" % rates[i_max],
    xy=(rates[i_max], y[i_max]), xytext=(0, 13),
    textcoords="offset points", ha="center", va="bottom",
    fontsize=7.5, color=COLORS["up"], zorder=4,
)
panel(ax, "(a)")

# ================================================== (b) 标准误排序
order = np.argsort(ses)[::-1]  # 由大到小
bar_y = np.arange(len(CASES), dtype=float)
bar_c = [
    COLORS["accent"] if i == 0 else _lighten(PALETTE[0], 0.35)
    for i in range(len(order))
]
bars = axb.barh(bar_y, ses[order], height=0.62, color=bar_c, zorder=2)

axb.set_yticks(bar_y)
axb.set_yticklabels([labels[k] for k in order], fontsize=8)
axb.invert_yaxis()
axb.set_xlabel("一致率标准误", fontsize=9)
axb.set_xlim(0.0, float(np.max(ses)) * 1.38)
axb.grid(axis="x", alpha=0.15, linestyle="--", color=COLORS["grid"])
axb.spines["top"].set_visible(False)
axb.spines["right"].set_visible(False)
axb.tick_params(axis="x", labelsize=8)
axb.bar_label(bars, fmt="%.4f", padding=2, fontsize=7)
panel(axb, "(b)")

fig.tight_layout()
save(fig, "fig_q4_ci_effect_on_cost")
