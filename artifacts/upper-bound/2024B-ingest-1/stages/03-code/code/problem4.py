# -*- coding: utf-8 -*-
"""问题 4：次品率带抽样误差时的重解与稳健性。

覆盖：
  * 问题 2 表 1 的全部六种情形（逐情形独立做区间、端点重解与蒙特卡洛一致率）；
  * 问题 3 的 12 节点装配树（逐节点抽样、逐节点蒙特卡洛重解）。

口径：
  * 点估计 p_hat = x/n；区间用 Clopper-Pearson 精确区间（EQ-Q4-CI）；
  * 利润区间在“决策固定”下传播（EQ-Q4-PROFIT-RANGE）；
  * 一致率 rho = 重复抽样下最优决策与点估计决策相同的比例（EQ-Q4-ROBUST）。
"""

import random
from constants import MODEL_CONSTANTS, TABLE1, TABLE2, IMPLEMENTATION_PARAMS
from numeric import beta_ppf
import problem2
import problem3


def clopper_pearson(x, n, conf):
    """EQ-Q4-CI：[Beta(a/2; x, n-x+1), Beta(1-a/2; x+1, n-x)]。"""
    alpha = 1.0 - conf
    lo = 0.0 if x == 0 else beta_ppf(alpha / 2.0, x, n - x + 1)
    hi = 1.0 if x == n else beta_ppf(1.0 - alpha / 2.0, x + 1, n - x)
    return lo, hi


def _binom_sample(n, p, rng):
    if p <= 0.0:
        return 0
    if p >= 1.0:
        return n
    return sum(1 for _ in range(n) if rng.random() < p)


def _clip(p):
    return min(max(p, 1e-6), 1.0 - 1e-6)


def _q2_case(case_params, n_sample, conf, reps, rng):
    p_keys = ["p1", "p2", "p0"]
    xs = [int(round(n_sample * case_params[k])) for k in p_keys]
    phat = [x / float(n_sample) for x in xs]
    cis = [clopper_pearson(x, n_sample, conf) for x in xs]

    def with_rates(rates):
        p = dict(case_params)
        for k, v in zip(p_keys, rates):
            p[k] = _clip(v)
        return p

    params_hat = with_rates(phat)
    best, _ = problem2.optimize(params_hat)
    point_dec = [int(best["Z1"]), int(best["Z2"]), int(best["C"]), int(best["D"])]

    # 利润区间：决策固定，参数在置信区间内取角点（利润对三个次品率单调递减）
    profits = []
    for bits in range(8):
        rates = []
        for j in range(3):
            rates.append(cis[j][1] if (bits >> j) & 1 else cis[j][0])
        r = problem2.strategy_cost(with_rates(rates),
                                   point_dec[0], point_dec[1], point_dec[2], point_dec[3])
        if r is not None:
            profits.append(r["profit"])
    lo_p, hi_p = (min(profits), max(profits)) if profits else (None, None)

    match = 0
    for _ in range(reps):
        rates = [_binom_sample(n_sample, phat[j], rng) / float(n_sample) for j in range(3)]
        b, _ = problem2.optimize(with_rates(rates))
        if [int(b["Z1"]), int(b["Z2"]), int(b["C"]), int(b["D"])] == point_dec:
            match += 1
    rate = match / float(reps)

    return {
        "case": case_params["case"],
        "sample_size": n_sample,
        "x": xs,
        "p_hat": phat,
        "ci": [list(c) for c in cis],
        "point_decision": point_dec,
        "point_profit": best["profit"],
        "point_unit_cost": best["U"],
        "profit_range": [lo_p, hi_p],
        "consistency_rate": rate,
        "reps": reps,
        "rate_standard_error": (rate * (1.0 - rate) / reps) ** 0.5,
    }


def _q3(n_sample, conf, reps, rng):
    node_names = ["P%d" % i for i in range(1, 9)] + ["S1", "S2", "S3", "F"]
    base_rate = {}
    for n in node_names:
        base_rate[n] = TABLE2["prod_p"]

    phat = {}
    xmap = {}
    ci = {}
    for n in node_names:
        x = int(round(n_sample * base_rate[n]))
        xmap[n] = x
        phat[n] = x / float(n_sample)
        ci[n] = list(clopper_pearson(x, n_sample, conf))

    res_point = problem3.solve(p_override=phat)
    point_sig = {d["node"]: (d["Z"], d["D"]) for d in res_point["decision_table"]}

    lo_rate = {n: ci[n][0] for n in node_names}
    hi_rate = {n: ci[n][1] for n in node_names}
    lo_profit = problem3.solve(p_override=lo_rate)["profit"]
    hi_profit = problem3.solve(p_override=hi_rate)["profit"]

    match = 0
    reps = max(1, int(reps))
    for _ in range(reps):
        rates = {}
        for n in node_names:
            rates[n] = _clip(_binom_sample(n_sample, phat[n], rng) / float(n_sample))
        try:
            r = problem3.solve(p_override=rates)
        except Exception:
            continue
        sig = {d["node"]: (d["Z"], d["D"]) for d in r["decision_table"]}
        if sig == point_sig:
            match += 1
    rate = match / float(reps)

    return {
        "sample_size": n_sample,
        "x": xmap,
        "p_hat": phat,
        "ci": ci,
        "point_decision": {k: list(v) for k, v in point_sig.items()},
        "point_profit": res_point["profit"],
        "profit_range": [min(lo_profit, hi_profit), max(lo_profit, hi_profit)],
        "consistency_rate": rate,
        "reps": reps,
        "rate_standard_error": (rate * (1.0 - rate) / reps) ** 0.5,
    }


def solve():
    mc = MODEL_CONSTANTS
    conf = mc["Q4置信区间置信水平"]
    reps2 = int(mc["Q4重抽样次数"])
    reps3 = int(IMPLEMENTATION_PARAMS["q3_mc_reps"])
    n_sample = int(IMPLEMENTATION_PARAMS["q4_sample_size"])
    thr = mc["决策一致率判定阈值"]
    seed = int(mc["随机种子"])

    rng2 = random.Random(seed)
    rng3 = random.Random(seed + 1)

    q2_cases = [_q2_case(c, n_sample, conf, reps2, rng2) for c in TABLE1]
    q3_res = _q3(n_sample, conf, reps3, rng3)

    diff = []
    for c in q2_cases:
        diff.append({
            "scope": "q2_case_%d" % c["case"],
            "point_decision": c["point_decision"],
            "consistency_rate": c["consistency_rate"],
            "robust": bool(c["consistency_rate"] >= thr),
        })
    diff.append({
        "scope": "q3_tree",
        "consistency_rate": q3_res["consistency_rate"],
        "robust": bool(q3_res["consistency_rate"] >= thr),
    })

    return {
        "method": "点估计重解 + Clopper-Pearson 区间在决策固定下传播 + 蒙特卡洛重抽样一致率",
        "confidence_level": conf,
        "sample_size": n_sample,
        "sample_size_note": "题面未给问题 4 的样本量；实现取 n=100、按各情形标称次品率取整观测次品数（p_hat 与标称值一致），口径见 IMPLEMENTATION_PARAMS",
        "consistency_threshold": thr,
        "q2": {"cases": q2_cases},
        "q3": q3_res,
        "decision_diff": diff,
    }
