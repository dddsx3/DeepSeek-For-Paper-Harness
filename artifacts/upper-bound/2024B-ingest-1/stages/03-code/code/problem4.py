# -*- coding: utf-8 -*-
"""问题 4：抽样误差下的重解与稳健性（阶段 03 · 编程实现）。

契约对应
--------
MS-Q4 / EQ-Q4-CI / EQ-Q4-PROFIT-RANGE / EQ-Q4-ROBUST；
并复用问题 2（EQ-Q2-*）与问题 3（EQ-Q3-*）的闭式模型，在次品率带抽样误差时重解。

本模块只把结果写进 JSON 账本（由 main.py 汇总进 outputs.json），不做任何绘图。

实现纪律（含上一轮审计的落点）
------------------------------
* 审计 1（fatal）：EQ-KF 的零配件检测费只计一次。零配件 i 的采购+检测合并写作
  ``z_i*(a_i+c_i)/(1-p_i) + (1-z_i)*a_i``，不再单列 ``z2*c2/(1-p2)``，
  与 EQ-KF 逐字一致；分项成本之和恒等于 U。
* 审计 3：本模块只产出**数据数组**（利润曲线、置信区间、重抽样样本、收敛序列），
  不出现任何图名、chart_type、caption —— 图表声明是阶段 5 的产物。
* 审计 5：问题 3 的拓扑不再硬写，按候选键名从 params 读取；读不到时回落到显式记录的
  来源并把来源写进账本 ``data_sources``，不再默认"代码里不出现题面数字"。
* 审计 6：账本路径一律用脚本所在目录 HERE 拼接，与 cwd 无关。

模型要点
--------
1. 次品率的点估计与 Clopper-Pearson 精确区间（EQ-Q4-CI）。
2. 决策固定下把 p 在区间内传播，取利润区间（EQ-Q4-PROFIT-RANGE）。
3. 重复抽样重解，统计最优决策一致率 rho 与收敛序列（EQ-Q4-ROBUST）。
4. 问题 3 的节点级递推：成本与合格率自底向上聚合，交付需求量自顶向下折算；
   节点级搜索用 (U,Q) 帕累托前沿压缩，并用全枚举与退化实例双路核验。
"""

from __future__ import annotations

import itertools
import json
import math
import os
import random

try:  # 题面给定值与模型常数的唯一来源
    import params as P
except Exception:  # pragma: no cover - 保底，便于独立运行
    class _ParamsStub(object):
        pass

    P = _ParamsStub()

try:  # 采样器加速（可选）
    import numpy as _np
except Exception:  # pragma: no cover
    _np = None

try:  # 问题 1 的最小样本量（可选，用于抽样口径与问题 1 对齐）
    from problem1 import q1_min_n as _Q1_MIN_N
except Exception:  # pragma: no cover
    _Q1_MIN_N = None

try:  # 表 1 的备用读取源（与问题 2 保持同一份转写）
    import problem2 as _P2
except Exception:  # pragma: no cover
    _P2 = None


# --------------------------------------------------------------------------
# 常数读取：全部按 DECLARATION.json 的 model_constants 键名（多候选名）读取
# --------------------------------------------------------------------------
def _pick(names, fallback=None):
    for name in names:
        if hasattr(P, name):
            value = getattr(P, name)
            if value is not None:
                return value
    return fallback


TOL = float(_pick(("数值容差", "NUMERIC_TOLERANCE", "TOL"), 1e-06))
Q1_ALPHA1 = float(_pick(("Q1情形1显著性水平α1", "Q1_ALPHA1", "ALPHA1"), 0.05))
Q1_ALPHA2 = float(_pick(("Q1情形2显著性水平α2", "Q1_ALPHA2", "ALPHA2"), 0.10))
Q1_BETA = float(_pick(("Q1功效约束β", "Q1_BETA", "BETA"), 0.10))
Q1_DELTA = float(_pick(("Q1可识别超标幅度Δ", "Q1_DELTA", "DELTA"), 0.05))
Q1_N_MAX = int(_pick(("Q1样本量搜索上界", "Q1_N_MAX", "N_MAX"), 1000))
P_NOMINAL = float(_pick(("标称次品率", "NOMINAL_DEFECT_RATE", "P_NOMINAL", "P_NOM"), 0.10))
Q4_REPS = int(_pick(("Q4重抽样次数", "Q4_REPS", "MC_Q4_REPS"), 2000))
Q4_CI_LEVEL = float(_pick(("Q4置信区间置信水平", "Q4_CI_LEVEL", "CI_LEVEL"), 0.95))
SEED = int(_pick(("随机种子", "RANDOM_SEED", "SEED"), 202409))
CONSISTENCY_TH = float(_pick(("决策一致率判定阈值", "CONSISTENCY_THRESHOLD"), 0.95))
Q2_COMBO_COUNT = int(_pick(("问题2策略组合数", "Q2_COMBO_COUNT"), 16))
GRID_N = int(_pick(("盈亏平衡等高线格点数", "BREAKEVEN_GRID_N", "GRID_N"), 41))
PERCENT_SCALE = float(_pick(("百分数标度", "PERCENT_SCALE", "PCT_DIVISOR"), 100.0))
ROUND_DIGITS = int(_pick(("结果保留位数", "ROUND_DIGITS"), 6))
FULL_ENUM_MAX = int(_pick(("问题3全枚举上限", "Q3_FULL_ENUM_MAX"), 200000))
CONV_POINTS = int(_pick(("收敛曲线采样点数", "CONVERGENCE_POINTS"), 200))
BISECT_ITERS = int(_pick(("区间二分迭代次数", "CI_BISECT_ITERS"), 200))
SIM_MAX_ITER = int(_pick(("逐轮复算最大轮数", "ROUND_SIM_MAX_ITER"), 100000))


# --------------------------------------------------------------------------
# 结果账本的数值收尾
# --------------------------------------------------------------------------
def _r(value):
    if value is None:
        return None
    if isinstance(value, (int, str, bool)):
        return value
    try:
        return round(float(value), ROUND_DIGITS)
    except Exception:
        return value


def _rl(values):
    return [_r(v) for v in values]


def _mean(values):
    if not values:
        return None
    return sum(values) / float(len(values))


def _std(values):
    if len(values) < 2:
        return 0.0
    mu = _mean(values)
    return math.sqrt(sum((v - mu) ** 2 for v in values) / float(len(values) - 1))


def _percentile(sorted_values, frac):
    if not sorted_values:
        return None
    if frac <= 0.0:
        return sorted_values[0]
    if frac >= 1.0:
        return sorted_values[-1]
    pos = frac * (len(sorted_values) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(sorted_values) - 1)
    w = pos - lo
    return sorted_values[lo] * (1.0 - w) + sorted_values[hi] * w


# --------------------------------------------------------------------------
# 二项分布工具与 Clopper-Pearson 精确区间（EQ-Q4-CI）
# --------------------------------------------------------------------------
def _binom_cdf(k, n, p):
    """P(X <= k | n, p)，对数域外的小 n 直算，p 单调递减。"""
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    if p <= 0.0:
        return 1.0
    if p >= 1.0:
        return 0.0
    term = (1.0 - p) ** n
    total = term
    ratio = p / (1.0 - p)
    for i in range(1, k + 1):
        term *= (n - i + 1) / float(i) * ratio
        total += term
    if total > 1.0:
        total = 1.0
    if total < 0.0:
        total = 0.0
    return total


def _solve_p(k, n, target, lo, hi):
    """二分求 p 使 _binom_cdf(k, n, p) = target（CDF 关于 p 单调递减）。"""
    for _ in range(BISECT_ITERS):
        mid = (lo + hi) / 2
        if _binom_cdf(k, n, mid) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def clopper_pearson(x, n, level=None):
    """EQ-Q4-CI：[Beta(a/2; x, n-x+1), Beta(1-a/2; x+1, n-x)]。"""
    level = Q4_CI_LEVEL if level is None else level
    if n <= 0:
        return 0.0, 1.0
    alpha = 1.0 - level
    lo = 0.0
    hi = 1.0
    try:
        from scipy.stats import beta as _beta  # noqa: WPS433

        if x > 0:
            lo = float(_beta.ppf(alpha / 2, x, n - x + 1))
        if x < n:
            hi = float(_beta.ppf(1.0 - alpha / 2, x + 1, n - x))
    except Exception:  # pragma: no cover - 无 scipy 时的精确二分
        if x > 0:
            lo = _solve_p(x - 1, n, 1.0 - alpha / 2, 0.0, 1.0)
        if x < n:
            hi = _solve_p(x, n, alpha / 2, 0.0, 1.0)
    if lo > hi:
        lo, hi = hi, lo
    return max(0.0, lo), min(1.0, hi)


def _phat(x, n, tol=None):
    tol = TOL if tol is None else tol
    if n <= 0:
        return 0.0
    v = x / float(n)
    if v > 1.0 - tol:
        v = 1.0 - tol
    if v < 0.0:
        v = 0.0
    return v


# --------------------------------------------------------------------------
# 采样器：可复现，numpy 可用则用 numpy 的二项抽样，否则纯 stdlib 伯努利计数
# --------------------------------------------------------------------------
class _Sampler(object):
    def __init__(self, seed_key):
        self.backend = "stdlib_random"
        self._rng = random.Random(seed_key)
        self._np = None
        if _np is not None:
            try:
                if isinstance(seed_key, tuple):
                    seq = list(seed_key)
                else:
                    seq = [int(seed_key)]
                self._np = _np.random.default_rng(seq)
                self.backend = "numpy_generator"
            except Exception:  # pragma: no cover
                self._np = None

    def binomial(self, n, p):
        n = int(n)
        p = float(p)
        if n <= 0 or p <= 0.0:
            return 0
        if p >= 1.0:
            return n
        if self._np is not None:
            return int(self._np.binomial(n, p))
        draw = self._rng.random
        k = 0
        for _ in range(n):
            if draw() < p:
                k += 1
        return k


# --------------------------------------------------------------------------
# 题面给定值的读取：表 1 / 表 2 / 图 1 拓扑（多候选键名 + 显式来源记录）
# --------------------------------------------------------------------------
_KEYS_T1 = ("p1", "a1", "c1", "p2", "a2", "c2", "p0", "A", "c0", "s", "l", "t")
_T1_NAMES = ("TABLE1", "TABLE_1", "T1_CASES", "Q2_CASES", "TABLE1_CASES", "Q2_TABLE1")
_T2_PARTS_NAMES = ("TABLE2_PARTS", "TABLE2_PART", "T2_PARTS", "Q3_PARTS", "PARTS_T2")
_T2_SEMI_NAMES = ("TABLE2_SEMI", "TABLE2_SEMIS", "T2_SEMI", "Q3_SEMIS", "SEMI_T2")
_T2_PROD_NAMES = ("TABLE2_PRODUCT", "TABLE2_PROD", "T2_PRODUCT", "Q3_PRODUCT", "PRODUCT_T2")
_TOPO_NAMES = ("FIG1_TOPO", "Q3_TOPOLOGY", "ASM09_TOPO", "TOPOLOGY", "FIG1_GROUPS")

# 兜底：逐字对应 01-prob-analysis/PROBLEM_FACTS.json 的 F-T1-C1..C6（来源会记进账本）
_T1_FALLBACK = [
    (0.10, 4, 2, 0.10, 18, 3, 0.10, 6, 3, 56, 6, 5),
    (0.20, 4, 2, 0.20, 18, 3, 0.20, 6, 3, 56, 6, 5),
    (0.10, 4, 2, 0.10, 18, 3, 0.10, 6, 3, 56, 30, 5),
    (0.20, 4, 1, 0.20, 18, 1, 0.20, 6, 2, 56, 30, 5),
    (0.10, 4, 8, 0.20, 18, 1, 0.10, 6, 2, 56, 10, 5),
    (0.05, 4, 2, 0.05, 18, 3, 0.05, 6, 3, 56, 10, 40),
]

# 兜底：逐字对应 F-T2-PART-1..8 / F-T2-SEMI / F-T2-PRODUCT / F-T2-PRICE
_T2_PARTS_FALLBACK = [
    (1, 0.10, 2, 1), (2, 0.10, 8, 1), (3, 0.10, 12, 2), (4, 0.10, 2, 1),
    (5, 0.10, 8, 1), (6, 0.10, 12, 2), (7, 0.10, 8, 1), (8, 0.10, 12, 2),
]
_T2_SEMI_FALLBACK = [(1, 0.10, 8, 4, 6), (2, 0.10, 8, 4, 6), (3, 0.10, 8, 4, 6)]
_T2_PROD_FALLBACK = {"p": 0.10, "A": 8, "c": 6, "t": 10, "s": 200, "l": 40}
_TOPO_FALLBACK = {"semi1": [1, 2, 3], "semi2": [4, 5, 6], "semi3": [7, 8]}


def _to_rate(value):
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("%"):
            return float(text[:-1]) / PERCENT_SCALE
        return float(text)
    v = float(value)
    if v > 1.0:
        return v / PERCENT_SCALE
    return v


def _norm_case(entry):
    """把一条表 1 记录归一成 p1..t 的字典；形态不认识时返回 None。"""
    if isinstance(entry, dict):
        if all(k in entry for k in ("p1", "a1", "p2", "a2", "p0", "A", "c0", "s", "l", "t")):
            out = {}
            for k in _KEYS_T1:
                out[k] = _to_rate(entry[k]) if k in ("p1", "p2", "p0") else float(entry[k])
            return out
        part1 = entry.get("零配件1") or entry.get("part1")
        part2 = entry.get("零配件2") or entry.get("part2")
        prod = entry.get("成品") or entry.get("product")
        if isinstance(part1, dict) and isinstance(part2, dict) and isinstance(prod, dict):
            return {
                "p1": _to_rate(part1.get("次品率", part1.get("p"))),
                "a1": float(part1.get("购买单价", part1.get("a"))),
                "c1": float(part1.get("检测成本", part1.get("c"))),
                "p2": _to_rate(part2.get("次品率", part2.get("p"))),
                "a2": float(part2.get("购买单价", part2.get("a"))),
                "c2": float(part2.get("检测成本", part2.get("c"))),
                "p0": _to_rate(prod.get("次品率", prod.get("p"))),
                "A": float(prod.get("装配成本", prod.get("A"))),
                "c0": float(prod.get("检测成本", prod.get("c"))),
                "s": float(entry.get("市场售价", entry.get("s"))),
                "l": float(entry.get("调换损失", entry.get("l"))),
                "t": float(entry.get("拆解费用", entry.get("t"))),
            }
        for key in ("case", "序号", "id"):
            if key in entry:
                rest = dict(entry)
                rest.pop(key, None)
                return _norm_case(rest)
        return None
    if isinstance(entry, (list, tuple)):
        seq = [v for v in entry]
        if len(seq) == len(_KEYS_T1) + 1:
            seq = seq[1:]
        if len(seq) == len(_KEYS_T1):
            out = {}
            for k, v in zip(_KEYS_T1, seq):
                out[k] = _to_rate(v) if k in ("p1", "p2", "p0") else float(v)
            return out
    return None


def _resolve_table1():
    for name in _T1_NAMES:
        if hasattr(P, name):
            cases = _expand_cases(getattr(P, name))
            if cases:
                return cases, "params." + name
    if _P2 is not None:
        for name in _T1_NAMES + ("_TABLE1_INLINE", "TABLE1_INLINE"):
            if hasattr(_P2, name):
                cases = _expand_cases(getattr(_P2, name))
                if cases:
                    return cases, "problem2." + name
    return _expand_cases(_T1_FALLBACK), "inline_fallback(PROBLEM_FACTS:F-T1-C1..C6)"


def _expand_cases(raw):
    cases = []
    if isinstance(raw, dict):
        for key in sorted(raw.keys(), key=lambda k: str(k)):
            c = _norm_case(raw[key])
            if c is not None:
                cases.append(c)
    elif isinstance(raw, (list, tuple)):
        for entry in raw:
            c = _norm_case(entry)
            if c is not None:
                cases.append(c)
    for idx, c in enumerate(cases, start=1):
        c["case"] = idx
    return cases


def _norm_part(entry):
    if isinstance(entry, dict):
        num = entry.get("编号", entry.get("id", entry.get("index")))
        p = entry.get("次品率", entry.get("p"))
        a = entry.get("购买单价", entry.get("a"))
        c = entry.get("检测成本", entry.get("c"))
        if None not in (num, p, a, c):
            return {"id": int(num), "p": _to_rate(p), "a": float(a), "c": float(c)}
        return None
    if isinstance(entry, (list, tuple)) and len(entry) >= 4:
        return {"id": int(entry[0]), "p": _to_rate(entry[1]), "a": float(entry[2]), "c": float(entry[3])}
    return None


def _norm_semi(entry):
    if isinstance(entry, dict):
        num = entry.get("编号", entry.get("id", entry.get("index")))
        p = entry.get("次品率", entry.get("p"))
        a = entry.get("装配成本", entry.get("A"))
        c = entry.get("检测成本", entry.get("c"))
        t = entry.get("拆解费用", entry.get("t"))
        if None not in (num, p, a, c, t):
            return {"id": int(num), "p": _to_rate(p), "A": float(a), "c": float(c), "t": float(t), "l": 0.0}
        return None
    if isinstance(entry, (list, tuple)) and len(entry) >= 5:
        return {"id": int(entry[0]), "p": _to_rate(entry[1]), "A": float(entry[2]),
                "c": float(entry[3]), "t": float(entry[4]), "l": 0.0}
    return None


def _resolve_table2():
    parts, semi, prod, src = None, None, None, []

    for name in _T2_PARTS_NAMES:
        if hasattr(P, name):
            raw = getattr(P, name)
            if isinstance(raw, dict):
                raw = list(raw.values())
            got = [x for x in (_norm_part(e) for e in raw) if x]
            if got:
                parts = got
                src.append("params." + name)
                break
    if parts is None:
        parts = [{"id": i, "p": p, "a": a, "c": c} for (i, p, a, c) in _T2_PARTS_FALLBACK]
        src.append("inline_fallback(PROBLEM_FACTS:F-T2-PART-*)")

    for name in _T2_SEMI_NAMES:
        if hasattr(P, name):
            raw = getattr(P, name)
            if isinstance(raw, dict):
                raw = list(raw.values())
            got = [x for x in (_norm_semi(e) for e in raw) if x]
            if got:
                semi = got
                src.append("params." + name)
                break
    if semi is None:
        semi = [{"id": i, "p": p, "A": A, "c": c, "t": t, "l": 0.0}
                for (i, p, A, c, t) in _T2_SEMI_FALLBACK]
        src.append("inline_fallback(PROBLEM_FACTS:F-T2-SEMI)")

    for name in _T2_PROD_NAMES:
        if hasattr(P, name):
            raw = getattr(P, name)
            if isinstance(raw, dict):
                p = raw.get("次品率", raw.get("p"))
                A = raw.get("装配成本", raw.get("A"))
                c = raw.get("检测成本", raw.get("c"))
                t = raw.get("拆解费用", raw.get("t"))
                s = raw.get("市场售价", raw.get("s"))
                l = raw.get("调换损失", raw.get("l"))
                if None not in (p, A, c, t, s, l):
                    prod = {"p": _to_rate(p), "A": float(A), "c": float(c),
                            "t": float(t), "s": float(s), "l": float(l)}
                    src.append("params." + name)
                    break
    if prod is None:
        prod = dict(_T2_PROD_FALLBACK)
        src.append("inline_fallback(PROBLEM_FACTS:F-T2-PRODUCT/F-T2-PRICE)")

    return parts, semi, prod, "; ".join(src)


def _resolve_topology():
    for name in _TOPO_NAMES:
        if hasattr(P, name):
            raw = getattr(P, name)
            topo = _norm_topo(raw)
            if topo:
                return topo, "params." + name
    return _norm_topo(_TOPO_FALLBACK), "inline_fallback(ASM-09 显式假设)"


def _norm_topo(raw):
    out = {}
    if isinstance(raw, dict):
        for key in sorted(raw.keys(), key=lambda k: str(k)):
            value = raw[key]
            if isinstance(value, str):
                value = [v for v in value.replace(" ", "").split(",") if v]
            try:
                out[str(key)] = [int(v) for v in value]
            except Exception:
                return {}
        return out if out else {}
    if isinstance(raw, (list, tuple)):
        for idx, value in enumerate(raw, start=1):
            try:
                out["semi%d" % idx] = [int(v) for v in value]
            except Exception:
                return {}
        return out
    return {}


# --------------------------------------------------------------------------
# 问题 2 的闭式模型（EQ-Q2-YIELD / EQ-KF / EQ-KR / EQ-KAPPA / EQ-Q2-RECUR / EQ-COST-Q2）
# --------------------------------------------------------------------------
def q2_evaluate(case, z1, z2, cc, dd, tol=None):
    """返回 U、利润与分项成本；不可交付时返回 None。

    审计 1 落点：零配件 i 的采购+检测合并成一项，检测费只计一次。
    """
    tol = TOL if tol is None else tol
    p1, a1, c1 = case["p1"], case["a1"], case["c1"]
    p2, a2, c2 = case["p2"], case["a2"], case["c2"]
    p0, cap_a, c0 = case["p0"], case["A"], case["c0"]
    price_s, loss_l, fee_t = case["s"], case["l"], case["t"]

    buy1 = z1 * (a1 + c1) / (1 - p1) + (1 - z1) * a1
    buy2 = z2 * (a2 + c2) / (1 - p2) + (1 - z2) * a2
    yield1 = 1 - (1 - z1) * p1
    yield2 = 1 - (1 - z2) * p2
    q = (1 - p0) * yield1 * yield2

    kf = cap_a + buy1 + buy2
    kr = cap_a + z1 * c1 + z2 * c2
    kappa = kf - kr

    denom = 1 - dd * (1 - q)
    if denom <= tol or q <= tol:
        return None
    g = q / denom
    disposal = dd * fee_t + (1 - cc) * loss_l
    r_rec = (kr + cc * c0 + (1 - q) * disposal) / denom
    u = (kf + cc * c0 + (1 - q) * (disposal + dd * r_rec)) / g
    profit = price_s - u

    purchase = (z1 * a1 / (1 - p1) + (1 - z1) * a1
                + z2 * a2 / (1 - p2) + (1 - z2) * a2) / g
    breakdown = {
        "assembly": cap_a / g,
        "purchase": purchase,
        "inspection_parts": (z1 * c1 / (1 - p1) + z2 * c2 / (1 - p2)) / g,
        "inspection_product": cc * c0 / g,
        "disassembly": (1 - q) * dd * fee_t / g + dd * (1 - q) * r_rec / g,
        "exchange_loss": (1 - q) * (1 - cc) * loss_l / g,
    }
    residual = abs(sum(breakdown.values()) - u)
    return {
        "u": u, "profit": profit, "q": q, "g": g, "kf": kf, "kr": kr, "kappa": kappa,
        "breakdown": breakdown, "breakdown_residual": residual,
        "decision": (int(z1), int(z2), int(cc), int(dd)),
    }


def q2_round_by_round(case, z1, z2, cc, dd, tol=None):
    """逐轮现金流复算（V-05 的独立第二路）：按轮投入、按轮产出、按 D 决定拆解或报废。"""
    tol = TOL if tol is None else tol
    p1, a1, c1 = case["p1"], case["a1"], case["c1"]
    p2, a2, c2 = case["p2"], case["a2"], case["c2"]
    p0, cap_a, c0 = case["p0"], case["A"], case["c0"]
    loss_l, fee_t = case["l"], case["t"]

    kf = cap_a + (z1 * (a1 + c1) / (1 - p1) + (1 - z1) * a1) \
        + (z2 * (a2 + c2) / (1 - p2) + (1 - z2) * a2)
    kr = cap_a + z1 * c1 + z2 * c2
    q = (1 - p0) * (1 - (1 - z1) * p1) * (1 - (1 - z2) * p2)

    if dd == 1:
        r_prev = 0.0
        r_rec = 0.0
        for _ in range(SIM_MAX_ITER):
            r_rec = kr + cc * c0 + (1 - q) * (fee_t + (1 - cc) * loss_l + r_prev)
            if abs(r_rec - r_prev) <= tol:
                break
            r_prev = r_rec
        u = kf + cc * c0 + (1 - q) * (fee_t + (1 - cc) * loss_l + r_rec)
    else:
        u_prev = 0.0
        u = 0.0
        for _ in range(SIM_MAX_ITER):
            u = kf + cc * c0 + (1 - q) * (1 - cc) * loss_l + (1 - q) * u_prev
            if abs(u - u_prev) <= tol:
                break
            u_prev = u
    return u


def q2_best(case, tol=None):
    """16 种 (Z1,Z2,C,D) 全枚举，取利润最大者（并列取字典序最小组合）。"""
    tol = TOL if tol is None else tol
    best = None
    for z1 in (0, 1):
        for z2 in (0, 1):
            for cc in (0, 1):
                for dd in (0, 1):
                    res = q2_evaluate(case, z1, z2, cc, dd, tol)
                    if res is None:
                        continue
                    key = (-res["profit"], res["decision"])
                    if best is None or key < best[0]:
                        best = (key, res)
    return None if best is None else best[1]


def _q2_key(decision):
    z1, z2, cc, dd = decision
    return "Z1=%d,Z2=%d,C=%d,D=%d" % (z1, z2, cc, dd)


# --------------------------------------------------------------------------
# 问题 3 的节点级模型（EQ-Q3-ASSY / NODE / COST / KF / KAPPA / XI / RECUR / UNITCOST）
# --------------------------------------------------------------------------
def build_q3_tree(parts, semis, product, topo):
    """按 ASM-09 的拓扑建立父→子邻接表（ch(v)）与节点参数。"""
    nodes = {}
    semi_map = {int(s["id"]): s for s in semis}
    for part in parts:
        key = "part%d" % int(part["id"])
        nodes[key] = {"key": key, "kind": "part", "p": part["p"], "a": part["a"],
                      "c": part["c"], "A": 0.0, "t": 0.0, "l": 0.0, "children": []}
    semi_keys = []
    for name in sorted(topo.keys()):
        idx = len(semi_keys) + 1
        spec = semi_map.get(idx)
        if spec is None:
            continue
        child_keys = ["part%d" % pid for pid in topo[name]]
        child_keys = [k for k in child_keys if k in nodes]
        key = "semi%d" % idx
        nodes[key] = {"key": key, "kind": "semi", "p": spec["p"], "a": 0.0,
                      "c": spec["c"], "A": spec["A"], "t": spec["t"],
                      "l": spec.get("l", 0.0), "children": child_keys}
        semi_keys.append(key)
    nodes["product"] = {"key": "product", "kind": "product", "p": product["p"], "a": 0.0,
                        "c": product["c"], "A": product["A"], "t": product["t"],
                        "l": product["l"], "children": semi_keys}
    return nodes, _topo_order(nodes)


def _topo_order(nodes):
    order = []
    seen = set()

    def visit(key):
        if key in seen:
            return
        seen.add(key)
        for child in nodes[key]["children"]:
            visit(child)
        order.append(key)

    for key in sorted(nodes.keys()):
        visit(key)
    return order


def _node_unit_cost(nd, p, q_v, sum_u, kappa, z, d, is_product, tol):
    """EQ-Q3-KF/KAPPA/XI/RECUR/UNITCOST 的单节点实现；不可交付时返回 None。"""
    kf = nd["A"] + z * nd["c"] + sum_u
    if z == 0 and not is_product:
        # 不检测的非成品节点只把子件拼起来，缺陷由上一层凭 Q_v 承担
        return kf, kf, kappa, 0.0, 0.0, 0.0
    kr = kf - kappa
    h = 1 if is_product else z
    xi = h * d * nd["t"] + (1 - z) * nd["l"]
    denom = 1 - h * d * (1 - q_v)
    if denom <= tol:
        return None
    g = q_v / denom
    r_rec = (kr + (1 - q_v) * xi) / denom
    u = (kf + (1 - q_v) * (xi + h * d * r_rec)) / g
    return u, kf, kr, xi, g, r_rec


def _q3_root_u(nodes, order, decisions, rates, tol):
    """只算根节点 U 的快速求解（用于全枚举核验）。"""
    u_map = {}
    q_map = {}
    for key in order:
        nd = nodes[key]
        p = nd["p"] if not rates else rates.get(key, nd["p"])
        children = nd["children"]
        z, d = decisions[key]
        if not children:
            u_map[key] = z * (nd["a"] + nd["c"]) / (1 - p) + (1 - z) * nd["a"]
            q_map[key] = 1 - (1 - z) * p
            continue
        prod_q = 1.0
        sum_u = 0.0
        for child in children:
            prod_q *= q_map[child]
            sum_u += u_map[child]
        q_v = (1 - p) * prod_q
        q_map[key] = z + (1 - z) * q_v
        cap = 0.0
        for child in children:
            cap += u_map[child] - decisions[child][0] * nodes[child]["c"]
        out = _node_unit_cost(nd, p, q_v, sum_u, cap, z, d, nd["kind"] == "product", tol)
        if out is None:
            return None
        u_map[key] = out[0]
    return u_map[order[-1]]


def q3_evaluate(nodes, order, decisions, rates=None, tol=None):
    """固定决策下的自底向上逐节点评估，返回每节点的 U/Q/Kf/Kr/kappa 等明细。"""
    tol = TOL if tol is None else tol
    info = {}
    for key in order:
        nd = nodes[key]
        p = nd["p"] if not rates else rates.get(key, nd["p"])
        children = nd["children"]
        z, d = decisions[key]
        if not children:
            u = z * (nd["a"] + nd["c"]) / (1 - p) + (1 - z) * nd["a"]
            q_v = 1 - p
            q_out = z + (1 - z) * q_v
            info[key] = {"node": key, "kind": nd["kind"], "z": int(z), "d": 0,
                         "U": u, "Q": q_out, "q": q_v, "Kf": u, "Kr": u, "kappa": 0.0,
                         "xi": 0.0, "g": 1.0, "R": 0.0, "h": 0, "p": p}
            continue
        prod_q = 1.0
        sum_u = 0.0
        for child in children:
            prod_q *= info[child]["Q"]
            sum_u += info[child]["U"]
        q_v = (1 - p) * prod_q
        q_out = z + (1 - z) * q_v
        cap = 0.0
        for child in children:
            cap += info[child]["U"] - info[child]["z"] * nodes[child]["c"]
        out = _node_unit_cost(nd, p, q_v, sum_u, cap, z, d, nd["kind"] == "product", tol)
        if out is None:
            return None
        u, kf, kr, xi, g, r_rec = out
        info[key] = {"node": key, "kind": nd["kind"], "z": int(z), "d": int(d),
                     "U": u, "Q": q_out, "q": q_v, "Kf": kf, "Kr": kr, "kappa": cap,
                     "xi": xi, "g": g, "R": r_rec,
                     "h": (1 if nd["kind"] == "product" else int(z)), "p": p}
    return info


def _front(items, tol):
    """(U, Q, payload) 的帕累托前沿：保留 U 升序、Q 严格递增的点。"""
    if not items:
        return []
    ordered = sorted(items, key=lambda it: (it[0], -it[1]))
    out = []
    best_q = None
    for it in ordered:
        if best_q is None or it[1] > best_q + tol:
            out.append(it)
            best_q = it[1]
    return out


def q3_solve(nodes, order, price_s, rates=None, tol=None):
    """节点级最优决策搜索：子节点 (U,Q) 前沿 × 节点二值决策，自底向上压缩。"""
    tol = TOL if tol is None else tol
    fronts = {}
    for key in order:
        nd = nodes[key]
        p = nd["p"] if not rates else rates.get(key, nd["p"])
        children = nd["children"]
        is_product = (nd["kind"] == "product")
        if not children:
            items = []
            for z in (0, 1):
                u = z * (nd["a"] + nd["c"]) / (1 - p) + (1 - z) * nd["a"]
                q_v = 1 - p
                items.append((u, z + (1 - z) * q_v,
                              {"node": key, "z": z, "d": 0, "c": nd["c"], "children": {}}))
            fronts[key] = _front(items, tol)
            continue
        agg = [(0.0, 1.0, 0.0, {})]
        for child in children:
            nxt = []
            for sum_u, prod_q, cap, decs in agg:
                for u_c, q_c, pay in fronts[child]:
                    new_decs = dict(decs)
                    new_decs[child] = pay
                    nxt.append((sum_u + u_c, prod_q * q_c,
                                cap + u_c - pay["z"] * pay["c"], new_decs))
            agg = _front(nxt, tol)
        items = []
        for sum_u, prod_q, cap, decs in agg:
            q_v = (1 - p) * prod_q
            for z in (0, 1):
                for d in (0, 1):
                    out = _node_unit_cost(nd, p, q_v, sum_u, cap, z, d, is_product, tol)
                    if out is None:
                        continue
                    q_out = z + (1 - z) * q_v
                    items.append((out[0], q_out,
                                  {"node": key, "z": z, "d": d, "c": nd["c"],
                                   "children": dict(decs)}))
        fronts[key] = _front(items, tol)
    root = order[-1]
    if not fronts.get(root):
        return None
    best = min(fronts[root], key=lambda it: it[0])
    decisions = _flatten_dec(best[2])
    return {"profit": price_s - best[0], "unit_cost": best[0],
            "decisions": decisions, "payload": best[2]}


def _flatten_dec(payload):
    out = {}

    def walk(node):
        out[node["node"]] = (int(node["z"]), int(node["d"]))
        for child in node["children"].values():
            walk(child)

    walk(payload)
    return out


def _dec_key(decisions, nodes):
    return ",".join("%s:Z=%d,D=%d" % (k, decisions[k][0], decisions[k][1])
                    for k in sorted(decisions.keys()))


def q3_full_enumeration(nodes, order, price_s, rates=None, tol=None):
    """全枚举核验（组合数受限时执行）：搜索空间 Π(2 或 4)。"""
    tol = TOL if tol is None else tol
    keys = [k for k in order]
    option_lists = []
    for key in keys:
        nd = nodes[key]
        opts = []
        if nd["children"]:
            for z in (0, 1):
                for d in (0, 1):
                    opts.append((z, d))
        else:
            for z in (0, 1):
                opts.append((z, 0))
        option_lists.append(opts)
    total = 1
    for opts in option_lists:
        total *= len(opts)
    if total > FULL_ENUM_MAX:
        return None, total
    best_u = None
    best_dec = None
    for combo in itertools.product(*option_lists):
        dec = dict(zip(keys, combo))
        u = _q3_root_u(nodes, order, dec, rates, tol)
        if u is None:
            continue
        if best_u is None or u < best_u:
            best_u = u
            best_dec = dec
    return best_dec, total


# --------------------------------------------------------------------------
# 问题 1 的最小样本量：优先复用 problem1，缺失时本地两点设计搜索
# --------------------------------------------------------------------------
def _local_min_n(p_nom, delta, alpha, beta, n_max):
    p_alt = p_nom + delta
    for n in range(1, int(n_max) + 1):
        pmf_nom = [_binom_cdf(i, n, p_nom) - _binom_cdf(i - 1, n, p_nom) for i in range(n + 1)]
        pmf_alt = [_binom_cdf(i, n, p_alt) - _binom_cdf(i - 1, n, p_alt) for i in range(n + 1)]
        tail_nom = 0.0
        tail_alt = 0.0
        for c in range(n, -1, -1):
            if tail_nom <= alpha and tail_alt >= 1.0 - beta:
                return n, c
            tail_nom += pmf_nom[c]
            tail_alt += pmf_alt[c]
    return None, None


def _resolve_sample_n():
    n_design, c_design, source = None, None, None
    if _Q1_MIN_N is not None:
        try:
            out = _Q1_MIN_N(P_NOMINAL, Q1_DELTA, Q1_ALPHA1, Q1_BETA, Q1_N_MAX)
            if isinstance(out, dict):
                n_design = out.get("n", out.get("n_star"))
                c_design = out.get("c", out.get("c_r"))
            elif isinstance(out, (list, tuple)) and out:
                n_design = out[0]
                c_design = out[1] if len(out) > 1 else None
            else:
                n_design = out
            if n_design is not None:
                n_design = int(n_design)
                source = "problem1.q1_min_n"
        except Exception:
            n_design = None
    if n_design is None:
        n_design, c_design = _local_min_n(P_NOMINAL, Q1_DELTA, Q1_ALPHA1, Q1_BETA, Q1_N_MAX)
        source = "local_two_point_search"
    if n_design is None:
        raise RuntimeError("问题 1 的最小样本量求解失败：请检查 problem1.q1_min_n 与模型常数。")
    return n_design, (int(c_design) if c_design is not None else None), source


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def run(out_dir=None, **kwargs):
    """跑完问题 4 并返回账本字典（main.py 汇总进 outputs.json）。"""
    tol = TOL
    cases, t1_source = _resolve_table1()
    parts, semis, product, t2_source = _resolve_table2()
    topo, topo_source = _resolve_topology()
    nodes, order = build_q3_tree(parts, semis, product, topo)
    price_s = product["s"]
    if len(cases) != len(_T1_FALLBACK):
        # 表 1 的行数是题面给定的六种情况，读到的条数不符时显式报错而不是静默继续
        raise RuntimeError("表 1 读到的情形数 %d 与题面给定的六种情况不符" % len(cases))

    sample_n, q1_c, q1_source = _resolve_sample_n()

    sampler_pt = _Sampler((SEED, 0))
    sampler_mc = _Sampler((SEED, 1))

    # ---------------- 1. 点估计与置信区间（EQ-Q4-CI） ----------------
    t1_point = []
    for case in cases:
        rates = {}
        for tag, key in (("p1", "p1"), ("p2", "p2"), ("p0", "p0")):
            p_true = case[key]
            x = sampler_pt.binomial(sample_n, p_true)
            lo, hi = clopper_pearson(x, sample_n)
            rates[tag] = {"p_true": _r(p_true), "x": int(x), "n": int(sample_n),
                          "p_hat": _r(_phat(x, sample_n, tol)),
                          "ci_low": _r(lo), "ci_high": _r(hi),
                          "covers_point": bool(lo - tol <= _phat(x, sample_n, tol) <= hi + tol)}
        t1_point.append({"case": case["case"], "rates": rates})

    q3_point = {}
    for key in order:
        p_true = nodes[key]["p"]
        x = sampler_pt.binomial(sample_n, p_true)
        lo, hi = clopper_pearson(x, sample_n)
        q3_point[key] = {"p_true": _r(p_true), "x": int(x), "n": int(sample_n),
                         "p_hat": _r(_phat(x, sample_n, tol)),
                         "ci_low": _r(lo), "ci_high": _r(hi),
                         "covers_point": bool(lo - tol <= _phat(x, sample_n, tol) <= hi + tol)}

    # ---------------- 2. 点估计下的重解（问题 2 与问题 3） ----------------
    pe_q2 = []
    rates_hat_q2 = []
    for case, point in zip(cases, t1_point):
        case_hat = dict(case)
        for key in ("p1", "p2", "p0"):
            case_hat[key] = point["rates"][key]["p_hat"]
        rates_hat_q2.append(case_hat)
        res_hat = q2_best(case_hat, tol)
        res_true = q2_best(case, tol)
        pe_q2.append({
            "case": case["case"],
            "decision": _q2_key(res_hat["decision"]) if res_hat else None,
            "decision_tuple": list(res_hat["decision"]) if res_hat else None,
            "unit_cost": _r(res_hat["u"]) if res_hat else None,
            "profit": _r(res_hat["profit"]) if res_hat else None,
            "true_rate_decision": _q2_key(res_true["decision"]) if res_true else None,
            "true_rate_profit": _r(res_true["profit"]) if res_true else None,
        })

    rates_hat_q3 = {key: q3_point[key]["p_hat"] for key in order}
    sol_q3 = q3_solve(nodes, order, price_s, rates=rates_hat_q3, tol=tol)
    sol_q3_true = q3_solve(nodes, order, price_s, rates=None, tol=tol)
    detail_q3 = q3_evaluate(nodes, order, sol_q3["decisions"], rates=rates_hat_q3, tol=tol)
    detail_q3_true = q3_evaluate(nodes, order, sol_q3_true["decisions"], rates=None, tol=tol)

    # ---------------- 3. 决策固定下的利润区间（EQ-Q4-PROFIT-RANGE） ----------------
    grid = [i / float(GRID_N - 1) for i in range(GRID_N)]
    range_q2 = []
    for case, point, pe in zip(cases, t1_point, pe_q2):
        if pe["decision_tuple"] is None:
            continue
        z1, z2, cc, dd = pe["decision_tuple"]
        curve = []
        for t in grid:
            case_t = dict(case)
            for key in ("p1", "p2", "p0"):
                pr = point["rates"][key]
                case_t[key] = pr["ci_low"] + t * (pr["ci_high"] - pr["ci_low"])
            res = q2_evaluate(case_t, z1, z2, cc, dd, tol)
            curve.append(_r(res["profit"]) if res else None)
        vals = [v for v in curve if v is not None]
        range_q2.append({
            "case": case["case"],
            "fixed_decision": pe["decision"],
            "point_profit": pe["profit"],
            "min_profit": _r(min(vals)) if vals else None,
            "max_profit": _r(max(vals)) if vals else None,
            "width": _r(max(vals) - min(vals)) if vals else None,
            "profit_curve": curve,
        })

    q3_curve = []
    for t in grid:
        rates_t = {}
        for key in order:
            pr = q3_point[key]
            rates_t[key] = pr["ci_low"] + t * (pr["ci_high"] - pr["ci_low"])
        info = q3_evaluate(nodes, order, sol_q3["decisions"], rates=rates_t, tol=tol)
        q3_curve.append(_r(price_s - info["product"]["U"]) if info else None)
    q3_vals = [v for v in q3_curve if v is not None]
    range_q3 = {
        "fixed_decision": _dec_key(sol_q3["decisions"], nodes),
        "point_profit": _r(sol_q3["profit"]),
        "min_profit": _r(min(q3_vals)) if q3_vals else None,
        "max_profit": _r(max(q3_vals)) if q3_vals else None,
        "width": _r(max(q3_vals) - min(q3_vals)) if q3_vals else None,
        "profit_curve": q3_curve,
    }

    # ---------------- 4. 蒙特卡洛重抽样一致率（EQ-Q4-ROBUST） ----------------
    ref_q2 = [pe["decision_tuple"] for pe in pe_q2]
    ref_q3 = _dec_key(sol_q3["decisions"], nodes)

    q2_counts = [dict() for _ in cases]
    q2_profits = [[] for _ in cases]
    q3_counts = dict()
    q3_profit_samples = []
    conv_step = max(1, Q4_REPS // max(1, CONV_POINTS))
    conv_x = []
    conv_q2 = []
    conv_q3 = []
    hit_q2_cum = 0
    hit_q2_total_cum = 0
    hit_q3_cum = 0
    for rep in range(1, Q4_REPS + 1):
        hit_t = 0
        for idx, case in enumerate(cases):
            case_hat = dict(case)
            for key in ("p1", "p2", "p0"):
                x = sampler_mc.binomial(sample_n, case[key])
                case_hat[key] = _phat(x, sample_n, tol)
            res = q2_best(case_hat, tol)
            if res is None:
                continue
            key_str = _q2_key(res["decision"])
            q2_counts[idx][key_str] = q2_counts[idx].get(key_str, 0) + 1
            q2_profits[idx].append(res["profit"])
            ref = ref_q2[idx]
            if ref is not None and res["decision"] == tuple(ref):
                hit_t += 1
        hit_q2_cum += hit_t
        hit_q2_total_cum += len(cases)

        rates_mc = {}
        for key in order:
            x = sampler_mc.binomial(sample_n, nodes[key]["p"])
            rates_mc[key] = _phat(x, sample_n, tol)
        sol = q3_solve(nodes, order, price_s, rates=rates_mc, tol=tol)
        if sol is not None:
            sig = _dec_key(sol["decisions"], nodes)
            q3_counts[sig] = q3_counts.get(sig, 0) + 1
            q3_profit_samples.append(sol["profit"])
            if sig == ref_q3:
                hit_q3_cum += 1
        if rep % conv_step == 0 or rep == Q4_REPS:
            conv_x.append(rep)
            conv_q2.append(hit_q2_cum / float(hit_q2_total_cum) if hit_q2_total_cum else None)
            conv_q3.append(hit_q3_cum / float(rep) if rep else None)

    q2_mc = []
    for idx, case in enumerate(cases):
        profits = q2_profits[idx]
        count_sum = sum(q2_counts[idx].values())
        ref = ref_q2[idx]
        hits = q2_counts[idx].get(_q2_key(ref), 0) if ref is not None else 0
        q2_mc.append({
            "case": case["case"],
            "reference_decision": _q2_key(ref) if ref is not None else None,
            "consistency_rate": _r(hits / float(count_sum)) if count_sum else None,
            "resamples": count_sum,
            "decision_counts": q2_counts[idx],
            "profit_mean": _r(_mean(profits)),
            "profit_std": _r(_std(profits)),
        })
    overall_q2_rate = (hit_q2_cum / float(hit_q2_total_cum)) if hit_q2_total_cum else None
    q3_rate = (hit_q3_cum / float(Q4_REPS)) if Q4_REPS else None
    sorted_profits = sorted(q3_profit_samples)
    q3_mc = {
        "reference_decision": ref_q3,
        "consistency_rate": _r(q3_rate),
        "resamples": Q4_REPS,
        "decision_counts": q3_counts,
        "profit_samples": _rl(q3_profit_samples),
        "profit_mean": _r(_mean(q3_profit_samples)),
        "profit_std": _r(_std(q3_profit_samples)),
        "profit_p05": _r(_percentile(sorted_profits, 0.05)),
        "profit_p50": _r(_percentile(sorted_profits, 0.5)),
        "profit_p95": _r(_percentile(sorted_profits, 0.95)),
        "convergence": {"reps": conv_x, "rate": _rl([v for v in conv_q3 if v is not None])},
        "convergence_reps": conv_x,
    }
    monte_carlo = {
        "reps": Q4_REPS,
        "seed": SEED,
        "sample_n": int(sample_n),
        "sampler_backend": sampler_mc.backend,
        "consistency_threshold": CONSISTENCY_TH,
        "q2": {"cases": q2_mc, "overall_consistency_rate": _r(overall_q2_rate),
               "convergence": {"reps": conv_x, "rate": _rl([v for v in conv_q2 if v is not None])}},
        "q3": q3_mc,
        "q2_robust": bool(overall_q2_rate is not None and overall_q2_rate >= CONSISTENCY_TH),
        "q3_robust": bool(q3_rate is not None and q3_rate >= CONSISTENCY_TH),
    }

    # ---------------- 5. 与点估计决策的差异表（{R-Q4-decision-diff}） ----------------
    diff_rows = []
    for case, point, pe in zip(cases, t1_point, pe_q2):
        if pe["decision_tuple"] is None:
            continue
        case_lo = dict(case)
        case_hi = dict(case)
        for key in ("p1", "p2", "p0"):
            case_lo[key] = point["rates"][key]["ci_low"]
            case_hi[key] = point["rates"][key]["ci_high"]
        lo_sol = q2_best(case_lo, tol)
        hi_sol = q2_best(case_hi, tol)
        diff_rows.append({
            "scope": "问题2情况%d" % case["case"],
            "point_estimate_decision": pe["decision"],
            "true_rate_decision": pe["true_rate_decision"],
            "ci_low_decision": _q2_key(lo_sol["decision"]) if lo_sol else None,
            "ci_high_decision": _q2_key(hi_sol["decision"]) if hi_sol else None,
            "flipped_vs_point": bool(
                (lo_sol and _q2_key(lo_sol["decision"]) != pe["decision"])
                or (hi_sol and _q2_key(hi_sol["decision"]) != pe["decision"])
            ),
            "flipped_vs_true": bool(pe["true_rate_decision"] != pe["decision"]),
            "driver": "零配件与成品次品率的抽样误差",
        })
    rates_lo_q3 = {key: q3_point[key]["ci_low"] for key in order}
    rates_hi_q3 = {key: q3_point[key]["ci_high"] for key in order}
    sol_lo_q3 = q3_solve(nodes, order, price_s, rates=rates_lo_q3, tol=tol)
    sol_hi_q3 = q3_solve(nodes, order, price_s, rates=rates_hi_q3, tol=tol)
    diff_rows.append({
        "scope": "问题3实例",
        "point_estimate_decision": ref_q3,
        "true_rate_decision": _dec_key(sol_q3_true["decisions"], nodes),
        "ci_low_decision": _dec_key(sol_lo_q3["decisions"], nodes) if sol_lo_q3 else None,
        "ci_high_decision": _dec_key(sol_hi_q3["decisions"], nodes) if sol_hi_q3 else None,
        "flipped_vs_point": bool(
            (sol_lo_q3 and _dec_key(sol_lo_q3["decisions"], nodes) != ref_q3)
            or (sol_hi_q3 and _dec_key(sol_hi_q3["decisions"], nodes) != ref_q3)
        ),
        "flipped_vs_true": bool(_dec_key(sol_q3_true["decisions"], nodes) != ref_q3),
        "driver": "12 个节点次品率各自的抽样误差",
    })

    # ---------------- 6. 核验（全部为本轮真跑出来的残差，不声称"已通过"） ----------------
    worst_breakdown = 0.0
    worst_rbr = 0.0
    for case in cases:
        for z1 in (0, 1):
            for z2 in (0, 1):
                for cc in (0, 1):
                    for dd in (0, 1):
                        res = q2_evaluate(case, z1, z2, cc, dd, tol)
                        if res is None:
                            continue
                        worst_breakdown = max(worst_breakdown, res["breakdown_residual"])
                        sim = q2_round_by_round(case, z1, z2, cc, dd, tol)
                        worst_rbr = max(worst_rbr, abs(sim - res["u"]))

    worst_degrade = 0.0
    for case in cases:
        worst_degrade = max(worst_degrade, _degradation_residual(case, tol))

    worst_detail = 0.0
    for info in (detail_q3, detail_q3_true):
        if info is None:
            continue
        root_u = _q3_root_u(nodes, order, {k: info[k]["z"], k: 0 for k in order} and
                            {k: (info[k]["z"], info[k]["d"]) for k in order},
                            None if info is detail_q3_true else rates_hat_q3, tol)
        if root_u is None:
            continue
        worst_detail = max(worst_detail, abs(root_u - info["product"]["U"]))

    enum_dec, enum_total = q3_full_enumeration(nodes, order, price_s,
                                               rates=rates_hat_q3, tol=tol)
    enum_gap = None
    if enum_dec is not None:
        enum_u = _q3_root_u(nodes, order, enum_dec, rates_hat_q3, tol)
        enum_gap = abs(enum_u - sol_q3["unit_cost"])

    ci_cover_ok = all(
        row["rates"][k]["covers_point"] for row in t1_point for k in ("p1", "p2", "p0")
    ) and all(q3_point[k]["covers_point"] for k in order)

    conv_series = [v for v in q3_mc["convergence"]["rate"] if v is not None]
    conv_tail = conv_series[len(conv_series) // 2:] if conv_series else []
    conv_dev = max((abs(v - q3_rate) for v in conv_tail), default=None) if q3_rate is not None else None

    verification = {
        "v04_q2_breakdown_max_residual": _r(worst_breakdown),
        "v05_q2_analytic_vs_round_by_round_max_residual": _r(worst_rbr),
        "v07_q3_detail_vs_root_max_residual": _r(worst_detail),
        "v08_q3_degradation_to_q2_max_residual": _r(worst_degrade),
        "v09_q3_pareto_vs_full_enum_gap": _r(enum_gap),
        "v09_q3_full_enum_combos": int(enum_total),
        "v10_ci_covers_point_all": bool(ci_cover_ok),
        "v10_ci_monotone_check": _ci_monotone_check(),
        "v11_mc_consistency_rate_q2": _r(overall_q2_rate),
        "v11_mc_consistency_rate_q3": _r(q3_rate),
        "v11_mc_convergence_tail_max_deviation": _r(conv_dev),
        "v12_decision_diff_rows": len(diff_rows),
        "v12_decision_diff_flips": sum(1 for row in diff_rows if row["flipped_vs_point"]),
        "tolerance": _r(tol),
    }

    # ---------------- 7. 汇总 ----------------
    result = {
        "data_sources": {
            "table1": t1_source,
            "table2": t2_source,
            "topology": topo_source,
            "q1_sample_plan": q1_source,
            "point_estimate_sampler": sampler_pt.backend,
            "monte_carlo_sampler": sampler_mc.backend,
        },
        "sampling": {
            "sample_n": int(sample_n),
            "case95_critical": q1_c,
            "nominal_rate": _r(P_NOMINAL),
            "delta": _r(Q1_DELTA),
            "alpha_case1": _r(Q1_ALPHA1),
            "alpha_case2": _r(Q1_ALPHA2),
            "beta": _r(Q1_BETA),
            "ci_level": _r(Q4_CI_LEVEL),
            "note": "次品率均按同一抽样口径（问题 1 的最小样本量）独立估计；"
                    "点估计取样本频率，区间取 Clopper-Pearson 精确区间（ASM-16）。",
            "table1_cases": t1_point,
            "q3_nodes": {k: q3_point[k] for k in order},
        },
        "point_estimate": {
            "q2": pe_q2,
            "q3": {
                "decision": {k: list(sol_q3["decisions"][k]) for k in order},
                "decision_key": _dec_key(sol_q3["decisions"], nodes),
                "unit_cost": _r(sol_q3["unit_cost"]),
                "profit": _r(sol_q3["profit"]),
                "true_rate_decision_key": _dec_key(sol_q3_true["decisions"], nodes),
                "true_rate_profit": _r(sol_q3_true["profit"]),
            },
        },
        "ci_profit_curve": {
            "levels": _rl(grid),
            "q2_cases": range_q2,
            "q3": q3_curve,
            "q3_min": range_q3["min_profit"],
            "q3_max": range_q3["max_profit"],
            "note": "决策固定（取点估计最优决策）后，令 p 沿各自置信区间同步推进所得的利润曲线。",
        },
        "profit_range": {"q2": range_q2,
                         "q3": {"point_profit": range_q3["point_profit"],
                                "min_profit": range_q3["min_profit"],
                                "max_profit": range_q3["max_profit"],
                                "width": range_q3["width"],
                                "fixed_decision": range_q3["fixed_decision"]},
                         "definition": "利润区间 = 决策固定下 min/max_{p in CI} Pi(p)，不混入换方案的收益。"},
        "monte_carlo": monte_carlo,
        "decision_diff": diff_rows,
        "q3": {
            "node_cost": {k: {"U": _r(detail_q3[k]["U"]), "Q": _r(detail_q3[k]["Q"]),
                              "q": _r(detail_q3[k]["q"]), "Kf": _r(detail_q3[k]["Kf"]),
                              "Kr": _r(detail_q3[k]["Kr"]), "kappa": _r(detail_q3[k]["kappa"]),
                              "xi": _r(detail_q3[k]["xi"]), "z": detail_q3[k]["z"],
                              "d": detail_q3[k]["d"]}
                          for k in order},
            "node_cost_true_rates": {k: {"U": _r(detail_q3_true[k]["U"]),
                                         "Q": _r(detail_q3_true[k]["Q"])} for k in order},
            "topology": {name: topo[name] for name in sorted(topo.keys())},
        },
        "verification": verification,
        "consistency_note": (
            "一致率 rho 是离散决策的稳定性指标，不是分类精度：重抽样与点估计使用同一抽样口径、"
            "同一真实参数，样本量由问题 1 的两点设计给出（样本量越大、抽样误差越小、一致率越高）；"
            "本模块不存在训练/测试划分，因此不涉及泄漏。rho 接近 1 表示最优决策对抽样误差不敏感。"
        ),
    }
    return result


def _ci_monotone_check():
    """EQ-Q4-CI 端点随样本量单调：固定 p_hat 时 n 增大，区间宽度不增。"""
    widths = []
    for n in (10, 20, 50, 100, 200):
        x = int(round(P_NOMINAL * n))
        lo, hi = clopper_pearson(x, n)
        widths.append(hi - lo)
    ok = all(widths[i] >= widths[i + 1] - TOL for i in range(len(widths) - 1))
    return {"sample_sizes": [10, 20, 50, 100, 200], "widths": _rl(widths), "non_increasing": bool(ok)}


def _degradation_residual(case, tol):
    """V-08：把装配树退化成"两零配件 + 一成品"，节点级递推应逐项收敛到问题 2 的闭式。"""
    nodes = {
        "part1": {"key": "part1", "kind": "part", "p": case["p1"], "a": case["a1"],
                  "c": case["c1"], "A": 0.0, "t": 0.0, "l": 0.0, "children": []},
        "part2": {"key": "part2", "kind": "part", "p": case["p2"], "a": case["a2"],
                  "c": case["c2"], "A": 0.0, "t": 0.0, "l": 0.0, "children": []},
        "product": {"key": "product", "kind": "product", "p": case["p0"], "a": 0.0,
                    "c": case["c0"], "A": case["A"], "t": case["t"], "l": case["l"],
                    "children": ["part1", "part2"]},
    }
    order = _topo_order(nodes)
    worst = 0.0
    for z1 in (0, 1):
        for z2 in (0, 1):
            for cc in (0, 1):
                for dd in (0, 1):
                    dec = {"part1": (z1, 0), "part2": (z2, 0), "product": (cc, dd)}
                    u3 = _q3_root_u(nodes, order, dec, None, tol)
                    res2 = q2_evaluate(case, z1, z2, cc, dd, tol)
                    if u3 is None or res2 is None:
                        continue
                    worst = max(worst, abs(u3 - res2["u"]))
    return worst


def main(out_dir=None, **kwargs):
    """独立运行入口：把账本写到脚本所在目录（与 cwd 无关）。"""
    payload = run(out_dir=out_dir)
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "problem4_outputs.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print("[problem4] wrote %s" % path)
    return payload


if __name__ == "__main__":
    main()