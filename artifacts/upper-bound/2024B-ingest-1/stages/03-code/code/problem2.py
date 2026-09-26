# -*- coding: utf-8 -*-
"""问题 2：四元 0-1 决策 (Z1, Z2, C, D) 下的期望利润最大化（16 组合全枚举）。

闭式解严格按 MODELING_REPORT §4.2 / DECLARATION EQ-Q2-YIELD、EQ-KF、EQ-KR、
EQ-KAPPA、EQ-Q2-RECUR、EQ-COST-Q2 实现。

口径要点（逐条防坑）：
  * 检测零配件时“得到 1 件可用件需买 1/(1-p_i) 件”，采购与检测费同时放大；
  * 回收件免采购的收益只落在 K_r（免采购价、仍付再检测费），利润式中不再抵扣；
  * 调换损失项严格写成 (1-q)(1-C) l，检测成品分支下整项为零。
"""

import itertools
from constants import TABLE1


def strategy_cost(params, Z1, Z2, C, D):
    p1, p2, p0 = params["p1"], params["p2"], params["p0"]
    a1, a2 = params["a1"], params["a2"]
    c1, c2, c0 = params["c1"], params["c2"], params["c0"]
    A, t, l, s = params["A"], params["t"], params["l"], params["s"]

    # EQ-Q2-YIELD
    Q1 = 1.0 - (1 - Z1) * p1
    Q2 = 1.0 - (1 - Z2) * p2
    q = (1.0 - p0) * Q1 * Q2

    # EQ-KF：新料一轮。采购与检测拆开，便于成本分解
    kf_proc = (Z1 * a1 / (1.0 - p1) + (1 - Z1) * a1) + (Z2 * a2 / (1.0 - p2) + (1 - Z2) * a2)
    kf_insp = Z1 * c1 / (1.0 - p1) + Z2 * c2 / (1.0 - p2)
    Kf = A + kf_proc + kf_insp

    # EQ-KR：回收料一轮（免采购，仍付再检测费）
    Kr = A + Z1 * c1 + Z2 * c2
    kappa = Kf - Kr

    m = 1.0 - D * (1.0 - q)
    if m <= 1e-12 or q <= 1e-12:
        return None

    # EQ-Q2-RECUR
    g = q / m
    R = (Kr + C * c0 + (1.0 - q) * (D * t + (1 - C) * l)) / m

    # EQ-COST-Q2
    disposal = D * t + (1 - C) * l
    U = (Kf + C * c0 + (1.0 - q) * (disposal + D * R)) / g
    profit = s - U

    # 成本分解：num_U = Kf + C c0 + (1-q)*disposal + chain_scale*[Kr + C c0 + (1-q)*disposal]
    scale = m / q              # = 1/g
    chain = (1.0 - q) * D / m  # 回收轮对 num_U 的权重
    breakdown = {
        "procurement": scale * kf_proc,
        "inspection": scale * (kf_insp + chain * (Z1 * c1 + Z2 * c2)),
        "assembly": scale * A * (1.0 + chain),
        "product_inspection": scale * C * c0 * (1.0 + chain),
        "disassembly": scale * (1.0 - q) * D * t * (1.0 + chain),
        "exchange_loss": scale * (1.0 - q) * (1.0 - C) * l * (1.0 + chain),
    }
    breakdown_sum = sum(breakdown.values())

    return {
        "Z1": Z1, "Z2": Z2, "C": C, "D": D,
        "Q1": Q1, "Q2": Q2, "q": q, "Kf": Kf, "Kr": Kr, "kappa": kappa,
        "g": g, "R": R, "U": U, "profit": profit,
        "cost_breakdown": breakdown,
        "breakdown_sum": breakdown_sum,
        "breakdown_residual": breakdown_sum - U,
    }


def evaluate_all(params):
    rows = []
    for Z1, Z2, C, D in itertools.product([0, 1], repeat=4):
        r = strategy_cost(params, Z1, Z2, C, D)
        if r is not None:
            rows.append(r)
    return rows


def optimize(params):
    rows = evaluate_all(params)
    best = None
    for r in rows:
        if best is None or r["profit"] > best["profit"] + 1e-12:
            best = r
    return best, rows


def _decision_tuple(r):
    return [int(r["Z1"]), int(r["Z2"]), int(r["C"]), int(r["D"])]


def solve():
    cases = []
    best_overall = None
    for params in TABLE1:
        best, rows = optimize(params)
        entry = {
            "case": params["case"],
            "params": {k: params[k] for k in ("p1", "p2", "p0", "a1", "c1", "a2", "c2", "A", "c0", "s", "l", "t")},
            "best": {
                "decision": _decision_tuple(best),
                "Z1": int(best["Z1"]), "Z2": int(best["Z2"]),
                "C": int(best["C"]), "D": int(best["D"]),
                "profit": best["profit"],
                "unit_cost": best["U"],
                "q": best["q"],
                "Kf": best["Kf"], "Kr": best["Kr"], "kappa": best["kappa"],
                "cost_breakdown": best["cost_breakdown"],
                "breakdown_residual": best["breakdown_residual"],
            },
            "strategies": [
                {
                    "decision": _decision_tuple(r),
                    "unit_cost": r["U"],
                    "profit": r["profit"],
                    "breakdown_residual": r["breakdown_residual"],
                }
                for r in rows
            ],
        }
        cases.append(entry)
        if best_overall is None or best["profit"] > best_overall["profit"]:
            best_overall = {"case": params["case"], "decision": _decision_tuple(best), "profit": best["profit"]}

    max_res = max(abs(c["best"]["breakdown_residual"]) for c in cases)
    return {
        "method": "16 组合全枚举 + 期望利润闭式比较",
        "strategy_count": len(cases[0]["strategies"]),
        "cases": cases,
        "best_combo": best_overall,
        "max_breakdown_residual": max_res,
    }
