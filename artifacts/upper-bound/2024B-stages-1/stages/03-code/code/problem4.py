# -*- coding: utf-8 -*-
'''问题4：次品率置信区间传播 + maximin 稳健再决策 + 抽样量翻转临界。

次品率视为问题一情形一增强口径（n=109, gamma=0.95）下的抽样估计：
p_hat = x/n = 11/109；CP 精确区间 [p_L, p_U]（复用 problem1.cp_interval）。
利润对每个次品率严格单调减（problem2.monotone_ok 校验），端点代入即得利润带：
    pi_L(x) = pi(x; p_U, p_U, p_U)，pi_U(x) = pi(x; p_L, p_L, p_L)。
稳健方案 argmax pi_L（EQ-MAXIMIN）；带分离最小样本量 n* 由
w(n) = z_gamma*sqrt(p_hat*(1-p_hat)/n) 反解（EQ-FLIP，正态宽度近似）。
'''
import math

from problem1 import cp_interval
from problem2 import profit, SITUATIONS

GAMMA = 0.95
N_REF = 109
X_OBS = 11
Z95 = 1.959963984540054


def solve():
    res = {}
    sit = SITUATIONS[0]
    p_hat = X_OBS / N_REF
    p_lo, p_hi = cp_interval(X_OBS, N_REF, GAMMA)
    res['gamma'] = GAMMA
    res['n_ref'] = N_REF
    res['x_obs'] = X_OBS
    res['phat'] = p_hat
    res['p_lower'] = p_lo
    res['p_upper'] = p_hi
    xA = (0, 0, 0, 1)
    xB = (1, 0, 0, 1)
    piA = profit(xA, [p_hat, p_hat], p_hat, sit['L'], sit['dd'])
    piB = profit(xB, [p_hat, p_hat], p_hat, sit['L'], sit['dd'])
    res['pi1_point'] = piA
    res['pi2_point'] = piB
    loA = profit(xA, [p_hi, p_hi], p_hi, sit['L'], sit['dd'])
    hiA = profit(xA, [p_lo, p_lo], p_lo, sit['L'], sit['dd'])
    loB = profit(xB, [p_hi, p_hi], p_hi, sit['L'], sit['dd'])
    hiB = profit(xB, [p_lo, p_lo], p_lo, sit['L'], sit['dd'])
    res['band1_lo'] = loA
    res['band1_hi'] = hiA
    res['band2_lo'] = loB
    res['band2_hi'] = hiB
    res['maximin_value'] = max(loA, loB)
    # 稳健性代价：点估计最优方案与稳健方案一致时代价为 0
    res['robust_cost'] = max(0.0, piA - piB) if loA >= loB else max(0.0, piB - piA)

    def gap(w):
        return (profit(xA, [p_hat + w, p_hat + w], p_hat + w, sit['L'], sit['dd'])
                - profit(xB, [p_hat - w, p_hat - w], p_hat - w, sit['L'], sit['dd']))

    lo, hi = 1e-6, 0.05
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if gap(mid) > 0.0:
            hi = mid
        else:
            lo = mid
    w_star = hi
    res['nstar'] = (Z95 * (p_hat * (1 - p_hat)) ** 0.5 / w_star) ** 2
    for n, tag in ((109, 'n109'), (500, 'n500'), (1000, 'n1000'),
                   (2000, 'n2000'), (5000, 'n5000')):
        w = Z95 * (p_hat * (1 - p_hat) / n) ** 0.5
        res['gap_%s' % tag] = gap(w)
    res['gap_nstar'] = gap(w_star)
    return res


if __name__ == '__main__':
    r = solve()
    for key in sorted(r):
        print(key, r[key])
