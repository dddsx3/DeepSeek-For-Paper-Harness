"""fig_q4_ci_effect_on_cost —— 抽样不确定性下最优决策一致率的区间估计（森林图）

本图讲什么
    当零配件 / 成品次品率由抽样检测估计得到时（问题 4 口径），"重复抽样重解得到的
    最优决策"与"点估计下的最优决策"的一致率，是衡量决策稳健性的核心指标。只有
    一致率的点估计无法判断估计精度，故本图用森林图给出表 1 六种情况一致率的
    点估计与 95% 置信区间（正态近似：点估计 ± 1.96×标准误），并把区间半宽单独
    配对成条，直接读出"哪种情况的估计最稳"。

每个 panel 是什么
    (a) 森林图：横轴为决策一致率，六行分别对应表 1 情况 1-6；横线为 95% 置信区间
        （带端点帽），圆点为点估计，点径随精度 1/SE 放大（越准越大），竖虚线为
        完全一致参考线 1.0，每行右侧给出点估计数值。
    (b) 区间半宽 1.96×SE 的横条对照，与 (a) 逐行对齐、共用行序；最长条（情况 6）
        与最短条（情况 4/5）分别用语义色标出，用于比较估计精度。

数据来自账本哪些 id
    R-Q4-case{1..6}-consistency-rate     —— 六种情况的决策一致率点估计
    R-Q4-case{1..6}-consistency-rate-se  —— 对应标准误，用于合成 95% 置信区间
    全部数值经 load("results.json") 读入，脚本内不写死任何数据。

关键数值（由账本读入）
    一致率最高的情况 4 / 5（≈0.9995，区间最窄，估计最稳）；最低的情况 6
    （≈0.61，区间最宽），二者构成稳健性对照的两端。
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

# ------------------------------------------------------------------ 读账本
doc = load("results.json")
_rows = doc["results"] if isinstance(doc, dict) and "results" in doc else doc
led = {r["result_id"]: r["value"] for r in _rows}

CASES = ("1", "2", "3", "4", "5", "6")
rate = np.array([led["R-Q4-case%s-consistency-rate" % k] for k in CASES], dtype=float)
se = np.array([led["R-Q4-case%s-consistency-rate-se" % k] for k in CASES], dtype=float)

Z = 1.96                      # 正态近似临界值（统计常数，非账本数据）
half = Z * se                 # 区间半宽
low, high = rate - half, rate + half

y = np.arange(len(CASES), dtype=float)
ylabels = [cn("情况 %s" % k) for k in CASES]

# ------------------------------------------------------------------ 画布
fig, (ax1, ax2) = plt.subplots(
    1, 2, figsize=(6.0, 3.4), sharey=True,
    gridspec_kw={"width_ratios": [1.5, 1.0]},
)

# ----------------------------------------------------------- (a) 森林图
row_bg = _lighten(COLORS["gray"], 0.85)
for i in range(len(CASES)):
    if i % 2 == 0:
        ax1.axhspan(y[i] - 0.5, y[i] + 0.5, color=row_bg, zorder=0)

ax1.axvline(1.0, color=COLORS["ref_line"], linestyle="--", linewidth=1.2, zorder=1)

ax1.errorbar(rate, y, xerr=half, fmt="none", ecolor=COLORS["gray"],
             elinewidth=1.1, capsize=2.5, capthick=1.0, zorder=2)

prec = 1.0 / se
span = prec.max() - prec.min()
span = span if span > 0 else 1.0
msize = 26.0 + 54.0 * (prec - prec.min()) / span          # 点径 ∝ 精度 1/SE
ax1.scatter(rate, y, s=msize, color=PALETTE[0], zorder=3)

x_txt = max(high.max(), 1.0) + 0.014
for i in range(len(CASES)):
    ax1.text(x_txt, y[i], "%.4f" % rate[i], ha="left", va="center",
             fontsize=7, family="monospace", color=COLORS["gray"])

ax1.set_yticks(y)
ax1.set_yticklabels(ylabels, fontsize=8)
ax1.set_xlim(low.min() - 0.03, x_txt + 0.062)
ax1.set_xlabel(cn("决策一致率（无量纲）"), fontsize=8)
ax1.grid(axis="x", alpha=0.15, linestyle="--", color=COLORS["grid"])
ax1.invert_yaxis()

# ------------------------------------------------- (b) 区间半宽对照条
i_wide, i_narrow = int(np.argmax(half)), int(np.argmin(half))
bar_colors = [PALETTE[1]] * len(CASES)
bar_colors[i_narrow] = COLORS["up"]
bar_colors[i_wide] = COLORS["down"]

bars = ax2.barh(y, half, height=0.62, color=bar_colors, zorder=2)
ax2.bar_label(bars, fmt="%.4f", padding=2, fontsize=7, color=COLORS["gray"])

ax2.set_xlim(0.0, half.max() * 1.35)
ax2.set_xlabel(cn("区间半宽 1.96×SE（无量纲）"), fontsize=8)
ax2.grid(axis="x", alpha=0.15, linestyle="--", color=COLORS["grid"])
ax2.legend(handles=[Patch(facecolor=COLORS["up"], label=cn("区间最窄")),
                    Patch(facecolor=COLORS["down"], label=cn("区间最宽"))],
           loc="upper right", fontsize=6.5, frameon=False)

# ------------------------------------------------------------ 统一修饰
for ax in (ax1, ax2):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(axis="x", labelsize=7.5)

panel(ax1, "(a)")
panel(ax2, "(b)")

fig.tight_layout(pad=0.4)
save(fig, "fig_q4_ci_effect_on_cost")
