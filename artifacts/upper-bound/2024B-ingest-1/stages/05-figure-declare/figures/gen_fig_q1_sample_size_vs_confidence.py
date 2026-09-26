"""
fig_q1_sample_size_vs_confidence —— 两个信度口径下最小检测次数 n* 的量级对照（哑铃图）

本图讲什么：
    同一标称值 10% 下，"95% 信度认定超标则拒收"（情形 1）与"90% 信度认定不超标则接收"
    （情形 2）所要求的最小检测次数并不在同一量级。用一个水平哑铃把两个方案放在同一把
    对数刻度尺上：两端点即两种口径的 n*，茎长就是量级差，一眼可读。

面板构成（单面板）：
    (唯一 panel) 横轴为对数刻度的最小检测次数 n*，纵轴为信度口径；左端点为 90% 接收侧，
    右端点为 95% 拒收侧，茎上标注两者的量级倍数。端点的数值标注直接落在横轴刻度上，
    避免图内文字堆叠。

数据来源（全部现场读自账本 results.json，脚本不写死任何数）：
    R-Q1-case1-n —— 情形(1) 95% 信度拒收侧的最小检测次数 n*
    R-Q1-case2-n —— 情形(2) 90% 信度接收侧的最小检测次数 n*
    关键数值（n* 两端取值及其比值）均由上述两个 result_id 在运行时算出。

口径说明：账本只铸出两个信度点的样本量，故本图不画"样本量—信度"连续曲线，
    以免外推一个并不存在的单调关系；id 逐字沿用阶段 1 的 FIGURE_MANIFEST。
"""

from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn

import numpy as np
import matplotlib.pyplot as plt


# ── 唯一数据来源：账本 results.json（经 _figbase 的路径解析读取）──────────
_led = load("results.json")
_rows = _led["results"] if isinstance(_led, dict) and "results" in _led else _led
_ledger = {r["result_id"]: float(r["value"]) for r in _rows}

n_reject = _ledger["R-Q1-case1-n"]        # 情形(1)：95% 信度拒收侧的方案
n_accept = _ledger["R-Q1-case2-n"]        # 情形(2)：90% 信度接收侧的方案
ratio = n_reject / n_accept               # 两口径检测次数的量级倍数


# ── 画布：单行哑铃，宽扁比例 r ≈ 0.40（≤0.80 档 → 宽 6.0 in）──────────
fig, ax = plt.subplots(figsize=(6.0, 2.4))

y0 = 0.0
ax.set_xscale("log")
ax.grid(axis="x", alpha=0.15, linestyle="-", color=COLORS["grid"])
ax.set_axisbelow(True)

# 哑铃茎：连接两个信度口径下的最小检测次数
ax.plot([n_accept, n_reject], [y0, y0],
        color=PALETTE[2], lw=2.6, solid_capstyle="round", zorder=2)

# 两端定位参考线（弱化处理，不抢主色与端点）
ax.axvline(n_accept, color=_lighten(PALETTE[3], 0.45), lw=0.9,
           linestyle=(0, (3, 3)), zorder=1)
ax.axvline(n_reject, color=_lighten(PALETTE[0], 0.45), lw=0.9,
           linestyle=(0, (3, 3)), zorder=1)

# 哑铃两端点
ax.scatter(n_accept, y0, s=130, color=PALETTE[3], edgecolors="white",
           linewidths=1.2, zorder=4)
ax.scatter(n_reject, y0, s=130, color=PALETTE[0], edgecolors="white",
           linewidths=1.2, zorder=4)

# 端点归属标注（90% 接收侧 / 95% 拒收侧），各占一行、左右分置
ax.text(n_accept, y0 + 0.22, cn("90% 信度接收侧 n*"),
        ha="center", va="bottom", fontsize=8.5, color=PALETTE[3])
ax.text(n_reject, y0 + 0.22, cn("95% 信度拒收侧 n*"),
        ha="center", va="bottom", fontsize=8.5, color=PALETTE[0])

# 茎上的量级倍数：取几何中点，正好落在对数轴的正中
_mid = float(np.sqrt(n_accept * n_reject))
ax.text(_mid, y0 - 0.22, cn(f"两侧 n* 相差约 {ratio:.1f} 倍"),
        ha="center", va="top", fontsize=8.5, color=COLORS["accent"])

# 横轴：只标账本读出的两个刻度，数值即两端点取值
ax.set_xticks([n_accept, n_reject])
ax.set_xticklabels([f"{n_accept:.0f}", f"{n_reject:.0f}"], fontsize=9)
ax.set_xlim(n_accept / 2.2, n_reject * 2.2)
ax.set_ylim(-0.75, 0.75)
ax.set_yticks([])

ax.set_xlabel(cn("最小检测次数 n*（件，对数刻度）"), fontsize=10)
ax.set_ylabel(cn("信度口径"), fontsize=10)

ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.spines["left"].set_visible(False)

fig.tight_layout()
save(fig, "fig_q1_sample_size_vs_confidence")
