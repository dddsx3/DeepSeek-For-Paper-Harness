# -*- coding: utf-8 -*-
"""问题三：事件现金流装配网络的精确策略枚举、退化等价核验与状态核验。"""
from collections import deque
import math

import networkx
import numpy as np

import params
from params import *


def _build_graph(topology, node_data, defect_rates=None):
    rates = (
        {node: float(data["defect_rate"]) for node, data in node_data.items()}
        if defect_rates is None else
        {node: float(data["defect_rate"]) for node, data in node_data.items()}
        if hasattr(defect_rates, "items") else
        dict(zip(params.Q3_PARAMETER_NODE_IDS, map(float, defect_rates)))
    )
    graph = networkx.DiGraph()
    for node, source in node_data.items():
        data = dict(source)
        data["kind"] = "leaf"
        data["defect_rate"] = rates[node]
        graph.add_node(node, **data)
    for child, parents in topology.items():
        graph.nodes[child]["kind"] = "assembly"
        for parent in parents:
            graph.add_edge(parent, child)
    if not networkx.is_directed_acyclic_graph(graph):
        raise ValueError("装配网络必须是有向无环图")
    if any(rate < Q2_PROBABILITY_FLOOR or rate > Q2_PROBABILITY_CEILING for rate in rates.values()):
        raise ValueError("次品率必须位于单位区间")
    return graph


def _policy_map(graph, policy, order=None):
    order = tuple(order or networkx.topological_sort(graph))
    inspection = tuple(node for node in order if "inspection_cost" in graph.nodes[node])
    disposition = tuple(
        node for node in order if graph.nodes[node]["kind"] == "assembly"
    )
    names = tuple(f"inspect:{node}" for node in inspection) + tuple(
        f"disassemble:{node}" for node in disposition
    )
    if isinstance(policy, dict):
        return {
            "inspect": {node: bool(policy.get(f"inspect:{node}", False)) for node in inspection},
            "disassemble": {node: bool(policy.get(f"disassemble:{node}", False)) for node in disposition},
        }
    if len(policy) != len(names):
        raise ValueError("策略向量长度与网络决策变量数不一致")
    return {
        "inspect": dict(zip(inspection, map(bool, policy[:len(inspection)]))),
        "disassemble": dict(zip(disposition, map(bool, policy[len(inspection):]))),
    }


def output_rate(record):
    return float(record["output_rate_Q"])


def launch_cost_rate(record):
    return float(record["launch_cost_rate_C"])


def U_equals_C_over_Q(record):
    rate = output_rate(record)
    return launch_cost_rate(record) / rate if rate > Q2_PROBABILITY_FLOOR else math.inf


def _evaluate_network(graph, vector, order=None):
    order = tuple(order or networkx.topological_sort(graph))
    policy = _policy_map(graph, vector, order)
    records = {}
    finite = True
    root = next(
        (node for node, data in graph.nodes(data=True) if "market_price" in data),
        None,
    )
    for node in order:
        data = graph.nodes[node]
        rate = float(data["defect_rate"])
        inspect = policy["inspect"][node]
        if data["kind"] == "leaf":
            q = Q2_PROBABILITY_CEILING - rate
            launch = float(data["purchase_price"]) + (float(data["inspection_cost"]) if inspect else Q2_COST_FLOOR)
            demand = launch / q if inspect and q > Q2_PROBABILITY_FLOOR else (launch if not inspect else math.inf)
            accepted = Q2_PROBABILITY_CEILING if inspect else q
            local_finite = math.isfinite(demand)
            parent_cash = Q2_COST_FLOOR
        else:
            parents = tuple(graph.predecessors(node))
            parent_cash = sum(records[parent]["demand_cash_cost"] for parent in parents)
            input_good = math.prod(records[parent]["yield_probability"] for parent in parents)
            q = input_good * (Q2_PROBABILITY_CEILING - rate)
            assembly = float(data["assembly_cost"])
            inspection = float(data["inspection_cost"])
            disassembly = float(data["disassembly_cost"])
            local_finite = all(records[parent]["finite"] for parent in parents)
            if inspect:
                hazard = q <= Q2_PROBABILITY_FLOOR or any(
                    records[parent]["yield_probability"] < Q2_PROBABILITY_CEILING
                    for parent in parents
                )
                local_finite = local_finite and not hazard
                if policy["disassemble"][node] and not hazard:
                    launch = q * parent_cash + assembly + inspection + (Q2_PROBABILITY_CEILING - q) * disassembly
                else:
                    launch = parent_cash + assembly + inspection
                demand = launch / q if q > Q2_PROBABILITY_FLOOR else math.inf
                accepted = Q2_PROBABILITY_CEILING
            else:
                launch = parent_cash + assembly
                demand = launch
                accepted = q
            local_finite = local_finite and math.isfinite(demand)
        if node == root:
            hazard = q <= Q2_PROBABILITY_FLOOR or any(
                records[parent]["yield_probability"] < Q2_PROBABILITY_CEILING
                for parent in tuple(graph.predecessors(node))
            )
            local_finite = local_finite and not hazard
            loss = float(data["exchange_loss"])
            if policy["disassemble"][node] and not hazard:
                launch = q * parent_cash + assembly + (inspection if inspect else Q2_COST_FLOOR)
                launch += (Q2_PROBABILITY_CEILING - q) * (
                    disassembly + (Q2_COST_FLOOR if inspect else loss)
                )
            elif inspect:
                launch = parent_cash + assembly + inspection
            else:
                launch = parent_cash + assembly + (Q2_PROBABILITY_CEILING - q) * loss
            demand = launch / q if q > Q2_PROBABILITY_FLOOR else math.inf
            accepted = Q2_PROBABILITY_CEILING
            local_finite = local_finite and math.isfinite(demand)
        records[node] = {
            "yield_probability": accepted,
            "output_rate_Q": q,
            "launch_cost_rate_C": launch,
            "unit_good_cost_U": launch / q if q > Q2_PROBABILITY_FLOOR else math.inf,
            "demand_cash_cost": demand,
            "parent_launch_cash": parent_cash if data["kind"] == "assembly" else Q2_COST_FLOOR,
            "finite": local_finite,
        }
        finite = finite and local_finite
    root_record = records[root]
    profit = float(data["market_price"]) - root_record["unit_good_cost_U"] if finite else -math.inf
    return {"profit": profit, "finite": finite, "nodes": records}


def topology_perturbation():
    return {
        "primary_edges": [list(edge) for edge in params.Q3_PRIMARY_EDGES],
        "alternative_edges": [list(edge) for edge in params.Q3_ALTERNATIVE_EDGES],
        "edge_changed": params.Q3_PRIMARY_EDGES != params.Q3_ALTERNATIVE_EDGES,
        "purpose": "missing_figure_1_topology_robustness_check",
    }


def solve_network(topology, defect_rates=None, include_strategy_table=True):
    graph = _build_graph(topology, params.Q3_NODE_DATA, defect_rates)
    order = tuple(networkx.topological_sort(graph))
    table = []
    best = None
    for index, vector in enumerate(params.Q3_POLICY_SPACE):
        result = _evaluate_network(graph, vector, order)
        valid = bool(result["finite"])
        profit = float(result["profit"]) if valid else None
        table.append({
            "policy_index": index,
            "policy": list(vector),
            "valid": valid,
            "profit": profit,
            "expected_cost": float(params.Q3_PRODUCT_DATA["market_price"] - result["profit"]) if valid else None,
        })
        if valid and (
            best is None
            or result["profit"] > best["profit"] + CASHFLOW_ABS_TOL
            or (abs(result["profit"] - best["profit"]) <= CASHFLOW_ABS_TOL and vector < best["vector"])
        ):
            best = {"index": index, "vector": tuple(vector), "profit": float(result["profit"]), "result": result}
    if best is None:
        raise RuntimeError("问题三没有有限期望利润策略")
    selected_nodes = []
    for node in order:
        record = best["result"]["nodes"][node]
        selected_nodes.append({
            "node": node,
            "kind": graph.nodes[node]["kind"],
            "inspection": _policy_map(graph, best["vector"], order)["inspect"][node],
            "disassembly": (
                _policy_map(graph, best["vector"], order)["disassemble"][node]
                if graph.nodes[node]["kind"] == "assembly" else None
            ),
            "defect_rate": graph.nodes[node]["defect_rate"],
            "yield_probability": record["yield_probability"],
            "output_rate_Q": record["output_rate_Q"],
            "launch_cost_rate_C": record["launch_cost_rate_C"],
            "unit_good_cost_U": record["unit_good_cost_U"],
            "demand_cash_cost": record["demand_cash_cost"],
            "parent_launch_cash": record["parent_launch_cash"],
        })
    policy = _policy_map(graph, best["vector"], order)
    identity_error = max(abs(node["unit_good_cost_U"] - U_equals_C_over_Q({
        "output_rate_Q": node["output_rate_Q"], "launch_cost_rate_C": node["launch_cost_rate_C"]
    })) for node in selected_nodes)
    return {
        "topology_status": Q3_TOPOLOGY_STATUS,
        "formal_instance_status": Q3_FORMAL_INSTANCE_STATUS,
        "policy_order": list(params.Q3_POLICY_ORDER),
        "policy": list(best["vector"]),
        "policy_label": {
            "inspect": [node for node, value in policy["inspect"].items() if value],
            "disassemble": [node for node, value in policy["disassemble"].items() if value],
        },
        "profit": best["profit"],
        "optimal_policy_index": best["index"],
        "enumerated_strategy_count": len(table),
        "finite_strategy_count": sum(row["valid"] for row in table),
        "root_output_rate_Q": best["result"]["nodes"][Q3_ROOT_NODE_ID]["output_rate_Q"],
        "root_launch_cost_rate_C": best["result"]["nodes"][Q3_ROOT_NODE_ID]["launch_cost_rate_C"],
        "root_unit_good_cost_U": best["result"]["nodes"][Q3_ROOT_NODE_ID]["unit_good_cost_U"],
        "unit_identity_max_error": identity_error,
        "node_metrics": selected_nodes,
        "edges": [list(edge) for edge in graph.edges()],
        "strategy_profit_table": table if include_strategy_table else [],
        "strategy_profit_values": [row["profit"] for row in table] if include_strategy_table else [],
        "decision_basis": "maximized_exact_event_cash_profit_over_finite_static_strategies",
    }


def solve_primary(defect_rates=None, include_strategy_table=True):
    return solve_network(params.Q3_PRIMARY_TOPOLOGY, defect_rates, include_strategy_table)


def solve_alternative(defect_rates=None, include_strategy_table=True):
    return solve_network(params.Q3_ALTERNATIVE_TOPOLOGY, defect_rates, include_strategy_table)


def _event_step(graph, policy, state):
    order = tuple(networkx.topological_sort(graph))
    root = next(node for node, data in graph.nodes(data=True) if "market_price" in data)

    def prepare(node):
        data = graph.nodes[node]
        if data["kind"] == "assembly" and any(state[parent] == Q2_COST_FLOOR for parent in graph.predecessors(node)):
            missing = next(parent for parent in graph.predecessors(node) if state[parent] == Q2_COST_FLOOR)
            return prepare(missing)
        return launch(node)

    def launch(node):
        data = graph.nodes[node]
        parents = tuple(graph.predecessors(node))
        cleared = list(state)
        for parent in parents:
            cleared[parent] = Q2_COST_FLOOR
        good_probability = (
            (Q2_PROBABILITY_CEILING - float(data["defect_rate"]))
            if all(state[parent] == Q2_PROBABILITY_CEILING for parent in parents)
            else Q2_PROBABILITY_FLOOR
        )
        inspect = policy["inspect"][node]
        reward = -float(data.get("assembly_cost", data.get("purchase_price", Q2_COST_FLOOR)))
        if inspect:
            reward -= float(data["inspection_cost"])
        outcome = []
        if good_probability > Q2_PROBABILITY_FLOOR:
            outcome.append((good_probability, reward, _event_success_state(node, state, cleared, graph)))
        bad_probability = Q2_PROBABILITY_CEILING - good_probability
        if bad_probability > Q2_PROBABILITY_FLOOR:
            bad_reward = reward
            if node == root and not inspect:
                bad_reward += float(data["market_price"]) - float(data["exchange_loss"])
            if node == root and inspect:
                bad_reward -= Q2_COST_FLOOR
            if policy["disassemble"].get(node, False):
                bad_reward -= float(data["disassembly_cost"])
                retry = list(state)
                for parent in parents:
                    retry[parent] = state[parent]
                outcome.append((bad_probability, bad_reward, tuple(retry), False))
            elif node == root and not inspect:
                outcome.append((bad_probability, bad_reward, tuple(cleared), False))
            elif node == root:
                outcome.append((bad_probability, bad_reward, tuple(cleared), False))
            elif inspect:
                outcome.append((bad_probability, bad_reward, tuple(cleared), False))
            else:
                bad_state = list(cleared); bad_state[node] = 2
                outcome.append((bad_probability, bad_reward, tuple(bad_state), False))
        if node == root:
            filtered = []
            for probability, value, next_state, terminal in outcome:
                if terminal:
                    filtered.append((probability, value + float(data["market_price"]), None, True))
                else:
                    filtered.append((probability, value, next_state, False))
            return filtered
        return outcome

    def _event_success_state(node, state, cleared, graph):
        if "market_price" in graph.nodes[node]:
            return None
        next_state = list(cleared); next_state[node] = Q2_PROBABILITY_CEILING
        return tuple(next_state)

    if all(state[parent] != Q2_COST_FLOOR for parent in graph.predecessors(root)):
        return launch(root)
    target = next(parent for parent in graph.predecessors(root) if state[parent] == Q2_PROBABILITY_FLOOR)
    if graph.nodes[target]["kind"] == "leaf":
        data = graph.nodes[target]
        probability = Q2_PROBABILITY_CEILING - float(data["defect_rate"])
        inspect = policy["inspect"][target]
        reward = -float(data["purchase_price"]) - (float(data["inspection_cost"]) if inspect else Q2_COST_FLOOR)
        if inspect and probability < Q2_PROBABILITY_CEILING:
            return ((probability, reward, state, False),)
        next_state = list(state); next_state[target] = Q2_PROBABILITY_CEILING if probability > Q2_PROBABILITY_FLOOR else 2
        return ((probability, reward, tuple(next_state), False),)
    return prepare(target)


def reachable_state_enumeration(graph, policy, initial=None):
    order = tuple(networkx.topological_sort(graph))
    initial = tuple(Q2_COST_FLOOR for _ in order) if initial is None else tuple(initial)
    queue = deque([initial]); seen = {initial}; transitions = {}; terminal_count = 0
    while queue:
        state = queue.popleft()
        edges = _event_step(graph, _policy_map(graph, policy, order), state)
        transitions[state] = edges
        for probability, reward, next_state, terminal in edges:
            if terminal:
                terminal_count += 1
            elif next_state not in seen:
                seen.add(next_state); queue.append(next_state)
                if len(seen) > Q3_STATE_SPACE_LIMIT:
                    raise RuntimeError("可达状态超过登记上限")
    return sorted(seen), transitions, terminal_count


def event_markov_reward(graph, policy):
    order = tuple(networkx.topological_sort(graph))
    states, transitions, terminal_count = reachable_state_enumeration(graph, policy)
    index = {state: i for i, state in enumerate(states)}
    matrix = np.eye(len(states)); reward = np.zeros(len(states)); absorption = np.zeros(len(states))
    for state, edges in transitions.items():
        row = index[state]
        for probability, immediate, next_state, terminal in edges:
            reward[row] += probability * immediate
            if terminal:
                absorption[row] += probability
            else:
                matrix[row, index[next_state]] -= probability
    values = np.linalg.solve(matrix, reward)
    absorption_probability = float(np.linalg.solve(matrix, absorption)[0])
    residual = float(np.max(np.abs(matrix.dot(values) - reward)))
    return {
        "profit": float(values[0]),
        "state_count": len(states),
        "terminal_transition_count": terminal_count,
        "absorption_probability": absorption_probability,
        "bellman_residual": residual,
        "converged": bool(residual <= VALUE_ITERATION_TOL and absorption_probability >= Q2_PROBABILITY_CEILING - CASHFLOW_ABS_TOL),
    }


def q2_degenerate_16_policy_equivalence():
    case = params.Q2_CASE1
    data = {
        "part1": {"defect_rate": case["p1"], "purchase_price": case["a1"], "inspection_cost": case["t1"]},
        "part2": {"defect_rate": case["p2"], "purchase_price": case["a2"], "inspection_cost": case["t2"]},
        "product": {"defect_rate": case["pf"], "assembly_cost": case["kf"], "inspection_cost": case["tf"],
                    "disassembly_cost": case["disassembly_cost"], "market_price": case["market_price"],
                    "exchange_loss": case["exchange_loss"]},
    }
    graph = _build_graph({"product": ["part1", "part2"]}, data)
    order = tuple(networkx.topological_sort(graph)); comparisons = []; max_error = Q2_COST_FLOOR
    for vector in params.Q2_POLICY_SPACE:
        z1, z2, inspect, disassemble = vector
        cost1 = (case["a1"] + case["t1"]) / (Q2_PROBABILITY_CEILING - case["p1"]) if z1 else case["a1"]
        cost2 = (case["a2"] + case["t2"]) / (Q2_PROBABILITY_CEILING - case["p2"]) if z2 else case["a2"]
        input_good = (Q2_PROBABILITY_CEILING - case["p1"] if not z1 else Q2_PROBABILITY_CEILING)
        input_good *= Q2_PROBABILITY_CEILING - case["p2"] if not z2 else Q2_PROBABILITY_CEILING
        q = input_good * (Q2_PROBABILITY_CEILING - case["pf"])
        valid = q > Q2_PROBABILITY_FLOOR and (not disassemble or input_good >= Q2_PROBABILITY_CEILING)
        if valid:
            if disassemble:
                rate = q * (cost1 + cost2) + case["kf"] + (case["tf"] if inspect else Q2_COST_FLOOR)
                rate += (Q2_PROBABILITY_CEILING - q) * (case["disassembly_cost"] + (Q2_COST_FLOOR if inspect else case["exchange_loss"]))
            else:
                rate = cost1 + cost2 + case["kf"] + (case["tf"] if inspect else Q2_COST_FLOOR)
                if not inspect:
                    rate += (Q2_PROBABILITY_CEILON - q) * case["exchange_loss"]
            reference = case["market_price"] - rate / q
        else:
            reference = -math.inf
        generic = _evaluate_network(graph, vector, order)
        gap = abs(generic["profit"] - reference) if valid and generic["finite"] else Q2_COST_FLOOR
        max_error = max(max_error, gap)
        comparisons.append({"policy": list(vector), "valid": bool(valid and generic["finite"]),
                            "reference_profit": reference if valid else None,
                            "network_profit": generic["profit"] if generic["finite"] else None,
                            "absolute_error": gap})
    return {"passed": bool(max_error <= CASHFLOW_ABS_TOL), "policy_count": len(comparisons),
            "max_absolute_error": max_error, "comparisons": comparisons}


def run():
    primary = solve_primary()
    alternative = solve_alternative()
    equivalence = q2_degenerate_16_policy_equivalence()
    graph = _build_graph(params.Q3_PRIMARY_TOPOLOGY, params.Q3_NODE_DATA)
    event_check = event_markov_reward(graph, primary["policy"])
    event_error = abs(event_check["profit"] - primary["profit"])
    if not equivalence["passed"] or event_error > CASHFLOW_ABS_TOL or not event_check["converged"]:
        raise RuntimeError("问题三阻断式现金流、退化等价或事件状态核验未通过")
    return {
        "primary": primary,
        "alternative": alternative,
        "primary_policy": primary["policy"],
        "primary_profit": primary["profit"],
        "alternative_policy": alternative["policy"],
        "alternative_profit": alternative["profit"],
        "topology_profit_gap": abs(primary["profit"] - alternative["profit"]),
        "degenerate_max_error": equivalence["max_absolute_error"],
        "degenerate_16_policy_equivalence": equivalence,
        "registered_instance_answer": {"policy": primary["policy"], "profit": primary["profit"],
                                       "status": Q3_TOPOLOGY_STATUS},
        "formal_instance_status": Q3_FORMAL_INSTANCE_STATUS,
        "authoritative_figure1_edge_table_available": False,
        "graph_fact_status": Q3_GRAPH_FACT_STATUS,
        "topology_perturbation": topology_perturbation(),
        "event_markov_validation": event_check,
        "event_markov_identity_error": event_error,
        "profit_unit": Q4_PROFIT_UNIT,
    }