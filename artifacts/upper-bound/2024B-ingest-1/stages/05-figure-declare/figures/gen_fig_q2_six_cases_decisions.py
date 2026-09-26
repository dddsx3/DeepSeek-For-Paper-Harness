"""fig_q2_six_cases_decisions —— 表 1 六种情况最优期望利润的棒棒糖图（升序）。

本图讲什么
    问题 2 表 1 的六种情况在各自最优 (Z1, Z2, C, D) 决策下的单位成品最优期望利润，
    按利润升序排名。茎长与末端数值同时给出各情况量级；中位数参考线把六情况切成高低两半；
    最高利润所在列加极值底色高亮。六情况的决策组合本身不在本图，见
    fig_q2_strategy_cost_heatmap 的 0-1 指示矩阵。分组柱状图会丢掉排序信息，故改型为棒棒糖图。

面板结构
    单面板（1×1）。横轴 = 表 1 情况（按最优期望利润升序），纵轴 = 最优期望利润（元/件）。
    每根茎自纵轴零点起、末端一枚渐变圆点并带数值标签；茎身中段一枚排名徽章；
    水平点线为中位数参考线，其旁一条短标注。

数据来自账本
    results.json 的六条记录（单位均为 元/件）：
      R-Q2-case1-profit, R-Q2-case2-profit, R-Q2-case3-profit,
      R-Q2-case4-profit, R-Q2-case5-profit, R-Q2-case6-profit
    取值、升序排序、渐变色、茎宽、点径、排名徽章、中位线与坐标范围全部由当次读到的
    数值推出，脚本内不写死任何数据。

关键数值
    全部依赖账本现读：升序序列、中位数参考线位置、每根茎的渐变颜色与末端标签，
    均按本次读出的利润值计算，账本重铸后本图自动同步。
"""

from __future__ import annotations

import colorsys
import json
import os
from typing import Any, Dict, List

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

import matplotlib.colors as mc
import matplotlib.pyplot as plt
import numpy as np

try:  # 智能标注为可选项：缺失时退回固定偏移标注，不影响出图
    from _utils.plot_utils import smart_labels
except ImportError:  # pragma: no cover
    smart_labels = None


# ── 账本定位：与 FIGURE_PLAN.ledger_source 声明的相对位置一致，并保持候选链统一
_LEDGER_RELATIVE = (
    "results.json",
    "stages/04-result-sources/results.json",
    "../results.json",
    "../04-result-sources/results.json",
)


def _ledger_candidates() -> List[str]:
    """列出所有可能落到账本的绝对路径（cwd、脚本目录、上级、上上级）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    roots = [
        os.getcwd(),
        here,
        os.path.dirname(here),
        os.path.dirname(os.path.dirname(here)),
    ]
    paths: List[str] = []
    for root in roots:
        for rel in _LEDGER_RELATIVE:
            cand = os.path.normpath(os.path.join(root, rel))
            if cand not in paths:
                paths.append(cand)
    return paths


def _read_ledger() -> Dict[str, Dict[str, Any]]:
    """定位并读取阶段 04 铸出的账本，返回 {result_id: 记录}。"""
    for path in _ledger_candidates():
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
            records = payload["results"] if isinstance(payload, dict) else payload
            return {rec["result_id"]: rec for rec in records}
    raise FileNotFoundError(
        "results.json 未找到；已尝试：" + " ; ".join(_ledger_candidates())
    )


def _value(ledger: Dict[str, Dict[str, Any]], result_id: str) -> float:
    """从账本取一条数值结果。"""
    return float(ledger[result_id]["value"])


# 图例（表 1 情况）与账本 key 的对应；顺序即题面情况顺序
CASE_LABELS = ["情况1", "情况2", "情况3", "情况4", "情况5", "情况6"]
CASE_RESULT_IDS = [
    "R-Q2-case1-profit",
    "R-Q2-case2-profit",
    "R-Q2-case3-profit",
    "R-Q2-case4-profit",
    "R-Q2-case5-profit",
    "R-Q2-case6-profit",
]

# 渐变两端：低利润端偏暖、高利润端偏冷（HSL 空间线性插值）
COLOR_LOW = "#E08B74"
COLOR_HIGH = "#7B6BA5"


def _gradient(color_low: str, color_high: str, t: float):
    """HLS 空间插值：t=0 返回低端色，t=1 返回高端色（避免相邻项同色）。"""
    r1, g1, b1 = mc.to_rgb(color_low)
    r2, g2, b2 = mc.to_rgb(color_high)
    h1, l1, s1 = colorsys.rgb_to_hls(r1, g1, b1)
    h2, l2, s2 = colorsys.rgb_to_hls(r2, g2, b2)
    if abs(h2 - h1) > 0.5:
        if h1 < h2:
            h1 += 1.0
        else:
            h2 += 1.0
    h = (h1 + (h2 - h1) * t) % 1.0
    lum = l1 + (l2 - l1) * t
    sat = s1 + (s2 - s1) * t
    return colorsys.hls_to_rgb(h, lum, sat)


def main() -> None:
    ledger = _read_ledger()

    pairs = [(lab, _value(ledger, rid))
             for lab, rid in zip(CASE_LABELS, CASE_RESULT_IDS)]
    pairs.sort(key=lambda item: item[1])          # 按最优期望利润升序
    labels = [p[0] for p in pairs]
    values = [p[1] for p in pairs]

    n = len(values)
    v_min, v_max = min(values), max(values)
    v_span = (v_max - v_min) if v_max > v_min else 1.0
    med = float(np.median(values))

    colors = [
        _gradient(COLOR_LOW, COLOR_HIGH, i / (n - 1) if n > 1 else 0.0)
        for i in range(n)
    ]

    fig, ax = plt.subplots(figsize=(6.0, 3.6))
    x = np.arange(n)

    ax.grid(axis="y", alpha=0.12, linestyle="-", color=COLORS["grid"])
    ax.set_axisbelow(True)

    # 最高利润列底色高亮（★极值，升序排在最后一列）
    ax.axvspan(x[n - 1] - 0.42, x[n - 1] + 0.42,
               color=colors[n - 1], alpha=0.07, zorder=0)

    # 中位数参考线（置于底层）
    ax.axhline(med, color=COLORS["ref_line"], linestyle=":",
               linewidth=1.0, alpha=0.55, zorder=1)

    # ── 主体：渐变色茎线 + 渐变圆点 + 排名徽章
    for i, val in enumerate(values):
        col = colors[i]
        ratio = (val - v_min) / v_span
        line_w = 1.6 + 2.0 * ratio

        # 茎线自零点起
        ax.plot([x[i], x[i]], [0.0, val], color=col, linewidth=line_w,
                zorder=3, solid_capstyle="round")

        # 末端圆点——大小随利润渐变
        ax.scatter(x[i], val, color=col, s=55 + 120 * ratio, zorder=5,
                   edgecolors="white", linewidths=1.8)

        # 排名徽章（升序：排名越大利润越高，末三位为前三名）
        rank = i + 1
        badge_y = val * 0.34
        if rank > n - 3:
            ax.scatter(x[i], badge_y, s=118, marker="o",
                       color=_lighten(col, 0.12), edgecolors="white",
                       linewidths=1.2, zorder=6)
            ax.text(x[i], badge_y, str(rank), fontsize=7.6, fontweight="bold",
                    color="white", ha="center", va="center", zorder=7)
        else:
            ax.scatter(x[i], badge_y, s=104, marker="o", facecolors="white",
                       edgecolors=_lighten(col, 0.35), linewidths=1.1, zorder=6)
            ax.text(x[i], badge_y, str(rank), fontsize=7.4, fontweight="bold",
                    color=col, ha="center", va="center", zorder=7)

    # 末端数值标签（自动防重叠，失败则退回固定偏移）
    label_y = [v + v_max * 0.035 for v in values]
    label_text = [f"{v:.2f}" for v in values]
    if smart_labels is not None:
        try:
            smart_labels(ax, list(x), label_y, label_text)
        except Exception:  # pragma: no cover
            smart_labels = None
    if smart_labels is None:
        for xi, yi, ti, ci in zip(x, label_y, label_text, colors):
            ax.text(xi, yi, ti, fontsize=8.5, fontweight="bold", color=ci,
                    ha="center", va="bottom", zorder=6)

    # 中位数标注——放在图面左上空白区
    ax.text(-0.52, med, f"中位数 {med:.2f}", fontsize=7.8,
            color=COLORS["ref_line"], ha="left", va="bottom", zorder=8,
            bbox=dict(boxstyle="round,pad=0.22", facecolor="white",
                      edgecolor=COLORS["ref_line"], linewidth=0.6, alpha=0.9))

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9.5)
    ax.set_xlim(-0.62, n - 0.38)
    ax.set_ylim(0.0, v_max * 1.20)
    ax.set_xlabel("表 1 情况（按最优期望利润升序）", fontsize=10)
    ax.set_ylabel("最优期望利润（元/件）", fontsize=10)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    fig.tight_layout()
    save_fig(fig, "figures/fig_q2_six_cases_decisions.png")


if __name__ == "__main__":
    main()
