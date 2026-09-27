"""问题2次品率置信区间森林图。

面板 (a) 按 case_id 排序展示前半部分情形，面板 (b) 展示后半部分情形；
每个情形依次绘制 p1、p2、p0 的置信区间，并在右侧列出区间端点。
全部区间来自账本 R-Q4-q2；样本量、置信水平和重抽样次数分别来自
R-Q4-sample-size-used、R-Q4-ci-level、R-Q4-resample-count，并动态写入页脚。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator, PercentFormatter
import numpy as np


def _values_by_id(document):
    rows = document.get("results", document) if isinstance(document, dict) else document
    return {row["result_id"]: row["value"] for row in rows}


def main():
    document = load("results.json")
    values = _values_by_id(document)

    q2_rows = values["R-Q4-q2"]
    sample_size = values["R-Q4-sample-size-used"]
    confidence_level = values["R-Q4-ci-level"]
    resample_count = values["R-Q4-resample-count"]

    if not q2_rows:
        raise ValueError("R-Q4-q2 不含可绘制的数据行")

    ordered_cases = sorted(q2_rows, key=lambda row: row["case_id"])
    parameter_order = tuple(ordered_cases[0]["ci"].keys())
    if not parameter_order:
        raise ValueError("R-Q4-q2 不含置信区间参数")

    case_blocks = []
    for case_row in ordered_cases:
        confidence_intervals = case_row["ci"]
        if set(confidence_intervals) != set(parameter_order):
            raise ValueError("各情形的置信区间参数不一致")

        block = []
        for parameter in parameter_order:
            bounds = confidence_intervals[parameter]
            if len(bounds) != 2:
                raise ValueError(f"{case_row['case_id']} 的 {parameter} 区间端点不完整")
            lower, upper = map(float, bounds)
            if lower > upper:
                raise ValueError(f"{case_row['case_id']} 的 {parameter} 区间顺序无效")
            block.append((case_row["case_id"], parameter, lower, upper))
        case_blocks.append(block)

    split_at = (len(case_blocks) + 1) // 2
    panel_blocks = [case_blocks[:split_at], case_blocks[split_at:]]

    all_bounds = [
        bound
        for case_block in case_blocks
        for _, _, lower, upper in case_block
        for bound in (lower, upper)
    ]
    x_min = 0.0
    x_max = max(all_bounds) + (max(all_bounds) - min(all_bounds)) * 0.08

    fig = plt.figure(figsize=(6.0, 4.8))
    outer = fig.add_gridspec(
        nrows=1,
        ncols=2,
        left=0.055,
        right=0.985,
        bottom=0.095,
        top=0.975,
        wspace=0.28,
    )

    text_color = COLORS["gray"]
    panel_tags = ("(a)", "(b)")
    parameters_per_case = len(parameter_order)

    for panel_index, case_block in enumerate(panel_blocks):
        inner = outer[0, panel_index].subgridspec(
            nrows=1,
            ncols=3,
            width_ratios=(1.15, 2.2, 1.05),
            wspace=0.05,
        )
        label_ax = fig.add_subplot(inner[0, 0])
        forest_ax = fig.add_subplot(inner[0, 1])
        numeric_ax = fig.add_subplot(inner[0, 2])

        row_count = len(case_block) * parameters_per_case
        y_positions = np.arange(row_count, dtype=float)
        y_bottom = row_count - 0.15
        y_top = -0.95
        header_y = -0.70

        for label_axis in (label_ax, numeric_ax):
            label_axis.set_xlim(0.0, 1.0)
            label_axis.set_ylim(y_bottom, y_top)
            label_axis.set_xticks([])
            label_axis.set_yticks([])
            label_axis.patch.set_alpha(0.0)
            for spine in label_axis.spines.values():
                spine.set_visible(False)

        forest_ax.set_xlim(x_min, x_max)
        forest_ax.set_ylim(y_bottom, y_top)
        forest_ax.set_yticks([])
        forest_ax.set_xlabel(cn("次品率置信区间"), fontsize=9, color=text_color)
        forest_ax.tick_params(axis="x", labelsize=7.5, colors=text_color, length=3)
        forest_ax.xaxis.set_major_locator(MaxNLocator(nbins=5))
        forest_ax.xaxis.set_major_formatter(PercentFormatter(xmax=1.0))
        forest_ax.grid(
            axis="x",
            color=COLORS["grid"],
            linestyle="--",
            linewidth=0.7,
            alpha=0.85,
        )
        forest_ax.set_axisbelow(True)
        forest_ax.spines["top"].set_visible(False)
        forest_ax.spines["right"].set_visible(False)
        forest_ax.spines["left"].set_visible(False)
        forest_ax.spines["bottom"].set_color(COLORS["ref_line"])
        forest_ax.spines["bottom"].set_linewidth(0.8)

        row_index = 0
        for case_block_index, block in enumerate(case_block):
            for case_id, parameter, lower, upper in block:
                y = y_positions[row_index]
                parameter_index = parameter_order.index(parameter)
                interval_color = PALETTE[parameter_index % len(PALETTE)]

                if row_index % 2 == 0:
                    forest_ax.axhspan(
                        y - 0.45,
                        y + 0.45,
                        color=_lighten(COLORS["gray"], 0.93),
                        alpha=0.55,
                        zorder=0,
                    )

                forest_ax.plot(
                    [lower, upper],
                    [y, y],
                    color=interval_color,
                    linewidth=2.0,
                    solid_capstyle="round",
                    zorder=3,
                )
                forest_ax.plot(
                    [lower, lower],
                    [y - 0.13, y + 0.13],
                    color=interval_color,
                    linewidth=1.2,
                    zorder=3,
                )
                forest_ax.plot(
                    [upper, upper],
                    [y - 0.13, y + 0.13],
                    color=interval_color,
                    linewidth=1.2,
                    zorder=3,
                )

                label_ax.text(
                    1.0,
                    y,
                    cn(f"情况 {case_id} · {parameter}"),
                    ha="right",
                    va="center",
                    fontsize=7.4,
                    color=text_color,
                )
                numeric_ax.text(
                    0.0,
                    y,
                    f"[{lower:.3f}, {upper:.3f}]",
                    ha="left",
                    va="center",
                    fontsize=7.0,
                    fontfamily="monospace",
                    color=interval_color,
                )

                if row_index > 0 and row_index % parameters_per_case == 0:
                    forest_ax.axhline(
                        y - 0.52,
                        color=COLORS["ref_line"],
                        linewidth=0.8,
                        alpha=0.8,
                        zorder=1,
                    )
                row_index += 1

        label_ax.text(
            1.0,
            header_y,
            cn("情形 · 参数"),
            ha="right",
            va="center",
            fontsize=8.2,
            fontweight="bold",
            color=text_color,
        )
        numeric_ax.text(
            0.0,
            header_y,
            cn(f"{confidence_level:.0%} 置信区间"),
            ha="left",
            va="center",
            fontsize=7.6,
            fontweight="bold",
            color=text_color,
        )
        panel(forest_ax, panel_tags[panel_index])

    fig.text(
        0.008,
        0.53,
        cn("情形与参数"),
        rotation=90,
        ha="center",
        va="center",
        fontsize=9,
        color=text_color,
    )
    metadata = cn(
        f"样本量 {sample_size:.0f} 件；"
        f"置信水平 {confidence_level:.0%}；"
        f"重抽样 {resample_count:.0f} 次"
    )
    fig.text(
        0.5,
        0.022,
        metadata,
        ha="center",
        va="bottom",
        fontsize=7.8,
        color=text_color,
        bbox={
            "boxstyle": "round,pad=0.30",
            "facecolor": _lighten(COLORS["gray"], 0.93),
            "edgecolor": _lighten(COLORS["gray"], 0.72),
            "alpha": 0.95,
        },
    )

    save(fig, "fig_q2_sensitivity_defect_rate")
    plt.close(fig)


if __name__ == "__main__":
    main()
