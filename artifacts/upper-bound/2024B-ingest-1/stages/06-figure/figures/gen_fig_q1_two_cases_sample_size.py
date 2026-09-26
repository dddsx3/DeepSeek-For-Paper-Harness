"""本图讲什么：问题 1 两种抽样情形（95% 信度拒收 / 90% 信度接收）的方案参数对照，
用分组柱状图把每个情形的「最小检测次数 n*」与「接收判定临界次品数 c*」并排呈现。
每个 panel 是什么：单一 panel。横轴为两种抽样情形，每组两根柱分别对应 n* 与 c*；
柱顶直标数值（件），因为两情形样本量相差一个数量级，目测比较会失真。
数据来自账本哪些 id：R-Q1-case1-n（情形 1 最小检测次数 n*）、R-Q1-case1-c（情形 1 临界次品数 c*）、
R-Q1-case2-n（情形 2 最小检测次数 n*）、R-Q1-case2-c（情形 2 临界次品数 c*）。
关键数值：情形 1 n*=368、c*=46；情形 2 n*=22、c*=0。
"""

import json

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# ---------------------------------------------------------------- 读账本
with open("results.json", encoding="utf-8") as fh:
    LEDGER = {item["result_id"]: item for item in json.load(fh)["results"]}


def ledger_value(result_id):
    """按 result_id 从账本取值，图里每个数都必须经过这里。"""
    return float(LEDGER[result_id]["value"])


# ---------------------------------------------------------------- 规划条目
X_GROUPS = ["情形(1) 95% 信度拒收", "情形(2) 90% 信度接收"]

SERIES = [
    {
        "label": "最小检测次数 $n^*$（件）",
        "refs": ["R-Q1-case1-n", "R-Q1-case2-n"],
    },
    {
        "label": "接收判定临界次品数 $c^*$（件）",
        "refs": ["R-Q1-case1-c", "R-Q1-case2-c"],
    },
]

values = [np.array([ledger_value(r) for r in s["refs"]], dtype=float) for s in SERIES]

# ---------------------------------------------------------------- 画布
fig, ax = plt.subplots(figsize=(6.0, 4.0))

x = np.arange(len(X_GROUPS))
n_series = len(SERIES)
width = 0.30

y_top = max(v.max() for v in values) * 1.18
ax.axhspan(0.0, y_top, alpha=0.03, color=PALETTE[0], zorder=0)

for i, (spec, vals) in enumerate(zip(SERIES, values)):
    offset = (i - n_series / 2 + 0.5) * width
    bars = ax.bar(
        x + offset,
        vals,
        width,
        color=_lighten(PALETTE[i], 0.4),
        edgecolor=PALETTE[i],
        linewidth=1.4,
        label=spec["label"],
        zorder=2,
    )
    ax.bar_label(
        bars,
        fmt="%.0f",
        padding=2,
        fontsize=7.5,
        color=COLORS["text"],
    )

# ---------------------------------------------------------------- 轴与样式
ax.set_xticks(x)
ax.set_xticklabels(X_GROUPS, fontsize=9)
ax.set_xlabel("情形", fontsize=10)
ax.set_ylabel("件数（件）", fontsize=10)
ax.set_ylim(0.0, y_top)

ax.legend(frameon=False, fontsize=8.5, labelspacing=0.35, handlelength=1.6,
          loc="upper right")
ax.grid(axis="y", alpha=0.12, linestyle="--", color=COLORS["grid"])
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.tight_layout()
save_fig(fig, "figures/fig_q1_two_cases_sample_size.png")
