"""fig_q2_strategy_cost_heatmap —— 问题2 表1 六种情况最优决策指示矩阵（热力图）。

本图讲什么
    把问题2 表1 六种情况的最优决策向量 (Z1, Z2, C, D) 摊成一张 6×4 的 0-1 指示矩阵，
    两档色阶 + 格内数字同时给出取值，便于一眼看出“哪种情况执行了哪一步检测 / 拆解”。
    本图画的不是金额成本：纵轴 = 情况 1–6，横轴 = 四个决策变量，格内为决策指示而非成本金额，
    figure_id 沿用阶段1 FIGURE_MANIFEST 的原始标识，语义以下方 caption 为准。

面板
    单面板热力图：6 行（表1 情况） × 4 列（Z1 零配件1检测、Z2 零配件2检测、C 成品检测、
    D 不合格成品拆解），色阶只有 0 / 1 两个取值，格内标注即账本条目读数。

数据来自账本哪些 id（全部经 results.json 读取，脚本内不出现任何字面量数值）
    R-Q2-case{k}-decision-Z1 / -Z2 / -C / -D，k = 1..6，共 24 条 0-1 指示条目；
    1 = 执行该阶段的检测 / 拆解，0 = 不执行。

关键数值（读图要点，由上述 24 条账本条目直接读出）
    D 列除情况 6 外均为 1；C 列在情况 3、4、5 为 1；Z1 列仅在情况 2、4 为 1；
    Z2 列六种情况全部为 0。
"""

import json
import os

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import BoundaryNorm, ListedColormap

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()


def _load_ledger():
    """把 results.json 读成 {result_id: item} 字典；兼容几种常见工作目录。"""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "results.json"),
        os.path.join(here, "..", "results.json"),
        os.path.join(here, "..", "..", "results.json"),
        os.path.join(here, "..", "..", "04-result-sources", "results.json"),
        os.path.join(here, "..", "..", "..", "04-result-sources", "results.json"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                payload = json.load(fh)
            return {str(item["result_id"]): item for item in payload["results"]}
    raise FileNotFoundError("results.json 未找到；已尝试：{}".format(candidates))


LEDGER = _load_ledger()

# ---- 账本引用与矩阵装配（行 = 表1 情况，列 = 决策变量）----------------------
CASE_IDS = [1, 2, 3, 4, 5, 6]
CASE_LABELS = ["情况1", "情况2", "情况3", "情况4", "情况5", "情况6"]
VAR_IDS = ["Z1", "Z2", "C", "D"]
VAR_LABELS = ["Z1", "Z2", "C", "D"]

REF_MATRIX = [[f"R-Q2-case{k}-decision-{v}" for v in VAR_IDS] for k in CASE_IDS]

_missing = [ref for row in REF_MATRIX for ref in row if ref not in LEDGER]
if _missing:
    raise KeyError("账本缺少这些 result_id：{}".format(_missing))

DECISION = np.array(
    [[float(LEDGER[ref]["value"]) for ref in row] for row in REF_MATRIX],
    dtype=float,
)

# ---- 画布与色阶 ------------------------------------------------------------
fig = plt.figure(figsize=(6.0, 4.2))
ax = fig.add_axes([0.14, 0.14, 0.72, 0.79])

cmap = ListedColormap([_lighten(PALETTE[0], 0.80), PALETTE[0]])
norm = BoundaryNorm([-0.5, 0.5, 1.5], cmap.N)

im = ax.imshow(DECISION, cmap=cmap, norm=norm, aspect="auto",
               interpolation="nearest", origin="upper")

ax.set_xticks(np.arange(DECISION.shape[1]))
ax.set_xticklabels(VAR_LABELS, fontsize=8)
ax.set_yticks(np.arange(DECISION.shape[0]))
ax.set_yticklabels(CASE_LABELS, fontsize=8)
ax.set_xlabel("决策变量")
ax.set_ylabel("表 1 情况")

ax.set_xticks(np.arange(-0.5, DECISION.shape[1], 1.0), minor=True)
ax.set_yticks(np.arange(-0.5, DECISION.shape[0], 1.0), minor=True)
ax.grid(which="minor", color="0.85", linewidth=0.8)
ax.tick_params(which="both", length=0)

# ---- 格内数值（0-1 指示，短标签，自动对比度）--------------------------------
for i in range(DECISION.shape[0]):
    for j in range(DECISION.shape[1]):
        value = DECISION[i, j]
        ax.text(j, i, "{:.0f}".format(value), ha="center", va="center",
                fontsize=8, color="white" if value >= 0.5 else "0.25")

cbar = fig.colorbar(im, ax=ax, ticks=[0.0, 1.0], fraction=0.045, pad=0.03)
cbar.set_label("0-1 指示（1 = 执行该阶段的检测 / 拆解）", fontsize=7)
cbar.ax.tick_params(labelsize=7, length=0)

save_fig(fig, "figures/fig_q2_strategy_cost_heatmap.png")
