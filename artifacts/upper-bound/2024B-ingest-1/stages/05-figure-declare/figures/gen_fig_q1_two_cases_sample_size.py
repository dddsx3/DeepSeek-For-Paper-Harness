"""展示两种指定判定情形的最小抽样方案。
(a) 比较两种情形的最小检测次数；(b) 比较两种情形的临界次品数。
数据来自 results.json 中的 R-Q1-case95-n、R-Q1-case95-c、R-Q1-case90-n 和 R-Q1-case90-c。
关键数值由上述四个账本键在运行时直接注入，柱顶标签同步显示对应读数。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt


RESULT_REFS = (
    "R-Q1-case95-n",
    "R-Q1-case95-c",
    "R-Q1-case90-n",
    "R-Q1-case90-c",
)


def _result_value(doc, result_id):
    """从 results.json 账本中按 result_id 取值。"""
    if isinstance(doc, dict):
        for record in doc.get("results", []):
            if record.get("result_id") == result_id:
                return record["value"]
        if result_id in doc:
            return doc[result_id]
    else:
        for record in doc:
            if record.get("result_id") == result_id:
                return record["value"]
    raise KeyError(result_id)


def _draw_bars(ax, values, labels, color, y_label, panel_label):
    positions = list(range(len(values)))
    bars = ax.bar(
        positions,
        values,
        width=0.52,
        color=_lighten(color, 0.5),
        edgecolor=color,
        linewidth=1.2,
        zorder=3,
    )

    ax.set_xlabel(cn("判定情形"))
    ax.set_ylabel(cn(y_label))
    ax.set_xticks(positions)
    ax.set_xticklabels(labels)
    ax.grid(axis="y", color=COLORS["grid"], linewidth=0.8, alpha=0.8, zorder=0)
    ax.set_axisbelow(True)

    maximum = max(values)
    upper = maximum * 1.18 if maximum > 0 else 1.0
    ax.set_ylim(0, upper)
    ax.bar_label(
        bars,
        labels=[f"{value:.0f}" for value in values],
        padding=3,
        fontsize=8,
        color=COLORS["gray"],
    )
    ax.legend(
        [bars],
        [cn(y_label)],
        frameon=False,
        loc="upper left",
        fontsize=8,
    )

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(COLORS["gray"])
    ax.spines["bottom"].set_color(COLORS["gray"])
    ax.tick_params(axis="both", colors=COLORS["gray"])
    panel(ax, panel_label)


def main():
    doc = load("results.json")
    n_values = [_result_value(doc, RESULT_REFS[0]), _result_value(doc, RESULT_REFS[2])]
    c_values = [_result_value(doc, RESULT_REFS[1]), _result_value(doc, RESULT_REFS[3])]
    case_labels = [cn("拒收情形"), cn("接收情形")]

    fig, axes = plt.subplots(
        1,
        2,
        figsize=(6.0, 2.8),
        gridspec_kw={"wspace": 0.32},
    )

    _draw_bars(
        axes[0],
        n_values,
        case_labels,
        PALETTE[0],
        "最小检测次数（件）",
        "(a)",
    )
    _draw_bars(
        axes[1],
        c_values,
        case_labels,
        PALETTE[1],
        "临界次品数（件）",
        "(b)",
    )

    fig.tight_layout(pad=1.0)
    save(fig, "fig_q1_two_cases_sample_size")
    plt.close(fig)


if __name__ == "__main__":
    main()
