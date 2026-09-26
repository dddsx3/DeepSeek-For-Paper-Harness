"""图 fig_q2_six_cases_decisions：表 1 六种情况在各自最优决策下的单位成品期望利润对照。

本图讲什么
----------
单一 panel（无子图）的柱状图：
- x 轴为表 1 的六种情况，刻度为两行文本「情况k」+ 该情况的最优决策组合
  (Z1, Z2, C, D)；四位 0-1 指示逐个由账本决策条目读取后拼装，不靠命名字符串猜测；
- y 轴为该情况在最优决策下的单位成品期望利润（元/件），柱顶直标利润数值；
- 利润最高的情况用高亮配色 + ★ 标出，另有一条水平虚线给出六情况利润的算术均值。

数据来自账本
------------
- 柱高：R-Q2-case{k}-profit（k = 1..6），共 6 条；
- 刻度上的决策组合：R-Q2-case{k}-decision-{Z1,Z2,C,D}（k = 1..6），共 24 条。
全部数值在运行时从 results.json 读取，脚本内不出现任何写死的数值字面量。

关键数值（账本给出，脚本不写死）
--------------------------------
六情况利润依次约 21.68、13.81、19.80、15.88、18.94、21.68 元/件；
最高为情况 1 与情况 6（★），最低为情况 2。
"""

import json

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# ---------------------------------------------------------------- 账本引用
CASE_IDS = ["case1", "case2", "case3", "case4", "case5", "case6"]
PROFIT_REFS = ["R-Q2-{}-profit".format(c) for c in CASE_IDS]
DECISION_KEYS = ["Z1", "Z2", "C", "D"]
DECISION_REFS = [
    ["R-Q2-{}-decision-{}".format(c, k) for k in DECISION_KEYS] for c in CASE_IDS
]

with open("results.json", encoding="utf-8") as fh:
    ledger = json.load(fh)
records = ledger["results"] if isinstance(ledger, dict) else ledger
VALUE = {rec["result_id"]: rec["value"] for rec in records}

profits = np.array([float(VALUE[ref]) for ref in PROFIT_REFS])

# 刻度标签：情况{k}\n({Z1},{Z2},{C},{D})，四位指示逐个来自账本
tick_labels = []
for idx, refs in enumerate(DECISION_REFS):
    code = "(" + ",".join(str(int(round(float(VALUE[r])))) for r in refs) + ")"
    tick_labels.append("情况{}\n{}".format(idx + 1, code))

best_mask = np.isclose(profits, profits.max(), rtol=0.0, atol=1e-3)
mean_profit = float(profits.mean())

# ---------------------------------------------------------------- 绘图
fig, ax = plt.subplots(figsize=(6.0, 4.2))

x = np.arange(len(CASE_IDS))
bar_w = 0.62

face_colors = [
    _lighten(PALETTE[1], 0.45) if b else _lighten(PALETTE[0], 0.45) for b in best_mask
]
edge_colors = [PALETTE[1] if b else PALETTE[0] for b in best_mask]

# 淡色背景带，给柱体留出呼吸空间
ax.axhspan(0.0, profits.max() * 1.18, alpha=0.03, color=PALETTE[0], zorder=0)

# 六情况利润均值参考线（值由账本导出）
ax.axhline(
    mean_profit,
    color=COLORS["ref_line"],
    linestyle="--",
    linewidth=0.8,
    alpha=0.5,
    zorder=1,
)
ax.text(
    len(CASE_IDS) - 0.5,
    mean_profit,
    "均值 {:.2f}".format(mean_profit),
    fontsize=7.5,
    color=COLORS["ref_line"],
    ha="right",
    va="bottom",
    style="italic",
    bbox=dict(boxstyle="round,pad=0.2", facecolor="white", edgecolor="none", alpha=0.8),
    zorder=5,
)

bars = ax.bar(
    x,
    profits,
    bar_w,
    color=face_colors,
    edgecolor=edge_colors,
    linewidth=1.3,
    zorder=3,
)

# 柱顶数值：最优情况加 ★
bar_labels = [
    ("★" if b else "") + "{:.2f}".format(v) for v, b in zip(profits, best_mask)
]
ax.bar_label(bars, labels=bar_labels, padding=2, fontsize=7.5, zorder=6)

ax.set_xticks(x)
ax.set_xticklabels(tick_labels, fontsize=8)
ax.set_xlabel("表 1 情况", fontsize=10)
ax.set_ylabel("最优期望利润（元/件）", fontsize=10)
ax.set_ylim(0.0, profits.max() * 1.18)
ax.grid(axis="y", alpha=0.12, linestyle="--", color=COLORS["grid"], zorder=0)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

legend_handles = [
    Patch(
        facecolor=_lighten(PALETTE[1], 0.45),
        edgecolor=PALETTE[1],
        linewidth=1.3,
        label="利润最高的情况",
    ),
    Patch(
        facecolor=_lighten(PALETTE[0], 0.45),
        edgecolor=PALETTE[0],
        linewidth=1.3,
        label="其余情况",
    ),
]
ax.legend(
    handles=legend_handles,
    frameon=False,
    fontsize=8,
    loc="upper left",
    labelspacing=0.35,
    handlelength=1.6,
)

fig.tight_layout()
save_fig(fig, "figures/fig_q2_six_cases_decisions.png")
