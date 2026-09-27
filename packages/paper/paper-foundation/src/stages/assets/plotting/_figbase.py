# -*- coding: utf-8 -*-
"""数据图公共引导：路径注入 + 样式 + 调色板派生色图 + 账本载入 + 缺字兜底。

**这是 harness 铺好的固定模块，不是让你自己写一份**（本文件由 stage 6 的执行体
原样拷进 `<stage>/figures/_figbase.py`）。各 `gen_fig_*.py` 统一：

    from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn, log_floor

## 为什么由 harness 固定而不是各跑各写

参考工作流的做法是"图多于 5 张时先建 `figures/_figbase.py`"——那是**建议**，
交给执行者自己判断。实测代价：同一批 11 张图里只有 1 份脚本真的用了它，
其余各写各的样板，口径函数与缺字替换随之各写各的（正是参考担心的
"各图指标口径不一致导致论文数字打架"）。把它变成**铺好的资产**之后，
"用不用"不再是执行者的自由，而是契约。

## 与参考版本的差别（只有两处，都是本仓库布局所致）

- 参考的 `load()` 按 `figures/` → `output/` 找 JSON；本仓库的账本由阶段 4 铸在
  **阶段目录**（`<stage>/results.json`，脚本的 cwd），所以 `load()` 先找
  `ROOT` 再找 `figures/`——`load('results.json')` 是本题最常用的调用。
- `_prep/` 目录**按需创建**：参考那边有独立的数据准备阶段会往里写 npz；
  本仓库没有，凭空建一个空目录只会让交付目录多一份噪声。
"""
from __future__ import annotations
import sys
import json
from pathlib import Path

# 本文件位于 `<stage>/figures/`：HERE=figures，ROOT=阶段目录（脚本的 cwd）。
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
for _p in (str(ROOT), str(HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# 样式库的**唯一**来源。harness 把它铺在 `<stage>/_utils/`（规范位置），
# 同时在 `<stage>/figures/_utils/` 留一份兜底——Python 只把脚本所在目录加进
# sys.path，靠环境变量传 cwd 在某些环境下不生效（实测过）。
#
# ⛔ **这份名单是"契约承诺"与"模块实际提供"的交界**：简报与分片提示词里教模型
# `from _figbase import load, save, panel, PALETTE, COLORS, _lighten, cn`，
# 少一个名字，**每一份脚本都会 ImportError 而全挂**。实测踩过：第一版漏了
# `_lighten`（它定义在 plot_utils 里，但没被这里转出），7/7 脚本全挂，
# 报 `cannot import name '_lighten' from '_figbase'`。
# 因此下面把脚本真正会用到的名字**逐个转出**，并由测试核对契约里点名的每个名字都在。
from _utils.plot_utils import (  # noqa: F401  (转出即接口)
    # 核心：样式、出图、色板
    setup_style, save_fig,
    PALETTE, PALETTE_LIGHT, COLORS, PALETTES,
    # 版式兜底（参考的"高分图集"做法）
    set_paper_placement, declutter_axes, dynamic_limits, shared_legend,
    consolidate_shared_legends,
    # 标注与图例
    smart_labels, auto_legend, check_legend_overlap, auto_truncate_yticklabels,
    # 现成的整图函数（配方里会直接调用）
    heatmap, forest_plot, trend_plot, bar_compare, distribution_plot,
    scatter_plot, residual_diagnostic, multi_line_plot, box_plot, radar_plot,
    subplot_grid,
)
# `_lighten` 单独引入并**包一层**（见下面的定义）：plot_utils 里那个只接受
# `'#rrggbb'` 字符串，而脚本里的插值函数（HSL 插值、`to_rgb`）返回的是**元组**，
# 直接传进去就 `AttributeError: 'tuple' object has no attribute 'lstrip'`。
# 参考自己的注释就点过这个坑（*"返回十六进制串而非 RGBA 元组：_lighten 只接受
# '#rrggbb'，拿到元组会崩"*）——那是**给脚本作者的提醒**；但提醒防不住，
# 实测 13 张图里就有 2 张栽在这上面。所以在引导层直接容错：接受元组/列表/hex 三种形态。
from _utils.plot_utils import _lighten as _lighten_strict
setup_style()

import numpy as np
from matplotlib.colors import LinearSegmentedColormap


def log_ticks(ax, axis="y"):
    """对数轴改用纯 ASCII 刻度标签。

    默认的 LogFormatterSciNotation 走 mathtext，其负号是 U+2212；本工程的
    中文字族里查不到该字形，matplotlib 会退化成货币符方框（图上是个空框）。
    """
    from matplotlib.ticker import FuncFormatter, LogLocator, NullFormatter

    def _fmt(v, _pos):
        if v <= 0:
            return ""
        e = int(round(float(np.log10(v))))
        if abs(v - 10.0 ** e) > 1e-9 * max(v, 1e-300):
            return ""
        return "1e%d" % e if abs(e) > 2 else ("%g" % v)

    for name in (axis if isinstance(axis, (list, tuple)) else [axis]):
        a = ax.yaxis if name == "y" else ax.xaxis
        a.set_major_locator(LogLocator(base=10.0))
        a.set_major_formatter(FuncFormatter(_fmt))
        a.set_minor_formatter(NullFormatter())
    return ax


FIG_DIR = HERE
PREP_DIR = FIG_DIR / "_prep"

# 顺序色图：由用户色板派生（跳过近白的 PALETTE[3]），冷->暖
_SEQ_STOPS = [PALETTE[5], PALETTE[4], PALETTE[2], PALETTE[1], PALETTE[0]]
CMAP_SEQ = LinearSegmentedColormap.from_list("mh_seq", _SEQ_STOPS, N=256)
CMAP_SEQ_R = CMAP_SEQ.reversed()
# 双向色图（低->中性->高），中点用极浅的 PALETTE[3]
CMAP_DIV = LinearSegmentedColormap.from_list(
    "mh_div", [PALETTE[5], PALETTE[4], PALETTE[3], PALETTE[1], PALETTE[0]], N=256)

# 线条可用色（排除近白）
LINE_COLORS = [PALETTE[0], PALETTE[5], PALETTE[1], PALETTE[4], PALETTE[2]]


def _lighten(color, amount=0.4):
    """把颜色调浅；**接受 hex 串 / RGB(A) 元组 / 列表**三种形态。

    为什么在引导层容错而不是靠文档提醒：`plot_utils._lighten` 只吃 `'#rrggbb'`，
    而脚本里常见的 HSL 插值（`colorsys.hls_to_rgb` / `to_rgb`）返回的是**元组**。
    参考自己的注释点过这个坑（"拿到元组会崩"），但**提醒防不住**——
    实测 2024B 的 13 张图里就有 2 张栽在这里（`AttributeError: 'tuple' object
    has no attribute 'lstrip'`），而且这类崩发生在**渲染阶段**，
    等于把代价推到了整轮最后。形态转换没有语义损失，所以在入口一次做掉。
    """
    if isinstance(color, (tuple, list)):
        from matplotlib.colors import to_hex
        return _lighten_strict(to_hex(tuple(color)), amount)
    return _lighten_strict(color, amount)


def seq_colors(n, lo=0.08, hi=0.95):
    """从派生顺序色图取 n 个离散色，供多时刻曲线用。

    返回十六进制串而非 RGBA 元组：_lighten 只接受 '#rrggbb'，拿到元组会崩。
    """
    from matplotlib.colors import to_hex
    return [to_hex(CMAP_SEQ(x)) for x in np.linspace(lo, hi, max(int(n), 1))]


def load(name):
    """读账本/结果 JSON：先找阶段目录（`load('results.json')`），再找 `figures/`。"""
    for base in (ROOT, FIG_DIR, PREP_DIR):
        p = base / name
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError(str(ROOT / name))


def ledger():
    """铸出的账本 `{result_id, name, value, unit}`（阶段 4 的产物）。"""
    return load("results.json")


def values_by_id(doc=None):
    """账本 → `{result_id: value}`，供脚本按 id 取数（**图里的数只能从这来**）。"""
    doc = ledger() if doc is None else doc
    rows = doc.get("results", doc) if isinstance(doc, dict) else doc
    out = {}
    for row in rows:
        if isinstance(row, dict) and "result_id" in row:
            out[str(row["result_id"])] = row.get("value")
    return out


def load_prep(name):
    return load(str(Path("_prep") / name))


def npz(name):
    return np.load(PREP_DIR / name, allow_pickle=False)


def panel(ax, tag):
    """面板编号：左上角，不用整图标题。"""
    ax.set_title(tag, loc="left", fontsize=11, fontweight="bold", pad=3)
    return ax


def log_floor(vals, frac=1e-3):
    """由真实数据推得的对数下限：取正值最小值的 frac 倍，绝不硬编码 1e-18。"""
    a = np.asarray(vals, dtype=float).ravel()
    a = a[np.isfinite(a) & (a > 0)]
    if a.size == 0:
        return None
    return float(a.min() * frac)


def clip_pos(vals, floor=None):
    """把 <=0 的值抬到正下限，供对数轴使用。"""
    a = np.asarray(vals, dtype=float)
    f = log_floor(a) if floor is None else floor
    if f is None:
        return a
    return np.where(a > f, a, f)


_GLYPH = {"⛔": "×", "✔": "√", "✓": "√", "⚠": "!", "≫": ">>", "≪": "<<",
          "⇒": "->", "→": "->", "±": "+/-", "≈": "~", "≤": "<=", "≥": ">="}


def cn(s):
    """替换缺字形字符，避免中文字体缺字导致方框。"""
    out = str(s)
    for k, v in _GLYPH.items():
        out = out.replace(k, v)
    return out


def save(fig, stem):
    """统一出图：`save(fig, 'fig_q1_oc_curve_p1')` → `figures/fig_q1_oc_curve_p1.png`。"""
    if stem.startswith("figures/"):
        stem = stem[len("figures/"):]
    out = FIG_DIR / (stem + ".png")
    save_fig(fig, str(out))
    return out
