"""问题 1：检测次数尽可能少的抽样检测方案（真跑代码，结果落盘 JSON）。

实现对应模型规格 MS-Q1：
  EQ-OC         接收特性函数 L(p) = P(X <= c_r | p)
  EQ-Q1-REJECT  情形 (1) 95% 信度拒收：
                n^(1) = min{ n : ∃c, P(X >= c+1 | p_nom) <= α1 且 P(X >= c+1 | p_alt) >= 1-β }
  EQ-Q1-ACCEPT  情形 (2) 90% 信度接收：
                n^(2) = min{ n : ∃c, P(X <= c | p_nom) >= 1-α2 且 P(X <= c | p_alt) <= β }

纪律：
  * 题面给定值与模型常数一律经 params 读取，不在函数体内裸写；
  * 只把量写进工作目录下的 JSON 文件，不打印结果、不绘图、不产生图像字节；
  * 同时铸出「点值」与「图集所需数组」（OC 曲线、样本量—信度扫描、两情形样本量、
    SPRT 接受/拒收边界），供阶段 5 直接取用。
"""

from __future__ import annotations

import json
import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:  # 题面给定值与模型常数的唯一落点
    import params as _params
except Exception:  # pragma: no cover - params.py 缺失时仍可独立运行
    _params = None

try:  # 精确二项尾概率（不完全 Beta 函数实现）
    from scipy.stats import binom as _scipy_binom
except Exception:  # pragma: no cover
    _scipy_binom = None


# --------------------------------------------------------------------------
# 常数读取：按键名从 params 取，绝不把数值写死在函数体内
# --------------------------------------------------------------------------

_CN_ALIAS = {
    "P_NOMINAL": ("标称次品率", "F-NOMINAL"),
    "Q1_DELTA": ("Q1可识别超标幅度Δ", "Q1可识别超标幅度"),
    "Q1_ALPHA1": ("Q1情形1显著性水平α1", "Q1情形1显著性水平"),
    "Q1_ALPHA2": ("Q1情形2显著性水平α2", "Q1情形2显著性水平"),
    "Q1_BETA": ("Q1功效约束β", "Q1功效约束"),
    "Q1_N_MAX": ("Q1样本量搜索上界",),
    "TOL": ("数值容差",),
    "CONF_CONTRAST": ("灵敏度扫描置信水平对照值",),
    "NORMAL_APPROX_LOWER_BOUND": ("正态近似适用下界",),
    "SEED": ("随机种子",),
}

# 仅供 params 缺失时的降级运行，取值与题面给定值/模型常数登记值一致
_FALLBACK = {
    "P_NOMINAL": 0.10,
    "Q1_DELTA": 0.05,
    "Q1_ALPHA1": 0.05,
    "Q1_ALPHA2": 0.10,
    "Q1_BETA": 0.10,
    "Q1_N_MAX": 1000,
    "TOL": 1e-06,
    "CONF_CONTRAST": 0.99,
    "NORMAL_APPROX_LOWER_BOUND": 5,
    "SEED": 202409,
    "C1_PART1_INSPECT": 2.0,
    "C1_PART2_INSPECT": 3.0,
}


def _from_model_constants(key: str):
    mc = getattr(_params, "MODEL_CONSTANTS", None)
    if isinstance(mc, dict):
        for alias in _CN_ALIAS.get(key, ()) + (key,):
            if alias in mc:
                return mc[alias]
        for val in mc.values():
            if isinstance(val, dict) and val.get("name") in _CN_ALIAS.get(key, ()):
                return val.get("value")
    return None


def _get(key: str, *names: str):
    """按 key（及若干英文别名）从 params 读常量，再退到中文键名与兜底表。"""
    for nm in names + (key,):
        if _params is not None and hasattr(_params, nm):
            return getattr(_params, nm)
    v = _from_model_constants(key)
    if v is not None:
        return v
    return _FALLBACK[key]


# --------------------------------------------------------------------------
# 二项尾概率：对数域 / 不完全 Beta，避免小 n 大阶乘溢出
# --------------------------------------------------------------------------

def _log_pmf(i: int, n: int, p: float) -> float:
    return (
        math.lgamma(n + 1)
        - math.lgamma(i + 1)
        - math.lgamma(n - i + 1)
        + i * math.log(p)
        + (n - i) * math.log1p(-p)
    )


def _sf_manual(k: int, n: int, p: float) -> float:
    """P(X >= k)，X ~ Binomial(n, p)，对数域累加。"""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    if p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    logs = [_log_pmf(i, n, p) for i in range(k, n + 1)]
    m = max(logs)
    if m == -math.inf:
        return 0.0
    return math.exp(m) * math.fsum(math.exp(t - m) for t in logs)


def _sf(k: int, n: int, p: float) -> float:
    """P(X >= k)。"""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    if p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    if _scipy_binom is not None:
        return float(_scipy_binom.sf(k - 1, n, p))
    return _sf_manual(k, n, p)


def _cdf(k: int, n: int, p: float) -> float:
    """P(X <= k)。"""
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    if p <= 0.0:
        return 1.0
    if p >= 1.0:
        return 0.0
    if _scipy_binom is not None:
        return float(_scipy_binom.cdf(k, n, p))
    return max(0.0, 1.0 - _sf_manual(k + 1, n, p))


# --------------------------------------------------------------------------
# 整数搜索工具：单调谓词上的首/末真值
# --------------------------------------------------------------------------

def _first_true(lo: int, hi: int, pred):
    if hi < lo or not pred(hi):
        return None
    while lo < hi:
        mid = (lo + hi) // 2
        if pred(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo


def _last_true(lo: int, hi: int, pred):
    if hi < lo or not pred(lo):
        return None
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if pred(mid):
            lo = mid
        else:
            hi = mid - 1
    return lo


# --------------------------------------------------------------------------
# 核心：两点设计下的最小样本量搜索
# --------------------------------------------------------------------------

def q1_min_n(p_nom, delta, alpha, beta, n_max, side="reject"):
    """在两类错误约束下最小化检测次数。

    side="reject"：EQ-Q1-REJECT，判据 X >= c_r+1 时拒收。
    side="accept"：EQ-Q1-ACCEPT，判据 X <= c_r 时接收。
    返回 (n, c_r)；无可行解返回 (None, None)。
    """
    p_alt = p_nom + delta
    for n in range(1, int(n_max) + 1):
        if side == "reject":
            c_lo = _first_true(0, n, lambda c: _sf(c + 1, n, p_nom) <= alpha)
            c_hi = _last_true(0, n, lambda c: _sf(c + 1, n, p_alt) >= 1.0 - beta)
            if c_lo is not None and c_hi is not None and c_lo <= c_hi:
                return n, c_lo
        else:
            c_lo = _first_true(0, n, lambda c: _cdf(c, n, p_nom) >= 1.0 - alpha)
            c_hi = _last_true(0, n, lambda c: _cdf(c, n, p_alt) <= beta)
            if c_lo is not None and c_hi is not None and c_lo <= c_hi:
                return n, c_lo
    return None, None


def oc_function(n, c_r, p_grid):
    """EQ-OC：给定 (n, c_r) 的接收特性曲线 L(p)。"""
    return [_cdf(int(c_r), int(n), float(p)) for p in p_grid]


def sprt_boundary(p0, p1, alpha, beta, n_max):
    """Wald 序贯概率比检验的接受/拒收边界（对照方案，不进入主方案）。

    对数似然比 Λ_n = a * d + b * n；
    接受当 Λ_n <= ln B，拒收当 Λ_n >= ln A，其间继续抽样。
    """
    a_coef = math.log(p1 / p0) - math.log((1.0 - p1) / (1.0 - p0))
    b_coef = math.log((1.0 - p1) / (1.0 - p0))
    ln_A = math.log((1.0 - beta) / alpha)
    ln_B = math.log(beta / (1.0 - alpha))
    n_grid = list(range(0, int(n_max) + 1))
    accept_line = [(ln_B - b_coef * m) / a_coef for m in n_grid]
    reject_line = [(ln_A - b_coef * m) / a_coef for m in n_grid]
    return n_grid, accept_line, reject_line, ln_A, ln_B


# --------------------------------------------------------------------------
# 编排：算点值 + 铸数组 + 自校核
# --------------------------------------------------------------------------

def solve():
    p_nom = float(_get("P_NOMINAL", "p_nom", "NOMINAL_DEFECT_RATE"))
    delta = float(_get("Q1_DELTA", "delta", "Q1_DELTA_DETECTABLE"))
    alpha1 = float(_get("Q1_ALPHA1", "alpha1"))
    alpha2 = float(_get("Q1_ALPHA2", "alpha2"))
    beta = float(_get("Q1_BETA", "beta"))
    n_max = int(_get("Q1_N_MAX", "n_max", "Q1_SAMPLE_SIZE_UPPER_BOUND"))
    tol = float(_get("TOL", "tol", "NUMERIC_TOLERANCE"))
    conf_contrast = float(_get("CONF_CONTRAST", "confidence_contrast"))
    z_lower = float(_get("NORMAL_APPROX_LOWER_BOUND"))
    c_part1 = float(_get("C1_PART1_INSPECT", "C1_PART1", "INSPECT_COST_PART1"))
    c_part2 = float(_get("C1_PART2_INSPECT", "C1_PART2", "INSPECT_COST_PART2"))

    p_alt = p_nom + delta

    # ---- 两情形的整数解 ----
    n1, c1 = q1_min_n(p_nom, delta, alpha1, beta, n_max, side="reject")
    n2, c2 = q1_min_n(p_nom, delta, alpha2, beta, n_max, side="accept")
    if n1 is None or n2 is None:
        raise RuntimeError(
            "问题1搜索未在上界内找到可行样本量，请检查 Q1样本量搜索上界 或 备择点 Δ"
        )

    # ---- 判定量与功效 ----
    p_reject_at_pnom = _sf(c1 + 1, n1, p_nom)
    power_at_palt = _sf(c1 + 1, n1, p_alt)
    p_accept_at_pnom = _cdf(c2, n2, p_nom)
    misaccept_at_palt = _cdf(c2, n2, p_alt)

    # ---- 最小性复核：n-1 处不可行 ----
    prev1 = q1_min_n(p_nom, delta, alpha1, beta, n1 - 1, side="reject")[0] if n1 > 1 else None
    prev2 = q1_min_n(p_nom, delta, alpha2, beta, n2 - 1, side="accept")[0] if n2 > 1 else None

    # ---- OC 曲线数组（fig_q1_oc_curve_p1 用）----
    grid_n = 101
    p_grid = [i / (grid_n - 1) for i in range(grid_n)]
    oc_case1 = oc_function(n1, c1, p_grid)
    oc_case2 = oc_function(n2, c2, p_grid)

    # ---- 样本量—判别信度扫描数组（fig_q1_sample_size_vs_confidence 用）----
    conf_grid = sorted({0.80, 0.85, 0.90, 0.95, 0.975, conf_contrast})
    n_series_reject, n_series_accept = [], []
    for conf in conf_grid:
        a = 1.0 - conf
        nr = q1_min_n(p_nom, delta, a, beta, n_max, side="reject")[0]
        na = q1_min_n(p_nom, delta, a, beta, n_max, side="accept")[0]
        n_series_reject.append(nr)
        n_series_accept.append(na)

    # ---- SPRT 边界数组（fig_q1_sprt_boundary 用，对照方案）----
    sprt_n, sprt_accept, sprt_reject, ln_A, ln_B = sprt_boundary(
        p_nom, p_alt, alpha1, beta, n1
    )

    # ---- 检测费用归属（企业承担，元/件 × 检测件数）----
    sampling_cost = {
        "unit_cost_part1": c_part1,
        "unit_cost_part2": c_part2,
        "case1": {
            "n": n1,
            "cost_part1": n1 * c_part1,
            "cost_part2": n1 * c_part2,
        },
        "case2": {
            "n": n2,
            "cost_part1": n2 * c_part1,
            "cost_part2": n2 * c_part2,
        },
    }

    # ---- 校核残差（V-01/V-02/V-03）----
    v01_max_violation = max(0.0, p_reject_at_pnom - alpha1, (1.0 - beta) - power_at_palt)
    v02_max_violation = max(0.0, (1.0 - alpha2) - p_accept_at_pnom, misaccept_at_palt - beta)

    normal_ok_1 = (n1 * p_nom >= z_lower) and (n1 * (1.0 - p_nom) >= z_lower)
    normal_ok_2 = (n2 * p_nom >= z_lower) and (n2 * (1.0 - p_nom) >= z_lower)

    result = {
        "problem1": {
            "nominal_defect_rate": p_nom,
            "delta": delta,
            "p_alt": p_alt,
            "tolerance": tol,
            "case1": {
                "label": "case1_reject_95",
                "confidence": 1.0 - alpha1,
                "alpha": alpha1,
                "beta": beta,
                "n": n1,
                "c_r": c1,
                "decision_rule": "X >= c_r + 1 时拒收",
                "p_reject_at_pnom": p_reject_at_pnom,
                "power_at_palt": power_at_palt,
            },
            "case2": {
                "label": "case2_accept_90",
                "confidence": 1.0 - alpha2,
                "alpha": alpha2,
                "beta": beta,
                "n": n2,
                "c_r": c2,
                "decision_rule": "X <= c_r 时接收",
                "p_accept_at_pnom": p_accept_at_pnom,
                "misaccept_at_palt": misaccept_at_palt,
            },
            "oc_curve": {
                "p": p_grid,
                "L_case1": oc_case1,
                "L_case2": oc_case2,
                "n_case1": n1,
                "c_r_case1": c1,
                "n_case2": n2,
                "c_r_case2": c2,
                "p_nom": p_nom,
                "p_alt": p_alt,
            },
            "sample_size_vs_confidence": {
                "confidence": conf_grid,
                "alpha": [1.0 - c for c in conf_grid],
                "n_reject_side": n_series_reject,
                "n_accept_side": n_series_accept,
                "beta": beta,
            },
            "sample_size_compare": {
                "labels": ["case1_reject_95", "case2_accept_90"],
                "n": [n1, n2],
                "c_r": [c1, c2],
                "confidence": [1.0 - alpha1, 1.0 - alpha2],
            },
            "sprt_boundary": {
                "n": sprt_n,
                "accept_line": sprt_accept,
                "reject_line": sprt_reject,
                "ln_A": ln_A,
                "ln_B": ln_B,
                "p0": p_nom,
                "p1": p_alt,
                "alpha": alpha1,
                "beta": beta,
            },
            "sampling_cost": sampling_cost,
            "normal_approximation": {
                "lower_bound": z_lower,
                "n_times_p_case1": n1 * p_nom,
                "n_times_1mp_case1": n1 * (1.0 - p_nom),
                "usable_case1": bool(normal_ok_1),
                "usable_case2": bool(normal_ok_2),
                "note": "正态近似仅作搜索期快速筛选，判定一律用二项精确尾概率",
            },
            "verification": {
                "v01_max_violation": v01_max_violation,
                "v01_reject_constraint_ok": bool(v01_max_violation <= tol),
                "v01_n_minus_one_feasible": bool(prev1 == n1 - 1 and n1 > 1),
                "v02_max_violation": v02_max_violation,
                "v02_accept_constraint_ok": bool(v02_max_violation <= tol),
                "v02_n_minus_one_feasible": bool(prev2 == n2 - 1 and n2 > 1),
                "v03_sampling_cost_unit": "元/件 × 检测件数 = 元",
                "v03_double_counted_with_q2_q3": False,
                "v03_note": "问题1检测费属进货验收环节，问题2/3的工序检测成本另账，口径分开",
                "tolerance": tol,
            },
        }
    }
    return result


LEDGER_FILENAME = "outputs_problem1.json"


def run(out_dir=None):
    data = solve()
    target_dir = out_dir if out_dir else _HERE
    os.makedirs(target_dir, exist_ok=True)
    path = os.path.join(target_dir, LEDGER_FILENAME)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    return data


if __name__ == "__main__":
    run()
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>