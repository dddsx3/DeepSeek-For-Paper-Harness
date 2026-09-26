"""问题 2：四决策 0/1 枚举 + 拆解回路更新方程。

决策 (x1, x2, y, z) = (零配件1检测, 零配件2检测, 成品检测, 不合格成品拆解)，
共 2^4 = 16 种组合，对表 1 的六种情况逐一全枚举。

核心公式（ASM-11：回收件重新执行其检测决策）：
    Q     = pi1 * pi2 * (1 - p0)
    B_new = a1 + a2 + g0 + y*d0
    B_rec = x1*d1 + x2*d2 + g0 + y*d0
    z=1:  K_rec = [B_rec + (1-Q)*((1-y)w + s)] / Q
          K_new = B_new + (1-Q)*((1-y)w + s + K_rec)
    z=0:  K_new = [B_new + (1-Q)*(1-y)w] / Q
    Pi    = S - K_new
"""

from __future__ import annotations

from itertools import product

STRATEGIES = list(product((0, 1), repeat=4))  # (x1, x2, y, z)

CASE_PARAMS = [
    dict(case=1, p1=0.10, p2=0.10, p0=0.10, c1=4, c2=18, d1=2, d2=3, g0=6, d0=3, s=5, S=56, w=6),
    dict(case=2, p1=0.20, p2=0.20, p0=0.20, c1=4, c2=18, d1=2, d2=3, g0=6, d0=3, s=5, S=56, w=6),
    dict(case=3, p1=0.10, p2=0.10, p0=0.10, c1=4, c2=18, d1=2, d2=3, g0=6, d0=3, s=5, S=56, w=30),
    dict(case=4, p1=0.20, p2=0.20, p0=0.20, c1=4, c2=18, d1=2, d2=3, g0=6, d0=3, s=5, S=56, w=30),
    dict(case=5, p1=0.10, p2=0.10, p0=0.10, c1=4, c2=18, d1=2, d2=3, g0=6, d0=3, s=5, S=56, w=10),
    dict(case=6, p1=0.20, p2=0.20, p0=0.20, c1=4, c2=18, d1=2, d2=3, g0=6, d0=3, s=5, S=56, w=10),
]


def code_of(combo) -> int:
    x1, x2, y, z = combo
    return x1 * 8 + x2 * 4 + y * 2 + z


def evaluate(prm: dict, x1: int, x2: int, y: int, z: int) -> dict:
    p1, p2, p0 = prm["p1"], prm["p2"], prm["p0"]

    if x1:
        a1 = (prm["c1"] + prm["d1"]) / (1.0 - p1)
        pi1 = 1.0
    else:
        a1 = float(prm["c1"])
        pi1 = 1.0 - p1
    if x2:
        a2 = (prm["c2"] + prm["d2"]) / (1.0 - p2)
        pi2 = 1.0
    else:
        a2 = float(prm["c2"])
        pi2 = 1.0 - p2

    Q = pi1 * pi2 * (1.0 - p0)
    if Q < 1e-9:
        return {"profit": -1e9, "K_new": float("inf"), "Q": Q, "T": float("inf"),
                "feasible": False, "cost": {}, "cost_sum": float("nan")}

    B_new = a1 + a2 + prm["g0"] + y * prm["d0"]
    B_rec = x1 * prm["d1"] + x2 * prm["d2"] + prm["g0"] + y * prm["d0"]
    fail = (1 - y) * prm["w"]
    T = 1.0 / Q

    if z:
        K_rec = (B_rec + (1.0 - Q) * (fail + prm["s"])) / Q
        K_new = B_new + (1.0 - Q) * (fail + prm["s"] + K_rec)
        rec_rounds = (1.0 - Q) / Q
        first_rounds = 1.0
    else:
        K_new = (B_new + (1.0 - Q) * fail) / Q
        rec_rounds = 0.0
        first_rounds = T

    cost = {
        "buy": first_rounds * (
            (x1 * prm["c1"] / (1.0 - p1) + (1 - x1) * prm["c1"])
            + (x2 * prm["c2"] / (1.0 - p2) + (1 - x2) * prm["c2"])
        ),
        "inspect_parts": first_rounds * (
            x1 * prm["d1"] / (1.0 - p1) + x2 * prm["d2"] / (1.0 - p2)
        ) + rec_rounds * (x1 * prm["d1"] + x2 * prm["d2"]),
        "assembly": T * prm["g0"],
        "inspect_final": T * y * prm["d0"],
        "disassemble": rec_rounds * prm["s"],
        "exchange": (T - 1.0) * (1 - y) * prm["w"],
    }
    cost_sum = sum(cost.values())
    return {
        "profit": prm["S"] - K_new,
        "K_new": K_new,
        "Q": Q,
        "T": T,
        "feasible": True,
        "cost": cost,
        "cost_sum": cost_sum,
    }


def _sweep_combo(prm: dict, key: str, values) -> dict:
    grid, profits, codes = [], [], []
    for v in values:
        p = dict(prm)
        p[key] = v
        best_r, best_c = None, None
        for combo in STRATEGIES:
            r = evaluate(p, *combo)
            if best_r is None or r["profit"] > best_r["profit"]:
                best_r, best_c = r, combo
        grid.append(float(v))
        profits.append(best_r["profit"])
        codes.append(code_of(best_c))
    return {"grid": grid, "best_profit": profits, "best_code": codes}


def _sweep_defect(prm: dict, values) -> dict:
    grid, profits, codes = [], [], []
    for v in values:
        p = dict(prm)
        p["p1"] = p["p2"] = p["p0"] = v
        best_r, best_c = None, None
        for combo in STRATEGIES:
            r = evaluate(p, *combo)
            if best_r is None or r["profit"] > best_r["profit"]:
                best_r, best_c = r, combo
        grid.append(float(v))
        profits.append(best_r["profit"])
        codes.append(code_of(best_c))
    return {"grid": grid, "best_profit": profits, "best_code": codes}


def _first_change(grid, codes, ref) -> float:
    for g, c in zip(grid, codes):
        if c != ref:
            return float(g)
    return float(grid[-1])


def _first_bit(grid, codes, bit) -> float:
    for g, c in zip(grid, codes):
        if (c >> bit) & 1:
            return float(g)
    return float(grid[-1])


def run() -> dict:
    cases_out, profit_matrix, decision_matrix = [], [], []
    for prm in CASE_PARAMS:
        row, best_r, best_c = [], None, None
        for combo in STRATEGIES:
            r = evaluate(prm, *combo)
            row.append(r["profit"])
            if best_r is None or r["profit"] > best_r["profit"]:
                best_r, best_c = r, combo
        profit_matrix.append(row)
        decision_matrix.append([best_c[0], best_c[1], best_c[2], best_c[3]])
        cases_out.append({
            "case": prm["case"],
            "params": {k: prm[k] for k in ("p1", "p2", "p0", "c1", "c2", "d1", "d2", "g0", "d0", "s", "S", "w")},
            "x1": best_c[0],
            "x2": best_c[1],
            "y": best_c[2],
            "z": best_c[3],
            "code": code_of(best_c),
            "profit": best_r["profit"],
            "K_new": best_r["K_new"],
            "Q": best_r["Q"],
            "T": best_r["T"],
            "cost": best_r["cost"],
            "cost_sum": best_r["cost_sum"],
        })

    grid_p = [round(0.05 + 0.005 * i, 4) for i in range(41)]
    dr = _sweep_defect(CASE_PARAMS[0], grid_p)
    dr["flip_point"] = _first_change(dr["grid"], dr["best_code"], dr["best_code"][0])

    grid_d1 = [round(0.5 + 0.05 * i, 4) for i in range(91)]
    ic = _sweep_combo(CASE_PARAMS[1], "d1", grid_d1)
    ic["threshold"] = _first_change(ic["grid"], ic["best_code"], ic["best_code"][0])

    grid_w = [round(1.0 + 0.25 * i, 4) for i in range(117)]
    el = _sweep_combo(CASE_PARAMS[0], "w", grid_w)
    el["threshold"] = _first_bit(el["grid"], el["best_code"], 1)

    return {
        "strategy_codes": [code_of(c) for c in STRATEGIES],
        "strategies": [list(c) for c in STRATEGIES],
        "cases": cases_out,
        "case_profits": [c["profit"] for c in cases_out],
        "profit_matrix": profit_matrix,
        "decision_matrix": decision_matrix,
        "sensitivity": {
            "defect_rate": dr,
            "inspect_cost": ic,
            "exchange_loss": el,
        },
        "note": "六种情况均对 16 种 0/1 组合全枚举取期望利润最大者；cost_sum 与 K_new 的分项恒等式在 RESULTS.md 中给出校核。",
    }


if __name__ == "__main__":
    import json
    print(json.dumps(run(), ensure_ascii=False, indent=2))
