"""成品节点各 (Z,D) 策略的根节点单位成本与单位利润成对比较。

Panel (a)：纵向哑铃连接同一成品策略的单位成本与单位利润端点，
空心圆表示根节点单位成本，实心菱形表示单位利润，端点数值由账本逐行标注。
数据仅来自账本 R-Q3-product-strategy-compare；策略标签、U_root 与 profit
均由该表的对应记录读取，不在脚本中写入结果数值。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
import numpy as np


def main():
    doc = load("results.json")
    if not isinstance(doc, dict) or not isinstance(doc.get("results"), list):
        raise ValueError("results.json 缺少合法的 results 列表")

    result_values = {
        item["result_id"]: item["value"]
        for item in doc["results"]
        if isinstance(item, dict) and "result_id" in item
    }
    rows = result_values["R-Q3-product-strategy-compare"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("R-Q3-product-strategy-compare 必须是非空数组")

    required_fields = {"Z", "D", "U_root", "profit"}
    if any(not required_fields.issubset(row) for row in rows):
        raise ValueError("成品策略记录缺少 Z、D、U_root 或 profit 字段")

    labels = [f"(Z={row['Z']}, D={row['D']})" for row in rows]
    unit_cost = np.asarray([row["U_root"] for row in rows], dtype=float)
    unit_profit = np.asarray([row["profit"] for row in rows], dtype=float)
    x = np.arange(len(rows))

    fig, ax = plt.subplots(figsize=(6.0, 3.6))
    connector_halo = _lighten(PALETTE[2], 0.55)

    for xi, cost, profit in zip(x, unit_cost, unit_profit):
        lower = min(cost, profit)
        upper = max(cost, profit)
        ax.vlines(
            xi,
            lower,
            upper,
            color=connector_halo,
            linewidth=5.0,
            alpha=0.65,
            zorder=1,
        )
        ax.vlines(
            xi,
            lower,
            upper,
            color=PALETTE[2],
            linewidth=1.8,
            zorder=2,
        )

    ax.scatter(
        unit_cost,
        x,
        s=92,
        marker="o",
        facecolors="white",
        edgecolors=PALETTE[3],
        linewidths=2.0,
        zorder=3,
        label=cn(r"根节点单位成本 $U_{root}$"),
    )
    ax.scatter(
        unit_profit,
        x,
        s=66,
        marker="D",
        color=PALETTE[0],
        edgecolors="white",
        linewidths=0.8,
        zorder=4,
        label=cn("单位利润"),
    )

    for xi, cost, profit in zip(x, unit_cost, unit_profit):
        ax.annotate(
            f"{cost:.2f}",
            xy=(xi, cost),
            xytext=(-11, 8),
            textcoords="offset points",
            ha="right",
            va="bottom",
            fontsize=8.5,
            color=PALETTE[3],
            fontweight="bold",
        )
        ax.annotate(
            f"{profit:.2f}",
            xy=(xi, profit),
            xytext=(11, -8),
            textcoords="offset points",
            ha="left",
            va="top",
            fontsize=8.5,
            color=PALETTE[0],
            fontweight="bold",
        )

    finite_values = np.concatenate([unit_cost, unit_profit])
    lower_limit = float(np.min(finite_values))
    upper_limit = float(np.max(finite_values))
    value_span = upper_limit - lower_limit
    value_padding = value_span * 0.18
    ax.set_ylim(lower_limit - value_padding, upper_limit + value_padding)
    ax.set_xlim(-0.65, len(rows) - 0.05)

    ax.axvline(
        0.0,
        color=COLORS["ref_line"],
        linestyle="--",
        linewidth=1.0,
        alpha=0.8,
        zorder=0,
    )
    ax.grid(
        axis="y",
        color=COLORS["grid"],
        linestyle="-",
        linewidth=0.8,
        alpha=0.35,
    )
    ax.set_axisbelow(True)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9.5)
    ax.set_xlabel(cn("成品策略 (Z,D)"), fontsize=11)
    ax.set_ylabel(cn("金额（元/件）"), fontsize=11)
    ax.tick_params(axis="both", labelsize=9)

    ax.legend(
        loc="lower right",
        frameon=False,
        fontsize=8.8,
        handlelength=1.5,
        labelspacing=0.35,
    )
    panel(ax, "(a)")

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    save(fig, "fig_q3_strategy_cost_compare")


if __name__ == "__main__":
    main()
