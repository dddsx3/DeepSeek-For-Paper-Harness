"""fig_q4_ci_effect_on_cost —— 表 1 六种情况「重复抽样重解 vs 点估计决策」一致率的森林图。

本图讲什么
    问题 4 中零配件 / 半成品 / 成品的次品率是由抽样检测估计得到的，点估计下的最优决策
    未必在重新抽样、重新求解时稳定复现。本图把表 1 六种情况的一致率点估计与 95% 置信
    区间（点估计 ± 1.96 × 标准误，半宽在脚本内由账本读数现算）并排铺开，竖参照线为
    「完全一致」= 1.0。区间越窄、越贴近 1.0，说明该情况的抽样不确定性对最优决策的侵蚀
    越小；区间跨过 1.0 者，其决策稳定性与「完全一致」在 95% 水平上不可区分。

panel 结构
    单面板森林图（empirical recipe 1 骨架，按本题数据改造）：
      · 交替行阴影 + 水平置信区间线（带上下端点帽）
      · 点标记半径按估计精度（1/标准误）线性映射，精度越高点越大
      · 实心点 = 95% 区间不含 1.0；空心点 = 95% 区间含 1.0（与完全一致不可区分）
      · 右侧数值列：一致率 [95% CI] 与标准误 SE，列头在行的上方
      · 竖直虚线参照线 x = 1.0，并在图顶以短标签点明其含义

数据来自账本哪些 id
    R-Q4-case1..6-consistency-rate   （六种情况的一致率点估计）
    R-Q4-case1..6-consistency-rate-se（对应一致率估计量的标准误）
    全部数值由 load_ledger() 从 results.json 读取；脚本内不出现任何写死的账本数据。
"""

from __future__ import annotations

import json
import os

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.ticker import MaxNLocator

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# 95% 正态分位点：比例估计大样本区间半宽的系数（统计常数，不是账本读数）
Z95 = 1.96

# 右侧数值列 / 列头的横向位置（axes 坐标，1.0 为绘图区右边界）
X_RATE = 1.03
X_SE = 1.46
HEADER_Y = -0.74  # 数据坐标；y 轴反向后该处位于图顶
ROW_HALF = 0.5    # 交替行阴影的半高
CAP_HALF = 0.13   # 置信区间端点帽的半高


def load_ledger():
    """定位并读取 04-result-sources 铸出的结果账本，返回 {result_id: value}。

    统一的多候选回退：既支持以工作区根目录为 cwd、stages/04-result-sources 为 cwd，
    也支持从本脚本所在目录回退两级，避免执行期 cwd 不同导致批量出图中断。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        "results.json",
        os.path.join("stages", "04-result-sources", "results.json"),
        os.path.join("..", "04-result-sources", "results.json"),
        os.path.join(here, "..", "results.json"),
        os.path.join(here, "..", "04-result-sources", "results.json"),
        os.path.join(here, "..", "..", "stages", "04-result-sources", "results.json"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            rows = payload["results"] if isinstance(payload, dict) else payload
            return {row["result_id"]: row["value"] for row in rows}
    raise FileNotFoundError(
        "未找到结果账本 results.json，已尝试: " + "; ".join(candidates)
    )


def main() -> None:
    ledger = load_ledger()

    n_cases = 6
    labels = ["情况 {}".format(k) for k in range(1, n_cases + 1)]
    rate = np.array(
        [float(ledger["R-Q4-case{}-consistency-rate".format(k)]) for k in range(1, n_cases + 1)]
    )
    se = np.array(
        [
            float(ledger["R-Q4-case{}-consistency-rate-se".format(k)])
            for k in range(1, n_cases + 1)
        ]
    )

    # 95% 置信区间：点估计 ± 1.96 × 标准误；比例的区间按 [0, 1] 截断
    lo_raw = rate - Z95 * se
    hi_raw = rate + Z95 * se
    lo = np.clip(lo_raw, 0.0, 1.0)
    hi = np.clip(hi_raw, 0.0, 1.0)
    indistinct = hi_raw >= 1.0  # 区间含 1.0 —— 与「完全一致」在 95% 水平上不可区分

    # 点标记大小按估计精度（1/标准误）线性映射：区间越窄的估计点越大
    precision = 1.0 / se
    norm = (precision - precision.min()) / (precision.max() - precision.min() + 1e-12)
    marker_size = 5.0 + 4.5 * norm

    y = np.arange(n_cases, dtype=float)

    fig, ax = plt.subplots(figsize=(6.0, 3.9))

    # 交替行阴影
    for i in range(n_cases):
        if i % 2 == 0:
            ax.axhspan(y[i] - ROW_HALF, y[i] + ROW_HALF, color=COLORS["bg_box"], zorder=0)

    # 「完全一致」参照线
    ax.axvline(1.0, color=COLORS["ref_line"], linestyle="--", linewidth=1.2, alpha=0.9,
               zorder=1)

    trans = ax.get_yaxis_transform()  # x 用 axes 坐标、y 用数据坐标

    for i in range(n_cases):
        # 置信区间线 + 端点帽
        ax.plot([lo[i], hi[i]], [y[i], y[i]], color=COLORS["text"], linewidth=1.2,
                zorder=2, solid_capstyle="round")
        ax.plot([lo[i], lo[i]], [y[i] - CAP_HALF, y[i] + CAP_HALF],
                color=COLORS["text"], linewidth=1.0, zorder=2)
        ax.plot([hi[i], hi[i]], [y[i] - CAP_HALF, y[i] + CAP_HALF],
                color=COLORS["text"], linewidth=1.0, zorder=2)

        # 点标记：实心 = 区间不含 1.0；空心 = 与完全一致不可区分
        face = "white" if indistinct[i] else PALETTE[0]
        edge = COLORS["ref_line"] if indistinct[i] else PALETTE[0]
        ax.plot(rate[i], y[i], "o", markersize=marker_size[i], markerfacecolor=face,
                markeredgecolor=edge, markeredgewidth=1.3, zorder=3)

        # 右栏数值列：一致率 [95% CI] 与标准误
        ax.text(X_RATE, y[i], "{:.3f} [{:.3f}, {:.3f}]".format(rate[i], lo[i], hi[i]),
                transform=trans, ha="left", va="center", fontsize=7.0,
                fontfamily="monospace",
                color=COLORS["ref_line"] if indistinct[i] else PALETTE[0],
                fontweight="normal" if indistinct[i] else "bold")
        ax.text(X_SE, y[i], "{:.4f}".format(se[i]), transform=trans, ha="left",
                va="center", fontsize=7.0, fontfamily="monospace", color=COLORS["text"])

    # 右栏列头
    ax.text(X_RATE, HEADER_Y, "一致率 [95% CI]", transform=trans, ha="left", va="center",
            fontsize=8.0, fontweight="bold", color=COLORS["text"])
    ax.text(X_SE, HEADER_Y, "SE", transform=trans, ha="left", va="center",
            fontsize=8.0, fontweight="bold", color=COLORS["text"])

    # 参照线含义的短标签（仅一行，置于图顶）
    ax.text(1.0, HEADER_Y, "完全一致 1.0", transform=ax.get_xaxis_transform(),
            ha="right", va="center", fontsize=8.0, color=COLORS["text"],
            bbox=dict(boxstyle="round,pad=0.25",
                      facecolor=_lighten(COLORS["highlight"], 0.85), edgecolor="none"))

    # 实心 / 空心含义
    handles = [
        Line2D([], [], linestyle="none", marker="o", markersize=6,
               markerfacecolor=PALETTE[0], markeredgecolor=PALETTE[0],
               label="95% 区间不含 1.0"),
        Line2D([], [], linestyle="none", marker="o", markersize=6,
               markerfacecolor="white", markeredgecolor=COLORS["ref_line"],
               label="95% 区间含 1.0（与完全一致不可区分）"),
    ]
    ax.legend(handles=handles, loc="lower right", fontsize=7.5, frameon=True,
              framealpha=0.9, borderpad=0.5, handletextpad=0.6)

    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=9)
    ax.tick_params(axis="y", length=0)
    ax.tick_params(axis="x", labelsize=8.5)
    ax.set_ylabel("表 1 情况", fontsize=9)
    ax.set_xlabel("重复抽样重解与点估计决策的一致率（含 95% 置信区间）", fontsize=9)

    ax.xaxis.set_major_locator(MaxNLocator(nbins=5))
    ax.grid(axis="x", alpha=0.15, linestyle="--")
    ax.set_axisbelow(True)

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)

    ax.set_xlim(float(lo.min()) - 0.05, 1.0 + 0.015)
    ax.set_ylim(n_cases - 0.4, -0.95)  # 反向：情况 1 在最上

    fig.subplots_adjust(left=0.17, right=0.64, top=0.88, bottom=0.19)

    save_fig(fig, "figures/fig_q4_ci_effect_on_cost.png")


if __name__ == "__main__":
    main()
