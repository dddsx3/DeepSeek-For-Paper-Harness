"""fig_q3_assembly_network_cost —— 问题 3 实例的三层装配拓扑（网络结构示意图）。

本图讲什么
----------
题面"图 1 给出了 2 道工序、8 个零配件的情况"，但结果账本 results.json 在问题 3 一侧只铸出了
R-Q3-profit 一项（单位成品期望利润），没有节点级的检测／拆解决策，也没有分项成本条目。
因此本图只做"层级拓扑示意"：8 个零配件、半成品层、成品节点沿装配从属方向铺成三列（左 → 右），
连边只表示层间工序从属关系（示意），**不声明零配件与半成品之间的具体配对**；节点级数值一律
不标（账本里没有），唯一从账本读出的数是挂在成品节点上的单位成品期望利润锚点。
若把节点级决策硬画上去，就是在虚构账本里不存在的数，故不做。

每个 panel 是什么
-----------------
单 panel（无子图合成）：
  · 第 0 列 —— 8 个零配件节点（PALETTE[0]），层内纵向等距排布；
  · 第 1 列 —— 半成品层节点（PALETTE[1]）；
  · 第 2 列 —— 成品节点（PALETTE[2]），下方挂账本利润数值锚点；
  · 节点面积按示意网络的度数缩放（配方骨架 node_size = 400 * deg / max_deg + 80）；
  · 三层浅色底带由 _lighten() 生成，只做视觉分组，不带任何数值含义；
  · 层间连边颜色走浅色→参考线的渐变，线宽／透明度随手层权重递增（零配件→半成品是层属扇出，
    半成品→成品是主装配流），权重是结构示意，不是账本数据。

数据来自账本哪些 id
-------------------
  · "R-Q3-profit" —— 问题 3 装配树实例在最优节点级决策下的单位成品期望利润（元/件），
    仅用于成品节点的数值锚点与图注口径；节点、连边、坐标都是结构示意，不是账本数据。
"""

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

import json
import subprocess
import sys
from pathlib import Path

import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D

try:
    import networkx as nx
except ImportError:  # pragma: no cover - 与配方骨架一致的依赖兜底
    subprocess.check_call([sys.executable, "-m", "pip", "install", "networkx", "-q"])
    import networkx as nx


# ------------------------------------------------------------------ 账本读取
# 候选路径链与 FIGURE_PLAN.ledger_source 的声明（stages/04-result-sources/results.json）
# 保持一致；执行期 cwd 无论是工作区根还是本阶段目录，都能定位到同一份账本。
LEDGER_CANDIDATES = (
    "results.json",
    "stages/04-result-sources/results.json",
    "../04-result-sources/results.json",
    "../../stages/04-result-sources/results.json",
    "04-result-sources/results.json",
)


def load_ledger():
    """按候选路径定位结果账本；全部落空才报错，不做静默兜底。"""
    for candidate in LEDGER_CANDIDATES:
        path = Path(candidate)
        if path.is_file():
            with path.open(encoding="utf-8") as handle:
                return json.load(handle)
    raise FileNotFoundError(
        "results.json 未找到，已尝试: " + ", ".join(LEDGER_CANDIDATES)
    )


def ledger_value(ledger, result_id):
    """按 result_id 取账本标量；缺键直接报错，绝不回退到脚本内硬编码数字。"""
    for item in ledger.get("results", []):
        if item.get("result_id") == result_id:
            return float(item["value"])
    raise KeyError(f"账本缺少 {result_id}")


LEDGER = load_ledger()
PROFIT_Q3 = ledger_value(LEDGER, "R-Q3-profit")  # 成品节点数值锚点（元/件）


# ---------------------------------------------------------------- 拓扑结构定义
N_PARTS = 8  # 题面"2 道工序、8 个零配件"中的零配件数（结构参数，非账本数值）
N_SEMI = 3   # 半成品层节点数（阶段 1 ARCH_DECLARATION 声明的层规模）

PART_NODES = [f"零配件{i}" for i in range(1, N_PARTS + 1)]
SEMI_NODES = [f"半成品{i}" for i in range(1, N_SEMI + 1)]
FINAL_NODE = "成品"
NODE_ORDER = PART_NODES + SEMI_NODES + [FINAL_NODE]

G = nx.DiGraph()
for name in PART_NODES:
    G.add_node(name, layer=0)
for name in SEMI_NODES:
    G.add_node(name, layer=1)
G.add_node(FINAL_NODE, layer=2)

# 零配件 → 半成品：层属扇出，只表示"这一层进入下一层"，不声明具体配对。
for src in PART_NODES:
    for dst in SEMI_NODES:
        G.add_edge(src, dst, weight=1.0)
# 半成品 → 成品：主装配流，视觉权重更高（结构强调，非测量数据）。
for dst in SEMI_NODES:
    G.add_edge(dst, FINAL_NODE, weight=2.4)

LAYER_MEMBERS = {0: PART_NODES, 1: SEMI_NODES, 2: [FINAL_NODE]}
LAYER_X = {0: 0.0, 1: 1.0, 2: 2.0}
LAYER_COLOR = {0: PALETTE[0], 1: PALETTE[1], 2: PALETTE[2]}

# 分层布局：列号给 x，层内等距给 y（层级结构不用力导向，避免"看起来像聚类"的误读）
pos = {}
for layer, members in LAYER_MEMBERS.items():
    count = len(members)
    for idx, name in enumerate(members):
        y = (idx - (count - 1) / 2.0) * 1.0
        pos[name] = np.array([LAYER_X[layer], y])

layer_of = {name: G.nodes[name]["layer"] for name in NODE_ORDER}
node_colors = [LAYER_COLOR[layer_of[name]] for name in NODE_ORDER]
degrees = dict(G.degree())
max_degree = max(degrees.values())
node_sizes = [400.0 * degrees[name] / max_degree + 80.0 for name in NODE_ORDER]


# -------------------------------------------------------------------- 绘图
fig, ax = plt.subplots(figsize=(6.0, 4.6))

# 三层浅色底带：仅做层级视觉分组
BAND_HALF = 0.42
for layer in LAYER_MEMBERS:
    center = LAYER_X[layer]
    ax.axvspan(center - BAND_HALF, center + BAND_HALF,
               color=_lighten(LAYER_COLOR[layer], 0.86), alpha=0.85, zorder=0)

# 连边：浅色 → 参考线的渐变，线宽／透明度随结构权重递增
edge_cmap = mcolors.LinearSegmentedColormap.from_list(
    "q3_edge", [_lighten(PALETTE[0], 0.85), COLORS["ref_line"]]
)
edge_list = list(G.edges())
edge_weights = [G[src][dst]["weight"] for src, dst in edge_list]
max_weight = max(edge_weights)
for (src, dst), weight in zip(edge_list, edge_weights):
    x0, y0 = pos[src]
    x1, y1 = pos[dst]
    norm_weight = weight / max_weight
    ax.plot([x0, x1], [y0, y1], color=edge_cmap(norm_weight),
            linewidth=0.4 + 1.5 * norm_weight,
            alpha=0.16 + 0.44 * norm_weight, zorder=1)

# 节点：面积映射度数，白描边保证与连边分离
nx.draw_networkx_nodes(G, pos, ax=ax, nodelist=NODE_ORDER,
                       node_color=node_colors, node_size=node_sizes,
                       edgecolors="white", linewidths=1.2, alpha=0.92, zorder=3)

# 节点标签：零配件贴左侧（避开右向扇出），半成品／成品贴上方，白底防与边线混淆
LABEL_DX = -0.26
LABEL_DY = 0.72
for name in NODE_ORDER:
    x, y = pos[name]
    if layer_of[name] == 0:
        ax.text(x + LABEL_DX, y, name, ha="right", va="center", fontsize=7,
                color=COLORS["text"], zorder=4,
                bbox=dict(facecolor="white", edgecolor="none", alpha=0.7, pad=0.5))
    else:
        ax.text(x, y + LABEL_DY, name, ha="center", va="bottom", fontsize=7,
                color=COLORS["text"], zorder=4,
                bbox=dict(facecolor="white", edgecolor="none", alpha=0.7, pad=0.5))

# 唯一的账本数值锚点：成品节点的单位成品期望利润
final_x, final_y = pos[FINAL_NODE]
ax.text(final_x, final_y - LABEL_DY, f"$E\\Pi$ = {PROFIT_Q3:.2f} 元/件",
        ha="center", va="top", fontsize=7.5, color=COLORS["text"], zorder=5,
        bbox=dict(boxstyle="round,pad=0.28", facecolor="white",
                  edgecolor=COLORS["ref_line"], linewidth=0.8))

legend_handles = [
    Line2D([0], [0], marker="o", color="w", markerfacecolor=LAYER_COLOR[0],
           markersize=8, label=f"零配件层（{N_PARTS} 个）"),
    Line2D([0], [0], marker="o", color="w", markerfacecolor=LAYER_COLOR[1],
           markersize=8, label=f"半成品层（{N_SEMI} 个）"),
    Line2D([0], [0], marker="o", color="w", markerfacecolor=LAYER_COLOR[2],
           markersize=8, label="成品节点（挂账本利润锚点）"),
]
ax.legend(handles=legend_handles, loc="upper center", frameon=False,
          borderaxespad=0.3, labelspacing=0.35, handlelength=1.2,
          handletextpad=0.4, fontsize=7.5, ncol=1)

# 轴：保留轴标签与方向语义，隐去刻度（本图无纵轴数值）
for side in ("top", "right", "left", "bottom"):
    ax.spines[side].set_visible(False)
ax.set_xticks([])
ax.set_yticks([])
ax.set_xlim(-0.80, 2.80)
ax.set_ylim(-4.80, 6.40)
ax.set_xlabel("装配层级（零配件 → 半成品 → 成品）", fontsize=8)
ax.set_ylabel("层级示意（无纵轴数值刻度）", fontsize=8)

fig.tight_layout()
save_fig(fig, "figures/fig_q3_assembly_network_cost.png")
