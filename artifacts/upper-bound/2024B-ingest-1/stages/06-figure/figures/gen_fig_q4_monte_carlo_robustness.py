from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
"""问题4重抽样决策一致率排序图。

panel (a)：按重抽样决策一致率对问题2各情况与问题3实例排序；棒棒糖长度、
圆点大小和颜色共同编码一致率，虚线给出中位数，圆点旁给出账本读数。
数据来自账本 R-Q4-decision-diff、R-Q4-q3-consistency-rate、
R-Q4-q3-flip-rate、R-Q4-q3-decision-stable、R-Q4-sample-size-used、
R-Q4-resample-count 与 R-Q4-seed；关键数值均在运行时读取，不在注释中固化。
"""

import colorsys
import matplotlib.colors as mc
import matplotlib.pyplot as plt
import numpy as np


doc = load("results.json")
ledger = {item["result_id"]: item["value"] for item in doc["results"]}

decision_diff = ledger["R-Q4-decision-diff"]
q3_consistency = float(ledger["R-Q4-q3-consistency-rate"])
q3_flip_rate = float(ledger["R-Q4-q3-flip-rate"])
q3_decision_stable = bool(ledger["R-Q4-q3-decision-stable"])
sample_size = int(ledger["R-Q4-sample-size-used"])
resample_count = int(ledger["R-Q4-resample-count"])
seed = int(ledger["R-Q4-seed"])

ranked_pairs = []
for row in decision_diff:
    scope = str(row["scope"])
    score = q3_consistency if scope.startswith("Q3-") else float(row["consistency_rate"])
    ranked_pairs.append((scope, score))

ranked_pairs.sort(key=lambda item: (-item[1], item[0]))
methods = [item[0] for item in ranked_pairs]
scores = np.asarray([item[1] for item in ranked_pairs], dtype=float)

n = len(methods)
score_min = float(np.min(scores))
score_max = float(np.max(scores))
score_range = score_max - score_min
if score_range == 0:
    score_range = max(abs(score_max), float(np.finfo(float).eps))

color_high = PALETTE[0]
color_low = PALETTE[1]


def interpolate_color(color_1, color_2, fraction):
    """在 HSL 空间沿最短色相路径插值。"""
    red_1, green_1, blue_1 = mc.to_rgb(color_1)
    red_2, green_2, blue_2 = mc.to_rgb(color_2)
    hue_1, light_1, saturation_1 = colorsys.rgb_to_hls(red_1, green_1, blue_1)
    hue_2, light_2, saturation_2 = colorsys.rgb_to_hls(red_2, green_2, blue_2)

    if abs(hue_2 - hue_1) > 0.5:
        if hue_1 < hue_2:
            hue_1 += 1.0
        else:
            hue_2 += 1.0

    hue = (hue_1 + (hue_2 - hue_1) * fraction) % 1.0
    light = light_1 + (light_2 - light_1) * fraction
    saturation = saturation_1 + (saturation_2 - saturation_1) * fraction
    return colorsys.hls_to_rgb(hue, light, saturation)


item_colors = []
for score in scores:
    ratio = float((score - score_min) / score_range)
    item_colors.append(interpolate_color(color_high, color_low, 1.0 - ratio))

figure_height = max(4.0, n * 0.46 + 1.8)
fig, ax = plt.subplots(figsize=(5.0, figure_height))
y_positions = np.arange(n)

ax.grid(axis="x", alpha=0.12, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

median_value = float(np.median(scores))
ax.axvline(
    median_value,
    color=COLORS["ref_line"],
    linestyle=":",
    linewidth=1.0,
    alpha=0.5,
    zorder=1,
)

for y_position, score in zip(y_positions, scores):
    if score == score_max:
        ax.axhspan(
            y_position - 0.42,
            y_position + 0.42,
            alpha=0.06,
            color=color_high,
            zorder=0,
        )

badge_x = -score_range * 0.065
label_offset = score_range * 0.03

for index, (method, score, color) in enumerate(zip(methods, scores, item_colors)):
    ratio = float((score - score_min) / score_range)
    line_width = 1.6 + 2.0 * ratio
    dot_size = 55.0 + 120.0 * ratio
    rank = 1 + int(np.sum(scores > score))

    ax.plot(
        [0.0, score],
        [y_positions[index], y_positions[index]],
        color=color,
        linewidth=line_width,
        zorder=3,
        solid_capstyle="round",
    )
    ax.scatter(
        score,
        y_positions[index],
        color=color,
        s=dot_size,
        zorder=5,
        edgecolors="white",
        linewidths=1.8,
    )
    ax.text(
        score + label_offset,
        y_positions[index],
        f"{score:.3f}",
        fontsize=8.5,
        fontweight="bold" if rank <= 3 else "normal",
        color=color,
        va="center",
        ha="left",
    )

    if rank <= 3:
        ax.scatter(
            badge_x,
            y_positions[index],
            s=180.0,
            color=_lighten(color, 0.15),
            edgecolors="white",
            linewidths=0.8,
            zorder=6,
        )
        ax.text(
            badge_x,
            y_positions[index],
            str(rank),
            fontsize=8.5,
            fontweight="bold",
            color="white",
            ha="center",
            va="center",
            zorder=7,
        )
    else:
        ax.text(
            badge_x,
            y_positions[index],
            str(rank),
            fontsize=7.5,
            color=_lighten(color, 0.2),
            ha="center",
            va="center",
            fontweight="bold",
        )

ax.text(
    median_value,
    -0.9,
    cn(f"中位数 {median_value:.3f}"),
    fontsize=8.0,
    color=COLORS["ref_line"],
    ha="center",
    va="bottom",
    bbox={
        "boxstyle": "round,pad=0.25",
        "facecolor": "white",
        "edgecolor": COLORS["ref_line"],
        "alpha": 0.85,
    },
)

ax.set_yticks(y_positions)
ax.set_yticklabels([cn(method) for method in methods], fontsize=9.5)
ax.set_xlabel(cn("重抽样决策一致率"), fontsize=10.5)
ax.set_ylabel(cn("决策对象"), fontsize=10.5)
ax.set_xlim(-score_range * 0.13, score_max + score_range * 0.15)
ax.set_ylim(n - 0.5, -1.4)
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
panel(ax, "(a)")

stable_label = cn("稳健") if q3_decision_stable else cn("不稳健")
metadata = cn(
    f"n={sample_size:g}；B={resample_count:g}；seed={seed:g}；"
    f"Q3翻转率={q3_flip_rate:.1%}；{stable_label}"
)
fig.text(
    0.01,
    0.012,
    metadata,
    ha="left",
    va="bottom",
    fontsize=7.2,
    color=COLORS["gray"],
)

fig.tight_layout(rect=(0.0, 0.06, 1.0, 1.0))
save(fig, "fig_q4_monte_carlo_robustness")
