from __future__ import annotations

import itertools
import json
import math
import warnings
from collections import deque
from collections.abc import Mapping
from dataclasses import asdict, dataclass, replace
from numbers import Number
from pathlib import Path

import networkx as nx
import numpy as np
from scipy.sparse import coo_matrix, eye
from scipy.sparse.linalg import MatrixRankWarning, spsolve

import params

_MISSING = object()
_COMPONENTS = ("purchase", "inspection", "assembly", "disassembly", "market_revenue", "exchange_loss")
_INSPECT_ALIASES = ("inspection_cost", "test_cost", "inspect_cost", "t", "检测成本")
_PRICE_ALIASES = ("purchase_price", "price", "unit_price", "a", "购买单价")
_DEFECT_ALIASES = ("defect_rate", "defect", "p", "rate", "次品率")
_ASSEMBLY_ALIASES = ("assembly_cost", "assembly", "k", "装配成本")
_DISASSEMBLY_ALIASES = ("disassembly_cost", "disassemble_cost", "g", "拆解费用")


def _pick(module, names, default=_MISSING):
    for name in names:
        if hasattr(module, name):
            value = getattr(module, name)
            if value is not None:
                return value
    if default is not _MISSING:
        return default
    raise AttributeError(f"params 中缺少常量：{', '.join(names)}")


def _field(row, names, default=_MISSING):
    for name in names:
        if isinstance(row, Mapping) and name in row:
            return row[name]
        if hasattr(row, name):
            return getattr(row, name)
    if default is not _MISSING:
        return default
    raise AttributeError(f"参数记录中缺少字段：{', '.join(names)}")


def _rows(value):
    if value is None:
        return ()
    if isinstance(value, Mapping):
        values = tuple(value.values())
        return values if all(not isinstance(v, (str, bytes)) for v in values) else ()
    if isinstance(value, (str, bytes)):
        return ()
    try:
        return tuple(value)
    except TypeError:
        return (value,)


@dataclass(frozen=True)
class NodeSpec:
    node_id: str
    parents: tuple[str, ...]
    defect_rate: float
    assembly_cost: float
    inspection_cost: float
    disassembly_cost: float
    purchase_price: float
    role: str


def _node_id(raw):
    text = str(raw).strip()
    if isinstance(raw, Number):
        return f"part_{int(raw)}"
    replacements = (("零配件", "part_"), ("半成品", "semi_"), ("成品", "product"))
    for old, new in replacements:
        if text.startswith(old):
            text = text.replace(old, new, 1)
    if text.lower().startswith("p") and text[1:].isdigit():
        text = f"part_{text[1:]}"
    if text.lower().startswith("s") and text[1:].isdigit():
        text = f"semi_{text[1:]}"
    if text.lower() in {"f", "final", "root"}:
        text = "product"
    return text


def _normalise_edges(edge_list):
    normalised = []
    if isinstance(edge_list, Mapping):
        for parent, children in edge_list.items():
            child_list = [children] if isinstance(children, (str, bytes, Number)) else children
            for child in child_list:
                normalised.append((_node_id(parent), _node_id(child)))
    else:
        for edge in edge_list:
            if isinstance(edge, Mapping):
                parent = _field(edge, ("parent", "from", "source", "父节点"))
                children = _field(edge, ("children", "child", "to", "子节点"))
                child_list = [children] if isinstance(children, (str, bytes, Number)) else children
                for child in child_list:
                    normalised.append((_node_id(parent), _node_id(child)))
            else:
                parent, child = edge
                normalised.append((_node_id(parent), _node_id(child)))
    return tuple(dict.fromkeys(normalised))


def _nodes_from_params(module, edge_list):
    parts = _rows(_pick(module, ("Q3_PARTS", "Q3_PART_SPECS", "Q3_PART_ROWS", "TABLE2_PARTS", "Q3_TABLE2_PARTS")))
    semis = _rows(_pick(module, ("Q3_SEMIS", "Q3_SEMI_SPECS", "Q3_SEMI_ROWS", "TABLE2_SEMIS")))
    product = _pick(module, ("Q3_PRODUCT", "Q3_PRODUCT_ROW", "Q3_ROOT"), None)
    specs = {}
    for index, row in enumerate(parts, 1):
        specs[f"part_{index}"] = NodeSpec(f"part_{index}", (), float(_field(row, _DEFECT_ALIASES)), 0.0,
            float(_field(row, _INSPECT_ALIASES)), 0.0, float(_field(row, _PRICE_ALIASES)), "part")
    for index, row in enumerate(semis, 1):
        node_id = f"semi_{index}"
        specs[node_id] = NodeSpec(node_id, (), float(_field(row, _DEFECT_ALIASES)),
            float(_field(row, _ASSEMBLY_ALIASES)), float(_field(row, _INSPECT_ALIASES)),
            float(_field(row, _DISASSEMBLY_ALIASES)), 0.0, "assembly")
    if product is None:
        product = {"defect_rate": _pick(module, ("Q3_PRODUCT_DEFECT_RATE", "Q3_ROOT_DEFECT_RATE")),
                   "assembly_cost": _pick(module, ("Q3_PRODUCT_ASSEMBLY_COST",)),
                   "inspection_cost": _pick(module, ("Q3_PRODUCT_INSPECTION_COST",)),
                   "disassembly_cost": _pick(module, ("Q3_PRODUCT_DISASSEMBLY_COST",))}
    specs["product"] = NodeSpec("product", (), float(_field(product, _DEFECT_ALIASES)),
        float(_field(product, _ASSEMBLY_ALIASES)), float(_field(product, _INSPECT_ALIASES)),
        float(_field(product, _DISASSEMBLY_ALIASES)), 0.0, "root")
    for parent, child in _normalise_edges(edge_list):
        if parent not in specs or child not in specs:
            raise ValueError(f"拓扑边引用未登记节点：{parent}->{child}")
        old = specs[child]
        specs[child] = replace(old, parents=tuple(dict.fromkeys(old.parents + (parent,))))
    return specs


def build_network(edge_list=None, node_data=None, module=params):
    edges = _normalise_edges(edge_list) if edge_list is not None else ()
    specs = dict(node_data) if node_data is not None else _nodes_from_params(module, edge_list)
    for parent, child in edges:
        if parent not in specs or child not in specs:
            raise ValueError(f"拓扑边引用未登记节点：{parent}->{child}")
        old = specs[child]
        specs[child] = replace(old, parents=tuple(dict.fromkeys(old.parents + (parent,))))
    graph = nx.DiGraph()
    for node_id, spec in specs.items():
        graph.add_node(node_id, **asdict(spec))
    graph.add_edges_from(edges)
    if "product" not in graph or not nx.is_directed_acyclic_graph(graph):
        raise ValueError("装配网络必须是以 product 为根节点的有限 DAG")
    if any(not nx.has_path(graph, node, "product") for node in graph):
        raise ValueError("存在无法到达根节点的孤立节点")
    if any(float(graph.nodes[node]["defect_rate"]) < 0.0 or float(graph.nodes[node]["defect_rate"]) > 1.0 for node in graph):
        raise ValueError("次品率必须位于概率域")
    layers = {node: nx.longest_path_length(graph, node) for node in graph}
    nx.set_node_attributes(graph, layers, "layer")
    return graph


def topology_perturbation(module=params):
    scenarios = _pick(module, ("Q3_SCENARIO_TOPOLOGIES", "Q3_SCENARIO_EDGES"), {})
    primary = _pick(module, ("Q3_PRIMARY_TOPOLOGY", "Q3_PRIMARY_EDGE_LIST", "Q3_PRIMARY_SCENARIO_TOPOLOGY", "Q3_PRIMARY_SCENARIO_EDGES", "Q3_MAIN_TOPOLOGY"), scenarios.get("primary"))
    alternative = _pick(module, ("Q3_ALTERNATIVE_TOPOLOGY", "Q3_ALTERNATIVE_EDGE_LIST", "Q3_ALTERNATIVE_SCENARIO_TOPOLOGY", "Q3_ALTERNATIVE_SCENARIO_EDGES"), scenarios.get("alternative"))
    if primary is None or alternative is None:
        raise AttributeError("params 中缺少问题三主、替代情景边表")
    return build_network(primary, module=module), build_network(alternative, module=module)


def _policy(graph, bits):
    inspect_keys = tuple(sorted(graph.nodes))
    recycle_keys = tuple(sorted(node for node in graph if graph.in_degree(node)))
    keys = inspect_keys + recycle_keys
    if len(bits) != len(keys):
        raise ValueError("策略位数与节点决策空间不一致")
    inspection = dict(zip(inspect_keys, bits[:len(inspect_keys)]))
    disassembly = {node: False for node in graph}
    disassembly.update(zip(recycle_keys, bits[len(inspect_keys):]))
    return inspection, disassembly


def _policy_dict(graph, inspection, disassembly):
    return {"node_inspection": dict(inspection), "node_disassembly": {node: disassembly[node] for node in sorted(graph) if graph.in_degree(node)}}


def output_rate(graph, node):
    spec = graph.nodes[node]
    rate = 1.0 - float(spec["defect_rate"])
    for parent in spec["parents"]:
        rate *= 1.0 - float(graph.nodes[parent]["defect_rate"])
    return rate


def launch_cost_rate(graph, node, inspection):
    spec = graph.nodes[node]
    return (float(spec["purchase_price"]) if not spec["parents"] else 0.0) + float(spec["assembly_cost"]) + (float(spec["inspection_cost"]) if inspection[node] else 0.0)


def U_equals_C_over_Q(graph, node, inspection):
    rate = output_rate(graph, node)
    return math.inf if rate == 0.0 else launch_cost_rate(graph, node, inspection) / rate


def _event(purchase=0.0, inspection=0.0, assembly=0.0, disassembly=0.0, market_revenue=0.0, exchange_loss=0.0):
    return dict(zip(_COMPONENTS, (purchase, inspection, assembly, disassembly, market_revenue, exchange_loss)))


def _net(event):
    return event["market_revenue"] - sum(event[name] for name in _COMPONENTS[:4] + ("exchange_loss",))


def _next_state(graph, state, inspection, disassembly):
    inventory, stack = state
    inventory = list(inventory)
    node = stack[-1]
    node_index = tuple(sorted(graph.nodes)).index(node)
    if inventory[node_index] != 0:
        return (tuple(inventory), stack[:-1]), 1.0, _event()
    parents = graph.nodes[node]["parents"]
    missing = [parent for parent in parents if inventory[tuple(sorted(graph.nodes)).index(parent)] == 0]
    if missing:
        return (tuple(inventory), stack + tuple(reversed(missing))), 1.0, _event()
    parent_states = [inventory[tuple(sorted(graph.nodes)).index(parent)] for parent in parents]
    good_probability = output_rate(graph, node) if all(value == 1 for value in parent_states) else 0.0
    spec = graph.nodes[node]
    inspect = inspection[node]
    base = _event(float(spec["purchase_price"]) if not parents else 0.0, float(spec["inspection_cost"]) if inspect else 0.0,
                  float(spec["assembly_cost"]) if parents else 0.0)
    root = spec["role"] == "root"
    if not inspect:
        outcomes = []
        if good_probability > 0.0:
            inventory[node_index] = 1
            event = dict(base, market_revenue=float(spec.get("market_price", graph.graph.get("market_price", 0.0))) if root else 0.0)
            outcomes.append(((tuple(inventory), stack[:-1]), good_probability, event))
        if good_probability < 1.0:
            if root:
                recovered = list(inventory)
                for parent, status in zip(parents, parent_states):
                    if status != 0:
                        recovered[tuple(sorted(graph.nodes)).index(parent)] = status
                if disassembly[node]:
                    event = dict(base, market_revenue=float(graph.graph["market_price"]), exchange_loss=float(graph.graph["exchange_loss"]), disassembly=float(spec["disassembly_cost"]))
                else:
                    event = dict(base, market_revenue=float(graph.graph["market_price"]), exchange_loss=float(graph.graph["exchange_loss"]))
                outcomes.append(((tuple(recovered), (node,)), 1.0 - good_probability, event))
            else:
                inventory[node_index] = -1
                outcomes.append(((tuple(inventory), stack[:-1]), 1.0 - good_probability, dict(base)))
        return outcomes[0] if len(outcomes) == 1 else outcomes
    if good_probability > 0.0:
        inventory[node_index] = 1
        event = dict(base, market_revenue=float(graph.graph["market_price"]) if root else 0.0)
        return (tuple(inventory), stack[:-1]), good_probability, event
    recovered = list(inventory)
    recycle = disassembly[node]
    if recycle:
        event = dict(base, disassembly=float(spec["disassembly_cost"]))
        for parent, status in zip(parents, parent_states):
            if status != 0:
                recovered[tuple(sorted(graph.nodes)).index(parent)] = status
    else:
        event = dict(base)
    next_stack = (node,) if root else (stack if recycle else stack[:-1])
    return (tuple(recovered), next_stack), 1.0, event


def reachable_state_enumeration(graph, inspection, disassembly, module=params):
    root = "product"
    initial = (tuple(0 for _ in graph), (root,))
    states, indices, transitions, queue = [initial], {initial: 0}, [], deque([initial])
    limit = _pick(module, ("Q3_REACHABLE_STATE_LIMIT", "Q3_STATE_LIMIT"), None)
    while queue:
        state = queue.popleft()
        if not state[1]:
            transitions.append(())
            continue
        raw = _next_state(graph, state, inspection, disassembly)
        rows = raw if isinstance(raw, list) else [raw]
        row = []
        for next_state, probability, event in rows:
            if next_state not in indices:
                indices[next_state] = len(states)
                states.append(next_state)
                queue.append(next_state)
            row.append((indices[next_state], probability, event))
        transitions.append(tuple(row))
        if limit is not None and len(states) > int(limit):
            raise RuntimeError("可达状态数超过登记上限")
    return states, indices, transitions


def event_markov_reward(graph, policy, detail=False, module=params):
    inspection, disassembly = policy
    states, indices, transitions = reachable_state_enumeration(graph, inspection, disassembly, module)
    transient = [index for index, state in enumerate(states) if state[1]]
    terminal = [index for index, state in enumerate(states) if not state[1]][0]
    rows, cols, values, rhs = [], [], [], np.zeros(len(transient))
    component_matrix = np.zeros((len(transient), len(_COMPONENTS))) if detail else None
    terminal_components = np.zeros(len(_COMPONENTS)) if detail else None
    for state_index in transient:
        local_row = transient.index(state_index)
        for next_index, probability, event in transitions[state_index]:
            rhs[local_row] += probability * _net(event)
            if detail:
                terminal_components += probability * np.asarray([event[name] for name in _COMPONENTS]) if next_index == terminal else 0.0
            if next_index != terminal:
                rows.append(local_row); cols.append(transient.index(next_index)); values.append(probability)
                if detail:
                    component_matrix[local_row] += probability * np.asarray([event[name] for name in _COMPONENTS])
    transition_matrix = coo_matrix((values, (rows, cols)), shape=(len(transient), len(transient))).tocsr()
    system = eye(len(transient), format="csc") - transition_matrix
    tolerance = float(_pick(module, ("VALUE_ITERATION_TOL", "Q1_NUMERIC_TOL")))
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", MatrixRankWarning)
            value = spsolve(system, rhs)
    except MatrixRankWarning:
        return {"profit": -math.inf, "absorbing": False, "state_count": len(states)}
    residual = float(np.max(np.abs(system @ value - rhs)))
    vector = np.ones(len(transient))
    max_iterations = int(_pick(module, ("VALUE_ITERATION_MAX_ITERATIONS",)))
    for _ in range(max_iterations):
        updated = vector @ transition_matrix
        total = float(updated.sum())
        if total <= tolerance:
            break
        updated /= total
        if float(np.max(np.abs(updated - vector))) <= tolerance:
            vector = updated
            break
        vector = updated
    spectral_radius = float(np.clip((vector @ transition_matrix).sum(), 0.0, 1.0))
    result = {"profit": float(value[transient.index(0)]), "bellman_residual": residual, "absorbing": spectral_radius < 1.0 - tolerance,
              "absorption_probability": 1.0 - spectral_radius, "state_count": len(states), "transient_state_count": len(transient)}
    if detail:
        expected = spsolve(system, component_matrix)
        expected = np.asarray(expected)[transient.index(0)] + terminal_components
        ledger_profit = expected[_COMPONENTS.index("market_revenue")] - sum(expected[index] for index in range(len(_COMPONENTS)) if index != _COMPONENTS.index("market_revenue"))
        result["expected_event_cash"] = dict(zip(_COMPONENTS, map(float, expected)))
        result["event_ledger_profit"] = float(ledger_profit)
        result["event_ledger_gap"] = abs(result["profit"] - result["event_ledger_profit"])
    return result


def optimize_network(graph, full_records=True, module=params):
    inspect_keys = tuple(sorted(graph.nodes)); recycle_keys = tuple(sorted(node for node in graph if graph.in_degree(node)))
    key_count = len(inspect_keys) + len(recycle_keys)
    registered = _pick(module, ("Q3_PRIMARY_POLICY_COUNT", "Q3有效策略数"), None)
    if registered is not None and int(registered) != (1 << key_count):
        raise ValueError("代码生成的有效策略数与登记常数不一致")
    best = None; best_bits = None; records = []; evaluated = 0
    for bits in itertools.product((False, True), repeat=key_count):
        policy = _policy(graph, bits); evaluation = event_markov_reward(graph, policy, False, module); evaluated += 1
        records.append({"bits": list(bits), "profit": evaluation["profit"], "state_count": evaluation["state_count"]})
        if best is None or evaluation["profit"] > best["profit"] + float(_pick(module, ("CASHFLOW_ABS_TOL", "cashflow_abs_tol"))) or (abs(evaluation["profit"] - best["profit"]) <= float(_pick(module, ("CASHFLOW_ABS_TOL", "cashflow_abs_tol"))) and bits < best_bits):
            best, best_bits = evaluation, bits
    if best is None or not best["absorbing"]:
        raise RuntimeError("没有找到吸收策略")
    policy = _policy(graph, best_bits)
    detailed = event_markov_reward(graph, policy, True, module)
    node_metrics = {node: {"Q_v": output_rate(graph, node), "C_v": launch_cost_rate(graph, node, policy[0]), "U_v": U_equals_C_over_Q(graph, node, policy[0])} for node in sorted(graph)}
    result = {"data_status": "scenario_only", "policy_space_count": evaluated, "selected_policy": _policy_dict(graph, *policy), "profit": detailed["profit"],
              "state_count": detailed["state_count"], "bellman_residual": detailed["bellman_residual"], "absorbing": detailed["absorbing"],
              "absorption_probability": detailed["absorption_probability"], "event_ledger_gap": detailed["event_ledger_gap"], "node_metrics": node_metrics,
              "edge_count": graph.number_of_edges(), "layer_count": max(graph.nodes[node]["layer"] for node in graph) + 1}
    if full_records:
        result["policy_profit_records"] = records
    return result


def solve(config=None, edge_list=None, defect_rates=None, full_records=True):
    module = config if hasattr(config, "__dict__") else params
    graph = build_network(edge_list, module=module)
    if defect_rates:
        for node, rate in defect_rates.items():
            graph.nodes[node]["defect_rate"] = float(rate)
    graph.graph["market_price"] = float(_pick(module, ("Q3_MARKET_PRICE", "Q3_SALE_PRICE")))
    graph.graph["exchange_loss"] = float(_pick(module, ("Q3_EXCHANGE_LOSS",)))
    return optimize_network(graph, full_records, module)


def _number(value):
    if isinstance(value, Number) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, Mapping):
        for key in ("profit", "value", "expected_profit", "unit_profit"):
            if key in value:
                return _number(value[key])
    if isinstance(value, (tuple, list)):
        for item in value:
            answer = _number(item)
            if answer is not None:
                return answer
    for key in ("profit", "value", "expected_profit"):
        if hasattr(value, key):
            return _number(getattr(value, key))
    return None


def _q2_reference(case, graph, policies, module=params):
    import problem2
    function = getattr(problem2, "evaluate_policy", None)
    builder = getattr(problem2, "_q2_build_mrp", None)
    value_function = getattr(problem2, "_q2_mrp_value", None)
    values = {}
    for bits, policy_tuple in policies:
        result = None
        if function is not None:
            for args in ((case, policy_tuple), (policy_tuple, case)):
                try:
                    result = _number(function(*args)); break
                except (TypeError, ValueError):
                    pass
        if result is None and builder is not None and value_function is not None:
            try:
                mrp = builder(case, policy_tuple); result = _number(value_function(*mrp))
            except (TypeError, ValueError):
                try:
                    mrp = builder(case, policy_tuple); result = _number(value_function(mrp))
                except (TypeError, ValueError):
                    result = None
        if result is not None:
            values[bits] = result
    return values


def q2_degenerate_16_policy_equivalence(module=params):
    cases = _pick(module, ("Q2_CASES", "Q2_TABLE1_CASES")); case = cases[0]
    p1 = float(_field(case, ("defect1", "p1", "part1_defect_rate", "次品率1"))); p2 = float(_field(case, ("defect2", "p2", "part2_defect_rate", "次品率2")))
    pf = float(_field(case, ("defect_f", "pf", "product_defect_rate", "成品次品率")))
    graph = build_network((("part_1", "product"), ("part_2", "product")), {
        "part_1": NodeSpec("part_1", (), p1, 0.0, float(_field(case, ("test1", "t1"))), 0.0, float(_field(case, ("price1", "a1"))), "part"),
        "part_2": NodeSpec("part_2", (), p2, 0.0, float(_field(case, ("test2", "t2"))), 0.0, float(_field(case, ("price2", "a2"))), "part"),
        "product": NodeSpec("product", ("part_1", "part_2"), pf, float(_field(case, ("assembly", "kf"))), float(_field(case, ("final_test", "tf"))), float(_field(case, ("disassembly", "g_dis"))), 0.0, "root")}, module)
    graph.graph["market_price"] = float(_field(case, ("sale", "market_price", "r_market"))); graph.graph["exchange_loss"] = float(_field(case, ("exchange_loss", "L_exchange")))
    policies = []; q3_values = {}
    for bits in itertools.product((False, True), repeat=4):
        inspection, disassembly = _policy(graph, bits); q3 = event_markov_reward(graph, (inspection, disassembly), False, module)
        q3_values[bits] = q3["profit"]; policies.append((bits, (inspection["part_1"], inspection["part_2"], inspection["product"], disassembly["product"])))
    references = _q2_reference(case, graph, policies, module); gaps = [abs(q3_values[bits] - references[bits]) for bits in references]
    tolerance = float(_pick(module, ("CASHFLOW_ABS_TOL", "cashflow_abs_tol")))
    if len(references) != len(q3_values):
        return {"status": "blocked_reference_api_mismatch", "policy_count": len(q3_values), "max_error": None}
    max_error = max(gaps)
    if max_error > tolerance:
        raise ValueError("问题二与问题三退化策略超出现金流容差")
    return {"status": "passed", "policy_count": len(q3_values), "max_error": max_error, "cashflow_abs_tol": tolerance}


def run(config=None, output_path="problem3_results.json"):
    module = config if hasattr(config, "__dict__") else params
    primary, alternative = topology_perturbation(module)
    for graph in (primary, alternative):
        graph.graph["market_price"] = float(_pick(module, ("Q3_MARKET_PRICE", "Q3_SALE_PRICE")))
        graph.graph["exchange_loss"] = float(_pick(module, ("Q3_EXCHANGE_LOSS",)))
    primary_result = optimize_network(primary, True, module); alternative_result = optimize_network(alternative, True, module)
    official_edges = _pick(module, ("Q3_OFFICIAL_EDGE_LIST",), None)
    verified = bool(_pick(module, ("Q3_OFFICIAL_EDGE_LIST_VERIFIED", "Q3_TOPOLOGY_VERIFIED"), False))
    official_result = None
    if official_edges is not None and verified:
        official_graph = build_network(official_edges, module=module)
        official_graph.graph["market_price"] = primary.graph["market_price"]; official_graph.graph["exchange_loss"] = primary.graph["exchange_loss"]
        official_result = optimize_network(official_graph, False, module)
    degenerate = q2_degenerate_16_policy_equivalence(module)
    payload = {"official_topology_status": "verified" if official_result is not None else "missing_scenario_only", "official_result": official_result,
               "primary_scenario": primary_result, "alternative_scenario": alternative_result,
               "topology_profit_gap": abs(primary_result["profit"] - alternative_result["profit"]), "degenerate_validation": degenerate}
    if output_path is not None:
        Path(output_path).write_text(json.dumps({"problem3": payload}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"problem3": payload}


if __name__ == "__main__":
    run()