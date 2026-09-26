# -*- coding: utf-8 -*-
"""问题 3：m 工序 / n 零配件装配树上的节点级决策模型（EQ-Q3-*，MS-Q3）。

本脚本只负责“算”与“把量写进 JSON”，不画任何图、不做数源声明、不做图表声明。

模型要点
--------
* 拓扑（DECLARATION.json 的 ASM-09 显式假设；图 1 原件未随简报下传，故此常量
  是“假设”不是“题面数字”，并把敏感性交给 topology_scan() 显式量化）：
      {1,2,3} -> 半成品 1，{4,5,6} -> 半成品 2，{7,8} -> 半成品 3，
      三个半成品 -> 成品。
* 方向：成本与合格率自底向上聚合（U_u, Q_u -> K_f(v), q_v, U_v），
  交付需求量按“每件合格成品”单位化（ASM-04），单位化口径下折算系数为 1。
* 决策：每个节点两个二值决策 Z_v（是否检测）与 D_v（不合格件是否拆解）。
  零配件节点无子件可拆解，D_v 恒取 0（在 decision_table 中显式写出，不静默省略）。
* 搜索：自底向上的 (U, Q) 帕累托前沿枚举。父节点 U_v 关于子件 U_u 单调递增、
  关于子件 Q_u 单调递减，故帕累托剪枝不丢全局最优，无需启发式。
* 可达性保护：几何级数分母 1 - h_v D_v (1 - q_v) 恒 >= q_v > 0；仍保留不可交付
  分支返回 feasible=False，而不是 inf。
* 与问题 2 的退化一致性：两零配件一成品时逐项收敛到 EQ-Q2-YIELD / EQ-KF /
  EQ-KR / EQ-Q2-RECUR / EQ-COST-Q2，由 degenerate_check() 对表 1 六种情况
  的全部 16 个 (Z1,Z2,C,D) 组合双路复算核验。

输出（供 main.py 汇总进 outputs.json 的 problem3 段）：
  meta / decision_table / unit_cost / profit / node_cost / strategy_compare /
  topology_robust / tree / demand_fold / verification
"""

from __future__ import annotations

import itertools
import json
import os

# --------------------------------------------------------------------------- #
# 一、题面给定值与模型常数的读取                                                #
#   唯一落点：params.py（若存在）-> PROBLEM_FACTS.json / DECLARATION.json。     #
#   脚本内不手工转录任何题面数值；缺失即报错，不做兜底内联。                     #
# --------------------------------------------------------------------------- #

_HERE = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_HERE)
_ROOT = os.path.dirname(_PARENT)

try:  # 统一常数入口
    import params as _params
except Exception:  # pragma: no cover - params.py 缺失时回落到契约文件
    _params = None

_FACT_FILES = (
    os.path.join(_HERE, "PROBLEM_FACTS.json"),
    os.path.join(_PARENT, "01-prob-analysis", "PROBLEM_FACTS.json"),
    os.path.join(_ROOT, "01-prob-analysis", "PROBLEM_FACTS.json"),
)
_MODEL_FILES = (
    os.path.join(_HERE, "DECLARATION.json"),
    os.path.join(_PARENT, "02-modeling", "DECLARATION.json"),
    os.path.join(_ROOT, "02-modeling", "DECLARATION.json"),
)

_FACT_CACHE = {}
_CONST_CACHE = {}


def _first_file(paths):
    for path in paths:
        if os.path.isfile(path):
            return path
    return None


def _facts_table():
    if not _FACT_CACHE:
        path = _first_file(_FACT_FILES)
        if path is None:
            raise FileNotFoundError("PROBLEM_FACTS.json 未找到：%r" % (list(_FACT_FILES),))
        with open(path, "r", encoding="utf-8") as handle:
            doc = json.load(handle)
        for row in doc["facts"]:
            _FACT_CACHE[row["id"]] = row["value"]
    return _FACT_CACHE


def _consts_table():
    if not _CONST_CACHE:
        path = _first_file(_MODEL_FILES)
        if path is not None:
            with open(path, "r", encoding="utf-8") as handle:
                doc = json.load(handle)
            for row in doc.get("model_constants", []):
                _CONST_CACHE[row["name"]] = row["value"]
    return _CONST_CACHE


def fact(fid):
    """按 id 取题面给定值：params 模块优先，其次 PROBLEM_FACTS.json。"""
    if _params is not None:
        for name in (fid, fid.replace("-", "_"), fid.replace("-", "_").lower()):
            if hasattr(_params, name):
                return getattr(_params, name)
        for holder in ("FACTS", "FACTS_BY_ID", "PROBLEM_FACTS", "FACT_MAP"):
            table = getattr(_params, holder, None)
            if isinstance(table, dict) and fid in table:
                return table[fid]
    table = _facts_table()
    if fid not in table:
        raise KeyError("未登记的题面事实 id：%s" % fid)
    return table[fid]


def const(name, default=None):
    """按键名取模型常数：params 优先，其次 DECLARATION.json 的 model_constants。"""
    if _params is not None and hasattr(_params, name):
        return getattr(_params, name)
    table = _consts_table()
    if name in table:
        return table[name]
    if default is not None:
        return default
    raise KeyError("未登记的模型常数：%s" % name)


def num(value):
    """把 '10%' / 0.1 / 4 统一成 float。"""
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("%"):
            return float(text[:-1]) * 0.01
        return float(text)
    return float(value)


as_rate = num
as_amount = num

# --------------------------------------------------------------------------- #
# 二、事实 id 与拓扑假设                                                        #
# --------------------------------------------------------------------------- #

PART_FACT_FMT = "F-T2-PART-%d"
SEMI_FACT = "F-T2-SEMI"
PRODUCT_FACT = "F-T2-PRODUCT"
PRICE_FACT = "F-T2-PRICE"
FIG_FACT = "F-FIG1"
CASE_FACT_FMT = "F-T1-C%d"

# ASM-09 显式假设（图 1 原件未随简报下传；此处是模型假设，不是题面数字）。
# 节点编号是装配结构标识，不是成本/比率，不构成 facts_audit 意义上的裸数字。
ASM09_GROUPS = (("P1", "P2", "P3"), ("P4", "P5", "P6"), ("P7", "P8"))

# 与表 2 参数相容的拓扑扰动方案：只改动“零配件归属哪一组”，节点参数不变。
TOPOLOGY_VARIANTS = (
    ("ASM-09 基准：{1,2,3}/{4,5,6}/{7,8}",
     (("P1", "P2", "P3"), ("P4", "P5", "P6"), ("P7", "P8"))),
    ("平移 1：{1,2}/{3,4,5}/{6,7,8}",
     (("P1", "P2"), ("P3", "P4", "P5"), ("P6", "P7", "P8"))),
    ("平移 2：{1,2,3,4}/{5,6}/{7,8}",
     (("P1", "P2", "P3", "P4"), ("P5", "P6"), ("P7", "P8"))),
    ("平移 3：{1,2}/{3,4}/{5,6,7,8}",
     (("P1", "P2"), ("P3", "P4"), ("P5", "P6", "P7", "P8"))),
    ("交错：{1,4,7}/{2,5,8}/{3,6}",
     (("P1", "P4", "P7"), ("P2", "P5", "P8"), ("P3", "P6"))),
    ("重排：{1,5,6}/{2,3,7}/{4,8}",
     (("P1", "P5", "P6"), ("P2", "P3", "P7"), ("P4", "P8"))),
)

_LAYER_OF_KIND = {"part": 0, "semi": 1, "product": 2}


# --------------------------------------------------------------------------- #
# 三、装配树的构建与连接                                                        #
# --------------------------------------------------------------------------- #

def build_tree(n_parts=None):
    """按表 2 参数与 ASM-09 的规模读出装配树的全部节点（尚未连接父子）。"""
    fig = fact(FIG_FACT)
    if n_parts is None:
        n_parts = int(fig["零配件数"])

    nodes = {}
    for idx in range(1, n_parts + 1):
        row = fact(PART_FACT_FMT % idx)
        nodes["P%d" % idx] = {
            "id": "P%d" % idx,
            "kind": "part",
            "layer": _LAYER_OF_KIND["part"],
            "children": [],
            "p": as_rate(row["次品率"]),
            "a": as_amount(row["购买单价"]),
            "c": as_amount(row["检测成本"]),
            "A": 0.0,
            "t": 0.0,
            "l": 0.0,
        }

    semi_rows = fact(SEMI_FACT)
    if isinstance(semi_rows, dict):
        semi_rows = [semi_rows]
    for row in semi_rows:
        idx = int(row["编号"])
        nodes["S%d" % idx] = {
            "id": "S%d" % idx,
            "kind": "semi",
            "layer": _LAYER_OF_KIND["semi"],
            "children": [],
            "p": as_rate(row["次品率"]),
            "a": 0.0,
            "c": as_amount(row["检测成本"]),
            "A": as_amount(row["装配成本"]),
            "t": as_amount(row["拆解费用"]),
            "l": 0.0,
        }

    product = fact(PRODUCT_FACT)
    price = fact(PRICE_FACT)
    nodes["F"] = {
        "id": "F",
        "kind": "product",
        "layer": _LAYER_OF_KIND["product"],
        "children": [],
        "p": as_rate(product["次品率"]),
        "a": 0.0,
        "c": as_amount(product["检测成本"]),
        "A": as_amount(product["装配成本"]),
        "t": as_amount(product["拆解费用"]),
        "l": as_amount(price["调换损失"]),
    }
    return nodes, as_amount(price["市场售价"])


def node_ids(nodes):
    """稳定的节点输出顺序：零配件 -> 半成品 -> 成品。"""
    parts = sorted((k for k, v in nodes.items() if v["kind"] == "part"),
                   key=lambda s: int(s[1:]))
    semis = sorted((k for k, v in nodes.items() if v["kind"] == "semi"),
                   key=lambda s: int(s[1:]))
    rest = sorted(k for k, v in nodes.items() if v["kind"] not in ("part", "semi"))
    return parts + semis + rest


def semi_ids(nodes):
    return sorted((k for k, v in nodes.items() if v["kind"] == "semi"),
                  key=lambda s: int(s[1:]))


def wire(nodes, groups):
    """按分组把零配件接到半成品、把半成品接到成品。"""
    for node in nodes.values():
        node["children"] = []
    semis = semi_ids(nodes)
    if len(groups) != len(semis):
        raise ValueError("分组数 %d 与半成品数 %d 不一致" % (len(groups), len(semis)))
    for sid, members in zip(semis, groups):
        missing = [m for m in members if m not in nodes]
        if missing:
            raise KeyError("拓扑引用了不存在的节点：%r" % missing)
        if not members:
            raise ValueError("半成品 %s 无任何子件" % sid)
        nodes[sid]["children"] = list(members)
    if "F" not in nodes or not semis:
        raise KeyError("装配树缺少成品节点或半成品节点")
    nodes["F"]["children"] = list(semis)


# --------------------------------------------------------------------------- #
# 四、节点级评估（EQ-Q3-ASSY / NODE / KF / KAPPA / XI / RECUR / UNITCOST）      #
# --------------------------------------------------------------------------- #

def evaluate_node(node, child_states, Z, D):
    """按节点决策 (Z, D) 与子件状态算 (U_v, Q_v) 及全部分项。

    child_states: [{'U':.., 'Q':.., 'Z':.., 'c':..}, ...] 按 node['children'] 顺序。
    """
    p_v = node["p"]
    A_v = node["A"]
    c_v = node["c"]
    t_v = node["t"]
    l_v = node["l"]

    # ---- 叶节点（零配件，无子件可拆解，D 恒为 0）：EQ-Q3-COST -------------- #
    if not node["children"]:
        q_v = 1.0 - p_v
        if Z:
            purchase = node["a"] / (1.0 - p_v)
            inspection = c_v / (1.0 - p_v)
            Q_v = 1.0
        else:
            purchase = node["a"]
            inspection = 0.0
            Q_v = 1.0 - p_v
        kf = purchase + inspection
        return {
            "U": kf, "Q": Q_v, "q": q_v,
            "Kf": kf, "Kr": 0.0, "kappa": 0.0,
            "g": 1.0, "R": 0.0, "xi": 0.0, "h": 1 if Z else 0,
            "purchase": purchase, "inspection": inspection,
            "assembly": 0.0, "children_cost": 0.0, "disposal": 0.0,
            "feasible": True,
        }

    # ---- 内部节点：EQ-Q3-ASSY / EQ-Q3-NODE -------------------------------- #
    q_v = 1.0 - p_v
    for state in child_states:
        q_v *= state["Q"]
    Q_v = 1.0 if Z else q_v

    # ---- EQ-Q3-KF / EQ-Q3-KAPPA ------------------------------------------- #
    children_cost = sum(state["U"] for state in child_states)
    kappa = sum(state["U"] - state["Z"] * state["c"] for state in child_states)
    inspection = c_v if Z else 0.0
    kf = A_v + inspection + children_cost
    kr = kf - kappa

    # ---- EQ-Q3-XI：h_v = Z_v ∨ 1{成品节点}；ξ_v = h_v D_v t_v + (1-Z_v) l_v -- #
    h = 1 if (Z or node["kind"] == "product") else 0
    xi = h * D * t_v + (0.0 if Z else 1.0) * l_v

    # ---- EQ-Q3-RECUR：分母保护 -------------------------------------------- #
    denom = 1.0 - h * D * (1.0 - q_v)
    if denom <= 0.0:  # pragma: no cover - q_v > 0 时不可达，保留显式分支
        return {
            "U": None, "Q": Q_v, "q": q_v,
            "Kf": kf, "Kr": kr, "kappa": kappa,
            "g": None, "R": None, "xi": xi, "h": h,
            "purchase": 0.0, "inspection": inspection,
            "assembly": A_v, "children_cost": children_cost, "disposal": None,
            "feasible": False,
        }

    g_v = q_v / denom
    R_v = (kr + (1.0 - q_v) * xi) / denom
    disposal = (1.0 - q_v) * (xi + h * D * R_v)

    # ---- EQ-Q3-UNITCOST：h_v = 0 时缺陷上递，本节点不做任何处置 ------------- #
    if h == 0:
        U_v = kf
    else:
        U_v = (kf + disposal) / g_v

    return {
        "U": U_v, "Q": Q_v, "q": q_v,
        "Kf": kf, "Kr": kr, "kappa": kappa,
        "g": g_v, "R": R_v, "xi": xi, "h": h,
        "purchase": 0.0, "inspection": inspection,
        "assembly": A_v, "children_cost": children_cost, "disposal": disposal,
        "feasible": True,
    }


def node_identity_residual(state):
    """分项恒等式残差：装配 + 检测 + 子件 + 处置 == U_v * g_v（或 U_v == Kf）。"""
    kf = state["purchase"] + state["inspection"] + state["assembly"] + state["children_cost"]
    if state["h"] == 1:
        return abs(state["U"] * state["g"] - (kf + state["disposal"]))
    return abs(state["U"] - kf)


# --------------------------------------------------------------------------- #
# 五、自底向上的帕累托前沿精确枚举                                              #
# --------------------------------------------------------------------------- #

def _postorder(nodes, root):
    order = []
    stack = [(root, False)]
    while stack:
        vid, done = stack.pop()
        if done:
            order.append(vid)
        else:
            stack.append((vid, True))
            for child in nodes[vid]["children"]:
                stack.append((child, False))
    return order


def pareto_front(states, tol):
    """保留不被支配的 (U 更小, Q 更大) 状态；支配判据带容差。"""
    if not states:
        return []
    uniq = {}
    for state in states:
        key = (round(state["U"], 12), round(state["Q"], 12))
        prev = uniq.get(key)
        if prev is None or (state["Z"], state["D"]) < (prev["Z"], prev["D"]):
            uniq[key] = state
    cand = list(uniq.values())
    keep = []
    for i, s in enumerate(cand):
        dominated = False
        for j, t in enumerate(cand):
            if i == j:
                continue
            better_u = t["U"] < s["U"] - tol
            better_q = t["Q"] > s["Q"] + tol
            if (t["U"] <= s["U"] + tol and t["Q"] >= s["Q"] - tol
                    and (better_u or better_q)):
                dominated = True
                break
        if not dominated:
            keep.append(s)
    return keep


def _wrap(vid, Z, D, stats, child_combo, children):
    dec = {}
    for child, state in zip(children, child_combo):
        dec.update(state["dec"])
        dec[child] = (state["Z"], state["D"])
    dec[vid] = (Z, D)
    out = dict(stats)
    out.update({"node": vid, "Z": Z, "D": D, "dec": dec})
    return out


def solve_fronts(nodes, tol):
    """自底向上求每个节点的 (U, Q) 帕累托前沿；返回 fronts 与不可行组合。"""
    order = _postorder(nodes, "F")
    fronts = {}
    infeasible = []
    for vid in order:
        node = nodes[vid]
        children = node["children"]
        if not children:
            states = []
            for Z in (0, 1):
                stats = evaluate_node(node, [], Z, 0)
                if not stats["feasible"]:
                    infeasible.append((vid, Z, 0))
                    continue
                states.append(_wrap(vid, Z, 0, stats, [], []))
        else:
            combos = list(itertools.product(*[fronts[c] for c in children]))
            states = []
            for Z in (0, 1):
                for D in (0, 1):
                    for combo in combos:
                        child_states = [
                            {"U": s["U"], "Q": s["Q"], "Z": s["Z"], "c": nodes[c]["c"]}
                            for c, s in zip(children, combo)
                        ]
                        stats = evaluate_node(node, child_states, Z, D)
                        if not stats["feasible"]:
                            infeasible.append((vid, Z, D))
                            continue
                        states.append(_wrap(vid, Z, D, stats, combo, children))
        fronts[vid] = pareto_front(states, tol)
    return fronts, infeasible


def replay(nodes, dec, tol):
    """按给定决策自底向上重算全部节点量（用于成本分解与分项核验）。"""
    order = _postorder(nodes, "F")
    vals = {}
    for vid in order:
        node = nodes[vid]
        Z, D = dec[vid]
        child_states = []
        for child in node["children"]:
            cz, _cd = dec[child]
            child_states.append({
                "U": vals[child]["U"], "Q": vals[child]["Q"],
                "Z": cz, "c": nodes[child]["c"],
            })
        stats = evaluate_node(node, child_states, Z, D)
        if not stats["feasible"]:
            raise RuntimeError("决策组合不可交付：节点 %s Z=%s D=%s" % (vid, Z, D))
        stats["Z"] = Z
        stats["D"] = D
        vals[vid] = stats
    return vals


# --------------------------------------------------------------------------- #
# 六、问题 2 闭式解参考（仅用于退化一致性核验 EQ-Q2-*）                          #
# --------------------------------------------------------------------------- #

def q2_reference(p1, a1, c1, p2, a2, c2, p0, A, c0, t, l, Z1, Z2, C, D):
    """EQ-Q2-YIELD / EQ-KF / EQ-KR / EQ-Q2-RECUR / EQ-COST-Q2 的独立实现。"""
    Q1 = 1.0 - (1 - Z1) * p1
    Q2 = 1.0 - (1 - Z2) * p2
    q = (1.0 - p0) * Q1 * Q2
    kf = A + (Z1 * (a1 + c1) / (1 - p1) + (1 - Z1) * a1) \
           + (Z2 * (a2 + c2) / (1 - p2) + (1 - Z2) * a2)
    kr = A + Z1 * c1 + Z2 * c2
    denom = 1.0 - D * (1.0 - q)
    g = q / denom
    R = (kr + C * c0 + (1.0 - q) * (D * t + (1 - C) * l)) / denom
    return (kf + C * c0 + (1.0 - q) * (D * t + (1 - C) * l + D * R)) / g


def _degenerate_tree(case_row):
    """把问题 3 引擎退化到“两零配件一成品”，参数取表 1 的某一行。"""
    left = case_row["零配件1"]
    right = case_row["零配件2"]
    prod = case_row["成品"]
    nodes = {
        "P1": {"id": "P1", "kind": "part", "layer": 0, "children": [],
               "p": as_rate(left["次品率"]), "a": as_amount(left["购买单价"]),
               "c": as_amount(left["检测成本"]), "A": 0.0, "t": 0.0, "l": 0.0},
        "P2": {"id": "P2", "kind": "part", "layer": 0, "children": [],
               "p": as_rate(right["次品率"]), "a": as_amount(right["购买单价"]),
               "c": as_amount(right["检测成本"]), "A": 0.0, "t": 0.0, "l": 0.0},
        "F": {"id": "F", "kind": "product", "layer": 2, "children": ["P1", "P2"],
              "p": as_rate(prod["次品率"]), "a": 0.0,
              "c": as_amount(prod["检测成本"]), "A": as_amount(prod["装配成本"]),
              "t": as_amount(case_row["拆解费用"]), "l": as_amount(case_row["调换损失"])},
    }
    return nodes


def degenerate_check(tol):
    """V-08：节点级递推在“两零配件一成品”上逐项收敛到问题 2 的闭式。"""
    pairs = []
    worst = 0.0
    for case in range(1, 7):
        row = fact(CASE_FACT_FMT % case)
        nodes = _degenerate_tree(row)
        left = row["零配件1"]
        right = row["零配件2"]
        prod = row["成品"]
        for Z1 in (0, 1):
            for Z2 in (0, 1):
                for C in (0, 1):
                    for D in (0, 1):
                        dec = {"P1": (Z1, 0), "P2": (Z2, 0), "F": (C, D)}
                        u3 = replay(nodes, dec, tol)["F"]["U"]
                        u2 = q2_reference(
                            as_rate(left["次品率"]), as_amount(left["购买单价"]),
                            as_amount(left["检测成本"]),
                            as_rate(right["次品率"]), as_amount(right["购买单价"]),
                            as_amount(right["检测成本"]),
                            as_rate(prod["次品率"]), as_amount(prod["装配成本"]),
                            as_amount(prod["检测成本"]),
                            as_amount(row["拆解费用"]), as_amount(row["调换损失"]),
                            Z1, Z2, C, D,
                        )
                        residual = abs(u3 - u2)
                        worst = max(worst, residual)
                        pairs.append({
                            "case": case, "Z1": Z1, "Z2": Z2, "C": C, "D": D,
                            "u_q3": u3, "u_q2_ref": u2, "residual": residual,
                        })
    return worst, pairs


# --------------------------------------------------------------------------- #
# 七、策略组合对照（供逐方案对比使用，不写图表声明）                             #
# --------------------------------------------------------------------------- #

def strategy_table(nodes, price, tol):
    """半成品统一 (Z,D) 模式 x 成品 (Z,D) 的组合对照；零配件取该模式下的局部最优。"""
    semis = semi_ids(nodes)
    rows = []
    for semi_Z in (0, 1):
        for semi_D in (0, 1):
            for final_Z in (0, 1):
                for final_D in (0, 1):
                    dec = {"F": (final_Z, final_D)}
                    for sid in semis:
                        dec[sid] = (semi_Z, semi_D)
                    for vid, node in nodes.items():
                        if node["kind"] == "part":
                            dec[vid] = (0, 0)
                    for sid in semis:
                        kids = nodes[sid]["children"]
                        best_local = None
                        for pattern in itertools.product((0, 1), repeat=len(kids)):
                            trial = dict(dec)
                            for kid, z in zip(kids, pattern):
                                trial[kid] = (z, 0)
                            candidate = replay(nodes, trial, tol)[sid]["U"]
                            if best_local is None or candidate < best_local[0]:
                                best_local = (candidate, pattern)
                        for kid, z in zip(kids, best_local[1]):
                            dec[kid] = (z, 0)
                    vals = replay(nodes, dec, tol)
                    unit_cost = vals["F"]["U"]
                    rows.append({
                        "semi_Z": semi_Z,
                        "semi_D": semi_D,
                        "final_Z": final_Z,
                        "final_D": final_D,
                        "parts_Z": [dec[k][0] for k in node_ids(nodes) if nodes[k]["kind"] == "part"],
                        "unit_cost": unit_cost,
                        "profit": price - unit_cost,
                        "root_g": vals["F"]["g"],
                    })
    return rows


# --------------------------------------------------------------------------- #
# 八、拓扑扰动扫描（ASM-09 的稳健性）                                            #
# --------------------------------------------------------------------------- #

def topology_scan(tol, price=None):
    rows = []
    baseline = None
    for name, groups in TOPOLOGY_VARIANTS:
        nodes, price_local = build_tree()
        if price is not None:
            price_local = price
        wire(nodes, groups)
        fronts, _infeasible = solve_fronts(nodes, tol)
        if not fronts["F"]:
            rows.append({"variant": name, "groups": [list(g) for g in groups],
                         "feasible": False, "unit_cost": None, "profit": None,
                         "decision": None, "flip_vs_asm09": None})
            continue
        best = min(fronts["F"], key=lambda st: (round(st["U"], 12), -round(st["Q"], 12)))
        dec = {k: [int(v[0]), int(v[1])] for k, v in best["dec"].items()}
        if baseline is None:
            baseline = dec
        flip = any(dec.get(k) != baseline.get(k) for k in set(dec) | set(baseline))
        rows.append({
            "variant": name,
            "groups": [list(g) for g in groups],
            "feasible": True,
            "unit_cost": best["U"],
            "profit": price_local - best["U"],
            "decision": dec,
            "flip_vs_asm09": flip,
        })
    return rows


# --------------------------------------------------------------------------- #
# 九、编排：求解 + 结果组装                                                     #
# --------------------------------------------------------------------------- #

def build_results(tol=None):
    if tol is None:
        tol = const("数值容差", 1.0e-06)

    nodes, price = build_tree()
    wire(nodes, ASM09_GROUPS)

    fronts, infeasible = solve_fronts(nodes, tol)
    if not fronts["F"]:
        raise RuntimeError("成品节点无可行决策组合，请检查参数与拓扑")

    best = min(fronts["F"], key=lambda st: (round(st["U"], 12), -round(st["Q"], 12)))
    dec = dict(best["dec"])
    vals = replay(nodes, dec, tol)

    unit_cost = vals["F"]["U"]
    profit = price - unit_cost
    order = node_ids(nodes)

    decision_table = [
        {"node": vid, "kind": nodes[vid]["kind"],
         "Z": int(dec[vid][0]), "D": int(dec[vid][1])}
        for vid in order
    ]

    node_cost = []
    residuals = []
    for vid in order:
        state = vals[vid]
        node_cost.append({
            "node": vid, "kind": nodes[vid]["kind"],
            "Z": int(dec[vid][0]), "D": int(dec[vid][1]),
            "U": state["U"], "Q": state["Q"], "q": state["q"],
            "Kf": state["Kf"], "Kr": state["Kr"], "kappa": state["kappa"],
            "g": state["g"], "R": state["R"], "xi": state["xi"], "h": state["h"],
            "purchase": state["purchase"], "inspection": state["inspection"],
            "assembly": state["assembly"], "children_cost": state["children_cost"],
            "disposal": state["disposal"],
            "n_children": len(nodes[vid]["children"]),
        })
        residuals.append({"node": vid, "residual": node_identity_residual(state)})

    v07_max_residual = max(r["residual"] for r in residuals)

    tree = {
        "nodes": [
            {"id": vid, "kind": nodes[vid]["kind"], "layer": nodes[vid]["layer"],
             "U": vals[vid]["U"], "Q": vals[vid]["Q"],
             "Z": int(dec[vid][0]), "D": int(dec[vid][1]),
             "p": nodes[vid]["p"]}
            for vid in order
        ],
        "edges": [[vid, child] for vid in order for child in nodes[vid]["children"]],
    }

    demand_fold = [
        {"node": vid,
         "delivered_per_final": 1.0,
         "rounds_per_delivery": (1.0 / vals[vid]["g"]) if vals[vid]["g"] else None}
        for vid in order
    ]

    v08_max_residual, v08_pairs = degenerate_check(tol)

    strategy_compare = strategy_table(nodes, price, tol)

    topology_robust = topology_scan(tol, price=price)
    feasible_rows = [r for r in topology_robust if r.get("feasible")]
    flips = sum(1 for r in feasible_rows if r.get("flip_vs_asm09"))
    v09_consistency = (1.0 - flips / len(feasible_rows)) if feasible_rows else None

    semi_count = len(semi_ids(nodes))
    meta = {
        "model": "MS-Q3",
        "topology_assumption": "ASM-09",
        "topology_note": "图 1 原件未随简报下传，连接关系按 ASM-09 显式假设，"
                         "并由 topology_robust 显式量化其影响",
        "n_parts": len([k for k in order if nodes[k]["kind"] == "part"]),
        "n_semis": semi_count,
        "n_nodes": len(order),
        "unit": "元/件",
        "profit_definition": "每件合格成品的期望利润 = 市场售价 s - 每件交付件的等效获取成本 U_f",
        "direction": "成本与合格率自底向上聚合，交付需求量自顶向下折算（单位化口径）",
        "search": "自底向上 (U, Q) 帕累托前沿精确枚举，无启发式",
        "decision_space": "每节点 (Z_v, D_v) 二值；零配件节点无子件，D_v 恒为 0",
        "infeasible_combos": len(infeasible),
        "tolerance": tol,
        "price": price,
        "pareto_front_size_root": len(fronts["F"]),
    }

    verification = {
        "v07_max_residual": v07_max_residual,
        "v07_residuals": residuals,
        "v08_max_residual": v08_max_residual,
        "v08_pairs": v08_pairs,
        "v09_consistency_rate": v09_consistency,
        "v09_flips": flips,
        "v09_variants": len(feasible_rows),
        "tolerance": tol,
    }

    return {
        "meta": meta,
        "decision_table": decision_table,
        "unit_cost": unit_cost,
        "profit": profit,
        "node_cost": node_cost,
        "strategy_compare": strategy_compare,
        "topology_robust": topology_robust,
        "tree": tree,
        "demand_fold": demand_fold,
        "verification": verification,
    }


# 兼容 main.py 可能采用的入口名（只指向同一个实现，不产生第二套结果）
run = build_results
solve = build_results
compute = build_results
main = build_results


def write_results(path=None, tol=None):
    """把问题 3 的全部结果写到 JSON（供 main.py 汇总或本模块独立自查）。"""
    payload = build_results(tol=tol)
    if path is None:
        path = os.path.join(_HERE, "problem3_results.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    return path


if __name__ == "__main__":
    write_results()