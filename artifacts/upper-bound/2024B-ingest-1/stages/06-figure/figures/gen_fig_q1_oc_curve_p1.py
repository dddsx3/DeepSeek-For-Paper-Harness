"""绘制问题1固定样本量抽样方案的接收特性曲线。

Panel (a) 展示 OC 曲线、标称次品率与备择点，并标注抽样方案对应的
样本量和临界次品数。Panel (b) 展示两种情形在各自判定点上的误差率、
功效或接收概率。
数据来自账本 result_id：R-Q1-nominal-p、R-Q1-p-alt、
R-Q1-oc-curve-p-grid、R-Q1-oc-curve-accept-prob、R-Q1-oc-curve-n、
R-Q1-oc-curve-c、R-Q1-case95-err-reject-at-nom、
R-Q1-case95-power-at-alt、R-Q1-case90-accept-prob-at-nom、
R-Q1-case90-accept-prob-at-alt。关键数值均在运行时读取，不在注释中固化。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter


doc = load("results.json")
if isinstance(doc, dict) and "results" in doc:
    records = doc["results"]
else:
    records = doc

if isinstance(records, dict):
    values = records
else:
    values = {item["result_id"]: item["value"] for item in records}

required_ids = (
    "R-Q1-nominal-p",
    "R-Q1-p-alt",
    "R-Q1-oc-curve-p-grid",
    "R-Q1-oc-curve-accept-prob",
    "R-Q1-oc-curve-n",
    "R-Q1-oc-curve-c",
    "R-Q1-case95-err-reject-at-nom",
    "R-Q1-case95-power-at-alt",
    "R-Q1-case90-accept-prob-at-nom",
    "R-Q1-case90-accept-prob-at-alt",
)
missing_ids = [result_id for result_id in required_ids if result_id not in values]
if missing_ids:
    raise KeyError(f"results.json 缺少绘图所需 result_id: {missing_ids}")

nominal_p = float(values["R-Q1-nominal-p"])
alternative_p = float(values["R-Q1-p-alt"])
p_grid = np.asarray(values["R-Q1-oc-curve-p-grid"], dtype=float)
accept_prob = np.asarray(values["R-Q1-oc-curve-accept-prob"], dtype=float)
sample_size = int(values["R-Q1-oc-curve-n"])
critical_count = int(values["R-Q1-oc-curve-c"])

if p_grid.ndim != 1 or accept_prob.ndim != 1 or p_grid.size != accept_prob.size:
    raise ValueError("OC 曲线横纵序列必须等长且均为一维序列")

fig, (ax_curve, ax_metrics) = plt.subplots(
    1,
    2,
    figsize=(6.0, 2.8),
    gridspec_kw={"width_ratios": (1.55, 1.0)},
)

for alpha, light_amount in ((0.05, 0.72), (0.07, 0.52), (0.10, 0.32)):
    ax_curve.fill_between(
        p_grid,
        accept_prob,
        0.0,
        color=_lighten(PALETTE[0], light_amount),
        alpha=alpha,
        linewidth=0,
        zorder=1,
    )

ax_curve.plot(
    p_grid,
    accept_prob,
    color=PALETTE[0],
    linewidth=2.4,
    label=cn(
        f"OC 曲线（n*={sample_size:.0f}，c*={critical_count:.0f}）"
    ),
    zorder=4,
)
ax_curve.axvline(
    nominal_p,
    color=COLORS["ref_line"],
    linestyle="--",
    linewidth=1.5,
    label=cn(f"标称点 p₀={nominal_p:.1%}"),
    zorder=3,
)
ax_curve.axvline(
    alternative_p,
    color=COLORS["accent"],
    linestyle=":",
    linewidth=1.7,
    label=cn(f"备择点 p₁={alternative_p:.1%}"),
    zorder=3,
)

nominal_index = int(np.argmin(np.abs(p_grid - nominal_p)))
alternative_index = int(np.argmin(np.abs(p_grid - alternative_p)))
nominal_accept_prob = float(np.interp(nominal_p, p_grid, accept_prob))
alternative_accept_prob = float(
    np.interp(alternative_p, p_grid, accept_prob)
)

ax_curve.scatter(
    [p_grid[nominal_index]],
    [accept_prob[nominal_index]],
    marker="*",
    s=130,
    color=PALETTE[0],
    edgecolor="white",
    linewidth=1.1,
    zorder=6,
)
ax_curve.scatter(
    [p_grid[alternative_index]],
    [accept_prob[alternative_index]],
    marker="D",
    s=55,
    color=PALETTE[2],
    edgecolor="white",
    linewidth=1.0,
    zorder=6,
)
ax_curve.annotate(
    cn(
        f"标称点：L={nominal_accept_prob:.1%}"
    ),
    xy=(p_grid[nominal_index], accept_prob[nominal_index]),
    xytext=(12, -30),
    textcoords="offset points",
    fontsize=8,
    fontweight="bold",
    color=PALETTE[0],
    arrowprops={
        "arrowstyle": "->",
        "color": PALETTE[0],
        "lw": 1.1,
    },
    bbox={
        "boxstyle": "round,pad=0.25",
        "facecolor": "white",
        "edgecolor": PALETTE[0],
        "alpha": 0.9,
    },
    zorder=7,
)
ax_curve.annotate(
    cn(
        f"备择点：L={alternative_accept_prob:.1%}"
    ),
    xy=(p_grid[alternative_index], accept_prob[alternative_index]),
    xytext=(-82, 22),
    textcoords="offset points",
    fontsize=8,
    fontweight="bold",
    color=PALETTE[2],
    arrowprops={
        "arrowstyle": "->",
        "color": PALETTE[2],
        "lw": 1.1,
    },
    bbox={
        "boxstyle": "round,pad=0.25",
        "facecolor": "white",
        "edgecolor": PALETTE[2],
        "alpha": 0.9,
    },
    zorder=7,
)

ax_curve.set_xlim(float(np.min(p_grid)), float(np.max(p_grid)))
ax_curve.set_ylim(0.0, 1.0)
ax_curve.xaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
ax_curve.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
ax_curve.set_xlabel(cn("真实次品率 p"))
ax_curve.set_ylabel(cn("接收概率 L(p)"))
ax_curve.grid(
    True,
    alpha=0.14,
    linestyle="--",
    linewidth=0.8,
    color=COLORS["grid"],
)
ax_curve.set_axisbelow(True)
ax_curve.legend(
    frameon=False,
    fontsize=7.5,
    loc="lower left",
    handlelength=1.8,
    labelspacing=0.3,
)
ax_curve.spines["top"].set_visible(False)
ax_curve.spines["right"].set_visible(False)
panel(ax_curve, "(a)")

metric_ids = (
    "R-Q1-case95-err-reject-at-nom",
    "R-Q1-case95-power-at-alt",
    "R-Q1-case90-accept-prob-at-nom",
    "R-Q1-case90-accept-prob-at-alt",
)
metric_values = np.asarray([values[result_id] for result_id in metric_ids], dtype=float)
metric_labels = (
    cn("情形一·标称点拒收侧错误率"),
    cn("情形一·备择点功效"),
    cn("情形二·标称点接收概率"),
    cn("情形二·备择点误收概率"),
)
metric_colors = (
    PALETTE[0],
    PALETTE[0],
    PALETTE[1],
    PALETTE[1],
)
metric_markers = ("o", "D", "o", "D")
metric_y = np.arange(metric_values.size)[::-1]

for y_pos, value, color, marker in zip(
    metric_y,
    metric_values,
    metric_colors,
    metric_markers,
):
    ax_metrics.hlines(
        y_pos,
        0.0,
        value,
        color=color,
        linewidth=2.0,
        alpha=0.45,
        zorder=2,
    )
    ax_metrics.scatter(
        value,
        y_pos,
        s=58,
        marker=marker,
        color=color,
        edgecolor="white",
        linewidth=1.0,
        zorder=4,
    )
    ax_metrics.annotate(
        f"{value:.1%}",
        xy=(value, y_pos),
        xytext=(0, 8),
        textcoords="offset points",
        ha="center",
        va="bottom",
        fontsize=8,
        fontweight="bold",
        color=color,
        bbox={
            "boxstyle": "round,pad=0.18",
            "facecolor": "white",
            "edgecolor": "none",
            "alpha": 0.88,
        },
        zorder=5,
    )

ax_metrics.set_xlim(0.0, 1.0)
ax_metrics.set_ylim(-0.5, metric_values.size - 0.5)
ax_metrics.xaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
ax_metrics.set_yticks(metric_y)
ax_metrics.set_yticklabels(metric_labels, fontsize=8)
ax_metrics.set_xlabel(cn("判定点概率"))
ax_metrics.grid(
    axis="x",
    alpha=0.14,
    linestyle="--",
    linewidth=0.8,
    color=COLORS["grid"],
)
ax_metrics.set_axisbelow(True)
ax_metrics.tick_params(axis="y", length=0)
ax_metrics.spines["top"].set_visible(False)
ax_metrics.spines["right"].set_visible(False)
ax_metrics.spines["left"].set_visible(False)
panel(ax_metrics, "(b)")

fig.tight_layout(w_pad=2.0)
save(fig, "fig_q1_oc_curve_p1")
