"""fig_q2_strategy_cost_heatmap —— 表 1 六种情况的最优 0-1 决策指示矩阵。

本图讲什么
----------
把问题 2 对表 1 六种情况分别解出的最优决策向量 (Z1, Z2, C, D) 排成 6x4 指示
矩阵：行 = 表 1 的六种情况，列 = 四个二值决策变量，格内标注 0/1 取值。
色阶只编码 0/1 指示本身、不编码成本，也不承担成本高低的解释；0 与 1 的业务
语义写在论文题注里。行标签同时给出账本记录的该情况最优期望利润，便于与
fig_q2_six_cases_decisions 对照阅读。

panel 划分
----------
单 panel：6x4 指示热力图 + 右侧 0/1 离散色阶条。

数据来源（全部取自铸出的 04-result-sources/results.json，脚本内不写死任何数值）
------------------------------------------------------------------------------
决策：R-Q2-case{1..6}-decision-{Z1,Z2,C,D}
利润：R-Q2-case{1..6}-profit
"""

import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
from _figbase import CMAP_SEQ

CASES = (1, 2, 3, 4, 5, 6)
VARS = ("Z1", "Z2", "C", "D")

doc = load("results.json")
ledger = doc["results"] if isinstance(doc, dict) and "results" in doc else doc
vals = {row["result_id"]: row["value"] for row in ledger}


def _v(rid):
    """账本取值；条目缺失即报错，绝不回退到写死的常量。"""
    if rid not in vals:
        raise KeyError("结果账本缺少条目：" + rid)
    return float(vals[rid])


mat = np.array(
    [[_v("R-Q2-case%d-decision-%s" % (k, v)) for v in VARS] for k in CASES],
    dtype=float,
)
profit = [_v("R-Q2-case%d-profit" % k) for k in CASES]

fig, ax = plt.subplots(figsize=(5.0, 4.4))

im = ax.imshow(
    mat,
    cmap=CMAP_SEQ,
    vmin=0.0,
    vmax=1.0,
    aspect="auto",
    interpolation="nearest",
)

# 格内 0/1 数值标注：底色深（指示=1）用白字，底色浅（指示=0）用深灰字
_on_dark = "white"
_on_light = COLORS.get("text", COLORS["gray"])
for i in range(mat.shape[0]):
    for j in range(mat.shape[1]):
        v = float(mat[i, j])
        ax.text(
            j,
            i,
            "%d" % int(round(v)),
            ha="center",
            va="center",
            fontsize=11,
            fontweight="bold",
            color=_on_dark if v >= 0.5 else _on_light,
            zorder=4,
        )

# 单元格分隔线（画在图像之上，避免被 imshow 盖住）
for x in np.arange(-0.5, mat.shape[1], 1.0):
    ax.axvline(x, color="white", linewidth=1.4, zorder=3)
for y in np.arange(-0.5, mat.shape[0], 1.0):
    ax.axhline(y, color="white", linewidth=1.4, zorder=3)

ax.set_xticks(np.arange(mat.shape[1]))
ax.set_xticklabels(list(VARS), fontsize=11)
ax.set_yticks(np.arange(mat.shape[0]))
ax.set_yticklabels(
    [cn("情况 %d · %.2f" % (k, p)) for k, p in zip(CASES, profit)],
    fontsize=10,
)
ax.set_xlabel(cn("决策变量"), fontsize=11)
ax.set_ylabel(cn("表 1 情况"), fontsize=11)
ax.tick_params(which="both", length=0)

cbar = fig.colorbar(im, ax=ax, fraction=0.045, pad=0.03, ticks=[0.0, 1.0])
cbar.set_label(cn("0-1 决策指示"), fontsize=9)
cbar.ax.tick_params(labelsize=9, length=0)

fig.tight_layout()
save(fig, "fig_q2_strategy_cost_heatmap")
