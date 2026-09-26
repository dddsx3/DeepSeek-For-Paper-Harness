#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""fig_q1_sprt_boundary —— 固定样本抽样判定的接收／拒收二维分区边界（双面板）。

本图讲什么
    问题 1 交出的方案是"固定样本量 + 临界次品数"的抽样判定规则 (n*, c*)：
    抽检 n* 件，若累计不合格数 d ≤ c* 则接收该批，否则拒收。
    本图在（抽样件数 k，累计不合格数 d）平面上把该判定规则画成一张二维分区图：
    浅色区 = 接收区（d ≤ c*），深色区 = 拒收区（d > c*）；水平实线即判定门槛 c*，
    竖直虚线标出判定实际发生的样本量 n*，两线交点（右侧圆点）就是该判定规则的角点。

每个 panel 是什么
    (a) 情形(1)（控制拒收侧第一类错误，95% 信度拒收）：n* 取自 R-Q1-case1-n，
        c* 取自 R-Q1-case1-c；
    (b) 情形(2)（单侧置信上界口径，90% 信度接收）：n* 取自 R-Q1-case2-n，
        c* 取自 R-Q1-case2-c。
    两个 panel 的坐标轴量级差异极大（样本量与临界数都不同量级），故各自独立标度，
    不共用坐标轴；接收/拒收语义由图例统一说明。

数据来自账本哪些 id
    R-Q1-case1-n、R-Q1-case1-c、R-Q1-case2-n、R-Q1-case2-c
    —— 全部经 load_ledger() 从 results.json 读出，脚本内不写任何数值常量。

与规划的偏差（已在 FIGURE_PLAN.plan_deviations 登记）
    账本未铸出序贯（截尾）抽样的逐样本"接受／拒收／继续抽样"三区边界，
    故本图绘制的是固定样本判定边界，而非序贯 SPRT 边界。
"""

import json
import os

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()


# ── 账本定位：多候选路径回退，含 FIGURE_PLAN.ledger_source 声明的相对位置 ──────────
_LEDGER_RELPATHS = (
    "results.json",
    "stages/04-result-sources/results.json",
    "../04-result-sources/results.json",
    "04-result-sources/results.json",
)


def load_ledger():
    """按候选路径链定位 results.json，返回解析后的对象（执行期 cwd 无关）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    roots = (
        os.getcwd(),
        here,
        os.path.dirname(here),
        os.path.dirname(os.path.dirname(here)),
    )
    tried = []
    for root in roots:
        for rel in _LEDGER_RELPATHS:
            cand = os.path.normpath(os.path.join(root, rel))
            if cand in tried:
                continue
            tried.append(cand)
            if os.path.isfile(cand):
                with open(cand, "r", encoding="utf-8") as fh:
                    return json.load(fh)
    raise FileNotFoundError("未找到 results.json，已尝试：" + " ; ".join(tried))


def _index(blob):
    rows = blob.get("results", []) if isinstance(blob, dict) else blob
    return {row["result_id"]: row for row in rows}


_LEDGER = _index(load_ledger())


def ledger_value(result_id):
    """取账本中某个 result_id 的数值（图里每一个数都只能来自这里）。"""
    return float(_LEDGER[result_id]["value"])


def _axis_ticks(top, extra=None, include_top=False):
    """按量级从归档刻度梯子里挑步长，生成刻度（保证临界值进刻度）。"""
    top = float(top)
    target = max(top / 4.0, 1e-9)
    step = 1.0
    for cand in (1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500):
        if cand <= target:
            step = float(cand)
    ticks = [float(v) for v in np.arange(0.0, top + 1e-9, step)]
    if not ticks:
        ticks = [0.0]
    if include_top and ticks[-1] < top:
        ticks.append(top)
    for e in (extra or []):
        e = float(e)
        if e not in ticks:
            ticks.append(e)
    return sorted(set(ticks))


# ── 面板规格：(面板标签, 样本量 result_id, 临界次品数 result_id) ─────────────────
PANELS = (
    ("(a) 情形(1)", "R-Q1-case1-n", "R-Q1-case1-c"),
    ("(b) 情形(2)", "R-Q1-case2-n", "R-Q1-case2-c"),
)

ACCEPT_FILL = _lighten(PALETTE[0], 0.55)
REJECT_FILL = _lighten(COLORS["down"], 0.72)

LEGEND_ITEMS = [
    Patch(facecolor=ACCEPT_FILL, edgecolor=PALETTE[0], linewidth=0.9,
          label="接收区（累计不合格数 ≤ $c^*$）"),
    Patch(facecolor=REJECT_FILL, edgecolor=COLORS["down"], linewidth=0.9,
          label="拒收区（累计不合格数 > $c^*$）"),
]

fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8))

for ax, (panel_label, n_id, c_id) in zip(axes, PANELS):
    n_star = float(ledger_value(n_id))
    c_star = float(ledger_value(c_id))
    y_top = float(max(3.0, np.ceil(1.5 * c_star)))     # 纵轴上限随 c* 自适应
    x_hi = n_star * 1.15                               # 右侧留出 n* 标注栏

    # 两档分区填充：浅色 = 接收区，深色 = 拒收区（离散二分，不是连续目标值）
    ax.fill_between([0.0, n_star], -0.5, c_star, color=ACCEPT_FILL,
                    linewidth=0.0, zorder=2)
    ax.fill_between([0.0, n_star], c_star, y_top, color=REJECT_FILL,
                    linewidth=0.0, zorder=2)

    # 判定门槛线（水平，y = c*）与判定发生位置（竖直虚线，x = n*）
    ax.axhline(c_star, color=PALETTE[0], lw=2.0, zorder=4)
    ax.axvline(n_star, color=PALETTE[1], ls="--", lw=1.4, zorder=5)

    # 判定规则角点 (n*, c*)：白描边使其从填充中跳出
    ax.scatter([n_star], [c_star], s=46, marker="o", color=PALETTE[4],
               edgecolors="white", linewidths=1.1, zorder=8)

    # 数据锚点短标签（每面板 2 个）：c* 贴门槛线、n* 贴竖线（竖排避开填充区）
    ax.text(n_star * 0.5, c_star + 0.05 * y_top, f"$c^*$ = {c_star:g}",
            ha="center", va="bottom", fontsize=8.4, color=PALETTE[0],
            fontweight="bold", zorder=9)
    ax.text(n_star * 1.01, y_top * 0.98, f"$n^*$ = {n_star:g}",
            rotation=90, ha="left", va="top", fontsize=8.4, color=PALETTE[1],
            fontweight="bold", zorder=9)

    ax.set_xlim(0.0, x_hi)
    ax.set_ylim(-0.5, y_top)
    ax.set_xticks(_axis_ticks(n_star, extra=[n_star]))
    ax.set_yticks(_axis_ticks(y_top, extra=[c_star]))
    ax.tick_params(labelsize=9.0)

    ax.set_xlabel("抽样件数（件）", fontsize=9.6)
    ax.set_ylabel("累计不合格数（件）", fontsize=9.6)
    ax.set_title(panel_label, loc="left", fontsize=10.4, fontweight="bold", pad=5)
    ax.legend(handles=LEGEND_ITEMS, frameon=False, fontsize=7.6, loc="lower left",
              handlelength=1.5, labelspacing=0.3, borderpad=0.25)

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

fig.subplots_adjust(left=0.095, right=0.985, bottom=0.20, top=0.885, wspace=0.32)
save_fig(fig, "figures/fig_q1_sprt_boundary.png")
