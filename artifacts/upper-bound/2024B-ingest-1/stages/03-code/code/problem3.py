# -*- coding: utf-8 -*-
"""问题 3：装配树上的节点级决策（自底向上聚合成本与合格率）。

树结构按 ASM-09 的显式假设；节点的五个方程按 DECLARATION 的 EQ-Q3-ASSY /
EQ-Q3-NODE / EQ-Q3-KF / EQ-Q3-KAPPA / EQ-Q3-XI / EQ-Q3-RECUR / EQ-Q3-UNITCOST 实现。

求解：对每个节点维护 (U_v, Q_v, Z_v) 的帕累托前沿，父节点在子节点前沿的笛卡尔积上
枚举自身 (Z_v, D_v)，取 U 最小者。装配树的最优子结构保证该 DP 给出全局最优。

方向（与 MS-Q3.method 逐字一致）：成本与合格率自底向上聚合，交付需求量自顶向下折算。
"""

import itertools
from constants import TABLE2


def build_tree(p_override=None, semi_children=None):
    """p_override: {节点名: 次品率}；semi_children: 三个半成品的子节点名列表的列表。"""
    p_override = p_override or {}
    if semi_children is None:
        semi_children = TABLE2["semi_children"]
    nodes = {}
    for name, d in TABLE2["parts"].items():
        p = p_override.get(name, d["p"])
        nodes[name] = dict(name=name, kind="part", p=p, a=d["a"], c=d["c"],
                           A=0.0, t=0.0, l=0.0, children=[])
    semi_names = []
    for idx, ch in enumerate(semi_children):
        sname = "S%d" % (idx + 1)
        semi_names.append(sname)
        nodes[sname] = dict(
            name=sname, kind="semi",
            p=p_override.get(sname, TABLE2["semi_p"]),
            a=0.0, c=TABLE2["semi_c"], A=TABLE2["semi_A"], t=TABLE2["semi_t"], l=0.0,
            children=list(ch))
    nodes["F"] = dict(
        name="F", kind="product", p=p_override.get("F", TABLE2["prod_p"]),
        a=0.0, c=TABLE2["prod_c"], A=TABLE2["prod_A"], t=TABLE2["prod_t"],
        l=TABLE2["prod_l"], children=semi_names)
    return nodes


def postorder(nodes, root="F"):
    order = []

    def visit(n):
        for ch in nodes[n]["children"]:
            visit(ch)
        order.append(n)

    visit(root)
    return order


def _leaf_states(node):
    p, a, c = node["p"], node["a"], node["c"]
    name = node["name"]
    st = []
    st.append(dict(U=a, Q=1.0 - p, Z=0, Zc=0.0, dec={name: (0, 0)}))
    st.append(dict(U=(a + c) / (1.0 - p), Q=1.0, Z=1, Zc=c, dec={name: (1, 0)}))
    return st


def _internal_states(node, child_lists, is_product):
    name = node["name"]
    p, A, c, t, l = node["p"], node["A"], node["c"], node["t"], node["l"]
    out = []
    for combo in itertools.product(*child_lists):
        sumU = 0.0
        prodQ = 1.0
        sumZc = 0.0
        merged = {}
        for s in combo:
            sumU += s["U"]
            prodQ *= s["Q"]
            sumZc += s["Zc"]
            merged.update(s["dec"])
        for Z in (0, 1):
            for D in (0, 1):
                q = (1.0 - p) * prodQ
                Qv = Z + (1 - Z) * q
                Kf = A + Z * c + sumU
                Kr = A + Z * c + sumZc
                h = 1 if (Z == 1 or is_product) else 0
                xi = h * D * t + (1 - Z) * l
                denom = 1.0 - h * D * (1.0 - q)
                if denom <= 1e-12:
                    continue
                g = q / denom
                if g <= 1e-12:
                    continue
                R = (Kr + (1.0 - q) * xi) / denom
                if h == 1:
                    U = (Kf + (1.0 - q) * (xi + h * D * R)) / g
                else:
                    U = Kf
                dec = dict(merged)
                dec[name] = (Z, D)
                out.append(dict(U=U, Q=Qv, Z=Z, D=D, Zc=Z * c, dec=dec))
    return out


def _pareto(states, cap=30):
    ordered = sorted(states, key=lambda x: (x["U"], -x["Q"], x["Zc"]))
    out = []
    best_q = -1.0
    for x in ordered:
        if x["Q"] > best_q + 1e-12:
            out.append(x)
            best_q = x["Q"]
            if len(out) >= cap:
                break
    return out


def optimize_tree(nodes):
    states = {}
    for name in postorder(nodes):
        node = nodes[name]
        if not node["children"]:
            states[name] = _leaf_states(node)
        else:
            child_lists = [states[ch] for ch in node["children"]]
            cands = _internal_states(node, child_lists, node["kind"] == "product")
            states[name] = _pareto(cands)
    best = states["F"][0]
    return best, states


def evaluate_fixed(nodes, dec):
    """给定全局决策，自底向上重算每个节点的 U、Q 与分项。"""
    info = {}
    for name in postorder(nodes):
        node = nodes[name]
        Z, D = dec[name]
        p, A, c, t, l = node["p"], node["A"], node["c"], node["t"], node["l"]
        is_product = node["kind"] == "product"
        if not node["children"]:
            if Z == 0:
                U = node["a"]
                Q = 1.0 - p
            else:
                U = (node["a"] + c) / (1.0 - p)
                Q = 1.0
            info[name] = dict(U=U, Q=Q, q=1.0 - p, Kf=U, Kr=0.0, kappa=0.0, xi=0.0, Z=Z, D=D)
            continue
        sumU = sum(info[ch]["U"] for ch in node["children"])
        prodQ = 1.0
        for ch in node["children"]:
            prodQ *= info[ch]["Q"]
        sumZc = sum(dec[ch][0] * nodes[ch]["c"] for ch in node["children"])
        q = (1.0 - p) * prodQ
        Q = Z + (1 - Z) * q
        Kf = A + Z * c + sumU
        kappa = sum(info[ch]["U"] - dec[ch][0] * nodes[ch]["c"] for ch in node["children"])
        Kr = Kf - kappa
        h = 1 if (Z == 1 or is_product) else 0
        xi = h * D * t + (1 - Z) * l
        denom = 1.0 - h * D * (1.0 - q)
        if denom <= 1e-12:
            U = float("inf")
        else:
            g = q / denom
            R = (Kr + (1.0 - q) * xi) / denom
            U = (Kf + (1.0 - q) * (xi + h * D * R)) / g if h == 1 else Kf
        info[name] = dict(U=U, Q=Q, q=q, Kf=Kf, Kr=Kr, kappa=kappa, xi=xi, Z=Z, D=D)
    return info


def solve(p_override=None, semi_children=None):
    nodes = build_tree(p_override=p_override, semi_children=semi_children)
    best, _ = optimize_tree(nodes)
    dec = best["dec"]
    info = evaluate_fixed(nodes, dec)
    price = TABLE2["prod_price"]
    U_f = info["F"]["U"]

    table = []
    for name in postorder(nodes):
        node = nodes[name]
        table.append({
            "node": name,
            "kind": node["kind"],
            "Z": int(dec[name][0]),
            "D": int(dec[name][1]),
            "U": info[name]["U"],
            "Q": info[name]["Q"],
            "q": info[name]["q"],
        })

    return {
        "method": "装配树节点级 DP：成本与合格率自底向上聚合、交付需求量自顶向下折算",
        "node_count": len(nodes),
        "decision_table": table,
        "unit_cost_root": U_f,
        "profit": price - U_f,
        "node_cost": {n: {"U": info[n]["U"], "Q": info[n]["Q"], "Kf": info[n]["Kf"],
                          "Kr": info[n]["Kr"], "kappa": info[n]["kappa"], "xi": info[n]["xi"]}
                      for n in postorder(nodes)},
        "root_decision": {"Z": int(dec["F"][0]), "D": int(dec["F"][1])},
    }


def topology_robustness():
    """ASM-09 拓扑扰动扫描：枚举与表 2 参数相容的若干连接方案并重新求解。"""
    base = TABLE2["semi_children"]
    variants = [
        ("baseline", [list(base[0]), list(base[1]), list(base[2])]),
        ("swap_3_4", [["P1", "P2", "P4"], ["P3", "P5", "P6"], ["P7", "P8"]]),
        ("col_split", [["P1", "P4", "P7"], ["P2", "P5", "P8"], ["P3", "P6"]]),
        ("cheap_grouped", [["P1", "P4"], ["P2", "P5", "P3"], ["P6", "P7", "P8"]]),
        ("size_4_2_2", [["P1", "P2", "P3", "P4"], ["P5", "P6"], ["P7", "P8"]]),
    ]
    out = []
    base_sig = None
    for tag, sc in variants:
        r = solve(semi_children=sc)
        sig = [[d["node"], d["Z"], d["D"]] for d in r["decision_table"]]
        if base_sig is None:
            base_sig = sig
        same = (sig == base_sig)
        out.append({
            "variant": tag,
            "semi_children": sc,
            "profit": r["profit"],
            "root_decision": r["root_decision"],
            "detected_nodes": sum(1 for d in r["decision_table"] if d["Z"] == 1),
            "disassembled_nodes": sum(1 for d in r["decision_table"] if d["D"] == 1),
            "decision_identical_to_baseline": same,
        })
    agree = sum(1 for v in out if v["decision_identical_to_baseline"]) / float(len(out))
    return {"variants": out, "agreement_rate": agree}
