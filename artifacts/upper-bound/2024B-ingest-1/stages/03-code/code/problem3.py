# -*- coding: utf-8 -*-
"""problem3.py — 问题 3：m 工序 n 零配件的装配树节点级决策模型（图 1 / 表 2 实例）

上游对齐
--------
* 02-modeling/DECLARATION.json 的 MS-Q3 与 EQ-Q3-ASSY / EQ-Q3-NODE / EQ-Q3-COST /
  EQ-Q3-KF / EQ-Q3-KAPPA / EQ-Q3-XI / EQ-Q3-RECUR / EQ-Q3-UNITCOST / EQ-Q3-PROFIT，
  本文件逐条实现，不另立口径。
* 01-prob-analysis/PROBLEM_FACTS.json 的 F-T2-PART-1..8 / F-T2-SEMI / F-T2-PRODUCT /
  F-T2-PRICE（表 2 参数）、F-FIG1（图 1 规模）、F-T1-C1（V-08 退化核验用的情况 1 参数）。

实现要点
--------
1. 方向：**成本与合格率自底向上聚合**（U_u, Q_u → q_v, K_f(v) → U_v），交付需求量自顶向下
   折算（本文件口径单位化为「每交付一件合格成品」，折算系数恒为 1）。
2. 拓扑（ASM-09）：图 1 原件未随简报下传，连接关系从表 2 行分组读出 →
   零配件 {1,2,3} → 半成品 1，{4,5,6} → 半成品 2，{7,8} → 半成品 3，三个半成品 → 成品；
   共 12 个节点（8 零配件 + 3 半成品 + 1 成品）。该假设由拓扑扰动扫描量化。
3. 决策：每个非叶节点 (Z_v, D_v) ∈ {0,1}^2；每个零配件节点只有 Z_v（检测出的不合格件直接
   丢弃，无件可拆）。组合空间 2^8 × 2^8 = 65536。
4. 求解：Pareto 前沿动态规划（父节点的 U 对子节点的 (U ↑ 差, Q ↓ 差) 单调，故支配剪枝无损），
   并用 65536 组合的全枚举独立复核。
5. 根节点（成品）口径：无论 Z_f 取 0 还是 1 都走含 ξ_f 与回收闭环的闭式。理由有二——
   Π = s − U_f 要求 U_f 是「每件**合格**交付件成本」；且 V-08 退化核验（m=2、n=2 收敛到
   问题 2 的 EQ-COST-Q2）只在这一点成立。若 Z_f = 0 时取 U_f = K_f(f)，则调换损失 l 与成品
   拆解费 t 都不会进入目标函数，D_f 决策形同虚设，与题面「无条件调换 + 拆解费用 10」冲突。
   非根内部节点在 Z_v = 0 时取 U_v = K_f(v)（EQ-Q3-UNITCOST 的退化分支，缺陷由父节点凭 Q_v
   承担，不在本节点重复计入闭环）。
6. 本文件不产生任何图像字节，也不写图表声明；所有量以可读键名进入 run() 的返回字典，
   由编排入口统一落盘为 JSON。
"""

from __future__ import annotations

import itertools
import json
import os
import random

# ---------------------------------------------------------------------------
# 0. 参数来源
#    优先 code/params.py（题面给定值 + 模型常数），其次读 01-prob-analysis/
#    PROBLEM_FACTS.json（题面给定值的原始出处），两者都不可用时才启用本文件内的兜底副本，
#    并在输出中登记 fallback_constants 以便审计。
# ---------------------------------------------------------------------------
try:  # pragma: no cover
    import params as _params
except Exception:  # pragma: no cover
    _params = None

_FALLBACK_CONSTANTS: list = []


def _const(cands, default=None):
    """按候选键名序列从 params.py 取模型常数；取不到时用声明的默认值并登记。"""
    if _params is not None:
        for nm in cands:
            if hasattr(_params, nm):
                val = getattr(_params, nm)
                if val is not None:
                    return val
    if default is None:
        raise AttributeError("problem3 缺少模型常数，候选键名：" + repr(cands))
    _FALLBACK_CONSTANTS.append(cands[0])
    return default


TOL = float(_const(("TOL", "TOLERANCE", "NUM_TOL", "数值容差"), 1e-6))
SEED = int(_const(("SEED", "RANDOM_SEED", "随机种子"), 202409))
Q3_N_SEMI = int(_const(("Q3_N_SEMI", "N_SEMI", "问题3半成品数"), 3))
Q3_N_NODES = int(_const(("Q3_N_NODES", "N_NODES", "问题3图1节点总数"), 12))
Q3_TOPO_CAP = int(_const(("Q3_TOPO_CAP", "TOPO_CAP"), 600))

# 兜底副本（仅在 params.py 与 PROBLEM_FACTS.json 都不可用时启用；数值逐条对应
# PROBLEM_FACTS.json 的 F-T2-*，不是自算值）
_BUILTIN_INSTANCE = {
    "source": "builtin-fallback(PROBLEM_FACTS F-T2-*)",
    "parts": [
        {"id": "P1", "name": "零配件1", "p": 0.10, "a": 2.0, "c": 1.0},
        {"id": "P2", "name": "零配件2", "p": 0.10, "a": 8.0, "c": 1.0},
        {"id": "P3", "name": "零配件3", "p": 0.10, "a": 12.0, "c": 2.0},
        {"id": "P4", "name": "零配件4", "p": 0.10, "a": 2.0, "c": 1.0},
        {"id": "P5", "name": "零配件5", "p": 0.10, "a": 8.0, "c": 1.0},
        {"id": "P6", "name": "零配件6", "p": 0.10, "a": 12.0, "c": 2.0},
        {"id": "P7", "name": "零配件7", "p": 0.10, "a": 8.0, "c": 1.0},
        {"id": "P8", "name": "零配件8", "p": 0.10, "a": 12.0, "c": 2.0},
    ],
    "semis": [
        {"id": "S1", "name": "半成品1", "p": 0.10, "A": 8.0, "c": 4.0, "t": 6.0},
        {"id": "S2", "name": "半成品2", "p": 0.10, "A": 8.0, "c": 4.0, "t": 6.0},
        {"id": "S3", "name": "半成品3", "p": 0.10, "A": 8.0, "c": 4.0, "t": 6.0},
    ],
    "product": {"id": "F", "name": "成品", "p": 0.10, "A": 8.0, "c": 6.0, "t": 10.0},
    "price": 200.0,
    "exchange": 40.0,
    "q2_case1": {"p1": 0.10, "a1": 4.0, "c1": 2.0, "p2": 0.10, "a2": 18.0, "c2": 3.0,
                 "p0": 0.10, "A": 6.0, "c0": 3.0, "s": 56.0, "l": 6.0, "t": 5.0},
}


def _pct(x):
    if isinstance(x, str):
        t = x.strip()
        if t.endswith("%"):
            return float(t[:-1]) / 100.0
    return float(x)


def _pick(d, keys):
    for k in keys:
        if k in d:
            return d[k]
    raise KeyError("缺少字段之一：" + repr(keys))


def _norm_part(d, idx):
    return {"id": d.get("id", "P%d" % idx), "name": d.get("name", "零配件%d" % idx),
            "p": _pct(_pick(d, ("p", "次品率"))),
            "a": float(_pick(d, ("a", "购买单价"))),
            "c": float(_pick(d, ("c", "检测成本")))}


def _norm_semi(d, idx):
    return {"id": d.get("id", "S%d" % idx), "name": d.get("name", "半成品%d" % idx),
            "p": _pct(_pick(d, ("p", "次品率"))),
            "A": float(_pick(d, ("A", "装配成本"))),
            "c": float(_pick(d, ("c", "检测成本"))),
            "t": float(_pick(d, ("t", "拆解费用")))}


def _norm_product(d):
    return {"id": d.get("id", "F"), "name": d.get("name", "成品"),
            "p": _pct(_pick(d, ("p", "次品率"))),
            "A": float(_pick(d, ("A", "装配成本"))),
            "c": float(_pick(d, ("c", "检测成本"))),
            "t": float(_pick(d, ("t", "拆解费用")))}


def _find_facts_file():
    here = os.path.dirname(os.path.abspath(__file__))
    cands = [
        os.path.join(os.path.dirname(here), "01-prob-analysis", "PROBLEM_FACTS.json"),
        os.path.join(os.getcwd(), "..", "01-prob-analysis", "PROBLEM_FACTS.json"),
        os.path.join(os.getcwd(), "PROBLEM_FACTS.json"),
        os.path.join(here, "PROBLEM_FACTS.json"),
    ]
    for p in cands:
        if os.path.isfile(p):
            return p
    return None


def _instance_from_facts(path):
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    facts = {it["id"]: it for it in doc.get("facts", [])}

    def val(fid):
        return facts[fid]["value"]

    parts = []
    for i in range(1, 9):
        v = val("F-T2-PART-%d" % i)
        parts.append({"id": "P%d" % i, "name": "零配件%d" % i,
                      "p": _pct(v["次品率"]),
                      "a": float(v["购买单价"]),
                      "c": float(v["检测成本"])})
    semis = []
    for i, v in enumerate(val("F-T2-SEMI"), start=1):
        semis.append({"id": "S%d" % i, "name": "半成品%d" % i,
                      "p": _pct(v["次品率"]),
                      "A": float(v["装配成本"]),
                      "c": float(v["检测成本"]),
                      "t": float(v["拆解费用"])})
    pv = val("F-T2-PRODUCT")
    product = {"id": "F", "name": "成品", "p": _pct(pv["次品率"]),
               "A": float(pv["装配成本"]), "c": float(pv["检测成本"]),
               "t": float(pv["拆解费用"])}
    price_doc = val("F-T2-PRICE")
    c1 = val("F-T1-C1")
    q2_case1 = {"p1": _pct(c1["零配件1"]["次品率"]), "a1": float(c1["零配件1"]["购买单价"]),
                "c1": float(c1["零配件1"]["检测成本"]),
                "p2": _pct(c1["零配件2"]["次品率"]), "a2": float(c1["零配件2"]["购买单价"]),
                "c2": float(c1["零配件2"]["检测成本"]),
                "p0": _pct(c1["成品"]["次品率"]), "A": float(c1["成品"]["装配成本"]),
                "c0": float(c1["成品"]["检测成本"]),
                "s": float(c1["市场售价"]), "l": float(c1["调换损失"]),
                "t": float(c1["拆解费用"])}
    return {"source": "PROBLEM_FACTS.json:" + os.path.relpath(path),
            "parts": parts, "semis": semis, "product": product,
            "price": float(price_doc["市场售价"]),
            "exchange": float(price_doc["调换损失"]),
            "q2_case1": q2_case1}


def _instance_from_params():
    if _params is None:
        return None
    for nm in ("Q3_INSTANCE", "TABLE2", "TABLE_2", "Q3_TABLE2"):
        obj = getattr(_params, nm, None)
        if isinstance(obj, dict) and all(k in obj for k in ("parts", "semis", "product")):
            try:
                inst = {
                    "source": "params.%s" % nm,
                    "parts": [_norm_part(d, i + 1) for i, d in enumerate(obj["parts"])],
                    "semis": [_norm_semi(d, i + 1) for i, d in enumerate(obj["semis"])],
                    "product": _norm_product(obj["product"]),
                    "price": float(_pick(obj, ("price", "市场售价"))),
                    "exchange": float(_pick(obj, ("exchange", "调换损失"))),
                    "q2_case1": _BUILTIN_INSTANCE["q2_case1"],
                }
                return inst
            except Exception:
                continue
    return None


_INSTANCE_CACHE: dict = {}


def load_instance(force: bool = False) -> dict:
    """读取表 2 实例参数：params.py → PROBLEM_FACTS.json → 内置兜底副本。"""
    if not force and "inst" in _INSTANCE_CACHE:
        return _INSTANCE_CACHE["inst"]
    inst = _instance_from_params()
    if inst is None:
        path = _find_facts_file()
        if path is not None:
            try:
                inst = _instance_from_facts(path)
            except Exception:
                inst = None
    if inst is None:
        inst = json.loads(json.dumps(_BUILTIN_INSTANCE))
        _FALLBACK_CONSTANTS.append("Q3_INSTANCE")
    _INSTANCE_CACHE["inst"] = inst
    return inst


# ---------------------------------------------------------------------------
# 1. 装配树构造
# ---------------------------------------------------------------------------
def build_tree(parts, semis, product, price, exchange, semi_children=None,
               product_children=None):
    """按 EQ-Q3-ASSY 的 ch(v) 构造装配树；semis 为空时退化为「零配件 → 成品」两节点树。"""
    nodes, kind, name, children, prm = [], {}, {}, {}, {}
    for d in parts:
        v = d["id"]
        nodes.append(v)
        kind[v] = "part"
        name[v] = d["name"]
        children[v] = []
        prm[v] = {"p": float(d["p"]), "a": float(d["a"]), "c": float(d["c"]),
                  "A": 0.0, "t": 0.0, "l": 0.0}
    for d in semis:
        v = d["id"]
        nodes.append(v)
        kind[v] = "semi"
        name[v] = d["name"]
        children[v] = list((semi_children or {}).get(v, []))
        prm[v] = {"p": float(d["p"]), "a": 0.0, "c": float(d["c"]),
                  "A": float(d["A"]), "t": float(d["t"]), "l": 0.0}
    f = product["id"]
    nodes.append(f)
    kind[f] = "product"
    name[f] = product["name"]
    if product_children is not None:
        children[f] = list(product_children)
    else:
        children[f] = [d["id"] for d in semis]
    prm[f] = {"p": float(product["p"]), "a": 0.0, "c": float(product["c"]),
              "A": float(product["A"]), "t": float(product["t"]), "l": float(exchange)}
    leaves = [d["id"] for d in parts]
    internals = [d["id"] for d in semis] + [f]
    return {"nodes": nodes, "kind": kind, "name": name, "children": children,
            "params": prm, "leaves": leaves, "internals": internals, "product": f,
            "price": float(price), "exchange": float(exchange),
            "n_nodes": len(nodes), "n_semis": len(semis), "n_parts": len(parts)}


def build_tree_default(semi_children=None):
    """ASM-09 拓扑：{P1,P2,P3}→S1、{P4,P5,P6}→S2、{P7,P8}→S3、{S1,S2,S3}→F。"""
    inst = load_instance()
    parts = [dict(d) for d in inst["parts"]]
    semis = [dict(d) for d in inst["semis"]]
    product = dict(inst["product"])
    if semi_children is None:
        semi_children = {
            semis[0]["id"]: [p["id"] for p in parts[0:3]],
            semis[1]["id"]: [p["id"] for p in parts[3:6]],
            semis[2]["id"]: [p["id"] for p in parts[6:8]],
        }
    return build_tree(parts, semis, product, inst["price"], inst["exchange"],
                      semi_children=semi_children)


# ---------------------------------------------------------------------------
# 2. 单节点求值（EQ-Q3-ASSY / NODE / KF / KAPPA / XI / RECUR / UNITCOST）
# ---------------------------------------------------------------------------
def _eval_internal(prm, z, d, is_prod, q_children, sum_u, sum_zc, combo, tol):
    """内部节点一轮成本与等效获取成本。

    q_v = (1-p_v) Π Q_u；K_f(v) = A_v + Z_v c_v + Σ U_u；κ_v = Σ (U_u − Z_u c_u)；
    K_r(v) = K_f(v) − κ_v；h_v = Z_v ∨ 1{v 为成品}；ξ_v = h_v D_v t_v + (1−Z_v) l_v；
    g_v = q_v / den，R_v = (K_r + (1−q)ξ)/den，den = 1 − h D (1−q)。
    """
    p, A, c, t, l = prm["p"], prm["A"], prm["c"], prm["t"], prm["l"]
    q = (1.0 - p) * q_children
    Q = 1.0 if z else q
    Kf = A + (c if z else 0.0) + sum_u
    kappa = sum_u - sum_zc
    Kr = Kf - kappa
    h = 1.0 if (z or is_prod) else 0.0
    xi = h * d * t + (0.0 if z else l)
    den = 1.0 - h * d * (1.0 - q)
    if q <= tol or den <= tol:
        return {"U": float("inf"), "Q": Q, "q": q, "Z": int(z), "D": int(d),
                "feasible": False, "kids": combo, "K_f": Kf, "K_r": Kr,
                "kappa": kappa, "xi": xi, "g": float("nan"), "R": float("nan")}
    g = q / den
    R = (Kr + (1.0 - q) * xi) / den
    if z or is_prod:
        U = (Kf + (1.0 - q) * (xi + h * d * R)) / g
    else:
        U = Kf
    return {"U": U, "Q": Q, "q": q, "Z": int(z), "D": int(d), "feasible": True,
            "kids": combo, "K_f": Kf, "K_r": Kr, "kappa": kappa, "xi": xi,
            "g": g, "R": R}


def _pareto(opts, tol):
    """支配剪枝：U 越小越好、Q 越大越好；父节点 U 对 (U_u, Q_u) 单调，故剪枝无损。"""
    out = []
    best_q = float("-inf")
    for o in sorted(opts, key=lambda x: (x["U"], -x["Q"])):
        if o["Q"] > best_q + tol:
            out.append(o)
            best_q = o["Q"]
    return out


def _materialize(tree, v, opt, out):
    out[v] = (int(opt["Z"]), int(opt["D"]))
    kids = tree["children"].get(v) or []
    combo = opt.get("kids") or ()
    for u, ko in zip(kids, combo):
        _materialize(tree, u, ko, out)
    return out


# ---------------------------------------------------------------------------
# 3. 求解：Pareto 前沿动态规划
# ---------------------------------------------------------------------------
def solve_tree(tree=None, fixed=None, tol=None):
    """求装配树上的最优 (Z_v, D_v)；Π = s − U_f，等价于最小化根节点 U_f。

    fixed: {node_id: (Z, D)} 钉死若干节点的决策，其余节点（含叶）自由优化。
    """
    tree = tree if tree is not None else build_tree_default()
    tol = TOL if tol is None else tol
    fx = {k: (int(v[0]), int(v[1])) for k, v in dict(fixed or {}).items()}
    frontier = {}

    def rec(v):
        if v in frontier:
            return frontier[v]
        kind = tree["kind"][v]
        prm = tree["params"][v]
        if kind == "part":
            zs = [fx[v][0]] if v in fx else [0, 1]
            opts = []
            for z in zs:
                p, a, c = prm["p"], prm["a"], prm["c"]
                if z:
                    U = (a + c) / (1.0 - p)
                    Q = 1.0
                else:
                    U = a
                    Q = 1.0 - p
                opts.append({"U": U, "Q": Q, "q": 1.0 - p, "Z": z, "D": 0,
                             "feasible": True, "kids": ()})
            frontier[v] = opts
            return opts
        kids = tree["children"][v]
        child_opts = [rec(u) for u in kids]
        is_prod = (v == tree["product"])
        zds = [fx[v]] if v in fx else [(z, d) for z in (0, 1) for d in (0, 1)]
        cands = []
        for combo in itertools.product(*child_opts):
            sum_u = 0.0
            sum_zc = 0.0
            qc = 1.0
            for u, o in zip(kids, combo):
                sum_u += o["U"]
                qc *= o["Q"]
                sum_zc += o["Z"] * tree["params"][u]["c"]
            for (z, d) in zds:
                cands.append(_eval_internal(prm, z, d, is_prod, qc, sum_u, sum_zc,
                                            combo, tol))
        opts = _pareto([c for c in cands if c["feasible"]], tol)
        if not opts:
            opts = [{"U": float("inf"), "Q": 0.0, "q": 0.0, "Z": 0, "D": 0,
                     "feasible": False, "kids": ()}]
        frontier[v] = opts
        return opts

    root_opts = rec(tree["product"])
    best = min(root_opts, key=lambda o: o["U"])
    n_ties = sum(1 for o in root_opts if abs(o["U"] - best["U"]) <= tol)
    cfg = _materialize(tree, tree["product"], best, {})
    return {"config": cfg, "U_root": best["U"], "Q_root": best["Q"],
            "profit": tree["price"] - best["U"], "feasible": bool(best["feasible"]),
            "n_root_options": len(root_opts), "n_root_ties": n_ties,
            "root_frontier": [{"U": o["U"], "Q": o["Q"], "Z": o["Z"], "D": o["D"]}
                              for o in root_opts]}


def node_options(tree=None, params_dict=None, fixed=None):
    """根节点 Pareto 前沿上的全部选项（按 U 升序，最优在前）。"""
    tree = tree if tree is not None else build_tree_default()
    r = solve_tree(tree=tree, fixed=fixed)
    return sorted(r["root_frontier"], key=lambda o: o["U"])


# ---------------------------------------------------------------------------
# 4. 固定决策求值（逐节点成本分解 + 自顶向下的成本归集）
# ---------------------------------------------------------------------------
def evaluate_config(tree, cfg, tol=None):
    """对固定决策自底向上复算全部节点量，并给出逐节点成本分解。"""
    tol = TOL if tol is None else tol
    order = list(tree["leaves"]) + list(tree["internals"])
    rec = {}
    for v in order:
        kind = tree["kind"][v]
        prm = tree["params"][v]
        z, d = cfg.get(v, (0, 0))
        z, d = int(z), int(d)
        if kind == "part":
            p, a, c = prm["p"], prm["a"], prm["c"]
            if z:
                U = (a + c) / (1.0 - p)
                Q = 1.0
                pur = a / (1.0 - p)
                tst = c / (1.0 - p)
            else:
                U = a
                Q = 1.0 - p
                pur = a
                tst = 0.0
            rec[v] = {"node": v, "name": tree["name"][v], "kind": kind, "Z": z, "D": 0,
                      "p": p, "q": 1.0 - p, "Q": Q, "U": U, "K_f": U, "K_r": 0.0,
                      "kappa": 0.0, "xi": 0.0, "g": (1.0 if z else 1.0 - p), "R": 0.0,
                      "f_kf": 0.0, "f_kr": 0.0,
                      "cost": {"purchase": pur, "test": tst, "assembly": 0.0,
                               "disassembly": 0.0, "exchange": 0.0,
                               "child_material": 0.0}}
            continue
        kids = tree["children"].get(v, [])
        p, A, c, t, l = prm["p"], prm["A"], prm["c"], prm["t"], prm["l"]
        qc = 1.0
        sum_u = 0.0
        sum_zc = 0.0
        for u in kids:
            qc *= rec[u]["Q"]
            sum_u += rec[u]["U"]
            sum_zc += rec[u]["Z"] * tree["params"][u]["c"]
        q = (1.0 - p) * qc
        Q = 1.0 if z else q
        Kf = A + (c if z else 0.0) + sum_u
        kappa = sum_u - sum_zc
        Kr = Kf - kappa
        is_prod = (v == tree["product"])
        h = 1.0 if (z or is_prod) else 0.0
        xi = h * d * t + (0.0 if z else l)
        den = 1.0 - h * d * (1.0 - q)
        feasible = (q > tol) and (den > tol)
        if feasible:
            g = q / den
            R = (Kr + (1.0 - q) * xi) / den
            if z or is_prod:
                U = (Kf + (1.0 - q) * (xi + h * d * R)) / g
                f_kf = den / q
                f_kr = (1.0 - q) * h * d / q
                f_xi = (1.0 - q) / q
            else:
                U = Kf
                f_kf, f_kr, f_xi = 1.0, 0.0, 0.0
        else:
            g = float("nan")
            R = float("nan")
            U = float("inf")
            f_kf = f_kr = f_xi = float("nan")
        cost = {
            "purchase": 0.0,
            "test": (c if z else 0.0) * (f_kf + f_kr),
            "assembly": A * (f_kf + f_kr),
            "disassembly": (h * d * t) * f_xi,
            "exchange": ((0.0 if z else l) * f_xi),
            "child_material": sum_u * f_kf + sum_zc * f_kr,
        }
        rec[v] = {"node": v, "name": tree["name"][v], "kind": kind, "Z": z, "D": d,
                  "p": p, "q": q, "Q": Q, "U": U, "K_f": Kf, "K_r": Kr,
                  "kappa": kappa, "xi": xi, "g": g, "R": R,
                  "f_kf": f_kf, "f_kr": f_kr, "feasible": feasible, "cost": cost}
    return rec


def attributed_breakdown(tree, rows):
    """自顶向下把每个节点自身的成本项归集到「每件合格成品」口径上。

    w_root = 1，w_u = Σ_{父 v} w_v · f_kf(v)；回收件的再检测费另计 extra_u = Σ_v w_v f_kr(v)。
    Σ 全部节点的归集分量 = U_f（由 checks.attributed_sum_abs_err 核验）。
    """
    w = {tree["product"]: 1.0}
    extra = {}
    stack = [tree["product"]]
    while stack:
        v = stack.pop()
        rv = rows[v]
        f_kf = rv.get("f_kf", 0.0) or 0.0
        f_kr = rv.get("f_kr", 0.0) or 0.0
        for u in tree["children"].get(v, []):
            w[u] = w.get(u, 0.0) + w[v] * f_kf
            extra[u] = extra.get(u, 0.0) + w[v] * f_kr
            stack.append(u)
    out = {}
    for v in tree["nodes"]:
        wv = w.get(v, 0.0)
        ev = extra.get(v, 0.0)
        cc = rows[v]["cost"]
        zu = rows[v]["Z"]
        cu = tree["params"][v]["c"]
        out[v] = {
            "purchase": wv * cc["purchase"],
            "test": wv * cc["test"] + ev * zu * cu,
            "assembly": wv * cc["assembly"],
            "disassembly": wv * cc["disassembly"],
            "exchange": wv * cc["exchange"],
        }
    return out


def eval_config(*args, **kwargs):
    """灵活签名的固定决策评估（供问题 4 的「决策固定下的利润区间」复用）。

    接受 eval_config(decisions) / eval_config(decisions, tree) /
    eval_config(tree=..., decisions=...)。
    返回 {profit, U_f, feasible, config, nodes}。
    """
    tree = kwargs.get("tree")
    decisions = kwargs.get("decisions")
    for a in args:
        if isinstance(a, dict) and a and all(
                isinstance(x, dict) and ("Z" in x or "z" in x) for x in a.values()):
            decisions = a
        elif isinstance(a, dict) and any(k in a for k in ("children", "params", "product")):
            tree = a
    tree = tree if tree is not None else build_tree_default()
    decisions = decisions or {}
    cfg = {}
    for k, v in decisions.items():
        if isinstance(v, dict):
            cfg[k] = (int(v.get("Z", v.get("z", 0))), int(v.get("D", v.get("d", 0))))
        else:
            cfg[k] = (int(v[0]), int(v[1]))
    rows = evaluate_config(tree, cfg)
    f = tree["product"]
    U = rows[f]["U"]
    return {"profit": tree["price"] - U, "U_f": U, "feasible": bool(rows[f]["feasible"]),
            "config": {k: {"Z": int(v[0]), "D": int(v[1])} for k, v in cfg.items()},
            "nodes": rows}


# ---------------------------------------------------------------------------
# 5. 独立复核：全枚举（65536 组合）+ 退化核验（V-08）
# ---------------------------------------------------------------------------
def brute_force_best(tree, tol=None):
    """全枚举 2^n_leaf × 2^(2·n_internal) 个组合，返回最优 U_root。"""
    tol = TOL if tol is None else tol
    leaves = list(tree["leaves"])
    internals = list(tree["internals"])
    order = leaves + internals
    n = len(order)
    idx = {v: i for i, v in enumerate(order)}
    nl, ni = len(leaves), len(internals)
    P = tree["params"]
    pv = [P[v]["p"] for v in order]
    Av = [P[v]["A"] for v in order]
    cv = [P[v]["c"] for v in order]
    tv = [P[v]["t"] for v in order]
    lv = [P[v]["l"] for v in order]
    child_i = [[idx[u] for u in tree["children"][v]] for v in order]
    prod_i = idx[tree["product"]]
    U = [0.0] * n
    Q = [0.0] * n
    Z = [0] * n
    best_u = float("inf")
    for lmask in range(1 << nl):
        for i in range(nl):
            if (lmask >> i) & 1:
                Z[i] = 1
                U[i] = (Av[i] + cv[i]) / (1.0 - pv[i])
                Q[i] = 1.0
            else:
                Z[i] = 0
                U[i] = Av[i]
                Q[i] = 1.0 - pv[i]
        for imask in range(1 << (2 * ni)):
            ok = True
            for k in range(ni):
                j = nl + k
                z = (imask >> (2 * k)) & 1
                d = (imask >> (2 * k + 1)) & 1
                qc = 1.0
                su = 0.0
                szc = 0.0
                for ci in child_i[j]:
                    qc *= Q[ci]
                    su += U[ci]
                    szc += Z[ci] * cv[ci]
                q = (1.0 - pv[j]) * qc
                Kf = Av[j] + (cv[j] if z else 0.0) + su
                Kr = Kf - (su - szc)
                h = 1.0 if (z or j == prod_i) else 0.0
                xi = h * d * tv[j] + (0.0 if z else lv[j])
                den = 1.0 - h * d * (1.0 - q)
                Z[j] = z
                Q[j] = 1.0 if z else q
                if q <= tol or den <= tol:
                    ok = False
                    break
                if z or j == prod_i:
                    R = (Kr + (1.0 - q) * xi) / den
                    U[j] = (Kf + (1.0 - q) * (xi + h * d * R)) / (q / den)
                else:
                    U[j] = Kf
            if ok and U[prod_i] < best_u:
                best_u = U[prod_i]
    return {"U_root": best_u, "profit": tree["price"] - best_u,
            "n_configs": (1 << nl) * (1 << (2 * ni))}


def _q2_reference(case, Z1, Z2, C, D):
    """问题 2 的闭式（EQ-Q2-YIELD / KF / KR / RECUR / COST-Q2），用于 V-08 退化核验。"""
    Q1 = 1.0 - (1 - Z1) * case["p1"]
    Q2 = 1.0 - (1 - Z2) * case["p2"]
    q = (1.0 - case["p0"]) * Q1 * Q2
    Kf = case["A"] + (Z1 * (case["a1"] + case["c1"]) / (1 - case["p1"])
                      + (1 - Z1) * case["a1"]) \
                    + (Z2 * (case["a2"] + case["c2"]) / (1 - case["p2"])
                       + (1 - Z2) * case["a2"])
    Kr = case["A"] + Z1 * case["c1"] + Z2 * case["c2"]
    den = 1.0 - D * (1.0 - q)
    g = q / den
    R = (Kr + C * case["c0"]
         + (1.0 - q) * (D * case["t"] + (1 - C) * case["l"])) / den
    U = (Kf + C * case["c0"]
         + (1.0 - q) * (D * case["t"] + (1 - C) * case["l"] + D * R)) / g
    return case["s"] - U, U


def degeneracy_check(inst, tol=None):
    """把拓扑退化为「两零配件 → 一成品」，与问题 2 闭式逐组合比对（V-08）。"""
    tol = TOL if tol is None else tol
    c = inst["q2_case1"]
    parts = [{"id": "P1", "name": "零配件1", "p": c["p1"], "a": c["a1"], "c": c["c1"]},
             {"id": "P2", "name": "零配件2", "p": c["p2"], "a": c["a2"], "c": c["c2"]}]
    product = {"id": "F", "name": "成品", "p": c["p0"], "A": c["A"], "c": c["c0"],
               "t": c["t"]}
    tree = build_tree(parts, [], product, c["s"], c["l"],
                      product_children=["P1", "P2"])
    rows_out = []
    max_err = 0.0
    for Z1 in (0, 1):
        for Z2 in (0, 1):
            for C in (0, 1):
                for D in (0, 1):
                    cfg = {"P1": (Z1, 0), "P2": (Z2, 0), "F": (C, D)}
                    got = evaluate_config(tree, cfg)["F"]["U"]
                    ref = _q2_reference(c, Z1, Z2, C, D)[1]
                    err = abs(got - ref)
                    max_err = max(max_err, err)
                    rows_out.append({"Z1": Z1, "Z2": Z2, "C": C, "D": D,
                                     "U_q3_degenerate": got, "U_q2_closed_form": ref,
                                     "abs_err": err})
    return {"n_cases": len(rows_out), "max_abs_err": max_err, "rows": rows_out,
            "tolerance": tol}


# ---------------------------------------------------------------------------
# 6. 拓扑扰动扫描
# ---------------------------------------------------------------------------
def _partition_assignments(ids, sizes):
    ids = list(ids)
    for c1 in itertools.combinations(ids, sizes[0]):
        s1 = set(c1)
        rest = [i for i in ids if i not in s1]
        for c2 in itertools.combinations(rest, sizes[1]):
            s2 = set(c2)
            c3 = [i for i in rest if i not in s2]
            yield (list(c1), list(c2), list(c3))


def topology_scan(inst=None, base_result=None, cap=None, tol=None):
    """枚举与表 2 参数相容的装配树连接方案（8 零配件分入 3/3/2 三组）并重解。"""
    inst = inst if inst is not None else load_instance()
    cap = Q3_TOPO_CAP if cap is None else int(cap)
    tol = TOL if tol is None else tol
    base_tree = build_tree_default()
    base_result = base_result if base_result is not None else solve_tree(base_tree)
    base_cfg = {k: (int(v[0]), int(v[1])) for k, v in base_result["config"].items()}
    ids = [d["id"] for d in inst["parts"]]
    plist = list(_partition_assignments(ids, (3, 3, 2)))
    rng = random.Random(SEED)
    rng.shuffle(plist)
    if len(plist) > cap:
        plist = plist[:cap]
    # 保证基准拓扑一定在样本中
    base_groups = (base_tree["children"]["S1"], base_tree["children"]["S2"],
                   base_tree["children"]["S3"])
    base_groups = (list(base_groups[0]), list(base_groups[1]), list(base_groups[2]))
    if base_groups not in [tuple(map(tuple, g)) for g in plist]:
        plist = [base_groups] + plist
    rows = []
    for i, (g1, g2, g3) in enumerate(plist):
        t = build_tree_default(semi_children={"S1": list(g1), "S2": list(g2),
                                              "S3": list(g3)})
        r = solve_tree(t)
        cfg = {k: (int(v[0]), int(v[1])) for k, v in r["config"].items()}
        rows.append({
            "idx": i,
            "groups": "|".join(",".join(g) for g in (g1, g2, g3)),
            "U_f": r["U_root"], "profit": r["profit"], "feasible": r["feasible"],
            "product_Z": cfg[base_tree["product"]][0],
            "product_D": cfg[base_tree["product"]][1],
            "semi_decisions": [[cfg[s][0], cfg[s][1]] for s in ("S1", "S2", "S3")],
            "part_Z": "".join(str(cfg[p][0]) for p in ids),
            "same_as_base": bool(cfg == base_cfg),
            "product_same_as_base": bool(cfg[base_tree["product"]]
                                         == base_cfg[base_tree["product"]]),
        })
    profits = [r["profit"] for r in rows if r["feasible"]]
    n_same = sum(1 for r in rows if r["same_as_base"])
    n_prod_same = sum(1 for r in rows if r["product_same_as_base"])
    return {"n_topologies": len(rows),
            "n_partitions_total": len(list(_partition_assignments(ids, (3, 3, 2)))),
            "cap": cap,
            "decision_consistency_rate": (n_same / len(rows)) if rows else 0.0,
            "product_decision_consistency_rate": (n_prod_same / len(rows)) if rows else 0.0,
            "profit_min": min(profits) if profits else None,
            "profit_max": max(profits) if profits else None,
            "profit_mean": (sum(profits) / len(profits)) if profits else None,
            "base_profit": base_result["profit"],
            "rows": rows}


def strategy_scan(tree=None, tol=None):
    """固定 4 个非叶节点的 (Z, D)，零配件层自由优化 → 256 行策略对照表。"""
    tree = tree if tree is not None else build_tree_default()
    internals = list(tree["internals"])
    rows = []
    for combo in itertools.product([(0, 0), (0, 1), (1, 0), (1, 1)],
                                   repeat=len(internals)):
        fixed = {v: combo[k] for k, v in enumerate(internals)}
        r = solve_tree(tree, fixed=fixed)
        row = {}
        for k, v in enumerate(internals):
            row["%s_Z" % v] = int(combo[k][0])
            row["%s_D" % v] = int(combo[k][1])
        row["U_f"] = r["U_root"]
        row["profit"] = r["profit"]
        row["feasible"] = r["feasible"]
        rows.append(row)
    return {"n": len(rows), "internals": internals, "rows": rows}


# ---------------------------------------------------------------------------
# 7. 结果聚合
# ---------------------------------------------------------------------------
def _clean(o):
    """把 inf/nan 转成 None，保证输出是严格 JSON。"""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, float):
        if o != o or o == float("inf") or o == float("-inf"):
            return None
        return o
    return o


def run():
    inst = load_instance()
    tree = build_tree_default()

    if tree["n_semis"] != Q3_N_SEMI:
        raise AssertionError("ASM-09 拓扑的半成品数与模型常数不一致：%d vs %d"
                             % (tree["n_semis"], Q3_N_SEMI))
    if tree["n_nodes"] != Q3_N_NODES:
        raise AssertionError("ASM-09 拓扑的节点总数与模型常数不一致：%d vs %d"
                             % (tree["n_nodes"], Q3_N_NODES))

    best = solve_tree(tree)
    cfg = {k: (int(v[0]), int(v[1])) for k, v in best["config"].items()}
    rows = evaluate_config(tree, cfg)
    attributed = attributed_breakdown(tree, rows)

    f = tree["product"]
    U_f = rows[f]["U"]
    profit = tree["price"] - U_f

    # 逐节点成本恒等式（分项求和 vs U_v）
    id_err = 0.0
    for v in tree["nodes"]:
        cc = rows[v]["cost"]
        tot = (cc["purchase"] + cc["test"] + cc["assembly"] + cc["disassembly"]
               + cc["exchange"] + cc["child_material"])
        id_err = max(id_err, abs(tot - rows[v]["U"]))
    att_sum = sum(sum(a.values()) for a in attributed.values())
    att_err = abs(att_sum - U_f)

    deg = degeneracy_check(inst)
    bf = brute_force_best(tree)
    scan = strategy_scan(tree)
    topo = topology_scan(inst, base_result=best)

    decision_rows = []
    for v in tree["nodes"]:
        r = rows[v]
        decision_rows.append({"node": v, "name": r["name"], "kind": r["kind"],
                              "Z": r["Z"], "D": r["D"], "U": r["U"], "Q": r["Q"],
                              "q": r["q"]})

    node_rows = []
    for v in tree["nodes"]:
        r = rows[v]
        cc = r["cost"]
        at = attributed[v]
        node_rows.append({
            "node": v, "name": r["name"], "kind": r["kind"], "Z": r["Z"], "D": r["D"],
            "p": r["p"], "q": r["q"], "Q": r["Q"], "U": r["U"],
            "K_f": r["K_f"], "K_r": r["K_r"], "kappa": r["kappa"], "xi": r["xi"],
            "g": r["g"], "R": r["R"],
            "purchase": cc["purchase"], "test": cc["test"], "assembly": cc["assembly"],
            "disassembly": cc["disassembly"], "exchange": cc["exchange"],
            "child_material": cc["child_material"],
            "attributed_purchase": at["purchase"], "attributed_test": at["test"],
            "attributed_assembly": at["assembly"],
            "attributed_disassembly": at["disassembly"],
            "attributed_exchange": at["exchange"],
        })

    tree_bd = {"assembly": 0.0, "test": 0.0, "child_material": 0.0,
               "disassembly": 0.0, "exchange": 0.0}
    for v in tree["nodes"]:
        at = attributed[v]
        tree_bd["assembly"] += at["assembly"]
        tree_bd["test"] += at["test"]
        tree_bd["disassembly"] += at["disassembly"]
        tree_bd["exchange"] += at["exchange"]
        tree_bd["child_material"] += at["purchase"]
    tree_bd["total"] = U_f

    edges = []
    for v in tree["nodes"]:
        for u in tree["children"].get(v, []):
            edges.append([u, v])

    groups = {s: list(tree["children"][s]) for s in ("S1", "S2", "S3") if s in tree["children"]}
    groups[f] = list(tree["children"][f])
    part_groups = {}
    for k, s in enumerate(("S1", "S2", "S3"), start=1):
        if s in tree["children"]:
            part_groups["半成品%d" % k] = [int(p[1:]) for p in tree["children"][s]]

    out = {
        "problem": "问题3",
        "model_spec": "MS-Q3",
        "method": "装配树节点级等效成本聚合 + 节点二值决策的 Pareto 前沿动态规划（全枚举复核）",
        "instance_source": inst["source"],
        "topology": {
            "groups": groups,
            "part_groups": part_groups,
            "nodes": [{"id": v, "name": tree["name"][v], "kind": tree["kind"][v]}
                      for v in tree["nodes"]],
            "edges": edges,
            "n_nodes": tree["n_nodes"],
            "n_parts": tree["n_parts"],
            "n_semis": tree["n_semis"],
            "n_edges": len(edges),
            "data_gap": "ASM-09：图 1 原件未随简报下传，连接关系由表 2 行分组读出；"
                        "其影响由 topology_robust 扫描量化",
        },
        "best": {
            "config": {k: {"Z": int(v[0]), "D": int(v[1])} for k, v in cfg.items()},
            "unit_cost_U_f": U_f,
            "profit": profit,
            "price": tree["price"],
            "exchange_loss": tree["exchange"],
            "Q_root": rows[f]["Q"],
            "q_root": rows[f]["q"],
            "n_root_options": best["n_root_options"],
            "n_root_ties": best["n_root_ties"],
            "root_frontier": best["root_frontier"],
            "feasible": best["feasible"],
        },
        "decision_table": {
            "columns": ["node", "name", "kind", "Z", "D", "U", "Q", "q"],
            "rows": decision_rows,
        },
        "node_cost": {
            "columns": ["node", "name", "kind", "Z", "D", "p", "q", "Q", "U", "K_f",
                        "K_r", "kappa", "xi", "g", "R", "purchase", "test",
                        "assembly", "disassembly", "exchange", "child_material",
                        "attributed_purchase", "attributed_test", "attributed_assembly",
                        "attributed_disassembly", "attributed_exchange"],
            "rows": node_rows,
            "attributed_total": tree_bd,
        },
        "cost_breakdown_root": {
            "purchase": rows[f]["cost"]["purchase"],
            "test": rows[f]["cost"]["test"],
            "assembly": rows[f]["cost"]["assembly"],
            "disassembly": rows[f]["cost"]["disassembly"],
            "exchange": rows[f]["cost"]["exchange"],
            "child_material": rows[f]["cost"]["child_material"],
            "total": U_f,
        },
        "strategy_scan": scan,
        "topology_robust": topo,
        "checks": {
            "tolerance": TOL,
            "node_cost_identity_max_abs_err": id_err,
            "node_cost_identity_within_tol": bool(id_err <= TOL),
            "attributed_sum_abs_err": att_err,
            "attributed_sum_within_tol": bool(att_err <= TOL),
            "degenerate_tree_cases": deg["n_cases"],
            "degenerate_tree_vs_q2_max_abs_err": deg["max_abs_err"],
            "degenerate_tree_within_tol": bool(deg["max_abs_err"] <= 1e-9),
            "brute_force_n_configs": bf["n_configs"],
            "brute_force_minus_dp_U_root": bf["U_root"] - best["U_root"],
            "brute_force_within_tol": bool(abs(bf["U_root"] - best["U_root"]) <= 1e-9),
            "topology_robust_is_mandatory": True,
        },
        "degeneracy_detail": deg["rows"],
        "constants_used": {
            "TOL": TOL, "SEED": SEED, "Q3_N_SEMI": Q3_N_SEMI,
            "Q3_N_NODES": Q3_N_NODES, "Q3_TOPO_CAP": Q3_TOPO_CAP,
        },
        "fallback_constants": list(dict.fromkeys(_FALLBACK_CONSTANTS)),
        "assumptions": [
            "ASM-09 拓扑假设（显式，非图 1 原件抄录）",
            "ASM-10 回收件免采购、仍付再检测费 Z_u c_u",
            "ASM-12 单位化为每件合格成品；回收免采购收益只记一次",
            "ASM-13 每个零配件/半成品/成品节点各定义 Z_v、D_v",
            "ASM-15 调换损失只发生在成品节点，其余节点 l_v = 0",
        ],
        "seed": SEED,
    }
    return _clean(out)


if __name__ == "__main__":  # pragma: no cover
    print(json.dumps(run(), ensure_ascii=False))