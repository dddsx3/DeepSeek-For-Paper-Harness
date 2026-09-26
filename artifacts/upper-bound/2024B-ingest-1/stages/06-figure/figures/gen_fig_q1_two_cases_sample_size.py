"""fig_q1_two_cases_sample_size — 问题 1 两情形最小检测方案的样本量与判定门槛对照。

本图讲什么：把问题 1 两种情形（95% 信度拒收口径 / 90% 信度接收口径）的最小检测方案
放在同一张图上对照，回答“检测次数尽可能少”这一目标在两情形下的落点差异。

panel (a)：两情形最小检测次数 n* 的分组柱状对比（柱顶标数值、较优者 ★ 高亮），
           直观显示 368 件 与 22 件 的数量级差异来源于单侧检验方向与信度不同。
panel (b)：判定临界次品数 c*（情形 1 与情形 2）与情形 (1) 方案在企业侧按单件检测成本
           归一的抽样检测费用对比，说明“临界门槛”与“检测代价”随口径变化的联动。

数据来源（全部直接读自账本 results.json，无平滑、无插值、无硬编码）：
  R-Q1-case1-n                 情形 (1) 最小检测次数 n*
  R-Q1-case2-n                 情形 (2) 最小检测次数 n*
  R-Q1-case1-c                 情形 (1) 接收判定临界次品数 c*
  R-Q1-case2-c                 情形 (2) 接收判定临界次品数 c*
  R-Q1-sampling-cost-case1     情形 (1) 方案归一化抽样检测费用

关键数值（运行时从账本读出，此处仅为可读性提示）：
  情形 (1)：n*=368, c*=46, 归一化费用=368
  情形 (2)：n*=22,  c*=0
"""

import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


# ---------------------------------------------------------------- 取数
doc = load("results.json")
_v = {r["result_id"]: r["value"] for r in doc["results"]}

n_case1 = _v["R-Q1-case1-n"]
n_case2 = _v["R-Q1-case2-n"]
c_case1 = _v["R-Q1-case1-c"]
c_case2 = _v["R-Q1-case2-c"]
sampling_cost_case1 = _v["R-Q1-sampling-cost-case1"]

case_labels = [cn("情形(1) 95%拒收"), cn("情形(2) 90%接收")]
case_colors = [PALETTE[0], PALETTE[1]]


fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8))
ax_a, ax_b = axes


# ---------------------------------------------------- panel (a) 最小检测次数 n*
x = np.arange(len(case_labels))
n_vals = [n_case1, n_case2]

bars = ax_a.bar(
    x, n_vals, width=0.5,
    color=[_lighten(c, 0.45) for c in case_colors],
    edgecolor=case_colors,
    linewidth=1.4,
    zorder=2,
)

# 柱顶数值 + 较大样本量 ★ 高亮
for bar, v, col in zip(bars, n_vals, case_colors):
    is_max = (v == max(n_vals))
    ax_a.text(
        bar.get_x() + bar.get_width() / 2.0,
        bar.get_height() + max(n_vals) * 0.03,
        f"{'★' if is_max else ''}{v:.0f}",
        ha="center", va="bottom", fontsize=8,
        fontweight="bold" if is_max else "normal",
        color=col if is_max else COLORS["text"],
    )

# 参考线：两情形样本量的算术均值
mean_n = float(np.mean(n_vals))
ax_a.axhline(mean_n, color=COLORS["ref_line"], linestyle="--",
             linewidth=0.8, alpha=0.5, zorder=1)
ax_a.text(
    len(case_labels) - 1 + 0.45, mean_n,
    cn(f"均值 {mean_n:.0f}"),
    ha="right", va="bottom", fontsize=7,
    color=COLORS["ref_line"], style="italic",
)

ax_a.set_xticks(x)
ax_a.set_xticklabels(case_labels, fontsize=8)
ax_a.set_ylabel(cn("最小检测次数 n*（件）"), fontsize=8.5)
ax_a.set_ylim(0, max(n_vals) * 1.22)
ax_a.grid(axis="y", alpha=0.12, linestyle="--", color=COLORS["grid"], zorder=0)
ax_a.spines["top"].set_visible(False)
ax_a.spines["right"].set_visible(False)
ax_a.tick_params(axis="y", labelsize=8)
panel(ax_a, "(a)")


# --------------------------------------- panel (b) 判定门槛 c* 与归一化检测费用
items = [
    cn("c* 情形(1)"),
    cn("c* 情形(2)"),
    cn("检测费用\n情形(1)"),
]
item_vals = [c_case1, c_case2, sampling_cost_case1]
item_colors = [case_colors[0], case_colors[1], COLORS["accent"]]

xb = np.arange(len(items))
bars_b = ax_b.bar(
    xb, item_vals, width=0.55,
    color=[_lighten(c, 0.45) for c in item_colors],
    edgecolor=item_colors,
    linewidth=1.4,
    zorder=2,
)

max_b = max(item_vals)
for bar, v, col in zip(bars_b, item_vals, item_colors):
    ax_b.text(
        bar.get_x() + bar.get_width() / 2.0,
        bar.get_height() + max_b * 0.03,
        f"{v:.0f}",
        ha="center", va="bottom", fontsize=8,
        color=COLORS["text"],
    )

# 零门槛判据线：情形 (2) 的临界次品数为 0，用参考线强调
ax_b.axhline(0.0, color=COLORS["down"], linestyle="-", linewidth=0.9, alpha=0.55, zorder=1)

ax_b.set_xticks(xb)
ax_b.set_xticklabels(items, fontsize=8)
ax_b.set_ylabel(cn("取值（件；费用按单件检测成本归一）"), fontsize=8.5)
ax_b.set_ylim(0, max_b * 1.22)
ax_b.grid(axis="y", alpha=0.12, linestyle="--", color=COLORS["grid"], zorder=0)
ax_b.spines["top"].set_visible(False)
ax_b.spines["right"].set_visible(False)
ax_b.tick_params(axis="y", labelsize=8)
panel(ax_b, "(b)")


fig.tight_layout()
save(fig, "fig_q1_two_cases_sample_size")
