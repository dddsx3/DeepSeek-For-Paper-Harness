"""绘制问题1序贯概率比检验的接受边界、拒收边界与继续抽样带。

面板(a)展示随累计抽样件数变化的接受边界、拒收边界及两者之间的继续抽样区域；
面板(b)展示由账本两条边界计算得到的边界间距变化。全部绘图序列直接读取自
results.json 中的 R-Q1-sprt-m、R-Q1-sprt-accept-line 和
R-Q1-sprt-reject-line，不在脚本中硬编码实验数据。
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


doc = load("results.json")


def _result_value(document, result_id):
    """从 results.json 的标准账本结构中取回指定结果。"""
    if isinstance(document, dict):
        results = document.get("results")
        if isinstance(results, list):
            for record in results:
                if (
                    isinstance(record, dict)
                    and record.get("result_id") == result_id
                ):
                    return record["value"]
        elif isinstance(results, dict) and result_id in results:
            return results[result_id]
        if result_id in document:
            return document[result_id]
    elif isinstance(document, list):
        for record in document:
            if (
                isinstance(record, dict)
                and record.get("result_id") == result_id
            ):
                return record["value"]
    raise KeyError(result_id)


m = np.asarray(_result_value(doc, "R-Q1-sprt-m"), dtype=float)
accept_line = np.asarray(
    _result_value(doc, "R-Q1-sprt-accept-line"), dtype=float
)
reject_line = np.asarray(
    _result_value(doc, "R-Q1-sprt-reject-line"), dtype=float
)

if not (m.ndim == accept_line.ndim == reject_line.ndim == 1):
    raise ValueError("SPRT boundary sequences must be one-dimensional")
if not (m.shape == accept_line.shape == reject_line.shape):
    raise ValueError("SPRT boundary sequences must have equal lengths")

lower_boundary = np.minimum(accept_line, reject_line)
upper_boundary = np.maximum(accept_line, reject_line)
band_width = upper_boundary - lower_boundary

fig, (ax, ax_gap) = plt.subplots(
    1,
    2,
    figsize=(6.0, 2.8),
    gridspec_kw={"width_ratios": [1.35, 1.0]},
)

# 面板(a)：接受/拒收边界与继续抽样带
band_color = _lighten(PALETTE[0], 0.86)
for inset, alpha in ((0.0, 0.05), (0.22, 0.07), (0.44, 0.09)):
    band_low = lower_boundary + band_width * inset
    band_high = lower_boundary + band_width * (1.0 - inset)
    ax.fill_between(
        m,
        band_low,
        band_high,
        color=band_color,
        alpha=alpha,
        linewidth=0,
        zorder=1,
    )

ax.plot(
    m,
    accept_line,
    color=PALETTE[0],
    linewidth=2.4,
    label=cn("接受边界"),
    zorder=3,
)
ax.plot(
    m,
    reject_line,
    color=PALETTE[1],
    linewidth=2.4,
    label=cn("拒收边界"),
    zorder=3,
)

mid_index = len(m) // 2
ax.text(
    m[mid_index],
    (lower_boundary[mid_index] + upper_boundary[mid_index]) / 2.0,
    cn("继续抽样带"),
    color=COLORS["gray"],
    fontsize=8,
    ha="center",
    va="center",
    bbox=dict(
        boxstyle="round,pad=0.2",
        facecolor="white",
        edgecolor="none",
        alpha=0.85,
    ),
    zorder=4,
)

for endpoint, color, offset in (
    (accept_line[-1], PALETTE[0], 12),
    (reject_line[-1], PALETTE[1], -12),
):
    ax.scatter(
        m[-1],
        endpoint,
        s=85,
        marker="*",
        color=color,
        edgecolor="white",
        linewidth=1.1,
        zorder=5,
    )
    ax.annotate(
        f"{endpoint:.2f}",
        xy=(m[-1], endpoint),
        xytext=(-12, offset),
        textcoords="offset points",
        color=color,
        fontsize=8,
        fontweight="bold",
        ha="right",
        va="center",
        arrowprops=dict(arrowstyle="->", color=color, lw=1.0),
        bbox=dict(
            boxstyle="round,pad=0.25",
            facecolor="white",
            edgecolor=color,
            alpha=0.9,
        ),
        annotation_clip=False,
        zorder=6,
    )

ax.set_xlabel(cn("累计抽样件数 m"), fontsize=9)
ax.set_ylabel(cn("对数似然比（账本边界序列）"), fontsize=9)
ax.set_xlim(float(m.min()), float(m.max()))
ax.set_ylim(float(lower_boundary.min()), float(upper_boundary.max()))
ax.xaxis.set_major_locator(MaxNLocator(nbins=6, integer=True))
ax.grid(
    True,
    color=COLORS["grid"],
    alpha=0.25,
    linestyle="--",
    linewidth=0.6,
)
ax.set_axisbelow(True)
ax.legend(frameon=False, fontsize=8, loc="best", handlelength=1.8)
panel(ax, "(a)")

# 面板(b)：继续抽样带宽度
gap_color = _lighten(PALETTE[2], 0.82)
ax_gap.fill_between(
    m,
    np.zeros_like(band_width),
    band_width,
    color=gap_color,
    alpha=0.18,
    linewidth=0,
    zorder=1,
)
ax_gap.plot(
    m,
    band_width,
    color=COLORS["accent"],
    linewidth=2.0,
    label=cn("边界间距"),
    zorder=3,
)

peak_index = int(np.argmax(band_width))
ax_gap.scatter(
    m[peak_index],
    band_width[peak_index],
    s=80,
    marker="*",
    color=COLORS["accent"],
    edgecolor="white",
    linewidth=1.0,
    zorder=4,
)
ax_gap.annotate(
    f"{band_width[peak_index]:.2f}",
    xy=(m[peak_index], band_width[peak_index]),
    xytext=(-12, -16),
    textcoords="offset points",
    color=COLORS["accent"],
    fontsize=8,
    fontweight="bold",
    ha="right",
    va="top",
    arrowprops=dict(arrowstyle="->", color=COLORS["accent"], lw=1.0),
    bbox=dict(
        boxstyle="round,pad=0.25",
        facecolor="white",
        edgecolor=COLORS["accent"],
        alpha=0.9,
    ),
    annotation_clip=False,
    zorder=5,
)

ax_gap.set_xlabel(cn("累计抽样件数 m"), fontsize=9)
ax_gap.set_ylabel(cn("边界间距（账本差值）"), fontsize=9)
ax_gap.set_xlim(float(m.min()), float(m.max()))
ax_gap.set_ylim(float(np.min(band_width)), float(np.max(band_width)))
ax_gap.xaxis.set_major_locator(MaxNLocator(nbins=6, integer=True))
ax_gap.grid(
    True,
    color=COLORS["grid"],
    alpha=0.25,
    linestyle="--",
    linewidth=0.6,
)
ax_gap.set_axisbelow(True)
ax_gap.legend(frameon=False, fontsize=8, loc="best", handlelength=1.8)
panel(ax_gap, "(b)")

for axis in (ax, ax_gap):
    axis.spines["top"].set_visible(False)
    axis.spines["right"].set_visible(False)
    axis.tick_params(labelsize=8)

fig.tight_layout(pad=1.0)
save(fig, "fig_q1_sprt_boundary")
