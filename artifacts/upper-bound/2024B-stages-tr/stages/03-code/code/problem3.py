"""问题 3：分层装配网络节点算子递推 + 全枚举。

拓扑（题面 2 工序 8 零配件算例）：
    半成品1 <- 零配件 1,2,3
    半成品2 <- 零配件 4,5,6
    半成品3 <- 零配件 7,8
    成品    <- 半成品 1,2,3

节点算子（自底向上）：
    Q_v     = prod(pi_u) * (1 - p_v)
    B_new   = sum(a_u) + g_v + x_v*d_v
    B_rec   = sum(x_u*d_u) + g_v + x_v*d_v
    x_v=1,z_v=1: K_rec = [B_rec + (1-Q_v)*s_v]/Q_v
                 K_new = B_new + (1-Q_v)*(s_v + K_rec),  a_v = K_new, pi_v = 1
    x_v=1,z_v=0: K_new = B_new/Q_v,  a_v = K_new, pi_v = 1
    x_v=0:       a_v = B_new,        pi_v = Q_v        （ASM-12：z_v 不可执行）
成品节点：失败额外支出改为 (1-x_0)*w + z_0*s_0。
"""

from __future__ import annotations

from itertools import product

PARTS = [
    {"id": 1, "p": 0.10, "c": 2, "d": 1},
    {"id": 2, "p": 0.10, "c": 8, "d": 1},
    {"id": 3, "p": 0.10, "c": 12, "d": 2},
    {"id": 4, "p": 0.10, "c": 2, "d": 1},
    {"id": 5, "p": 0.10, "c": 8, "d": 1},
    {"id": 6, "p": 0.10, "c": 12, "d": 2},
    {"id": 7, "p": 0.10, "c": 8, "d": 1},
    {"id": 8, "p": 0.10, "c": 2, "d": 1},
]

HALFS = [
    {"id": "H1", "inputs": [0, 1, 2], "p": 0.10, "g": 8, "d": 4, "s": 6},
    {"id": "H2", "inputs": [3, 4, 5], "p": 0.10, "g": 8, "d": 4, "s": 6},
    {"id": "H3", "inputs": [6, 7], "p": 0.10, "g": 8, "d": 4, "s": 6},
]

FINAL = {"p": 0.10, "g": 8, "d": 6, "s": 10, "S": 200, "w": 40}

HALF_OPTS = [(0, 0), (1, 0), (1, 1)]          # (x_s, z_s)，z_s 仅在 x_s=1 时可用
FINAL_OPTS = [(0, 0), (0, 1), (1, 0), (1, 1)]  # 成品不检测时仍有市场退回可拆解


def evaluate(x_parts, half_opts, final_opt, p_parts=None, p_halfs=None, p_final=None) -> dict:
    pp = list(p_parts) if p_parts is not None else [q["p"] for q in PARTS]
    ph = list(p_halfs) if p_halfs is not None else [q["p"] for q in HALFS]
    pf = float(p_final) if p_final is not None else FINAL["p"]

    a_parts, pi_parts, xd_parts = [], [], []
    for i, q in enumerate(PARTS):
        p = pp[i]
        if x_parts[i]:
            a_parts.append((q["c"] + q["d"]) / (1.0 - p))
            pi_parts.append(1.0)
            xd_parts.append(float(q["d"]))
        else:
            a_parts.append(float(q["c"]))
            pi_parts.append(1.0 - p)
            xd_parts.append(0.0)

    a_halfs, pi_halfs, xd_halfs = [], [], []
    for j, h in enumerate(HALFS):
        x_h, z_h = half_opts[j]
        a_in = sum(a_parts[i] for i in h["inputs"])
        pi_in = 1.0
        for i in h["inputs"]:
            pi_in *= pi_parts[i]
        Q = pi_in * (1.0 - ph[j])
        if Q < 1e-12:
            return {"profit": -1e9, "K_new": float("inf"), "Q": Q, "T": float("inf"), "feasible": False}
        B_new = a_in + h["g"] + x_h * h["d"]
        B_rec = sum(xd_parts[i] for i in h["inputs"]) + h["g"] + x_h * h["d"]
        if x_h == 1 and z_h == 1:
            K_rec = (B_rec + (1.0 - Q) * h["s"]) / Q
            K_new = B_new + (1.0 - Q) * (h["s"] + K_rec)
            a_halfs.append(K_new)
            pi_halfs.append(1.0)
            xd_halfs.append(float(h["d"]))
        elif x_h == 1:
            K_new = B_new / Q
            a_halfs.append(K_new)
            pi_halfs.append(1.0)
            xd_halfs.append(float(h["d"]))
        else:
            a_halfs.append(B_new)
            pi_halfs.append(Q)
            xd_halfs.append(0.0)

    x_f, z_f = final_opt
    a_in = sum(a_halfs)
    pi_in = pi_halfs[0] * pi_halfs[1] * pi_halfs[2]
    Q = pi_in * (1.0 - pf)
    if Q < 1e-12:
        return {"profit": -1e9, "K_new": float("inf"), "Q": Q, "T": float("inf"), "feasible": False}
    B_new = a_in + FINAL["g"] + x_f * FINAL["d"]
    B_rec = sum(xd_halfs) + FINAL["g"] + x_f * FINAL["d"]
    fail = (1.0 - x_f) * FINAL["w"]
    T = 1.0 / Q
    if z_f == 1:
        K_rec = (B_rec + (1.0 - Q) * (fail + FINAL["s"])) / Q
        K_new = B_new + (1.0 - Q) * (fail + FINAL["s"] + K_rec)
    else:
        K_new = (B_new + (1.0 - Q) * fail) / Q
    return {
        "profit": FINAL["S"] - K_new,
        "K_new": K_new,
        "Q": Q,
        "T": T,
        "feasible": True,
        "pi_halfs": pi_halfs,
        "a_halfs": a_halfs,
    }


def cost_breakdown(best: dict) -> dict:
    """最优解（半成品层不拆解）的分项成本，与 K_new 满足恒等式。"""
    xp = best["x_parts"]
    fopt = best["final_opt"]
    Q = best["Q"]
    T = best["T"]
    x_f = fopt[0]
    z_f = fopt[1]
    rec_rounds = (1.0 - Q) / Q if z_f else 0.0
    first_rounds = 1.0 if z_f else T

    buy = first_rounds * sum(
        (PARTS[i]["c"] / (1.0 - PARTS[i]["p"])) if xp[i] else PARTS[i]["c"] for i in range(8)
    )
    inspect_parts = first_rounds * sum(
        (PARTS[i]["d"] / (1.0 - PARTS[i]["p"])) if xp[i] else 0.0 for i in range(8)
    )
    half_assembly = sum(h["g"] for h in HALFS)
    final_assembly = T * FINAL["g"]
    inspect_final = T * x_f * FINAL["d"]
    disassemble = rec_rounds * FINAL["s"]
    exchange = (T - 1.0) * (1 - x_f) * FINAL["w"]
    return {
        "buy": buy,
        "inspect_parts": inspect_parts,
        "half_assembly": half_assembly,
        "final_assembly": final_assembly,
        "inspect_final": inspect_final,
        "disassemble": disassemble,
        "exchange": exchange,
    }


def _all_configs():
    for xp in product((0, 1), repeat=8):
        for hopt in product(HALF_OPTS, repeat=3):
            for fopt in FINAL_OPTS:
                yield xp, hopt, fopt


def _record(xp, hopt, fopt, r) -> dict:
    return {
        "profit": r["profit"],
        "K_new": r["K_new"],
        "Q": r["Q"],
        "T": r["T"],
        "x_parts": [int(v) for v in xp],
        "half_opts": [[int(h[0]), int(h[1])] for h in hopt],
        "final_opt": [int(fopt[0]), int(fopt[1])],
    }


def run() -> dict:
    best = None
    top = []
    feasible_count = 0
    total = 0
    for xp, hopt, fopt in _all_configs():
        total += 1
        r = evaluate(xp, hopt, fopt)
        if not r["feasible"]:
            continue
        feasible_count += 1
        rec = _record(xp, hopt, fopt, r)
        if best is None or rec["profit"] > best["profit"]:
            best = rec
        if len(top) < 8:
            top.append(rec)
            top.sort(key=lambda d: -d["profit"])
        elif rec["profit"] > top[-1]["profit"]:
            top[-1] = rec
            top.sort(key=lambda d: -d["profit"])

    for rank, rec in enumerate(top, start=1):
        rec["rank"] = rank

    baseline_all_inspect = evaluate((1,) * 8, ((1, 1), (1, 1), (1, 1)), (1, 1))
    baseline_none = evaluate((0,) * 8, ((0, 0), (0, 0), (0, 0)), (0, 0))

    cost = cost_breakdown(best)
    cost_sum = sum(cost.values())

    grid = [round(0.05 + 0.02 * i, 4) for i in range(11)]
    sens_profit, sens_code = [], []
    for v in grid:
        b = None
        for xp, hopt, fopt in _all_configs():
            r = evaluate(xp, hopt, fopt, p_halfs=[v, v, v], p_final=v)
            if r["feasible"] and (b is None or r["profit"] > b["profit"]):
                b = r
        sens_profit.append(b["profit"])
        sens_code.append(1 if all(int(t) == 1 for t in b.get("pi_halfs", []) ) else 0)

    return {
        "best": best,
        "top_strategies": top,
        "cost": cost,
        "cost_sum": cost_sum,
        "baselines": {
            "all_inspect_profit": baseline_all_inspect["profit"],
            "none_inspect_profit": baseline_none["profit"],
        },
        "enumeration": {"total": total, "feasible": feasible_count},
        "sensitivity": {
            "half_rate": {"grid": grid, "best_profit": sens_profit},
        },
        "note": "合法性约束：半成品 z_s 仅在 x_s=1 时枚举（ASM-12）；成品在不检测时仍可因市场退回而拆解。",
    }


if __name__ == "__main__":
    import json
    out = run()
    out["best"].pop("pi_halfs", None)
    out["best"].pop("a_halfs", None)
    print(json.dumps(out, ensure_ascii=False, indent=2))
