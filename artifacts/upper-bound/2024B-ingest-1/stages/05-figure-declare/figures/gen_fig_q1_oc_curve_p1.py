"""
fig_q1_oc_curve_p1 —— 问题 1 两种抽样方案的接收特性（OC）曲线

本图讲什么
----------
把问题 1 得到的两个抽样方案（最小检测次数 n*、接收判定临界次品数 c*）画成接收特性（OC）曲线：
横轴为零配件真实次品率 p，纵轴为按二项分布计算的接收概率
    L(p) = P(X <= c*),  X ~ Binomial(n*, p)。
曲线越陡，方案对“次品率是否超过标称值”的区分能力越强。

面板结构
--------
单面板（无子图）。
  · 实线     = 情形(1)：n*、c* 取自账本 R-Q1-case1-n / R-Q1-case1-c（95% 信度下认定次品率
               超过标称值即拒收，故临界次品数 c* 较大）；
  · 虚线     = 情形(2)：n*、c* 取自账本 R-Q1-case2-n / R-Q1-case2-c（90% 信度下认定次品率
               不超过标称值即接收，故 c* 极小、曲线在标称值处已降到很低）；
  · 竖虚线   = 题面给定的标称值 p0 = 10%（S07），作为判据线；
  · ★ 标记   = 两条曲线在 p0 处的接收概率取值（每条曲线的数值锚点）；
  · 曲线下浅色填充 = 该方案在该 p 下的“接收区域”。

数据来源（账本 results.json，result_id）
--------------------------------------
  R-Q1-case1-n   情形(1) 最小检测次数 n*
  R-Q1-case1-c   情形(1) 接收判定临界次品数 c*
  R-Q1-case2-n   情形(2) 最小检测次数 n*
  R-Q1-case2-c   情形(2) 接收判定临界次品数 c*
除上述 4 个账本参数与题面给定的标称值 10% 外，图中每一个数都由这 4 个参数当场算出，
未引入任何账本之外的数据，也未硬编码任何曲线点。
"""

import json
import math
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt

from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

# ----------------------------------------------------------------------------
# 账本读取：候选路径链，覆盖执行期 cwd 与多种相对层级（与 FIGURE_PLAN.ledger_source 对齐）
# ----------------------------------------------------------------------------
LEDGER_RELATIVE = (
    "results.json",
    "stages/04-result-sources/results.json",
    "04-result-sources/results.json",
    "../04-result-sources/results.json",
    "../../stages/04-result-sources/results.json",
)


def load_ledger():
    """在若干候选位置里找 results.json，返回解析后的 dict；找不到则显式报错。"""
    here = Path(__file__).resolve()
    bases = [Path.cwd(), here.parent, here.parent.parent, here.parent.parent.parent]
    candidates = [Path(rel) for rel in LEDGER_RELATIVE]
    for base in bases:
        for rel in LEDGER_RELATIVE:
            candidates.append(base / rel)
    seen = set()
    for cand in candidates:
        key = str(cand)
        if key in seen:
            continue
        seen.add(key)
        if cand.is_file():
            with open(cand, "r", encoding="utf-8") as fh:
                return json.load(fh)
    raise FileNotFoundError(
        "未找到 results.json，已尝试：" + ", ".join(sorted(seen))
    )


def ledger_value(ledger, result_id):
    """按 result_id 从账本取数；取不到直接报错，避免静默用错数。"""
    for item in ledger["results"]:
        if item["result_id"] == result_id:
            return float(item["value"])
    raise KeyError("账本中不存在 result_id: %s" % result_id)


LEDGER = load_ledger()

N_CASE1 = ledger_value(LEDGER, "R-Q1-case1-n")
C_CASE1 = ledger_value(LEDGER, "R-Q1-case1-c")
N_CASE2 = ledger_value(LEDGER, "R-Q1-case2-n")
C_CASE2 = ledger_value(LEDGER, "R-Q1-case2-c")

# 题面 S07 给定的标称次品率（模型常数，非账本数据）
P_NOMINAL = 0.10
# 曲线横轴扫描范围（绘图域，非数据）
P_MAX = 0.30

# ----------------------------------------------------------------------------
# 二项分布接收概率 L(p) = P(X <= c | n, p)
# ----------------------------------------------------------------------------
try:
    from scipy.stats import binom as _binom
except Exception:  # pragma: no cover - 无 scipy 时退化为精确求和
    _binom = None


def acceptance_probability(n, c, p):
    """接收概率：X ~ Binomial(n, p) 时 P(X <= c)。"""
    n = int(round(n))
    c = int(round(c))
    p = float(p)
    if p <= 0.0:
        return 1.0
    if p >= 1.0:
        return 1.0 if c >= n else 0.0
    if _binom is not None:
        return float(_binom.cdf(c, n, p))
    total = 0.0
    for k in range(min(c, n) + 1):
        total += math.comb(n, k) * (p ** k) * ((1.0 - p) ** (n - k))
    return max(0.0, min(1.0, total))


p_grid = np.linspace(0.0, P_MAX, 301)
L_case1 = np.array([acceptance_probability(N_CASE1, C_CASE1, p) for p in p_grid])
L_case2 = np.array([acceptance_probability(N_CASE2, C_CASE2, p) for p in p_grid])

L1_AT_NOMINAL = acceptance_probability(N_CASE1, C_CASE1, P_NOMINAL)
L2_AT_NOMINAL = acceptance_probability(N_CASE2, C_CASE2, P_NOMINAL)

# ----------------------------------------------------------------------------
# 绘图
# ----------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(6.0, 3.8))

# 标称值判据线（题面给定 p0 = 10%）
ax.axvline(P_NOMINAL, color=COLORS["grid"], linestyle="--", linewidth=1.0, zorder=1)

# 曲线下浅色填充 = 该方案在该 p 下的接收区域
ax.fill_between(p_grid, 0.0, L_case1, alpha=0.08, color=PALETTE[0], linewidth=0, zorder=1)
ax.fill_between(p_grid, 0.0, L_case2, alpha=0.08, color=PALETTE[1], linewidth=0, zorder=1)

# 主折线：实线 = 情形(1)，虚线 = 情形(2)
ax.plot(
    p_grid, L_case1, "-", color=PALETTE[0], linewidth=2.2,
    label="情形(1)  n*=%d, c*=%d" % (round(N_CASE1), round(C_CASE1)), zorder=3,
)
ax.plot(
    p_grid, L_case2, "--", color=PALETTE[1], linewidth=2.0,
    label="情形(2)  n*=%d, c*=%d" % (round(N_CASE2), round(C_CASE2)), zorder=3,
)

# ★ 标称值处的接收概率（每条曲线的数值锚点）
ax.scatter(
    [P_NOMINAL], [L1_AT_NOMINAL], s=130, marker="*", color=PALETTE[0],
    edgecolor="white", linewidth=1.4, zorder=5,
)
ax.scatter(
    [P_NOMINAL], [L2_AT_NOMINAL], s=130, marker="*", color=PALETTE[1],
    edgecolor="white", linewidth=1.4, zorder=5,
)

ax.annotate(
    "L(%d%%) = %.3f" % (round(P_NOMINAL * 100), L1_AT_NOMINAL),
    xy=(P_NOMINAL, L1_AT_NOMINAL),
    xytext=(0.028, 0.80),
    fontsize=8.5, color=PALETTE[0],
    arrowprops=dict(arrowstyle="->", color=PALETTE[0], lw=1.1),
    bbox=dict(boxstyle="round,pad=0.3", facecolor="white",
              edgecolor=PALETTE[0], alpha=0.9),
    zorder=6,
)
ax.annotate(
    "L(%d%%) = %.3f" % (round(P_NOMINAL * 100), L2_AT_NOMINAL),
    xy=(P_NOMINAL, L2_AT_NOMINAL),
    xytext=(0.150, 0.30),
    fontsize=8.5, color=PALETTE[1],
    arrowprops=dict(arrowstyle="->", color=PALETTE[1], lw=1.1),
    bbox=dict(boxstyle="round,pad=0.3", facecolor="white",
              edgecolor=PALETTE[1], alpha=0.9),
    zorder=6,
)

ax.set_xlabel("真实次品率 p", fontsize=10)
ax.set_ylabel("接收概率 L(p)", fontsize=10)
ax.set_xlim(0.0, P_MAX)
ax.set_ylim(0.0, 1.05)
ax.set_xticks(np.arange(0.0, P_MAX + 1e-9, 0.05))
ax.set_yticks(np.arange(0.0, 1.01, 0.25))
ax.tick_params(labelsize=9)
ax.legend(frameon=False, labelspacing=0.35, handlelength=1.8, fontsize=8.5,
          loc="upper right")
ax.grid(alpha=0.12, linestyle="--", color=COLORS["grid"])
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

fig.tight_layout()
save_fig(fig, "figures/fig_q1_oc_curve_p1.png")
