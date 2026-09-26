```python
# -*- coding: utf-8 -*-
"""问题 3 编程实现：m 道工序、n 个零配件的节点级装配树决策模型。

覆盖 DECLARATION.json 的 MS-Q3 全部方程：
    EQ-Q3-ASSY      q_v = (1 - p_v) * prod_{u in ch(v)} Q_u
    EQ-Q3-NODE      Q_v = Z_v + (1 - Z_v) * q_v
    EQ-Q3-COST      叶节点 U_v = Z_v (a_v + c_v)/(1 - p_v) + (1 - Z_v) a_v
    EQ-Q3-KF        K_f(v) = A_v + Z_v c_v + sum_{u in ch(v)} U_u ; K_r(v) = K_f(v) - kappa_v
    EQ-Q3-KAPPA     kappa_v = sum_{u in ch(v)} (U_u - Z_u c_u)
    EQ-Q3-XI        h_v = Z_v or 1{v 是成品节点} ; xi_v = h_v D_v t_v + (1 - Z_v) l_v
    EQ-Q3-RECUR     g_v = q_v / (1 - h_v D_v (1 - q_v))
                    R_v = (K_r(v) + (1 - q_v) xi_v) / (1 - h_v D_v (1 - q_v))
    EQ-Q3-UNITCOST  U_v = (K_f(v) + (1 - q_v)(xi_v + h_v D_v R_v)) / g_v
                        （Z_v = 1，或 v 为成品节点）
                    U_v = K_f(v)  （Z_v = 0 且 v 非成品节点：子件缺陷上递）
    EQ-Q3-PROFIT    Pi = s - U_f

递推方向纪律（MODELING_REPORT §1.3 / §4.3.4 的统一表述）：
    成本与合格率自底向上聚合（叶 -> 根）；
    交付需求量自顶向下折算（根 -> 叶）。
单件口径（ASM-04）下需求量恒为 1，本模块只需实现前者。

拓扑纪律（ASM-09）：图 1 原件未随阶段简报下传，连接关系取自
constants.TABLE2 的 semi_children 键，属常量级假设。本模块同时输出
拓扑扰动扫描（q3_topology_robust）对该假设的影响边界。

所有数值常数来自 params（题面给定值）与 constants（实现参数 / 模型常数），
函数体内不写死任何题面数值。结果一律写入工作目录下的 q3_results.json。
"""

from __future__ import annotations

from params import *  # noqa: F401,F403  题面给定值（表 2 / 图 1 规模）

import itertools
import json
import random

import constants as _constants


TABLE2 = getattr(_constants, "TABLE2", None)
IMPLEMENTATION_PARAMS = getattr(_constants, "IMPLEMENTATION_PARAMS", None) or {}
MODEL_CONSTANTS = getattr(_constants, "MODEL_CONSTANTS", None) or {}

OUTPUT_FILE = "q3_results.json"
EPSILON = 1e-12

_RECORD_KEYS = (
    "id", "kind", "p", "Z", "D", "q", "Q", "U",
    "K_f", "K_r", "kappa", "xi", "h", "g", "R", "c_own",
)


# --------------------------------------------------------------------------
# 通用取值工具
# --------------------------------------------------------------------------

def _to_float(value):
    """把题面给定值（可能是 '10%' 形式的字符串）转成 float。"""
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("%"):
            return float(text[:-1]) / 100.0
        return float(text)
    return float(value)


def _pick(mapping, *names, default=None):
    """按候选键名依次取值；都取不到时返回 default。"""
    if isinstance(mapping, dict):
        for name in names:
            if name in mapping:
                return mapping[name]
    return default


def _const(*names, default=None):
    """先从 IMPLEMENTATION_PARAMS、再从中 MODEL_CONSTANTS 取常数。"""
    for source in (IMPLEMENTATION_PARAMS, MODEL_CONSTANTS):
        got = _pick(source, *names)
        if got is not None:
            return got
    return default


def _as_records(raw):
    """把 list[dict] 或 dict{id: dict} 统一成按 id 升序的 list[dict]。"""
    if raw is None:
        return []
    if isinstance(raw, dict):
        records = []
        for key, value in raw.items():
            item = dict(value) if isinstance(value, dict) else {}
            if not any(k in item for k in ("id", "编号", "no")):
                item["id"] = key
            records.append(item)
        records.sort(key=lambda item: item.get("id", 0))
        return records
    return [dict(item) for item in raw]


# --------------------------------------------------------------------------
# 常量表读取（表 2 + 图 1 拓扑假设）
# --------------------------------------------------------------------------

def _load_table2(table2=None):
    """把 constants.TABLE2 规范化成 {parts, semis, product, semi_children}。"""
    t2 = TABLE2 if table2 is None else table2

    raw_parts = _pick(t2, "parts", "part", "零配件", "components")
    raw_semis = _pick(t2, "semis", "semi", "半成品", "halves")
    raw_product = _pick(t2, "product", "成品", "final", "root")
    raw_children = _pick(t2, "semi_children", "children", "topology")

    if raw_parts is None or raw_semis is None or raw_product is None:
        raise KeyError("constants.TABLE2 缺少 parts / semis / product，键名与常量表不符")

    parts = []
    for item in _as_records(raw_parts):
        parts.append({
            "id": int(_pick(item, "id", "编号", "no")),
            "p": _to_float(_pick(item, "p", "次品率", "defect_rate")),
            "a": _to_float(_pick(item, "a", "购买单价", "price", "purchase")),
            "c": _to_float(_pick(item, "c", "检测成本", "inspect_cost")),
        })

    semis = []
    for item in _as_records(raw_semis):
        semis.append({
            "id": int(_pick(item, "id", "编号", "no")),
            "p": _to_float(_pick(item, "p", "次品率", "defect_rate")),
            "A": _to_float(_pick(item, "A", "装配成本", "assemble_cost")),
            "c": _to_float(_pick(item, "c", "检测成本", "inspect_cost")),
            "t": _to_float(_pick(item, "t", "拆解费用", "disassemble_cost")),
        })

    prod_source = [raw_product] if isinstance(raw_product, dict) else raw_product
    prod_records = _as_records(prod_source)
    if not prod_records:
        raise KeyError("constants.TABLE2 的 product 段为空")
    prod_item = prod_records[0]

    price = _pick(prod_item, "s", "市场售价", "sale_price")
    if price is None:
        price = _pick(t2, "s", "market_price", "售价", "市场售价")
    loss = _pick(prod_item, "l", "调换损失", "exchange_loss")
    if loss is None:
        loss = _pick(t2, "l", "exchange_loss", "调换损失")

    product = {
        "p": _to_float(_pick(prod_item, "p", "次品率", "defect_rate")),
        "A": _to_float(_pick(prod_item, "A", "装配成本", "assemble_cost")),
        "c": _to_float(_pick(prod_item, "c", "检测成本", "inspect_cost")),
        "t": _to_float(_pick(prod_item, "t", "拆解费用", "disassemble_cost")),
        "s": _to_float(price),
        "l": _to_float(loss),
    }

    semi_children = {}
    if isinstance(raw_children, dict):
        for key, value in raw_children.items():
            semi_children[int(key)] = [int(x) for x in value]
    elif raw_children is not None:
        for index, value in enumerate(raw_children, start=1):
            semi_children[index] = [int(x) for x in value]

    if not semi_children:
        # 兜底形态：图 1 与 TABLE2["semi_children"] 同时缺失时，
        # 按零配件/半成品数量把零配件 id 顺序切块（8 件 3 半 -> 3/3/2）。
        ids = [item["id"] for item in parts]
        n_ids = len(ids)
        n_semis = max(1, len(semis))
        base = n_ids // n_semis
        remainder = n_ids % n_semis
        cursor = 0
        for index, semi in enumerate(semis):
            size = base + (1 if index < remainder else 0)
            semi_children[semi["id"]] = ids[cursor:cursor + size]
            cursor += size

    return {"parts": parts, "semis": semis, "product": product,
            "semi_children": semi_children}


# --------------------------------------------------------------------------
# 装配树
# --------------------------------------------------------------------------

def _reverse_topo(nodes, root):
    """自底向上的拓扑序（叶在前、根在后）。"""
    order = []
    seen = set()

    def visit(nid):
        if nid in seen:
            return
        seen.add(nid)
        for child in nodes[nid]["children"]:
            visit(child)
        order.append(nid)

    visit(root)
    return order


def build_tree(spec=None):
    """按 ASM-09 的拓扑假设构造装配树（父 -> 子邻接表）。"""
    if spec is None:
        spec = _load_table2()

    nodes = {}

    for part in spec["parts"]:
        nid = "P%d" % part["id"]
        nodes[nid] = {
            "id": nid, "kind": "part", "label": "零配件%d" % part["id"],
            "p": part["p"], "a": part["a"], "c": part["c"],
            "A": 0.0, "t": 0.0, "l": 0.0, "children": [],
        }

    semi_ids = []
    for semi in spec["semis"]:
        nid = "S%d" % semi["id"]
        semi_ids.append(nid)
        nodes[nid] = {
            "id": nid, "kind": "semi", "label": "半成品%d" % semi["id"],
            "p": semi["p"], "a": 0.0, "c": semi["c"],
            "A": semi["A"], "t": semi["t"], "l": 0.0,
            "children": ["P%d" % pid for pid in spec["semi_children"][semi["id"]]],
        }

    nodes["F"] = {
        "id": "F", "kind": "product", "label": "成品",
        "p": spec["product"]["p"], "a": 0.0, "c": spec["product"]["c"],
        "A": spec["product"]["A"], "t": spec["product"]["t"],
        "l": spec["product"]["l"], "children": list(semi_ids),
    }

    return {
        "nodes": nodes,
        "root": "F",
        "parts": ["P%d" % item["id"] for item in spec["parts"]],
        "semis": semi_ids,
        "price": spec["product"]["s"],
        "exchange_loss": spec["product"]["l"],
        "order": _reverse_topo(nodes, "F"),
    }


# --------------------------------------------------------------------------
# 节点评估
# --------------------------------------------------------------------------

def _eval_part(node, Z):
    """零配件叶节点：EQ-Q3-COST（检测时按 1/(1-p) 采购倍数放大）。"""
    p = node["p"]
    q = 1.0 - p
    if Z:
        scale = 1.0 / (1.0 - p)
        purchase = node["a"] * scale
        inspect = node["c"] * scale
        U = purchase + inspect
        Q = 1.0
    else:
        purchase = node["a"]
        inspect = 0.0
        U = purchase
        Q = q

    return {
        "id": node["id"], "kind": "part", "p": p,
        "Z": int(Z), "D": 0,
        "q": q, "Q": Q, "U": U,
        "K_f": U, "K_r": 0.0, "kappa": 0.0,
        "xi": 0.0, "h": 0, "g": 1.0, "R": 0.0,
        "c_own": node["c"],
        "purchase": purchase, "inspect": inspect,
        "assemble": 0.0, "disassemble": 0.0, "exchange": 0.0,
    }


def _eval_internal(node, Z, D, child_results, is_product):
    """半成品 / 成品节点：EQ-Q3-KF / KAPPA / XI / RECUR / UNITCOST。

    返回 None 表示该配置下装配链不可交付（几何级数分母为 0）。
    """
    p = node["p"]
    A = node["A"]
    c = node["c"]
    t = node["t"]
    l = node["l"]

    q = 1.0 - p
    sum_u = 0.0
    kappa = 0.0
    for child in child_results:
        q *= child["Q"]
        sum_u += child["U"]
        kappa += child["U"] - child["Z"] * child["c_own"]

    Q = 1.0 if Z else q
    K_f = A + Z * c + sum_u
    K_r = K_f - kappa

    h = 1 if (Z or is_product) else 0
    xi = h * D * t + (1 - Z) * l

    denom = 1.0 - h * D * (1.0 - q)
    if denom <= EPSILON:
        return None

    closure = bool(Z) or bool(is_product)
    if closure:
        g = q / denom
        if g <= EPSILON:
            return None
        R = (K_r + (1.0 - q) * xi) / denom
        U = (K_f + (1.0 - q) * (xi + h * D * R)) / g
    else:
        g = q / denom
        R = (K_r + (1.0 - q) * xi) / denom
        U = K_f

    return {
        "id": node["id"], "kind": node["kind"], "p": p,
        "Z": int(Z), "D": int(D),
        "q": q, "Q": Q, "U": U,
        "K_f": K_f, "K_r": K_r, "kappa": kappa,
        "xi": xi, "h": h, "g": g, "R": R,
        "c_own": c,
        "closure": closure,
        "sum_children_U": sum_u,
    }


def _semi_candidates(tree, semi_id):
    """枚举半成品自身的 (Z_v, D_v) 与其子零配件检测组合的全部可行配置。"""
    node = tree["nodes"][semi_id]
    kids = node["children"]
    out = []

    for zs in itertools.product((0, 1), repeat=len(kids)):
        child_results = []
        for kid, z in zip(kids, zs):
            part = tree["nodes"][kid]
            res = _eval_part(part, z)
            child_results.append({
                "U": res["U"], "Q": res["Q"], "Z": res["Z"],
                "c_own": part["c"],
            })
        for Z in (0, 1):
            for D in (0, 1):
                res = _eval_internal(node, Z, D, child_results, is_product=False)
                if res is None:
                    continue
                res["children_Z"] = tuple(int(z) for z in zs)
                res["kappa_contrib"] = res["U"] - res["Z"] * res["c_own"]
                out.append(res)

    return out


def enumerate_optimal(tree, semi_candidates=None):
    """自底向上聚合 + 节点二值决策全枚举，取单位合格成品成本最小者。"""
    semi_ids = list(tree["semis"])
    if semi_candidates is None:
        semi_candidates = {sid: _semi_candidates(tree, sid) for sid in semi_ids}

    for sid in semi_ids:
        if not semi_candidates[sid]:
            raise RuntimeError("半成品 %s 在该拓扑下无可行配置" % sid)

    product_node = tree["nodes"]["F"]
    p_f = product_node["p"]
    A_f = product_node["A"]
    c_f = product_node["c"]
    t_f = product_node["t"]
    l_f = product_node["l"]

    best = None
    n_evaluated = 0

    for combo in itertools.product(*(semi_candidates[sid] for sid in semi_ids)):
        sum_u = 0.0
        prod_q = 1.0
        sum_kappa = 0.0
        for cand in combo:
            sum_u += cand["U"]
            prod_q *= cand["Q"]
            sum_kappa += cand["kappa_contrib"]

        base_q = (1.0 - p_f) * prod_q
        base_kf = A_f + sum_u
        base_kr = base_kf - sum_kappa

        for Z, D in ((0, 0), (0, 1), (1, 0), (1, 1)):
            n_evaluated += 1
            K_f = base_kf + Z * c_f
            K_r = base_kr + Z * c_f
            xi = D * t_f + (1 - Z) * l_f

            denom = 1.0 - D * (1.0 - base_q)   # 成品节点恒有 h_v = 1
            if denom <= EPSILON:
                continue
            g = base_q / denom
            if g <= EPSILON:
                continue

            R = (K_r + (1.0 - base_q) * xi) / denom
            U = (K_f + (1.0 - base_q) * (xi + D * R)) / g

            if best is None or U < best["U"] - EPSILON:
                child_results = [
                    {"U": cand["U"], "Q": cand["Q"], "Z": cand["Z"],
                     "c_own": tree["nodes"][sid]["c"]}
                    for sid, cand in zip(semi_ids, combo)
                ]
                res = _eval_internal(product_node, Z, D, child_results,
                                     is_product=True)
                if res is None:
                    continue
                best = {
                    "U": res["U"],
                    "profit": tree["price"] - res["U"],
                    "product": res,
                    "semis": list(combo),
                    "semi_ids": list(semi_ids),
                }

    if best is None:
        raise RuntimeError("装配树上不存在可行决策（所有配置的装配链均不可交付）")

    best["n_evaluated"] = n_evaluated
    return best


# --------------------------------------------------------------------------
# 结果整理
# --------------------------------------------------------------------------

def _decision_table(tree, best):
    table = {}
    for sid, cand in zip(best["semi_ids"], best["semis"]):
        node = tree["nodes"][sid]
        for kid, z in zip(node["children"], cand["children_Z"]):
            table[kid] = {"Z": int(z), "D": 0}
        table[sid] = {"Z": int(cand["Z"]), "D": int(cand["D"])}
    table["F"] = {"Z": int(best["product"]["Z"]),
                  "D": int(best["product"]["D"])}
    return table


def _node_records(tree, best):
    records = []
    for sid, cand in zip(best["semi_ids"], best["semis"]):
        node = tree["nodes"][sid]
        for kid, z in zip(node["children"], cand["children_Z"]):
            records.append(_eval_part(tree["nodes"][kid], z))
        semi_record = {key: cand.get(key) for key in _RECORD_KEYS}
        semi_record["children_Z"] = {kid: int(z)
                                     for kid, z in zip(node["children"],
                                                       cand["children_Z"])}
        records.append(semi_record)
    records.append({key: best["product"].get(key) for key in _RECORD_KEYS})
    return records


def _cost_breakdown(tree, best):
    """成品层单位成本分解（各项之和精确等于 U_f）。"""
    prod = best["product"]
    node = tree["nodes"]["F"]
    g = prod["g"]
    q = prod["q"]
    Z = prod["Z"]
    D = prod["D"]
    h = prod["h"]

    assemble = node["A"] / g
    inspect = Z * node["c"] / g
    children = prod["sum_children_U"] / g
    disassemble = (1.0 - q) * h * D * node["t"] / g
    exchange = (1.0 - q) * (1 - Z) * node["l"] / g
    recycle = (1.0 - q) * h * D * prod["R"] / g
    total = assemble + inspect + children + disassemble + exchange + recycle

    semis = {}
    for sid, cand in zip(best["semi_ids"], best["semis"]):
        semis[sid] = {
            "U": cand["U"], "Q": cand["Q"], "q": cand["q"],
            "Z": cand["Z"], "D": cand["D"],
            "K_f": cand["K_f"], "K_r": cand["K_r"], "kappa": cand["kappa"],
            "xi": cand["xi"], "g": cand["g"], "R": cand["R"],
        }

    return {
        "unit_cost": prod["U"],
        "assemble": assemble,
        "inspect_product": inspect,
        "children_acquire": children,
        "disassemble": disassemble,
        "exchange": exchange,
        "recycle_chain": recycle,
        "sum_of_parts": total,
        "residual": prod["U"] - total,
        "semis": semis,
    }


def _uniform_policy_cost(tree, part_z, semi_z, semi_d, prod_z, prod_d):
    """统一策略：所有零配件同 Z、所有半成品同 (Z,D)、成品 (Z,D)。"""
    semi_records = []
    for sid in tree["semis"]:
        node = tree["nodes"][sid]
        child_results = []
        for kid in node["children"]:
            part = tree["nodes"][kid]
            res = _eval_part(part, part_z)
            child_results.append({"U": res["U"], "Q": res["Q"], "Z": res["Z"],
                                  "c_own": part["c"]})
        res = _eval_internal(node, semi_z, semi_d, child_results,
                             is_product=False)
        if res is None:
            return None
        semi_records.append(res)

    child_results = [
        {"U": rec["U"], "Q": rec["Q"], "Z": rec["Z"],
         "c_own": tree["nodes"][sid]["c"]}
        for sid, rec in zip(tree["semis"], semi_records)
    ]
    return _eval_internal(tree["nodes"]["F"], prod_z, prod_d,
                          child_results, is_product=True)


def _policy_grid(tree):
    """策略对比网格：零配件 Z(2) x 半成品 (Z,D)(4) x 成品 (Z,D)(4) = 32 行。"""
    price = tree["price"]
    rows = []
    for part_z in (0, 1):
        for semi_z in (0, 1):
            for semi_d in (0, 1):
                for prod_z in (0, 1):
                    for prod_d in (0, 1):
                        res = _uniform_policy_cost(tree, part_z, semi_z, semi_d,
                                                   prod_z, prod_d)
                        row = {
                            "part_Z": int(part_z),
                            "semi_Z": int(semi_z),
                            "semi_D": int(semi_d),
                            "product_Z": int(prod_z),
                            "product_D": int(prod_d),
                        }
                        if res is None:
                            row["feasible"] = False
                            row["unit_cost"] = None
                            row["profit"] = None
                        else:
                            row["feasible"] = True
                            row["unit_cost"] = res["U"]
                            row["profit"] = price - res["U"]
                        rows.append(row)

    feasible = [row for row in rows if row["feasible"]]
    best_row = (min(feasible, key=lambda row: row["unit_cost"])
                if feasible else None)

    return {
        "price": price,
        "n_combinations": len(rows),
        "best_uniform": best_row,
        "labels": ["P%d_S%d_%d_PR%d_%d" % (row["part_Z"], row["semi_Z"],
                                           row["semi_D"], row["product_Z"],
                                           row["product_D"])
                   for row in rows],
        "unit_costs": [row["unit_cost"] for row in rows],
        "profits": [row["profit"] for row in rows],
        "rows": rows,
    }


def _topology_summary(tree, spec):
    return {
        "assumption": "ASM-09",
        "note": ("图 1 原件未随阶段简报下传；连接关系取自 "
                 "constants.TABLE2['semi_children']，属常量级假设，"
                 "其影响由 q3_topology_robust 量化。"),
        "n_parts": len(tree["parts"]),
        "n_semis": len(tree["semis"]),
        "n_nodes": len(tree["nodes"]),
        "semi_children": {"S%d" % semi["id"]:
                          list(spec["semi_children"][semi["id"]])
                          for semi in spec["semis"]},
        "product_children": list(tree["nodes"]["F"]["children"]),
        "bottom_up_order": list(tree["order"]),
    }


# --------------------------------------------------------------------------
# 拓扑扰动稳健性（ASM-09 依赖边界）
# --------------------------------------------------------------------------

def _variant_key(groups):
    return tuple(sorted((sid, tuple(ids)) for sid, ids in groups.items()))


def _slice_by_sizes(pool, semi_ids, sizes):
    groups = {}
    cursor = 0
    for sid in semi_ids:
        size = sizes[sid]
        groups[sid] = sorted(pool[cursor:cursor + size])
        cursor += size
    return groups


def _topology_variants(spec, n_variants, seed):
    """与表 2 参数相容的若干连接方案（保持各半成品子件数量不变）。"""
    parts = spec["parts"]
    semi_ids = [semi["id"] for semi in spec["semis"]]
    sizes = {semi["id"]: len(spec["semi_children"][semi["id"]])
             for semi in spec["semis"]}

    base = {sid: list(spec["semi_children"][sid]) for sid in semi_ids}
    variants = [base]
    seen = {_variant_key(base)}

    equal_size = len(set(sizes.values())) == 1
    if not equal_size:
        # 子件数量不等时，仅接受同尺寸划分；排序分块需保持尺寸一致。
        pass

    for key in ("a", "c", "p"):
        ordered = sorted(parts, key=lambda item: (item[key], item["id"]))
        groups = _slice_by_sizes([item["id"] for item in ordered], semi_ids, sizes)
        vkey = _variant_key(groups)
        if vkey not in seen:
            seen.add(vkey)
            variants.append(groups)

    rng = random.Random(seed)
    guard = 0
    while len(variants) < n_variants and guard < 500:
        guard += 1
        pool = [item["id"] for item in parts]
        rng.shuffle(pool)
        groups = _slice_by_sizes(pool, semi_ids, sizes)
        vkey = _variant_key(groups)
        if vkey in seen:
            continue
        seen.add(vkey)
        variants.append(groups)

    return variants


def _topology_robust(base_tree, spec):
    n_variants = int(_const("q3_topology_variants", "拓扑扰动方案数",
                            default=12))
    seed = int(_const("random_seed", "随机种子", default=202409))
    threshold = float(_const("决策一致率判定阈值", "consistency_threshold",
                             default=0.95))

    variants = _topology_variants(spec, n_variants, seed)

    rows = []
    baseline_decisions = None
    for index, groups in enumerate(variants):
        nodes = {nid: dict(node) for nid, node in base_tree["nodes"].items()}
        for sid in base_tree["semis"]:
            semi_id = int(sid[1:])
            nodes[sid]["children"] = ["P%d" % pid for pid in groups[semi_id]]

        tree = dict(base_tree)
        tree["nodes"] = nodes
        tree["order"] = _reverse_topo(nodes, "F")

        cands = {sid: _semi_candidates(tree, sid) for sid in tree["semis"]}
        best = enumerate_optimal(tree, cands)
        decisions = _decision_table(tree, best)
        if baseline_decisions is None:
            baseline_decisions = decisions

        rows.append({
            "index": index,
            "children": {"S%d" % sid: list(groups[sid]) for sid in groups},
            "unit_cost": best["U"],
            "profit": best["profit"],
            "decisions": decisions,
            "matches_baseline": decisions == baseline_decisions,
        })

    n_match = sum(1 for row in rows if row["matches_baseline"])
    rate = n_match / float(len(rows)) if rows else 0.0

    return {
        "n_variants": len(rows),
        "n_match_baseline": n_match,
        "consistency_rate": rate,
        "threshold": threshold,
        "robust": bool(rate >= threshold),
        "note": ("装配树连接关系取自 ASM-09（图 1 原件未下传）。本扫描枚举与"
                 "表 2 参数相容的连接方案并重解全枚举，用于界定结论对拓扑的"
                 "依赖范围；一致率低于阈值时应显式声明结论依赖 ASM-09。"),
        "baseline_children": {"S%d" % sid: list(spec["semi_children"][sid])
                              for sid in spec["semi_children"]},
        "variants": rows,
    }


# --------------------------------------------------------------------------
# V-08 退化核验：问题 3 递推 -> 问题 2 闭式
# --------------------------------------------------------------------------

def _q2_reference_cost(p1, a1, c1, p2, a2, c2, p0, A, c0, t, l,
                       Z1, Z2, C, D):
    """问题 2 的闭式解（EQ-Q2-YIELD / EQ-KF / EQ-KR / EQ-Q2-RECUR / EQ-COST-Q2）。"""
    Q1 = 1.0 - (1 - Z1) * p1
    Q2 = 1.0 - (1 - Z2) * p2
    q = (1.0 - p0) * Q1 * Q2

    K_f = (A
           + Z1 * (a1 + c1) / (1.0 - p1) + (1 - Z1) * a1
           + Z2 * (a2 + c2) / (1.0 - p2) + (1 - Z2) * a2)
    K_r = A + Z1 * c1 + Z2 * c2

    denom = 1.0 - D * (1.0 - q)
    if denom <= EPSILON:
        return None
    g = q / denom
    if g <= EPSILON:
        return None

    R = (K_r + C * c0 + (1.0 - q) * (D * t + (1 - C) * l)) / denom
    U = (K_f + C * c0
         + (1.0 - q) * (D * t + (1 - C) * l + D * R)) / g
    return U


def _degenerate_tree_u(part1, part2, product, Z1, Z2, C, D):
    """把问题 3 的树退化成「两零配件 + 一成品」后的节点级递推结果。"""
    leaf1_node = {"id": "P1", "kind": "part", "p": part1["p"],
                  "a": part1["a"], "c": part1["c"],
                  "A": 0.0, "t": 0.0, "l": 0.0, "children": []}
    leaf2_node = {"id": "P2", "kind": "part", "p": part2["p"],
                  "a": part2["a"], "c": part2["c"],
                  "A": 0.0, "t": 0.0, "l": 0.0, "children": []}
    leaf1 = _eval_part(leaf1_node, Z1)
    leaf2 = _eval_part(leaf2_node, Z2)

    prod_node = {"id": "F", "kind": "product", "p": product["p"],
                 "a": 0.0, "c": product["c"], "A": product["A"],
                 "t": product["t"], "l": product["l"],
                 "children": ["P1", "P2"]}
    child_results = [
        {"U": leaf1["U"], "Q": leaf1["Q"], "Z": leaf1["Z"],
         "c_own": leaf1["c_own"]},
        {"U": leaf2["U"], "Q": leaf2["Q"], "Z": leaf2["Z"],
         "c_own": leaf2["c_own"]},
    ]
    res = _eval_internal(prod_node, C, D, child_results, is_product=True)
    return None if res is None else res["U"]


def degenerate_check(spec=None):
    """V-08：退化实例上节点级递推与问题 2 闭式的逐点比对（双路复算）。"""
    if spec is None:
        spec = _load_table2()

    if len(spec["parts"]) < 2:
        return {"cases": [], "max_abs_diff": None, "tolerance": None,
                "pass": None, "note": "零配件不足两件，跳过退化核验"}

    part1 = spec["parts"][0]
    part2 = spec["parts"][1]
    product = spec["product"]

    tolerance = float(_const("数值容差", "numeric_tolerance", default=1e-6))

    cases = []
    max_abs = 0.0
    n_mismatch = 0
    for Z1 in (0, 1):
        for Z2 in (0, 1):
            for C in (0, 1):
                for D in (0, 1):
                    got = _degenerate_tree_u(part1, part2, product,
                                             Z1, Z2, C, D)
                    ref = _q2_reference_cost(part1["p"], part1["a"], part1["c"],
                                             part2["p"], part2["a"], part2["c"],
                                             product["p"], product["A"],
                                             product["c"], product["t"],
                                             product["l"], Z1, Z2, C, D)
                    if got is None or ref is None:
                        diff = None
                        match = (got is None and ref is None)
                    else:
                        diff = abs(got - ref)
                        match = diff <= tolerance
                        max_abs = max(max_abs, diff)
                    if not match:
                        n_mismatch += 1
                    cases.append({
                        "Z1": Z1, "Z2": Z2, "C": C, "D": D,
                        "q3_degenerate_unit_cost": got,
                        "q2_reference_unit_cost": ref,
                        "abs_diff": diff,
                        "match": bool(match),
                    })

    return {
        "cases": cases,
        "n_cases": len(cases),
        "n_mismatch": n_mismatch,
        "max_abs_diff": max_abs,
        "tolerance": tolerance,
        "pass": bool(n_mismatch == 0),
        "note": ("退化实例使用表 2 的前两个零配件与成品参数；两路均为本模块"
                 "独立实现（节点级递推 vs 问题 2 闭式），用于覆盖符号一致性、"
                 "递推方向与计价不重复三个失效模式。"),
    }


# --------------------------------------------------------------------------
# 主入口
# --------------------------------------------------------------------------

def solve_q3(spec=None, table2=None, with_robust=True, with_grid=True,
             with_degenerate=True):
    """求解问题 3 实例，返回可直接 JSON 序列化的结果字典。"""
    if spec is None:
        spec = _load_table2(table2)

    tree = build_tree(spec)
    semi_candidates = {sid: _semi_candidates(tree, sid) for sid in tree["semis"]}
    best = enumerate_optimal(tree, semi_candidates)

    result = {
        "stage": "03-code",
        "problem": "q3",
        "q3_price": tree["price"],
        "q3_exchange_loss": tree["exchange_loss"],
        "q3_unit_cost": best["U"],
        "q3_profit": best["profit"],
        "q3_n_evaluated": best["n_evaluated"],
        "q3_decision_table": _decision_table(tree, best),
        "q3_node_cost": _node_records(tree, best),
        "q3_cost_breakdown": _cost_breakdown(tree, best),
        "q3_topology": _topology_summary(tree, spec),
        "q3_meta": {
            "output_file": OUTPUT_FILE,
            "epsilon": EPSILON,
            "n_evaluated": best["n_evaluated"],
            "direction": ("成本与合格率自底向上聚合；交付需求量自顶向下折算"
                          "（单件口径 ASM-04 下需求量恒为 1）"),
            "equations": ["EQ-Q3-ASSY", "EQ-Q3-NODE", "EQ-Q3-COST",
                          "EQ-Q3-KF", "EQ-Q3-KAPPA", "EQ-Q3-XI",
                          "EQ-Q3-RECUR", "EQ-Q3-UNITCOST", "EQ-Q3-PROFIT"],
            "topology_source": "constants.TABLE2['semi_children']（ASM-09 常量级假设）",
            "units": "金额列元/件，比率列无量纲",
        },
    }

    if with_grid:
        result["q3_strategy_compare"] = _policy_grid(tree)
    if with_robust:
        result["q3_topology_robust"] = _topology_robust(tree, spec)
    if with_degenerate:
        result["q3_degenerate_check"] = degenerate_check(spec)

    return result


def solve_q3_with_rates(part_rates=None, semi_rates=None, product_rate=None,
                        semi_children=None, spec=None, with_robust=False,
                        with_grid=False, with_degenerate=False):
    """在给定时变次品率下重解问题 3（供问题 4 的重抽样 / 区间传播调用）。

    part_rates: {零配件 id: 次品率}，缺省取表 2 原值
    semi_rates: {半成品 id: 次品率}
    product_rate: 成品次品率
    semi_children: 可选的拓扑覆盖（{半成品 id: [零配件 id, ...]}）
    """
    base = _load_table2(spec) if spec is None else spec

    if part_rates:
        for part in base["parts"]:
            if part["id"] in part_rates:
                part["p"] = float(part_rates[part["id"]])
    if semi_rates:
        for semi in base["semis"]:
            if semi["id"] in semi_rates:
                semi["p"] = float(semi_rates[semi["id"]])
    if product_rate is not None:
        base["product"]["p"] = float(product_rate)
    if semi_children is not None:
        base["semi_children"] = {int(k): [int(x) for x in v]
                                 for k, v in semi_children.items()}

    return solve_q3(spec=base, with_robust=with_robust, with_grid=with_grid,
                    with_degenerate=with_degenerate)


def write_results(result, path=None):
    path = path or OUTPUT_FILE
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2,
                  sort_keys=False)
    return path


def main():
    result = solve_q3()
    path = write_results(result)
    print("[q3] wrote %s | profit=%.4f | unit_cost=%.4f | n_evaluated=%d"
          % (path, result["q3_profit"], result["q3_unit_cost"],
             result["q3_n_evaluated"]))
    return result


# 供 main.py / problem4.py 使用的稳定别名
solve = solve_q3
run = main
solve_instance = solve_q3
evaluate_tree = _eval_internal


if __name__ == "__main__":
    main()
```