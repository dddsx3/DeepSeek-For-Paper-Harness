"""问题4置信区间与蒙特卡洛重抽样下的利润稳健性森林图。

(a) 问题2六种情况的单位期望利润点估计、固定决策利润区间及决策一致率；
    实心圆表示账本判定决策稳健，空心圆表示需复核，圆点大小随一致率变化。
(b) 问题3实例的单位期望利润点估计、固定决策利润区间及决策一致率。

数据来自账本 R-Q4-sample-size-used、R-Q4-ci-level、R-Q4-resample-count、
R-Q4-q2、R-Q4-q3-point-profit、R-Q4-q3-profit-range 和
R-Q4-q3-consistency-rate；图内所有业务数值均由上述账本字段动态读取。
"""

import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn


doc = load("results.json")
ledger = {item["result_id"]: item["value"] for item in doc["results"]}

sample_size = ledger["R-Q4-sample-size-used"]
ci_level = ledger["R-Q4-ci-level"]
resample_count = ledger["R-Q4-resample-count"]

q2_rows = sorted(ledger["R-Q4-q2"], key=lambda row: row["case_id"])
q2_points = np.asarray(
    [float(row["point_profit"]) for row in q2_rows], dtype=float
)
q2_lows = np.asarray(
    [float(row["profit_range_fixed_decision"][0]) for row in q2_rows],
    dtype=float,
)
q2_highs = np.asarray(
    [float(row["profit_range_fixed_decision"][1]) for row in q2_rows],
    dtype=float,
)
q2_consistency = np.asarray(
    [float(row["consistency_rate"]) for row in q2_rows], dtype=float
)
q2_stable = [bool(row["decision_stable"]) for row in q2_rows]

q3_point = float(ledger["R-Q4-q3-point-profit"])
q3_low, q3_high = map(float, ledger["R-Q4-q3-profit-range"])
q3_consistency = float(ledger["R-Q4-q3-consistency-rate"])

fig, (ax_q2, ax_q3) = plt.subplots(
    1,
    2,
    figsize=(6.0, 3.4),
    gridspec_kw={"width_ratios": [1.35, 1.0]},
)

# ----------------------------------------------------------------------
# Panel (a): 问题2六种情况
# ----------------------------------------------------------------------
y_q2 = np.arange(len(q2_rows), dtype=float)
band_color = _lighten(PALETTE[0], 0.90)

for i, y in enumerate(y_q2):
    if i % 2 == 0:
        ax_q2.axhspan(
            y - 0.46,
            y + 0.46,
            color=band_color,
            alpha=0.65,
            zorder=0,
        )

for y, point, low, high, rate, stable in zip(
    y_q2,
    q2_points,
    q2_lows,
    q2_highs,
    q2_consistency,
    q2_stable,
):
    ax_q2.plot(
        [low, high],
        [y, y],
        color=COLORS["gray"],
        linewidth=1.5,
        solid_capstyle="round",
        zorder=2,
    )
    ax_q2.plot(
        [low, low],
        [y - 0.13, y + 0.13],
        color=COLORS["ref_line"],
        linewidth=1.1,
        zorder=2,
    )
    ax_q2.plot(
        [high, high],
        [y - 0.13, y + 0.13],
        color=COLORS["ref_line"],
        linewidth=1.1,
        zorder=2,
    )
    ax_q2.scatter(
        [point],
        [y],
        s=28.0 + 28.0 * rate,
        marker="o",
        facecolor=PALETTE[0] if stable else ax_q2.get_facecolor(),
        edgecolor=PALETTE[0] if stable else COLORS["accent"],
        linewidth=1.2,
        zorder=3,
    )
    ax_q2.text(
        point,
        y + 0.20,
        f"{point:.2f}",
        ha="center",
        va="bottom",
        fontsize=6.8,
        fontweight="bold",
        color=PALETTE[0],
    )
    ax_q2.text(
        point,
        y - 0.20,
        f"[{low:.2f}, {high:.2f}]",
        ha="center",
        va="top",
        fontsize=6.2,
        color=COLORS["gray"],
    )

q2_labels = []
for row, rate, stable in zip(q2_rows, q2_consistency, q2_stable):
    status = cn("稳健") if stable else cn("需复核")
    q2_labels.append(
        cn(f"情况 {row['case_id']}\n一致率 {rate:.1%} · {status}")
    )

span_q2 = float(np.max(q2_highs) - np.min(q2_lows))
pad_q2 = span_q2 / max(len(q2_rows) * 4, 1)
ax_q2.set_xlim(
    float(np.min(q2_lows)) - pad_q2,
    float(np.max(q2_highs)) + pad_q2,
)
ax_q2.set_ylim(len(q2_rows) - 0.45, -0.65)
ax_q2.set_yticks(y_q2)
ax_q2.set_yticklabels(q2_labels, fontsize=7.0)
ax_q2.set_xlabel(cn("单位期望利润（元/件）"), fontsize=8.5, labelpad=4)
ax_q2.set_ylabel(cn("情形"), fontsize=8.5, labelpad=4)
ax_q2.tick_params(axis="y", length=0, pad=4)
ax_q2.tick_params(axis="x", labelsize=7)
ax_q2.set_axisbelow(True)
ax_q2.grid(
    axis="x",
    color=COLORS["grid"],
    alpha=0.45,
    linestyle="--",
    linewidth=0.7,
)
ax_q2.spines["top"].set_visible(False)
ax_q2.spines["right"].set_visible(False)
ax_q2.spines["left"].set_visible(False)
ax_q2.spines["bottom"].set_color(COLORS["grid"])
panel(ax_q2, "(a)")

# ----------------------------------------------------------------------
# Panel (b): 问题3实例
# ----------------------------------------------------------------------
y_q3 = np.array([0.0])
ax_q3.axhspan(
    y_q3[0] - 0.46,
    y_q3[0] + 0.46,
    color=_lighten(PALETTE[1], 0.90),
    alpha=0.65,
    zorder=0,
)
ax_q3.plot(
    [q3_low, q3_high],
    [y_q3[0], y_q3[0]],
    color=COLORS["gray"],
    linewidth=1.5,
    solid_capstyle="round",
    zorder=2,
)
ax_q3.plot(
    [q3_low, q3_low],
    [y_q3[0] - 0.13, y_q3[0] + 0.13],
    color=COLORS["ref_line"],
    linewidth=1.1,
    zorder=2,
)
ax_q3.plot(
    [q3_high, q3_high],
    [y_q3[0] - 0.13, y_q3[0] + 0.13],
    color=COLORS["ref_line"],
    linewidth=1.1,
    zorder=2,
)
ax_q3.scatter(
    [q3_point],
    y_q3,
    s=34.0 + 30.0 * q3_consistency,
    marker="D",
    facecolor=PALETTE[1],
    edgecolor=PALETTE[1],
    linewidth=1.0,
    zorder=3,
)
ax_q3.text(
    q3_point,
    y_q3[0] + 0.20,
    cn(f"点利润 {q3_point:.2f}"),
    ha="center",
    va="bottom",
    fontsize=7.0,
    fontweight="bold",
    color=PALETTE[1],
)
ax_q3.text(
    q3_point,
    y_q3[0] - 0.20,
    cn(f"区间 [{q3_low:.2f}, {q3_high:.2f}]"),
    ha="center",
    va="top",
    fontsize=6.5,
    color=COLORS["gray"],
)

q3_axis_low = min(q3_low, q3_point, 0.0)
q3_axis_high = max(q3_high, q3_point, 0.0)
q3_span = q3_axis_high - q3_axis_low
if q3_span == 0:
    q3_span = abs(q3_point)
q3_pad = q3_span / 10.0
ax_q3.set_xlim(q3_axis_low - q3_pad, q3_axis_high + q3_pad)
ax_q3.set_ylim(0.55, -0.55)
ax_q3.set_yticks(y_q3)
ax_q3.set_yticklabels(
    [cn(f"问题3实例\n一致率 {q3_consistency:.1%}")],
    fontsize=7.2,
)
ax_q3.set_xlabel(cn("单位期望利润（元/件）"), fontsize=8.5, labelpad=4)
ax_q3.set_ylabel(cn("决策对象"), fontsize=8.5, labelpad=4)
ax_q3.tick_params(axis="y", length=0, pad=4)
ax_q3.tick_params(axis="x", labelsize=7)
ax_q3.set_axisbelow(True)
ax_q3.grid(
    axis="x",
    color=COLORS["grid"],
    alpha=0.45,
    linestyle="--",
    linewidth=0.7,
)
ax_q3.spines["top"].set_visible(False)
ax_q3.spines["right"].set_visible(False)
ax_q3.spines["left"].set_visible(False)
ax_q3.spines["bottom"].set_color(COLORS["grid"])
panel(ax_q3, "(b)")

fig.text(
    0.5,
    0.025,
    cn(
        f"抽样样本量 {sample_size} 件｜置信水平 {ci_level:.1%}"
        f"｜重抽样 {resample_count} 次"
    ),
    ha="center",
    va="bottom",
    fontsize=7.0,
    color=COLORS["gray"],
)

fig.tight_layout(rect=(0.0, 0.10, 1.0, 0.98), w_pad=2.4)
save(fig, "fig_q4_ci_effect_on_cost")
