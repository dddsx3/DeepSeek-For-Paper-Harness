from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
"""拒收与接收两种判定口径下置信水平、最小样本量和临界次品数的联合扫描。
(a) 展示两种判定口径在各置信水平下所需的最小检测件数。
(b) 展示两种判定口径在各置信水平下对应的临界次品数。
数据来自账本 R-Q1-ssvc-confidence、R-Q1-ssvc-n-reject、
R-Q1-ssvc-c-reject、R-Q1-ssvc-n-accept 和 R-Q1-ssvc-c-accept；
所有节点均直接使用账本序列，不在中间置信水平间插值或外推。
"""

import colorsys

import matplotlib.colors as mc
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D


def _interpolate_color(color_start, color_end, ratio):
    """在 HSL 空间插值颜色，避免相邻节点颜色突变。"""
    rgb_start = mc.to_rgb(color_start)
    rgb_end = mc.to_rgb(color_end)
    hue_start, light_start, sat_start = colorsys.rgb_to_hls(*rgb_start)
    hue_end, light_end, sat_end = colorsys.rgb_to_hls(*rgb_end)

    if abs(hue_end - hue_start) > 0.5:
        if hue_start < hue_end:
            hue_start += 1.0
        else:
            hue_end += 1.0

    hue = (hue_start + (hue_end - hue_start) * ratio) % 1.0
    light = light_start + (light_end - light_start) * ratio
    saturation = sat_start + (sat_end - sat_start) * ratio
    return colorsys.hls_to_rgb(hue, light, saturation)


def _format_count(value):
    """按账本数值的整数性生成紧凑标签。"""
    number = float(value)
    if np.isclose(number, round(number), rtol=0.0, atol=1e-9):
        return str(int(round(number)))
    return f"{number:.2f}"


def _draw_panel(ax, reject_values, accept_values, confidence, x_offset, tag):
    pooled = np.concatenate((reject_values, accept_values))
    score_min = float(min(pooled.min(), 0.0))
    score_max = float(max(pooled.max(), 0.0))
    score_range = score_max - score_min
    if score_range == 0.0:
        score_range = 1.0

    for series_index, (values, high_color, low_color, marker, linestyle) in enumerate(
        (
            (reject_values, PALETTE[0], PALETTE[2], "o", "-"),
            (accept_values, PALETTE[1], PALETTE[3], "D", (0, (3, 1))),
        )
    ):
        direction = -1.0 if series_index == 0 else 1.0
        for confidence_value, value in zip(confidence, values):
            ratio = (float(value) - score_min) / score_range
            color = _interpolate_color(low_color, high_color, ratio)
            x_value = float(confidence_value) + direction * x_offset
            line_width = 1.5 + 1.5 * ratio
            marker_size = 30.0 + 34.0 * ratio

            ax.plot(
                [x_value, x_value],
                [0.0, float(value)],
                color=color,
                linewidth=line_width,
                linestyle=linestyle,
                solid_capstyle="round",
                zorder=3,
            )
            ax.scatter(
                [x_value],
                [float(value)],
                s=marker_size,
                marker=marker,
                color=color,
                edgecolors="white",
                linewidths=1.0,
                zorder=5,
            )

    label_gap = score_range * 0.028
    for index, (reject_value, accept_value) in enumerate(
        zip(reject_values, accept_values)
    ):
        if np.isclose(reject_value, accept_value):
            ax.annotate(
                _format_count(reject_value),
                (float(confidence[index]), float(reject_value)),
                xytext=(0.0, label_gap),
                textcoords="data",
                ha="center",
                va="bottom",
                fontsize=6.8,
                color=COLORS["gray"],
                bbox={
                    "boxstyle": "round,pad=0.12",
                    "facecolor": _lighten(COLORS["gray"], 0.88),
                    "edgecolor": "none",
                    "alpha": 0.88,
                },
                zorder=6,
            )
        else:
            ax.annotate(
                _format_count(reject_value),
                (
                    float(confidence[index]) - x_offset,
                    float(reject_value),
                ),
                xytext=(0.0, label_gap),
                textcoords="data",
                ha="center",
                va="bottom",
                fontsize=6.5,
                color=PALETTE[0],
                zorder=6,
            )
            ax.annotate(
                _format_count(accept_value),
                (
                    float(confidence[index]) + x_offset,
                    float(accept_value),
                ),
                xytext=(0.0, label_gap),
                textcoords="data",
                ha="center",
                va="bottom",
                fontsize=6.5,
                color=PALETTE[1],
                zorder=6,
            )

    median_value = float(np.median(pooled))
    ax.axhline(
        median_value,
        color=COLORS["ref_line"],
        linestyle=":",
        linewidth=1.2,
        alpha=0.8,
        zorder=1,
    )

    confidence_span = float(np.ptp(confidence))
    if confidence_span == 0.0:
        confidence_span = 1.0
    ax.set_xlim(
        float(confidence.min()) - confidence_span * 0.08,
        float(confidence.max()) + confidence_span * 0.08,
    )

    if score_min >= 0.0:
        ax.set_ylim(0.0, score_max + score_range * 0.17)
    else:
        ax.set_ylim(
            score_min - score_range * 0.08,
            score_max + score_range * 0.17,
        )

    ax.set_xticks(confidence)
    ax.set_xticklabels([str(value) for value in confidence])
    ax.set_xlabel(cn("置信水平（账本原值）"), fontsize=9.5)
    ax.set_ylabel(cn("件数"), fontsize=9.5)
    ax.tick_params(axis="both", labelsize=7.8)
    ax.grid(
        axis="y",
        color=COLORS["grid"],
        linestyle="-",
        linewidth=0.7,
        alpha=0.32,
    )
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    panel(ax, tag)

    legend_handles = [
        Line2D(
            [0],
            [0],
            color=PALETTE[0],
            linewidth=2.0,
            marker="o",
            markersize=5.0,
            label=cn("拒收口径"),
        ),
        Line2D(
            [0],
            [0],
            color=PALETTE[1],
            linewidth=2.0,
            linestyle=(0, (3, 1)),
            marker="D",
            markersize=4.6,
            label=cn("接收口径"),
        ),
        Line2D(
            [0],
            [0],
            color=COLORS["ref_line"],
            linewidth=1.2,
            linestyle=":",
            label=f"{cn('中位数')}={_format_count(median_value)}",
        ),
    ]
    ax.legend(
        handles=legend_handles,
        loc="lower right",
        frameon=False,
        fontsize=7.2,
        handlelength=2.1,
        borderaxespad=0.4,
    )


doc = load("results.json")
values = {row["result_id"]: row["value"] for row in doc["results"]}

confidence = np.asarray(values["R-Q1-ssvc-confidence"], dtype=float)
n_reject = np.asarray(values["R-Q1-ssvc-n-reject"], dtype=float)
c_reject = np.asarray(values["R-Q1-ssvc-c-reject"], dtype=float)
n_accept = np.asarray(values["R-Q1-ssvc-n-accept"], dtype=float)
c_accept = np.asarray(values["R-Q1-ssvc-c-accept"], dtype=float)

series_lengths = {
    len(confidence),
    len(n_reject),
    len(c_reject),
    len(n_accept),
    len(c_accept),
}
if len(series_lengths) != 1:
    raise ValueError("Q1 样本量扫描的账本序列长度不一致")

if confidence.size > 1:
    x_gap = float(np.median(np.abs(np.diff(confidence))))
    if x_gap == 0.0:
        x_gap = 1.0
    x_offset = 0.12 * x_gap
else:
    x_offset = 0.0

fig, axes = plt.subplots(
    1,
    2,
    figsize=(6.0, 4.0),
    gridspec_kw={"wspace": 0.34},
)

_draw_panel(
    axes[0],
    n_reject,
    n_accept,
    confidence,
    x_offset,
    "(a)",
)
_draw_panel(
    axes[1],
    c_reject,
    c_accept,
    confidence,
    x_offset,
    "(b)",
)

fig.tight_layout(w_pad=1.1)
save(fig, "fig_q1_sample_size_vs_confidence")
