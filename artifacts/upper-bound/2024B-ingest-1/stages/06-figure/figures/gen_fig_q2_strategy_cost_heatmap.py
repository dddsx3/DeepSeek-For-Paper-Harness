"""
图 fig_q2_strategy_cost_heatmap —— 问题 2 表 1 六种情况的最优决策指示矩阵。

本图讲什么
----------
表 1 的 6 种情况各自对应一组 0-1 决策 (Z1, Z2, C, D)：是否检测零配件 1、是否检测
零配件 2、是否检测成品、是否拆解不合格成品。本图把 6x4 的指示矩阵放进同一张图，
色阶表示的是「指示取值本身」（0 = 不启用 / 1 = 启用），不是成本色阶；两者不要混读。

panel
-----
(a) 唯一 panel：行 = 情况 1-6，列 = Z1 / Z2 / C / D，格内标出指示值，
    右侧图例给出 0/1 两种色块的语义。

数据来源（全部在运行时经 _figbase.load 从账本读取，脚本内不写任何数值）
----------------------------------------------------------------------
R-Q2-case{1..6}-decision-Z1 / -Z2 / -C / -D，共 24 条 result_id。
脚本用正则从账本键名中枚举情况号与决策变量名，逐格取值；缺格即抛错，
因此图上的每一个 0/1 都能追溯到 stages/04-result-sources/results.json 的对应条目。
账本路径解析集中在引导模块 _figbase.load 内（候选路径含 FIGURE_PLAN.ledger_source
声明的相对位置），不依赖执行期的 cwd。

可读出的结构（具体 0/1 值一律由运行时读数决定，不回填在此，避免重铸后图文脱节）
--------------------------------------------------------------------------
情况 2、4 启用零配件 1 检测；情况 3、4、5 启用成品检测；情况 1、6 不启用任何前置
检测与成品检测；拆解指示在各情况下的取值同样直接取自账本，不由脚本假定。
"""

from __future__ import annotations

import re

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap, to_rgb
from matplotlib.patches import Patch

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

# 账本键名模式：R-Q2-case<情况号>-decision-<决策变量>
RESULT_KEY = re.compile(r"^R-Q2-case(\d+)-decision-(Z1|Z2|C|D)$")
# 列的展示顺序（决策变量的定义顺序，不是数据值）
VAR_ORDER = ("Z1", "Z2", "C", "D")
# 0-1 指示的取值域，由决策变量定义给出，不是账本数值
INDICATOR_RANGE = (0.0, 1.0)


def _ledger_values(doc):
    """把账本统一成 {result_id: value}；兼容 {results: [...]} 与裸列表两种形态。"""
    rows = doc["results"] if isinstance(doc, dict) else doc
    return {row["result_id"]: row["value"] for row in rows}


def _ink(rgba):
    """按填充色的相对亮度挑格内文字的深浅，保证 0/1 两种底色都读得清。"""
    base = to_rgb(PALETTE[0])
    r, g, b = to_rgb(rgba)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if lum < 0.55:
        return _lighten(PALETTE[0], 0.95)
    return tuple(np.asarray(base) * 0.35)


def _indicator_matrix(values):
    """从账本读数拼出 (情况 x 决策变量) 的 0-1 指示矩阵。"""
    cell = {}
    for key, val in values.items():
        matched = RESULT_KEY.match(key)
        if matched:
            cell[(int(matched.group(1)), matched.group(2))] = float(val)
    if not cell:
        raise RuntimeError("账本中找不到 R-Q2-case*-decision-* 条目，无法绘制决策指示矩阵")

    cases = sorted({case for case, _ in cell})
    variables = [var for var in VAR_ORDER if any(var == v for _, v in cell)]
    missing = [(case, var) for case in cases for var in variables if (case, var) not in cell]
    if missing:
        raise RuntimeError(f"决策指示矩阵缺格：{missing}")

    matrix = np.array([[cell[(case, var)] for var in variables] for case in cases], dtype=float)
    return cases, variables, matrix


def main():
    values = _ledger_values(load("results.json"))
    cases, variables, matrix = _indicator_matrix(values)

    off_color = _lighten(PALETTE[0], 0.85)
    on_color = PALETTE[0]
    cmap = ListedColormap([off_color, on_color])

    fig, ax = plt.subplots(figsize=(6.0, 3.4))
    ax.pcolormesh(
        matrix,
        cmap=cmap,
        vmin=INDICATOR_RANGE[0],
        vmax=INDICATOR_RANGE[1],
        edgecolors=COLORS["grid"],
        linewidth=1.1,
    )

    for i in range(matrix.shape[0]):
        for j in range(matrix.shape[1]):
            level = int(round(matrix[i, j]))
            ax.text(
                j + 0.5,
                i + 0.5,
                f"{matrix[i, j]:.0f}",
                ha="center",
                va="center",
                fontsize=9,
                color=_ink(cmap(level)),
            )

    ax.set_xticks(np.arange(matrix.shape[1]) + 0.5)
    ax.set_xticklabels([cn(var) for var in variables])
    ax.set_yticks(np.arange(matrix.shape[0]) + 0.5)
    ax.set_yticklabels([cn(f"情况 {case}") for case in cases])
    ax.invert_yaxis()
    ax.set_xlabel(cn("决策变量（Z1 / Z2 / C / D）"))
    ax.set_ylabel(cn("表 1 情况"))
    ax.tick_params(length=0)
    for side in ("top", "right", "left", "bottom"):
        ax.spines[side].set_visible(False)

    handles = [
        Patch(facecolor=off_color, edgecolor=COLORS["grid"], label=cn("0 = 不启用")),
        Patch(facecolor=on_color, edgecolor=COLORS["grid"], label=cn("1 = 启用")),
    ]
    ax.legend(
        handles=handles,
        loc="center left",
        bbox_to_anchor=(1.03, 0.5),
        frameon=False,
        fontsize=8.5,
        handlelength=1.2,
        labelspacing=0.8,
    )

    panel(ax, "(a)")

    fig.subplots_adjust(left=0.13, right=0.80, top=0.93, bottom=0.18)
    save(fig, "fig_q2_strategy_cost_heatmap")


if __name__ == "__main__":
    main()
