"""fig_q1_oc_curve_p1 —— 问题 1 两情形最小检测方案的接收特性（OC）曲线

本图讲什么
----------
把问题 1 求出的两组「检测次数尽可能少」的抽样判定方案 (n*, c*) 画成接收特性曲线：
横轴为真实次品率 p，纵轴为按二项分布算得的接收概率 L(p) = P(X <= c* | X ~ B(n*, p))。
两个 panel 共用同一 p 网格与同一纵轴，便于横向比较；竖虚线为题面标称值参考线，
曲线在标称值处的取值即该方案在该点上的放行概率，两条曲线的陡降段分别落在各自
检验的判据点附近，说明最小样本量方案在指定信度处具备判据分辨力。

Panel 结构
----------
(a) 情形 (1)：95% 信度下认定次品率超过标称值即拒收，对应 (n*, c*) 使标称值处的
    接收概率仍居高位（判据压在 95% 信度上）；
(b) 情形 (2)：90% 信度下认定次品率不超过标称值即接收，对应 (n*, c*) 使标称值处的
    接收概率已降到低位（只有 90% 信度上方才接收）。
两 panel 均带：曲线下方三层渐变填充、标称值竖参考线、标称值处接收概率的★数据锚点。

数据来源（账本 results.json；脚本内不写死任何账本数据）
------------------------------------------------------
R-Q1-case1-n -> panel (a) 抽样检测次数 n*
R-Q1-case1-c -> panel (a) 接收判定临界次品数 c*
R-Q1-case2-n -> panel (b) 抽样检测次数 n*
R-Q1-case2-c -> panel (b) 接收判定临界次品数 c*
账本读取统一走 _figbase.load()（其内部已带候选路径解析，与执行期 cwd 无关），
不使用裸 open()；p 网格上的整条 L(p) 曲线、以及标注中的每一个数值，
都由上述四个账本量经二项分布 CDF 现算得到。
"""

import numpy as np
import matplotlib.pyplot as plt

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

# ----------------------------------------------------------------- 绘图域常量
# 说明：以下三个常量只决定「画在哪一段横轴 / 参考线画在哪」，均非账本读数；
# 图中的每一条曲线与每一个数值标注都只由账本里的 (n*, c*) 现算得到。
NOMINAL_P = 0.10          # 题面标称值，用作竖参考线
P_LO = 0.0                # 横轴起点
P_HI = 2.0 * NOMINAL_P    # 横轴上限：覆盖标称值及其右侧的陡降段
N_GRID = 321              # p 网格点数（纯计算分辨率，不代表任何观测）

X_LABEL = "真实次品率 p"
Y_LABEL = "接收概率 L(p)"


# ----------------------------------------------------------------- 账本读取
def _ledger_index(doc):
    """把 load() 的返回值统一成 {result_id: value}，兼容几种常见返回形态。"""
    if isinstance(doc, dict) and "results" in doc:
        rows = doc["results"]
    elif isinstance(doc, dict):
        rows = list(doc.items())
    else:
        rows = doc
    out = {}
    for row in rows:
        if isinstance(row, dict):
            out[row["result_id"]] = row.get("value", row)
        else:
            key, val = row
            out[key] = val.get("value") if isinstance(val, dict) else val
    return out


def _need(vals, key):
    """按 result_id 取账本值；缺失即显式报错，绝不回退到内置默认值。"""
    if key not in vals:
        raise KeyError(f"账本缺少结果条目 {key}")
    return vals[key]


# ----------------------------------------------------------------- OC 曲线
try:
    from scipy.stats import binom as _binom

    def oc_curve(n, c, p):
        """接收概率 L(p) = P(X <= c | X ~ B(n, p))。"""
        return _binom.cdf(int(c), int(n), np.asarray(p, dtype=float))

except ImportError:  # 兜底：无 scipy 时用对数域递推，避免大 n 组合数溢出
    from math import lgamma

    def oc_curve(n, c, p):
        p = np.asarray(p, dtype=float)
        q = 1.0 - p
        acc = np.zeros_like(p)
        for k in range(int(c) + 1):
            log_coef = lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1)
            with np.errstate(divide="ignore", invalid="ignore"):
                term = (log_coef
                        + k * np.log(np.where(p > 0, p, 1.0))
                        + (n - k) * np.log(np.where(q > 0, q, 1.0)))
            term = np.where((p <= 0) & (k > 0), -np.inf, term)
            term = np.where((q <= 0) & (n - k > 0), -np.inf, term)
            acc = acc + np.exp(term)
        return np.clip(acc, 0.0, 1.0)


def main():
    vals = _ledger_index(load("results.json"))

    p_grid = np.linspace(P_LO, P_HI, N_GRID)

    cfgs = [
        {
            "tag": "(a)",
            "n": _need(vals, "R-Q1-case1-n"),
            "c": _need(vals, "R-Q1-case1-c"),
            "color": PALETTE[0],
            "offset": (32, -60),   # 文字落在曲线下方的空白区，箭头不压线
        },
        {
            "tag": "(b)",
            "n": _need(vals, "R-Q1-case2-n"),
            "c": _need(vals, "R-Q1-case2-c"),
            "color": PALETTE[1],
            "offset": (20, 34),    # 文字落在曲线右上方的空白区
        },
    ]

    fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8), sharey=True)

    for ax, cfg in zip(axes, cfgs):
        n = int(round(float(cfg["n"])))
        c = int(round(float(cfg["c"])))
        base = cfg["color"]
        soft = _lighten(base, 0.55)

        curve = oc_curve(n, c, p_grid)
        at_nominal = float(oc_curve(n, c, np.atleast_1d(NOMINAL_P))[0])

        # 淡色背景（配方：zorder=0 的微妙背景）
        ax.axhspan(0.0, 1.0, alpha=0.02, color=base, zorder=0)

        # 曲线下方渐变填充：由深到浅三层叠出渐隐效果
        for frac, alpha in ((1.00, 0.20), (0.62, 0.12), (0.28, 0.07)):
            ax.fill_between(p_grid, 0.0, curve * frac,
                            color=soft, alpha=alpha, linewidth=0, zorder=1)

        # 主折线：接收特性曲线
        ax.plot(p_grid, curve, color=base, linewidth=2.2, zorder=3,
                label=cn("接收特性曲线") + f"  n*={n}, c*={c}")

        # 标称值参考线
        ax.axvline(NOMINAL_P, color=COLORS["ref_line"], linestyle="--",
                   linewidth=1.1, zorder=2,
                   label=cn("标称值") + f"  p={NOMINAL_P:.0%}")

        # 数据锚点：标称值处的接收概率（★ 极值标注 + 白描边）
        ax.plot(NOMINAL_P, at_nominal, marker="*", markersize=11, linestyle="none",
                color=base, markeredgecolor="white", markeredgewidth=1.2, zorder=5)
        ax.annotate(cn("标称值处") + f" L={at_nominal:.2f}",
                    xy=(NOMINAL_P, at_nominal), xytext=cfg["offset"],
                    textcoords="offset points", fontsize=7.5, color=base,
                    fontweight="bold", zorder=6,
                    arrowprops=dict(arrowstyle="->", color=base, lw=1.0,
                                    shrinkA=0, shrinkB=4),
                    bbox=dict(boxstyle="round,pad=0.28", facecolor="white",
                              edgecolor=base, alpha=0.9, linewidth=0.7))

        panel(ax, cfg["tag"])
        ax.set_xlabel(X_LABEL)
        ax.set_xlim(P_LO, P_HI)
        ax.set_ylim(-0.03, 1.10)
        ax.set_xticks(np.linspace(P_LO, P_HI, 5))
        ax.grid(alpha=0.12, linestyle="--", color=COLORS["grid"])
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.legend(frameon=False, fontsize=7, labelspacing=0.35,
                  handlelength=1.6, loc="best")

    axes[0].set_ylabel(Y_LABEL)

    fig.tight_layout()
    save(fig, "fig_q1_oc_curve_p1")


if __name__ == "__main__":
    main()
