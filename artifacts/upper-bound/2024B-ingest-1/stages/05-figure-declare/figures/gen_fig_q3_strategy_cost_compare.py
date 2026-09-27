"""问题3节点级决策与成品策略经济性的双面板对照。

面板(a)按装配节点展开基准拓扑中的 Z、D 决策，并标注节点局部成本 U。
面板(b)以哑铃图连接四种成品 (Z,D) 策略的根节点成本与单位期望利润，
同时突出账本给出的基准策略。
数据来自账本 R-Q3-baseline-best-decision、R-Q3-baseline-node-cost、
R-Q3-product-strategy-compare、R-Q3-baseline-U-root 和
R-Q3-baseline-profit；全部数值在运行时读取，不在脚本中固化。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
import numpy as np


REQUIRED_RESULT_IDS = (
    "R-Q3-baseline-best-decision",
    "R-Q3-baseline-node-cost",
    "R-Q3-product-strategy-compare",
    "R-Q3-baseline-U-root",
    "R-Q3-baseline-profit",
)


def main():
    doc = load("results.json")
    results = doc.get("results", [])
    if not isinstance(results, list):
        raise ValueError("results.json 缺少合法的 results 数组")

    ledger = {}
    for item in results:
        result_id = item.get("result_id")
        if result_id is not None:
            ledger[result_id] = item.get("value")

    missing = [
        result_id
        for result_id in REQUIRED_RESULT_IDS
        if result_id not in ledger
    ]
    if missing:
        raise KeyError(f"results.json 缺少绘图所需账本项：{missing}")

    node_decisions = ledger["R-Q3-baseline-best-decision"]
    node_costs = ledger["R-Q3-baseline-node-cost"]
    strategies = ledger["R-Q3-product-strategy-compare"]
    baseline_u = float(ledger["R-Q3-baseline-U-root"])
    baseline_profit = float(ledger["R-Q3-baseline-profit"])

    if not isinstance(node_decisions, dict) or not node_decisions:
        raise ValueError("基准节点决策记录为空")
    if not isinstance(node_costs, dict):
        raise ValueError("节点成本记录格式错误")
    if not isinstance(strategies, list) or not strategies:
        raise ValueError("成品策略比较表为空")

    nodes = list(node_decisions)
    missing_costs = [node for node in nodes if node not in node_costs]
    if missing_costs:
        raise KeyError(f"以下节点缺少成本记录：{missing_costs}")

    local_costs = np.asarray(
        [float(node_costs[node]["U"]) for node in nodes],
        dtype=float,
    )
    z_values = np.asarray(
        [int(node_decisions[node]["Z"]) for node in nodes],
        dtype=float,
    )
    d_values = np.asarray(
        [int(node_decisions[node]["D"]) for node in nodes],
        dtype=float,
    )

    cost_span = float(np.ptp(local_costs))
    cost_min = float(np.min(local_costs))
    if cost_span > 0:
        cost_norm = (local_costs - cost_min) / cost_span
    else:
        cost_norm = np.full_like(local_costs, 0.5)
    cost_sizes = 64.0 + 156.0 * cost_norm

    product_decision = node_decisions.get("F")
    if not isinstance(product_decision, dict):
        raise KeyError("基准记录缺少成品节点 F")

    baseline_indices = [
        index
        for index, row in enumerate(strategies)
        if int(row["Z"]) == int(product_decision["Z"])
        and int(row["D"]) == int(product_decision["D"])
    ]
    if len(baseline_indices) != 1:
        raise ValueError("无法在成品策略比较表中唯一定位基准 (Z,D)")
    baseline_index = baseline_indices[0]

    u_values = []
    profit_values = []
    strategy_labels = []
    for index, row in enumerate(strategies):
        table_u = float(row["U_root"])
        table_profit = float(row["profit"])

        if index == baseline_index:
            if not np.isclose(table_u, baseline_u):
                raise ValueError("成品策略表与账本基准 U_root 不一致")
            if not np.isclose(table_profit, baseline_profit):
                raise ValueError("成品策略表与账本基准利润不一致")
            u = baseline_u
            profit = baseline_profit
        else:
            u = table_u
            profit = table_profit

        u_values.append(u)
        profit_values.append(profit)
        strategy_labels.append(
            f"({int(row['Z'])}, {int(row['D'])})"
        )

    u_values = np.asarray(u_values, dtype=float)
    profit_values = np.asarray(profit_values, dtype=float)

    fig, (ax_nodes, ax_econ) = plt.subplots(
        1,
        2,
        figsize=(5.0, 4.8),  # r=0.96 落在 <=1.20 档 → 该档宽写 5.0in（门禁 figure_size_buckets）
        gridspec_kw={"width_ratios": [1.08, 1.32]},
    )

    node_y = np.arange(len(nodes), dtype=float)
    column_x = np.arange(3, dtype=float)
    column_labels = ("Z", "D", "U")

    ax_nodes.scatter(
        # scatter 不做标量广播（matplotlib 3.10：x 与 y 尺寸必须一致）——显式铺开成一列
        np.full_like(node_y, column_x[0]), node_y, s=72, marker="o",
        color=PALETTE[0], edgecolors="white", linewidths=0.8, zorder=3,
    )
    ax_nodes.scatter(
        np.full_like(node_y, column_x[1]), node_y, s=72, marker="s",
        color=PALETTE[1], edgecolors="white", linewidths=0.8, zorder=3,
    )

    for index, node in enumerate(nodes):
        u_color = _lighten(
            PALETTE[2],
            0.25 + 0.55 * float(cost_norm[index]),
        )
        ax_nodes.scatter(
            column_x[2], node_y[index], s=float(cost_sizes[index]),
            marker="D", color=u_color,
            edgecolors=COLORS["text"], linewidths=0.5, zorder=3,
        )
        ax_nodes.text(
            column_x[0], node_y[index], cn(f"{int(z_values[index])}"),
            ha="center", va="center", fontsize=7.5,
            color=COLORS["text"], zorder=4,
        )
        ax_nodes.text(
            column_x[1], node_y[index], cn(f"{int(d_values[index])}"),
            ha="center", va="center", fontsize=7.5,
            color=COLORS["text"], zorder=4,
        )
        ax_nodes.text(
            column_x[2], node_y[index], cn(f"{local_costs[index]:.2f}"),
            ha="center", va="center", fontsize=6.8,
            color=COLORS["text"], zorder=4,
        )

    ax_nodes.set_yticks(node_y)
    ax_nodes.set_yticklabels(nodes)
    ax_nodes.set_xticks(column_x)
    ax_nodes.set_xticklabels(column_labels)
    ax_nodes.set_ylim(len(nodes) - 0.5, -0.5)
    ax_nodes.set_xlim(-0.5, len(column_labels) - 0.5)
    ax_nodes.set_xlabel(cn("节点决策与局部成本"))
    ax_nodes.set_ylabel(cn("装配节点"))
    ax_nodes.grid(axis="y", color=COLORS["grid"], linewidth=0.7, alpha=0.55)
    ax_nodes.set_axisbelow(True)
    ax_nodes.tick_params(axis="x", length=0)
    ax_nodes.spines["top"].set_visible(False)
    ax_nodes.spines["right"].set_visible(False)
    panel(ax_nodes, "(a)")

    x = np.arange(len(strategies), dtype=float)
    for index, (u, profit) in enumerate(zip(u_values, profit_values)):
        is_baseline = index == baseline_index
        connector_color = (
            COLORS["highlight"] if is_baseline else _lighten(PALETTE[2], 0.25)
        )
        connector_width = 3.2 if is_baseline else 2.0

        ax_econ.plot(
            [x[index], x[index]],
            [u, profit],
            color=connector_color,
            linewidth=connector_width,
            solid_capstyle="round",
            zorder=1,
        )
        ax_econ.scatter(
            x[index], u,
            s=92 if is_baseline else 78,
            marker="o", color=PALETTE[0],
            edgecolors=COLORS["highlight"] if is_baseline else "white",
            linewidths=1.4 if is_baseline else 0.9,
            zorder=3,
            label=cn("根节点成本 U_root") if index == 0 else None,
        )
        ax_econ.scatter(
            x[index], profit,
            s=92 if is_baseline else 78,
            marker="D", color=PALETTE[1],
            edgecolors=COLORS["highlight"] if is_baseline else "white",
            linewidths=1.4 if is_baseline else 0.9,
            zorder=3,
            label=cn("单位期望利润") if index == 0 else None,
        )

        ax_econ.annotate(
            cn(f"{u:.2f}"),
            xy=(x[index], u),
            xytext=(-8, 0),
            textcoords="offset points",
            ha="right",
            va="center",
            fontsize=7.5,
            color=PALETTE[0],
        )
        ax_econ.annotate(
            cn(f"{profit:.2f}"),
            xy=(x[index], profit),
            xytext=(8, 0),
            textcoords="offset points",
            ha="left",
            va="center",
            fontsize=7.5,
            color=PALETTE[1],
        )

        difference = profit - u
        if np.isclose(u, 0.0):
            gap_text = cn(f"Δ={difference:+.2f}")
        else:
            relative_gap = difference / abs(u) * 100.0
            gap_text = cn(f"Δ={difference:+.2f}\n({relative_gap:+.1f}%)")

        midpoint = (u + profit) / 2.0
        ax_econ.text(
            x[index] + 0.27,
            midpoint,
            gap_text,
            ha="left",
            va="center",
            fontsize=6.8,
            color=COLORS["text"],
            linespacing=1.0,
        )

    endpoints = np.concatenate([u_values, profit_values])
    endpoint_min = float(np.min(endpoints))
    endpoint_max = float(np.max(endpoints))
    endpoint_span = endpoint_max - endpoint_min
    endpoint_scale = float(np.max(np.abs(endpoints)))
    padding = max(endpoint_span * 0.16, endpoint_scale * 0.04)
    if padding <= 0:
        padding = 1.0

    right_margin = max(0.55, len(strategies) * 0.18)
    ax_econ.set_xlim(-0.5, len(strategies) - 0.5 + right_margin)
    ax_econ.set_ylim(endpoint_min - padding, endpoint_max + padding)
    ax_econ.axhline(
        0.0, color=COLORS["ref_line"], linewidth=0.8, alpha=0.65, zorder=0,
    )
    ax_econ.set_xticks(x)
    ax_econ.set_xticklabels(strategy_labels)
    ax_econ.set_xlabel(cn("成品策略（Z,D）"))
    ax_econ.set_ylabel(cn("根节点成本 U_root 与单位期望利润（元/件）"))
    ax_econ.grid(axis="y", color=COLORS["grid"], linewidth=0.7, alpha=0.55)
    ax_econ.set_axisbelow(True)
    ax_econ.legend(
        loc="lower right",
        frameon=False,
        fontsize=7.5,
        handlelength=1.5,
        labelspacing=0.35,
    )
    ax_econ.spines["top"].set_visible(False)
    ax_econ.spines["right"].set_visible(False)

    baseline_tick = ax_econ.get_xticklabels()[baseline_index]
    baseline_tick.set_fontweight("bold")
    baseline_tick.set_color(COLORS["highlight"])
    panel(ax_econ, "(b)")

    fig.tight_layout(w_pad=1.4)
    save(fig, "fig_q3_strategy_cost_compare")
    plt.close(fig)


if __name__ == "__main__":
    main()
