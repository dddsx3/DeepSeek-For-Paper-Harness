# -*- coding: utf-8 -*-
"""问题 3：m 道工序 n 个零配件的节点级一般化决策模型。

递推方向（ASM-09 拓扑，ASM-13 每节点含 Z_v 与 D_v）：
  成本与合格率自底向上聚合（叶 → 根）；交付需求量自顶向下折算（本实例按每件成品单位化）。
  EQ-Q3-ASSY     q_v = (1-p_v) Π_{u∈ch(v)} Q_u
  EQ-Q3-NODE     Q_v = Z_v + (1-Z_v) q_v
  EQ-Q3-KF       K_f(v) = A_v + Z_v c_v + Σ U_u ;  K_r(v) = K_f(v) - κ_v
  EQ-Q3-KAPPA    κ_v = Σ_{u∈ch(v)} ( U_u - Z_u c_u )
  EQ-Q3-XI       h_v = Z_v ∨ 1{v 是成品} ;  ξ_v = h_v D_v t_v + (1-Z_v) l_v
  EQ-Q3-RECUR    g_v = q_v/(1 - h_v D_v (1-q_v)) ;  R_v = [K_r(v)+(1-q_v)ξ_v]/(1-h_v D_v (1-q_v))
  EQ-Q3-UNITCOST Z_v=1 时走完整闭式；Z_v=0 且非根节点时 U_v = K_f(v)（子件缺陷上递）
  EQ-Q3-PROFIT   Π = s - U_f
"""
import itertools

from params import (
    TABLE2_PARTS, TABLE2_SEMI, TABLE2_PRODUCT, TOPOLOGY_BASE,
    SEMI_IDS, ROOT_ID, TOL,
)


def build_nodes():
    nodes = {}
    for p in TABLE2_PARTS:
        nodes[str(p["id"])] = {"type": "part", "p": p["p"], "a": p["a"],
                               "c": p["c"], "A": 0.0, "t": 0.0, "l": 0.0}
    for s in TABLE2_SEMI:
        nodes[s["id"]] = {"type": "semi", "p": s["p"], "a": 0.0,
                          "c": s["c"], "A": s["A"], "t": s["t"], "l": 0.0}
    root = TABLE2_PRODUCT
    nodes[ROOT_ID] = {"type": "product", "p": root["p"], "a": 0.0,
                      "c": root["c"], "A": root["A"], "t": root["t"],
                      "l": root["l"]}
    return nodes


def _part_node_options(nd, Z):
    """叶节点（EQ-Q3-COST）：U_v = Z(a+c)/(1-p) + (1-Z)a；Q_v = 1-(1-Z)p。"""
    Q = 1.0 - (1.0 - Z) * nd["p"]
    U = Z * (nd["a"] + nd["c"]) / (1.0 - nd["p"]) + (1.0 - Z) * nd["a"]
    return U, Q


def solve_tree(nodes, topo):
    """全枚举：叶节点 Z（2^8）× 半成品 (Z,D)（4^3）× 成品 (Z,D)（4）。"""
    part_ids = [v for v in nodes if nodes[v]["type"] == "part"]
    semi_ids = [v for v in nodes if nodes[v]["type"] == "semi"]
    root = ROOT_ID
    best = None
    n_part = len(part_ids)

    for mask in range(2 ** n_part):
        leaf_dec = {}
        U = {}
        Q = {}
        for i, v in enumerate(part_ids):
            Z = (mask >> i) & 1
            leaf_dec[v] = {"Z": Z, "D": 0}
            U[v], Q[v] = _part_node_options(nodes[v], Z)

        semi_opts = {}
        for s in semi_ids:
            nds = nodes[s]
            ch = topo[s]
            opts = []
            for Z in (0, 1):
                for D in (0, 1):
                    prod = 1.0
                    for u in ch:
                        prod *= Q[u]
                    q = (1.0 - nds["p"]) * prod
                    Qs = Z + (1.0 - Z) * q
                    Kf = nds["A"] + Z * nds["c"] + sum(U[u] for u in ch)
                    kappa = sum(U[u] - leaf_dec[u]["Z"] * nodes[u]["c"] for u in ch)
                    Kr = Kf - kappa
                    h = 1.0 if Z == 1 else 0.0
                    xi = h * D * nds["t"]
                    if Z == 1:
                        denom = 1.0 - h * D * (1.0 - q)
                        if denom <= TOL or q <= TOL:
                            continue
                        g = q / denom
                        R = (Kr + (1.0 - q) * xi) / denom
                        Us = (Kf + (1.0 - q) * (xi + h * D * R)) / g
                    else:
                        Us = Kf
                    opts.append({"Z": Z, "D": D, "U": Us, "Q": Qs, "q": q,
                                 "Kf": Kf, "Kr": Kr, "kappa": kappa})
            semi_opts[s] = opts
            if not opts:
                break
        if any(not semi_opts[s] for s in semi_ids):
            continue

        for combo in itertools.product(*[semi_opts[s] for s in semi_ids]):
            U2 = dict(U)
            Q2 = dict(Q)
            for s, opt in zip(semi_ids, combo):
                U2[s] = opt["U"]
                Q2[s] = opt["Q"]
            ndf = nodes[root]
            chf = topo[root]
            prod = 1.0
            for u in chf:
                prod *= Q2[u]
            qf = (1.0 - ndf["p"]) * prod
            sumU = sum(U2[u] for u in chf)
            kappa_f = sum(U2[u] - combo[i]["Z"] * nodes[u]["c"] for i, u in enumerate(chf))
            for Zf in (0, 1):
                for Df in (0, 1):
                    Qf = Zf + (1.0 - Zf) * qf
                    Kf = ndf["A"] + Zf * ndf["c"] + sumU
                    Kr = Kf - kappa_f
                    h = 1.0  # 成品节点：h_v = 1（Z_v ∨ 1{v 是成品}）
                    xi = h * Df * ndf["t"] + (1.0 - Zf) * ndf["l"]
                    denom = 1.0 - h * Df * (1.0 - qf)
                    if denom <= TOL or qf <= TOL:
                        continue
                    g = qf / denom
                    R = (Kr + (1.0 - qf) * xi) / denom
                    Uf = (Kf + (1.0 - qf) * (xi + h * Df * R)) / g
                    profit = ndf["l"] * 0 + TABLE2_PRODUCT["s"] - Uf
                    cand = {
                        "profit": profit,
                        "U_f": Uf,
                        "q_f": qf,
                        "Q_f": Qf,
                        "decisions": dict((v, dict(leaf_dec[v])) for v in part_ids),
                        "node_cost": None,
                    }
                    for s, opt in zip(semi_ids, combo):
                        cand["decisions"][s] = {"Z": opt["Z"], "D": opt["D"]}
                    cand["decisions"][root] = {"Z": Zf, "D": Df}
                    if best is None or profit > best["profit"]:
                        best = cand

    if best is None:
        raise RuntimeError("问题 3 未找到可行决策组合")
    best["node_cost"] = _node_cost_table(nodes, topo, best["decisions"])
    return best


def _node_cost_table(nodes, topo, decisions):
    """按最终决策重算一遍每个节点的 U_v、Q_v（自底向上）。"""
    part_ids = [v for v in nodes if nodes[v]["type"] == "part"]
    semi_ids = [v for v in nodes if nodes[v]["type"] == "semi"]
    U = {}
    Q = {}
    tab = {}
    for v in part_ids:
        Z = decisions[v]["Z"]
        U[v], Q[v] = _part_node_options(nodes[v], Z)
        tab[v] = {"U": U[v], "Q": Q[v], "Z": Z, "D": decisions[v]["D"]}
    for s in semi_ids:
        nds = nodes[s]
        ch = topo[s]
        Z = decisions[s]["Z"]
        D = decisions[s]["D"]
        prod = 1.0
        for u in ch:
            prod *= Q[u]
        q = (1.0 - nds["p"]) * prod
        Qs = Z + (1.0 - Z) * q
        Kf = nds["A"] + Z * nds["c"] + sum(U[u] for u in ch)
        kappa = sum(U[u] - decisions[u]["Z"] * nodes[u]["c"] for u in ch)
        Kr = Kf - kappa
        h = 1.0 if Z == 1 else 0.0
        xi = h * D * nds["t"]
        if Z == 1:
            denom = 1.0 - h * D * (1.0 - q)
            g = q / denom
            R = (Kr + (1.0 - q) * xi) / denom
            Us = (Kf + (1.0 - q) * (xi + h * D * R)) / g
        else:
            Us = Kf
        U[s] = Us
        Q[s] = Qs
        tab[s] = {"U": Us, "Q": Qs, "q": q, "Kf": Kf, "Kr": Kr,
                  "kappa": kappa, "Z": Z, "D": D}
    f = ROOT_ID
    ndf = nodes[f]
    chf = topo[f]
    Z = decisions[f]["Z"]
    D = decisions[f]["D"]
    prod = 1.0
    for u in chf:
        prod *= Q[u]
    q = (1.0 - ndf["p"]) * prod
    Qf = Z + (1.0 - Z) * q
    Kf = ndf["A"] + Z * ndf["c"] + sum(U[u] for u in chf)
    kappa = sum(U[u] - decisions[u]["Z"] * nodes[u]["c"] for u in chf)
    Kr = Kf - kappa
    h = 1.0
    xi = h * D * ndf["t"] + (1.0 - Z) * ndf["l"]
    denom = 1.0 - h * D * (1.0 - q)
    g = q / denom
    R = (Kr + (1.0 - q) * xi) / denom
    Uf = (Kf + (1.0 - q) * (xi + h * D * R)) / g
    U[f] = Uf
    Q[f] = Qf
    tab[f] = {"U": Uf, "Q": Qf, "q": q, "Kf": Kf, "Kr": Kr,
              "kappa": kappa, "Z": Z, "D": D}
    return tab


def _strategy_compare(nodes, topo, best):
    """固定最优叶节点 Z，遍历“半成品统一 (Z,D) × 成品 (Z,D)”的 16 种组合。"""
    part_ids = [v for v in nodes if nodes[v]["type"] == "part"]
    semi_ids = [v for v in nodes if nodes[v]["type"] == "semi"]
    out = []
    for Zs in (0, 1):
        for Ds in (0, 1):
            for Zf in (0, 1):
                for Df in (0, 1):
                    dec = {}
                    for v in part_ids:
                        dec[v] = {"Z": best["decisions"][v]["Z"], "D": 0}
                    for s in semi_ids:
                        dec[s] = {"Z": Zs, "D": Ds}
                    dec[ROOT_ID] = {"Z": Zf, "D": Df}
                    try:
                        tab = _node_cost_table(nodes, topo, dec)
                    except ZeroDivisionError:
                        continue
                    Uf = tab[ROOT_ID]["U"]
                    out.append({
                        "Z_semi": Zs, "D_semi": Ds, "Z_prod": Zf, "D_prod": Df,
                        "U_f": Uf, "profit": TABLE2_PRODUCT["s"] - Uf,
                    })
    return out


TOPOLOGY_VARIANTS = {
    "base": {"S1": [1, 2, 3], "S2": [4, 5, 6], "S3": [7, 8], "F": ["S1", "S2", "S3"]},
    "swap_1_4": {"S1": [4, 2, 3], "S2": [1, 5, 6], "S3": [7, 8], "F": ["S1", "S2", "S3"]},
    "swap_5_7": {"S1": [1, 2, 3], "S2": [4, 7, 6], "S3": [5, 8], "F": ["S1", "S2", "S3"]},
    "pair_1_8": {"S1": [1, 8], "S2": [2, 3, 4], "S3": [5, 6, 7], "F": ["S1", "S2", "S3"]},
    "three_two_three": {"S1": [1, 2], "S2": [3, 4, 5], "S3": [6, 7, 8], "F": ["S1", "S2", "S3"]},
}


def _decision_vector(decisions, nodes):
    order = sorted([v for v in nodes if nodes[v]["type"] == "part"],
                   key=lambda x: int(x))
    order += SEMI_IDS + [ROOT_ID]
    vec = []
    for v in order:
        vec.append(decisions[v]["Z"])
        vec.append(decisions[v]["D"])
    return vec


def topology_robustness(nodes):
    names = []
    profits = []
    vectors = []
    base_vec = None
    for nm, topo in TOPOLOGY_VARIANTS.items():
        best = solve_tree(nodes, topo)
        vec = _decision_vector(best["decisions"], nodes)
        names.append(nm)
        profits.append(best["profit"])
        vectors.append(vec)
        if base_vec is None:
            base_vec = vec
    hit = sum(1 for v in vectors if v == base_vec)
    return {
        "names": names,
        "profits": profits,
        "vectors": vectors,
        "base_vector": base_vec,
        "consistency": hit / len(vectors),
    }


def run():
    nodes = build_nodes()
    best = solve_tree(nodes, TOPOLOGY_BASE)
    compare = _strategy_compare(nodes, TOPOLOGY_BASE, best)
    robust = topology_robustness(nodes)
    return {
        "nodes": sorted(nodes.keys()),
        "optimal": {
            "decisions": best["decisions"],
            "profit": best["profit"],
            "U_f": best["U_f"],
            "node_cost": best["node_cost"],
        },
        "strategy_compare": compare,
        "topology_robust": robust,
    }


if __name__ == "__main__":
    import json
    out = run()
    print(json.dumps(out["topology_robust"], ensure_ascii=False, indent=2))
