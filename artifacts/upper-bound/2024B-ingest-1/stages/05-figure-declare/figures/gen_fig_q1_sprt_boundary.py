"""fig_q1_sprt_boundary —— 问题 1 定数一次抽样的二维判定域（接收 / 拒收分区）。

本图讲什么
----------
问题 1 要求"检测次数尽可能少"的抽样检测方案。本图把两套最小样本量方案
各自的判定规则摊在「抽检件数 n × 累计次品数 k」平面上：累计次品数不超过
临界次品数 c* 的区域判为接收，否则拒收；★ 标出临界点 (n*, c*)。
两套方案同口径分区，便于横向比对"检测次数尽可能少"的代价。

每个 panel 是什么
-----------------
(a) 情形(1)（95% 信度下认定次品率超过标称值则拒收）：抽检上限 n*、临界次品数 c*，
    判定边界为水平线 k = c*，边界下方为接收域。
(b) 情形(2)（90% 信度下认定次品率不超过标称值则接收）：抽检上限 n*、临界次品数 c*，
    即抽检件数须全部合格才落入接收域（c* = 0，接收域退化为一条边）。

数据来自账本哪些 id（results.json，脚本内无任何硬编码数值）
----------------------------------------------------------
R-Q1-case1-n、R-Q1-case1-c、R-Q1-case2-n、R-Q1-case2-c

关键数值（运行时由账本读出并落在图上）：情形(1) 的 (n*, c*) 与情形(2) 的 (n*, c*)，
以及由它们生成的接收域 / 拒收域分区与判定边界线。

口径说明：本图画的是定数一次抽样的判定域，不是序贯抽样(SPRT)的「继续抽样带」——
账本中没有 SPRT 的参数条目，故不虚构序贯边界；id 沿用阶段 1 清单，正文以题注命名。
"""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.lines import Line2D
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

# ── 取数：全部数值来自账本，不得硬编码 ────────────────────────────────────────
doc = load("results.json")
_rows = doc["results"] if isinstance(doc, dict) else doc
V = {r["result_id"]: r["value"] for r in _rows}

N1 = float(V["R-Q1-case1-n"])   # 情形(1) 最小检测次数 n*
C1 = float(V["R-Q1-case1-c"])   # 情形(1) 接收判定临界次品数 c*
N2 = float(V["R-Q1-case2-n"])   # 情形(2) 最小检测次数 n*
C2 = float(V["R-Q1-case2-c"])   # 情形(2) 接收判定临界次品数 c*

# 两档填充：接收=主色浅版，拒收=语义"down"浅版（离散二分区，不用连续色阶）
CMAP2 = ListedColormap([_lighten(COLORS["down"], 0.72), _lighten(PALETTE[0], 0.55)])


def draw_domain(ax, n_star, c_star, tag):
    """在 (n, k) 平面上画接收 / 拒收二分区、判定边界与临界点。"""
    n_max = max(n_star, 1.0)
    k_max = max(n_star, 1.0)
    nn = np.linspace(0.0, n_max, 260)
    kk = np.linspace(0.0, k_max, 260)
    NN, KK = np.meshgrid(nn, kk)
    accept = (KK <= c_star).astype(float)

    # 二分区填充（接收域 / 拒收域）
    ax.contourf(NN, KK, accept, levels=[-0.5, 0.5, 1.5], cmap=CMAP2, zorder=2)
    # 判定边界：累计次品数 = c*（由账本 c* 精确落线）
    ax.plot([0.0, n_max], [c_star, c_star], color=PALETTE[0], lw=2.0, zorder=5)
    # 抽检上限参考线 n*
    ax.axvline(n_star, ls="--", lw=1.4, color=COLORS["ref_line"], zorder=5)
    # 临界点 (n*, c*)
    ax.scatter([n_star], [c_star], s=150, marker="*", color=PALETTE[4], zorder=8,
               edgecolors="white", linewidths=1.2)
    ax.annotate(f"$({n_star:.0f},\\,{c_star:.0f})$",
                xy=(n_star, c_star),
                xytext=(n_star * 0.90, c_star + 0.10 * k_max),
                fontsize=8.6, color=PALETTE[4], fontweight="bold",
                ha="right", va="bottom", zorder=9)

    ax.set_xlim(0.0, n_max)
    ax.set_ylim(0.0, k_max)
    x_ticks = [0.0, n_max / 2.0, n_max]
    y_ticks = sorted({0.0, float(c_star), k_max / 2.0, k_max})
    ax.set_xticks(x_ticks)
    ax.set_yticks(y_ticks)
    ax.set_xticklabels([f"{t:g}" for t in x_ticks])
    ax.set_yticklabels([f"{t:g}" for t in y_ticks])
    ax.tick_params(labelsize=9.0)
    ax.set_xlabel(cn("抽检件数 $n$（件）"), fontsize=10.4)
    ax.set_ylabel(cn("累计次品数 $k$（件）"), fontsize=10.4)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    panel(ax, tag)


fig, axes = plt.subplots(1, 2, figsize=(6.0, 3.0))
ax_a, ax_b = axes

draw_domain(ax_a, N1, C1, "(a)")
draw_domain(ax_b, N2, C2, "(b)")

# 图例（以代理句柄说明分区与边界线，避免在图内写整句结论）
handles = [
    Line2D([], [], marker="s", ls="", markersize=10,
           markerfacecolor=_lighten(PALETTE[0], 0.55), markeredgecolor=PALETTE[0],
           label=cn("接收域")),
    Line2D([], [], marker="s", ls="", markersize=10,
           markerfacecolor=_lighten(COLORS["down"], 0.72), markeredgecolor=COLORS["down"],
           label=cn("拒收域")),
    Line2D([], [], color=PALETTE[0], lw=2.0, label=cn("判定边界 $k=c^{*}$")),
    Line2D([], [], color=COLORS["ref_line"], ls="--", lw=1.4, label=cn("抽检上限 $n^{*}$")),
]
ax_a.legend(handles=handles, frameon=False, fontsize=8.2, loc="upper left",
            handlelength=1.6, labelspacing=0.28, borderpad=0.22)

fig.subplots_adjust(left=0.095, right=0.985, bottom=0.165, top=0.945, wspace=0.26)
save(fig, "fig_q1_sprt_boundary")
