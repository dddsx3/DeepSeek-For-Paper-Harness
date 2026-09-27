"""
本图展示问题3基准组装拓扑及各节点的单位成本，并同步给出根节点成本与单位利润。
panel (a) 为按装配块划分社区的基准网络：节点大小映射度，边宽映射目标节点成本。
panel (b) 为同一账本节点成本的降序对照，便于读取较小成本节点。
数据来自账本 R-Q3-baseline-node-cost、R-Q3-topology-robustness、
R-Q3-baseline-U-root 与 R-Q3-baseline-profit。
关键数值均由上述账本记录在运行时注入，注释不固化账本读数。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

# _figbase 在导入时统一调用 setup_style()。
import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D

try:
    import networkx as nx
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "networkx", "-q"])
    import networkx as nx

from scipy.spatial import ConvexHull


_REQUIRED_IDS = (
    "R-Q3-baseline-node-cost",
    "R-Q3-topology-robustness",
    "R-Q3-baseline-U-root",
    "R-Q3-baseline-profit",
)


def _format_number(value):
    """按账本数值生成紧凑标签，不在源码中固化读数。"""
    return f"{float(value):.6g}"


def _natural_key(label):
    """使 P1、P2 等节点标签按名称自然排序。"""
    prefix = "".join(character for character in str(label) if character.isalpha())
    suffix = "".join(character for character in str(label) if character.isdigit())
    return prefix, int(suffix) if suffix else -1, str(label)


def main():
    document = load("results.json")
    records = {
        str(item["result_id"]): item
        for item in document.get("results", [])
    }
    missing = [result_id for result_id in _REQUIRED_IDS if result_id not in records]
    if missing:
        raise KeyError(f"results.json 缺少图所需账本项：{missing}")

    node_payload = records["R-Q3-baseline-node-cost"]["value"]
    topology_variants = records["R-Q3-topology-robustness"]["value"]
    root_u = float(records["R-Q3-baseline-U-root"]["value"])
    root_profit = float(records["R-Q3-baseline-profit"]["value"])
    root_unit = str(records["R-Q3-baseline-U-root"]["unit"])
    profit_unit = str(records["R-Q3-baseline-profit"]["unit"])

    if not isinstance(node_payload, dict) or not node_payload:
        raise ValueError("基准节点成本记录必须是非空对象")
    if not topology_variants:
        raise ValueError("拓扑扰动扫描结果不能为空")

    baseline = next(
        (
            variant
            for variant in topology_variants
            if str(variant.get("name", "")).lower().startswith("baseline")
        ),
        topology_variants[0],
    )
    blocks = baseline.get("blocks", [])
    if not blocks or not all(isinstance(block, list) and block for block in blocks):
        raise ValueError("基准拓扑的 blocks 必须是非空节点列表的列表")

    part_nodes = [str(node) for block in blocks for node in block]
    if len(part_nodes) != len(set(part_nodes)):
        raise ValueError("基准拓扑中零配件节点出现重复")

    part_set = set(part_nodes)
    unknown_parts = [node for node in part_nodes if node not in node_payload]
    if unknown_parts:
        raise KeyError(f"拓扑节点缺少对应成本记录：{unknown_parts}")

    semi_nodes = sorted(
        (
            node
            for node in node_payload
            if str(node).startswith("S") and node not in part_set
        ),
        key=_natural_key,
    )
    if len(semi_nodes) != len(blocks):
        raise ValueError("半成品节点数必须与基准拓扑 blocks 数一致")

    semi_set = set(semi_nodes)
    root_nodes = [
        node for node in node_payload if node not in part_set and node not in semi_set
    ]
    if len(root_nodes) != 1:
        raise ValueError("基准拓扑必须且只能有一个未分层的成品根节点")
    root_node = root_nodes[0]

    display_costs = {
        str(node): float(payload["U"])
        for node, payload in node_payload.items()
    }
    display_costs[root_node] = root_u

    graph = nx.DiGraph()
    for block, semi_node in zip(blocks, semi_nodes):
        for part_node in block:
            graph.add_edge(str(part_node), semi_node)
        graph.add_edge(semi_node, root_node)
    graph.add_node(root_node)

    community_colors = {}
    for block_index, (block, semi_node) in enumerate(zip(blocks, semi_nodes)):
        color = PALETTE[block_index % len(PALETTE)]
        for node in block:
            community_colors[str(node)] = color
        community_colors[semi_node] = color
    community_colors[root_node] = COLORS["accent"]

    block_count = len(blocks)
    positions = {}
    for block_index, (block, semi_node) in enumerate(zip(blocks, semi_nodes)):
        base_y = block_index - (block_count - 1) / 2.0
        member_count = len(block)
        for member_index, node in enumerate(block):
            member_y = (member_index - (member_count - 1) / 2.0) * 0.12
            positions[str(node)] = (0.0, base_y + member_y)
        positions[semi_node] = (1.0, base_y)
    positions[root_node] = (2.0, 0.0)

    degrees = dict(graph.degree())
    max_degree = max(degrees.values()) if degrees else 1
    node_sizes = {
        node: 360.0 + 180.0 * degree / max_degree
        for node, degree in degrees.items()
    }
    node_colors = [community_colors[node] for node in graph.nodes()]

    edge_costs = [display_costs[target] for _, target in graph.edges()]
    min_edge_cost = min(edge_costs) if edge_costs else root_u
    max_edge_cost = max(edge_costs) if edge_costs else root_u
    if max_edge_cost > min_edge_cost:
        edge_weights = [
            (cost - min_edge_cost) / (max_edge_cost - min_edge_cost)
            for cost in edge_costs
        ]
    else:
        edge_weights = [0.5 for _ in edge_costs]

    fig, (network_ax, cost_ax) = plt.subplots(
        1,
        2,
        figsize=(6.0, 3.4),
        gridspec_kw={"width_ratios": [1.45, 1.0]},
    )

    for block, semi_node in zip(blocks, semi_nodes):
        community = [str(node) for node in block] + [semi_node]
        points = np.asarray([positions[node] for node in community], dtype=float)
        if len(points) < 3:
            continue
        try:
            hull = ConvexHull(points)
            hull_points = points[hull.vertices]
            hull_points = np.vstack([hull_points, hull_points[0]])
            centroid = points.mean(axis=0)
            expanded = centroid + 1.12 * (hull_points - centroid)
            network_ax.fill(
                expanded[:, 0],
                expanded[:, 1],
                color=community_colors[semi_node],
                alpha=0.08,
                zorder=0,
            )
            network_ax.plot(
                expanded[:, 0],
                expanded[:, 1],
                color=community_colors[semi_node],
                linewidth=1.2,
                linestyle="--",
                alpha=0.40,
                zorder=0,
            )
        except (ValueError, np.linalg.LinAlgError):
            pass

    edge_cmap = mcolors.LinearSegmentedColormap.from_list(
        "node_cost_gradient",
        [_lighten(PALETTE[0], 0.8), COLORS["ref_line"]],
    )
    for (source, target), weight in zip(graph.edges(), edge_weights):
        x0, y0 = positions[source]
        x1, y1 = positions[target]
        network_ax.plot(
            [x0, x1],
            [y0, y1],
            color=edge_cmap(weight),
            linewidth=0.6 + 2.0 * weight,
            alpha=0.35 + 0.45 * weight,
            zorder=1,
        )

    nx.draw_networkx_nodes(
        graph,
        positions,
        ax=network_ax,
        node_color=node_colors,
        node_size=[node_sizes[node] for node in graph.nodes()],
        edgecolors="white",
        linewidths=0.9,
        alpha=0.94,
    )

    node_labels = {
        node: f"{node}  U={_format_number(display_costs[node])}"
        for node in graph.nodes()
    }
    nx.draw_networkx_labels(
        graph,
        positions,
        labels=node_labels,
        ax=network_ax,
        font_size=5.8,
        font_color=COLORS.get("text", COLORS["gray"]),
        font_weight="bold",
        bbox={
            "boxstyle": "round,pad=0.14",
            "facecolor": "white",
            "edgecolor": COLORS["grid"],
            "linewidth": 0.5,
            "alpha": 0.90,
        },
    )

    network_ax.set_aspect("equal", adjustable="box")
    network_ax.set_axis_off()
    baseline_name = str(baseline.get("name", ""))
    if baseline_name:
        network_ax.text(
            0.01,
            0.01,
            baseline_name,
            transform=network_ax.transAxes,
            ha="left",
            va="bottom",
            fontsize=5.8,
            color=COLORS["gray"],
        )
    panel(network_ax, "(a)")

    ordered_nodes = sorted(
        display_costs,
        key=lambda node: display_costs[node],
        reverse=True,
    )
    ordered_costs = [display_costs[node] for node in ordered_nodes]
    bars = cost_ax.barh(
        np.arange(len(ordered_nodes)),
        ordered_costs,
        color=[community_colors.get(node, COLORS["gray"]) for node in ordered_nodes],
        height=0.68,
        alpha=0.90,
        zorder=2,
    )
    cost_ax.invert_yaxis()
    cost_ax.set_yticks(np.arange(len(ordered_nodes)))
    cost_ax.set_yticklabels(ordered_nodes, fontsize=6.2)
    cost_ax.set_xlabel(cn(f"节点单位成本 U（{root_unit}）"), fontsize=7.2)
    cost_ax.set_ylabel(cn("账本节点"), fontsize=7.2)
    cost_ax.tick_params(axis="x", labelsize=6.2)
    cost_ax.tick_params(axis="y", length=0)
    cost_ax.grid(
        axis="x",
        color=COLORS["grid"],
        linewidth=0.6,
        alpha=0.75,
        zorder=0,
    )
    cost_ax.set_axisbelow(True)
    cost_ax.margins(x=0.20, y=0.03)
    cost_ax.spines["top"].set_visible(False)
    cost_ax.spines["right"].set_visible(False)
    cost_ax.spines["left"].set_visible(False)
    cost_ax.spines["bottom"].set_color(COLORS["grid"])

    for bar, node in zip(bars, ordered_nodes):
        cost_ax.text(
            bar.get_width(),
            bar.get_y() + bar.get_height() / 2.0,
            _format_number(display_costs[node]),
            ha="left",
            va="center",
            fontsize=5.8,
            color=COLORS.get("text", COLORS["gray"]),
        )

    summary = (
        f"{cn('根节点成本')}={_format_number(root_u)} {root_unit}"
        f"   |   {cn('单位利润')}={_format_number(root_profit)} {profit_unit}"
    )
    cost_ax.text(
        0.98,
        0.02,
        summary,
        transform=cost_ax.transAxes,
        ha="right",
        va="bottom",
        fontsize=6.0,
        color=COLORS.get("text", COLORS["gray"]),
        bbox={
            "boxstyle": "round,pad=0.25",
            "facecolor": "white",
            "edgecolor": COLORS["grid"],
            "linewidth": 0.5,
            "alpha": 0.92,
        },
    )
    panel(cost_ax, "(b)")

    legend_handles = []
    for block_index, semi_node in enumerate(semi_nodes):
        legend_handles.append(
            Line2D(
                [0],
                [0],
                marker="o",
                linestyle="",
                markerfacecolor=community_colors[semi_node],
                markeredgecolor="white",
                markersize=6,
                label=cn(f"装配块 {block_index + 1}"),
            )
        )
    legend_handles.append(
        Line2D(
            [0],
            [0],
            marker="o",
            linestyle="",
            markerfacecolor=community_colors[root_node],
            markeredgecolor="white",
            markersize=6,
            label=cn("成品根节点"),
        )
    )
    fig.legend(
        handles=legend_handles,
        loc="lower center",
        bbox_to_anchor=(0.5, 0.01),
        ncol=len(legend_handles),
        frameon=False,
        fontsize=6.2,
        handlelength=1.0,
        handletextpad=0.35,
        columnspacing=0.9,
    )

    fig.subplots_adjust(
        left=0.03,
        right=0.99,
        top=0.96,
        bottom=0.22,
        wspace=0.38,
    )
    save(fig, "fig_q3_assembly_network_cost")


if __name__ == "__main__":
    main()
