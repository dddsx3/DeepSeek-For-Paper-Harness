from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
"""
问题4蒙特卡洛重抽样下的最终决策稳健性。
(a) 展示问题2六种情况与问题3实例的决策一致率，并按一致率排序；
(b) 保持相同条目顺序，展示各情况的决策翻转率。
数据取自 R-Q4-q2、R-Q4-q3-consistency-rate、R-Q4-q3-flip-rate、
R-Q4-q3-decision-stable、R-Q4-sample-size-used、R-Q4-ci-level 和
R-Q4-resample-count。账本未提供逐次收敛轨迹，因此不绘制虚构的收敛曲线。
"""

import colorsys
import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import PercentFormatter


def _extract_values(document):
    """兼容 load 返回原始账本、结果数组或已展平字典的情形。"""
    if isinstance(document, dict) and isinstance(document.get("results"), list):
        return {
            row["result_id"]: row["value"]
            for row in document["results"]
        }
    if isinstance(document, list):
        return {
            row["result_id"]: row["value"]
            for row in document
        }
    if isinstance(document, dict):
        if all(isinstance(value, dict) and "value" in value for value in document.values()):
            return {key: value["value"] for key, value in document.items()}
        return dict(document)
    raise TypeError("results.json 的结构无法识别")


def _interpolate_hsl(color_start, color_end, fraction):
    """在 HSL 空间沿最短色相路径插值。"""
    red_start, green_start, blue_start = mcolors.to_rgb(color_start)
    red_end, green_end, blue_end = mcolors.to_rgb(color_end)
    hue_start, light_start, sat_start = colorsys.rgb_to_hls(
        red_start, green_start, blue_start
    )
    hue_end, light_end, sat_end = colorsys.rgb_to_hls(
        red_end, green_end, blue_end
    )
    if abs(hue_end - hue_start) > 0.5:
        if hue_start < hue_end:
            hue_start += 1.0
        else:
            hue_end += 1.0
    hue = (hue_start + (hue_end - hue_start) * fraction) % 1.0
    light = light_start + (light_end - light_start) * fraction
    saturation = sat_start + (sat_end - sat_start) * fraction
    return colorsys.hls_to_rgb(hue, light, saturation)


def _draw_lollipop(
    ax,
    labels,
    values,
    ranks,
    x_label,
    color_good,
    color_bad,
    probability_axis_max,
    higher_is_better,
    show_ranks,
):
    """按配方骨架绘制带中位数参考线的水平棒棒糖图。"""
    item_count = len(values)
    y_positions = np.arange(item_count)
    value_min = min(values)
    value_max = max(values)
    value_range = value_max - value_min
    if value_range == 0:
        value_range = probability_axis_max

    normalized = [
        (value - value_min) / value_range
        for value in values
    ]
    qualities = [
        quality if higher_is_better else 1.0 - quality
        for quality in normalized
    ]
    item_colors = [
        _interpolate_hsl(color_bad, color_good, quality)
        for quality in qualities
    ]

    ax.grid(
        axis="x",
        color=COLORS["grid"],
        alpha=0.22,
        linewidth=0.7,
        linestyle="-",
    )
    ax.set_axisbelow(True)

    median_value = float(np.median(values))
    ax.axvline(
        median_value,
        color=COLORS["ref_line"],
        linestyle=":",
        linewidth=1.1,
        alpha=0.65,
        zorder=1,
    )

    ax.axhspan(
        y_positions[0] - 0.42,
        y_positions[0] + 0.42,
        color=item_colors[0],
        alpha=0.07,
        zorder=0,
    )

    label_offset = probability_axis_max * 0.018
    for index, (label, value, quality, item_color) in enumerate(
        zip(labels, values, qualities, item_colors)
    ):
        line_width = 1.6 + 2.0 * quality
        point_size = 55.0 + 120.0 * quality

        ax.hlines(
            y_positions[index],
            0.0,
            value,
            color=item_color,
            linewidth=line_width,
            zorder=3,
        )
        ax.scatter(
            value,
            y_positions[index],
            s=point_size,
            color=item_color,
            edgecolors="white",
            linewidths=1.4,
            zorder=5,
        )
        ax.text(
            value + label_offset,
            y_positions[index],
            f"{value:.1%}",
            color=item_color,
            fontsize=7.8,
            fontweight="bold" if quality > 0.5 else "normal",
            ha="left",
            va="center",
            zorder=6,
        )

    if show_ranks:
        badge_x = -probability_axis_max * 0.075
        for index, (rank, item_color) in enumerate(zip(ranks, item_colors)):
            if rank <= 3:
                ax.scatter(
                    badge_x,
                    y_positions[index],
                    s=165,
                    color=_lighten(item_color, 0.10),
                    edgecolors="white",
                    linewidths=0.8,
                    zorder=6,
                )
                ax.text(
                    badge_x,
                    y_positions[index],
                    str(rank),
                    color="white",
                    fontsize=7.3,
                    fontweight="bold",
                    ha="center",
                    va="center",
                    zorder=7,
                )
            else:
                ax.text(
                    badge_x,
                    y_positions[index],
                    str(rank),
                    color=COLORS["gray"],
                    fontsize=7.0,
                    fontweight="bold",
                    ha="center",
                    va="center",
                )

    ax.text(
        median_value,
        -0.68,
        cn("中位数 {:.1%}").format(median_value),
        color=COLORS["ref_line"],
        fontsize=7.2,
        ha="center",
        va="bottom",
        bbox={
            "boxstyle": "round,pad=0.22",
            "facecolor": "white",
            "edgecolor": COLORS["ref_line"],
            "alpha": 0.88,
        },
        zorder=8,
    )

    ax.set_yticks(y_positions)
    ax.set_yticklabels(labels, fontsize=8.0)
    ax.set_xlabel(cn(x_label), fontsize=9.0)
    ax.set_xticks(np.linspace(0.0, probability_axis_max, 6))
    ax.xaxis.set_major_formatter(PercentFormatter(xmax=probability_axis_max))
    ax.set_xlim(
        -probability_axis_max * 0.14,
        probability_axis_max * 1.14,
    )
    ax.set_ylim(item_count - 0.5, -0.82)
    ax.tick_params(axis="y", length=0, pad=6, labelsize=8.0)
    ax.tick_params(axis="x", labelsize=7.8)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.spines["bottom"].set_color(COLORS["grid"])


document = load("results.json")
values_by_id = _extract_values(document)


def result(result_id):
    try:
        return values_by_id[result_id]
    except KeyError as error:
        raise KeyError(f"账本缺少结果：{result_id}") from error


q2_rows = result("R-Q4-q2")
q3_consistency = float(result("R-Q4-q3-consistency-rate"))
q3_flip = float(result("R-Q4-q3-flip-rate"))
q3_stable = bool(result("R-Q4-q3-decision-stable"))
sample_size = result("R-Q4-sample-size-used")
ci_level = float(result("R-Q4-ci-level"))
resample_count = result("R-Q4-resample-count")

if not isinstance(q2_rows, list) or not q2_rows:
    raise TypeError("R-Q4-q2 必须是非空结果数组")

labels = []
consistency_rates = []
flip_rates = []
for row in q2_rows:
    required_keys = {"case_id", "consistency_rate", "flip_rate"}
    missing_keys = required_keys.difference(row)
    if missing_keys:
        raise KeyError(f"问题2结果行缺少字段：{sorted(missing_keys)}")
    labels.append(cn("问题2 情况{}").format(row["case_id"]))
    consistency_rates.append(float(row["consistency_rate"]))
    flip_rates.append(float(row["flip_rate"]))

labels.append(cn("问题3实例"))
consistency_rates.append(q3_consistency)
flip_rates.append(q3_flip)

probability_axis_max = 1.0
all_rates = consistency_rates + flip_rates
if any(rate < 0.0 or rate > probability_axis_max for rate in all_rates):
    raise ValueError("一致率或翻转率超出概率区间")

ranked_rows = sorted(
    zip(labels, consistency_rates, flip_rates),
    key=lambda row: (-row[1], row[2], row[0]),
)
labels = [row[0] for row in ranked_rows]
consistency_rates = [row[1] for row in ranked_rows]
flip_rates = [row[2] for row in ranked_rows]

consistency_ranks = [
    1 + sum(other > value for other in consistency_rates)
    for value in consistency_rates
]

color_good = _lighten(PALETTE[0], 0.08)
color_bad = _lighten(PALETTE[3], 0.08)

fig, axes = plt.subplots(
    1,
    2,
    figsize=(6.0, 4.2),
    sharey=True,
    gridspec_kw={"wspace": 0.10},
)

_draw_lollipop(
    axes[0],
    labels,
    consistency_rates,
    consistency_ranks,
    "决策一致率（%）",
    color_good,
    color_bad,
    probability_axis_max,
    higher_is_better=True,
    show_ranks=True,
)
axes[0].set_ylabel(cn("重做问题/案例"), fontsize=9.0)
panel(axes[0], "(a)")

_draw_lollipop(
    axes[1],
    labels,
    flip_rates,
    consistency_ranks,
    "决策翻转率（%）",
    color_good,
    color_bad,
    probability_axis_max,
    higher_is_better=False,
    show_ranks=False,
)
axes[1].tick_params(axis="y", labelleft=False)
panel(axes[1], "(b)")

stable_label = cn("是") if q3_stable else cn("否")
metadata = cn(
    "账本口径：n={}；置信水平={:.1%}；重抽样={} 次；问题3稳健={}"
).format(sample_size, ci_level, resample_count, stable_label)
fig.text(
    0.5,
    0.022,
    metadata,
    color=COLORS["gray"],
    fontsize=7.2,
    ha="center",
    va="bottom",
)

fig.tight_layout(rect=(0.0, 0.07, 1.0, 1.0))
save(fig, "fig_q4_monte_carlo_robustness")
