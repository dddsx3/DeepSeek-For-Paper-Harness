"""对比问题1两种抽样情形的最小样本量、临界次品数与折算抽样费用。

面板(a)比较两种情形的最小样本量和临界次品数；面板(b)单独比较折算抽样费用，避免不同量纲共用纵轴。数据取自账本 R-Q1-case95-n、R-Q1-case95-c、R-Q1-case90-n、R-Q1-case90-c、R-Q1-sampling-unit-cost、R-Q1-sampling-cost-case95 和 R-Q1-sampling-cost-case90。关键数值均在运行时读取，不在注释中复制结果快照。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
import matplotlib.pyplot as plt


def _read_ledger(document):
    records = document.get("results") if isinstance(document, dict) else document
    if not isinstance(records, list):
        raise TypeError("results.json 未包含可解析的 results 数组")
    return {record["result_id"]: record["value"] for record in records}


def _draw_grouped_bars(ax, categories, series, xlabel, ylabel):
    positions = list(range(len(categories)))
    series_count = len(series)
    width = 0.34
    all_values = [value for _, values in series for value in values]
    peak = max(all_values)
    span = peak if peak > 0 else 1
    upper = span * 1.20
    label_pad = upper * 0.018

    ax.axhspan(0, upper, color=PALETTE[0], alpha=0.025, zorder=0)

    for series_index, (name, values) in enumerate(series):
        offsets = [
            (category_index - (series_count - 1) / 2) * width
            for category_index in positions
        ]
        centers = [
            position + offset for position, offset in zip(positions, offsets)
        ]
        ax.bar(
            [center + width * 0.04 for center in centers],
            values,
            width,
            color=PALETTE[series_index],
            alpha=0.08,
            edgecolor="none",
            zorder=1,
        )
        bars = ax.bar(
            centers,
            values,
            width,
            color=_lighten(PALETTE[series_index], 0.55),
            edgecolor=PALETTE[series_index],
            linewidth=1.4,
            label=name,
            zorder=2,
        )

        for category_index, (bar, value) in enumerate(zip(bars, values)):
            column_values = [values_other[category_index] for _, values_other in series]
            is_highlighted = value == max(column_values)
            prefix = "★" if is_highlighted else ""
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                value + label_pad,
                f"{prefix}{value:,.0f}",
                ha="center",
                va="bottom",
                fontsize=7.2,
                fontweight="bold" if is_highlighted else "normal",
                color=PALETTE[series_index] if is_highlighted else COLORS["gray"],
                bbox=(
                    {
                        "boxstyle": "round,pad=0.12",
                        "facecolor": "white",
                        "edgecolor": "none",
                        "alpha": 0.78,
                    }
                    if is_highlighted
                    else None
                ),
                zorder=4,
            )

    global_mean = sum(all_values) / len(all_values)
    ax.axhline(
        global_mean,
        color=COLORS["ref_line"],
        linestyle="--",
        linewidth=0.9,
        alpha=0.65,
        zorder=0,
    )
    ax.text(
        len(categories) - 0.52,
        global_mean + upper * 0.015,
        f"{cn('两情形均值')} {global_mean:,.0f}",
        fontsize=7,
        color=COLORS["ref_line"],
        ha="right",
        va="bottom",
        style="italic",
        bbox={
            "boxstyle": "round,pad=0.18",
            "facecolor": "white",
            "edgecolor": "none",
            "alpha": 0.82,
        },
        zorder=3,
    )

    ax.set_xticks(positions)
    ax.set_xticklabels(categories, fontsize=8.5)
    ax.set_xlim(-0.5, len(categories) - 0.5)
    ax.set_ylim(0, upper)
    ax.set_xlabel(cn(xlabel), fontsize=8.5)
    ax.set_ylabel(cn(ylabel), fontsize=8.5)
    ax.tick_params(axis="both", labelsize=7.5)
    ax.set_axisbelow(True)
    ax.grid(
        axis="y",
        color=COLORS["grid"],
        linestyle="--",
        linewidth=0.7,
        alpha=0.35,
    )
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


doc = load("results.json")
ledger = _read_ledger(doc)

case95_n = float(ledger["R-Q1-case95-n"])
case95_c = float(ledger["R-Q1-case95-c"])
case90_n = float(ledger["R-Q1-case90-n"])
case90_c = float(ledger["R-Q1-case90-c"])
sampling_unit_cost = float(ledger["R-Q1-sampling-unit-cost"])
sampling_cost_case95 = float(ledger["R-Q1-sampling-cost-case95"])
sampling_cost_case90 = float(ledger["R-Q1-sampling-cost-case90"])

reject_label = cn("拒收情形")
accept_label = cn("接收情形")

fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8))

_draw_grouped_bars(
    axes[0],
    [cn("最小样本量 n*"), cn("临界次品数 c*")],
    [
        (reject_label, [case95_n, case95_c]),
        (accept_label, [case90_n, case90_c]),
    ],
    "抽样判定量",
    "数量（件）",
)
panel(axes[0], "(a)")

cost_category = f"{cn('抽样费用')}\n({sampling_unit_cost:g} {cn('元/件')})"
_draw_grouped_bars(
    axes[1],
    [cost_category],
    [
        (reject_label, [sampling_cost_case95]),
        (accept_label, [sampling_cost_case90]),
    ],
    "折算费用",
    "费用（元）",
)
panel(axes[1], "(b)")

handles, legend_labels = axes[0].get_legend_handles_labels()
fig.legend(
    handles,
    legend_labels,
    loc="upper center",
    bbox_to_anchor=(0.5, 0.99),
    ncol=2,
    frameon=False,
    fontsize=8,
    handlelength=1.5,
    columnspacing=1.4,
)
fig.tight_layout(rect=(0.01, 0.02, 0.99, 0.80), w_pad=2.2)
save(fig, "fig_q1_two_cases_sample_size")
