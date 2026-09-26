# -*- coding: utf-8 -*-
"""灵敏度与稳健性扫描（用上登记常数“灵敏度扰动幅度”“盈亏平衡等高线格点数”
以及“蒙特卡洛重复次数”“随机种子”）。
"""

import random
from constants import MODEL_CONSTANTS, TABLE1
import problem2
import problem1


def _with(params, key, value):
    p = dict(params)
    p[key] = value
    return p


def q2_one_way():
    mc = MODEL_CONSTANTS
    amp = mc["灵敏度扰动幅度"]
    base = TABLE1[0]
    keys = ["p1", "p2", "p0", "a1", "a2", "c1", "c2", "c0", "A", "t", "l", "s"]
    out = []
    best0, _ = problem2.optimize(base)
    sig0 = [int(best0["Z1"]), int(best0["Z2"]), int(best0["C"]), int(best0["D"])]
    for k in keys:
        for sign, tag in ((-1.0, "minus"), (1.0, "plus")):
            v = base[k] * (1.0 + sign * amp)
            p = _with(base, k, v)
            b, _ = problem2.optimize(p)
            sig = [int(b["Z1"]), int(b["Z2"]), int(b["C"]), int(b["D"])]
            out.append({
                "param": k,
                "direction": tag,
                "baseline_value": base[k],
                "perturbed_value": v,
                "optimal_profit": b["profit"],
                "optimal_decision": sig,
                "decision_flipped": sig != sig0,
            })
    return {
        "amplitude": amp,
        "baseline_case": base["case"],
        "baseline_decision": sig0,
        "baseline_profit": best0["profit"],
        "scans": out,
        "flip_count": sum(1 for r in out if r["decision_flipped"]),
    }


def q2_breakeven():
    mc = MODEL_CONSTANTS
    grid = int(mc["盈亏平衡等高线格点数"])
    amp = mc["灵敏度扰动幅度"]
    base = TABLE1[0]
    rows = []
    flips = 0
    tot = 0
    for i in range(grid):
        c_mult = 1.0 - amp + 2.0 * amp * i / float(grid - 1)
        for j in range(grid):
            l_mult = 1.0 - amp + 2.0 * amp * j / float(grid - 1)
            p = dict(base)
            p["c1"] = base["c1"] * c_mult
            p["c2"] = base["c2"] * c_mult
            p["c0"] = base["c0"] * c_mult
            p["l"] = base["l"] * l_mult
            b, _ = problem2.optimize(p)
            sig = [int(b["Z1"]), int(b["Z2"]), int(b["C"]), int(b["D"])]
            tot += 1
            if sig != [1, 1, 1, 1] and sig != [0, 0, 0, 0]:
                pass
            rows.append({"inspection_cost_multiplier": c_mult,
                         "exchange_loss_multiplier": l_mult,
                         "decision": sig,
                         "profit": b["profit"]})
    decided = {}
    for r in rows:
        key = ",".join(str(x) for x in r["decision"])
        decided[key] = decided.get(key, 0) + 1
    return {
        "grid_points_per_axis": grid,
        "amplitude": amp,
        "decision_counts": decided,
        "total_points": tot,
        "flips": flips,
    }


def q2_mc_check():
    """用登记的“蒙特卡洛重复次数”和“随机种子”对表 1 情况 1 的最优策略做逐链仿真校验。"""
    mc = MODEL_CONSTANTS
    reps = int(mc["蒙特卡洛重复次数"])
    seed = int(mc["随机种子"])
    base = TABLE1[0]
    best, _ = problem2.optimize(base)
    Z1, Z2, C, D = int(best["Z1"]), int(best["Z2"]), int(best["C"]), int(best["D"])
    p1, p2, p0 = base["p1"], base["p2"], base["p0"]
    c1, c2, c0 = base["c1"], base["c2"], base["c0"]
    A, t, l = base["A"], base["t"], base["l"]

    Q1 = 1.0 - (1 - Z1) * p1
    Q2 = 1.0 - (1 - Z2) * p2
    q = (1.0 - p0) * Q1 * Q2
    Kf = A + Z1 * (base["a1"] + c1) / (1.0 - p1) + (1 - Z1) * base["a1"] \
        + Z2 * (base["a2"] + c2) / (1.0 - p2) + (1 - Z2) * base["a2"]
    Kr = A + Z1 * c1 + Z2 * c2

    rng = random.Random(seed)
    total_cost = 0.0
    total_good = 0
    for _ in range(reps):
        cost = Kf + C * c0
        good = rng.random() < q
        if not good:
            if C == 0:
                cost += l
            if D == 1:
                cost += t
                while True:
                    cost += Kr + C * c0
                    if rng.random() < q:
                        good = True
                        break
                    cost += t
                    if C == 0:
                        cost += l
        total_cost += cost
        total_good += 1 if good else 0

    if total_good == 0:
        return {"reps": reps, "mc_unit_cost": None, "analytic_unit_cost": best["U"], "abs_diff": None}
    mc_u = total_cost / total_good
    return {
        "reps": reps,
        "decision": [Z1, Z2, C, D],
        "mc_unit_cost": mc_u,
        "analytic_unit_cost": best["U"],
        "abs_diff": abs(mc_u - best["U"]),
    }


def solve():
    return {
        "q1_sample_size_vs_confidence": problem1.solve()["sample_size_vs_confidence"],
        "q2_one_way": q2_one_way(),
        "q2_breakeven": q2_breakeven(),
        "q2_mc_check": q2_mc_check(),
    }
