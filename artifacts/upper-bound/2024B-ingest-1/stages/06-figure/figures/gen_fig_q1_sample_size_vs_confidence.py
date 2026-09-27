"""绘制置信水平与最小抽样规模的雙面板折线图。

(a) 比较拒收与接收口径下的最小样本量 n*；(b) 比较对应的临界次品数 c*。
全部绘图数据来自账本 R-Q1-ssvc-confidence、R-Q1-ssvc-n-reject、
R-Q1-ssvc-c-reject、R-Q1-ssvc-n-accept 和 R-Q1-ssvc-c-accept。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, MaxNLocator


def main():
    doc = load("results.json")
    rows = doc["results"]
    values = {row["result_id"]: row["value"] for row in rows}

    required_ids = (
        "R-Q1-ssvc-confidence",
        "R-Q1-ssvc-n-reject",
        "R-Q1-ssvc-c-reject",
        "R-Q1-ssvc-n-accept",
        "R-Q1-ssvc-c-accept",
    )
    missing = [result_id for result_id in required_ids if result_id not in values]
    if missing:
        raise KeyError(f"results.json 缺少绘图所需 result_id: {missing}")

    confidence = [float(item) for item in values["R-Q1-ssvc-confidence"]]
    n_reject = [float(item) for item in values["R-Q1-ssvc-n-reject"]]
    c_reject = [float(item) for item in values["R-Q1-ssvc-c-reject"]]
    n_accept = [float(item) for item in values["R-Q1-ssvc-n-accept"]]
    c_accept = [float(item) for item in values["R-Q1-ssvc-c-accept"]]

    series_lengths = {
        len(confidence),
        len(n_reject),
        len(c_reject),
        len(n_accept),
        len(c_accept),
    }
    if len(series_lengths) != 1:
        raise ValueError("置信水平扫描序列长度不一致，不能直接对齐绘图")

    fig, axes = plt.subplots(
        1,
        2,
        figsize=(6.0, 2.8),
        sharex=True,
        constrained_layout=True,
    )

    def draw_comparison(ax, reject_values, accept_values, ylabel, panel_tag):
        reject_color = PALETTE[0]
        accept_color = PALETTE[1]

        ax.fill_between(
            confidence,
            reject_values,
            color=_lighten(reject_color, 0.82),
            alpha=0.10,
            linewidth=0,
            zorder=1,
        )
        ax.fill_between(
            confidence,
            accept_values,
            color=_lighten(accept_color, 0.82),
            alpha=0.10,
            linewidth=0,
            zorder=1,
        )

        ax.plot(
            confidence,
            reject_values,
            color=_lighten(reject_color, 0.38),
            linewidth=4.6,
            alpha=0.78,
            solid_capstyle="round",
            label=cn("拒收口径"),
            zorder=2,
        )
        ax.plot(
            confidence,
            accept_values,
            color=accept_color,
            linewidth=1.7,
            linestyle="--",
            marker="o",
            markersize=3.4,
            markerfacecolor=_lighten(accept_color, 0.82),
            markeredgecolor=accept_color,
            markeredgewidth=0.8,
            label=cn("接收口径"),
            zorder=3,
        )

        if reject_values == accept_values:
            ax.text(
                0.98,
                0.96,
                cn("两口径序列重合"),
                transform=ax.transAxes,
                ha="right",
                va="top",
                fontsize=7.2,
                color=COLORS["gray"],
            )

        ax.set_xlabel(cn("置信水平"))
        ax.set_ylabel(cn(ylabel))
        ax.xaxis.set_major_locator(MaxNLocator(nbins=5))
        ax.xaxis.set_major_formatter(
            FuncFormatter(lambda value, _position: f"{value:.0%}")
        )
        ax.set_axisbelow(True)
        ax.grid(
            True,
            which="major",
            axis="both",
            color=COLORS["grid"],
            linewidth=0.6,
            alpha=0.72,
        )
        ax.tick_params(axis="both", labelsize=7.8, colors=COLORS["gray"])
        ax.margins(x=0.04)

        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        for side in ("left", "bottom"):
            ax.spines[side].set_color(COLORS["gray"])
            ax.spines[side].set_linewidth(0.8)

        ax.legend(
            loc="upper left",
            frameon=False,
            fontsize=7.2,
            handlelength=2.8,
            borderaxespad=0.2,
        )
        panel(ax, panel_tag)

    draw_comparison(
        axes[0],
        n_reject,
        n_accept,
        "最小样本量 n*（件）",
        "(a)",
    )
    draw_comparison(
        axes[1],
        c_reject,
        c_accept,
        "临界次品数 c*（件）",
        "(b)",
    )

    save(fig, "fig_q1_sample_size_vs_confidence")


if __name__ == "__main__":
    main()
