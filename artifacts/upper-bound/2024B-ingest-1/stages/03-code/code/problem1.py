# -*- coding: utf-8 -*-
"""问题 1：检测次数尽可能少的抽样检测方案。

方法：单侧二项检验的两点设计 + 整数样本量最小化精确枚举。
  EQ-Q1-REJECT：n^(1) = min{ n : ∃ c_r, P(X>=c_r+1|p_nom) <= α1 且 P(X>=c_r+1|p_alt) >= 1-β }
  EQ-Q1-ACCEPT：n^(2) = min{ n : ∃ c_r, P(X<=c_r|p_nom) >= 1-α2 且 P(X<=c_r|p_alt) <= β }
两个情形的尾侧不同，方案不可互换。
"""
from math import exp, log

from params import (
    P_NOMINAL, CONF_REJECT, CONF_ACCEPT,
    Q1_DELTA, Q1_ALPHA1, Q1_ALPHA2, Q1_BETA, Q1_N_MAX, TOL,
    OC_GRID_POINTS, OC_P_MAX, CONF_SWEEP, SENS_CONF_CONTRAST, TABLE1,
)


def binom_cdf_table(n, p):
    """返回长度 n+1 的列表 tab，tab[k] = P(X <= k)，X ~ B(n, p)。递推构造，避免阶乘溢出。"""
    tab = [0.0] * (n + 1)
    if p <= 0.0:
        return [1.0] * (n + 1)
    if p >= 1.0:
        return [0.0] * n + [1.0]
    ratio = p / (1.0 - p)
    pmf = exp(n * log(1.0 - p))
    cum = 0.0
    for k in range(n + 1):
        cum += pmf
        tab[k] = cum if cum < 1.0 else 1.0
        pmf = pmf * (n - k) * ratio / (k + 1)
    return tab


def binom_cdf(n, cr, p):
    """P(X <= cr)，单点求值。"""
    if cr < 0:
        return 0.0
    if cr >= n:
        return 1.0
    if p <= 0.0:
        return 1.0
    if p >= 1.0:
        return 0.0
    ratio = p / (1.0 - p)
    pmf = exp(n * log(1.0 - p))
    cum = 0.0
    for k in range(cr + 1):
        cum += pmf
        pmf = pmf * (n - k) * ratio / (k + 1)
    return cum if cum < 1.0 else 1.0


def solve_case_reject(p_nom, p_alt, alpha, beta, n_max):
    """情形(1)：95% 信度下认定超标即拒收。判据 X >= c_r+1 时拒收。"""
    for n in range(1, n_max + 1):
        cdf_nom = binom_cdf_table(n, p_nom)
        cdf_alt = binom_cdf_table(n, p_alt)
        for cr in range(0, n + 1):
            if (1.0 - cdf_nom[cr]) <= alpha + TOL and (1.0 - cdf_alt[cr]) >= (1.0 - beta) - TOL:
                return n, cr
    return None, None


def solve_case_accept(p_nom, p_alt, alpha, beta, n_max):
    """情形(2)：90% 信度下认定不超标即接收。判据 X <= c_r 时接收。"""
    for n in range(1, n_max + 1):
        cdf_nom = binom_cdf_table(n, p_nom)
        cdf_alt = binom_cdf_table(n, p_alt)
        for cr in range(0, n + 1):
            if cdf_nom[cr] >= (1.0 - alpha) - TOL and cdf_alt[cr] <= beta + TOL:
                return n, cr
    return None, None


def oc_curve(n, cr, p_grid):
    """EQ-OC：L(p) = P(X <= c_r | p)。"""
    return [binom_cdf(n, cr, p) for p in p_grid]


def run():
    p_nom = P_NOMINAL
    p_alt = p_nom + Q1_DELTA

    n95, c95 = solve_case_reject(p_nom, p_alt, Q1_ALPHA1, Q1_BETA, Q1_N_MAX)
    n90, c90 = solve_case_accept(p_nom, p_alt, Q1_ALPHA2, Q1_BETA, Q1_N_MAX)
    if n95 is None or n90 is None:
        raise RuntimeError("问题 1 未在搜索上界内找到可行解")

    # 规划式两端复核值

    t1_err = 1.0 - binom_cdf(n95, c95, p_nom)
    t1_pow = 1.0 - binom_cdf(n95, c95, p_alt)
    t2_acc_nom = binom_cdf(n90, c90, p_nom)
    t2_acc_alt = binom_cdf(n90, c90, p_alt)

    # OC 曲线数据（折线图：横轴真实次品率 p，纵轴接收概率 L(p)）
    p_grid = [OC_P_MAX * i / (OC_GRID_POINTS - 1) for i in range(OC_GRID_POINTS)]
    L = oc_curve(n90, c90, p_grid)

    # 样本量—判别信度关系（折线图）
    conf_list = list(CONF_SWEEP)
    if SENS_CONF_CONTRAST not in conf_list:
        conf_list.append(SENS_CONF_CONTRAST)
    conf_list = sorted(set(conf_list))
    n95_sweep = []
    n90_sweep = []
    for c in conf_list:
        a = 1.0 - c
        m1, _ = solve_case_reject(p_nom, p_alt, a, Q1_BETA, Q1_N_MAX)
        m2, _ = solve_case_accept(p_nom, p_alt, a, Q1_BETA, Q1_N_MAX)
        n95_sweep.append(m1)
        n90_sweep.append(m2)

    # 检测费用归属：企业承担（F-MECH-INSPECT-COST），按表 1 情况 1 的单件检测成本折算
    c_part1 = TABLE1[0]["c1"]
    c_part2 = TABLE1[0]["c2"]

    return {
        "case95": {
            "n": n95, "c_r": c95, "p_nom": p_nom, "p_alt": p_alt,
            "alpha": Q1_ALPHA1, "beta": Q1_BETA, "confidence": CONF_REJECT,
            "reject_prob_at_nom": t1_err, "power_at_alt": t1_pow,
        },
        "case90": {
            "n": n90, "c_r": c90, "p_nom": p_nom, "p_alt": p_alt,
            "alpha": Q1_ALPHA2, "beta": Q1_BETA, "confidence": CONF_ACCEPT,
            "accept_prob_at_nom": t2_acc_nom, "accept_prob_at_alt": t2_acc_alt,
        },
        "oc_curve": {
            "n": n90, "c_r": c90,
            "p_grid": p_grid, "accept_prob": L,
            "L_at_p_nom": binom_cdf(n90, c90, p_nom),
            "L_at_p_alt": binom_cdf(n90, c90, p_alt),
        },
        "confidence_sweep": {
            "confidence": conf_list,
            "n_case95": n95_sweep,
            "n_case90": n90_sweep,
        },
        "sampling_cost": {
            "unit_cost_part1": c_part1,
            "unit_cost_part2": c_part2,
            "case95_cost_part1": n95 * c_part1,
            "case95_cost_part2": n95 * c_part2,
            "case90_cost_part1": n90 * c_part1,
            "case90_cost_part2": n90 * c_part2,
        },
    }


if __name__ == "__main__":
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=2))
