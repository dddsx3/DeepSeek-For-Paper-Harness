"""绘制固定接收规则下的 OC 曲线与关键点局部放大。

面板 (a) 展示完整 OC 曲线，并在图内标出抽样规则及最大接收概率。
面板 (b) 放大标称次品率与备择次品率附近的接收概率差异。
全部数据取自 results.json 中的 R-Q1-oc-curve-p-grid、
R-Q1-oc-curve-accept-prob、R-Q1-nominal-p、R-Q1-p-alt、
R-Q1-oc-curve-n 与 R-Q1-oc-curve-c；脚本不内嵌账本数值。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import MultipleLocator, PercentFormatter


doc = load("results.json")
records = {item["result_id"]: item["value"] for item in doc["results"]}

p_grid = np.asarray(records["R-Q1-oc-curve-p-grid"], dtype=float)
accept_prob = np.asarray(records["R-Q1-oc-curve-accept-prob"], dtype=float)
nominal_p = float(records["R-Q1-nominal-p"])
alternative_p = float(records["R-Q1-p-alt"])
sample_size = records["R-Q1-oc-curve-n"]
critical_count = records["R-Q1-oc-curve-c"]

if p_grid.ndim != 1 or accept_prob.ndim != 1:
    raise ValueError("OC 曲线横纵轴必须是一维序列")
if len(p_grid) != len(accept_prob):
    raise ValueError("OC 曲线横纵轴长度不一致")
if not np.all(np.diff(p_grid) > 0):
    raise ValueError("OC 曲线横轴必须严格递增")


def nearest_index(target):
    """返回与账本参考点最接近的曲线网格索引。"""
    return int(np.argmin(np.abs(p_grid - target)))


def interpolate_accept_probability(target):
    """仅利用账本曲线插值得到参考点处的接收概率。"""
    return float(np.interp(target, p_grid, accept_prob))


nominal_idx = nearest_index(nominal_p)
alternative_idx = nearest_index(alternative_p)
nominal_accept = interpolate_accept_probability(nominal_p)
alternative_accept = interpolate_accept_probability(alternative_p)

p_step = float(np.median(np.diff(p_grid)))
p_min = float(np.min(p_grid))
p_max = float(np.max(p_grid))
accept_min = float(np.min(accept_prob))
accept_max = float(np.max(accept_prob))
probability_scale = max(accept_max, p_max)
y_floor = min(0.0, accept_min)
y_ceiling = accept_max + (accept_max - accept_min) * 0.04

zoom_left = max(p_min, min(nominal_p, alternative_p) - p_step)
zoom_right = min(p_max, max(nominal_p, alternative_p) + p_step)
if zoom_right <= zoom_left:
    raise ValueError("标称点与备择点未形成有效的局部放大区间")

n_text = str(int(sample_size))
c_text = str(int(critical_count))
rule_text = cn(f"抽样规则：n*={n_text} 件，c*={c_text} 件")
curve_label = cn("OC 接收概率")

fig, axes = plt.subplots(
    1,
    2,
    figsize=(6.0, 3.0),
    sharey=True,
    gridspec_kw={"width_ratios": [1.15, 1.0]},
)
ax_full, ax_zoom = axes


def style_axis(ax, locator_multiple):
    ax.grid(
        True,
        which="major",
        axis="both",
        color=COLORS["grid"],
        alpha=0.28,
        linestyle="--",
        linewidth=0.7,
    )
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(COLORS["grid"])
    ax.spines["bottom"].set_color(COLORS["grid"])
    ax.tick_params(labelsize=8, colors=COLORS["gray"])
    ax.xaxis.set_major_locator(MultipleLocator(p_step * locator_multiple))
    ax.xaxis.set_major_formatter(PercentFormatter(xmax=probability_scale))
    ax.yaxis.set_major_formatter(PercentFormatter(xmax=probability_scale))
    ax.set_xlabel(cn("真实次品率 $p$"), fontsize=9.5)
    ax.set_ylabel(cn("接收概率 $L(p)$"), fontsize=9.5)


style_axis(ax_full, 10)
style_axis(ax_zoom, 2)

ax_full.axhspan(
    y_floor,
    y_ceiling,
    alpha=0.02,
    color=PALETTE[0],
    zorder=0,
)
for alpha in (0.15, 0.08, 0.03):
    ax_full.fill_between(
        p_grid,
        y_floor,
        accept_prob,
        alpha=alpha,
        color=PALETTE[0],
        linewidth=0,
        zorder=1,
    )
ax_full.plot(
    p_grid,
    accept_prob,
    color=PALETTE[0],
    linewidth=2.2,
    marker="o",
    markersize=2.8,
    markeredgecolor="white",
    markeredgewidth=0.7,
    label=curve_label,
    zorder=4,
)

for reference_p, color in (
    (nominal_p, PALETTE[1]),
    (alternative_p, PALETTE[2]),
):
    ax_full.axvline(
        reference_p,
        color=_lighten(color, 0.35),
        linewidth=1.1,
        linestyle="--",
        alpha=0.8,
        zorder=2,
    )

max_candidates = np.flatnonzero(accept_prob == accept_max)
max_idx = int(max_candidates[np.argmin(np.abs(p_grid[max_candidates] - nominal_p))])
ax_full.scatter(
    p_grid[max_idx],
    accept_prob[max_idx],
    s=90,
    marker="*",
    color=PALETTE[1],
    edgecolor="white",
    linewidth=1.2,
    zorder=6,
)
ax_full.annotate(
    cn(f"★ 最高接收概率 {accept_prob[max_idx]:.1%}"),
    xy=(p_grid[max_idx], accept_prob[max_idx]),
    xytext=(alternative_p, accept_max - (accept_max - accept_min) * 0.12),
    ha="center",
    va="center",
    fontsize=7.5,
    color=PALETTE[1],
    arrowprops={
        "arrowstyle": "->",
        "color": PALETTE[1],
        "lw": 1.0,
        "shrinkA": 3,
        "shrinkB": 3,
    },
    bbox={
        "boxstyle": "round,pad=0.25",
        "facecolor": "white",
        "edgecolor": PALETTE[1],
        "alpha": 0.92,
    },
    zorder=7,
)
ax_full.text(
    0.03,
    0.08,
    rule_text,
    transform=ax_full.transAxes,
    ha="left",
    va="bottom",
    fontsize=7.5,
    color=COLORS["gray"],
    bbox={
        "boxstyle": "round,pad=0.25",
        "facecolor": "white",
        "edgecolor": COLORS["grid"],
        "alpha": 0.9,
    },
)
ax_full.set_xlim(p_min, p_max)
ax_full.set_ylim(y_floor, y_ceiling)
ax_full.legend(
    loc="upper right",
    frameon=False,
    fontsize=8,
    handlelength=1.8,
)

ax_zoom.fill_between(
    p_grid,
    y_floor,
    accept_prob,
    color=_lighten(PALETTE[0], 0.72),
    alpha=0.35,
    linewidth=0,
    zorder=1,
)
ax_zoom.plot(
    p_grid,
    accept_prob,
    color=PALETTE[0],
    linewidth=2.3,
    marker="o",
    markersize=2.8,
    markeredgecolor="white",
    markeredgewidth=0.7,
    zorder=4,
)

reference_points = (
    (
        nominal_p,
        nominal_accept,
        PALETTE[1],
        cn(f"标称点 $p_0$={nominal_p:.1%}\n接收概率 {nominal_accept:.1%}"),
        (12, 10),
        "left",
    ),
    (
        alternative_p,
        alternative_accept,
        PALETTE[2],
        cn(f"备择点 $p_1$={alternative_p:.1%}\n接收概率 {alternative_accept:.1%}"),
        (-12, -18),
        "right",
    ),
)
for reference_p, reference_y, color, text, offset, alignment in reference_points:
    ax_zoom.axvline(
        reference_p,
        color=_lighten(color, 0.35),
        linewidth=1.1,
        linestyle="--",
        alpha=0.85,
        zorder=2,
    )
    ax_zoom.scatter(
        reference_p,
        reference_y,
        s=72,
        color=color,
        edgecolor="white",
        linewidth=1.4,
        zorder=6,
    )
    ax_zoom.annotate(
        text,
        xy=(reference_p, reference_y),
        xytext=offset,
        textcoords="offset points",
        ha=alignment,
        va="center",
        fontsize=7.3,
        color=color,
        arrowprops={
            "arrowstyle": "->",
            "color": color,
            "lw": 1.0,
            "shrinkA": 3,
            "shrinkB": 3,
        },
        bbox={
            "boxstyle": "round,pad=0.25",
            "facecolor": "white",
            "edgecolor": color,
            "alpha": 0.92,
        },
        zorder=7,
    )

ax_zoom.set_xlim(zoom_left, zoom_right)
ax_zoom.set_ylim(y_floor, y_ceiling)

panel(ax_full, "(a)")
panel(ax_zoom, "(b)")
fig.tight_layout(w_pad=1.1)
save(fig, "fig_q1_oc_curve_p1")
