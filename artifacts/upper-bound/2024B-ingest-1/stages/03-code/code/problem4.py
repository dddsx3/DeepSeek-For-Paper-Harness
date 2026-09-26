# -*- coding: utf-8 -*-
"""问题 4：次品率带抽样误差时的重解与稳健性（模型规格 MS-Q4）。

覆盖的模型式
------------
  EQ-Q4-CI            次品率的精确二项（Clopper-Pearson）置信区间。
                      实现方式：以二项尾概率对 p 反解（与 Beta 分位数表示等价），
                      不依赖 scipy，小样本与极端比例下均有效。
  EQ-Q4-PROFIT-RANGE  决策固定下、参数在置信区间内变动时的利润区间。
                      先固定决策，再让 p 在区间内取角点，取利润的最小与最大，
                      不把“换方案”的收益混进区间。
  EQ-Q4-ROBUST        重复抽样下最优决策组合的一致率 rho = 命中次数 / M。

抽样口径（题面要求次品率“均是通过抽样检测方法得到”，故必须显式声明）
----------------------------------------------------------------------
  * 每个次品率独立抽取一个样本量为 n 的简单随机样本，n 取问题 1 两点设计的
    最小检测次数（EQ-Q1-ACCEPT，接收侧 90% 信度）；problem1 可用时优先调用它。
  * 观测不合格数 x 后，点估计 p_hat = x / n（EQ-Q4-CI 的中心）。
  * 主口径（已在 RESULTS.md 与本文件中声明为理想化设定）：以题面给定次品率为
    总体真值，x 按 round(n * p_true) 生成，即 p_hat 恒等于真值；估计不确定度
    只在置信区间与蒙特卡洛重抽样中体现。
  * 对照口径：x 由 Binomial(n, p_true) 实际抽得，点估计本身带抽样误差，
    用于检查“点估计有偏”时的决策一致率（一致性率的对照列）。

本模块只算数：把要进论文与图表的量写进返回值，由 main.py 汇总写盘。
本文件不画图、不写图、不写任何图像字节。
所有常数与题面给定值从 params 读取；正文中出现的每一个数都必须来自
题面给定值或本文件的真跑结果。
"""

import math
import random
from itertools import product as _product

from params import *  # noqa: F401,F403

try:  # 只用其随机数与加速能力，取不到时退化为纯 Python 实现
    import numpy as _np
except Exception:  # pragma: no cover
    _np = None

try:  # 问题 1 的抽样设计（样本量口径的唯一来源）
    import problem1 as _p1
except Exception:  # pragma: no cover
    _p1 = None

try:  # 表 1 / 表 2 的备用数据源
    import problem2 as _p2
except Exception:  # pragma: no cover
    _p2 = None

try:
    import problem3 as _p3
except Exception:  # pragma: no cover
    _p3 = None


# ============================================================ 0. 常数读取
def _first(*names):
    """从本模块命名空间（即 params 的 import *）中按候选键名取常数。"""
    g = globals()
    for nm in names:
        if nm in g and g[nm] is not None:
            return g[nm]
    return None


def _or(value, fallback):
    return fallback if value is None else value


# 模型常数一律按键名读取；兜底值即 DECLARATION.json 的 model_constants 登记值。
TOL = float(_or(_first("TOL", "NUM_TOL", "TOLERANCE", "数值容差"), 1e-06))
Q4_REPS = int(_or(_first("Q4_REPS", "Q4_REP", "Q4重抽样次数"), 2000))
SEED = int(_or(_first("SEED", "RANDOM_SEED", "MC_SEED", "随机种子"), 202409))
CI_LEVEL = float(_or(_first("Q4_CI_LEVEL", "CI_LEVEL", "Q4置信区间置信水平"), 0.95))
CONS_THRESHOLD = float(_or(
    _first("CONSISTENCY_THRESHOLD", "DECISION_CONSISTENCY_THRESHOLD", "决策一致率判定阈值"), 0.95))
DELTA = float(_or(_first("DELTA", "DELTA_Q1", "Q1_DELTA", "Q1可识别超标幅度Δ"), 0.05))
ALPHA2 = float(_or(_first("ALPHA2", "Q1_ALPHA2", "Q1情形2显著性水平α2"), 0.10))
BETA = float(_or(_first("BETA", "Q1_BETA", "Q1功效约束β"), 0.10))
N_MAX = int(_or(_first("N_MAX", "Q1_N_MAX", "N_SEARCH_MAX", "Q1样本量搜索上界"), 1000))
GRID = int(_or(_first("GRID_POINTS", "BALANCE_GRID", "盈亏平衡等高线格点数"), 41))
Q3_N_NODES = int(_or(_first("Q3_N_NODES", "N_Q3_NODES", "问题3图1节点总数"), 12))
Q3_N_SEMI = int(_or(_first("Q3_N_SEMI", "N_Q3_SEMI", "问题3半成品数"), 3))
Q3_N_PART = Q3_N_NODES - Q3_N_SEMI - 1


# ============================================================ 1. 基础工具
_MISSING = object()


def _pick(d, *names, **kw):
    """从字典里按候选键名取值（兼容英文键、中文键与嵌套写法）。"""
    for nm in names:
        if isinstance(d, dict) and nm in d:
            return d[nm]
    if "default" in kw:
        return kw["default"]
    raise KeyError("字段缺失：%r" % (names,))


def _num(v):
    """把题面给定值（可能是 '10%' 这样的字符串）转成浮点数。"""
    if v is None:
        raise ValueError("空值无法转数")
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s.endswith("%"):
        return float(s[:-1]) / 100.0
    return float(s)


def _make_gen(stream):
    """由登记种子派生子随机流：主体用 numpy，退化用 random.Random。"""
    npg = None
    if _np is not None:
        try:
            npg = _np.random.default_rng([SEED, stream])
        except Exception:
            npg = None
    return (npg, random.Random(SEED + stream))


def _draw_binomial(n, p, count, gen):
    """由 Binomial(n, p) 抽 count 个样本。"""
    if p <= 0.0:
        return [0] * count
    if p >= 1.0:
        return [n] * count
    npg, rng = gen
    if npg is not None:
        return [int(v) for v in npg.binomial(n, p, size=count)]
    out = []
    for _ in range(count):
        u = rng.random()
        k = 0
        pmf = (1.0 - p) ** n
        cum = pmf
        while u > cum and k < n:
            k += 1
            pmf *= ((n - k + 1) / k) * (p / (1.0 - p))
            cum += pmf
        out.append(k)
    return out


# ============================================================ 2. 精确二项
def _log_comb(n, k):
    return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)


def _tail_ge(n, x, p):
    """P(X >= x)，X ~ Binomial(n, p)；线性域递推，本题 n 为 10^2 量级无下溢风险。"""
    if x <= 0:
        return 1.0
    if x > n:
        return 0.0
    if p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    pmf = (1.0 - p) ** n
    if pmf <= 0.0:
        lp = math.log(p)
        lq = math.log(1.0 - p)
        s = 0.0
        for i in range(x, n + 1):
            s += math.exp(_log_comb(n, i) + i * lp + (n - i) * lq)
        return min(1.0, max(0.0, s))
    ratio = p / (1.0 - p)
    cum = 0.0
    for i in range(0, n + 1):
        if i < x:
            cum += pmf
        if i < n:
            pmf *= ((n - i) / (i + 1)) * ratio
    return min(1.0, max(0.0, 1.0 - cum))


def _tail_le(n, x, p):
    """P(X <= x) = 1 - P(X >= x+1)。"""
    return 1.0 - _tail_ge(n, x + 1, p)


def _cp_interval(n, x, level, tol):
    """Clopper-Pearson 精确区间（EQ-Q4-CI），以二项尾概率反解。

    下界解 P(X >= x | p) = alpha/2（单调增，二分）；上界解 P(X <= x | p) = alpha/2
    （单调减，二分）。与 Beta 分位数表示 [Beta(a/2; x, n-x+1), Beta(1-a/2; x+1, n-x)]
    完全等价。
    """
    half = (1.0 - level) / 2.0
    if x <= 0:
        p_low = 0.0
    else:
        lo, hi = 0.0, float(x) / float(n)
        while hi - lo > tol:
            mid = (lo + hi) / 2.0
            if _tail_ge(n, x, mid) > half:
                hi = mid
            else:
                lo = mid
        p_low = (lo + hi) / 2.0
    if x >= n:
        p_high = 1.0
    else:
        lo, hi = float(x) / float(n), 1.0
        while hi - lo > tol:
            mid = (lo + hi) / 2.0
            if _tail_le(n, mid and x or x, mid) > half:
                lo = mid
            else:
                hi = mid
        p_high = (lo + hi) / 2.0
    return p_low, p_high


def _first_c_ge(n, p, target):
    """最小 c 使 P(X <= c | p) >= target。"""
    lo, hi = 0, n
    while lo < hi:
        mid = (lo + hi) // 2
        if _tail_le(n, mid, p) >= target:
            hi = mid
        else:
            lo = mid + 1
    return lo


def _last_c_le(n, p, target):
    """最大 c 使 P(X <= c | p) <= target；不存在时返回 -1。"""
    if _tail_le(n, 0, p) > target:
        return -1
    lo, hi = 0, n
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if _tail_le(n, mid, p) <= target:
            lo = mid
        else:
            hi = mid - 1
    return lo


# ============================================================ 3. 样本量口径
def _sample_size():
    """问题 4 的抽样样本量：取问题 1 两点设计（接收侧，EQ-Q1-ACCEPT）的最小 n。

    优先调用 problem1 的实现；取不到时按同一规划式在本地做精确搜索，
    搜索上界为登记的 Q1 样本量搜索上界。
    """
    p_nom = _first("P_NOMINAL", "NOMINAL", "标称次品率")
    p_nom = 0.10 if p_nom is None else _num(p_nom)  # 题面给定值：标称值 10%
    fn = None
    if _p1 is not None:
        for nm in ("q1_min_n", "min_n", "solve_min_n", "q1_search"):
            f = getattr(_p1, nm, None)
            if callable(f):
                fn = f
                break
    if fn is not None:
        try:
            r = fn(p_nom, DELTA, ALPHA2, BETA, N_MAX)
            if isinstance(r, (list, tuple)) and r:
                n = int(r[0])
            elif isinstance(r, dict):
                n = int(_pick(r, "n", "n_star", "sample_size"))
            else:
                n = int(r)
            if n > 0:
                return n
        except Exception:
            pass
    p_alt = p_nom + DELTA
    for n in range(1, N_MAX + 1):
        c_lo = _first_c_ge(n, p_nom, 1.0 - ALPHA2)
        c_hi = _last_c_le(n, p_alt, BETA)
        if c_lo <= c_hi:
            return n
    return N_MAX


def _estimate(n, p_true, mode):
    """按声明的抽样口径生成 (x, p_hat)。mode: 'ideal' | 'draw'。"""
    if mode == "ideal":
        x = int(round(n * p_true))
    else:
        x = int(_draw_binomial(n, p_true, 1, _make_gen(int(p_true * N_MAX) + 1))[0])
    x = min(n, max(0, x))
    return x, float(x) / float(n)


# ============================================================ 4. 问题 2 闭式
_Q2_RATE_KEYS = ("p1", "p2", "p0")


def _q2_norm_case(idx, c):
    n1 = None
    n2 = None
    fp = None
    for nm in ("零配件1", "part1", "component1", "part_1"):
        if isinstance(c, dict) and isinstance(c.get(nm), dict):
            n1 = c[nm]
            break
    for nm in ("零配件2", "part2", "component2", "part_2"):
        if isinstance(c, dict) and isinstance(c.get(nm), dict):
            n2 = c[nm]
            break
    for nm in ("成品", "product", "final", "finished"):
        if isinstance(c, dict) and isinstance(c.get(nm), dict):
            fp = c[nm]
            break

    def val(container, flat, *names):
        if container is not None:
            for nm in names:
                if nm in container:
                    return _num(container[nm])
        for nm in (flat,) + names:
            if isinstance(c, dict) and nm in c:
                return _num(c[nm])
        raise KeyError("问题2 情况 %s 无法定位字段 %s" % (idx, flat))

    return {
        "index": idx,
        "p1": val(n1, "p1", "p", "次品率", "defect_rate"),
        "a1": val(n1, "a1", "a", "购买单价", "unit_price", "price"),
        "c1": val(n1, "c1", "c", "检测成本", "inspect_cost"),
        "p2": val(n2, "p2", "p", "次品率", "defect_rate"),
        "a2": val(n2, "a2", "a", "购买单价", "unit_price", "price"),
        "c2": val(n2, "c2", "c", "检测成本", "inspect_cost"),
        "p0": val(fp, "p0", "p", "次品率", "defect_rate"),
        "A": val(fp, "A", "装配成本", "assembly_cost", "assemble_cost"),
        "c0": val(fp, "c0", "c", "检测成本", "inspect_cost"),
        "price": val(fp, "price", "s", "市场售价", "market_price"),
        "loss": val(fp, "loss", "l", "调换损失", "exchange_loss"),
        "dis": val(fp, "disassemble", "t", "拆解费用", "disassemble_cost"),
    }


def _q2_cases():
    raw = _first("TABLE1", "Q2_TABLE", "TABLE_1", "Q2_CASES", "CASES_Q2")
    if raw is None and _p2 is not None:
        for nm in ("TABLE1", "TABLE_1", "CASES"):
            v = getattr(_p2, nm, None)
            if v:
                raw = v
                break
    if raw is None:
        raise KeyError("未在 params / problem2 中找到表 1（TABLE1）")
    items = list(raw.values()) if isinstance(raw, dict) else list(raw)
    return [_q2_norm_case(i, c) for i, c in enumerate(items, start=1)]


def _q2_eval(case, z1, z2, cc, dd):
    """EQ-Q2-YIELD / EQ-KF / EQ-KR / EQ-Q2-RECUR / EQ-COST-Q2 的一次求值。

    返回 (U, 分项字典)。回收件免采购的收益只落在 K_r 一处，利润式中不再按
    退回件数抵扣任何采购价（ASM-12）。
    """
    p1 = case["p1"]
    p2 = case["p2"]
    p0 = case["p0"]
    a1 = case["a1"]
    a2 = case["a2"]
    c1 = case["c1"]
    c2 = case["c2"]
    A = case["A"]
    c0 = case["c0"]
    t = case["dis"]
    l = case["loss"]
    s = case["price"]

    Q1 = 1.0 - (1.0 - z1) * p1
    Q2 = 1.0 - (1.0 - z2) * p2
    q = (1.0 - p0) * Q1 * Q2

    buy1 = (a1 / (1.0 - p1)) if z1 else a1
    buy2 = (a2 / (1.0 - p2)) if z2 else a2
    ins1 = (c1 / (1.0 - p1)) if z1 else 0.0
    ins2 = (c2 / (1.0 - p2)) if z2 else 0.0
    kf = A + buy1 + ins1 + buy2 + ins2
    kr = A + (c1 if z1 else 0.0) + (c2 if z2 else 0.0)

    xi = dd * t + (1 - cc) * l
    den = 1.0 - dd * (1.0 - q)
    if den <= 0.0 or q <= 0.0:
        return float("inf"), {"q": q, "g": 0.0, "U": float("inf")}
    g = q / den
    R = (kr + cc * c0 + (1.0 - q) * xi) / den
    U = (kf + cc * c0 + (1.0 - q) * (xi + dd * R)) / g
    bd = {
        "q": q, "g": g, "Kf": kf, "Kr": kr, "R": R, "U": U, "Pi": s - U,
        "采购": (buy1 + buy2) / g,
        "检测": (ins1 + ins2 + cc * c0) / g,
        "装配": A / g,
        "拆解": (1.0 - q) * dd * (t + R) / g,
        "调换损失": (1.0 - q) * (1 - cc) * l / g,
    }
    return U, bd


def _q2_best(case):
    """16 组合全枚举（EQ-PROFIT-Q2），返回最优决策与逐组合对照表。"""
    table = []
    best = None
    for z1, z2, cc, dd in _product((0, 1), repeat=4):
        U, bd = _q2_eval(case, z1, z2, cc, dd)
        row = {"decision": [z1, z2, cc, dd], "U": U, "Pi": bd.get("Pi")}
        table.append(row)
        if best is None or row["Pi"] > best["Pi"]:
            best = row
    return {"best": best, "table": table}


def _q2_best_decision(case):
    best = None
    best_pi = None
    for z1, z2, cc, dd in _product((0, 1), repeat=4):
        _, bd = _q2_eval(case, z1, z2, cc, dd)
        pi = bd.get("Pi", float("-inf"))
        if best_pi is None or pi > best_pi:
            best_pi = pi
            best = (z1, z2, cc, dd)
    return best, best_pi


# ============================================================ 5. 问题 3 实例
def _q3_groups(n_semi, n_part):
    """装配树连接关系：优先用外部登记的拓扑，否则用 ASM-09 的显式假设。"""
    topo = _first("Q3_GROUPS", "Q3_TOPOLOGY", "SEMI_GROUPS", "ASM09_GROUPS")
    if isinstance(topo, dict) and topo:
        out = {}
        for k, v in topo.items():
            try:
                out[int(k)] = [int(x) for x in v]
            except Exception:
                continue
        if out:
            return out
    if n_semi == 3 and n_part == 8:
        return {1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8]}
    out = {}
    base = n_part // n_semi
    extra = n_part % n_semi
    start = 1
    for s in range(1, n_semi + 1):
        size = base + (1 if s <= extra else 0)
        out[s] = list(range(start, start + size))
        start += size
    return out


def _norm_q3_part(idx, d):
    return {
        "id": "P%d" % idx, "index": idx, "kind": "part",
        "p": _num(_pick(d, "p", "次品率", "defect_rate", "defect", "rate")),
        "a": _num(_pick(d, "a", "购买单价", "unit_price", "purchase_price", "price")),
        "c": _num(_pick(d, "c", "检测成本", "inspect_cost", "test_cost")),
        "A": 0.0, "t": 0.0, "l": 0.0, "children": [],
    }


def _norm_q3_assembly(idx, d, kind, children):
    node = {
        "id": ("S%d" % idx) if kind == "semi" else "F",
        "index": idx, "kind": kind,
        "p": _num(_pick(d, "p", "次品率", "defect_rate", "defect", "rate")),
        "A": _num(_pick(d, "A", "装配成本", "assembly_cost", "assemble_cost")),
        "c": _num(_pick(d, "c", "检测成本", "inspect_cost", "test_cost")),
        "t": _num(_pick(d, "t", "拆解费用", "disassemble_cost", "disassemble")),
        "a": 0.0, "l": 0.0, "children": list(children),
    }
    return node


def _q3_default_instance(n_part, n_semi):
    """兜底实例：数值逐字取自 PROBLEM_FACTS 的 F-T2-*（与表 2 一致）。"""
    part_rows = [
        {"p": "10%", "a": 2, "c": 1}, {"p": "10%", "a": 8, "c": 1},
        {"p": "10%", "a": 12, "c": 2}, {"p": "10%", "a": 2, "c": 1},
        {"p": "10%", "a": 8, "c": 1}, {"p": "10%", "a": 12, "c": 2},
        {"p": "10%", "a": 8, "c": 1}, {"p": "10%", "a": 12, "c": 2},
    ]
    semi_rows = [{"p": "10%", "A": 8, "c": 4, "t": 6} for _ in range(n_semi)]
    prod_row = {"p": "10%", "A": 8, "c": 6, "t": 10}
    return {
        "parts": part_rows[:n_part], "semis": semi_rows, "product": prod_row,
        "price": 200, "loss": 40,
    }


def _q3_normalize(raw):
    """把表 2 的容器归一化；识别不了时返回 None。"""
    if raw is None:
        return None
    parts = None
    semis = None
    prod = None
    price = None
    loss = None
    if isinstance(raw, dict):
        parts = _pick(raw, "parts", "零配件", "PARTS", "part_list", default=None)
        semis = _pick(raw, "semis", "半成品", "SEMIS", "semi_list", default=None)
        prod = _pick(raw, "product", "成品", "PRODUCT", "final", default=None)
        price = _pick(raw, "price", "市场售价", "market_price", "s", default=None)
        loss = _pick(raw, "loss", "调换损失", "exchange_loss", "l", default=None)
    elif isinstance(raw, (list, tuple)):
        items = list(raw)
        if len(items) >= Q3_N_NODES:
            parts, semis, prod = items[:Q3_N_PART], items[Q3_N_PART:Q3_N_PART + Q3_N_SEMI], items[Q3_N_PART + Q3_N_SEMI]
    if parts is None and semis is None and prod is None:
        return None
    if parts is None:
        parts = []
        for i in range(1, Q3_N_PART + 1):
            v = _first("T2_PART_%d" % i, "T2_PART%d" % i, "PART_%d" % i, "PART%d" % i)
            if v is None:
                parts = None
                break
            parts.append(v)
        if not parts:
            return None
    if semis is None:
        v = _first("T2_SEMI", "T2_SEMIS", "SEMI_LIST")
        semis = v if isinstance(v, (list, tuple)) else None
        if semis is None:
            return None
    if prod is None:
        prod = _first("T2_PRODUCT", "PRODUCT_Q3", "T2_FINAL")
        if prod is None:
            return None
    if price is None:
        price = _first("T2_PRICE", "PRICE_Q3", "MARKET_PRICE_Q3", "市场售价")
    if loss is None:
        loss = _first("T2_LOSS", "LOSS_Q3", "EXCHANGE_LOSS_Q3", "调换损失")
    if price is None:
        price = _pick(prod, "price", "s", "市场售价", "market_price", default=None)
    if loss is None:
        loss = _pick(prod, "loss", "l", "调换损失", "exchange_loss", default=None)
    if price is None or loss is None:
        return None
    return {"parts": list(parts), "semis": list(semis), "product": prod,
            "price": price, "loss": loss}


def _build_q3_instance():
    raw = _first("TABLE2", "Q3_TABLE", "TABLE_2", "Q3_INSTANCE", "INSTANCE_Q3")
    if raw is None and _p3 is not None:
        for nm in ("TABLE2", "TABLE_2", "INSTANCE"):
            v = getattr(_p3, nm, None)
            if v:
                raw = v
                break
    norm = _q3_normalize(raw)
    if norm is None:
        norm = _q3_default_instance(Q3_N_PART, Q3_N_SEMI)

    groups = _q3_groups(Q3_N_SEMI, Q3_N_PART)
    nodes = {}
    order = []
    for pi, d in enumerate(norm["parts"], start=1):
        node = _norm_q3_part(pi, d)
        nodes[node["id"]] = node
        order.append(node)
    for si, d in enumerate(norm["semis"], start=1):
        kids = ["P%d" % k for k in groups.get(si, [])]
        node = _norm_q3_assembly(si, d, "semi", kids)
        nodes[node["id"]] = node
        order.append(node)
    prodnode = _norm_q3_assembly(0, norm["product"], "product",
                                 ["S%d" % i for i in range(1, Q3_N_SEMI + 1)])
    prodnode["l"] = _num(norm["loss"])
    nodes[prodnode["id"]] = prodnode
    order.append(prodnode)
    return {
        "nodes": nodes, "order": order, "root": prodnode["id"],
        "price": _num(norm["price"]), "loss": _num(norm["loss"]),
        "n_nodes": len(order),
    }


# ============================================================ 6. 问题 3 递推
def _pareto(cands, tol=None):
    """(U, Q, Z) 三维支配剪枝：U 越小越好、Q 越大越好、Z 越小越好（父节点回收更便宜）。"""
    tol = TOL if tol is None else tol
    cands = sorted(cands, key=lambda o: (o[0], -o[1], o[2]))
    keep = []
    for o in cands:
        dominated = False
        for k in keep:
            if k[0] <= o[0] + tol and k[1] >= o[1] - tol and k[2] <= o[2]:
                dominated = True
                break
        if not dominated:
            keep.append(o)
    return keep


def _q3_option_sets(inst, p_of):
    """自底向上聚合：EQ-Q3-ASSY / EQ-Q3-NODE / EQ-Q3-KF / EQ-Q3-KAPPA /
    EQ-Q3-XI / EQ-Q3-RECUR / EQ-Q3-UNITCOST 的联合递推。

    option = (U, Q, Z, z, d, back)；back 为各子节点被选中的选项下标。
    成品节点（根）始终按摊销式计价——它没有上层来承担缺陷，调换损失必须在本节点
    内部化，这一点与问题 2 的 EQ-COST-Q2 逐字对齐。
    """
    nodes = inst["nodes"]
    opts = {}
    for node in inst["order"]:
        nid = node["id"]
        p = p_of.get(nid, node["p"])
        cands = []
        if node["kind"] == "part":
            for z in (0, 1):
                if z:
                    U = (node["a"] + node["c"]) / (1.0 - p) if p < 1.0 else float("inf")
                    Q = 1.0
                else:
                    U = node["a"]
                    Q = 1.0 - p
                cands.append((U, Q, z, z, 0, ()))
        else:
            child_ids = node["children"]
            child_sets = [opts[cid] for cid in child_ids]
            ranges = [range(len(s)) for s in child_sets]
            for z in (0, 1):
                for d in (0, 1):
                    for combo in _product(*ranges):
                        q = 1.0 - p
                        u_sum = 0.0
                        zc_sum = 0.0
                        for k, ci in enumerate(combo):
                            o = child_sets[k][ci]
                            q *= o[1]
                            u_sum += o[0]
                            zc_sum += o[2] * nodes[child_ids[k]]["c"]
                        kf = node["A"] + z * node["c"] + u_sum
                        kr = node["A"] + z * node["c"] + zc_sum
                        is_root = node["kind"] == "product"
                        h = 1 if (z == 1 or is_root) else 0
                        if is_root or z == 1:
                            xi = h * d * node["t"] + (1 - z) * node["l"]
                            den = 1.0 - h * d * (1.0 - q)
                            if den <= 0.0 or q <= 0.0:
                                continue
                            g = q / den
                            R = (kr + (1.0 - q) * xi) / den
                            U = (kf + (1.0 - q) * (xi + h * d * R)) / g
                        else:
                            # 不检测的非根节点：交付件等效成本即本轮成本，缺陷凭 Q_v 上递
                            U = kf
                        Qv = z + (1 - z) * q
                        cands.append((U, Qv, z, z, d, combo))
        opts[nid] = _pareto(cands)
    return opts


def _q3_config(inst, opts, idx):
    cfg = {}
    stack = [(inst["root"], idx)]
    while stack:
        nid, i = stack.pop()
        o = opts[nid][i]
        cfg[nid] = (o[3], o[4])
        for k, cid in enumerate(inst["nodes"][nid]["children"]):
            stack.append((cid, o[5][k]))
    return cfg


def _q3_solve(inst, p_of):
    opts = _q3_option_sets(inst, p_of)
    root = inst["root"]
    best_i = min(range(len(opts[root])), key=lambda i: opts[root][i][0])
    U = opts[root][best_i][0]
    return {"U": U, "Pi": inst["price"] - U, "cfg": _q3_config(inst, opts, best_i)}


def _q3_eval_config(inst, cfg, p_of):
    """决策固定下的一次前向求值（用于 EQ-Q4-PROFIT-RANGE，不重解最优决策）。"""
    nodes = inst["nodes"]
    val = {}
    for node in inst["order"]:
        nid = node["id"]
        p = p_of.get(nid, node["p"])
        z, d = cfg[nid]
        if node["kind"] == "part":
            if z:
                val[nid] = ((node["a"] + node["c"]) / (1.0 - p) if p < 1.0 else float("inf"), 1.0)
            else:
                val[nid] = (node["a"], 1.0 - p)
            continue
        q = 1.0 - p
        u_sum = 0.0
        zc_sum = 0.0
        for cid in node["children"]:
            Uu, Qu = val[cid]
            q *= Qu
            u_sum += Uu
            zc_sum += cfg[cid][0] * nodes[cid]["c"]
        kf = node["A"] + z * node["c"] + u_sum
        kr = node["A"] + z * node["c"] + zc_sum
        is_root = node["kind"] == "product"
        h = 1 if (z == 1 or is_root) else 0
        if is_root or z == 1:
            xi = h * d * node["t"] + (1 - z) * node["l"]
            den = 1.0 - h * d * (1.0 - q)
            if den <= 0.0 or q <= 0.0:
                return float("inf")
            g = q / den
            R = (kr + (1.0 - q) * xi) / den
            U = (kf + (1.0 - q) * (xi + h * d * R)) / g
        else:
            U = kf
        val[nid] = (U, z + (1 - z) * q)
    return val[inst["root"]][0]


def _cfg_key(inst, cfg):
    return tuple(cfg[nid] for nid in [n["id"] for n in inst["order"]])


# ============================================================ 7. 问题 4 主流程
def _sampling_spec(n_sample):
    return {
        "sample_size_n": n_sample,
        "design": "问题 1 的两点设计（EQ-Q1-ACCEPT，接收侧 90% 信度）",
        "p_nominal": 0.10,
        "p_alt": 0.10 + DELTA,
        "delta": DELTA,
        "alpha2": ALPHA2,
        "beta": BETA,
        "ci_level": CI_LEVEL,
        "estimator": "p_hat = x / n（样本频率）",
        "primary_mode": "ideal",
        "primary_note": "主口径：x = round(n * p_true)，即点估计 p_hat 恒等于题面给定次品率；"
                        "估计不确定度只在置信区间与蒙特卡洛重抽样中体现（理想化设定，已显式声明）",
        "control_mode": "draw",
        "control_note": "对照口径：x 由 Binomial(n, p_true) 实际抽得，点估计本身带抽样误差",
        "independent_per_rate": True,
    }


def _q2_part(cases, n_sample):
    gen_mc = _make_gen(1)
    gen_ctrl = _make_gen(3)
    per_case = []
    diff_rows = []
    for case in cases:
        idx = case["index"]
        rates = {"p1": case["p1"], "p2": case["p2"], "p0": case["p0"]}
        ci = {}
        for k in _Q2_RATE_KEYS:
            p = rates[k]
            x = int(round(n_sample * p))
            lo, hi = _cp_interval(n_sample, x, CI_LEVEL, TOL)
            ci[k] = {"n": n_sample, "x": x, "p_hat": float(x) / float(n_sample),
                     "low": lo, "high": hi}

        hat = dict(case)
        for k in _Q2_RATE_KEYS:
            hat[k] = ci[k]["p_hat"]
        point = _q2_best(hat)
        point_dec = tuple(point["best"]["decision"])
        point_pi = point["best"]["Pi"]

        # 固定决策下的利润区间（EQ-Q4-PROFIT-RANGE）：置信盒 2^3 个角点
        p_min = None
        p_max = None
        arg_min = None
        arg_max = None
        for combo in _product(*[(ci[k]["low"], ci[k]["high"]) for k in _Q2_RATE_KEYS]):
            c2 = dict(hat)
            for k, v in zip(_Q2_RATE_KEYS, combo):
                c2[k] = v
            _, bd = _q2_eval(c2, *point_dec)
            pi = bd.get("Pi", float("-inf"))
            if p_min is None or pi < p_min:
                p_min = pi
                arg_min = list(combo)
            if p_max is None or pi > p_max:
                p_max = pi
                arg_max = list(combo)

        # 蒙特卡洛：每轮对三个次品率独立重抽，再重解最优决策（EQ-Q4-ROBUST）
        draws = {k: _draw_binomial(n_sample, rates[k], Q4_REPS, gen_mc) for k in _Q2_RATE_KEYS}
        hit = 0
        hit_nodes = [0, 0, 0, 0]
        samples = []
        curve = []
        step = max(1, Q4_REPS // 100)
        for m in range(Q4_REPS):
            cm = dict(hat)
            for k in _Q2_RATE_KEYS:
                cm[k] = float(draws[k][m]) / float(n_sample)
            dec, _ = _q2_best_decision(cm)
            if dec == point_dec:
                hit += 1
            for j in range(4):
                if dec[j] == point_dec[j]:
                    hit_nodes[j] += 1
            if idx == 1:
                _, bd = _q2_eval(cm, *point_dec)
                samples.append(bd.get("Pi"))
            if (m + 1) % step == 0 or m == Q4_REPS - 1:
                curve.append({"m": m + 1, "rho": float(hit) / float(m + 1)})
        rho = float(hit) / float(Q4_REPS)

        # 对照口径：点估计本身由一次真实抽样给出，再围绕该估计重抽
        hat_drawn = dict(case)
        ctrl_draws = {}
        for k in _Q2_RATE_KEYS:
            xd = int(_draw_binomial(n_sample, rates[k], 1, gen_ctrl)[0])
            hat_drawn[k] = float(xd) / float(n_sample)
            ctrl_draws[k] = _draw_binomial(n_sample, hat_drawn[k], Q4_REPS, gen_ctrl)
        dec_drawn, _ = _q2_best_decision(hat_drawn)
        hit_d = 0
        for m in range(Q4_REPS):
            cm = dict(hat)
            for k in _Q2_RATE_KEYS:
                cm[k] = float(ctrl_draws[k][m]) / float(n_sample)
            if _q2_best_decision(cm)[0] == dec_drawn:
                hit_d += 1
        rho_drawn = float(hit_d) / float(Q4_REPS)

        per_case.append({
            "case": idx,
            "ci": ci,
            "point_decision": list(point_dec),
            "point_profit": point_pi,
            "profit_range": {
                "min": p_min, "max": p_max,
                "argmin_corner": arg_min, "argmax_corner": arg_max,
                "decision_fixed": list(point_dec),
                "note": "决策固定、参数取置信盒角点（EQ-Q4-PROFIT-RANGE）",
            },
            "consistency_rate": rho,
            "consistency_rate_drawn": rho_drawn,
            "node_match_rates": [float(h) / float(Q4_REPS) for h in hit_nodes],
            "mc_curve": curve,
            "mc_profit_samples": samples,
            "mc_profit_summary": _summary(samples),
            "table_16": point["table"],
        })
        diff_rows.append({
            "case": idx,
            "point_decision": list(point_dec),
            "drawn_decision": list(dec_drawn),
            "flip_rate": 1.0 - rho,
            "flip": bool(rho < 1.0),
            "drivers": ["p1", "p2", "p0 的抽样误差"],
            "pass_threshold": bool(rho >= CONS_THRESHOLD),
        })
    return {"cases": per_case, "decision_diff": diff_rows}


def _summary(xs):
    xs = [v for v in xs if v is not None and v == v]
    if not xs:
        return {"n": 0}
    n = len(xs)
    mean = sum(xs) / float(n)
    var = sum((v - mean) ** 2 for v in xs) / float(n)
    s = sorted(xs)
    def q(f):
        i = int(f * (n - 1))
        return s[i]
    return {"n": n, "mean": mean, "std": math.sqrt(var),
            "min": s[0], "max": s[-1],
            "q05": q(0.05), "q50": q(0.50), "q95": q(0.95)}


def _q3_part(inst, n_sample):
    gen_mc = _make_gen(2)
    ids = [n["id"] for n in inst["order"]]
    p_true = {nid: inst["nodes"][nid]["p"] for nid in ids}

    ci = {}
    for nid in ids:
        p = p_true[nid]
        x = int(round(n_sample * p))
        lo, hi = _cp_interval(n_sample, x, CI_LEVEL, TOL)
        ci[nid] = {"n": n_sample, "x": x, "p_hat": float(x) / float(n_sample),
                   "low": lo, "high": hi}

    hat = {nid: ci[nid]["p_hat"] for nid in ids}
    base = _q3_solve(inst, hat)
    base_key = _cfg_key(inst, base["cfg"])

    # 固定决策下的利润区间：参数取置信盒的 2^12 个角点，决策不重解
    lo_vec = [ci[nid]["low"] for nid in ids]
    hi_vec = [ci[nid]["high"] for nid in ids]
    pi_min = None
    pi_max = None
    arg_min = None
    arg_max = None
    for combo in _product(*[(lo_vec[i], hi_vec[i]) for i in range(len(ids))]):
        pv = {}
        for i, nid in enumerate(ids):
            pv[nid] = combo[i]
        U = _q3_eval_config(inst, base["cfg"], pv)
        pi = inst["price"] - U
        if pi_min is None or pi < pi_min:
            pi_min = pi
            arg_min = list(combo)
        if pi_max is None or pi > pi_max:
            pi_max = pi
            arg_max = list(combo)

    # 蒙特卡洛：逐节点独立重抽次品率，再重解（自底向上 DP）最优决策
    draws = {nid: _draw_binomial(n_sample, p_true[nid], Q4_REPS, gen_mc) for nid in ids}
    hit = 0
    node_hits = {nid: 0 for nid in ids}
    samples = []
    curve = []
    step = max(1, Q4_REPS // 100)
    for m in range(Q4_REPS):
        pm = {nid: float(draws[nid][m]) / float(n_sample) for nid in ids}
        sol = _q3_solve(inst, pm)
        if _cfg_key(inst, sol["cfg"]) == base_key:
            hit += 1
        for nid in ids:
            if sol["cfg"][nid] == base["cfg"][nid]:
                node_hits[nid] += 1
        samples.append(sol["Pi"])
        if (m + 1) % step == 0 or m == Q4_REPS - 1:
            curve.append({"m": m + 1, "rho": float(hit) / float(m + 1)})
    rho = float(hit) / float(Q4_REPS)

    diff_rows = []
    for nid in ids:
        z, d = base["cfg"][nid]
        diff_rows.append({
            "node": nid,
            "kind": inst["nodes"][nid]["kind"],
            "point_decision": [z, d],
            "node_match_rate": float(node_hits[nid]) / float(Q4_REPS),
            "flip_rate": 1.0 - float(node_hits[nid]) / float(Q4_REPS),
            "flip": bool(node_hits[nid] < Q4_REPS),
        })

    node_cost = {}
    for nid in ids:
        z, d = base["cfg"][nid]
        node_cost[nid] = {
            "kind": inst["nodes"][nid]["kind"],
            "p_hat": hat[nid],
            "Z": z, "D": d,
            "purchase": inst["nodes"][nid]["a"],
            "inspect": inst["nodes"][nid]["c"],
            "assembly": inst["nodes"][nid]["A"],
            "disassemble": inst["nodes"][nid]["t"],
        }

    return {
        "instance": {
            "nodes": ids,
            "groups": _q3_groups(Q3_N_SEMI, Q3_N_PART),
            "n_nodes": inst["n_nodes"],
            "price": inst["price"],
            "loss": inst["loss"],
        },
        "ci": ci,
        "point_decision": {nid: list(base["cfg"][nid]) for nid in ids},
        "point_profit": base["Pi"],
        "point_cost": base["U"],
        "profit_range": {
            "min": pi_min, "max": pi_max,
            "argmin_corner": arg_min, "argmax_corner": arg_max,
            "decision_fixed": {nid: list(base["cfg"][nid]) for nid in ids},
            "note": "决策固定、参数取置信盒角点（EQ-Q4-PROFIT-RANGE）",
        },
        "consistency_rate": rho,
        "mc_curve": curve,
        "mc_profit_samples": samples,
        "mc_profit_summary": _summary(samples),
        "decision_diff": diff_rows,
        "node_cost": node_cost,
    }


def _degenerate_check(cases):
    """V-08：把问题 3 的递推退化到“两零配件一成品”，应与问题 2 的闭式逐项一致。"""
    case = cases[0]
    inst = {
        "nodes": {}, "order": [], "root": "F",
        "price": case["price"], "loss": case["loss"], "n_nodes": 4,
    }
    p1 = _norm_q3_part(1, {"p": case["p1"], "a": case["a1"], "c": case["c1"]})
    p2 = _norm_q3_part(2, {"p": case["p2"], "a": case["a2"], "c": case["c2"]})
    prod = _norm_q3_assembly(0, {"p": case["p0"], "A": case["A"], "c": case["c0"],
                                 "t": case["dis"]}, "product", ["P1", "P2"])
    prod["l"] = case["loss"]
    for node in (p1, p2, prod):
        inst["nodes"][node["id"]] = node
        inst["order"].append(node)
    worst = 0.0
    p_of = {"P1": case["p1"], "P2": case["p2"], "F": case["p0"]}
    for z1, z2, cc, dd in _product((0, 1), repeat=4):
        sol = _q3_solve(inst, p_of)
        cfg = {"P1": (z1, 0), "P2": (z2, 0), "F": (cc, dd)}
        U3 = _q3_eval_config(inst, cfg, p_of)
        U2, _ = _q2_eval(case, z1, z2, cc, dd)
        worst = max(worst, abs(U3 - U2))
    return {"max_abs_residual": worst, "tolerance": TOL, "pass": bool(worst <= TOL)}


def _ci_effect_curves(cases, ci_by_case, inst, q3_ci, q3_cfg):
    """置信区间对期望利润的影响曲线（供 fig_q4_ci_effect_on_cost 使用）。

    x 轴为参数在置信区间内的取值，y 轴为：① 决策固定下的利润；② 该参数下重解后的最优利润。
    """
    out = {"q2": [], "q3": []}
    for case in cases:
        idx = case["index"]
        ci = ci_by_case[idx]
        hat = dict(case)
        for k in _Q2_RATE_KEYS:
            hat[k] = ci[k]["p_hat"]
        fixed_dec = tuple(_q2_best(hat)["best"]["decision"])
        for k in _Q2_RATE_KEYS:
            lo = ci[k]["low"]
            hi = ci[k]["high"]
            pts = []
            for i in range(GRID):
                lam = float(i) / float(GRID - 1) if GRID > 1 else 0.0
                pv = lo + (hi - lo) * lam
                c2 = dict(hat)
                c2[k] = pv
                _, bd = _q2_eval(c2, *fixed_dec)
                best_pi = _q2_best_decision(c2)[1]
                pts.append({"p": pv, "profit_fixed_decision": bd.get("Pi"),
                            "profit_reoptimized": best_pi})
            out["q2"].append({"case": idx, "rate": k, "points": pts})
    for nid in (inst["root"], "S1"):
        lo = q3_ci[nid]["low"]
        hi = q3_ci[nid]["high"]
        pts = []
        for i in range(GRID):
            lam = float(i) / float(GRID - 1) if GRID > 1 else 0.0
            pv = lo + (hi - lo) * lam
            p_of = {n["id"]: q3_ci[n["id"]]["p_hat"] for n in inst["order"]}
            p_of[nid] = pv
            U = _q3_eval_config(inst, q3_cfg, p_of)
            best_pi = _q3_solve(inst, p_of)["Pi"]
            pts.append({"p": pv, "profit_fixed_decision": inst["price"] - U,
                        "profit_reoptimized": best_pi})
        out["q3"].append({"node": nid, "points": pts})
    return out


# ============================================================ 8. 入口
def run(*args, **kwargs):
    """问题 4 的总入口：返回要进账本的全部量（由 main.py 汇总写盘）。"""
    out = {"problem": "Q4", "available": True}

    try:
        n_sample = _sample_size()
    except Exception as exc:  # pragma: no cover
        n_sample = N_MAX
        out["sample_size_error"] = repr(exc)
    out["sampling_spec"] = _sampling_spec(n_sample)

    try:
        cases = _q2_cases()
    except Exception as exc:
        cases = []
        out["q2_error"] = repr(exc)

    if cases:
        try:
            q2 = _q2_part(cases, n_sample)
            out["q2"] = q2
            out["ci_part1"] = {
                "context": "问题 2 表 1 情况 1 的零配件 1 次品率",
                "level": CI_LEVEL,
                "n": q2["cases"][0]["ci"]["p1"]["n"],
                "x": q2["cases"][0]["ci"]["p1"]["x"],
                "p_hat": q2["cases"][0]["ci"]["p1"]["p_hat"],
                "low": q2["cases"][0]["ci"]["p1"]["low"],
                "high": q2["cases"][0]["ci"]["p1"]["high"],
            }
            out["profit_range"] = {"q2": [c["profit_range"] for c in q2["cases"]]}
            out["consistency_rate"] = {
                "q2": [{"case": c["case"],
                        "ideal_center": c["consistency_rate"],
                        "drawn_center": c["consistency_rate_drawn"]}
                       for c in q2["cases"]],
                "threshold": CONS_THRESHOLD,
                "q2_min_ideal": min(c["consistency_rate"] for c in q2["cases"]),
                "q2_min_drawn": min(c["consistency_rate_drawn"] for c in q2["cases"]),
            }
            out["decision_diff"] = {"q2": q2["decision_diff"]}
            out["checks"] = {"degenerate_q3_to_q2": _degenerate_check(cases)}
        except Exception as exc:
            out["q2"] = {"available": False, "error": repr(exc)}

    try:
        inst = _build_q3_instance()
        q3 = _q3_part(inst, n_sample)
        out["q3"] = q3
        out["ci_problem3_part1"] = {
            "context": "问题 3 表 2 零配件 1 的次品率",
            "level": CI_LEVEL,
            "node": "P1",
            "n": q3["ci"]["P1"]["n"],
            "x": q3["ci"]["P1"]["x"],
            "p_hat": q3["ci"]["P1"]["p_hat"],
            "low": q3["ci"]["P1"]["low"],
            "high": q3["ci"]["P1"]["high"],
        }
        if "profit_range" in out:
            out["profit_range"]["q3"] = q3["profit_range"]
        if "consistency_rate" in out:
            out["consistency_rate"]["q3"] = {
                "ideal_center": q3["consistency_rate"],
                "threshold": CONS_THRESHOLD,
                "pass": bool(q3["consistency_rate"] >= CONS_THRESHOLD),
            }
        if "decision_diff" in out:
            out["decision_diff"]["q3"] = q3["decision_diff"]
        if cases:
            out["ci_effect_curves"] = _ci_effect_curves(
                cases,
                {c["index"]: c["ci"] for c in out.get("q2", {}).get("cases", [])} if out.get("q2", {}).get("cases") else {},
                inst, q3["ci"], q3["point_decision"] and
                {nid: tuple(v) for nid, v in q3["point_decision"].items()})
    except Exception as exc:
        out["q3"] = {"available": False, "error": repr(exc)}

    return out


if __name__ == "__main__":  # pragma: no cover
    _r = run()
    print("problem4 ok:", sorted(_r.keys()))