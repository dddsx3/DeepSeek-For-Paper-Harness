"""
fig_q3_strategy_cost_compare —— 装配网络扩展带来的收益量级对照

本图讲什么：
    把问题 3 的 2 工序 8 零配件装配树实例（节点级最优决策）的单位成品期望利润，
    与问题 2 表 1 六种情况的最优期望利润放在同一量纲下排序对照；再以问题 2 各情况
    为分母给出利润比值，量化「装配结构扩展 + 节点级决策」带来的收益幅度。

每个 panel 是什么：
    (a) 排序柱状图：7 个方案的期望利润降序排列，柱色按数值深浅渐变，最优者加粗描边并柱顶标注数值；
    (b) 水平比值条：问题 3 利润 / 各情况利润，1.0 参考线上方表示装配结构扩展后收益更高。

数据来自账本哪些 id：
    results.json 中的 R-Q3-profit，以及 R-Q2-case1-profit … R-Q2-case6-profit。
    所有数值均由 load() 现场读出，脚本内不写死任何数据。

口径说明：账本问题 3 侧只有利润总额一项、无节点级决策 / 成本条目，故本图不画节点级
策略组合（已登记为上游待补项）；figure_id 沿用阶段 1 FIGURE_MANIFEST，未改名。
"""
import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

doc = load("results.json")
vals = {r["result_id"]: r["value"] for r in doc["results"]}

Q3_ID = "R-Q3-profit"
CASE_IDS = ["R-Q2-case%d-profit" % i for i in range(1, 7)]

# ---- 取数：全部来自账本，无任何硬编码数值 ----
q3_val = float(vals[Q3_ID])
case_vals = np.array([float(vals[i]) for i in CASE_IDS])
scheme_labels = [cn("问题3 实例")] + [cn("表1 情况%d" % i) for i in range(1, 7)]
scheme_vals = np.concatenate(([q3_val], case_vals))
ratio_labels = [cn("表1 情况%d" % i) for i in range(1, 7)]
ratios = q3_val / case_vals

fig, (ax_a, ax_b) = plt.subplots(1, 2, figsize=(6.0, 3.0))

# ---------------- panel (a)：期望利润降序柱 ----------------
order = np.argsort(-scheme_vals)
labs_a = [scheme_labels[i] for i in order]
vals_a = scheme_vals[order]
x = np.arange(len(vals_a))
vmax = vals_a.max()

base_a = PALETTE[0]
fills_a = [_lighten(base_a, 0.55 * (1.0 - v / vmax)) for v in vals_a]
edges_a = [_lighten(base_a, 0.15 * (1.0 - v / vmax)) for v in vals_a]
bars_a = ax_a.bar(x, vals_a, width=0.62, color=fills_a, edgecolor=edges_a,
                  linewidth=1.2, zorder=3)
bars_a[0].set_edgecolor(COLORS["accent"])
bars_a[0].set_linewidth(2.0)
ax_a.bar_label(bars_a, fmt="%.2f", padding=2, fontsize=7.5)

ax_a.set_xticks(x)
ax_a.set_xticklabels(labs_a, fontsize=8, rotation=30, ha="right")
ax_a.set_xlabel("方案 / 表 1 情况", fontsize=9)
ax_a.set_ylabel("单位成品期望利润（元/件）", fontsize=9)
ax_a.set_ylim(0, vmax * 1.24)
ax_a.tick_params(axis="y", labelsize=8)
ax_a.grid(axis="y", alpha=0.12, linestyle="--", zorder=0)
ax_a.spines["top"].set_visible(False)
ax_a.spines["right"].set_visible(False)
panel(ax_a, "(a)")

# ---------------- panel (b)：利润比值横条 ----------------
order_b = np.argsort(-ratios)
labs_b = [ratio_labels[i] for i in order_b]
vals_b = ratios[order_b]
yb = np.arange(len(vals_b))
rmax = vals_b.max()

base_b = PALETTE[1]
fills_b = [_lighten(base_b, 0.55 * (1.0 - v / rmax)) for v in vals_b]
edges_b = [_lighten(base_b, 0.15 * (1.0 - v / rmax)) for v in vals_b]
bars_b = ax_b.barh(yb, vals_b, height=0.6, color=fills_b, edgecolor=edges_b,
                   linewidth=1.2, zorder=3)
ax_b.bar_label(bars_b, fmt="%.2f", padding=2, fontsize=7.5)
ax_b.axvline(1.0, color=COLORS["ref_line"], linestyle="--", linewidth=1.0, zorder=2)
ax_b.text(1.0, len(vals_b) - 0.4, "1.0", color=COLORS["gray"], fontsize=7,
          ha="left", va="center")

ax_b.set_yticks(yb)
ax_b.set_yticklabels(labs_b, fontsize=8)
ax_b.set_xlabel("利润比值（无量纲）", fontsize=9)
ax_b.set_ylabel("表 1 情况", fontsize=9)
ax_b.set_xlim(0, rmax * 1.30)
ax_b.tick_params(axis="x", labelsize=8)
ax_b.grid(axis="x", alpha=0.12, linestyle="--", zorder=0)
ax_b.spines["top"].set_visible(False)
ax_b.spines["right"].set_visible(False)
panel(ax_b, "(b)")

fig.tight_layout()
save(fig, "fig_q3_strategy_cost_compare")
