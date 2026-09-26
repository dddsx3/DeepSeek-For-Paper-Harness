"""fig_q2_six_cases_decisions —— 表 1 六种情况：最优期望利润与利润缺口。

本图讲什么：
    问题 2 表 1 的六种参数组合，分别在各自最优 (Z1, Z2, C, D) 决策下的单位成品期望利润，
    以及相对全列最优情况的利润缺口 Δ（= 全列最大利润 − 该情况利润），
    用来回答“哪种参数组合的决策代价最大、哪种参数组合最容易拿到高利润”。

每个 panel 是什么：
    (a) 六种情况的最优期望利润柱状图：柱顶标数值，x 轴刻度标签附带该情况的最优决策组合
        Z1Z2CD（与决策矩阵逐格对照），全列最优情况用强调色高亮，
        水平虚线为全列最大值参考线（判据线）。
    (b) 以全列最优利润为基准的利润缺口 Δ 横条，按缺口从大到小排序，
        缺口最大者（决策代价最大）用“损失”语义色标出。

数据来自账本哪些 id：
    利润： R-Q2-case1-profit … R-Q2-case6-profit
    决策： R-Q2-case{k}-decision-{Z1,Z2,C,D}（k = 1..6，共 24 条 0-1 指示，构造为 data_refs 的键）
    基准利润（全列最大值）与缺口 Δ 均由上述账本读数在运行期算出，
    脚本不含任何写死的数值数据；具体读到多少由 results.json 决定（上游重铸后本图自动同步）。

关键读数（运行期从账本读出，不在此写死）：利润最高的情况由 argmax 判定并高亮，
缺口最大的情况由排序首位判定并用损失色标出。
"""

import os
import sys

import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


# --------------------------------------------------------------------------
# 账本键：全部按 result_id 规则构造，键名与 FIGURE_PLAN.data_refs 一致
# --------------------------------------------------------------------------
CASE_INDEX = (1, 2, 3, 4, 5, 6)
DECISION_FLAGS = ("Z1", "Z2", "C", "D")

PROFIT_IDS = ["R-Q2-case%d-profit" % k for k in CASE_INDEX]
DECISION_IDS = [
    ["R-Q2-case%d-decision-%s" % (k, flag) for flag in DECISION_FLAGS]
    for k in CASE_INDEX
]


def soft_cn(text):
    """中文缺字兜底：_figbase.cn 可用则用，异常时原样返回。"""
    try:
        return cn(text)
    except Exception:
        return text


def ledger_values(doc):
    """把 results.json 归一化成 {result_id: value}。"""
    rows = doc.get("results", doc) if isinstance(doc, dict) else doc
    return {row["result_id"]: row["value"] for row in rows}


def main():
    vals = ledger_values(load("results.json"))

    profits = [float(vals[rid]) for rid in PROFIT_IDS]
    decisions = [
        [int(round(float(vals[rid]))) for rid in ids] for ids in DECISION_IDS
    ]

    best = int(np.argmax(profits))            # 全列最优情况
    best_profit = profits[best]
    gaps = [best_profit - p for p in profits]  # 相对最优的利润缺口 Δ

    case_labels = [
        soft_cn("情形%d\n(%s)" % (k, "".join(str(v) for v in dec)))
        for k, dec in zip(CASE_INDEX, decisions)
    ]
    row_labels = [lab.replace("\n", " ") for lab in case_labels]

    fig, (ax_a, ax_b) = plt.subplots(1, 2, figsize=(6.0, 3.0))
    fig.subplots_adjust(left=0.095, right=0.985, top=0.88, bottom=0.24, wspace=0.62)

    # ----------------------------------------------------------------------
    # panel (a)：六种情况的最优期望利润（柱顶数值 + 最大值参考线 + 最优高亮）
    # ----------------------------------------------------------------------
    xs = np.arange(len(CASE_INDEX))
    face_a = [_lighten(PALETTE[0], 0.55) for _ in CASE_INDEX]
    edge_a = [PALETTE[0] for _ in CASE_INDEX]
    face_a[best] = _lighten(COLORS["accent"], 0.32)
    edge_a[best] = COLORS["accent"]

    bars_a = ax_a.bar(
        xs, profits, width=0.62, color=face_a, edgecolor=edge_a,
        linewidth=1.0, zorder=3,
    )
    ax_a.axhline(best_profit, color=COLORS["ref_line"], lw=1.0, ls="--", zorder=2)
    ax_a.bar_label(bars_a, fmt="%.2f", padding=2, fontsize=7)
    ax_a.set_xticks(xs)
    ax_a.set_xticklabels(case_labels, fontsize=7)
    ax_a.set_xlim(-0.65, len(CASE_INDEX) - 0.35)
    ax_a.set_ylim(0.0, best_profit * 1.16)
    ax_a.set_xlabel(soft_cn("表 1 情况（标签附最优决策 Z1Z2CD）"), fontsize=8)
    ax_a.set_ylabel(soft_cn("期望利润（元/件）"), fontsize=8)
    ax_a.tick_params(axis="y", labelsize=7.5)
    ax_a.grid(axis="y", color=COLORS["grid"], lw=0.6, alpha=0.6, zorder=0)
    ax_a.set_axisbelow(True)
    panel(ax_a, "(a)")

    # ----------------------------------------------------------------------
    # panel (b)：以全列最优利润为基准的利润缺口 Δ，按缺口降序的横条
    # ----------------------------------------------------------------------
    order = sorted(range(len(CASE_INDEX)), key=lambda i: gaps[i], reverse=True)
    ypos = np.arange(len(order))
    gap_sorted = [gaps[i] for i in order]
    label_sorted = [row_labels[i] for i in order]

    face_b = [_lighten(PALETTE[1], 0.55) for _ in order]
    edge_b = [PALETTE[1] for _ in order]
    face_b[0] = _lighten(COLORS["down"], 0.45)   # 缺口最大者 = 决策代价最大
    edge_b[0] = COLORS["down"]

    bars_b = ax_b.barh(
        ypos, gap_sorted, height=0.62, color=face_b, edgecolor=edge_b,
        linewidth=1.0, zorder=3,
    )
    ax_b.invert_yaxis()
    ax_b.set_yticks(ypos)
    ax_b.set_yticklabels(label_sorted, fontsize=7)
    ax_b.bar_label(bars_b, fmt="%.2f", padding=2, fontsize=7)
    gap_top = max(gap_sorted)
    ax_b.set_xlim(0.0, gap_top * 1.20 if gap_top > 0 else 1.0)
    ax_b.set_xlabel(soft_cn("利润缺口（元/件）"), fontsize=8)
    ax_b.tick_params(axis="x", labelsize=7.5)
    ax_b.grid(axis="x", color=COLORS["grid"], lw=0.6, alpha=0.6, zorder=0)
    ax_b.set_axisbelow(True)
    panel(ax_b, "(b)")

    for ax in (ax_a, ax_b):
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color(COLORS["gray"])
        ax.spines["bottom"].set_color(COLORS["gray"])

    save(fig, "fig_q2_six_cases_decisions")
    plt.close(fig)


if __name__ == "__main__":
    main()
