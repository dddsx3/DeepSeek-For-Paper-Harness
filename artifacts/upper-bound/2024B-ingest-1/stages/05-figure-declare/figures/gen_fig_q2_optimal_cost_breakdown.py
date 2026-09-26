"""
fig_q2_optimal_cost_breakdown —— 问题 2 表 1 情况 1 最优策略下的成本—利润口径瀑布分解。

本图讲什么：
    单 panel 瀑布图。表 1 情况 1 的最优决策 (Z1,Z2,C,D)=(0,0,0,1) 下，把「每件合格成品的
    售价基准」沿垂直方向拆成两个增量：向下的一截是期望总成本，向上的一截是期望利润，
    直观展示该情形下企业一单位产品的成本—收益口径。

每个 panel 是什么：
    (a) 唯一 panel：三根柱构成的瀑布 —— 售价基准（合计柱，柱顶锚点）→ −期望总成本
        （浮柱，自售价基准下落到利润水平）→ =期望利润（落地柱）；柱间用虚线连接线贯通，
        成本带与利润底座用浅色层带分别延伸到右边界与全宽，阶梯圆点标出累计轨迹。

数据来自账本哪些 id：
    R-Q2-case1-unit-cost  —— 情况 1 最优策略下每件合格成品的期望总成本（元/件），向下增量；
    R-Q2-case1-profit     —— 同一情况的最优期望利润（元/件），瀑布终点。
    售价基准 = 上述两项之和，由账本两项在本脚本内直接相加派生，不新造账本条目。
    账本无采购/检测/装配/拆解/调换损失分项，故本图不拆到分项、不虚构分项数值。

关键数值：全部由脚本运行时从 results.json 读出后标注在柱上，脚本内不写任何数据字面量。
"""
from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import numpy as np
import matplotlib.pyplot as plt


def _ledger(path="results.json"):
    """读取账本：兼容 {"results": [{result_id, value, ...}]} 与已摊平的 {result_id: value}。"""
    raw = load(path)
    if isinstance(raw, dict) and isinstance(raw.get("results"), list):
        return {r["result_id"]: r["value"] for r in raw["results"]}
    if isinstance(raw, list):
        return {r["result_id"]: r["value"] for r in raw}
    out = {}
    for k, v in raw.items():
        out[k] = v["value"] if isinstance(v, dict) and "value" in v else v
    return out


def main():
    V = _ledger()
    unit_cost = float(V["R-Q2-case1-unit-cost"])
    profit = float(V["R-Q2-case1-profit"])
    price = unit_cost + profit          # 售价基准（合计），由账本两项派生

    xs = np.arange(3)
    bottoms = np.array([0.0, profit, 0.0])
    heights = np.array([price, unit_cost, profit])
    colors = [PALETTE[0], COLORS["down"], COLORS["up"]]

    fig, ax = plt.subplots(figsize=(6.0, 3.5))
    ax.grid(axis="y", alpha=0.12, linestyle="-", color=COLORS["grid"])
    ax.set_axisbelow(True)

    # ── 色带层叠：成本带（利润线→售价线）自成本柱延伸到右边界；利润底座全宽浅带
    ax.fill_between([xs[1] - 0.5, xs[-1] + 0.5], profit, price,
                    alpha=0.15, color=_lighten(COLORS["down"], 0.45), zorder=1)
    ax.plot([xs[1] - 0.5, xs[-1] + 0.5], [price, price],
            color=COLORS["down"], linewidth=0.7, linestyle="--", alpha=0.35, zorder=1)
    ax.fill_between([xs[0] - 0.5, xs[-1] + 0.5], 0.0, profit,
                    alpha=0.06, color=PALETTE[0], zorder=0)

    # ── 瀑布柱：合计柱 / 成本浮柱 / 利润落地柱
    ax.bar(xs, heights, bottom=bottoms, width=0.54,
           color=colors, edgecolor="white", linewidth=1.2, zorder=5)

    # ── 阶梯连接线：售价线（柱0→柱1）、利润线（柱1→柱2）
    ax.plot([xs[0] + 0.27, xs[1] - 0.27], [price, price],
            color=COLORS["gray"], linewidth=1.1, linestyle=(0, (4, 3)), zorder=6)
    ax.plot([xs[1] + 0.27, xs[2] - 0.27], [profit, profit],
            color=COLORS["gray"], linewidth=1.1, linestyle=(0, (4, 3)), zorder=6)

    # ── 阶梯圆点：累计轨迹 (0, 售价) → (1, 利润) → (2, 利润)
    ax.scatter([xs[0], xs[1], xs[2]], [price, profit, profit],
               color=[PALETTE[0], _lighten(COLORS["down"], 0.25), COLORS["up"]],
               s=64, zorder=7, edgecolors="white", linewidths=1.6)

    # ── 数值标注：全部取自账本读数，端点带边框、浮柱居中
    ax.text(xs[0], price * 1.02, f"{price:.2f}", ha="center", va="bottom",
            fontsize=9, fontweight="bold", color=PALETTE[0], zorder=12,
            bbox=dict(boxstyle="round,pad=0.18", facecolor="white",
                      edgecolor=PALETTE[0], alpha=0.9, linewidth=0.6))
    ax.text(xs[1], (price + profit) / 2.0, f"-{unit_cost:.2f}", ha="center", va="center",
            fontsize=9, fontweight="bold", color=COLORS["down"], zorder=12,
            bbox=dict(boxstyle="round,pad=0.18", facecolor="white",
                      edgecolor=COLORS["down"], alpha=0.92, linewidth=0.6))
    ax.text(xs[2], profit * 1.02, f"{profit:.2f}", ha="center", va="bottom",
            fontsize=9, fontweight="bold", color=COLORS["up"], zorder=12,
            bbox=dict(boxstyle="round,pad=0.18", facecolor="white",
                      edgecolor=COLORS["up"], alpha=0.9, linewidth=0.6))

    ax.set_xticks(xs)
    ax.set_xticklabels([cn("售价基准"), cn("− 期望总成本"), cn("= 期望利润")], fontsize=9.5)
    ax.set_xlabel(cn("成本—利润口径"), fontsize=10)
    ax.set_ylabel(cn("金额（元/件）"), fontsize=10)
    ax.set_xlim(-0.7, 2.7)
    ax.set_ylim(0.0, price * 1.18)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    fig.tight_layout()
    save(fig, "fig_q2_optimal_cost_breakdown")
    plt.close(fig)


if __name__ == "__main__":
    main()
