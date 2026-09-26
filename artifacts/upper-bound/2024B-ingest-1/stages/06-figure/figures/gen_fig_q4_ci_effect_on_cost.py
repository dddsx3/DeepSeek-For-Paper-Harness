"""
fig_q4_ci_effect_on_cost —— 问题 4 决策一致率的森林图（单面板）

本图讲什么
    表 1 六种情况在“次品率由抽样检测估计得到”的前提下，重复抽样重解所得最优
    决策与点估计决策的一致率及其 95% 置信区间。点估计取账本中的一致率条目，
    区间由对应标准误按 ±1.96×SE 对称构造，并在比例量的自然边界 [0, 1] 上截断。
    森林图把六种情况摆在同一水平刻度上比较：区间越靠左，说明该情况的最优决策
    在抽样误差下越不稳。情况 6 的一致率（0.6085）明显低于其余五种。

面板
    单面板。纵轴为表 1 的六种情况，横轴为一致率（比例）。
    每一行 = 一条 95% 置信区间（ax.hlines）+ 一个点估计标记（ax.errorbar）。
    点估计的置信区间触及上界 1 时标记画成中空（与“完全一致”无显著差异），
    否则画成实心；右侧数值列为“点估计 [下限, 上限]”。

数据来自账本（results.json）的哪些 id
    R-Q4-case1-consistency-rate / R-Q4-case1-consistency-rate-se
    R-Q4-case2-consistency-rate / R-Q4-case2-consistency-rate-se
    R-Q4-case3-consistency-rate / R-Q4-case3-consistency-rate-se
    R-Q4-case4-consistency-rate / R-Q4-case4-consistency-rate-se
    R-Q4-case5-consistency-rate / R-Q4-case5-consistency-rate-se
    R-Q4-case6-consistency-rate / R-Q4-case6-consistency-rate-se
    区间倍数 1.96 与截断边界 [0, 1] 取自本图规划条目的 ci_points.interval 声明。

关键数值（全部由账本条目算出，脚本中不写死任何数据）
    六种情况的一致率 0.9160 / 0.9485 / 0.9920 / 0.9995 / 0.9995 / 0.6085，
    对应区间半宽 1.96×SE 约 0.0122 / 0.0097 / 0.0039 / 0.0010 / 0.0010 / 0.0214。
"""

import json

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# ----------------------------------------------------------------------------
# 账本读取：图里的每一个数都必须来自 results.json
# ----------------------------------------------------------------------------
with open("results.json", "r", encoding="utf-8") as fh:
    _ledger = json.load(fh)
LEDGER = {rec["result_id"]: rec["value"] for rec in _ledger["results"]}


def ledger_value(result_id):
    """按 result_id 取账本数值，取不到就报错而不是悄悄兜底。"""
    if result_id not in LEDGER:
        raise KeyError("results.json 中缺少条目: %s" % result_id)
    return float(LEDGER[result_id])


# 行序 = 表 1 的情况 1..6；ref 对 (点估计, 标准误)
CI_ROWS = [
    ("情况1", "R-Q4-case1-consistency-rate", "R-Q4-case1-consistency-rate-se"),
    ("情况2", "R-Q4-case2-consistency-rate", "R-Q4-case2-consistency-rate-se"),
    ("情况3", "R-Q4-case3-consistency-rate", "R-Q4-case3-consistency-rate-se"),
    ("情况4", "R-Q4-case4-consistency-rate", "R-Q4-case4-consistency-rate-se"),
    ("情况5", "R-Q4-case5-consistency-rate", "R-Q4-case5-consistency-rate-se"),
    ("情况6", "R-Q4-case6-consistency-rate", "R-Q4-case6-consistency-rate-se"),
]

# 区间构造参数（来自规划条目 ci_points[*].interval 的声明）
MULTIPLIER = 1.96
CLIP_LO, CLIP_HI = 0.0, 1.0

labels, est, lo, hi = [], [], [], []
for label, rate_ref, se_ref in CI_ROWS:
    e = ledger_value(rate_ref)
    se = ledger_value(se_ref)
    labels.append(label)
    est.append(e)
    lo.append(max(CLIP_LO, min(CLIP_HI, e - MULTIPLIER * se)))
    hi.append(max(CLIP_LO, min(CLIP_HI, e + MULTIPLIER * se)))

est = np.array(est, dtype=float)
lo = np.array(lo, dtype=float)
hi = np.array(hi, dtype=float)

n = len(labels)
y = np.arange(n, dtype=float)          # 行位置：0 在最上，随 y 增大向下

# ----------------------------------------------------------------------------
# 画布：横向森林图，r = 3.6/6.0 = 0.60 落在 “r ≤ 0.80 → 宽 6.0in” 档位
# ----------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6.0, 3.6))

# 交替行阴影，帮助视线在标签与数值列之间横向对齐
for i in range(n):
    if i % 2 == 0:
        ax.axhspan(y[i] - 0.45, y[i] + 0.45, color=COLORS["bg_box"], zorder=0)

# 上界参考线：一致率的自然天花板 100%
ax.axvline(CLIP_HI, color=COLORS["ref_line"], linestyle=":", linewidth=1.0,
           alpha=0.75, zorder=1)

# 每行：置信区间线（ax.hlines）+ 点估计与端点帽（ax.errorbar）
for i in range(n):
    ax.hlines(y[i], lo[i], hi[i], color=COLORS["text"], linewidth=1.4,
              zorder=2)

    reaches_ceiling = hi[i] >= CLIP_HI - 1e-12
    face = "white" if reaches_ceiling else PALETTE[0]
    edge = COLORS["ref_line"] if reaches_ceiling else PALETTE[0]

    ax.errorbar(
        est[i], y[i],
        xerr=np.array([[est[i] - lo[i]], [hi[i] - est[i]]]),
        fmt="o",
        ecolor=COLORS["text"], elinewidth=1.4,
        capsize=3.5, capthick=1.2,
        markersize=7.0, markerfacecolor=face, markeredgecolor=edge,
        markeredgewidth=1.3, zorder=3,
    )

# 右侧数值列：点估计 [下限, 上限]
trans = ax.get_yaxis_transform()       # x 用轴分数，y 用数据坐标
for i in range(n):
    ax.text(1.04, y[i], "%.4f [%.4f, %.4f]" % (est[i], lo[i], hi[i]),
            transform=trans, ha="left", va="center",
            fontsize=7.5, fontfamily="monospace", color=COLORS["text"])
ax.text(1.04, -0.72, "一致率 [95% CI]", transform=trans,
        ha="left", va="center", fontsize=8.5, fontweight="bold",
        color=COLORS["text"])

# ----------------------------------------------------------------------------
# 坐标轴收尾
# ----------------------------------------------------------------------------
ax.set_yticks(y)
ax.set_yticklabels(labels, fontsize=9.5, color=COLORS["text"])
ax.tick_params(axis="y", length=0)
ax.set_xlim(CLIP_LO - 0.03, CLIP_HI + 0.03)
ax.set_ylim(n - 0.5, -1.0)             # 纵向翻转：情况 1 在最上
ax.set_xticks(np.arange(0.0, 1.01, 0.2))
ax.set_xticklabels(["%.1f" % v for v in np.arange(0.0, 1.01, 0.2)])
ax.set_xlabel("重解决策与点估计决策的一致率（比例）", fontsize=9.5)
ax.set_ylabel("表 1 情况", fontsize=9.5)

ax.grid(axis="x", alpha=0.15, linestyle="--")
ax.set_axisbelow(True)
for spine in ("top", "right", "left"):
    ax.spines[spine].set_visible(False)

# 右侧数值列需要留白，用固定边距而不是 tight_layout
fig.subplots_adjust(left=0.11, right=0.70, top=0.94, bottom=0.17)

save_fig(fig, "figures/fig_q4_ci_effect_on_cost.png")
