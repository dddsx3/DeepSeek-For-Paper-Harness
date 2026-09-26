"""fig_q1_two_cases_sample_size —— 问题 1 两情形抽样方案的绝对量级对比（分组柱状图）

本图讲什么
----------
把问题 1 两种抽样情形（(1) 95% 信度下认定次品率超标则拒收、(2) 90% 信度下认定
次品率不超标则接收）各自折出的两个关键量并排放在同一坐标系里：绝对量级上，
"拒收口径"与"接收口径"在最小检测次数上差了一个数量级，判定临界次品数也随之
被压到很低。分组柱状图用于对比"情形 × 方案量"的两维结构。

每个 panel 是什么
-----------------
单 panel 分组柱状图：x 轴为两种抽样情形，每种情形两根柱——
  第 1 根（PALETTE[0]）＝ 最小检测次数 n*；
  第 2 根（PALETTE[1]）＝ 接收判定临界次品数 c*。
柱顶标注账本原始读数（零值照实标 0，不以缺柱掩盖），每种情形内的较大值加 ★ 高亮；
虚线为四值算术均值，仅作量级参照。

数据来自账本哪些 id（results.json）
-----------------------------------
R-Q1-case1-n  -> 情形(1) 最小检测次数 n*
R-Q1-case1-c  -> 情形(1) 接收判定临界次品数 c*
R-Q1-case2-n  -> 情形(2) 最小检测次数 n*
R-Q1-case2-c  -> 情形(2) 接收判定临界次品数 c*
（caption 中引用的 R-Q1-sampling-cost-case1 与 R-Q1-case1-n 同值——情形(1) 的抽样
 检测费用按单件检测成本归一后即 n*，同一数字不重复成柱，故本图不引用该 id。）

关键数值
--------
全部柱高与柱顶标注一律在运行时从上述 result_id 读取，脚本内不写死任何账本数字。
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()


# --------------------------------------------------------------------------
# 账本读取：候选路径链与 FIGURE_PLAN.ledger_source 声明的相对位置对齐，
# 保证执行期 cwd 不在账本目录时也能定位，不因单点路径假设而中断出图。
# --------------------------------------------------------------------------
def _ledger_candidates():
    here = Path(__file__).resolve()
    cwd = Path.cwd()
    return [
        cwd / "results.json",
        cwd / "stages" / "04-result-sources" / "results.json",
        here.parent / "results.json",
        here.parent.parent / "results.json",
        here.parent.parent / "04-result-sources" / "results.json",
        here.parent.parent.parent / "04-result-sources" / "results.json",
        here.parent.parent.parent / "stages" / "04-result-sources" / "results.json",
    ]


def load_ledger():
    tried = _ledger_candidates()
    for path in tried:
        if path.is_file():
            with path.open(encoding="utf-8") as fh:
                raw = json.load(fh)
            rows = raw["results"] if isinstance(raw, dict) else raw
            return {row["result_id"]: row for row in rows}
    raise FileNotFoundError(
        "results.json not found in any candidate path: "
        + ", ".join(str(p) for p in tried)
    )


LEDGER = load_ledger()


def val(result_id):
    """按 result_id 从账本取数——图中每一个数都经由这里。"""
    return float(LEDGER[result_id]["value"])


# --------------------------------------------------------------------------
# 取数
# --------------------------------------------------------------------------
case_labels = ["情形(1)\n95% 信度拒收", "情形(2)\n90% 信度接收"]
series = {
    "最小检测次数 $n^*$": [val("R-Q1-case1-n"), val("R-Q1-case2-n")],
    "判定临界次品数 $c^*$": [val("R-Q1-case1-c"), val("R-Q1-case2-c")],
}

# --------------------------------------------------------------------------
# 绘图
# --------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6.0, 3.6))

x = np.arange(len(case_labels))
n_series = len(series)
width = 0.32
vals_matrix = np.array(list(series.values()), dtype=float)
ymax = float(vals_matrix.max())
case_max = vals_matrix.max(axis=0)

# 淡色背景带，仅作量级参照
ax.axhspan(0.0, ymax * 1.18, alpha=0.03, color=PALETTE[0], zorder=0)

for i, (name, vals) in enumerate(series.items()):
    offset = (i - n_series / 2 + 0.5) * width
    # 柱子阴影（浅色偏移，不占数据含义）
    ax.bar(
        x + offset + 0.015, vals, width,
        color=_lighten(COLORS["text"], 0.88), alpha=0.12, zorder=1,
    )
    # 主柱：淡色填充 + 原色边框
    bars = ax.bar(
        x + offset, vals, width,
        color=_lighten(PALETTE[i], 0.45), edgecolor=PALETTE[i],
        linewidth=1.3, label=name, zorder=2,
    )
    labels = [
        ("★" if v >= case_max[j] else "") + f"{v:.0f}"
        for j, v in enumerate(vals)
    ]
    texts = ax.bar_label(
        bars, labels=labels, padding=2.5, fontsize=7.5, color=PALETTE[i],
    )
    for t in texts:
        if t.get_text().startswith("★"):
            t.set_fontweight("bold")

# 水平参考线：四值算术均值
gmean = float(vals_matrix.mean())
ax.axhline(
    gmean, color=COLORS["ref_line"], linestyle="--", linewidth=0.8, alpha=0.45,
    zorder=1,
)
ax.text(
    0.5, gmean + ymax * 0.02, f"四值均值 {gmean:.0f}",
    fontsize=7.5, color=COLORS["ref_line"], ha="center", va="bottom",
    style="italic", zorder=3,
)

ax.set_xticks(x)
ax.set_xticklabels(case_labels, fontsize=9)
ax.set_xlabel("抽样方案情形", fontsize=10)
ax.set_ylabel("件数（件）", fontsize=10)
ax.set_xlim(-0.6, len(case_labels) - 0.4)
ax.set_ylim(0.0, ymax * 1.18)
ax.legend(
    frameon=False, labelspacing=0.35, handlelength=1.6, fontsize=8.5,
    loc="upper right",
)
ax.grid(axis="y", alpha=0.12, linestyle="--", color=COLORS["grid"])
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.tight_layout()
save_fig(fig, "figures/fig_q1_two_cases_sample_size.png")
