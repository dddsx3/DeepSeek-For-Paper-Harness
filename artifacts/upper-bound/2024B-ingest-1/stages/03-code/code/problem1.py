"""问题 1：检测次数尽可能少的抽样检测方案。

方法（MS-Q1）：单侧二项检验的两点设计 + 整数样本量最小化精确枚举。
  情形(1) 95% 信度拒收：P(X >= c_r+1 | p_nom) <= alpha1 且 P(X >= c_r+1 | p_alt) >= 1-beta
  情形(2) 90% 信度接收：P(X <= c_r | p_nom) >= 1-alpha2 且 P(X <= c_r | p_alt) <= beta
"""

from scipy.stats import binom

import params as P


def _sf(k, n, p):
    """P(X > k) for X ~ Binomial(n, p)。"""
    return float(binom.sf(k, n, p))


def _cdf(k, n, p):
    """P(X <= k) for X ~ Binomial(n, p)。"""
    return float(binom.cdf(k, n, p))


def min_n_reject(p_nom, p_alt, alpha, beta, n_max):
    """情形(1)：95% 信度拒收情形的最小 n 与临界次品数 c_r。

    判定规则：X >= c_r + 1 时拒收。
    返回 (n, c_r, err_at_nom, power_at_alt)；无解返回 (None, None, None, None)。
    """
    for n in range(1, n_max + 1):
        for c in range(0, n + 1):
            err = _sf(c, n, p_nom)       # 拒收侧第一类错误
            power = _sf(c, n, p_alt)     # 备择点处功效
            if err <= alpha + P.TOL and power >= 1.0 - beta - P.TOL:
                return n, c, err, power
    return None, None, None, None


def min_n_accept(p_nom, p_alt, alpha, beta, n_max):
    """情形(2)：90% 信度接收情形的最小 n 与接收临界次品数 c_r。

    判定规则：X <= c_r 时接收。
    返回 (n, c_r, accept_prob_at_nom, accept_prob_at_alt)。
    """
    for n in range(1, n_max + 1):
        for c in range(0, n + 1):
            acc_nom = _cdf(c, n, p_nom)  # 接收侧置信水平
            acc_alt = _cdf(c, n, p_alt)  # 备择点处误收概率
            if acc_nom >= 1.0 - alpha - P.TOL and acc_alt <= beta + P.TOL:
                return n, c, acc_nom, acc_alt
    return None, None, None, None


def oc_curve(n, c, p_grid):
    """接收特性曲线 L(p) = P(X <= c | n, p)。"""
    return [_cdf(c, n, float(p)) for p in p_grid]


def sprt_boundary(p_nom, p_alt, alpha, beta, m_grid):
    """Wald 序贯概率比检验的接受/拒收边界（仅作对照，见 ASM-11）。"""
    import math
    if p_nom <= 0 or p_nom >= 1 or p_alt <= 0 or p_alt >= 1:
        return None
    slope = math.log((1.0 - p_nom) / (1.0 - p_alt)) / \
            math.log((p_alt * (1.0 - p_nom)) / (p_nom * (1.0 - p_alt)))
    lr = math.log((p_alt * (1.0 - p_nom)) / (p_nom * (1.0 - p_alt)))
    h_accept = math.log((1.0 - beta) / alpha) / lr    # 拒收上界
    h_reject = math.log(beta / (1.0 - alpha)) / lr    # 接收下界
    accept_line = [slope * m + h_reject for m in m_grid]
    reject_line = [slope * m + h_accept for m in m_grid]
    return accept_line, reject_line


def run():
    p_nom = P.NOMINAL_P
    p_alt = p_nom + P.Q1_DELTA
    alpha1 = P.ALPHA1
    alpha2 = P.ALPHA2
    beta = P.BETA
    nmax = P.Q1_NMAX

    # ---- 情形 (1) 95% 信度拒收 ----
    n1, c1, err1, pow1 = min_n_reject(p_nom, p_alt, alpha1, beta, nmax)
    if n1 is None:
        raise RuntimeError('情形(1) 在搜索上界内无可行解，请上调 Q1样本量搜索上界')
    # 真实约束距离（非空转）：max(拒收侧超出量, 功效缺口, 0)
    verify_gap1 = max(err1 - alpha1, beta - pow1, 0.0)

    # ---- 情形 (2) 90% 信度接收 ----
    n2, c2, acc2, acc_alt2 = min_n_accept(p_nom, p_alt, alpha2, beta, nmax)
    if n2 is None:
        raise RuntimeError('情形(2) 在搜索上界内无可行解，请上调 Q1样本量搜索上界')
    verify_gap2 = max((1.0 - alpha2) - acc2, acc_alt2 - beta, 0.0)

    # ---- OC 曲线（用情形(1)的 (n, c)）----
    p_grid = [round(0.005 * i, 4) for i in range(0, 81)]  # 0.000 ~ 0.400
    oc = oc_curve(n1, c1, p_grid)

    # ---- 样本量—判别信度关系 ----
    conf_grid = list(P.CONFIDENCE_GRID)
    n_rej, c_rej, n_acc, c_acc = [], [], [], []
    for conf in conf_grid:
        a = 1.0 - conf
        nn, cc, _, _ = min_n_reject(p_nom, p_alt, a, beta, nmax)
        n_rej.append(nn if nn is not None else -1)
        c_rej.append(cc if cc is not None else -1)
        nn2, cc2, _, _ = min_n_accept(p_nom, p_alt, a, beta, nmax)
        n_acc.append(nn2 if nn2 is not None else -1)
        c_acc.append(cc2 if cc2 is not None else -1)

    # ---- SPRT 对照边界 ----
    m_grid = list(range(0, 121))
    sb = sprt_boundary(p_nom, p_alt, alpha1, beta, m_grid)
    if sb is None:
        accept_line, reject_line = [], []
    else:
        accept_line, reject_line = sb

    # ---- 正态近似适用性（登记常数 NORMAL_APPROX_BOUND 的下界核验）----
    n_at_nom_ok = n1 * p_nom >= P.NORMAL_APPROX_BOUND and n1 * (1 - p_nom) >= P.NORMAL_APPROX_BOUND
    n_at_alt_ok = n1 * p_alt >= P.NORMAL_APPROX_BOUND and n1 * (1 - p_alt) >= P.NORMAL_APPROX_BOUND

    # ---- 检测费用归属（企业承担；与问题2/3工序检测成本分开入账）----
    unit_cost = P.SAMPLING_UNIT_COST

    return {
        'nominal_p': p_nom,
        'p_alt': p_alt,
        'case95': {
            'n': int(n1), 'c': int(c1),
            'err_reject_at_nom': err1,
            'power_at_alt': pow1,
            'verify_gap': verify_gap1,
        },
        'case90': {
            'n': int(n2), 'c': int(c2),
            'accept_prob_at_nom': acc2,
            'accept_prob_at_alt': acc_alt2,
            'verify_gap': verify_gap2,
        },
        'sampling_cost': {
            'unit_cost': unit_cost,
            'case95_cost': unit_cost * n1,
            'case90_cost': unit_cost * n2,
            'note': P.SAMPLING_UNIT_COST_NOTE,
        },
        'oc_curve': {
            'p_grid': p_grid,
            'accept_prob': oc,
            'n': int(n1), 'c': int(c1),
        },
        'sample_size_vs_confidence': {
            'confidence': conf_grid,
            'n_reject': n_rej, 'c_reject': c_rej,
            'n_accept': n_acc, 'c_accept': c_acc,
        },
        'sprt_boundary': {
            'm': m_grid,
            'accept_line': accept_line,
            'reject_line': reject_line,
        },
        'normal_approx': {
            'n_at_nom': int(n1),
            'n_at_alt_ok': bool(n_at_alt_ok),
            'ok': bool(n_at_nom_ok and n_at_alt_ok),
        },
    }


if __name__ == '__main__':
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=2))
