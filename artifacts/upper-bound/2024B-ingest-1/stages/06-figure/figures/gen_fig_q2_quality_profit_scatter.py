"""绘制问题2六种情形的最优策略一次装配合格率与单位期望利润横断面关系。

(a) 展示六种情形的最优策略散点、线性回归趋势及回归置信带，并突出账本识别的最高利润情况。
(b) 展示最优策略一次装配合格率的核密度分布。
(c) 展示单位期望利润的核密度分布。
数据来自账本 R-Q2-case1-strategies 至 R-Q2-case6-strategies，以及
R-Q2-global-best-case-id；最优点编号、合格率和利润均由账本动态生成，不在源码中固化。
"""


from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import matplotlib.gridspec as gridspec
import matplotlib.pyplot as plt
import numpy as np
from scipy.stats import gaussian_kde
from scipy.stats import t as student_t


def _extract_ledger_values(doc):
    if isinstance(doc, dict) and "results" in doc:
        return {
            item["result_id"]: item["value"]
            for item in doc["results"]
        }
    if isinstance(doc, dict):
        return dict(doc)
    raise TypeError("results.json 未包含可解析的账本对象")


def _case_number(result_id):
    marker = "case"
    start = result_id.find(marker)
    if start < 0:
        raise ValueError(f"无法从 result_id 解析情况编号：{result_id}")
    digits = "".join(
        char for char in result_id[start + len(marker):] if char.isdigit()
    )
    if not digits:
        raise ValueError(f"无法从 result_id 解析情况编号：{result_id}")
    return int(digits)


def _padded_grid(lower, upper, count):
    span = upper - lower
    if not np.isfinite(span) or span <= 0:
        raise ValueError("核密度横轴所需的数据没有有效离散程度")
    padding = span * 0.08
    return np.linspace(lower - padding, upper + padding, count)


doc = load("results.json")
ledger = _extract_ledger_values(doc)

strategy_ids = (
    "R-Q2-case1-strategies",
    "R-Q2-case2-strategies",
    "R-Q2-case3-strategies",
    "R-Q2-case4-strategies",
    "R-Q2-case5-strategies",
    "R-Q2-case6-strategies",
)

case_ids = []
selected_rows = []
for result_id in strategy_ids:
    strategy_table = ledger[result_id]
    if not isinstance(strategy_table, list) or not strategy_table:
        raise ValueError(f"{result_id} 不含可用的策略数组")
    selected_rows.append(
        max(strategy_table, key=lambda record: record["profit"])
    )
    case_ids.append(_case_number(result_id))

q = np.asarray(
    [record["q"] for record in selected_rows],
    dtype=float,
)
profit = np.asarray(
    [record["profit"] for record in selected_rows],
    dtype=float,
)
case_ids = np.asarray(case_ids, dtype=int)

if not (
    np.all(np.isfinite(q))
    and np.all(np.isfinite(profit))
    and np.all(q > 0)
):
    raise ValueError("横断面数据包含无效的合格率或利润")

best_case_id = int(ledger["R-Q2-global-best-case-id"])
best_matches = np.flatnonzero(case_ids == best_case_id)
if best_matches.size != 1:
    raise ValueError("账本最高利润情况编号无法与六个数据点唯一匹配")
best_index = int(best_matches[0])

x_lower = float(np.min(q))
x_upper = float(np.max(q))
y_lower = float(np.min(profit))
y_upper = float(np.max(profit))

x_grid = _padded_grid(x_lower, x_upper, 256)
y_span = y_upper - y_lower
if not np.isfinite(y_span) or y_span <= 0:
    raise ValueError("核密度纵轴所需的数据没有有效离散程度")
y_grid = _padded_grid(y_lower, y_upper, 256)

sample_count = q.size
x_mean = float(np.mean(q))
sxx = float(np.sum((q - x_mean) ** 2))
if sample_count < 3 or not np.isfinite(sxx) or sxx <= np.finfo(float).eps:
    raise ValueError("账本数据不足以估计线性回归及置信带")

slope, intercept = np.polyfit(q, profit, 1)
fitted = slope * q + intercept
residuals = profit - fitted
residual_variance = float(
    np.sum(residuals ** 2) / (sample_count - 2)
)
regression_se = np.sqrt(
    residual_variance
    * (
        1.0 / sample_count
        + (x_grid - x_mean) ** 2 / sxx
    )
)
critical_value = float(student_t.ppf(0.975, sample_count - 2))
regression_line = slope * x_grid + intercept
band_lower = regression_line - critical_value * regression_se
band_upper = regression_line + critical_value * regression_se

fig = plt.figure(figsize=(5.0, 5.0))
grid = gridspec.GridSpec(
    2,
    2,
    width_ratios=[4, 1],
    height_ratios=[1, 4],
    hspace=0.06,
    wspace=0.06,
)
ax_main = fig.add_subplot(grid[1, 0])
ax_top = fig.add_subplot(grid[0, 0], sharex=ax_main)
ax_right = fig.add_subplot(grid[1, 1], sharey=ax_main)

band = ax_main.fill_between(
    x_grid,
    band_lower,
    band_upper,
    facecolor=_lighten(PALETTE[1], 0.68),
    edgecolor="none",
    alpha=0.42,
    linewidth=0,
    zorder=1,
    label=cn("回归置信带"),
)
line, = ax_main.plot(
    x_grid,
    regression_line,
    color=PALETTE[1],
    linestyle="--",
    linewidth=1.8,
    zorder=2,
    label=cn(
        f"线性拟合：y={slope:.2f}x{intercept:+.2f}"
    ),
)
points = ax_main.scatter(
    q,
    profit,
    s=54,
    color=PALETTE[0],
    edgecolor=_lighten(PALETTE[0], 0.62),
    linewidth=0.8,
    alpha=0.92,
    zorder=3,
    label=cn("六种情形"),
)
best_point = ax_main.scatter(
    q[best_index : best_index + 1],
    profit[best_index : best_index + 1],
    s=190,
    marker="*",
    color=PALETTE[2],
    edgecolor=_lighten(PALETTE[2], 0.55),
    linewidth=0.8,
    zorder=4,
    label=cn("账本最高利润"),
)

ax_main.annotate(
    cn(
        f"账本最高：情况 {best_case_id}"
        f"（q={q[best_index]:.3f}，利润={profit[best_index]:.2f}）"
    ),
    xy=(q[best_index], profit[best_index]),
    xytext=(8, -18),
    textcoords="offset points",
    color=COLORS["gray"],
    fontsize=8,
    ha="left",
    va="top",
    zorder=5,
)

ax_main.set_xlim(float(x_grid[0]), float(x_grid[-1]))
ax_main.set_ylim(float(y_grid[0]), float(y_grid[-1]))
ax_main.set_xlabel(
    cn("最优策略一次装配合格率 q"),
    color=COLORS["gray"],
)
ax_main.set_ylabel(
    cn("单位期望利润（元/件）"),
    color=COLORS["gray"],
)
ax_main.grid(
    True,
    color=COLORS["grid"],
    linewidth=0.6,
    alpha=0.65,
)
ax_main.set_axisbelow(True)
ax_main.tick_params(colors=COLORS["gray"])

legend = ax_main.legend(
    handles=[line, band, points, best_point],
    loc="best",
    frameon=False,
    fontsize=7.5,
)
for text in legend.get_texts():
    text.set_color(COLORS["gray"])

x_density = gaussian_kde(q)(x_grid)
ax_top.fill_between(
    x_grid,
    x_density,
    facecolor=_lighten(PALETTE[0], 0.68),
    edgecolor="none",
    alpha=0.78,
)
ax_top.plot(
    x_grid,
    x_density,
    color=PALETTE[0],
    linewidth=1.4,
)
ax_top.set_ylim(bottom=0.0)
ax_top.tick_params(
    axis="x",
    which="both",
    bottom=False,
    labelbottom=False,
)
ax_top.tick_params(
    axis="y",
    which="both",
    left=False,
    labelleft=False,
)

y_density = gaussian_kde(profit)(y_grid)
ax_right.fill_betweenx(
    y_grid,
    y_density,
    facecolor=_lighten(PALETTE[1], 0.68),
    edgecolor="none",
    alpha=0.78,
)
ax_right.plot(
    y_density,
    y_grid,
    color=PALETTE[1],
    linewidth=1.4,
)
ax_right.set_ylim(bottom=0.0)
ax_right.tick_params(
    axis="x",
    which="both",
    bottom=False,
    labelbottom=False,
)
ax_right.tick_params(
    axis="y",
    which="both",
    left=False,
    labelleft=False,
)

for axis in (ax_main, ax_top, ax_right):
    axis.spines["top"].set_visible(False)
    axis.spines["right"].set_visible(False)
    for spine in axis.spines.values():
        spine.set_color(COLORS["grid"])

panel(ax_main, "(a)")
panel(ax_top, "(b)")
panel(ax_right, "(c)")

fig.tight_layout(pad=0.8)
save(fig, "fig_q2_quality_profit_scatter")
