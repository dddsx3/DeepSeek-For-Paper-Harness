"""图 fig_q1_two_cases_sample_size：问题 1 两种情形的最小检测次数与接收判定临界次品数对照。

本图讲什么
----------
问题 1 在标称次品率 10% 下给出「检测次数尽可能少」的抽样检测方案，两种情形的
最小检测次数相差一个量级以上，单看次数会丢掉判定阈值这一半信息，故把
「次数—判定阈值」与「次数—企业侧折出费用」两件事合成一张两面板图。

- panel (a)：分组柱状图。横轴为两个情形，每组两根柱分别是该情形的最小检测次数
  n* 与接收判定临界次品数 c*。纵轴取对数，以容纳情形(1) 与情形(2) 之间的量级差；
  柱顶打印账本真值，其中检测次数更小（更省）的那根柱以 ★ 与加粗标签高亮。
- panel (b)：情形(1) 的最小检测次数 n* 与其在企业侧折出的抽样检测费用对照。
  该费用按单件检测成本归一，故两柱等长，是费用口径的直接体现；虚线为等值参考线。

数据来源（全部取自账本 results.json，脚本内不写死任何一个数）
------------------------------------------------------------
R-Q1-case1-n               情形(1) 最小检测次数 n*
R-Q1-case1-c               情形(1) 接收判定临界次品数 c*
R-Q1-case2-n               情形(2) 最小检测次数 n*
R-Q1-case2-c               情形(2) 接收判定临界次品数 c*（账本真值为 0）
R-Q1-sampling-cost-case1   情形(1) 抽样检测费用（元/件，按单件检测成本归一）

关键数值：n*(1)=368、c*(1)=46、n*(2)=22、c*(2)=0、抽样费用(1)=368 元/件。
情形(2) 的 c* = 0 在对数轴上以渲染底值占位，柱顶标签仍打印账本真值 0。
"""

import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


# --------------------------------------------------------------------------
# 账本读取：图里出现的每一个数都来自 results.json
# --------------------------------------------------------------------------
def _index(doc):
    """把账本 {results: [{result_id, value, ...}]} 索引成 {result_id: value}。"""
    recs = doc["results"] if isinstance(doc, dict) else doc
    return {r["result_id"]: r["value"] for r in recs}


LEDGER = _index(load("results.json"))

N1 = float(LEDGER["R-Q1-case1-n"])
C1 = float(LEDGER["R-Q1-case1-c"])
N2 = float(LEDGER["R-Q1-case2-n"])
C2 = float(LEDGER["R-Q1-case2-c"])
COST1 = float(LEDGER["R-Q1-sampling-cost-case1"])

# 对数轴的渲染底值：仅在账本真值为 0（情形(2) 的 c*）时占位，
# 不改变任何统计口径，柱顶标签仍打印账本真值。
FLOOR = 0.5


# --------------------------------------------------------------------------
# 画布：1×2 横排，r = 2.8/6.0 ≈ 0.47（≤0.80 档位 → 宽 6.0in）
# --------------------------------------------------------------------------
fig, axes = plt.subplots(
    1, 2, figsize=(6.0, 2.8), gridspec_kw={"width_ratios": [1.25, 1.0]}
)


# --------------------------------------------------------------------------
# panel (a)：两情形的 n* 与 c* 分组柱（对数纵轴，柱顶真值，最优柱 ★ 高亮）
# --------------------------------------------------------------------------
ax = axes[0]

cases = ["情形(1)", "情形(2)"]
series = [
    {
        "name": "最少检测次数 n*",
        "vals": [N1, N2],
        "color": PALETTE[0],
        "best": int(np.argmin([N1, N2])),   # 次数越少越省 → 高亮最小者
    },
    {
        "name": "接收判定临界次品数 c*",
        "vals": [C1, C2],
        "color": PALETTE[1],
        "best": None,
    },
]
x = np.arange(len(cases))
width = 0.34

for i, s in enumerate(series):
    offset = (i - 0.5) * width
    heights = [max(v, FLOOR) for v in s["vals"]]
    bars = ax.bar(
        x + offset,
        heights,
        width,
        color=_lighten(s["color"], 0.45),
        edgecolor=s["color"],
        linewidth=1.3,
        label=s["name"],
        zorder=3,
    )
    for j, (bar, v) in enumerate(zip(bars, s["vals"])):
        is_best = s["best"] is not None and j == s["best"]
        ax.text(
            bar.get_x() + bar.get_width() / 2.0,
            bar.get_height() * 1.12,
            ("★" if is_best else "") + f"{v:g}",
            ha="center",
            va="bottom",
            fontsize=6.8,
            color=s["color"] if is_best else COLORS["gray"],
            fontweight="bold" if is_best else "normal",
            zorder=4,
        )

ax.set_yscale("log")
ax.set_ylim(FLOOR * 0.6, max(N1, C1, N2, C2) * 2.8)
ax.minorticks_off()
ax.set_xticks(x)
ax.set_xticklabels(cases, fontsize=7.5)
ax.set_xlabel("情形", fontsize=7.5)
ax.set_ylabel("检测次数（件，对数刻度）", fontsize=7.5)
ax.tick_params(axis="y", labelsize=7)
ax.grid(axis="y", which="major", alpha=0.12, linestyle="--", color=COLORS["grid"])
ax.legend(
    frameon=False, fontsize=6.5, loc="upper left",
    handlelength=1.4, labelspacing=0.3,
)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
panel(ax, "(a)")


# --------------------------------------------------------------------------
# panel (b)：情形(1) 的检测次数与折出抽样检测费用对照（单件检测成本归一）
# --------------------------------------------------------------------------
ax2 = axes[1]

metric_labels = ["检测次数 n*", "抽样检测费用"]
metric_vals = [N1, COST1]
metric_colors = [PALETTE[2], PALETTE[3]]

bars2 = ax2.bar(
    np.arange(len(metric_labels)),
    metric_vals,
    0.5,
    color=[_lighten(c, 0.45) for c in metric_colors],
    edgecolor=metric_colors,
    linewidth=1.3,
    zorder=3,
)
ax2.bar_label(bars2, fmt="%g", padding=2, fontsize=7, zorder=4)

ax2.axhline(
    COST1, color=COLORS["ref_line"], linestyle="--", linewidth=0.8,
    alpha=0.55, zorder=1,
)

ax2.set_xticks(np.arange(len(metric_labels)))
ax2.set_xticklabels(metric_labels, fontsize=7)
ax2.set_xlabel("指标", fontsize=7.5)
ax2.set_ylabel("次数（件）/ 费用（元/件）", fontsize=7.5)
ax2.set_ylim(0, max(metric_vals) * 1.25)
ax2.tick_params(axis="y", labelsize=7)
ax2.grid(axis="y", alpha=0.12, linestyle="--", color=COLORS["grid"])
ax2.spines["top"].set_visible(False)
ax2.spines["right"].set_visible(False)
panel(ax2, "(b)")


fig.tight_layout()
save(fig, "fig_q1_two_cases_sample_size")
