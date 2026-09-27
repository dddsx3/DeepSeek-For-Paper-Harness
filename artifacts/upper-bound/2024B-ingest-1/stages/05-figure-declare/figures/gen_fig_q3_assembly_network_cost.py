"""问题3基准组装拓扑及各节点成本流。
Panel (a)：由基准变体 blocks 重建零配件—半成品—成品网络，节点填色表示 Q，标签给出 U、Z、D。
Panel (b)：按 U 排序展示全部节点，并汇总根节点成本、利润、节点数与半成品数。
数据来自账本 R-Q3-topology-robustness、R-Q3-baseline-node-cost、R-Q3-baseline-best-decision、
R-Q3-baseline-U-root、R-Q3-baseline-profit、R-Q3-baseline-node-count、R-Q3-baseline-semi-count；
全部关键数值均在运行时由上述 result_id 注入。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import CMAP_SEQ

import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch

try:
    import networkx as nx
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "networkx", "-q"])
    import networkx as nx

try:
    from scipy.spatial import ConvexHull
except ImportError:
    ConvexHull = None


doc = load("results.json")
rows = doc.get("results", []) if isinstance(doc, dict) else doc
ledger = {row["result_id"]: row["value"] for row in rows}

required_ids = {
    "R-Q3-topology-robustness",
    "R-Q3-baseline-node-cost",
    "R-Q3-baseline-best-decision",
    "R-Q3-baseline-U-root",
    "R-Q3-baseline-profit",
    "R-Q3-baseline-node-count",
    "R-Q3-baseline-semi-count",
}
missing_ids = sorted(required_ids.difference(ledger))
if missing_ids:
    raise KeyError(f"Missing result ids: {missing_ids}")

topology_scan = ledger["R-Q3-topology-robustness"]
node_cost = ledger["R-Q3-baseline-node-cost"]
best_decision = ledger["R-Q3-baseline-best-decision"]
root_u = float(ledger["R-Q3-baseline-U-root"])
root_profit = float(ledger["R-Q3-baseline-profit"])
node_count = int(ledger["R-Q3-baseline-node-count"])
semi_count = int(ledger["R-Q3-baseline-semi-count"])

baseline_candidates = [
    item
    for item in topology_scan
    if isinstance(item, dict)
    and str(item.get("name", "")).casefold().startswith("baseline")
    and bool(item.get("feasible", False))
]
if not baseline_candidates:
    raise ValueError("The ledger contains no feasible baseline topology variant.")

baseline = baseline_candidates[0]
blocks = [[str(node) for node in block] for block in baseline["blocks"]]
part_order = [node for block in blocks for node in block]
part_set = set(part_order)
cost_keys = [str(node) for node in node_cost]
remaining_nodes = [node for node in cost_keys if node not in part_set]
semi_nodes = [node for node in remaining_nodes if node.startswith("S")]
final_nodes = [node for node in remaining_nodes if node.startswith("F")]
semi_set = set(semi_nodes)
final_set = set(final_nodes)

if len(node_cost) != node_count:
    raise ValueError("R-Q3-baseline-node-cost does not match the ledger node count.")
if len(semi_nodes) != semi_count:
    raise ValueError("Reconstructed semi-finished nodes do not match the ledger count.")
if len(blocks) != len(semi_nodes):
    raise ValueError("The baseline blocks cannot be paired one-to-one with semi-finished nodes.")
if not final_nodes:
    raise ValueError("The baseline topology has no final-product node.")

missing_cost_nodes = sorted(set(cost_keys).difference(node_cost))
missing_decision_nodes = sorted(set(cost_keys).difference(best_decision))
if missing_cost_nodes or missing_decision_nodes:
    raise KeyError(
        f"Missing node records: costs={missing_cost_nodes}, decisions={missing_decision_nodes}"
    )

u_values = {str(node): float(record["U"]) for node, record in node_cost.items()}
q_values = {str(node): float(record["Q"]) for node, record in node_cost.items()}

tiers = [part_order, semi_nodes, final_nodes]
layer_for_node = {
    node: layer_index
    for layer_index, tier in enumerate(tiers)
    for node in tier
}

graph = nx.DiGraph()
for node in cost_keys:
    graph.add_node(node, layer=layer_for_node[node])

for block, semi_node in zip(blocks, semi_nodes):
    for part_node in block:
        graph.add_edge(part_node, semi_node)
for semi_node in semi_nodes:
    for final_node in final_nodes:
        graph.add_edge(semi_node, final_node)

positions = nx.multipartite_layout(
    graph,
    subset_key="layer",
    align="vertical",
    scale=1.0,
)

fig, axes = plt.subplots(
    1,
    2,
    figsize=(6.0, 3.2),
    gridspec_kw={"width_ratios": [1.35, 1.0]},
)
network_ax, ranking_ax = axes

if ConvexHull is not None:
    for block_index, (block, semi_node) in enumerate(zip(blocks, semi_nodes)):
        community_nodes = block + [semi_node]
        points = np.asarray([positions[node] for node in community_nodes], dtype=float)
        try:
            hull = ConvexHull(points)
        except Exception:
            continue
        hull_points = points[hull.vertices]
        hull_points = np.vstack([hull_points, hull_points[0]])
        centroid = points.mean(axis=0)
        expanded = centroid + 1.12 * (hull_points - centroid)
        community_color = PALETTE[block_index % len(PALETTE)]
        network_ax.fill(
            expanded[:, 0],
            expanded[:, 1],
            color=community_color,
            alpha=0.07,
            zorder=0,
        )
        network_ax.plot(
            expanded[:, 0],
            expanded[:, 1],
            color=community_color,
            linewidth=0.9,
            linestyle="--",
            alpha=0.30,
            zorder=0,
        )

edge_weights = {
    (source, target): (u_values[source] + u_values[target]) / 2.0
    for source, target in graph.edges()
}
edge_min = min(edge_weights.values())
edge_max = max(edge_weights.values())
if edge_max == edge_min:
    edge_norm = mcolors.Normalize(vmin=edge_min, vmax=edge_min + np.finfo(float).eps)
else:
    edge_norm = mcolors.Normalize(vmin=edge_min, vmax=edge_max)

edge_cmap = mcolors.LinearSegmentedColormap.from_list(
    "edge_strength",
    [_lighten(PALETTE[0], 0.80), COLORS["ref_line"]],
)
edge_list = list(edge_weights)
edge_widths = []
edge_colors = []
for edge in edge_list:
    strength = float(edge_norm(edge_weights[edge]))
    edge_widths.append(0.65 + 1.85 * strength)
    edge_colors.append(
        mcolors.to_rgba(
            edge_cmap(strength),
            alpha=0.30 + 0.45 * strength,
        )
    )

degrees = dict(graph.degree())
max_degree = max(degrees.values()) if degrees else 1
node_sizes = [280.0 + 520.0 * degrees[node] / max_degree for node in graph.nodes]

nx.draw_networkx_edges(
    graph,
    positions,
    edgelist=edge_list,
    ax=network_ax,
    arrows=True,
    arrowstyle="-|>",
    arrowsize=8,
    edge_color=edge_colors,
    width=edge_widths,
    node_size=node_sizes,
    min_source_margin=18,
    min_target_margin=22,
    connectionstyle="arc3,rad=0.025",
)

q_min = min(q_values.values())
q_max = max(q_values.values())
if q_max == q_min:
    q_norm = mcolors.Normalize(vmin=q_min, vmax=q_min + np.finfo(float).eps)
else:
    q_norm = mcolors.Normalize(vmin=q_min, vmax=q_max)

q_cmap = CMAP_SEQ if hasattr(CMAP_SEQ, "__call__") else plt.get_cmap(CMAP_SEQ)
node_colors = [q_cmap(q_norm(q_values[node])) for node in graph.nodes]

nx.draw_networkx_nodes(
    graph,
    positions,
    ax=network_ax,
    node_color=node_colors,
    node_size=node_sizes,
    edgecolors=fig.get_facecolor(),
    linewidths=0.9,
    alpha=0.96,
)

node_labels = {}
for node in graph.nodes:
    z_value = int(best_decision[node]["Z"])
    d_value = int(best_decision[node]["D"])
    node_labels[node] = f"{node}\nU={u_values[node]:.0f}  Z={z_value},D={d_value}"

nx.draw_networkx_labels(
    graph,
    positions,
    labels=node_labels,
    ax=network_ax,
    font_size=5.8,
    font_color=COLORS["primary"],
    font_weight="bold",
    bbox={
        "boxstyle": "round,pad=0.18",
        "facecolor": fig.get_facecolor(),
        "edgecolor": "none",
        "alpha": 0.88,
    },
)

layer_ticks = sorted({layer_for_node[node] for node in graph.nodes})
layer_labels = [cn("零配件层"), cn("半成品层"), cn("成品层")]
network_ax.set_xticks(layer_ticks)
network_ax.set_xticklabels(layer_labels[: len(layer_ticks)], fontsize=7)
network_ax.tick_params(axis="x", length=0, pad=2)
network_ax.set_yticks([])
network_ax.set_xlabel(cn("生产工序（左→右）"), fontsize=8)
network_ax.set_ylabel(cn("节点（成本单位：元/件）"), fontsize=8)
network_ax.margins(0.18)
network_ax.grid(False)
for spine in network_ax.spines.values():
    spine.set_visible(False)
panel(network_ax, "(a)")

scalar_mappable = plt.cm.ScalarMappable(norm=q_norm, cmap=q_cmap)
scalar_mappable.set_array(np.asarray(list(q_values.values()), dtype=float))
colorbar = fig.colorbar(
    scalar_mappable,
    ax=network_ax,
    fraction=0.045,
    pad=0.025,
)
colorbar.set_label(cn("节点交付率 Q"), fontsize=7)
colorbar.ax.tick_params(labelsize=6, colors=COLORS["gray"], length=2)
colorbar.outline.set_edgecolor(COLORS["grid"])


def bar_color(node):
    if node in part_set:
        return PALETTE[0]
    if node in semi_set:
        return PALETTE[1]
    return PALETTE[2]


ordered_nodes = sorted(cost_keys, key=lambda node: u_values[node])
y_positions = np.arange(len(ordered_nodes), dtype=float)
bars = ranking_ax.barh(
    y_positions,
    [u_values[node] for node in ordered_nodes],
    height=0.68,
    color=[bar_color(node) for node in ordered_nodes],
    edgecolor=COLORS["grid"],
    linewidth=0.6,
    zorder=2,
)
bar_texts = ranking_ax.bar_label(
    bars,
    labels=[f"{u_values[node]:.0f}" for node in ordered_nodes],
    padding=2,
    fontsize=6.5,
)
for text in bar_texts:
    text.set_color(COLORS["gray"])

ranking_ax.set_yticks(y_positions)
ranking_ax.set_yticklabels(ordered_nodes, fontsize=7)
ranking_ax.tick_params(axis="y", length=0, pad=2)
ranking_ax.tick_params(axis="x", labelsize=7, colors=COLORS["gray"], length=2)
ranking_ax.set_xlabel(cn("单位期望成本 U（元/件）"), fontsize=8)
ranking_ax.set_ylabel(cn("节点（成本单位：元/件）"), fontsize=8)
ranking_ax.xaxis.grid(
    True,
    color=COLORS["grid"],
    linewidth=0.6,
    alpha=0.75,
)
ranking_ax.yaxis.grid(False)
ranking_ax.set_axisbelow(True)
ranking_ax.margins(x=0.16, y=0.08)
for side in ("top", "right"):
    ranking_ax.spines[side].set_visible(False)
for side in ("left", "bottom"):
    ranking_ax.spines[side].set_color(COLORS["grid"])
panel(ranking_ax, "(b)")

legend_handles = [
    Patch(facecolor=PALETTE[0], edgecolor="none", label=cn("零配件")),
    Patch(facecolor=PALETTE[1], edgecolor="none", label=cn("半成品")),
    Patch(facecolor=PALETTE[2], edgecolor="none", label=cn("成品")),
]
summary_title = (
    f"{cn('节点')} {node_count:g}｜{cn('半成品')} {semi_count:g}\n"
    f"{cn('根节点')} {final_nodes[0]}：U={root_u:.0f} {cn('元/件')}｜"
    f"{cn('利润')}={root_profit:.0f} {cn('元/件')}"
)
legend = ranking_ax.legend(
    handles=legend_handles,
    title=summary_title,
    loc="lower right",
    frameon=True,
    fancybox=True,
    fontsize=6.5,
    title_fontsize=6.5,
    handlelength=1.4,
    borderpad=0.7,
    labelspacing=0.45,
)
legend.get_frame().set_facecolor(fig.get_facecolor())
legend.get_frame().set_edgecolor(COLORS["grid"])
legend.get_frame().set_alpha(0.92)

fig.tight_layout(pad=0.8)
save(fig, "fig_q3_assembly_network_cost")
plt.close(fig)
