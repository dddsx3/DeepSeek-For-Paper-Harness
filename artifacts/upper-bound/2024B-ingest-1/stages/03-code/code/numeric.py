# -*- coding: utf-8 -*-
"""数值工具：二项尾概率表与 Beta 分位数（不依赖 numpy/scipy）。"""
import math


def binom_cdf_table(n, p):
    """返回长度 n+1 的列表 cdf，cdf[k] = P(X <= k)，X ~ Bin(n, p)。"""
    if p <= 0.0:
        return [1.0] * (n + 1)
    if p >= 1.0:
        out = [0.0] * (n + 1)
        out[n] = 1.0
        return out
    ratio = p / (1.0 - p)
    pmf = [0.0] * (n + 1)
    pmf[0] = math.exp(n * math.log1p(-p))
    for i in range(1, n + 1):
        pmf[i] = pmf[i - 1] * (n - i + 1) / i * ratio
    cdf = [0.0] * (n + 1)
    s = 0.0
    for i in range(n + 1):
        s += pmf[i]
        cdf[i] = s if s < 1.0 else 1.0
    cdf[n] = 1.0
    return cdf


def binom_sf(n, k, p):
    """P(X >= k)，X ~ Bin(n, p)。"""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    cdf = binom_cdf_table(n, p)
    return 1.0 - cdf[k - 1]


def _betacf(a, b, x):
    MAXIT = 400
    EPS = 3.0e-16
    FPMIN = 1.0e-300
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < FPMIN:
        d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < EPS:
            break
    return h


def betai(a, b, x):
    """正则化不完全 Beta 函数 I_x(a, b)。"""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbt = (math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
           + a * math.log(x) + b * math.log1p(-x))
    bt = math.exp(lbt)
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def beta_ppf(q, a, b):
    """Beta(a,b) 的 q 分位数（二分法，200 步足够 1e-15 精度）。"""
    if q <= 0.0:
        return 0.0
    if q >= 1.0:
        return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if betai(a, b, mid) < q:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)
