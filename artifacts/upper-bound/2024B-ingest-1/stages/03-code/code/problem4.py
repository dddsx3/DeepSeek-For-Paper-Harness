```python
"""问题 4：次品率带抽样误差时重做问题 2 与问题 3，并量化决策翻转风险。

建模口径逐条对齐 02-modeling 的 EQ-Q4-CI / EQ-Q4-PROFIT-RANGE / EQ-Q4-ROBUST：

* 点估计 = 样本频率 p_hat = x / n（SYM-phat）；
* 区间 = Clopper-Pearson 精确二项区间 [Beta(a/2; x, n-x+1), Beta(1-a/2; x+1, n-x)]（EQ-Q4-CI）；
* 利润区间在“决策固定”下传播，只让 p 在区间内变动、不换方案（EQ-Q4-PROFIT-RANGE）；
* 一致率 rho = 重抽样下最优决策组合与点估计决策重合的比例（EQ-Q4-ROBUST）。

数据纪律
--------
* 表 1 / 表 2 的题面给定值一律按事实 id（F-T1-C1…、F-T2-*）从 params.py 读取，
  函数体内不转录任何题面数值；
* 模型常数与实现参数按键名从 constants.py 读取，函数体内不写字面量阈值；
* 本模块只返回可序列化字典（由 main.py 汇总写 JSON），
  不产生任何图像字节，也不写图表的 data_refs/caption（那是阶段 5 的产物）。

抽样口径
--------
每个待估次品率独立来自一次固定样本量 n 的简单随机抽样，抽到的不合格数
x ~ Bin(n, p_true)；点估计取 p_hat = x / n；区间取 Clopper-Pearson 精确区间。
重抽样时以点估计 p_hat 为真值生成新样本 x' ~ Bin(n, p_hat)，再重解最优决策。
问题 2 与问题 3 各自使用登记种子的独立随机子流，保证可复现。
"""

from __future__ import annotations

import itertools
import math

import numpy as np

from params import *  # noqa: F401,F403  —— 题面给定值展开，白名单外由 constants 兜底
import constants as _C
import params as _P

__all__ = ["run"]


# ---------------------------------------------------------------------------
# 0. 常数读取：模型常数与实现参数一律按键名取
# ---------------------------------------------------------------------------

IMPLEMENTATION_PARAMS = getattr(_C, "IMPLEMENTATION_PARAMS", {})
MODEL_CONSTANTS = getattr(_C, "MODEL_CONSTANTS", {})

_MISSING = object()

TOLERANCE = 1.0e-06  # 兜底容差；优先取登记值“数值容差”
_PCT = 100.0  # 题面比率以百分数书写，换算为无量纲比率


def _setting(name, default=_MISSING):
    """按 IMPLEMENTATION_PARAMS -> MODEL_CONSTANTS 顺序取键名对应的设置。"""
    for pool in (IMPLEMENTATION_PARAMS, MODEL_CONSTANTS):
        if isinstance(pool, dict) and name in pool:
            return pool[name]
    if default is not _MISSING:
        return default
    raise KeyError("缺少登记常数：%s" % name)


def _setting_any(names, default=_MISSING):
    for name in names:
        try:
            return _setting(name)
        except KeyError:
            continue
    if default is not _MISSING:
        return default
    raise KeyError("缺少登记常数：%s" % "/".join(names))


TOLERANCE = float(_setting_any(["数值容差", "tolerance", "numeric_tolerance"], TOLERANCE))


# ---------------------------------------------------------------------------
# 1. 题面给定值访问（params.py 的 FACT 通道，次通道为 constants 的结构化表）
# ---------------------------------------------------------------------------


def _fact(fid):
    """按事实 id 取题面给定值条目（F-T1-C1、F-T2-PART-3 之类）。"""
    key = str(fid).replace("-", "_").upper()

    facts_map = getattr(_P, "FACTS", None)
    if isinstance(facts_map, dict):
        for k, v in facts_map.items():
            if str(k).replace("-", "_").upper() == key:
                return v
        for v in facts_map.values():
            if isinstance(v, dict) and str(v.get("id", "")).replace("-", "_").upper() == key:
                return v

    pool = {k.upper(): k for k in dir(_P) if not k.startswith("_")}
    for cand in ("FACT_" + key, key):
        if cand in pool:
            return getattr(_P, pool[cand])
    for k, orig in pool.items():
        if key in k:
            return getattr(_P, orig)
    raise AttributeError("params 中找不到题面给定值条目：%s" % fid)


def _fact_value(entry):
    if isinstance(entry, dict) and "value" in entry:
        return entry["value"]
    return entry


def _pick(mapping, *names):
    for name in names:
        if isinstance(mapping, dict) and name in mapping:
            return mapping[name]
    raise KeyError("字段缺失：%s" % "/".join(names))


def _ratio(value):
    """把题面写法的次品率（'10%' 或 0.1 或 10）统一换算为无量纲比率。"""
    if isinstance(value, (int, float)):
        v = float(value)
        return v / _PCT if v > 1.0 else v
    text = str(value).strip()
    if text.endswith("%"):
        return float(text[:-1]) / _PCT
    v = float(text)
    return v / _PCT if v > 1.0 else v


# ---------------------------------------------------------------------------
# 2. 精确二项分布工具（scipy 可用则用 scipy，否则用自带的连分数实现）
# ---------------------------------------------------------------------------

try:  # pragma: no cover - 取决于运行环境
    from scipy.stats import beta as _SCIPY_BETA
except Exception:  # pragma: no cover
    _SCIPY_BETA = None


def _betacf(a, b, x):
    """不完全 Beta 函数的连分数展开（Lentz 算法）。"""
    tiny = 1.0e-30
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1.0 / d
    h = d
    for m in range(1, 201):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 3.0e-12:
            break
    return h


def _betainc(a, b, x):
    """正则化不完全 Beta 函数 I_x(a, b)。"""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    front = math.exp(lbeta + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def _beta_ppf_bisect(qv, a, b):
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if _betainc(a, b, mid) < qv:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def _beta_ppf(qv, a, b):
    if _SCIPY_BETA is not None:
        return float(_SCIPY_BETA.ppf(qv, a, b))
    return _beta_ppf_bisect(qv, a, b)


def _clopper_pearson(x, n, level):
    """EQ-Q4-CI：次品率的精确二项置信区间。"""
    x = int(x)
    n = int(n)
    if n <= 0:
        raise ValueError("样本量必须为正")
    if x < 0:
        x = 0
    if x > n:
        x = n
    alpha = 1.0 - float(level)
    low = 0.0 if x <= 0 else _beta_ppf(alpha / 2.0, x, n - x + 1)
    high = 1.0 if x >= n else _beta_ppf(1.0 - alpha / 2.0, x + 1, n - x)
    if high < low:
        low, high = high, low
    return low, high


# ---------------------------------------------------------------------------
# 3. 问题 2 闭式（EQ-Q2-YIELD / EQ-KF / EQ-KR / EQ-Q2-RECUR / EQ-COST-Q2）
# ---------------------------------------------------------------------------


def _q2_case(idx):
    """返回表 1 第 idx 种情况的参数（题面给定值逐条从 FACT 读取）。"""
    val = _fact_value(_fact("F-T1-C%d" % idx))
    part1 = _pick(val, "零配件1", "part1")
    part2 = _pick(val, "零配件2", "part2")
    prod = _pick(val, "成品", "product")
    return {
        "case": int(idx),
        "p1": _ratio(_pick(part1, "次品率", "defect_rate")),
        "a1": float(_pick(part1, "购买单价", "buy_price")),
        "c1": float(_pick(part1, "检测成本", "inspect_cost")),
        "p2": _ratio(_pick(part2, "次品率")),
        "a2": float(_pick(part2, "购买单价")),
        "c2": float(_pick(part2, "检测成本")),
        "p0": _ratio(_pick(prod, "次品率")),
        "A": float(_pick(prod, "装配成本", "assy_cost")),
        "c0": float(_pick(prod, "检测成本")),
        "s": float(_pick(val, "市场售价", "price")),
        "l": float(_pick(val, "调换损失", "exchange_loss")),
        "t": float(_pick(val, "拆解费用", "disassemble_cost")),
    }


def _q2_profit(par, decision):
    """给定参数与四元决策，返回期望利润与分项成本；不可行返回 None。"""
    z1, z2, c_dec, d_dec = (int(v) for v in decision)
    p1, p2, p0 = float(par["p1"]), float(par["p2"]), float(par["p0"])
    a1, a2 = float(par["a1"]), float(par["a2"])
    c1, c2, c0 = float(par["c1"]), float(par["c2"]), float(par["c0"])
    A, t, l, s = float(par["A"]), float(par["t"]), float(par["l"]), float(par["s"])

    if min(p1, p2, p0) < 0.0 or max(p1, p2, p0) > 1.0:
        return None
    if z1 and 1.0 - p1 <= TOLERANCE:
        return None
    if z2 and 1.0 - p2 <= TOLERANCE:
        return None

    q1 = 1.0 - (1 - z1) * p1
    q2 = 1.0 - (1 - z2) * p2
    q = (1.0 - p0) * q1 * q2

    # EQ-KF：检测分支按 1/(1-p_i) 的采购倍数放大
    buy1 = z1 * (a1 + c1) / (1.0 - p1) + (1 - z1) * a1
    buy2 = z2 * (a2 + c2) / (1.0 - p2) + (1 - z2) * a2
    kf = A + buy1 + buy2
    # EQ-KR：回收件免采购、仍付再检测费（免采购收益只记于此，不再在利润式中抵扣）
    kr = A + z1 * c1 + z2 * c2

    denom = 1.0 - d_dec * (1.0 - q)
    if denom <= TOLERANCE:
        return None
    g = q / denom
    if g <= TOLERANCE:
        return None

    xi = d_dec * t + (1 - c_dec) * l  # 次品处置：拆解费 + 不检测成品时的调换损失
    r_chain = (kr + c_dec * c0 + (1.0 - q) * xi) / denom
    u = (kf + c_dec * c0 + (1.0 - q) * (xi + d_dec * r_chain)) / g

    return {
        "profit": s - u,
        "U": u,
        "q": q,
        "g": g,
        "Kf": kf,
        "Kr": kr,
        "R": r_chain,
        "components": {
            "purchase": z1 * a1 / (1.0 - p1) + (1 - z1) * a1 + z2 * a2 / (1.0 - p2) + (1 - z2) * a2,
            "inspect_part": z1 * c1 / (1.0 - p1) + z2 * c2 / (1.0 - p2),
            "inspect_product": c_dec * c0,
            "assemble": A,
            "disassemble": d_dec * t,
            "exchange_loss": (1 - c_dec) * l,
        },
    }


def _q2_solve(par):
    """16 种 (Z1,Z2,C,D) 组合全枚举，取期望利润最大者。"""
    best = None
    best_profit = None
    for dec in itertools.product((0, 1), repeat=4):
        res = _q2_profit(par, dec)
        if res is None:
            continue
        if best_profit is None or res["profit"] > best_profit + TOLERANCE:
            best_profit = res["profit"]
            best = {"decision": [int(v) for v in dec], "profit": res["profit"], "U": res["U"]}
    return {"best": best}


# ---------------------------------------------------------------------------
# 4. 问题 3 节点级模型（EQ-Q3-ASSY / NODE / KF / KAPPA / XI / RECUR / UNITCOST）
# ---------------------------------------------------------------------------

# ASM-09：图 1 原件未随阶段简报下传，连接关系按表 2 行分组读出的常量级假设。
# 该假设的依赖由问题 3 的拓扑扰动扫描量化；本模块沿用同一拓扑。
_SEMI_GROUPS = ((1, 2, 3), (4, 5, 6), (7, 8))

_Q3_CACHE = {}


def _q3_base():
    """构建并缓存问题 3 实例的节点表（表 2 数值逐条从 FACT 读取）。"""
    if _Q3_CACHE:
        return _Q3_CACHE["nodes"], _Q3_CACHE["price"]

    parts = []
    idx = 1
    while True:
        try:
            val = _fact_value(_fact("F-T2-PART-%d" % idx))
        except AttributeError:
            break
        parts.append(
            {
                "id": idx,
                "p": _ratio(_pick(val, "次品率")),
                "a": float(_pick(val, "购买单价")),
                "c": float(_pick(val, "检测成本")),
            }
        )
        idx += 1

    semi_val = _fact_value(_fact("F-T2-SEMI"))
    semi_list = [semi_val] if isinstance(semi_val, dict) else list(semi_val)

    prod = _fact_value(_fact("F-T2-PRODUCT"))
    price = _fact_value(_fact("F-T2-PRICE"))

    valid_ids = [part["id"] for part in parts]
    groups = []
    seen = set()
    for group in _SEMI_GROUPS:
        kept = [i for i in group if i in valid_ids]
        if kept:
            groups.append(kept)
        seen.update(kept)
    rest = [i for i in valid_ids if i not in seen]
    if rest:
        groups.append(rest)

    nodes = {}
    for part in parts:
        nodes["P%d" % part["id"]] = {
            "kind": "part",
            "p": part["p"],
            "a": part["a"],
            "c": part["c"],
            "A": 0.0,
            "t": 0.0,
            "l": 0.0,
            "children": [],
        }
    for j, semi in enumerate(semi_list, start=1):
        group = groups[j - 1] if j - 1 < len(groups) else []
        nodes["S%d" % j] = {
            "kind": "semi",
            "p": _ratio(_pick(semi, "次品率")),
            "a": 0.0,
            "c": float(_pick(semi, "检测成本")),
            "A": float(_pick(semi, "装配成本")),
            "t": float(_pick(semi, "拆解费用")),
            "l": 0.0,
            "children": ["P%d" % i for i in group],
        }
    nodes["F"] = {
        "kind": "product",
        "p": _ratio(_pick(prod, "次品率")),
        "a": 0.0,
        "c": float(_pick(prod, "检测成本")),
        "A": float(_pick(prod, "装配成本")),
        "t": float(_pick(prod, "拆解费用")),
        "l": float(_pick(price, "调换损失")),
        "s": float(_pick(price, "市场售价")),
        "children": ["S%d" % j for j in range(1, len(semi_list) + 1)],
    }

    _Q3_CACHE["nodes"] = nodes
    _Q3_CACHE["price"] = price
    return nodes, price


def _pareto(cands):
    """保留 (U 越小越好, Q 越大越好) 的非支配候选；按 U 升序扫描即可。"""
    ordered = sorted(cands, key=lambda c: (c["U"], -c["Q"]))
    kept = []
    best_q = -float("inf")
    for cand in ordered:
        if cand["Q"] > best_q + TOLERANCE:
            kept.append(cand)
            best_q = cand["Q"]
    return kept


def _leaf_candidates(node):
    """零配件节点：Z=1 全检（交付必合格、按采购倍数计价），Z=0 不检（缺陷上递）。"""
    p, a, c = float(node["p"]), float(node["a"]), float(node["c"])
    out = []
    if 1.0 - p > TOLERANCE:
        out.append(
            {
                "U": (a + c) / (1.0 - p),
                "Q": 1.0,
                "Z": 1,
                "D": 0,
                "recost": c,
                "dec": {node["name"]: [1, 0]},
            }
        )
    out.append(
        {
            "U": a,
            "Q": 1.0 - p,
            "Z": 0,
            "D": 0,
            "recost": 0.0,
            "dec": {node["name"]: [0, 0]},
        }
    )
    return out


def _internal_candidates(node, child_lists):
    """半成品 / 成品节点：枚举 (Z_v, D_v)，按 EQ-Q3-* 逐式求 U_v 与 Q_v。"""
    p = float(node["p"])
    A = float(node["A"])
    c = float(node["c"])
    t = float(node["t"])
    l = float(node["l"])
    is_product = node["kind"] == "product"
    name = node["name"]

    out = []
    for combo in itertools.product(*child_lists):
        sum_u = sum(ch["U"] for ch in combo)
        sum_recost = sum(ch["recost"] for ch in combo)
        prod_q = 1.0
        for ch in combo:
            prod_q *= ch["Q"]
        q = (1.0 - p) * prod_q

        merged = {}
        for ch in combo:
            merged.update(ch["dec"])

        for z in (0, 1):
            qv = 1.0 if z else q
            kf = A + z * c + sum_u
            kappa = sum_u - sum_recost
            kr = kf - kappa
            h = 1 if (z or is_product) else 0
            d_values = (0, 1) if h == 1 else (0,)
            for d in d_values:
                xi = h * d * t + (1 - z) * l
                if h == 0:
                    # Z_v = 0 且非成品：交付件等效成本就是这一轮成本，缺陷由上一层承担
                    u = kf
                else:
                    denom = 1.0 - h * d * (1.0 - q)
                    if denom <= TOLERANCE:
                        continue
                    g = q / denom
                    if g <= TOLERANCE:
                        continue
                    r_chain = (kr + (1.0 - q) * xi) / denom
                    u = (kf + (1.0 - q) * (xi + h * d * r_chain)) / g
                dec = dict(merged)
                dec[name] = [z, d]
                out.append(
                    {
                        "U": u,
                        "Q": qv,
                        "Z": z,
                        "D": d,
                        "recost": z * c,
                        "dec": dec,
                    }
                )
    return out


def _solve_tree(nodes, root):
    """自底向上聚合：子节点候选 -> 父节点候选，逐层 Pareto 剪枝。"""
    memo = {}

    def rec(name):
        if name in memo:
            return memo[name]
        node = dict(nodes[name])
        node["name"] = name
        if not node["children"]:
            cands = _leaf_candidates(node)
        else:
            child_lists = [rec(ch) for ch in node["children"]]
            cands = _internal_candidates(node, child_lists)
        cands = _pareto(cands)
        if not cands:
            raise RuntimeError("节点 %s 无可行候选" % name)
        memo[name] = cands
        return cands

    root_cands = sorted(rec(root), key=lambda c: c["U"])
    return {"best": root_cands[0], "candidates": root_cands}


def _q3_solve(p_overrides=None):
    """问题 3 实例的点估计最优决策与期望利润。"""
    base_nodes, _price = _q3_base()
    nodes = {name: dict(node) for name, node in base_nodes.items()}
    if p_overrides:
        for name, pv in p_overrides.items():
            if name in nodes:
                nodes[name]["p"] = float(pv)
    res = _solve_tree(nodes, "F")
    best = res["best"]
    return {
        "profit": float(nodes["F"]["s"]) - best["U"],
        "U": best["U"],
        "decision": {k: list(v) for k, v in best["dec"].items()},
    }


def _q3_eval_fixed(nodes, decision):
    """决策固定下自底向上算 U_f（用于 EQ-Q4-PROFIT-RANGE 的传播）。"""
    memo = {}

    def rec(name):
        if name in memo:
            return memo[name]
        node = nodes[name]
        z, d = decision[name]
        z = int(z)
        d = int(d)
        p = float(node["p"])
        c = float(node["c"])
        t = float(node["t"])
        l = float(node["l"])
        A = float(node["A"])
        is_product = node["kind"] == "product"

        if not node["children"]:
            if z:
                if 1.0 - p <= TOLERANCE:
                    memo[name] = (float("inf"), 1.0)
                else:
                    memo[name] = ((float(node["a"]) + c) / (1.0 - p), 1.0)
            else:
                memo[name] = (float(node["a"]), 1.0 - p)
            return memo[name]

        child = [rec(ch) for ch in node["children"]]
        sum_u = sum(cu for cu, _ in child)
        prod_q = 1.0
        for _, cq in child:
            prod_q *= cq
        q = (1.0 - p) * prod_q
        qv = 1.0 if z else q

        kf = A + z * c + sum_u
        sum_recost = 0.0
        for ch_name in node["children"]:
            cz = int(decision[ch_name][0])
            sum_recost += cz * float(nodes[ch_name]["c"])
        kr = kf - (sum_u - sum_recost)

        h = 1 if (z or is_product) else 0
        if h == 0:
            memo[name] = (kf, qv)
        else:
            xi = h * d * t + (1 - z) * l
            denom = 1.0 - h * d * (1.0 - q)
            if denom <= TOLERANCE:
                memo[name] = (float("inf"), qv)
            else:
                g = q / denom
                if g <= TOLERANCE:
                    memo[name] = (float("inf"), qv)
                else:
                    r_chain = (kr + (1.0 - q) * xi) / denom
                    memo[name] = ((kf + (1.0 - q) * (xi + h * d * r_chain)) / g, qv)
        return memo[name]

    u_root, _ = rec("F")
    return u_root


def _q3_profit_fixed(p_overrides, decision):
    base_nodes, _price = _q3_base()
    nodes = {name: dict(node) for name, node in base_nodes.items()}
    if p_overrides:
        for name, pv in p_overrides.items():
            if name in nodes:
                nodes[name]["p"] = float(pv)
    u = _q3_eval_fixed(nodes, decision)
    if not math.isfinite(u):
        return None
    return float(nodes["F"]["s"]) - u


# ---------------------------------------------------------------------------
# 5. 问题 4 主流程
# ---------------------------------------------------------------------------


def _x_offset_contrast(par, n_sample, base_decision):
    """审计整改项：补一组 x 偏离标称值（±1 个次品）的对照结果。

    原实现取 x = round(n * 标称值) 使 p_hat 恰等于标称值，点估计决策与问题 2/3 完全重合；
    这里额外给出 x-1 与 x+1 两档，证明结论不是由 x 取整方式人为对齐造成的。
    """
    out = {}
    for tag, delta in (("x_minus", -1), ("x_base", 0), ("x_plus", 1)):
        xs = {}
        for key in ("p1", "p2", "p0"):
            x0 = int(round(float(par[key]) * n_sample))
            xs[key] = min(max(x0 + delta, 0), n_sample)
        par2 = dict(par)
        for key, x in xs.items():
            par2[key] = x / n_sample
        res = _q2_solve(par2)
        best = res["best"]
        out[tag] = {
            "x": dict(xs),
            "p_hat": {k: xs[k] / n_sample for k in xs},
            "decision": None if best is None else best["decision"],
            "profit": None if best is None else best["profit"],
            "flipped_vs_base": None if best is None else (best["decision"] != base_decision),
        }
    return out


def run(seed=None):
    """执行问题 4：点估计重解 + 区间传播 + 蒙特卡洛一致率 + 差异表。"""
    n_sample = int(_setting_any(["q4_sample_size", "Q4样本量"], 100))
    level = float(_setting_any(["Q4置信区间置信水平", "q4_confidence_level"], 0.95))
    base_seed = int(_setting_any(["随机种子", "seed"], 202409))
    m_resample = int(_setting_any(["Q4重抽样次数", "q4_resample"], 2000))
    m_tree = int(_setting_any(["q4_resample_tree", "Q4问题3重抽样次数"], max(1, m_resample // 2)))
    rho_threshold = float(_setting_any(["决策一致率判定阈值", "q4_consistency_threshold"], 0.95))
    curve_points = int(_setting_any(["q4_profit_curve_points"], 11))
    sample_points = int(_setting_any(["q4_mc_sample_points"], 200))
    if seed is not None:
        base_seed = int(seed)

    rng_q2 = np.random.default_rng([base_seed, 2])
    rng_q3 = np.random.default_rng([base_seed, 3])
    rng_x = np.random.default_rng([base_seed, 4])

    ci_block = {}
    point_block = {}
    range_block = {}
    mc_block = {}
    diff_block = {}
    xoff_block = {}

    # ---------------- 问题 2：表 1 六种情况 ----------------
    cases = []
    idx = 1
    while True:
        try:
            cases.append(_q2_case(idx))
        except (AttributeError, KeyError, TypeError):
            break
        idx += 1

    step = max(1, m_resample // sample_points)

    for par in cases:
        cid = "case%d" % par["case"]
        p_hat = {"p1": par["p1"], "p2": par["p2"], "p0": par["p0"]}

        x_map = {}
        ci_map = {}
        for key in ("p1", "p2", "p0"):
            x = min(max(int(round(float(p_hat[key]) * n_sample)), 0), n_sample)
            low, high = _clopper_pearson(x, n_sample, level)
            x_map[key] = x
            ci_map[key] = {"p_hat": float(p_hat[key]), "x": x, "n": n_sample, "low": low, "high": high}
        ci_block[cid] = ci_map

        solved = _q2_solve(par)
        best = solved["best"]
        if best is None:
            point_block[cid] = {"decision": None, "profit": None, "U": None}
            continue
        base_decision = best["decision"]
        point_block[cid] = {"decision": base_decision, "profit": best["profit"], "U": best["U"]}

        # 利润区间：决策固定，p 在各自置信区间内变动（EQ-Q4-PROFIT-RANGE）
        axes = []
        for key in ("p1", "p2", "p0"):
            axes.append(sorted({ci_map[key]["low"], ci_map[key]["p_hat"], ci_map[key]["high"]}))
        grid = []
        for p1, p2, p0 in itertools.product(*axes):
            par2 = dict(par)
            par2["p1"], par2["p2"], par2["p0"] = p1, p2, p0
            res = _q2_profit(par2, base_decision)
            if res is None:
                continue
            grid.append([p1, p2, p0, res["profit"]])
        if grid:
            profits = [row[3] for row in grid]
            range_block[cid] = {
                "decision": base_decision,
                "profit_low": min(profits),
                "profit_high": max(profits),
                "grid": grid,
            }
        else:
            range_block[cid] = {"decision": base_decision, "profit_low": None, "profit_high": None, "grid": []}

        # 蒙特卡洛：以 p_hat 为真值重抽样，每次重解最优决策（EQ-Q4-ROBUST）
        matches = 0
        convergence = []
        profit_samples = []
        for m_i in range(1, m_resample + 1):
            par2 = dict(par)
            feasible = True
            for key in ("p1", "p2", "p0"):
                x = int(rng_q2.binomial(n_sample, float(p_hat[key])))
                par2[key] = x / n_sample
            res = _q2_solve(par2)["best"]
            if res is None:
                feasible = False
            else:
                if res["decision"] == base_decision:
                    matches += 1
            if m_i % step == 0:
                convergence.append(matches / m_i)
                if feasible:
                    profit_samples.append(res["profit"])
        rho = matches / m_resample
        mc_block[cid] = {
            "consistency_rate": rho,
            "convergence": convergence,
            "profit_samples": profit_samples,
            "resamples": m_resample,
        }
        diff_block[cid] = {
            "point_decision": base_decision,
            "flip_count": m_resample - matches,
            "flip_rate": 1.0 - rho,
            "stable": bool(rho >= rho_threshold),
            "threshold": rho_threshold,
        }

        # 审计整改项：x 偏离标称值的对照 + 一次随机实现
        contrast = _x_offset_contrast(par, n_sample, base_decision)
        xs_rand = {}
        for key in ("p1", "p2", "p0"):
            xs_rand[key] = int(rng_x.binomial(n_sample, float(p_hat[key])))
        par_rand = dict(par)
        for key, x in xs_rand.items():
            par_rand[key] = x / n_sample
        res_rand = _q2_solve(par_rand)["best"]
        contrast["x_random"] = {
            "x": dict(xs_rand),
            "p_hat": {k: xs_rand[k] / n_sample for k in xs_rand},
            "decision": None if res_rand is None else res_rand["decision"],
            "profit": None if res_rand is None else res_rand["profit"],
            "flipped_vs_base": None if res_rand is None else (res_rand["decision"] != base_decision),
        }
        xoff_block[cid] = contrast

    # ---------------- 问题 3：2 工序 8 零配件实例 ----------------
    base_nodes, _price = _q3_base()
    node_names = sorted(base_nodes.keys())

    q3_ci = {}
    for name in node_names:
        pv = float(base_nodes[name]["p"])
        x = min(max(int(round(pv * n_sample)), 0), n_sample)
        low, high = _clopper_pearson(x, n_sample, level)
        q3_ci[name] = {"p_hat": pv, "x": x, "n": n_sample, "low": low, "high": high}

    base_q3 = _q3_solve()
    point_q3 = {"decision": base_q3["decision"], "profit": base_q3["profit"], "U": base_q3["U"]}

    # 利润区间：决策固定，所有节点的 p 按各自区间同步插值
    curve = []
    pts = max(2, curve_points)
    for k in range(pts):
        t = k / (pts - 1.0)
        overrides = {}
        for name in node_names:
            ci = q3_ci[name]
            overrides[name] = ci["low"] + t * (ci["high"] - ci["low"])
        prof = _q3_profit_fixed(overrides, base_q3["decision"])
        if prof is None:
            continue
        curve.append([t, prof])
    if curve:
        curve_profits = [row[1] for row in curve]
        range_q3 = {
            "decision": base_q3["decision"],
            "profit_low": min(curve_profits),
            "profit_high": max(curve_profits),
            "curve": curve,
        }
    else:
        range_q3 = {"decision": base_q3["decision"], "profit_low": None, "profit_high": None, "curve": []}

    # 蒙特卡洛：每个节点各自独立抽样后重解
    step3 = max(1, m_tree // sample_points)
    matches3 = 0
    convergence3 = []
    samples3 = []
    for m_i in range(1, m_tree + 1):
        overrides = {}
        for name in node_names:
            x = int(rng_q3.binomial(n_sample, float(q3_ci[name]["p_hat"])))
            overrides[name] = x / n_sample
        res3 = _q3_solve(overrides)
        if res3["decision"] == base_q3["decision"]:
            matches3 += 1
        if m_i % step3 == 0:
            convergence3.append(matches3 / m_i)
            samples3.append(res3["profit"])
    rho3 = matches3 / m_tree
    mc_q3 = {
        "consistency_rate": rho3,
        "convergence": convergence3,
        "profit_samples": samples3,
        "resamples": m_tree,
    }
    diff_q3 = {
        "point_decision": base_q3["decision"],
        "flip_count": m_tree - matches3,
        "flip_rate": 1.0 - rho3,
        "stable": bool(rho3 >= rho_threshold),
        "threshold": rho_threshold,
    }

    sampling_note = {
        "description": (
            "问题 4 的每个待估次品率独立来自一次固定样本量 n 的简单随机抽样："
            "抽到的不合格数 x ~ Bin(n, p_true)，点估计 p_hat = x/n，"
            "区间取 Clopper-Pearson 精确二项区间。重抽样时以 p_hat 为真值生成新样本 "
            "x' ~ Bin(n, p_hat) 并重解最优决策。"
        ),
        "sample_size": n_sample,
        "confidence_level": level,
        "resamples_q2": m_resample,
        "resamples_q3": m_tree,
        "seed": base_seed,
        "streams": {"problem2": [base_seed, 2], "problem3": [base_seed, 3], "random_x": [base_seed, 4]},
        "leakage_note": (
            "一致率 rho 是决策稳定性指标，不涉及训练/测试划分；"
            "p 的生成与决策求解各自使用独立随机子流，决策求解不复用抽样过程的中间量，"
            "不存在信息泄漏。"
        ),
    }

    return {
        "q4": {
            "sampling_note": sampling_note,
            "ci": ci_block,
            "q3_ci": q3_ci,
            "point_estimate": {"problem2": point_block, "problem3": point_q3},
            "profit_range": {"problem2": range_block, "problem3": range_q3},
            "monte_carlo": {"problem2": mc_block, "problem3": mc_q3},
            "decision_diff": {"problem2": diff_block, "problem3": diff_q3},
            "x_offset_contrast": xoff_block,
            "topology_assumption": (
                "ASM-09：{1,2,3}->S1、{4,5,6}->S2、{7,8}->S3、S1/S2/S3->F。"
                "图 1 原件未随阶段简报下传，该连接关系为常量级假设，"
                "其依赖由问题 3 的拓扑扰动扫描量化，阶段 8 复核时需一并核对 00-input 中图 1 原件。"
            ),
        }
    }
```