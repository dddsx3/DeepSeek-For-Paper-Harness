"""
fig_q1_oc_curve_p1 —— 问题 1 抽样方案的接收特性（OC）曲线
==========================================================
本图讲什么
    把账本里问题 1 两种情形的最小检测方案 (n*, c*) 还原成接收概率曲线
    L(p) = P(X <= c*)，X ~ Binomial(n*, p)，回答"检测次数尽可能少的抽样方案"在
    真实次品率 p 偏离标称值 p0 = 10% 时如何改变接收 / 拒收倾向。

panel 构成
    (a) 全量程 OC 曲线（p in [0, 0.40]）：两条曲线 = 情形(1) 与 情形(2)；
        竖直参考线为标称值 p0 = 10%；★标出两曲线在 p0 处的接收概率 L(p0)。
    (b) p0 邻域局部放大（p in [0.06, 0.16]）：叠加 0.05（情形(1) 95% 信度拒收侧）
        与 0.90（情形(2) 90% 信度接收侧）两条判据线；★标出曲线与判据线的交点，
        并给出与该曲线同侧的判据交点横坐标。

数据来源（全部经 _figbase.load 从 results.json 读入，脚本内不写死任何结果数值）
    R-Q1-case1-n  情形(1) 最小检测次数 n*      R-Q1-case1-c  情形(1) 接收判定临界次品数 c*
    R-Q1-case2-n  情形(2) 最小检测次数 n*      R-Q1-case2-c  情形(2) 接收判定临界次品数 c*
    标称值 p0 = 10% 与两条判据信度线为题面给定参数（非账本条目）。
"""

from math import lgamma

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import FormatStrFormatter

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


# ---------------------------------------------------------------------------
# 1. 账本取数（唯一数据来源）
# ---------------------------------------------------------------------------
_LEDGER = {r["result_id"]: r["value"] for r in load("results.json")["results"]}

N1 = int(_LEDGER["R-Q1-case1-n"])   # 情形(1) 最小检测次数 n*
C1 = int(_LEDGER["R-Q1-case1-c"])   # 情形(1) 接收判定临界次品数 c*
N2 = int(_LEDGER["R-Q1-case2-n"])   # 情形(2) 最小检测次数 n*
C2 = int(_LEDGER["R-Q1-case2-c"])   # 情形(2) 接收判定临界次品数 c*

# 题面给定参数（非账本条目）
P0 = 0.10          # 标称次品率
LEVEL_LO = 0.05    # 情形(1)：95% 信度下认定超标称则拒收 → 接收概率判据 0.05
LEVEL_HI = 0.90    # 情形(2)：90% 信度下认定不超标称则接收 → 接收概率判据 0.90

P_FULL = (0.0, 0.40)    # (a) 全量程
P_ZOOM = (0.06, 0.16)   # (b) 标称值邻域

LBL1 = cn(f"情形(1)  n*={N1}, c*={C1}")
LBL2 = cn(f"情形(2)  n*={N2}, c*={C2}")


# ---------------------------------------------------------------------------
# 2. 计算工具：二项分布 CDF（对数域求和，避免 n 大时下溢）
# ---------------------------------------------------------------------------
def oc_curve(p_grid, n, c):
    """接收概率 L(p) = P(X <= c)，X ~ Binomial(n, p)；n、c 取自账本。"""
    p = np.clip(np.asarray(p_grid, dtype=float), 1e-12, 1.0 - 1e-12)
    k = np.arange(0, int(c) + 1, dtype=float)
    log_coef = np.array([lgamma(n + 1.0) - lgamma(kk + 1.0) - lgamma(n - kk + 1.0)
                         for kk in k])
    log_pmf = (log_coef[:, None]
               + k[:, None] * np.log(p)[None, :]
               + (n - k)[:, None] * np.log1p(-p)[None, :])
    shift = log_pmf.max(axis=0)
    return np.exp(log_pmf - shift).sum(axis=0) * np.exp(shift)


def crossings(x, y, level):
    """折线 (x, y) 与水平线 y = level 的交点横坐标（线性插值）。"""
    d = np.asarray(y, dtype=float) - level
    out = []
    for i in np.where(np.diff(np.sign(d)) != 0)[0]:
        d0, d1 = d[i], d[i + 1]
        if d1 != d0:
            out.append(float(x[i] + (-d0) / (d1 - d0) * (x[i + 1] - x[i])))
    return out


# ---------------------------------------------------------------------------
# 3. 绘图
# ---------------------------------------------------------------------------
fig, (ax_a, ax_b) = plt.subplots(1, 2, figsize=(6.0, 2.8))

p_a = np.linspace(P_FULL[0], P_FULL[1], 601)
p_b = np.linspace(P_ZOOM[0], P_ZOOM[1], 401)

# 每条曲线携带：图例标签、颜色、曲线、(b) 面板中与它同侧的判据线高度
series_a = [(LBL1, PALETTE[0], oc_curve(p_a, N1, C1)),
            (LBL2, PALETTE[1], oc_curve(p_a, N2, C2))]
series_b = [(LBL1, PALETTE[0], oc_curve(p_b, N1, C1), LEVEL_LO),
            (LBL2, PALETTE[1], oc_curve(p_b, N2, C2), LEVEL_HI)]

# --- panel (a)：全量程 OC 曲线 -------------------------------------------------
for lbl, color, y in series_a:
    fill_c = _lighten(color, 0.55)
    for alpha in (0.35, 0.18, 0.08):          # 多层渐变填充，色深浅由浅色底 + 透明度叠出
        ax_a.fill_between(p_a, 0.0, y, color=fill_c, alpha=alpha, linewidth=0, zorder=1)
    ax_a.plot(p_a, y, color=color, lw=2.0, zorder=3, label=lbl)

ax_a.axvline(P0, color=COLORS["ref_line"], ls="--", lw=1.0, zorder=2,
             label=cn("标称值 p₀=10%"))

y_nom1 = float(oc_curve(np.array([P0]), N1, C1)[0])
y_nom2 = float(oc_curve(np.array([P0]), N2, C2)[0])
for yv, color, dy, va in ((y_nom1, PALETTE[0], -20.0, "top"),
                          (y_nom2, PALETTE[1], 13.0, "bottom")):
    ax_a.scatter(P0, yv, marker="*", s=110, color=color,
                 edgecolor="white", linewidth=1.0, zorder=4)
    ax_a.annotate(f"L={yv:.3f}", xy=(P0, yv), xytext=(6, dy),
                  textcoords="offset points", fontsize=7, color=color,
                  va=va, ha="left", zorder=5,
                  bbox=dict(boxstyle="round,pad=0.18", fc="white",
                            ec=color, lw=0.7, alpha=0.9))

# --- panel (b)：p0 邻域放大 + 判据线 + 交点 -------------------------------------
for lbl, color, y, _lvl in series_b:
    fill_c = _lighten(color, 0.55)
    for alpha in (0.35, 0.18, 0.08):
        ax_b.fill_between(p_b, 0.0, y, color=fill_c, alpha=alpha, linewidth=0, zorder=1)
    ax_b.plot(p_b, y, color=color, lw=2.0, zorder=3, label=lbl)

ax_b.axhline(LEVEL_LO, color=COLORS["ref_line"], ls="--", lw=1.0, zorder=2,
             label=cn("判据线 L=0.05"))
ax_b.axhline(LEVEL_HI, color=COLORS["accent"], ls=":", lw=1.2, zorder=2,
             label=cn("判据线 L=0.90"))
ax_b.axvline(P0, color=COLORS["neutral"], ls="-.", lw=1.0, zorder=2)

n_lab = 0
for _lbl, color, y, lvl_des in series_b:
    for lvl in (LEVEL_LO, LEVEL_HI):
        for xc in crossings(p_b, y, lvl):
            ax_b.scatter(xc, lvl, marker="*", s=70, color=color,
                         edgecolor="white", linewidth=0.8, zorder=5)
            if abs(lvl - lvl_des) < 1e-12 and n_lab < 2:
                ax_b.annotate(f"p≈{xc:.3f}", xy=(xc, lvl), xytext=(-8, 16),
                              textcoords="offset points", ha="right", fontsize=7,
                              color=color, zorder=6,
                              bbox=dict(boxstyle="round,pad=0.18", fc="white",
                                        ec=color, lw=0.7, alpha=0.9))
                n_lab += 1

# --- 公共版式 -----------------------------------------------------------------
for ax in (ax_a, ax_b):
    ax.set_ylim(0.0, 1.05)
    ax.set_yticks([0.0, 0.25, 0.50, 0.75, 1.00])
    ax.grid(alpha=0.12, ls="--", color=COLORS["grid"], zorder=0)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(labelsize=7.5)

ax_a.set_xlim(P_FULL)
ax_b.set_xlim(P_ZOOM)
ax_a.set_xticks(np.arange(0.0, 0.41, 0.10))
ax_b.set_xticks(np.arange(0.06, 0.161, 0.02))
ax_a.xaxis.set_major_formatter(FormatStrFormatter("%.2f"))
ax_b.xaxis.set_major_formatter(FormatStrFormatter("%.3f"))

ax_a.set_xlabel(cn("真实次品率 p（无量纲）"), fontsize=8.5)
ax_b.set_xlabel(cn("真实次品率 p（无量纲，局部放大）"), fontsize=8.5)
ax_a.set_ylabel(cn("接收概率 L(p)（无量纲）"), fontsize=8.5)

ax_a.legend(frameon=False, fontsize=7, loc="upper right",
            labelspacing=0.3, handlelength=1.4, borderaxespad=0.3)
ax_b.legend(frameon=False, fontsize=6.5, loc="upper right",
            labelspacing=0.3, handlelength=1.4, borderaxespad=0.3)

panel(ax_a, "(a)")
panel(ax_b, "(b)")
fig.tight_layout()

save(fig, "fig_q1_oc_curve_p1")
