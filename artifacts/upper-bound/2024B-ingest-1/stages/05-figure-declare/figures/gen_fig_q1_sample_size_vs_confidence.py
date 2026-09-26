"""fig_q1_sample_size_vs_confidence —— 问题 1 两种判别口径下的抽样方案规模对照（双面板哑铃图）。

本图讲什么
----------
问题 1 在标称次品率 10% 下给出两种判别口径的抽样方案：情形 (1)「在 95% 信度下认定
次品率超过标称值则拒收」，情形 (2)「在 90% 信度下认定次品率不超过标称值则接收」。
两种口径对样本规模的要求不在同一量级，本图把这一量级差直接摆成哑铃的两端，
而不是用折线把两个信度点连出一条并不存在的单调趋势。

每个 panel 是什么
------------------
(a) 左面板：两情形的最小检测次数 n*（件）。左端为情形 (1) 的 n*，右端为情形 (2) 的 n*，
    两端之差即哑铃茎长，直观给出「严格拒收口径」相对「宽松接收口径」的样本规模代价。
(b) 右面板：两情形对应的接收判定临界次品数 c*（件）。同为哑铃两端对照，说明两种口径
    不仅样本量不同，判定阈值本身也完全不同（一端为正整数阈值、一端退化为 0）。

数据来自账本哪些 id
--------------------
账本位置见 FIGURE_PLAN.ledger_source（stages/04-result-sources/results.json）：
  R-Q1-case1-n  情形(1) 最小检测次数 n*
  R-Q1-case2-n  情形(2) 最小检测次数 n*
  R-Q1-case1-c  情形(1) 接收判定临界次品数 c*
  R-Q1-case2-c  情形(2) 接收判定临界次品数 c*
脚本内不写入任何图数据字面量，全部经 result_id 从账本读取。

产出：figures/fig_q1_sample_size_vs_confidence.png
"""
from _utils.plot_utils import setup_style, save_fig, PALETTE, COLORS, _lighten

setup_style()

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

# ── 账本定位：候选相对路径链与 FIGURE_PLAN.ledger_source 声明的相对位置对齐。
#    上游审计指出执行期 cwd 未必等于账本所在目录，故这里统一做多候选回退，
#    任一候选命中即可，避免批量出图在首个脚本上因 FileNotFoundError 中断。
_LEDGER_REL_CANDIDATES = (
    "stages/04-result-sources/results.json",
    "04-result-sources/results.json",
    "../04-result-sources/results.json",
    "../../04-result-sources/results.json",
    "results.json",
    "../results.json",
)


def _extract_rows(ledger):
    """账本既可能是 {"results": [...]} 也可能是裸数组，这里统一成行列表。"""
    if isinstance(ledger, dict) and "results" in ledger:
        return ledger["results"]
    if isinstance(ledger, list):
        return ledger
    raise ValueError("无法从账本对象中解析出 results 行列表")


def _read_ledger():
    """优先复用 _utils 的统一加载器；不存在时按候选相对路径链回退读取。"""
    try:
        from _utils.plot_utils import load_ledger as _shared_loader
    except Exception:
        _shared_loader = None

    if _shared_loader is not None:
        try:
            return _extract_rows(_shared_loader())
        except Exception:
            pass

    here = Path(__file__).resolve()
    bases = [Path.cwd()]
    probe = here.parent
    for _ in range(4):
        bases.append(probe)
        probe = probe.parent

    for base in bases:
        for rel in _LEDGER_REL_CANDIDATES:
            cand = (base / rel).resolve()
            if cand.is_file():
                with cand.open("r", encoding="utf-8") as fh:
                    return _extract_rows(json.load(fh))

    raise FileNotFoundError(
        "results.json 未找到；已尝试基准目录 ["
        + ", ".join(str(b) for b in bases)
        + "] 下的候选相对路径 ["
        + ", ".join(_LEDGER_REL_CANDIDATES)
        + "]"
    )


_VALUE = {row["result_id"]: row["value"] for row in _read_ledger()}

N_CASE1 = float(_VALUE["R-Q1-case1-n"])   # 情形(1) 最小检测次数 n*
N_CASE2 = float(_VALUE["R-Q1-case2-n"])   # 情形(2) 最小检测次数 n*
C_CASE1 = float(_VALUE["R-Q1-case1-c"])   # 情形(1) 判定临界次品数 c*
C_CASE2 = float(_VALUE["R-Q1-case2-c"])   # 情形(2) 判定临界次品数 c*

# 哑铃两端 = 两种判别信度口径；x 轴为情形轴，y 轴为该面板的指标值（件）
_X_LEFT, _X_RIGHT = 0.0, 1.0
_XS = np.array([_X_LEFT, _X_RIGHT])
_TICK_LABELS = ("情形(1)\n95% 拒收", "情形(2)\n90% 接收")


def _draw_dumbbell(ax, left_value, right_value, y_label):
    """在给定坐标轴上画一条哑铃：两端为两情形的取值，连接茎的长度即量级差。"""
    vals = np.array([left_value, right_value], dtype=float)

    ax.grid(axis="y", alpha=0.15, linestyle="-", color=COLORS["grid"])
    ax.set_axisbelow(True)

    # 量级参考竖线（0 → 端点），弱化处理，只用于读出两端各自的绝对量级
    for x, v in zip(_XS, vals):
        ax.vlines(x, 0.0, v, color=COLORS["grid"], linewidth=1.0,
                  linestyles=":", alpha=0.55, zorder=1)

    # 哑铃茎：连接两情形
    ax.plot(_XS, vals, color=PALETTE[2], linewidth=2.2,
            solid_capstyle="round", zorder=2)

    # 哑铃两端
    for x, v, color in zip(_XS, vals, (PALETTE[3], PALETTE[0])):
        ax.scatter([x], [v], color=color, s=80, zorder=4,
                   edgecolors="white", linewidths=1.0)

    # 端点数值短标签：每个面板严格两个数据锚点，差值信息进题注
    for x, v in zip(_XS, vals):
        ax.annotate(f"{v:.0f} 件", xy=(x, v), xytext=(0, 11),
                    textcoords="offset points", ha="center", va="bottom",
                    fontsize=8, fontweight="bold", color=PALETTE[2], zorder=5)

    ax.set_xticks(_XS)
    ax.set_xticklabels(_TICK_LABELS, fontsize=8.5)
    ax.set_xlim(_X_LEFT - 0.45, _X_RIGHT + 0.45)
    ax.set_ylim(0.0, vals.max() * 1.30)
    ax.set_xlabel("判别信度", fontsize=9)
    ax.set_ylabel(y_label, fontsize=9)
    ax.tick_params(axis="y", labelsize=8.5)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.8))

_draw_dumbbell(axes[0], N_CASE1, N_CASE2, "最小检测次数 $n^*$（件）")
_draw_dumbbell(axes[1], C_CASE1, C_CASE2, "判定临界次品数 $c^*$（件）")

axes[0].set_title("(a)", loc="left", fontsize=9.5, pad=3)
axes[1].set_title("(b)", loc="left", fontsize=9.5, pad=3)

fig.tight_layout()
save_fig(fig, "figures/fig_q1_sample_size_vs_confidence.png")
plt.close(fig)
