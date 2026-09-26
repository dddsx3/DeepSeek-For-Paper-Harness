# -*- coding: utf-8 -*-
"""问题 2：四元 0-1 决策 (Z1, Z2, C, D) 的期望利润最大化（16 组合全枚举）。

闭式解（EQ-Q2-YIELD / EQ-KF / EQ-KR / EQ-Q2-RECUR / EQ-COST-Q2 / EQ-PROFIT-Q2）：
  Q_i = 1 - (1-Z_i) p_i，q = (1-p_0) Q_1 Q_2
  K_f = A + Σ[ Z_i (a_i+c_i)/(1-p_i) + (1-Z_i) a_i ]   （检测时采购倍数 1/(1-p_i)）
  K_r = A + Σ Z_i c_i                                   （回收件免采购，只记于此）
  g   = q / (1 - D(1-q))
  R   = [ K_r + C c_0 + (1-q)( D t + (1-C) l ) ] / (1 - D(1-q))
  U   = [ K_f + C c_0 + (1-q)( D t + (1-C) l + D R ) ] / g
  Π   = s - U
"""
from params import TABLE1, TOL, SENS_GRID_STEPS, SENS_AMPLITUDE, BREAKEVEN_GRID, BREAKEVEN_X_RANGE, BREAKEVEN_Y_RANGE

DECISION_GRID = [(z1, z2, c, d)
                 for z1 in (0, 1) for z2 in (0, 1)
                 for c in (0, 1) for d in (0, 1)]


def decision_code(z1, z2, c, d):
    return z1 * 8 + z2 * 4 + c * 2 + d


def evaluate(params, z1, z2, c, d):
    """给定参数与决策，返回 U、Π 与分项成本分解；不可交付返回 None。"""
    p1, a1, c1 = params["p1"], params["a1"], params["c1"]
    p2, a2, c2 = params["p2"], params["a2"], params["c2"]
    p0, A, c0 = params["p0"], params["A"], params["c0"]
    s, l, t = params["s"], params["l"], params["t"]

    Q1 = 1.0 - (1 - z1) * p1
    Q2 = 1.0 - (1 - z2) * p2
    q = (1.0 - p0) * Q1 * Q2

    purchase = (z1 * a1 / (1.0 - p1) + (1 - z1) * a1
                + z2 * a2 / (1.0 - p2) + (1 - z2) * a2)
    insp_f = z1 * c1 / (1.0 - p1) + z2 * c2 / (1.0 - p2)
    insp_r = z1 * c1 + z2 * c2
    Kf = A + purchase + insp_f
    Kr = A + insp_r

    denom = 1.0 - d * (1.0 - q)
    if denom <= TOL or q <= TOL:
        return None

    g = q / denom
    R = (Kr + c * c0 + (1.0 - q) * (d * t + (1 - c) * l)) / denom
    U = (Kf + c * c0 + (1.0 - q) * (d * t + (1 - c) * l + d * R)) / g
    profit = s - U

    if d == 1:
        B = (1.0 - q) * d / denom
    else:
        B = 0.0
    scale = (1.0 + B) / g
    breakdown = {
        "assembly": A * scale,
        "procurement": purchase * scale,
        "inspection": (insp_f * (1.0 + B) + B * insp_r + c * c0 * (1.0 + B)) / g,
        "disassembly": (1.0 - q) * d * t * (1.0 + B) / g,
        "exchange_loss": (1.0 - q) * (1 - c) * l * (1.0 + B) / g,
    }
    breakdown["total"] = sum(breakdown.values())

    return {
        "Z1": z1, "Z2": z2, "C": c, "D": d,
        "code": decision_code(z1, z2, c, d),
        "Q1": Q1, "Q2": Q2, "q": q, "Kf": Kf, "Kr": Kr,
        "kappa": Kf - Kr, "g": g, "R": R, "U": U, "profit": profit,
        "breakdown": breakdown,
    }


def optimize(params):
    best = None
    all_res = []
    for (z1, z2, c, d) in DECISION_GRID:
        r = evaluate(params, z1, z2, c, d)
        if r is None:
            continue
        all_res.append(r)
        if best is None or r["profit"] > best["profit"]:
            best = r
    return best, all_res


def _scale(params, keys, factor):
    out = dict(params)
    for k in keys:
        out[k] = params[k] * factor
    return out


def _sensitivity_factors():
    lo = 1.0 - SENS_AMPLITUDE
    hi = 1.0 + SENS_AMPLITUDE
    steps = SENS_GRID_STEPS
    return [lo + (hi - lo) * i / (steps - 1) for i in range(steps)]


def _sensitivity_curve(params, keys):
    factors = _sensitivity_factors()
    profits = []
    for f in factors:
        b, _ = optimize(_scale(params, keys, f))
        profits.append(b["profit"] if b else None)
    return factors, profits


def _breakeven_grid(params):
    x0, x1 = BREAKEVEN_X_RANGE
    y0, y1 = BREAKEVEN_Y_RANGE
    npts = BREAKEVEN_GRID
    xs = [x0 + (x1 - x0) * i / (npts - 1) for i in range(npts)]
    ys = [y0 + (y1 - y0) * i / (npts - 1) for i in range(npts)]
    grid = []
    for y in ys:
        row = []
        for x in xs:
            p = dict(params)
            p["l"] = x
            p["t"] = y
            b, _ = optimize(p)
            row.append(b["code"] if b else -1)
        grid.append(row)
    return xs, ys, grid


def run():
    cases = []
    best_overall = None
    for params in TABLE1:
        best, all_res = optimize(params)
        cases.append({
            "case": params["case"],
            "params": params,
            "optimal": best,
            "strategies": all_res,
        })
        if best_overall is None or best["profit"] > best_overall[1]["profit"]:
            best_overall = (params["case"], best)

    base = TABLE1[0]
    f_defect, p_defect = _sensitivity_curve(base, ["p1", "p2", "p0"])
    f_proc, p_proc = _sensitivity_curve(base, ["a1", "a2"])
    f_insp, p_insp = _sensitivity_curve(base, ["c1", "c2", "c0"])
    f_exch, p_exch = _sensitivity_curve(base, ["l"])

    xs, ys, grid = _breakeven_grid(base)

    return {
        "cases": cases,
        "best_case": best_overall[0],
        "best_profit": best_overall[1]["profit"],
        "best_combo": {"Z1": best_overall[1]["Z1"], "Z2": best_overall[1]["Z2"],
                       "C": best_overall[1]["C"], "D": best_overall[1]["D"]},
        "sensitivity_defect_rate": {"factors": f_defect, "profits": p_defect},
        "sensitivity_unit_cost": {
            "factors": f_proc,
            "procurement": p_proc,
            "inspection": p_insp,
            "exchange_loss": p_exch,
            "factors_inspection": f_insp,
            "factors_exchange": f_exch,
        },
        "breakeven": {
            "x_name": "调换损失 l", "y_name": "拆解费用 t",
            "x_values": xs, "y_values": ys, "grid": grid,
        },
    }


if __name__ == "__main__":
    import json
    out = run()
    out.pop("cases")
    print(json.dumps(out, ensure_ascii=False, indent=2))
