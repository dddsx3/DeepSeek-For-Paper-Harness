"""fig_q2_strategy_cost_heatmap —— 表 1 六种情况最优决策的 0-1 指示热力图。

本图讲什么
    把问题 2 表 1 六种情况（情况 1–6）在最优期望利润下解出的决策向量
    (Z1, Z2, C, D) 排成 6×4 的 0-1 指示矩阵，用 imshow 色阶 + 逐格数值标注
    呈现，用于横向比对六种情况最优策略的结构差异。
    Z1 = 是否检测零配件 1，Z2 = 是否检测零配件 2，
    C = 是否检测成品，D = 是否对检测出的不合格成品拆解。

panel 结构
    单 panel：行 = 表 1 情况 1–6，列 = 决策变量 Z1 / Z2 / C / D；
    右侧 colorbar 为二值指示色阶（0 = 否，1 = 是）。
    注意：色阶是 0-1 决策指示，不是期望成本矩阵 —— 账本未铸出全部 16 种
    (Z1, Z2, C, D) 组合的期望成本，该语义偏差已在 FIGURE_PLAN.plan_deviations
    中登记。

数据来源（全部读自 results.json，脚本内不写死任何数值）
    R-Q2-case{1..6}-decision-Z1 / -Z2 / -C / -D 共 24 条账本条目，
    矩阵元素即对应条目的 value（0 或 1）。
    账本定位与 FIGURE_PLAN.ledger_source = stages/04-result-sources/results.json
    对齐：多候选路径回退，避免执行期 cwd 不同导致 FileNotFoundError。
"""

import json
import os
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# ---------------------------------------------------------------- 账本读取
LEDGER_SOURCE = "stages/04-result-sources/results.json"
CASES = [1, 2, 3, 4, 5, 6]
VARS = ["Z1", "Z2", "C", "D"]


def load_ledger():
    """按 FIGURE_PLAN.ledger_source 声明的相对位置 + 若干回退路径定位 results.json。"""
    here = Path(__file__).resolve()
    bases = [Path.cwd(), here.parent, here.parent.parent, here.parent.parent.parent,
             here.parent.parent.parent.parent]
    candidates = []
    for base in bases:
        candidates.extend([
            base / LEDGER_SOURCE,
            base / "04-result-sources" / "results.json",
            base / "results.json",
        ])
    for path in candidates:
        try:
            if path.is_file():
                with path.open(encoding="utf-8") as fh:
                    return json.load(fh)
        except OSError:
            continue
    for base in bases[:3]:
        try:
            for path in base.glob("**/results.json"):
                if path.is_file():
                    with path.open(encoding="utf-8") as fh:
                        return json.load(fh)
        except OSError:
            continue
    raise FileNotFoundError(
        "results.json 未找到：已按 %s 及回退路径检索" % LEDGER_SOURCE
    )


ledger = load_ledger()
book = {row["result_id"]: row["value"] for row in ledger["results"]}

# ------------------------------------------------- 组装 6×4 决策指示矩阵
refs = [[f"R-Q2-case{k}-decision-{v}" for v in VARS] for k in CASES]
missing = [rid for row in refs for rid in row if rid not in book]
if missing:
    raise KeyError("账本缺少条目: %s" % ", ".join(missing))

matrix = np.array([[float(book[rid]) for rid in row] for row in refs])
row_labels = [f"情况 {k}" for k in CASES]

# ---------------------------------------------------------------- 绘图
cmap = LinearSegmentedColormap.from_list(
    "decision_indicator", [_lighten(PALETTE[0], 0.88), PALETTE[0]]
)
text_on_dark = _lighten(PALETTE[0], 0.94)
grid_color = _lighten(COLORS["text"], 0.70)

fig, ax = plt.subplots(figsize=(6.0, 3.6))
im = ax.imshow(matrix, cmap=cmap, vmin=0.0, vmax=1.0, aspect="auto")

for i in range(matrix.shape[0]):
    for j in range(matrix.shape[1]):
        val = matrix[i, j]
        ax.text(
            j, i, f"{int(round(val))}",
            ha="center", va="center", fontsize=11,
            color=text_on_dark if val >= 0.5 else COLORS["text"],
        )

# 网格分隔线（white-ish，避免默认 matplotlib 配色）
for j in range(1, matrix.shape[1]):
    ax.axvline(j - 0.5, color=grid_color, lw=0.8)
for i in range(1, matrix.shape[0]):
    ax.axhline(i - 0.5, color=grid_color, lw=0.8)

ax.set_xticks(range(len(VARS)))
ax.set_xticklabels(VARS, fontsize=10)
ax.set_yticks(range(len(CASES)))
ax.set_yticklabels(row_labels, fontsize=9, rotation=0)
ax.set_xlabel("决策变量（Z1 零配件1检测 / Z2 零配件2检测 / C 成品检测 / D 不合格品拆解）",
              fontsize=9)
ax.set_ylabel("表 1 情况", fontsize=9)
ax.tick_params(length=0)

cbar = fig.colorbar(im, ax=ax, ticks=[0, 1], shrink=0.85, pad=0.02)
cbar.set_label("决策指示（0 = 否，1 = 是）", fontsize=9)
cbar.ax.tick_params(labelsize=9)

fig.tight_layout()
os.makedirs("figures", exist_ok=True)
save_fig(fig, "figures/fig_q2_strategy_cost_heatmap.png")
