"""fig_q3_strategy_cost_compare —— 问题 3 装配树实例与问题 2 表 1 六情况的单位成品期望利润量级对照（点图 + 参考线）。

本图讲什么
    在同一利润刻度上并列展示两组最优期望利润：「问题 3 · 2 工序 8 零配件装配树实例」
    与「问题 2 · 表 1 六种情况」。竖直虚线给出问题 2 六情况的利润均值参考水平，浅色带
    给出问题 2 六情况利润的取值范围，水平箭头标注问题 3 实例相对该参考水平的量级差。
    两组方案的零配件数与成本结构不同，本图仅作量级对照，不作优劣结论（见 plan_deviations）。

panel 结构
    单 panel 点图：纵轴为方案来源（顶行 = 问题 3 实例，其下六行 = 问题 2 表 1 情况 1–6），
    横轴为单位成品期望利润（元/件）。圆点 = 问题 2 六情况；星标 = 问题 3 实例。

数据来自账本（results.json）哪些 id
    R-Q3-profit、R-Q2-case1-profit … R-Q2-case6-profit。
    图中的参考水平（六情况均值）与区间上下界（六情况最小 / 最大）均由上述七个账本值
    在脚本内计算得到，脚本内不写死任何数值。

关键数值（全部由账本读出，运行期确定）
    问题 3 实例利润 ≈ 66.09 元/件；问题 2 六情况利润 ≈ 13.81–21.68 元/件，均值 ≈ 18.62 元/件。
"""

import json
import os

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()


# --------------------------------------------------------------------------
# 账本读取：与 FIGURE_PLAN.json 的 ledger_source 声明对齐，并保留常见 cwd 回退链，
# 保证在任意执行目录下都能定位到铸出的 results.json。
# --------------------------------------------------------------------------
_LEDGER_SOURCE = os.path.join("stages", "04-result-sources", "results.json")
_LEDGER_FALLBACKS = (
    "results.json",
    os.path.join("..", "04-result-sources", "results.json"),
    os.path.join("..", "..", "04-result-sources", "results.json"),
    os.path.join("..", "..", "stages", "04-result-sources", "results.json"),
)


def load_ledger():
    """返回 {result_id: record}；候选路径覆盖 ledger_source 声明与常见执行 cwd。"""
    for cand in (_LEDGER_SOURCE,) + _LEDGER_FALLBACKS:
        if os.path.exists(cand):
            with open(cand, encoding="utf-8") as fh:
                return {rec["result_id"]: rec for rec in json.load(fh)["results"]}
    raise FileNotFoundError(
        "results.json 未找到；已尝试: " + ", ".join((_LEDGER_SOURCE,) + _LEDGER_FALLBACKS)
    )


def _sem(key, idx):
    """语义色：COLORS 缺该键时退回 PALETTE，口径同全篇。"""
    try:
        return COLORS[key]
    except (KeyError, TypeError):
        return PALETTE[idx % len(PALETTE)]


LEDGER = load_ledger()

Q3_ID = "R-Q3-profit"
Q2_IDS = ["R-Q2-case{}-profit".format(k) for k in range(1, 7)]

q3_profit = float(LEDGER[Q3_ID]["value"])
q2_profit = np.array([float(LEDGER[rid]["value"]) for rid in Q2_IDS], dtype=float)
profit_unit = LEDGER[Q3_ID].get("unit", "元/件")

ref_mean = float(q2_profit.mean())
ref_lo = float(q2_profit.min())
ref_hi = float(q2_profit.max())

labels = ["问题 3 实例（2 工序 8 零配件）"] + [
    "问题 2 · 情况 {}".format(k) for k in range(1, 7)
]
y = np.arange(len(labels), dtype=float)

c_q2 = PALETTE[0]
c_q3 = PALETTE[1]
c_ref = _sem("neutral", 2)
c_txt = _sem("text", 3)
c_box = _sem("bg_box", 4)

fig, ax = plt.subplots(figsize=(6.0, 4.5))

# 问题 2 六情况的利润区间（阈值带）与均值参考线
ax.axvspan(
    ref_lo, ref_hi,
    color=_lighten(c_q2, 0.85), alpha=0.55, zorder=0,
    label="问题 2 六情况利润区间",
)
ax.axvline(
    ref_mean, color=c_ref, linestyle="--", linewidth=0.9, alpha=0.85, zorder=1,
    label="问题 2 利润参考水平（均值）",
)

# 两组点：问题 2 六情况（圆点）与问题 3 实例（星标）
ax.scatter(
    q2_profit, y[1:], s=72, marker="o", color=c_q2,
    edgecolor="white", linewidth=0.8, zorder=4,
    label="问题 2 表 1 六情况",
)
ax.scatter(
    [q3_profit], y[:1], s=260, marker="*", color=c_q3,
    edgecolor="white", linewidth=0.6, zorder=5,
    label="问题 3 装配树实例",
)

# 量级差箭头：从参考水平指向问题 3 实例
ax.annotate(
    "", xy=(q3_profit, 0.0), xytext=(ref_mean, 0.0),
    arrowprops=dict(arrowstyle="->", color=c_ref, lw=1.1, shrinkA=2, shrinkB=10),
    zorder=3,
)
ax.text(
    (ref_mean + q3_profit) / 2.0, 0.26,
    "相对参考水平 {:+.2f} {}".format(q3_profit - ref_mean, profit_unit),
    ha="center", va="top", fontsize=8, color=c_txt,
)

# 参考线标签放图顶部（避开数据密集区），星标数值短标签放点右侧
ax.text(
    ref_mean, -0.62, "均值 {:.2f}".format(ref_mean),
    ha="center", va="top", fontsize=7.5, color=c_txt,
)
ax.text(
    q3_profit + 1.6, 0.0, "{:.2f}".format(q3_profit),
    ha="left", va="center", fontsize=8, color=c_txt,
)

ax.set_yticks(y)
ax.set_yticklabels(labels, fontsize=9)
ax.set_ylim(len(labels) - 0.45, -0.85)
ax.set_xlim(ref_lo - 5.5, q3_profit + (q3_profit - ref_hi) * 0.22)

ax.set_xlabel("单位成品期望利润（元/件）", fontsize=10)
ax.set_ylabel("方案来源（问题 3 实例 / 问题 2 表 1 六情况）", fontsize=9.5)

ax.legend(
    loc="center right", frameon=False, fontsize=8,
    labelspacing=0.35, handlelength=1.6, borderaxespad=0.4,
)
ax.text(
    0.98, 0.03,
    "问题 2 六情况均值：{:.2f} {}\n问题 3 实例 / 该均值 = {:.2f}×".format(
        ref_mean, profit_unit, q3_profit / ref_mean
    ),
    transform=ax.transAxes, fontsize=8, va="bottom", ha="right", color=c_txt,
    bbox=dict(boxstyle="round,pad=0.4", facecolor=c_box, edgecolor=c_ref, alpha=0.95),
)

ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.grid(axis="x", alpha=0.15, linestyle="--")
ax.tick_params(axis="x", labelsize=9)

fig.tight_layout()
os.makedirs("figures", exist_ok=True)
save_fig(fig, "figures/fig_q3_strategy_cost_compare.png")
