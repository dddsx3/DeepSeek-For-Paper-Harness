"""
fig_q1_oc_curve_p1 —— 问题 1 两种抽样方案的接收特性（OC）曲线

本图讲什么
    把问题 1 给出的两套抽样方案 (n*, c*) 翻译成接收特性曲线：对每一个可能的批真实
    次品率 p，画出"按该方案判定为接收"的概率 L(p) = P(X <= c* | n*, p)。两条曲线的
    高低直接说明了两套方案的严格程度差异——情形 (1) 的方案在标称值附近几乎必然接收、
    只有当次品率明显偏高时才拒收；情形 (2) 的方案要求样本中一件次品都不出现才接收，
    因此曲线在标称值附近就已经很低。

Panel 结构（单 panel）
    (a) 唯一面板：横轴为批真实次品率 p，纵轴为接收概率 L(p)，两条折线分别对应两套方案。

数据来自账本哪些 id
    R-Q1-case1-n = 368  情形 (1) 最小检测次数 n*
    R-Q1-case1-c = 46   情形 (1) 接收判定临界次品数 c*
    R-Q1-case2-n = 22   情形 (2) 最小检测次数 n*
    R-Q1-case2-c = 0    情形 (2) 接收判定临界次品数 c*
    曲线本身按 scipy.stats.binom.cdf(c*, n*, p) 在固定网格 p ∈ [0, 0.50]、步长 0.005
    （101 点）上求值，账本只提供 (n*, c*) 两个参数，不引入任何账本外经验数据。

关键数值（由账本计算，脚本内不写死）
    L(0.10) ≈ 0.954（情形 1 方案，在标称值处仍以约 95% 概率接收，故拒收需 X >= c*+1）
    L(0.10) ≈ 0.098（情形 2 方案，在标称值处只有约一成概率接收，因为要求零次品）
"""

import json
import math
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# ---------------------------------------------------------------------------
# 固定设定（全部来自题面 / FIGURE_PLAN 的 grid 声明，非账本数据）
# ---------------------------------------------------------------------------
NOMINAL_P = 0.10          # 题面标称次品率 10%，仅作参考线
GRID_MIN = 0.0            # FIGURE_PLAN.grid.x_min
GRID_MAX = 0.50           # FIGURE_PLAN.grid.x_max
GRID_POINTS = 101         # FIGURE_PLAN.grid.points（步长 0.005）

FIG_PATH = "figures/fig_q1_oc_curve_p1.png"

# 每个系列 = (n* 的 result_id, c* 的 result_id, 方案名, 标记符号)
SERIES_SPEC = (
    ("R-Q1-case1-n", "R-Q1-case1-c", "情形(1) 95% 信度拒收方案", "o"),
    ("R-Q1-case2-n", "R-Q1-case2-c", "情形(2) 90% 信度接收方案", "s"),
)


# ---------------------------------------------------------------------------
# 账本读取：所有数值只能来自 results.json
# ---------------------------------------------------------------------------
def load_ledger():
    """按可能的落盘位置查找账本 results.json。"""
    candidates = [
        Path("results.json"),
        Path("04-result-sources/results.json"),
        Path(__file__).resolve().parent.parent / "results.json",
        Path(__file__).resolve().parent.parent / "04-result-sources" / "results.json",
    ]
    for path in candidates:
        if path.is_file():
            with path.open("r", encoding="utf-8") as fh:
                return json.load(fh)
    raise FileNotFoundError(
        "未找到 results.json，已尝试： " + ", ".join(str(p) for p in candidates)
    )


def ledger_scalar(ledger, result_id):
    """从账本中取出单个 result_id 的数值。"""
    for item in ledger.get("results", []):
        if item.get("result_id") == result_id:
            return float(item["value"])
    raise KeyError(f"账本中不存在 result_id = {result_id}")


def binom_cdf(c_star, n_star, p):
    """L(p) = P(X <= c* | n*, p)，即二项分布累积分布函数。"""
    if p <= 0.0:
        return 1.0 if c_star >= 0 else 0.0
    if p >= 1.0:
        return 1.0 if c_star >= n_star else 0.0
    try:
        from scipy.stats import binom

        return float(binom.cdf(c_star, n_star, p))
    except Exception:
        # 无 scipy 时的等价回退：用 lgamma 稳定计算 pmf 再累加
        log_p = math.log(p)
        log_q = math.log1p(-p)
        lg_n1 = math.lgamma(n_star + 1)
        total = 0.0
        for k in range(0, int(c_star) + 1):
            log_pmf = (
                lg_n1
                - math.lgamma(k + 1)
                - math.lgamma(n_star - k + 1)
                + k * log_p
                + (n_star - k) * log_q
            )
            total += math.exp(log_pmf)
        return min(1.0, total)


# ---------------------------------------------------------------------------
# 取数并计算曲线
# ---------------------------------------------------------------------------
ledger = load_ledger()
grid = np.linspace(GRID_MIN, GRID_MAX, GRID_POINTS)

curves = []
for n_ref, c_ref, label, marker in SERIES_SPEC:
    n_star = int(round(ledger_scalar(ledger, n_ref)))
    c_star = int(round(ledger_scalar(ledger, c_ref)))
    l_p = np.array([binom_cdf(c_star, n_star, float(p)) for p in grid])
    curves.append(
        {
            "label": f"{label} (n*={n_star}, c*={c_star})",
            "marker": marker,
            "y": l_p,
            "n": n_star,
            "c": c_star,
        }
    )

# ---------------------------------------------------------------------------
# 绘图（配方骨架：渐变填充 + 极值点★标注箭头 + 微妙网格）
# ---------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6.0, 3.7))

# 标称值参考线（题面给定的 10%，非账本数值）
ax.axvline(
    NOMINAL_P,
    color=COLORS["grid"],
    linestyle=":",
    linewidth=1.2,
    alpha=0.9,
    zorder=1,
)
ax.text(
    NOMINAL_P + 0.006,
    1.11,
    "标称值 p=0.10",
    fontsize=8,
    color=COLORS["grid"],
    ha="left",
    va="top",
)

for i, curve in enumerate(curves):
    y = curve["y"]

    # 曲线下渐变填充（非不确定性，纯视觉层次）
    ax.fill_between(grid, 0.0, y, color=PALETTE[i], alpha=0.12, linewidth=0, zorder=2)

    # 主折线
    ax.plot(
        grid,
        y,
        color=PALETTE[i],
        linestyle="-",
        linewidth=2.5 if i == 0 else 1.8,
        marker=curve["marker"],
        markersize=5 if i == 0 else 4.5,
        markevery=10,
        markeredgecolor="white",
        markeredgewidth=1.0,
        label=curve["label"],
        zorder=3,
    )

    # 标称点标注：★ 标记 + 短标签（本 panel 共 2 个数据锚点）
    k_nom = int(np.argmin(np.abs(grid - NOMINAL_P)))
    y_nom = float(y[k_nom])
    ax.scatter(
        [grid[k_nom]],
        [y_nom],
        s=110,
        marker="*",
        color=PALETTE[i],
        edgecolor="white",
        linewidth=1.0,
        zorder=5,
    )
    ax.annotate(
        f"$L(0.10)={y_nom:.3f}$",
        xy=(grid[k_nom], y_nom),
        xytext=(grid[k_nom] + 0.075, min(1.08, y_nom + 0.08)),
        fontsize=8.5,
        color=PALETTE[i],
        arrowprops=dict(arrowstyle="->", color=PALETTE[i], lw=1.1),
        bbox=dict(
            boxstyle="round,pad=0.28",
            facecolor="white",
            edgecolor=PALETTE[i],
            alpha=0.9,
        ),
        zorder=6,
    )

ax.set_xlabel("批真实次品率 $p$", fontsize=11)
ax.set_ylabel("接收概率 $L(p)$", fontsize=11)
ax.set_xlim(GRID_MIN, GRID_MAX)
ax.set_ylim(0.0, 1.15)
ax.set_xticks(np.linspace(GRID_MIN, GRID_MAX, 6))
ax.set_yticks(np.linspace(0.0, 1.0, 6))
ax.tick_params(labelsize=9)
ax.legend(frameon=False, labelspacing=0.35, handlelength=1.8, fontsize=8.5, loc="center right")
ax.grid(alpha=0.12, linestyle="--", color=COLORS["grid"])
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.tight_layout()
save_fig(fig, FIG_PATH)
