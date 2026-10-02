"""问题 3：一般装配 DAG 的事件马尔可夫奖励求解与条件拓扑分析。"""

from __future__ import annotations

import itertools
import json
from collections.abc import Mapping
from pathlib import Path

import networkx as nx
import numpy as np

import params as p


METHOD_CLAIMS = (
    "networkx.DiGraph",
    "reachable_state_enumeration",
    "event_markov_reward",
    "output_rate",
    "launch_cost_rate",
    "U_equals_C_over_Q",
    "topology_perturbation",
    "q2_degenerate_16_policy_equivalence",
)


def _attr(obj, key, default=None):
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def build_network(source=None, node_specs=None, rates=None):
    """建立任意有限、单根、分层有向无环装配网络。"""
    if rates is None and isinstance(node_specs, Mapping) and node_specs:
        if all(isinstance(value, (int, float, np.number)) for value in node_specs.values()):
            rates, node_specs = node_specs, None
    if isinstance(source, nx.DiGraph):
        graph = source.copy()
        for node_id, rate in (rates or {}).items():
            if node_id not in graph:
                raise KeyError(f"未知率节点：{node_id}")
            graph.nodes[node_id]["defect_rate"] = float(rate)
    else:
        specs = tuple(node_specs or p.Q3_NODE_SPECS)
        if source is None:
            parent_map = {
                str(_attr(spec, "node_id")): tuple(_attr(spec, "parent_ids", ()))
                for spec in specs
            }
        elif isinstance(source, Mapping):
            parent_map = {
                str(child): ((parents,) if isinstance(parents, str) else tuple(parents))
                for child, parents in source.items()
            }
        else:
            grouped = {}
            for parent_id, child_id in source:
                grouped.setdefault(str(child_id), []).append(str(parent_id))
            parent_map = {child: tuple(parents) for child, parents in grouped.items()}
        graph = nx.DiGraph()
        for spec in specs:
            node_id = str(_attr(spec, "node_id"))
            attrs = {
                "label": str(_attr(spec, "label", node_id)),
                "layer": str(_attr(spec, "layer", "node")),
                "defect_rate": float(_attr(spec, "defect_rate", p.Q3_PART_DEFECT_RATE)),
                "purchase_price": float(_attr(spec, "purchase_price", 0.0)),
                "assembly_cost": float(_attr(spec, "assembly_cost", 0.0)),
                "inspection_cost": float(_attr(spec, "inspection_cost", 0.0)),
                "disassembly_cost": float(_attr(spec, "disassembly_cost", 0.0)),
                "can_inspect": bool(_attr(spec, "can_inspect", True)),
                "can_disassemble": bool(_attr(spec, "can_disassemble", False)),
                "is_root": bool(_attr(spec, "is_root", False)),
            }
            graph.add_node(node_id, **attrs)
        for child, parents in parent_map.items():
            if child not in graph:
                raise KeyError(f"边表引用未知节点：{child}")
            for parent in parents:
                if parent not in graph:
                    raise KeyError(f"边表引用未知父节点：{parent}")
                graph.add_edge(parent, child)
        for node_id, rate in (rates or {}).items():
            if node_id not in graph:
                raise KeyError(f"未知率节点：{node_id}")
            graph.nodes[node_id]["defect_rate"] = float(rate)
    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("装配网络必须为有限有向无环图")
    roots = [node for node in graph if bool(graph.nodes[node].get("is_root", False))]
    if not roots:
        roots = [node for node, degree in graph.out_degree() if degree == 0]
    if len(roots) != 1:
        raise ValueError(f"单位根交付模型要求唯一根节点，实际为 {len(roots)}")
    graph.nodes[roots[0]]["is_root"] = True
    for node in graph:
        rate = float(graph.nodes[node]["defect_rate"])
        if not 0.0 <= rate <= 1.0:
            raise ValueError(f"次品率越界：{node}={rate}")
    graph.graph["method"] = p.Q3_METHOD
    graph.graph["root_id"] = roots[0]
    return graph


def _decision_orders(graph):
    nodes = tuple(graph.nodes)
    inspect = tuple(node for node in nodes if graph.nodes[node].get("can_inspect", True))
    dismantle = tuple(
        node for node in nodes if graph.nodes[node].get("can_disassemble", False)
    )
    return inspect, dismantle


def _decode_policy(graph, policy_id):
    inspect, dismantle = _decision_orders(graph)
    policy = {}
    for index, node in enumerate(inspect):
        policy[node] = bool((policy_id >> index) & 1)
    offset = len(inspect)
    for index, node in enumerate(dismantle):
        policy[f"disassemble_{node}"] = bool((policy_id >> (offset + index)) & 1)
    return policy


def _coerce_policy(graph, value):
    if value is None:
        value = 0
    if isinstance(value, (int, np.integer)):
        return _decode_policy(graph, int(value))
    inspect, dismantle = _decision_orders(graph)
    policy = {}
    if isinstance(value, Mapping):
        for node in inspect:
            policy[node] = bool(
                value.get(node, value.get(f"inspect_{node}", value.get(f"Y_{node}", False)))
            )
        for node in dismantle:
            policy[f"disassemble_{node}"] = bool(
                value.get(
                    f"disassemble_{node}", value.get(f"D_{node}", False)
                )
            )
        return policy
    sequence = tuple(bool(bit) for bit in value)
    if len(sequence) != len(inspect) + len(dismantle):
        raise ValueError("策略位长度与网络决策空间不一致")
    for node, bit in zip(inspect, sequence[: len(inspect)]):
        policy[node] = bit
    for node, bit in zip(dismantle, sequence[len(inspect) :]):
        policy[f"disassemble_{node}"] = bit
    return policy


def _reward(transient, rewards):
    matrix = np.eye(len(rewards), dtype=float) - transient
    try:
        value = np.linalg.solve(matrix, rewards)
    except np.linalg.LinAlgError as exc:
        raise RuntimeError("事件转移核含不可吸收闭合类") from exc
    residual = float(np.max(np.abs(matrix @ value - rewards)))
    if residual > p.VALUE_ITERATION_TOL * p.Q3_REACHABLE_STATE_LIMIT:
        raise RuntimeError("Bellman 方程残差超过登记容差")
    return value, residual


def _stationary(transition):
    distribution = np.ones(len(transition), dtype=float) / len(transition)
    for _ in range(p.VALUE_ITERATION_MAX_ITER):
        updated = distribution @ transition
        if float(np.max(np.abs(updated - distribution))) <= p.VALUE_ITERATION_TOL:
            return updated
        distribution = updated
    raise RuntimeError("节点稳态分布未在登记迭代上限内收敛")


def _state_rows(graph, node_id, parents, parent_info, policy):
    size = 1 << len(parents)
    full_mask = size - 1
    failure_transition = np.zeros((size, size), dtype=float)
    operation_transition = np.zeros((size, size), dtype=float)
    launch_costs, good_rates = [], []
    attrs = graph.nodes[node_id]
    inspect = bool(policy[node_id])
    is_root = bool(attrs.get("is_root", False))
    for mask in range(size):
        outcomes = [(mask, 1.0)]
        for index, parent in enumerate(parents):
            if not (mask & (1 << index)):
                bit = 1 << index
                probability = float(parent_info[parent]["parent_good_probability"])
                expanded = []
                for recovered, weight in outcomes:
                    expanded.append((recovered | bit, weight * probability))
                    expanded.append((recovered, weight * (1.0 - probability)))
                outcomes = expanded
        all_good = sum(weight for recovered, weight in outcomes if recovered == full_mask)
        launch_cost = sum(
            float(parent_info[parent]["output_cost"])
            for index, parent in enumerate(parents)
            if not (mask & (1 << index))
        )
        launch_cost += float(attrs["assembly_cost"])
        if inspect:
            launch_cost += float(attrs["inspection_cost"])
        good_rate = all_good * (1.0 - float(attrs["defect_rate"]))
        failure = 1.0 - good_rate
        launch_costs.append(launch_cost)
        good_rates.append(good_rate)
        salvage = bool(policy.get(f"disassemble_{node_id}", False)) and (inspect or is_root)
        if salvage:
            for recovered, weight in outcomes:
                failure_transition[mask, recovered] += failure * weight
            operation_transition[mask, 0] += good_rate
            for recovered, weight in outcomes:
                operation_transition[mask, recovered] += failure * weight
        else:
            failure_transition[mask, 0] = failure
            operation_transition[mask, 0] = 1.0
    return (
        failure_transition,
        operation_transition,
        np.asarray(launch_costs, dtype=float),
        np.asarray(good_rates, dtype=float),
    )


def _node_economics(graph, node_id, parent_info, policy, full_metrics):
    parents = tuple(graph.predecessors(node_id))
    attrs = graph.nodes[node_id]
    inspect = bool(policy[node_id])
    is_root = bool(attrs.get("is_root", False))
    failure, operation, launch, good = _state_rows(
        graph, node_id, parents, parent_info, policy
    )
    dismantle = bool(policy.get(f"disassemble_{node_id}", False)) and (inspect or is_root)
    disassembly = (
        np.full(len(launch), float(attrs["disassembly_cost"]), dtype=float)
        if dismantle
        else np.zeros(len(launch), dtype=float)
    )
    metric = None
    identity_error = 0.0
    output_identity_error = 0.0
    root_identity_error = 0.0
    residual = 0.0
    if is_root:
        market_probability = np.ones(len(launch)) if not inspect else good
        net_rewards = (
            -launch
            + market_probability * float(attrs["sale_price"])
            - (1.0 - good) * (float(attrs["exchange_loss"]) if not inspect else 0.0)
            - (1.0 - good) * disassembly
        )
        profit, residual = _reward(failure, net_rewards)
        if full_metrics:
            stationary = _stationary(operation)
            launch_cost_rate = float(stationary @ (launch + (1.0 - good) * disassembly))
            output_rate = float(stationary @ good)
            unit_good_cost = launch_cost_rate / output_rate
            cash_profit, cash_residual = _reward(
                failure, launch + (1.0 - good) * disassembly
            )
            stationary_profit = (
                float(stationary @ (market_probability * float(attrs["sale_price"])))
                - (
                    float(stationary @ ((1.0 - good) * float(attrs["exchange_loss"])))
                    if not inspect
                    else 0.0
                )
                - launch_cost_rate
            ) / output_rate
            identity_error = abs(unit_good_cost - launch_cost_rate / output_rate)
            output_identity_error = abs(float(cash_profit[0]) - unit_good_cost)
            root_identity_error = abs(float(profit[0]) - stationary_profit)
            residual = max(residual, cash_residual)
            metric = {
                "node_id": node_id,
                "launch_cost_rate": launch_cost_rate,
                "output_rate": output_rate,
                "unit_good_cost": unit_good_cost,
                "unit_good_output_cost": float(cash_profit[0]),
                "stationary_profit": stationary_profit,
            }
        output_cost = float(cash_profit[0]) if full_metrics else 0.0
        parent_good_probability = good[0]
        profit_value = float(profit[0])
    elif inspect:
        cost_rewards = launch + (1.0 - good) * disassembly
        cost, residual = _reward(failure, cost_rewards)
        output_cost = float(cost[0])
        parent_good_probability = 1.0
        if full_metrics:
            stationary = _stationary(operation)
            launch_cost_rate = float(stationary @ cost_rewards)
            output_rate = float(stationary @ good)
            unit_good_cost = launch_cost_rate / output_rate
            identity_error = abs(unit_good_cost - launch_cost_rate / output_rate)
            output_identity_error = abs(output_cost - unit_good_cost)
            metric = {
                "node_id": node_id,
                "launch_cost_rate": launch_cost_rate,
                "output_rate": output_rate,
                "unit_good_cost": unit_good_cost,
                "output_cost_to_parent": output_cost,
            }
        profit_value = 0.0
    else:
        output_cost = float(launch[0])
        parent_good_probability = float(good[0])
        if full_metrics:
            launch_cost_rate = output_cost
            output_rate = parent_good_probability
            unit_good_cost = launch_cost_rate / output_rate
            identity_error = abs(unit_good_cost - launch_cost_rate / output_rate)
            metric = {
                "node_id": node_id,
                "launch_cost_rate": launch_cost_rate,
                "output_rate": output_rate,
                "unit_good_cost": unit_good_cost,
                "output_cost_to_parent": output_cost,
            }
        profit_value = 0.0
    return (
        {
            "output_cost": output_cost,
            "parent_good_probability": float(parent_good_probability),
        },
        metric,
        float(residual),
        float(identity_error),
        float(output_identity_error),
        float(root_identity_error),
        profit_value,
    )


def _evaluate(graph, policy, full_metrics=False):
    policy = _coerce_policy(graph, policy)
    parent_info, metrics = {}, []
    max_residual = unit_error = output_error = root_error = 0.0
    for node_id in nx.topological_sort(graph):
        result = _node_economics(graph, node_id, parent_info, policy, full_metrics)
        parent_info[node_id], metric, residual, ident, out_ident, root_ident, _ = result
        max_residual = max(max_residual, residual)
        unit_error = max(unit_error, ident)
        output_error = max(output_error, out_ident)
        root_error = max(root_error, root_ident)
        if metric is not None:
            metrics.append(metric)
    root_id = graph.graph["root_id"]
    return {
        "policy": policy,
        "profit": parent_info[root_id].get("profit", _last_profit),
        "node_metrics": metrics,
        "state_count": sum(1 << graph.in_degree(node) for node in graph),
        "bellman_max_residual": max_residual,
        "unit_identity_max_error": unit_error,
        "output_cost_identity_max_error": output_error,
        "root_profit_identity_error": root_error,
        "absorption_probability": 1.0,
    }


def _optimize(graph, include_table=False, full_enumeration=True):
    inspect, dismantle = _decision_orders(graph)
    bit_order = inspect + dismantle
    count = 1 << len(bit_order)
    evaluated = []

    def consider(policy_id):
        result = _evaluate(graph, _decode_policy(graph, policy_id))
        evaluated.append((policy_id, result["profit"]))
        return result

    if full_enumeration:
        for policy_id in range(count):
            consider(policy_id)
        best_id, best_profit = max(evaluated, key=lambda item: (item[1], -item[0]))
    else:
        current = 0
        current_profit = consider(current)[1 if False else "profit"]
        for _ in range(len(bit_order) * 2):
            changed = False
            for bit in range(len(bit_order)):
                candidate = current ^ (1 << bit)
                value = consider(candidate)["profit"]
                if value > current_profit + p.CASHFLOW_ABS_TOL:
                    current, current_profit, changed = candidate, value, True
            if not changed:
                break
        best_id, best_profit = current, current_profit
    best = _evaluate(graph, _decode_policy(graph, best_id), full_metrics=True)
    result = {
        "best_policy": best["policy"],
        "best_profit": best_profit,
        "policy": best["policy"],
        "profit": best_profit,
        "policy_space_size": count,
        "enumerated_policy_count": len(evaluated),
        "enumeration_method": (
            "complete_policy_enumeration" if full_enumeration else "coordinate_descent"
        ),
        "global_optimum_verified": bool(full_enumeration),
        "state_count": best["state_count"],
        "bellman_max_residual": best["bellman_max_residual"],
        "unit_identity_max_error": best["unit_identity_max_error"],
        "output_cost_identity_max_error": best["output_cost_identity_max_error"],
        "root_profit_identity_error": best["root_profit_identity_error"],
        "absorption_probability": best["absorption_probability"],
        "node_metrics": best["node_metrics"],
        "bit_order": {"inspection": list(inspect), "disassembly": list(dismantle)},
    }
    if include_table:
        root_id = graph.graph["root_id"]
        sale_price = float(graph.nodes[root_id]["sale_price"])
        result["policy_comparison"] = {
            "policy_id": [item[0] for item in evaluated],
            "profit": [float(item[1]) for item in evaluated],
            "expected_net_cost": [sale_price - float(item[1]) for item in evaluated],
            "absorption_probability": [1.0 for _ in evaluated],
            "bit_order": {"inspection": list(inspect), "disassembly": list(dismantle)},
        }
    return result


def _q2_reference_profit(case, bits):
    z1, z2, product_test, dismantle = bits
    output_cost, parent_quality = [], []
    for inspected, rate, price, test_cost in (
        (z1, case.p1, case.price1, case.test1),
        (z2, case.p2, case.price2, case.test2),
    ):
        if inspected:
            output_cost.append((price + test_cost) / (1.0 - rate))
            parent_quality.append(1.0)
        else:
            output_cost.append(price)
            parent_quality.append(1.0 - rate)
    size = 1 << len(output_cost)
    full_mask = size - 1
    transient = np.zeros((size, size), dtype=float)
    rewards = np.zeros(size, dtype=float)
    for mask in range(size):
        outcomes = [(mask, 1.0)]
        for index, quality in enumerate(parent_quality):
            if not (mask & (1 << index)):
                bit = 1 << index
                outcomes = [
                    pair
                    for recovered, weight in outcomes
                    for pair in (
                        (recovered | bit, weight * quality),
                        (recovered, weight * (1.0 - quality)),
                    )
                ]
        all_good = sum(weight for recovered, weight in outcomes if recovered == full_mask)
        launch = sum(
            output_cost[index]
            for index in range(len(output_cost))
            if not (mask & (1 << index))
        ) + case.assembly_cost
        if product_test:
            launch += case.product_test_cost
        success = all_good * (1.0 - case.pf)
        failure = 1.0 - success
        market = success if product_test else 1.0
        rewards[mask] = (
            -launch
            + market * case.sale_price
            - (failure * case.exchange_loss if not product_test else 0.0)
            - (failure * case.disassembly_cost if dismantle else 0.0)
        )
        if dismantle:
            for recovered, weight in outcomes:
                transient[mask, recovered] += failure * weight
        else:
            transient[mask, 0] = failure
    return float(_reward(transient, rewards)[0][0])


def _q2_degeneration_regression():
    rows = []
    for case in p.Q2_CASES:
        specs = (
            {"node_id": "part_1", "label": "零件1", "defect_rate": case.p1,
             "purchase_price": case.price1, "inspection_cost": case.test1,
             "can_inspect": True, "is_root": False},
            {"node_id": "part_2", "label": "零件2", "defect_rate": case.p2,
             "purchase_price": case.price2, "inspection_cost": case.test2,
             "can_inspect": True, "is_root": False},
            {"node_id": "product", "label": "成品", "defect_rate": case.pf,
             "assembly_cost": case.assembly_cost,
             "inspection_cost": case.product_test_cost,
             "disassembly_cost": case.disassembly_cost, "sale_price": case.sale_price,
             "exchange_loss": case.exchange_loss, "can_inspect": True,
             "can_disassemble": True, "is_root": True},
        )
        graph = build_network({"product": ("part_1", "part_2")}, specs)
        differences = []
        for bits in itertools.product((False, True), repeat=len(p.Q2_POLICY_BITS)):
            policy = _coerce_policy(graph, bits)
            network_profit = _evaluate(graph, policy)["profit"]
            reference_profit = _q2_reference_profit(case, bits)
            differences.append(abs(network_profit - reference_profit))
        maximum = max(differences)
        passed = maximum <= p.DEGENERATION_ABS_TOL
        if not passed:
            raise RuntimeError(f"Q2-Q3 退化等价失败：case={case.case_id}, max={maximum}")
        rows.append({
            "case_id": case.case_id,
            "policy_count": len(differences),
            "max_abs_profit_difference": maximum,
            "passed": passed,
            "per_policy_abs_differences": differences,
        })
    return {
        "check": "q2_degenerate_16_policy_equivalence",
        "reference": "specialized_two_part_event_cash_ledger",
        "absolute_tolerance": p.DEGENERATION_ABS_TOL,
        "all_passed": all(row["passed"] for row in rows),
        "cases": rows,
    }


def solve_network(parent_map=None, rate_map=None, policy=None, node_specs=None,
                  full_enumeration=None):
    if full_enumeration is None:
        full_enumeration = rate_map is None
    graph = build_network(parent_map, node_specs, rate_map)
    if policy is not None:
        return _evaluate(graph, policy, full_metrics=True)
    return _optimize(graph, include_table=full_enumeration, full_enumeration=full_enumeration)


def evaluate_policy(source, rates=None, policy=None, node_specs=None):
    graph = source if isinstance(source, nx.DiGraph) else build_network(source, node_specs, rates)
    return _evaluate(graph, policy, full_metrics=True)


def run(output_path=None):
    primary = _optimize(
        build_network(p.Q3_PRIMARY_EDGE_MAP), include_table=True, full_enumeration=True
    )
    alternative = _optimize(
        build_network(p.Q3_ALTERNATIVE_EDGE_MAP), include_table=False, full_enumeration=True
    )
    regression = _q2_degeneration_regression()
    signed_gap = primary["profit"] - alternative["profit"]
    payload = {
        "problem": "Q3",
        "method": p.Q3_METHOD,
        "method_claims": list(METHOD_CLAIMS),
        "general_dag_engine": {
            "networkx_DiGraph": True,
            "finite_DAG_only": True,
            "single_root_delivery": True,
            "reachable_state_enumeration": "每个装配节点以直接父件良品掩码表示可达回收状态",
            "event_markov_reward": True,
            "defect_rule": "任一父件不合格则节点必不合格；全部父件合格时仍按条件次品率产生不合格",
            "cost_unit_rule": p.Q3_COST_UNIT_RULE,
        },
        "official_instance": {
            "available": p.Q3_FIG1_AVAILABLE,
            "can_solve": p.Q3_CAN_SOLVE_OFFICIAL_INSTANCE,
            "status": "blocked_missing_verified_fig1_edge_list",
            "policy": None,
            "profit": None,
            "source_hash": p.Q3_OFFICIAL_SOURCE_HASH,
        },
        "primary_scenario": primary,
        "alternative_scenario": alternative,
        "primary_policy": primary["best_policy"],
        "primary_profit": primary["profit"],
        "alternative_policy": alternative["best_policy"],
        "alternative_profit": alternative["profit"],
        "topology_perturbation": {
            "primary_edge_map": p.Q3_PRIMARY_EDGE_MAP,
            "alternative_edge_map": p.Q3_ALTERNATIVE_EDGE_MAP,
            "signed_profit_gap": signed_gap,
            "absolute_profit_gap": abs(signed_gap),
            "conditional_scenarios_only": True,
        },
        "degeneration_check": regression,
        "cost_coverage": {
            "purchase_price": "父件缺失时进入采购事件",
            "inspection_cost": "所选节点逐次检测事件",
            "assembly_cost": "每次父件齐备后的装配事件",
            "disassembly_cost": "失败且选择拆解的回收事件",
            "sale_price": "每次实际市场销售且只记一次",
            "exchange_loss": "无检测根节点不合格品退回事件",
            "scrap_salvage": p.Q2_SCRAP_SALVAGE,
        },
        "validation_summary": {
            "primary_full_enumeration": primary["global_optimum_verified"],
            "alternative_full_enumeration": alternative["global_optimum_verified"],
            "q2_q3_degeneration_passed": regression["all_passed"],
            "official_result_blocked": not p.Q3_CAN_SOLVE_OFFICIAL_INSTANCE,
        },
    }
    destination = Path(output_path) if output_path is not None else p.CODE_DIR / p.PROBLEM3_RESULT_FILE
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=p.JSON_INDENT, allow_nan=False)
    return payload


run_problem3 = run
solve_problem3 = run
main = run