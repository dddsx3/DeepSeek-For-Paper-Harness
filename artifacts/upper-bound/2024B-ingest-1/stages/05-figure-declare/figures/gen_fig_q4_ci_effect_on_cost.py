"""问题4区间稳健性森林图：左面板展示问题2各情形与问题3的利润区间，右面板展示问题3各节点次品率置信区间。数据来自账本 R-Q4-q2、R-Q4-q3-ci、R-Q4-q3-profit-range、R-Q4-q2-case1-profit-range、R-Q4-q2-case1-consistency-rate。"""
import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


def values_by_id(doc):
    return {item["result_id"]: item["value"] for item in doc["results"]}


def draw_interval(ax, y, lo, hi, color, marker=None):
    ax.plot([lo, hi], [y, y], color=color, linewidth=1.5, solid_capstyle="round", zorder=2)
    ax.plot([lo, lo], [y - 0.10, y + 0.10], color=color, linewidth=1.0, zorder=2)
    ax.plot([hi, hi], [y - 0.10, y + 0.10], color=color, linewidth=1.0, zorder=2)
    if marker is not None:
        ax.plot(marker, y, marker="o", color=color, markersize=5, zorder=3)


doc = load("results.json")
v = values_by_id(doc)

q2_results = v["R-Q4-q2"]
q2_case1_range = v["R-Q4-q2-case1-profit-range"]
q3_profit_range = v["R-Q4-q3-profit-range"]
q3_ci = v["R-Q4-q3-ci"]
case1_consistency = v["R-Q4-q2-case1-consistency-rate"]

fig, (ax_profit, ax_defect) = plt.subplots(
    1, 2, figsize=(6.0, 3.2), gridspec_kw={"width_ratios": [1.15, 1.0]}
)

profit_rows = []
for result in q2_results:
    case_id = result["case_id"]
    interval = (
        q2_case1_range
        if case_id == q2_results[0]["case_id"]
        else result["profit_range_fixed_decision"]
    )
    profit_rows.append((cn(f"情况{case_id}"), interval[0], interval[1], result["point_profit"]))

profit_rows.append((cn("问题3"), q3_profit_range[0], q3_profit_range[1], None))
profit_rows.reverse()

for i, (label, lo, hi, point) in enumerate(profit_rows):
    y = i
    if i % 2 == 0:
        ax_profit.axhspan(y - 0.42, y + 0.42, color=_lighten(COLORS["primary"], 0.88), zorder=0)
    draw_interval(ax_profit, y, lo, hi, PALETTE[0], point)
    ax_profit.text(hi, y + 0.15, cn(f"[{lo:.2f}, {hi:.2f}]"),
                   ha="right", va="bottom", fontsize=7, color=COLORS["gray"])

ax_profit.axvline(0, color=COLORS["ref_line"], linestyle="--", linewidth=1.0, zorder=1)
ax_profit.set_yticks(np.arange(len(profit_rows)))
ax_profit.set_yticklabels([row[0] for row in profit_rows], fontsize=8)
ax_profit.set_xlabel(cn("利润（元/件）"))
ax_profit.set_xlim(
    min(row[1] for row in profit_rows) - 1,
    max(row[2] for row in profit_rows) + 2
)
ax_profit.grid(axis="x", color=COLORS["grid"], alpha=0.45, linestyle="--")
ax_profit.spines["top"].set_visible(False)
ax_profit.spines["right"].set_visible(False)
panel(ax_profit, "(a)")

node_names = list(q3_ci.keys())
node_names.reverse()
ci_rows = [(name, q3_ci[name][0], q3_ci[name][1]) for name in node_names]

for i, (name, lo, hi) in enumerate(ci_rows):
    y = i
    if i % 2 == 0:
        ax_defect.axhspan(y - 0.42, y + 0.42, color=_lighten(COLORS["secondary"], 0.88), zorder=0)
    draw_interval(ax_defect, y, lo, hi, PALETTE[1])

ax_defect.set_yticks(np.arange(len(ci_rows)))
ax_defect.set_yticklabels([cn(name) for name, _, _ in ci_rows], fontsize=7)
ax_defect.set_xlabel(cn("次品率置信区间"))
ax_defect.set_xlim(0, max(hi for _, _, hi in ci_rows) * 1.25)
ax_defect.grid(axis="x", color=COLORS["grid"], alpha=0.45, linestyle="--")
ax_defect.spines["top"].set_visible(False)
ax_defect.spines["right"].set_visible(False)
panel(ax_defect, "(b)")

fig.text(
    0.5, 0.015,
    cn(f"问题2情况1决策一致率：{case1_consistency:.3f}"),
    ha="center", va="bottom", fontsize=8, color=COLORS["gray"]
)
fig.tight_layout(rect=(0, 0.07, 1, 1))
save(fig, "fig_q4_ci_effect_on_cost")
