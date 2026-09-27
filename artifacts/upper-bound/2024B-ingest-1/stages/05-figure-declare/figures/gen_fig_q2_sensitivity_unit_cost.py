"""六种表1情况的单位期望成本棒棒糖排序。

panel (a)：按单位期望成本 U 从低到高排列六种情况，利润作为每行的数值锚点。
账本来源：R-Q2-case1-U 至 R-Q2-case6-U，以及对应的 R-Q2-case1-profit
至 R-Q2-case6-profit。关键数值均由 results.json 实时读取，不在脚本中固化。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
import colorsys
import matplotlib.colors as mc
import matplotlib.pyplot as plt
import numpy as np


def interpolate_color(color_a, color_b, ratio):
    """在 HSL 空间插颜色，ratio=0 返回 color_a，ratio=1 返回 color_b。"""
    rgb_a = mc.to_rgb(color_a)
    rgb_b = mc.to_rgb(color_b)
    hue_a, light_a, sat_a = colorsys.rgb_to_hls(*rgb_a)
    hue_b, light_b, sat_b = colorsys.rgb_to_hls(*rgb_b)

    if abs(hue_b - hue_a) > 0.5:
        if hue_a < hue_b:
            hue_a += 1.0
        else:
            hue_b += 1.0

    hue = (hue_a + (hue_b - hue_a) * ratio) % 1.0
    light = light_a + (light_b - light_a) * ratio
    saturation = sat_a + (sat_b - sat_a) * ratio
    return colorsys.hls_to_rgb(hue, light, saturation)


def main():
    document = load("results.json")
    records = {
        record["result_id"]: record["value"]
        for record in document["results"]
    }

    cost_refs = [
        "R-Q2-case1-U",
        "R-Q2-case2-U",
        "R-Q2-case3-U",
        "R-Q2-case4-U",
        "R-Q2-case5-U",
        "R-Q2-case6-U",
    ]
    case_numbers = [ref.removeprefix("R-Q2-case").removesuffix("-U") for ref in cost_refs]
    profit_refs = [f"R-Q2-case{number}-profit" for number in case_numbers]

    required_refs = cost_refs + profit_refs
    missing = [ref for ref in required_refs if ref not in records]
    if missing:
        raise KeyError(f"results.json 缺少绘图所需 result_id: {missing}")

    costs = np.asarray([records[ref] for ref in cost_refs], dtype=float)
    profits = np.asarray([records[ref] for ref in profit_refs], dtype=float)
    order = np.argsort(costs, kind="stable")
    sorted_costs = costs[order]
    sorted_profits = profits[order]
    sorted_cases = [case_numbers[index] for index in order]

    item_count = len(sorted_costs)
    cost_min = float(np.min(sorted_costs))
    cost_max = float(np.max(sorted_costs))
    cost_range = cost_max - cost_min if cost_max > cost_min else 1.0
    median_cost = float(np.median(sorted_costs))

    color_start = PALETTE[0]
    color_end = PALETTE[1]
    item_colors = [
        interpolate_color(
            color_start,
            color_end,
            index / (item_count - 1) if item_count > 1 else 0.0,
        )
        for index in range(item_count)
    ]

    figure_height = max(4.0, item_count * 0.46 + 1.8)
    fig, ax = plt.subplots(figsize=(6.0, figure_height))
    y_positions = np.arange(item_count)

    ax.grid(
        axis="x",
        alpha=0.12,
        linestyle="-",
        color=COLORS["grid"],
    )
    ax.set_axisbelow(True)
    ax.axvline(
        median_cost,
        color=COLORS["ref_line"],
        linestyle=":",
        linewidth=1.0,
        alpha=0.55,
        zorder=1,
    )

    for index, (case_number, cost, profit, item_color) in enumerate(
        zip(sorted_cases, sorted_costs, sorted_profits, item_colors)
    ):
        normalized_cost = (cost - cost_min) / cost_range
        line_width = 1.6 + 2.0 * normalized_cost
        dot_size = 55.0 + 120.0 * normalized_cost
        rank = index + 1

        ax.plot(
            [0.0, cost],
            [y_positions[index], y_positions[index]],
            color=item_color,
            linewidth=line_width,
            zorder=3,
            solid_capstyle="round",
        )
        ax.scatter(
            cost,
            y_positions[index],
            color=item_color,
            s=dot_size,
            zorder=5,
            edgecolors="white",
            linewidths=1.8,
        )
        ax.text(
            cost + cost_range * 0.02,
            y_positions[index],
            cn(f"U {cost:.2f}\n利润 {profit:.2f}"),
            fontsize=8.5,
            fontweight="bold" if rank <= 3 else "normal",
            color=item_color,
            va="center",
            ha="left",
            linespacing=0.95,
        )

        badge_x = -cost_range * 0.065
        if rank <= 3:
            badge = plt.Circle(
                (badge_x, y_positions[index]),
                0.3,
                color=_lighten(item_color, 0.15),
                zorder=6,
                transform=ax.transData,
            )
            ax.add_patch(badge)
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
                color=_lighten(item_color, 0.2),
                ha="center",
                va="center",
                fontweight="bold",
            )

    ax.axhspan(
        y_positions[0] - 0.42,
        y_positions[0] + 0.42,
        alpha=0.06,
        color=item_colors[0],
        zorder=0,
    )
    ax.text(
        median_cost,
        -0.9,
        cn(f"中位数 {median_cost:.2f}"),
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
    ax.set_yticklabels(
        [cn(f"情况 {case_number}") for case_number in sorted_cases],
        fontsize=10,
    )
    ax.set_xlabel(cn("单位期望成本 U（元/件）"), fontsize=11)
    ax.set_ylabel(cn("表1情况"), fontsize=10)
    ax.set_xlim(-cost_range * 0.13, cost_max + cost_range * 0.30)
    ax.set_ylim(item_count - 0.5, -1.4)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    panel(ax, "(a)")
    fig.tight_layout()
    save(fig, "fig_q2_sensitivity_unit_cost")


if __name__ == "__main__":
    main()
