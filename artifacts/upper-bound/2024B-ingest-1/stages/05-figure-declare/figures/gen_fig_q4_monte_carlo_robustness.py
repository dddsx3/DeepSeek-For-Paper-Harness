"""fig_q4_monte_carlo_robustness —— 问题 4 决策稳健性与利润水平的对账散点图。

本图讲什么
----------
把表 1 六种情况的「问题 2 最优期望利润」与「问题 4 重复抽样重解得到的决策一致率」
放进同一坐标系对账：横轴是利润水平，纵轴是该情况在重解下的决策一致率，每个点带
±1.96 倍标准误的误差棒，虚线标出「完全一致」上界 1.0。用来回答一个问题——
利润更高的方案是否也更容易被抽样波动推翻（稳健性是否与利润同向）。

panel 说明
----------
单 panel 散点图（无收敛曲线）：账本里没有蒙特卡洛轨迹、逐轮收敛过程这类条目，
只有每种情况的一致率点估计与标准误，所以按规划画「带误差棒的散点图」，
而不是虚构一条收敛曲线。点的颜色编码情况编号，由右侧 colorbar 读出。

数据来源（results.json，全部经 load_ledger() 读入，脚本内不写死任何数值）
----------------------------------------------------------------------
- R-Q2-case{1..6}-profit                -> 横轴：各情况最优期望利润（元/件）
- R-Q4-case{1..6}-consistency-rate      -> 纵轴：重解与点估计决策的一致率
- R-Q4-case{1..6}-consistency-rate-se   -> 误差棒半宽 = 1.96 × 标准误

关键数值（运行时从账本读出，见散点位置与两个极值标注，脚本内不重复列出）
"""

import json
import os

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D
from matplotlib.ticker import PercentFormatter

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

CASES = (1, 2, 3, 4, 5, 6)
REF_RATE = 1.0   # 一致率上界参照（比例口径的端点，非账本数据）
Z95 = 1.96       # 95% 误差棒倍数


def load_ledger():
    """按候选路径定位铸出的账本 results.json（与 FIGURE_PLAN.ledger_source 对齐）。

    执行期 cwd 不确定，故同时尝试「脚本位置相对路径」与「工作区相对路径」，
    任一命中即返回 results 数组，全部落空才报错。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.normpath(os.path.join(here, "..", "..", "04-result-sources", "results.json")),
        os.path.normpath(os.path.join(here, "..", "..", "..", "stages", "04-result-sources", "results.json")),
        os.path.normpath(os.path.join(here, "..", "..", "..", "04-result-sources", "results.json")),
        os.path.join("stages", "04-result-sources", "results.json"),
        os.path.normpath(os.path.join("..", "04-result-sources", "results.json")),
        "results.json",
    ]
    for path in candidates:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)["results"]
    raise FileNotFoundError("results.json 未找到，已尝试：" + ", ".join(candidates))


LEDGER = {row["result_id"]: row for row in load_ledger()}


def value(result_id):
    """从账本取一个数；result_id 不存在直接报错，避免静默用错数。"""
    if result_id not in LEDGER:
        raise KeyError("result_id %r 不在 results.json 中" % result_id)
    return float(LEDGER[result_id]["value"])


profit = np.array([value("R-Q2-case%d-profit" % k) for k in CASES], dtype=float)
rate = np.array([value("R-Q4-case%d-consistency-rate" % k) for k in CASES], dtype=float)
se = np.array([value("R-Q4-case%d-consistency-rate-se" % k) for k in CASES], dtype=float)
half = Z95 * se

case_cmap = LinearSegmentedColormap.from_list(
    "case_index", [PALETTE[i % len(PALETTE)] for i in range(len(CASES))]
)

fig, ax = plt.subplots(figsize=(6.0, 4.2))

ax.axhline(REF_RATE, color=COLORS["ref_line"], linestyle="--", linewidth=1.1,
           alpha=0.8, zorder=1)

ax.errorbar(profit, rate, yerr=half, fmt="none",
            ecolor=_lighten(PALETTE[0], 0.15), elinewidth=1.1,
            capsize=3.5, capthick=1.0, zorder=3)

sc = ax.scatter(profit, rate, c=list(CASES), cmap=case_cmap, vmin=1, vmax=len(CASES),
                s=78, edgecolor="white", linewidth=0.9, zorder=4)

i_lo = int(np.argmin(rate))
i_hi = int(np.argmax(rate))
box = dict(boxstyle="round,pad=0.25", facecolor=COLORS["bg_box"],
           edgecolor=COLORS["grid"], alpha=0.95)
ax.annotate("情况 %d：%.3f" % (CASES[i_lo], rate[i_lo]),
            xy=(profit[i_lo], rate[i_lo]), xytext=(-10, 8),
            textcoords="offset points", ha="right", va="bottom",
            fontsize=8.5, color=COLORS["text"], bbox=box, zorder=5)
ax.annotate("情况 %d：%.3f" % (CASES[i_hi], rate[i_hi]),
            xy=(profit[i_hi], rate[i_hi]), xytext=(-10, -10),
            textcoords="offset points", ha="right", va="top",
            fontsize=8.5, color=COLORS["text"], bbox=box, zorder=5)

ax.set_xlabel("问题 2 对应情况最优期望利润（元/件）")
ax.set_ylabel("决策一致率")
ax.yaxis.set_major_formatter(PercentFormatter(xmax=1.0, decimals=0))

y_lo = float(np.min(rate - half))
y_hi = float(np.max(rate + half))
y_pad = 0.08 * max(y_hi - y_lo, 1e-3)
ax.set_ylim(max(0.0, y_lo - y_pad), min(1.02, y_hi + y_pad))
x_pad = 0.10 * max(float(profit.max() - profit.min()), 1e-3)
ax.set_xlim(float(profit.min()) - x_pad, float(profit.max()) + x_pad)

ax.grid(alpha=0.15, linestyle="--")
ax.set_axisbelow(True)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

cbar = fig.colorbar(sc, ax=ax, ticks=list(CASES), fraction=0.046, pad=0.02)
cbar.set_label("表 1 情况编号", fontsize=8.5)
cbar.ax.tick_params(labelsize=8)
cbar.outline.set_visible(False)

handles = [
    Line2D([], [], color=PALETTE[0], marker="o", linestyle="none", markersize=6,
           markeredgecolor="white", label="一致率点估计"),
    Line2D([], [], color=_lighten(PALETTE[0], 0.15), linestyle="none", marker="_",
           markersize=8, label="±1.96 × 标准误"),
    Line2D([], [], color=COLORS["ref_line"], linestyle="--", linewidth=1.0,
           label="完全一致参照（%.1f）" % REF_RATE),
]
ax.legend(handles=handles, frameon=False, fontsize=8, loc="lower left",
          labelspacing=0.35, handlelength=1.6, borderaxespad=0.6)

fig.tight_layout()
save_fig(fig, "figures/fig_q4_monte_carlo_robustness.png")
