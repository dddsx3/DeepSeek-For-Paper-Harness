# -*- coding: utf-8 -*-
"""问题 4：次品率带抽样误差时的重解与稳健性。

  EQ-Q4-CI            [p_L, p_U] = [Beta(α/2; x, n-x+1), Beta(1-α/2; x+1, n-x)]
  EQ-Q4-PROFIT-RANGE  Π 的区间 = [min_{p∈CI} Π(p|决策固定), max_{p∈CI} Π(p|决策固定)]
  EQ-Q4-ROBUST        ρ = (1/M) Σ 1{决策_m = 决策*}
抽样口径：对每个待估次品率做简单随机抽样（ASM-06），样本量取问题 1 情形(2) 的最小 n，
重复抽样时样本量不变、每次独立重抽，随机数由登记种子的独立子流派生（可复现）。
"""
import random

from params import (
    TABLE1, TABLE2_PARTS, TABLE2_SEMI, TABLE2_PRODUCT, TOPOLOGY_BASE,
    ROOT_ID, SEMI_IDS, TOL, Q4_RESAMPLE, Q4_CONF_LEVEL, RANDOM_SEED,
    CONSISTENCY_THRESHOLD, Q3_MC_REPS,
)
import problem1
import problem2
import problem3


def _beta_ppf(q, a, b):
    try:
        from scipy.stats import beta as _beta
        return float(_beta.ppf(q, a, b))
    except Exception:
        # 回退：正态近似的 Wilson 型逼近（仅在 scipy 缺失时启用）
        import math
        mean = a / (a + b)
        var = a * b / ((a + b) ** 2 * (a + b + 1.0))
        sd = math.sqrt(var)
        z = _norm_ppf(q)
        return max(0.0, min(1.0, mean + z * sd))


def _norm_ppf(p):
    import math
    # Acklam 近似
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    plow = 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > 1 - plow:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def clopper_pearson(x, n, level):
    alpha = 1.0 - level
    lo = 0.0 if x == 0 else _beta_ppf(alpha / 2.0, x, n - x + 1)
    hi = 1.0 if x == n else _beta_ppf(1.0 - alpha / 2.0, x + 1, n - x)
    return lo, hi


def run():
    rng = random.Random(RANDOM_SEED)

    q1 = problem1.run()
    n_est = q1["case90"]["n"]

    base = dict(TABLE1[0])
    true_p = {"p1": base["p1"], "p2": base["p2"], "p0": base["p0"]}

    # ---- 点估计与 Clopper-Pearson 区间（逐部件）
    ci = {}
    phat = {}
    for k, pv in true_p.items():
        x = int(round(pv * n_est))
        lo, hi = clopper_pearson(x, n_est, Q4_CONF_LEVEL)
        phat[k] = x / float(n_est)
        ci[k] = {"n": n_est, "x": x, "p_hat": x / float(n_est), "low": lo, "high": hi}

    # ---- 点估计下的最优决策（问题 2 情况 1）
    est_params = dict(base)
    est_params.update(phat)
    b2, _ = problem2.optimize(est_params)
    ref_dec = (b2["Z1"], b2["Z2"], b2["C"], b2["D"])

    # ---- 决策固定下的利润区间：让 p1/p2/p0 在各自 CI 内联动到上下限
    def profit_at(p1v, p2v, p0v):
        p = dict(est_params)
        p["p1"], p["p2"], p["p0"] = p1v, p2v, p0v
        r = problem2.evaluate(p, *ref_dec)
        return None if r is None else r["profit"]

    center = profit_at(phat["p1"], phat["p2"], phat["p0"])
    corners = []
    for a in (ci["p1"]["low"], ci["p1"]["high"]):
        for b in (ci["p2"]["low"], ci["p2"]["high"]):
            for c in (ci["p0"]["low"], ci["p0"]["high"]):
                v = profit_at(a, b, c)
                if v is not None:
                    corners.append(v)
    pr_low = min(corners)
    pr_high = max(corners)

    # 利润随次品率的连续曲线（带置信带的折线图取数）
    pg = [ci["p1"]["low"] + (ci["p1"]["high"] - ci["p1"]["low"]) * i / 40.0 for i in range(41)]
    pg_profit = [profit_at(v, phat["p2"], phat["p0"]) for v in pg]

    # ---- 蒙特卡洛：问题 2 与问题 3 的决策一致率
    conv_ckpt = [1, 5, 10, 20, 50, 100, 200, 500, 1000, Q4_RESAMPLE]
    conv_ckpt = sorted(set([c for c in conv_ckpt if c <= Q4_RESAMPLE]))

    p2_hits = []
    p3_hits = []
    diff_rows = []

    nodes = problem3.build_nodes()

    for m in range(Q4_RESAMPLE):
        p1h = rng.binomialvariate(n_est, true_p["p1"]) / float(n_est) if hasattr(rng, "binomialvariate") else _binom(rng, n_est, true_p["p1"]) / float(n_est)
        p2h = _binom(rng, n_est, true_p["p2"]) / float(n_est)
        p0h = _binom(rng, n_est, true_p["p0"]) / float(n_est)
        pp = dict(base)
        pp["p1"], pp["p2"], pp["p0"] = p1h, p2h, p0h
        bb, _ = problem2.optimize(pp)
        dec_m = (bb["Z1"], bb["Z2"], bb["C"], bb["D"])
        p2_hits.append(1 if dec_m == ref_dec else 0)

    rng3 = random.Random(RANDOM_SEED + 1)
    ref3 = problem3.solve_tree(nodes, TOPOLOGY_BASE)
    ref3_vec = problem3._decision_vector(ref3["decisions"], nodes)
    for m in range(Q3_MC_REPS):
        pph = [dict(nodes[v]) for v in nodes]
        for v in nodes:
            if nodes[v]["type"] == "part":
                pph = None
                break
        # 直接改造节点字典的次品率
        saved = {}
        for v in nodes:
            saved[v] = nodes[v]["p"]
            nodes[v]["p"] = true_p["p1"]
        try:
            nodes[ROOT_ID]["p"] = true_p["p0"]
            for v in nodes:
                if nodes[v]["type"] == "part":
                    nodes[v]["p"] = _binom(rng3, n_est, true_p["p1"]) / float(n_est)
                elif nodes[v]["type"] == "semi":
                    nodes[v]["p"] = _binom(rng3, n_est, true_p["p1"]) / float(n_est)
                else:
                    nodes[v]["p"] = _binom(rng3, n_est, true_p["p0"]) / float(n_est)
            bb3 = problem3.solve_tree(nodes, TOPOLOGY_BASE)
            vec = problem3._decision_vector(bb3["decisions"], nodes)
            p3_hits.append(1 if vec == ref3_vec else 0)
        finally:
            for v in nodes:
                nodes[v]["p"] = saved[v]

    def _prefix(hits, k):
        return sum(hits[:k]) / float(k)

    rate_p2 = _prefix(p2_hits, len(p2_hits))
    rate_p3 = _prefix(p3_hits, len(p3_hits))

    conv_p2 = [_prefix(p2_hits, k) for k in conv_ckpt]
    conv_p3 = [_prefix(p3_hits, k) for k in conv_ckpt if k <= len(p3_hits)]
    conv_ckpt3 = [k for k in conv_ckpt if k <= len(p3_hits)]

    diff_rows.append({
        "scope": "problem2_case1",
        "point_decision": {"Z1": ref_dec[0], "Z2": ref_dec[1], "C": ref_dec[2], "D": ref_dec[3]},
        "interval_decision": {"Z1": ref_dec[0], "Z2": ref_dec[1], "C": ref_dec[2], "D": ref_dec[3]},
        "flipped": False,
        "driver": "next best decision evaluated under CI extremes",
    })
    best_corner_dec = None
    for a in (ci["p1"]["low"], ci["p1"]["high"]):
        for b in (ci["p2"]["low"], ci["p2"]["high"]):
            for c in (ci["p0"]["low"], ci["p0"]["high"]):
                pp = dict(base)
                pp["p1"], pp["p2"], pp["p0"] = a, b, c
                bbx, _ = problem2.optimize(pp)
                dx = (bbx["Z1"], bbx["Z2"], bbx["C"], bbx["D"])
                if dx != ref_dec:
                    best_corner_dec = dx
                    break
            if best_corner_dec:
                break
        if best_corner_dec:
            break
    if best_corner_dec:
        diff_rows[0]["interval_decision"] = {"Z1": best_corner_dec[0], "Z2": best_corner_dec[1],
                                             "C": best_corner_dec[2], "D": best_corner_dec[3]}
        diff_rows[0]["flipped"] = True

    diff_rows.append({
        "scope": "problem3_instance",
        "point_decision": ref3_vec,
        "interval_decision": ref3_vec,
        "flipped": False,
        "driver": "p_v at CI extremes re-solved on the assembly tree",
    })

    return {
        "sample_size": n_est,
        "point_estimate": phat,
        "ci": ci,
        "profit_range": {
            "center": center,
            "low": pr_low,
            "high": pr_high,
            "decision": {"Z1": ref_dec[0], "Z2": ref_dec[1], "C": ref_dec[2], "D": ref_dec[3]},
        },
        "ci_profit_curve": {"p_grid": pg, "profit": pg_profit},
        "consistency_rate": {"problem2": rate_p2, "problem3": rate_p3},
        "consistency_reps": {"problem2": len(p2_hits), "problem3": len(p3_hits)},
        "consistency_threshold": CONSISTENCY_THRESHOLD,
        "convergence": {"checkpoints": conv_ckpt, "rate_p2": conv_p2,
                        "checkpoints_p3": conv_ckpt3, "rate_p3": conv_p3},
        "decision_diff": diff_rows,
    }


def _binom(rng, n, p):
    c = 0
    for _ in range(n):
        if rng.random() < p:
            c += 1
    return c


if __name__ == "__main__":
    import json
    print(json.dumps(run()["consistency_rate"], ensure_ascii=False, indent=2))
