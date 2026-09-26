# -*- coding: utf-8 -*-
"""阶段 03 · 问题 1：检测次数尽可能少的抽样检测方案（真跑实现）。

本模块只做三件事：
  1. 从 ``params``（题面事实表 + 模型常数表）读取全部输入，函数体内不留裸常数；
  2. 用精确二项尾概率求解两个情形的最小样本量 ``(n, c_r)`` 及其全部派生量
     （OC 曲线、样本量—信度曲线、序贯对照边界、抽样费用、核验残差）；
  3. 把要进论文的量写成 JSON：``run()`` 返回可序列化字典，直接执行本文件时落盘。

明确不做：不画图（无 plt / savefig）、不写图表声明、不写数源声明。
"""

from __future__ import annotations

import json
import math
import os

try:  # 题面事实表 + 模型常数表（本阶段独立交付物）
    import params

    try:
        from params import *  # noqa: F401,F403
    except Exception:  # pragma: no cover
        pass
except Exception:  # pragma: no cover - params 缺失时退回兜底值，仍可运行
    params = None

try:
    from scipy.stats import binom as _scipy_binom
except Exception:  # pragma: no cover
    _scipy_binom = None

try:
    from scipy.stats import norm as _scipy_norm
except Exception:  # pragma: no cover
    _scipy_norm = None

NAME = "problem1"
OUTPUT_FILE = "problem1_outputs.json"

# ---------------------------------------------------------------------------
# 0. 常数读取：全部按键名从 params 取，未命中才用兜底值（兜底值与题面给定值一致）
# ---------------------------------------------------------------------------

_CONST_DICTS = (
    "MODEL_CONSTANTS",
    "MODEL_CONSTANTS_CN",
    "MODEL_CONST",
    "CONSTANTS",
    "PARAMS",
    "FACTS",
    "PROBLEM_FACTS",
)


def _lookup(names, default=None):
    """按候选键名在 params 的模块属性与常数/事实字典中查找。"""
    if isinstance(names, str):
        names = (names,)
    if params is not None:
        for nm in names:
            if hasattr(params, nm):
                return getattr(params, nm)
    for dname in _CONST_DICTS:
        d = getattr(params, dname, None) if params is not None else None
        if isinstance(d, dict):
            for nm in names:
                if nm in d:
                    return d[nm]
    return default


def _num(value, default=None):
    """把 '10%' / {'value': 0.1} / 0.1 统一转成 float。"""
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        for k in ("value", "val", "数值", "rate", "ratio", "count"):
            if k in value:
                return _num(value[k], default)
        return default
    if isinstance(value, str):
        s = value.strip()
        pct = s.endswith("%")
        if pct:
            s = s[:-1].strip()
        try:
            v = float(s)
        except ValueError:
            return default
        return v / 100.0 if pct else v
    return default


def _maybe_num(names):
    return _num(_lookup(names, None), None)


def _num_const(names, default):
    v = _maybe_num(names)
    return float(default) if v is None else float(v)


def _rate(names, default):
    v = _maybe_num(names)
    if v is None:
        return float(default)
    if 1.0 < v <= 100.0:  # 写成 10 而不是 10% 的情况
        v = v / 100.0
    return float(v)


def _dict_num(d, keys, default=None):
    """在（可能嵌套的）字典里按候选键名找数值。"""
    if not isinstance(d, dict):
        return default
    for k in keys:
        if k in d:
            v = _num(d[k], None)
            if v is not None:
                return v
    for _, sub in d.items():
        if isinstance(sub, dict):
            v = _dict_num(sub, keys, None)
            if v is not None:
                return v
    return default


def _table1_first_case():
    t = _lookup(("TABLE1", "TABLE_1", "CASES_TABLE1", "TABLE1_CASES", "T1"), None)
    if isinstance(t, (list, tuple)) and len(t) > 0:
        return t[0]
    if isinstance(t, dict):
        for k in sorted(t.keys(), key=lambda x: str(x)):
            if isinstance(t[k], dict):
                return t[k]
    return None


def _part_inspect_cost(case, part_idx, default):
    """表 1 情况 1 中第 part_idx 个零配件的检测成本（仅作问题 1 的借用单价）。"""
    if not isinstance(case, dict):
        return default
    v = _dict_num(
        case,
        ("c{0}".format(part_idx), "inspect_cost_{0}".format(part_idx), "detect_cost_{0}".format(part_idx)),
        None,
    )
    if v is not None:
        return v
    for k, sub in case.items():
        ks = str(k).lower()
        if ("part" in ks or "零配件" in str(k) or "配件" in str(k)) and str(part_idx) in ks:
            v = _dict_num(sub, ("inspect_cost", "detect_cost", "检测成本", "c"), None)
            if v is not None:
                return v
    return default


# ---------------------------------------------------------------------------
# 1. 精确二项分布工具（scipy 优先，缺失时用对数域递推兜底）
# ---------------------------------------------------------------------------


def _binomial_tail_ge(k, n, p):
    """P(X >= k)，X ~ B(n, p)，自 k 起向上递推（避免阶乘溢出）。"""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    if p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    log_pmf = (
        math.lgamma(n + 1)
        - math.lgamma(k + 1)
        - math.lgamma(n - k + 1)
        + k * math.log(p)
        + (n - k) * math.log1p(-p)
    )
    pmf = math.exp(log_pmf)
    total = pmf
    ratio = p / (1.0 - p)
    i = k
    while i < n:
        pmf = pmf * ((n - i) / (i + 1)) * ratio
        total += pmf
        i += 1
    return total


def _binom_sf(k, n, p):
    """P(X >= k)。"""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    if _scipy_binom is not None:
        return float(_scipy_binom.sf(k - 1, n, p))
    return _binomial_tail_ge(k, n, p)


def _binom_cdf(k, n, p):
    """P(X <= k)。"""
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    if _scipy_binom is not None:
        return float(_scipy_binom.cdf(k, n, p))
    return 1.0 - _binomial_tail_ge(k + 1, n, p)


def _norm_ppf(q):
    if _scipy_norm is not None:
        return float(_scipy_norm.ppf(q))
    lo, hi = -10.0, 10.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if 0.5 * (1.0 + math.erf(mid / math.sqrt(2.0))) < q:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# ---------------------------------------------------------------------------
# 2. 两个情形的整数样本量最小化搜索（逐字实现 EQ-Q1-REJECT / EQ-Q1-ACCEPT）
# ---------------------------------------------------------------------------


def _first_c_ge_tail_le(n, p, target, tol):
    """最小 c ∈ [0,n]，使 P(X >= c+1 | p) <= target（尾概率对 c 单调下降）。"""
    lo, hi, best = 0, n, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if _binom_sf(mid + 1, n, p) <= target + tol:
            best = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return best


def _last_c_cdf_le(n, p, target, tol):
    """最大 c ∈ [0,n]，使 P(X <= c | p) <= target（累积概率对 c 单调上升）。"""
    lo, hi, best = 0, n, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if _binom_cdf(mid, n, p) <= target + tol:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return best


def _solve_case_reject(p_nom, p_alt, alpha, beta, n_max, tol):
    """EQ-Q1-REJECT：min n s.t. ∃c_r, P(X>=c_r+1|p_nom)<=α 且 P(X>=c_r+1|p_alt)>=1-β。"""
    for n in range(1, n_max + 1):
        c = _first_c_ge_tail_le(n, p_nom, alpha, tol)
        if c is None:
            continue
        if _binom_sf(c + 1, n, p_alt) >= 1.0 - beta - tol:
            return n, c
    return None, None


def _solve_case_accept(p_nom, p_alt, alpha, beta, n_max, tol):
    """EQ-Q1-ACCEPT：min n s.t. ∃c_r, P(X<=c_r|p_nom)>=1-α 且 P(X<=c_r|p_alt)<=β。"""
    for n in range(1, n_max + 1):
        c_lo = _first_c_ge_tail_le(n, p_nom, alpha, tol)  # 等价于 cdf_nom(c) >= 1-α
        if c_lo is None:
            continue
        c_hi = _last_c_cdf_le(n, p_alt, beta, tol)  # cdf_alt(c) <= β
        if c_hi is None or c_lo > c_hi:
            continue
        return n, c_lo
    return None, None


def _solve_single_side_only(p_nom, alpha, n_max, tol):
    """对照（被否掉的方案）：只控单侧、不做功效约束 -> 退化到 n=1。"""
    for n in range(1, n_max + 1):
        c = _first_c_ge_tail_le(n, p_nom, alpha, tol)
        if c is not None:
            return n, c
    return None, None


def _normal_approx_n(p_nom, p_alt, alpha, beta):
    """正态近似下的样本量（仅作快速筛选与适用性判定的对照，不作判定依据）。"""
    z_a = _norm_ppf(1.0 - alpha)
    z_b = _norm_ppf(1.0 - beta)
    num = z_a * math.sqrt(p_nom * (1.0 - p_nom)) + z_b * math.sqrt(p_alt * (1.0 - p_alt))
    return int(math.ceil((num / (p_alt - p_nom)) ** 2))


# ---------------------------------------------------------------------------
# 3. 主求解
# ---------------------------------------------------------------------------


def run():
    tol = _num_const(("TOL", "TOLERANCE", "数值容差"), 1e-06)
    p_nom = _rate(
        ("P_NOMINAL", "NOMINAL_RATE", "NOMINAL_DEFECT_RATE", "P_NOM", "p_nom", "标称次品率"),
        0.10,
    )
    conf_reject = _rate(("CONF_REJECT", "CONFIDENCE_REJECT", "CONF_REJECT_95"), 0.95)
    conf_accept = _rate(("CONF_ACCEPT", "CONFIDENCE_ACCEPT", "CONF_ACCEPT_90"), 0.90)
    alpha1 = _num_const(("ALPHA1", "Q1_ALPHA1", "Q1情形1显著性水平α1"), 1.0 - conf_reject)
    alpha2 = _num_const(("ALPHA2", "Q1_ALPHA2", "Q1情形2显著性水平α2"), 1.0 - conf_accept)
    beta = _num_const(("BETA", "Q1_BETA", "Q1功效约束β"), 0.10)
    delta = _num_const(("DELTA", "Q1_DELTA", "Q1可识别超标幅度Δ"), 0.05)
    n_max = int(_num_const(("N_MAX", "Q1_N_MAX", "Q1样本量搜索上界"), 1000))
    normal_min = _num_const(("NORMAL_APPROX_MIN", "正态近似适用下界"), 5.0)
    ref_conf = _rate(
        ("SENS_CONF_REF", "REFERENCE_CONFIDENCE", "灵敏度扫描置信水平对照值"), 0.99
    )
    oc_points = int(_num_const(("Q1_OC_GRID", "OC_GRID_POINTS", "OC曲线格点数"), 201))
    oc_max_p = _num_const(("Q1_OC_MAX_P", "OC_MAX_P"), 0.40)
    grid_pts = int(_num_const(("Q1_CONF_GRID", "CONF_GRID_POINTS", "样本量信度曲线格点数"), 11))
    conf_min = _num_const(("Q1_CONF_MIN", "CONF_MIN"), 0.50)
    conf_max = _num_const(("Q1_CONF_MAX", "CONF_MAX"), 0.99)

    p_alt = p_nom + delta

    # ---- 情形 (1)：95% 信度拒收 ----
    n1, c1 = _solve_case_reject(p_nom, p_alt, alpha1, beta, n_max, tol)
    # ---- 情形 (2)：90% 信度接收 ----
    n2, c2 = _solve_case_accept(p_nom, p_alt, alpha2, beta, n_max, tol)

    def _case_pack(tag, n, c, alpha, conf, rule_kind):
        if n is None or c is None:
            return {
                "tag": tag,
                "solved": False,
                "n": None,
                "c_r": None,
                "search_upper_bound": n_max,
            }
        rej_nom = _binom_sf(c + 1, n, p_nom)
        rej_alt = _binom_sf(c + 1, n, p_alt)
        acc_nom = _binom_cdf(c, n, p_nom)
        acc_alt = _binom_cdf(c, n, p_alt)
        if rule_kind == "reject":
            rule = "X >= {0} 时拒收；X <= {1} 时接收".format(c + 1, c)
            controlled = {"reject_prob_at_nominal": rej_nom, "power_at_alt": rej_alt}
        else:
            rule = "X <= {0} 时接收；X >= {1} 时拒收".format(c, c + 1)
            controlled = {"accept_prob_at_nominal": acc_nom, "accept_prob_at_alt": acc_alt}
        return {
            "tag": tag,
            "solved": True,
            "confidence": round(conf, 6),
            "alpha": round(alpha, 6),
            "beta": round(beta, 6),
            "n": int(n),
            "c_r": int(c),
            "reject_threshold": int(c + 1),
            "decision_rule": rule,
            "controlled_tails": {k: round(v, 12) for k, v in controlled.items()},
            "oc_at_nominal": round(_binom_cdf(c, n, p_nom), 12),
            "oc_at_alt": round(_binom_cdf(c, n, p_alt), 12),
        }

    case95 = _case_pack("case95", n1, c1, alpha1, conf_reject, "reject")
    case90 = _case_pack("case90", n2, c2, alpha2, conf_accept, "accept")

    # ---- OC 曲线（两个情形各一条，含标称值与备择值参考线）----
    p_grid = [oc_max_p * i / (oc_points - 1) for i in range(oc_points)]
    oc = {
        "p_grid": [round(p, 8) for p in p_grid],
        "L_case95": [round(_binom_cdf(c1, n1, p), 12) if n1 else None for p in p_grid],
        "L_case90": [round(_binom_cdf(c2, n2, p), 12) if n2 else None for p in p_grid],
        "p_nominal": round(p_nom, 8),
        "p_alt": round(p_alt, 8),
        "grid_points": oc_points,
        "grid_max_p": oc_max_p,
    }

    # ---- 样本量—判别信度曲线（含单侧退化对照与对照置信水平）----
    conf_grid = [
        conf_min + (conf_max - conf_min) * i / (grid_pts - 1) for i in range(grid_pts)
    ] if grid_pts > 1 else [conf_max]

    curve_conf, curve_n, curve_c, curve_n_degen = [], [], [], []
    for cf in conf_grid:
        a = 1.0 - cf
        nn, cc = _solve_case_reject(p_nom, p_alt, a, beta, n_max, tol)
        dn, dc = _solve_single_side_only(p_nom, a, n_max, tol)
        curve_conf.append(round(cf, 6))
        curve_n.append(int(nn) if nn is not None else None)
        curve_c.append(int(cc) if cc is not None else None)
        curve_n_degen.append(int(dn) if dn is not None else None)

    n_ref, c_ref = _solve_case_reject(p_nom, p_alt, 1.0 - ref_conf, beta, n_max, tol)

    sample_size_curve = {
        "confidence": curve_conf,
        "n_two_point": curve_n,
        "c_r_two_point": curve_c,
        "n_single_side_only_degenerate": curve_n_degen,
        "grid_points": len(conf_grid),
        "reference_confidence": round(ref_conf, 6),
        "n_at_reference_confidence": int(n_ref) if n_ref is not None else None,
        "marker_case95": {"confidence": round(conf_reject, 6), "n": case95.get("n"), "c_r": case95.get("c_r")},
        "marker_case90": {"confidence": round(conf_accept, 6), "n": case90.get("n"), "c_r": case90.get("c_r")},
    }

    # ---- 序贯方案边界（对照，不进主方案）----
    n_cap = int(n1) if n1 else min(n_max, int(_num_const(("Q1_SPRT_CAP", "SPRT_CAP"), 200)))
    sprt = _sprt_boundary(p_nom, p_alt, alpha1, beta, n_cap)

    # ---- 抽样检测费用（企业承担；单价为借用值，显式标注为假设）----
    case1_tbl = _table1_first_case()
    uc1 = _maybe_num(
        ("Q1_ASSUMED_UNIT_COST_PART1", "ASSUMED_UNIT_COST_PART1", "UNIT_INSPECT_COST_PART1")
    )
    if uc1 is None:
        uc1 = _part_inspect_cost(case1_tbl, 1, 2.0)
    uc2 = _maybe_num(
        ("Q1_ASSUMED_UNIT_COST_PART2", "ASSUMED_UNIT_COST_PART2", "UNIT_INSPECT_COST_PART2")
    )
    if uc2 is None:
        uc2 = _part_inspect_cost(case1_tbl, 2, 3.0)

    sampling_cost = {
        "borne_by": "enterprise",
        "note": "题面只规定抽样检测费用由企业承担，未给问题 1 的检测单价；下列单价显式借用表 1 情况 1 的零配件检测成本，属假设值而非题面给定值。",
        "assumed_unit_cost_part1": round(float(uc1), 6),
        "assumed_unit_cost_part2": round(float(uc2), 6),
        "is_assumed": True,
        "cost_case95_part1": round(float(uc1) * n1, 6) if n1 else None,
        "cost_case95_part2": round(float(uc2) * n1, 6) if n1 else None,
        "cost_case90_part1": round(float(uc1) * n2, 6) if n2 else None,
        "cost_case90_part2": round(float(uc2) * n2, 6) if n2 else None,
        "cost_case95": {"part1": round(float(uc1) * n1, 6) if n1 else None,
                        "part2": round(float(uc2) * n1, 6) if n1 else None},
        "cost_case90": {"part1": round(float(uc1) * n2, 6) if n2 else None,
                        "part2": round(float(uc2) * n2, 6) if n2 else None},
        "excluded_from_q2q3": True,
    }

    # ---- 正态近似对照与适用性判定（NORMAL_APPROX_MIN 的真实使用点）----
    n_approx = _normal_approx_n(p_nom, p_alt, alpha1, beta)
    normal_approx = {
        "n_approx_case95": int(n_approx),
        "n_exact_case95": int(n1) if n1 else None,
        "applicable_at_solution": bool(
            n1 is not None
            and n1 * p_nom >= normal_min
            and n1 * (1.0 - p_nom) >= normal_min
        ),
        "applicable_lower_bound": round(normal_min, 6),
        "np_at_solution": round(n1 * p_nom, 6) if n1 else None,
        "nq_at_solution": round(n1 * (1.0 - p_nom), 6) if n1 else None,
        "role": "仅作搜索初值与适用性判定，判定口径一律用精确二项尾概率",
    }

    # ---- 核验残差（V-01 / V-02 的数值证据）----
    verification = {
        "V-01": {
            "case": "case95",
            "reject_prob_at_nominal": round(_binom_sf(c1 + 1, n1, p_nom), 12) if n1 else None,
            "alpha1": round(alpha1, 12),
            "power_at_alt": round(_binom_sf(c1 + 1, n1, p_alt), 12) if n1 else None,
            "required_power": round(1.0 - beta, 12),
            "margin_nominal": round(alpha1 - _binom_sf(c1 + 1, n1, p_nom), 12) if n1 else None,
            "margin_power": round(_binom_sf(c1 + 1, n1, p_alt) - (1.0 - beta), 12) if n1 else None,
            "passes": bool(
                n1 is not None
                and _binom_sf(c1 + 1, n1, p_nom) <= alpha1 + tol
                and _binom_sf(c1 + 1, n1, p_alt) >= 1.0 - beta - tol
            ),
        },
        "V-02": {
            "case": "case90",
            "accept_prob_at_nominal": round(_binom_cdf(c2, n2, p_nom), 12) if n2 else None,
            "required_accept_level": round(1.0 - alpha2, 12),
            "accept_prob_at_alt": round(_binom_cdf(c2, n2, p_alt), 12) if n2 else None,
            "beta": round(beta, 12),
            "margin_nominal": round(_binom_cdf(c2, n2, p_nom) - (1.0 - alpha2), 12) if n2 else None,
            "margin_alt": round(beta - _binom_cdf(c2, n2, p_alt), 12) if n2 else None,
            "passes": bool(
                n2 is not None
                and _binom_cdf(c2, n2, p_nom) >= 1.0 - alpha2 - tol
                and _binom_cdf(c2, n2, p_alt) <= beta + tol
            ),
        },
        "tolerance": tol,
    }

    # ---- 被否掉的方案：只控单侧、无功效约束（退化为 n=1）----
    dn, dc = _solve_single_side_only(p_nom, alpha1, n_max, tol)
    degenerate = {
        "n": int(dn) if dn is not None else None,
        "c_r": int(dc) if dc is not None else None,
        "oc_at_alt": round(_binom_cdf(dc, dn, p_alt), 12) if dn is not None else None,
        "why_rejected": "无功效约束时最小化 n 退化为最小样本量，判别毫无功效",
    }

    payload = {
        "problem": 1,
        "module": NAME,
        "status": "ok" if (n1 is not None and n2 is not None) else "incomplete",
        "inputs": {
            "p_nominal": round(p_nom, 8),
            "delta": round(delta, 8),
            "p_alt": round(p_alt, 8),
            "confidence_reject": round(conf_reject, 6),
            "confidence_accept": round(conf_accept, 6),
            "alpha1": round(alpha1, 8),
            "alpha2": round(alpha2, 8),
            "beta": round(beta, 8),
            "search_upper_bound": n_max,
            "tolerance": tol,
        },
        "sampling_scheme": {
            "method": "single_sampling_plan_by_attributes",
            "distribution": "X ~ Binomial(n, p)",
            "randomization": "从批中简单随机抽取 n 件，批量足够大以二项近似超几何",
            "assumption_refs": ["ASM-05", "ASM-06", "ASM-11", "ASM-14"],
            "decision_rule_case95": case95.get("decision_rule"),
            "decision_rule_case90": case90.get("decision_rule"),
        },
        "case95": case95,
        "case90": case90,
        "oc_curve": oc,
        "sample_size_vs_confidence": sample_size_curve,
        "sprt": sprt,
        "sampling_cost": sampling_cost,
        "normal_approx": normal_approx,
        "verification": verification,
        "counterexample_single_side_only": degenerate,
        "two_cases_comparison": {
            "labels": [
                "case95(conf={0:.2f},alpha={1:.2f})".format(conf_reject, alpha1),
                "case90(conf={0:.2f},alpha={1:.2f})".format(conf_accept, alpha2),
            ],
            "n": [case95.get("n"), case90.get("n")],
            "c_r": [case95.get("c_r"), case90.get("c_r")],
        },
        "anchors": {
            "R-Q1-n-case95": "case95.n",
            "R-Q1-c-case95": "case95.c_r",
            "R-Q1-n-case90": "case90.n",
            "R-Q1-c-case90": "case90.c_r",
            "R-Q1-oc-verify": "oc_curve",
            "R-Q1-sampling-cost": "sampling_cost",
        },
    }
    return payload


def _sprt_boundary(p0, p1, alpha, beta, n_cap):
    """序贯概率比检验的接受/拒收/继续抽样边界（二维边界图数据，仅作对照）。"""
    s = math.log(p1 / p0)
    t = math.log((1.0 - p1) / (1.0 - p0))
    log_a = math.log((1.0 - beta) / alpha)
    log_b = math.log(beta / (1.0 - alpha))
    dens = s - t
    ns, acc, rej = [], [], []
    for n in range(1, int(n_cap) + 1):
        ns.append(n)
        acc.append(round((log_b - n * t) / dens, 8))
        rej.append(round((log_a - n * t) / dens, 8))
    return {
        "p0": round(p0, 8),
        "p1": round(p1, 8),
        "alpha": round(alpha, 8),
        "beta": round(beta, 8),
        "n": ns,
        "accept_boundary_d": acc,
        "reject_boundary_d": rej,
        "n_cap": int(n_cap),
        "role": "对照方案，不进入主方案（主方案为固定样本量两点设计）",
    }


def main():
    payload = run()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), OUTPUT_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return payload


if __name__ == "__main__":
    main()