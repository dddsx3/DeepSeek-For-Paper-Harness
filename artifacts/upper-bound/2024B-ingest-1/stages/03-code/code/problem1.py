```python
# -*- coding: utf-8 -*-
"""问题 1：检测次数尽可能少的抽样检测方案。

实现口径与 02-modeling/DECLARATION.json 逐字一致：

    EQ-OC        L(p) = P(X <= c_r | p) = sum_{i=0}^{c_r} C(n,i) p^i (1-p)^(n-i)
    EQ-Q1-REJECT n^(1) = min{ n : 存在 c_r, P(X >= c_r+1 | p_nom) <= alpha1
                                          且 P(X >= c_r+1 | p_alt) >= 1-beta }
                 判定：X >= c_r+1 则拒收
    EQ-Q1-ACCEPT n^(2) = min{ n : 存在 c_r, P(X <= c_r | p_nom) >= 1-alpha2
                                          且 P(X <= c_r | p_alt) <= beta }
                 判定：X <= c_r 则接收

两种情形的被控尾不同（情形 (1) 控「拒收」尾、情形 (2) 控「接收」尾），
因此不可互换，也不共用同一个 (n, c_r)。两者都按「两点设计」实现：
单侧主约束 + 备择点 p_alt = p_nom + Δ 的功效约束，否则最小化 n 会退化到 n=1。

本模块只负责把量算出来并写成 JSON，不做任何绘图，也不写任何图表声明。
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from typing import Dict, List, Optional, Sequence

try:  # 精确二项尾概率优先走 scipy；不可用时退回纯 Python 实现
    from scipy.stats import binom as _scipy_binom

    _HAVE_SCIPY = True
except Exception:  # pragma: no cover
    _scipy_binom = None
    _HAVE_SCIPY = False


# --------------------------------------------------------------------------
# 模型常数读取（一律按 DECLARATION.json 的 model_constants 键名取，不写死在函数体里）
# --------------------------------------------------------------------------
try:  # pragma: no cover - 由阶段 3 的其它分片提供
    from constants import MODEL_CONSTANTS  # type: ignore
except Exception:  # pragma: no cover
    MODEL_CONSTANTS = {}

# 回退表：键名与取值与 DECLARATION.json 的 model_constants 完全一致，
# 仅在 constants.py 缺失时生效，保证本模块可独立执行。
_FALLBACK_CONSTANTS: Dict[str, object] = {
    "数值容差": 1e-06,
    "Q1可识别超标幅度Δ": 0.05,
    "Q1情形1显著性水平α1": 0.05,
    "Q1情形2显著性水平α2": 0.1,
    "Q1功效约束β": 0.1,
    "Q1样本量搜索上界": 1000,
    "标称次品率": 0.10,  # 题面给定值 F-NOMINAL
}


def _mc(key: str, default=None):
    """按键名取模型常数：先查 constants.MODEL_CONSTANTS，再查回退表，最后取 default。"""
    try:
        if key in MODEL_CONSTANTS:
            return MODEL_CONSTANTS[key]
    except Exception:
        pass
    if key in _FALLBACK_CONSTANTS:
        return _FALLBACK_CONSTANTS[key]
    return default


# --------------------------------------------------------------------------
# 二项分布尾概率（EQ-OC）
# --------------------------------------------------------------------------
def _log_pmf(i: int, n: int, p: float) -> float:
    """ln C(n,i) + i ln p + (n-i) ln(1-p)，对数域防溢出。"""
    if p <= 0.0:
        return 0.0 if i == 0 else float("-inf")
    if p >= 1.0:
        return 0.0 if i == n else float("-inf")
    return (
        math.lgamma(n + 1.0)
        - math.lgamma(i + 1.0)
        - math.lgamma(n - i + 1.0)
        + i * math.log(p)
        + (n - i) * math.log1p(-p)
    )


@lru_cache(maxsize=None)
def _binom_sf_impl(k: int, n: int, p: float) -> float:
    """P(X >= k)，X ~ Binomial(n, p)。"""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    if _HAVE_SCIPY:
        return float(_scipy_binom.sf(k - 1, n, p))
    total = 0.0
    for i in range(k, n + 1):
        lp = _log_pmf(i, n, p)
        if lp == float("-inf"):
            continue
        total += math.exp(lp)
    return max(0.0, min(1.0, total))


@lru_cache(maxsize=None)
def _binom_cdf_impl(k: int, n: int, p: float) -> float:
    """P(X <= k)，X ~ Binomial(n, p)。"""
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    if _HAVE_SCIPY:
        return float(_scipy_binom.cdf(k, n, p))
    if k <= n * p:
        total = 0.0
        for i in range(0, k + 1):
            lp = _log_pmf(i, n, p)
            if lp == float("-inf"):
                continue
            total += math.exp(lp)
        return max(0.0, min(1.0, total))
    return max(0.0, min(1.0, 1.0 - _binom_sf_impl(k + 1, n, p)))


def binom_sf(k: int, n: int, p: float) -> float:
    """P(X >= k)。"""
    return _binom_sf_impl(int(k), int(n), float(p))


def binom_cdf(k: int, n: int, p: float) -> float:
    """P(X <= k)（即 OC 函数 L(p) 在给定 (n, c_r) 下的取值）。"""
    return _binom_cdf_impl(int(k), int(n), float(p))


def oc_function(n: int, c_r: int, p: float) -> float:
    """EQ-OC：L(p) = P(X <= c_r | p)。"""
    return binom_cdf(c_r, n, p)


# --------------------------------------------------------------------------
# 单调性辅助：k -> P(X >= k) 递减，c -> P(X <= c) 递增
# --------------------------------------------------------------------------
def _first_k_leq(n: int, p: float, thr: float) -> Optional[int]:
    """最小的 k ∈ [1, n] 使 P(X >= k | n, p) <= thr；不存在返回 None。"""
    if binom_sf(n, n, p) > thr:
        return None
    lo, hi = 1, n
    while lo < hi:
        mid = (lo + hi) // 2
        if binom_sf(mid, n, p) <= thr:
            hi = mid
        else:
            lo = mid + 1
    return lo


def _last_k_geq(n: int, p: float, thr: float) -> Optional[int]:
    """最大的 k ∈ [1, n] 使 P(X >= k | n, p) >= thr；不存在返回 None。"""
    if binom_sf(1, n, p) < thr:
        return None
    lo, hi = 1, n
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if binom_sf(mid, n, p) >= thr:
            lo = mid
        else:
            hi = mid - 1
    return lo


def _first_c_geq(n: int, p: float, thr: float) -> Optional[int]:
    """最小的 c ∈ [0, n] 使 P(X <= c | n, p) >= thr；不存在返回 None。"""
    if binom_cdf(n, n, p) < thr:
        return None
    lo, hi = 0, n
    while lo < hi:
        mid = (lo + hi) // 2
        if binom_cdf(mid, n, p) >= thr:
            hi = mid
        else:
            lo = mid + 1
    return lo


def _last_c_leq(n: int, p: float, thr: float) -> Optional[int]:
    """最大的 c ∈ [0, n] 使 P(X <= c | n, p) <= thr；不存在返回 None。"""
    if binom_cdf(0, n, p) > thr:
        return None
    lo, hi = 0, n
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if binom_cdf(mid, n, p) <= thr:
            lo = mid
        else:
            hi = mid - 1
    return lo


# --------------------------------------------------------------------------
# 情形 (1)：95% 信度拒收 —— EQ-Q1-REJECT
# --------------------------------------------------------------------------
def min_n_reject(
    p_nom: float,
    p_alt: float,
    alpha: float,
    beta: float,
    n_max: int = 1000,
) -> Optional[dict]:
    """最小的 n，使存在 c_r 同时满足

        P(X >= c_r + 1 | p_nom) <= alpha       （拒收侧第一类错误上界）
        P(X >= c_r + 1 | p_alt) >= 1 - beta    （备择点功效下界，防 n 退化到 1）

    返回 dict（含最小性证据）；在 n_max 内不可行时返回 None。
    """
    for n in range(1, int(n_max) + 1):
        k_lo = _first_k_leq(n, p_nom, alpha)          # 满足 alpha 约束的最小 k
        if k_lo is None:
            continue
        k_hi = _last_k_geq(n, p_alt, 1.0 - beta)      # 满足功效约束的最大 k
        if k_hi is None:
            continue
        if k_lo <= k_hi:
            # 可行 k 区间 [k_lo, k_hi]；取 k_lo 使第一类错误最小、功效最大
            k = k_lo
            c_r = k - 1
            err_nom = binom_sf(k, n, p_nom)
            power = binom_sf(k, n, p_alt)
            return {
                "n": int(n),
                "c_r": int(c_r),
                "reject_threshold": int(k),
                "feasible_k_range": [int(k_lo), int(k_hi)],
                "error_at_nominal": float(err_nom),
                "power_at_alt": float(power),
                "consumer_risk_at_alt": float(1.0 - power),
                "oc_at_nominal": float(binom_cdf(c_r, n, p_nom)),
                "oc_at_alt": float(binom_cdf(c_r, n, p_alt)),
                "rule": "X >= c_r+1 则拒收，X <= c_r 则接收",
            }
    return None


# --------------------------------------------------------------------------
# 情形 (2)：90% 信度接收 —— EQ-Q1-ACCEPT
# --------------------------------------------------------------------------
def min_n_accept(
    p_nom: float,
    p_alt: float,
    alpha: float,
    beta: float,
    n_max: int = 1000,
) -> Optional[dict]:
    """最小的 n，使存在 c_r 同时满足

        P(X <= c_r | p_nom) >= 1 - alpha       （接收侧置信水平下界）
        P(X <= c_r | p_alt) <= beta            （备择点误收概率上界，防 n 退化到 1）

    返回 dict（含最小性证据）；在 n_max 内不可行时返回 None。
    """
    for n in range(1, int(n_max) + 1):
        c_lo = _first_c_geq(n, p_nom, 1.0 - alpha)    # 满足置信下界的最小 c
        if c_lo is None:
            continue
        c_hi = _last_c_leq(n, p_alt, beta)            # 满足误收上界的最大 c
        if c_hi is None:
            continue
        if c_lo <= c_hi:
            # 可行 c 区间 [c_lo, c_hi]；取 c_lo 使「以 1-alpha 的信度接收」恰成立
            c_r = c_lo
            acc_nom = binom_cdf(c_r, n, p_nom)
            acc_alt = binom_cdf(c_r, n, p_alt)
            return {
                "n": int(n),
                "c_r": int(c_r),
                "feasible_c_range": [int(c_lo), int(c_hi)],
                "accept_prob_at_nominal": float(acc_nom),
                "accept_prob_at_alt": float(acc_alt),
                "producer_risk_at_nominal": float(1.0 - acc_nom),
                "oc_at_nominal": float(acc_nom),
                "oc_at_alt": float(acc_alt),
                "rule": "X <= c_r 则接收，X >= c_r+1 则拒收",
            }
    return None


# --------------------------------------------------------------------------
# 最小性复核：n' < n* 时确实不存在可行的 c_r
# --------------------------------------------------------------------------
def _minimality_reject(p_nom, p_alt, alpha, beta, n_star) -> bool:
    for n in range(1, int(n_star)):
        k_lo = _first_k_leq(n, p_nom, alpha)
        k_hi = _last_k_geq(n, p_alt, 1.0 - beta)
        if k_lo is not None and k_hi is not None and k_lo <= k_hi:
            return False
    return True


def _minimality_accept(p_nom, p_alt, alpha, beta, n_star) -> bool:
    for n in range(1, int(n_star)):
        c_lo = _first_c_geq(n, p_nom, 1.0 - alpha)
        c_hi = _last_c_leq(n, p_alt, beta)
        if c_lo is not None and c_hi is not None and c_lo <= c_hi:
            return False
    return True


# --------------------------------------------------------------------------
# 扫描：OC 曲线、样本量—信度关系、SPRT 对照边界
# --------------------------------------------------------------------------
def oc_curve(n: int, c_r: int, p_grid: Sequence[float]) -> List[float]:
    """给定 (n, c_r) 的 OC 曲线 L(p)（EQ-OC）。"""
    return [float(binom_cdf(c_r, n, p)) for p in p_grid]


def sample_size_vs_confidence(
    conf_grid: Sequence[float],
    p_nom: float,
    delta: float,
    beta: float,
    n_max: int = 1000,
) -> dict:
    """样本量—判别信度关系：对每个信度重新解两情形的最小 n。"""
    out = {
        "confidence": [],
        "case1_n": [],
        "case1_c_r": [],
        "case2_n": [],
        "case2_c_r": [],
    }
    for conf in conf_grid:
        alpha = 1.0 - float(conf)
        r1 = min_n_reject(p_nom, p_nom + delta, alpha, beta, n_max)
        r2 = min_n_accept(p_nom, p_nom + delta, alpha, beta, n_max)
        out["confidence"].append(float(conf))
        out["case1_n"].append(None if r1 is None else r1["n"])
        out["case1_c_r"].append(None if r1 is None else r1["c_r"])
        out["case2_n"].append(None if r2 is None else r2["n"])
        out["case2_c_r"].append(None if r2 is None else r2["c_r"])
    return out


def sprt_boundary(p_nom: float, p_alt: float, alpha: float, beta: float, n_ub: int = 200) -> dict:
    """序贯概率比检验（SPRT）的接受/拒收/继续抽样边界，仅作对照，不进入主方案。

    LLR(d, n) = d·ln(p_alt/p_nom) + (n-d)·ln((1-p_alt)/(1-p_nom))
    当 LLR >= ln(A) 拒收，LLR <= ln(B) 接收，A = (1-beta)/alpha，B = beta/(1-alpha)。
    """
    a_thr = (1.0 - beta) / alpha
    b_thr = beta / (1.0 - alpha)
    ln_p = math.log(p_alt / p_nom)
    ln_q = math.log((1.0 - p_alt) / (1.0 - p_nom))
    denom = ln_p - ln_q

    out = {
        "n": [],
        "accept_boundary": [],
        "reject_boundary": [],
        "continue_band": [],
        "ln_A": float(math.log(a_thr)),
        "ln_B": float(math.log(b_thr)),
    }
    for n in range(1, int(n_ub) + 1):
        d_rej = (math.log(a_thr) - n * ln_q) / denom
        d_acc = (math.log(b_thr) - n * ln_q) / denom
        rej = math.ceil(d_rej - 1e-12)
        acc = math.floor(d_acc + 1e-12)
        rej = None if (rej > n) else int(max(1, rej))
        acc = None if (acc < 0) else int(acc)
        out["n"].append(int(n))
        out["accept_boundary"].append(acc)
        out["reject_boundary"].append(rej)
        if acc is None or rej is None:
            out["continue_band"].append(None)
        else:
            out["continue_band"].append(int(max(0, rej - acc - 1)))
    return out


# --------------------------------------------------------------------------
# 主求解入口
# --------------------------------------------------------------------------
def solve(p_nom: Optional[float] = None, n_max: Optional[int] = None) -> dict:
    """问题 1 全量求解。

    返回的 dict 由 main.py 汇入 outputs.json；所有量均为真跑出来的值。
    """
    tol = float(_mc("数值容差"))
    delta = float(_mc("Q1可识别超标幅度Δ"))
    alpha1 = float(_mc("Q1情形1显著性水平α1"))
    alpha2 = float(_mc("Q1情形2显著性水平α2"))
    beta = float(_mc("Q1功效约束β"))
    p0 = float(p_nom if p_nom is not None else _mc("标称次品率"))
    n_ub = int(n_max if n_max is not None else _mc("Q1样本量搜索上界"))
    p1 = p0 + delta

    case1 = min_n_reject(p0, p1, alpha1, beta, n_ub)
    case2 = min_n_accept(p0, p1, alpha2, beta, n_ub)

    # OC 曲线数据（供 fig_q1_oc_curve_p1）：p 从 0 扫到 0.30
    p_grid = [round(0.30 * i / 60.0, 6) for i in range(61)]
    oc1 = oc_curve(case1["n"], case1["c_r"], p_grid) if case1 else []
    oc2 = oc_curve(case2["n"], case2["c_r"], p_grid) if case2 else []

    # 样本量—信度扫描（供 fig_q1_sample_size_vs_confidence）
    conf_grid = [round(0.80 + 0.01 * i, 4) for i in range(20)]
    conf_scan = sample_size_vs_confidence(conf_grid, p0, delta, beta, n_ub)

    # 序贯对照边界（供 fig_q1_sprt_boundary）
    sprt = sprt_boundary(p0, p1, alpha1, beta, 200)

    # 抽样成本参考口径：题面只规定检测费由企业承担，未给单件检测单价，
    # 故同时登记「检测件数」与「按表 1 参考单件检测成本折算的元/批」。
    unit_cost_ref = float(_mc("问题1参考单件检测成本", 2.0))
    n1 = case1["n"] if case1 else None
    n2 = case2["n"] if case2 else None

    verification = {
        "case1_error_at_nominal_within_alpha": bool(
            case1 is not None and case1["error_at_nominal"] <= alpha1 + tol
        ),
        "case1_power_at_alt_meets_1_minus_beta": bool(
            case1 is not None and case1["power_at_alt"] >= 1.0 - beta - tol
        ),
        "case1_n_is_minimal": bool(
            case1 is not None and _minimality_reject(p0, p1, alpha1, beta, case1["n"])
        ),
        "case2_accept_prob_at_nominal_meets_1_minus_alpha": bool(
            case2 is not None and case2["accept_prob_at_nominal"] >= 1.0 - alpha2 - tol
        ),
        "case2_misaccept_at_alt_within_beta": bool(
            case2 is not None and case2["accept_prob_at_alt"] <= beta + tol
        ),
        "case2_n_is_minimal": bool(
            case2 is not None and _minimality_accept(p0, p1, alpha2, beta, case2["n"])
        ),
        "oc_monotone_nonincreasing_at_nominal": bool(
            case1 is not None
            and all(
                oc1[i] >= oc1[i + 1] - 1e-9 for i in range(len(oc1) - 1)
            )
        ),
        "tolerance_used": tol,
    }

    return {
        "problem": 1,
        "title": "抽样检测方案：检测次数尽可能少（两点设计 + 整数样本量最小化搜索）",
        "params": {
            "p_nom": p0,
            "p_alt": p1,
            "delta": delta,
            "alpha1": alpha1,
            "alpha2": alpha2,
            "beta": beta,
            "confidence_case1": 1.0 - alpha1,
            "confidence_case2": 1.0 - alpha2,
            "n_max": n_ub,
        },
        "case1_reject": case1,
        "case2_accept": case2,
        "oc_curves": {
            "p_grid": p_grid,
            "case1": oc1,
            "case2": oc2,
        },
        "sample_size_vs_confidence": conf_scan,
        "two_cases_sample_size": {
            "labels": ["case1_reject_95pct", "case2_accept_90pct"],
            "n": [n1, n2],
            "c_r": [case1["c_r"] if case1 else None, case2["c_r"] if case2 else None],
            "confidence": [1.0 - alpha1, 1.0 - alpha2],
            "units": "件",
        },
        "sprt_boundary": sprt,
        "sampling_cost": {
            "unit_inspection_cost_ref_yuan": unit_cost_ref,
            "case1_inspections_per_batch": n1,
            "case2_inspections_per_batch": n2,
            "case1_cost_ref_yuan_per_batch": (None if n1 is None else float(n1) * unit_cost_ref),
            "case2_cost_ref_yuan_per_batch": (None if n2 is None else float(n2) * unit_cost_ref),
            "note": (
                "题面只规定抽样检测费用由企业承担（F-MECH-INSPECT-COST），未给问题 1 的"
                "单件检测单价；此处同时登记检测件数 n 与按参考单价折算的元/批，"
                "元/批仅供口径示意，问题 1 的目标函数本身只依赖 n。"
            ),
        },
        "verification": verification,
        "notes": {
            "asymmetry": (
                "情形 (1) 与情形 (2) 的被控尾不同：情形 (1) 约束拒收侧在 p_nom 处的"
                "第一类错误（P(X>=c_r+1|p_nom) <= alpha1）并要求在 p_alt 处的功效下界；"
                "情形 (2) 约束接收侧在 p_nom 处的置信水平（P(X<=c_r|p_nom) >= 1-alpha2）"
                "并要求在 p_alt 处的误收概率上界。两者因此不可互换、不共用 (n, c_r)。"
            ),
            "delta_role": (
                "备择点 p_alt = p_nom + Δ 的功效约束是防止最小化 n 退化的必要项；"
                "Δ 为可识别超标幅度，属登记在 model_constants 的设计量。"
            ),
            "scipy_available": _HAVE_SCIPY,
        },
    }


def write_results(path: str = "problem1_results.json", **kwargs) -> dict:
    """把问题 1 的全部结果写成 JSON（工作目录下，路径不深）。"""
    data = solve(**kwargs)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=False)
    return data


if __name__ == "__main__":  # pragma: no cover
    write_results()
```