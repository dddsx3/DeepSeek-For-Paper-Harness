# -*- coding: utf-8 -*-
'''问题1：抽样检验方案设计（单侧二项精确检验 + 最小样本量整数扫描）。

标称次品率 p0 = 0.10，两种信度方向相反：
  情形一 拒收：95% 信度认定 p > p0 则拒收。
      判定域 {X >= k}，k_n = min{k : P_{p0}(X >= k) <= 0.05}，n 取判定域非空的最小 n。
      建议口径加功效约束 P_{p1}(X >= k) >= 0.90，备择 p1 = 2*p0 = 0.20。
  情形二 接收：90% 信度认定 p <= p0 则接收。
      判定域 {X <= k'}，k'_n = max{k : P_{p0}(X <= k) <= 0.10}，n 取最小。
      建议口径加功效约束 P_{p0/2}(X <= k') >= 0.90，备择 p0/2 = 0.05。
全程精确二项尾概率（弃正态近似定案）；置信区间用 Clopper-Pearson 精确区间，
供问题4直接复用（EQ-BINOM-TAIL / EQ-REJECT-RULE / EQ-ACCEPT-RULE / EQ-NMIN / EQ-CP-CI）。
'''
from scipy.stats import binom, beta

P0 = 0.10
ALPHA_REJ = 0.05
ALPHA_ACC = 0.10
POWER_MIN = 0.90
P1_REJ = 0.20
P1_ACC = 0.05


def tail_ge(n, k, p):
    '''P(X >= k)，X ~ B(n, p)。'''
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    return float(binom.sf(k - 1, n, p))


def tail_le(n, k, p):
    '''P(X <= k)。'''
    if k < 0:
        return 0.0
    if k >= n:
        return 1.0
    return float(binom.cdf(k, n, p))


def scheme_reject(p0, alpha, p1=None, power_min=None, n_max=500000):
    '''最小 n 拒收方案 (n, k)：P_{p0}(X>=k)<=alpha，可选 P_{p1}(X>=k)>=power_min。
    给定 n 下最优阈值为满足显著性的最小 k（此时功效最大）。'''
    n = 1
    while n <= n_max:
        for k in range(1, n + 1):
            if tail_ge(n, k, p0) <= alpha:
                if p1 is None or tail_ge(n, k, p1) >= power_min:
                    return n, k
                break  # 更大的 k 显著性更保守、功效更低，无需再扫
        n += 1
    raise RuntimeError('reject scheme scan did not converge')


def scheme_accept(p0, alpha, p_low=None, power_min=None, n_max=500000):
    '''最小 n 接收方案 (n, k')：P_{p0}(X<=k')<=alpha，可选 P_{p_low}(X<=k')>=power_min。
    给定 n 下最优阈值为满足显著性的最大 k'（此时功效最大）。'''
    n = 1
    while n <= n_max:
        k_star = None
        for k in range(n, -1, -1):
            if tail_le(n, k, p0) <= alpha:
                k_star = k
                break
        if k_star is not None:
            if p_low is None or tail_le(n, k_star, p_low) >= power_min:
                return n, k_star
        n += 1
    raise RuntimeError('accept scheme scan did not converge')


def cp_interval(x, n, gamma):
    '''Clopper-Pearson 精确置信区间 [p_L, p_U]（EQ-CP-CI）。'''
    a = (1.0 - gamma) / 2.0
    lo = 0.0 if x <= 0 else float(beta.ppf(a, x, n - x + 1))
    hi = 1.0 if x >= n else float(beta.ppf(1.0 - a, x + 1, n - x))
    return lo, hi


def solve():
    res = {}
    n1, k1 = scheme_reject(P0, ALPHA_REJ)
    res['n_rej_pure'] = n1
    res['k_rej_pure'] = k1
    res['size_rej_pure'] = tail_ge(n1, k1, P0)
    res['power_rej_pure'] = tail_ge(n1, k1, P1_REJ)
    n2, k2 = scheme_reject(P0, ALPHA_REJ, p1=P1_REJ, power_min=POWER_MIN)
    res['n_rej_enh'] = n2
    res['k_rej_enh'] = k2
    res['size_rej_enh'] = tail_ge(n2, k2, P0)
    res['power_rej_enh'] = tail_ge(n2, k2, P1_REJ)
    n3, k3 = scheme_accept(P0, ALPHA_ACC)
    res['n_acc_pure'] = n3
    res['k_acc_pure'] = k3
    res['size_acc_pure'] = tail_le(n3, k3, P0)
    res['power_acc_pure'] = tail_le(n3, k3, P1_ACC)
    n4, k4 = scheme_accept(P0, ALPHA_ACC, p_low=P1_ACC, power_min=POWER_MIN)
    res['n_acc_enh'] = n4
    res['k_acc_enh'] = k4
    res['size_acc_enh'] = tail_le(n4, k4, P0)
    res['power_acc_enh'] = tail_le(n4, k4, P1_ACC)
    # 最小样本量随标称值曲线（纯约束口径）
    for p0 in (0.05, 0.10, 0.15, 0.20):
        tag = '%03d' % round(p0 * 1000)
        nr, _kr = scheme_reject(p0, ALPHA_REJ)
        na, _ka = scheme_accept(p0, ALPHA_ACC)
        res['n_rej_p' + tag] = nr
        res['n_acc_p' + tag] = na
    # 两条 OC 曲线（接收方案与增强拒收方案）
    for p in (0.02, 0.05, 0.10, 0.15, 0.20):
        tag = '%03d' % round(p * 1000)
        res['oc_acc_p' + tag] = tail_le(n3, k3, p)
        res['oc_rej_p' + tag] = tail_le(n2, k2 - 1, p)
    return res


if __name__ == '__main__':
    r = solve()
    for key in sorted(r):
        print(key, r[key])
