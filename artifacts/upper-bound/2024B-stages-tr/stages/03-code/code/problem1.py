"""问题 1：最小样本量抽样检测方案（二项分布精确计算）。

情形 (1)：95% 信度下认定次品率超过标称值则拒收
    min n  s.t. 存在 c: P(X>=c | p_nom) <= 0.05 且 P(X>=c | p_1) >= 0.90
情形 (2)：90% 信度下认定次品率不超过标称值则接收
    min n  s.t. 存在 k: P(X<=k | p_nom) >= 0.90 且 P(X<=k | p_1) <= 0.10

不使用正态近似：n 为百量级、p 为 0.1 时尾部概率误差可达一两个百分点，会直接影响
"n 是否最小"的判定。
"""

from __future__ import annotations

from scipy.stats import binom

P_NOM = 0.10
P_ALT = 0.20
ALPHA = 0.05
BETA = 0.10
POWER = 0.90
CONF2 = 0.90
N_MAX = 400


def smallest_reject_threshold(n: int, p: float, alpha: float) -> int:
    """最小的 c，使 P(X >= c | n, p) <= alpha（最严格且最具功效的判据）。"""
    lo, hi = 0, n + 1
    while lo < hi:
        mid = (lo + hi) // 2
        if float(binom.sf(mid - 1, n, p)) <= alpha:
            hi = mid
        else:
            lo = mid + 1
    return int(lo)


def smallest_accept_threshold(n: int, p: float, conf: float) -> int:
    """最小的 k，使 P(X <= k | n, p) >= conf。"""
    lo, hi = 0, n + 1
    while lo < hi:
        mid = (lo + hi) // 2
        if float(binom.cdf(mid, n, p)) >= conf:
            hi = mid
        else:
            lo = mid + 1
    return int(lo)


def solve_case1(n_max: int = N_MAX):
    for n in range(1, n_max + 1):
        c = smallest_reject_threshold(n, P_NOM, ALPHA)
        if c > n:
            continue
        power = float(binom.sf(c - 1, n, P_ALT))
        if power < POWER:
            continue
        return {
            "n": n,
            "c": c,
            "rule": "不合格品数 >= c 则拒收该批",
            "accept_at_pnom": float(binom.cdf(c - 1, n, P_NOM)),
            "reject_at_pnom": float(binom.sf(c - 1, n, P_NOM)),
            "accept_at_p1": float(binom.cdf(c - 1, n, P_ALT)),
            "reject_at_p1": power,
        }
    return {}


def solve_case2(n_max: int = N_MAX):
    for n in range(1, n_max + 1):
        k = smallest_accept_threshold(n, P_NOM, CONF2)
        if k > n:
            continue
        misuse = float(binom.cdf(k, n, P_ALT))
        if misuse > BETA:
            continue
        return {
            "n": n,
            "k": k,
            "c": k + 1,
            "rule": "不合格品数 <= k 则接收该批",
            "accept_at_pnom": float(binom.cdf(k, n, P_NOM)),
            "reject_at_pnom": float(binom.sf(k, n, P_NOM)),
            "accept_at_p1": misuse,
            "reject_at_p1": float(binom.sf(k, n, P_ALT)),
        }
    return {}


def run() -> dict:
    c1 = solve_case1()
    c2 = solve_case2()

    p_grid = [round(0.01 * i, 4) for i in range(0, 41)]
    oc1 = [float(binom.cdf(c1["c"] - 1, c1["n"], p)) for p in p_grid]
    oc2 = [float(binom.cdf(c2["k"], c2["n"], p)) for p in p_grid]

    n_grid = list(range(1, 131))
    s1_alpha, s1_power, s2_acc_nom, s2_acc_alt = [], [], [], []
    for n in n_grid:
        cc = smallest_reject_threshold(n, P_NOM, ALPHA)
        if cc <= n:
            s1_alpha.append(float(binom.sf(cc - 1, n, P_NOM)))
            s1_power.append(float(binom.sf(cc - 1, n, P_ALT)))
        else:
            s1_alpha.append(1.0)
            s1_power.append(0.0)
        kk = smallest_accept_threshold(n, P_NOM, CONF2)
        if kk <= n:
            s2_acc_nom.append(float(binom.cdf(kk, n, P_NOM)))
            s2_acc_alt.append(float(binom.cdf(kk, n, P_ALT)))
        else:
            s2_acc_nom.append(1.0)
            s2_acc_alt.append(0.0)

    n_b = list(range(1, 141))
    c_b = list(range(0, 41))
    feas1, feas2 = [], []
    for n in n_b:
        row1, row2 = [], []
        for c in c_b:
            if c > n:
                row1.append(0.0)
                row2.append(0.0)
                continue
            row1.append(1.0 if (float(binom.sf(c - 1, n, P_NOM)) <= ALPHA and float(binom.sf(c - 1, n, P_ALT)) >= POWER) else 0.0)
            row2.append(1.0 if (float(binom.cdf(c - 1, n, P_NOM)) >= CONF2 and float(binom.cdf(c - 1, n, P_ALT)) <= BETA) else 0.0)
        feas1.append(row1)
        feas2.append(row2)

    return {
        "nominal_p": P_NOM,
        "alternative_p": P_ALT,
        "alpha": ALPHA,
        "beta": BETA,
        "power": POWER,
        "case1": c1,
        "case2": c2,
        "oc_curve": {"p_grid": p_grid, "case1_accept": oc1, "case2_accept": oc2},
        "scan": {
            "n_grid": n_grid,
            "case1_reject_at_pnom": s1_alpha,
            "case1_reject_at_p1": s1_power,
            "case2_accept_at_pnom": s2_acc_nom,
            "case2_accept_at_p1": s2_acc_alt,
        },
        "boundary": {
            "n_grid": n_b,
            "c_grid": c_b,
            "case1_feasible": feas1,
            "case2_feasible": feas2,
        },
        "note": "情形(1)判据为 P(X>=c|p_nom)<=0.05 且 P(X>=c|p_1)>=0.90；情形(2)判据为 P(X<=k|p_nom)>=0.90 且 P(X<=k|p_1)<=0.10。两情形均取满足信度约束的最严格阈值。",
    }


if __name__ == "__main__":
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=2))
